// Authoritative Power Grid game engine. The server owns one Game per room;
// clients send actions and receive publicState() snapshots.

import {
  PLANTS, STEP3_CARD, STARTING_MONEY, PLAYER_RULES, SLOT_PRICES, RES_TOTAL,
  RES_START, RESUPPLY, CITY_SLOT_COST, PAYMENT, PLAYER_COLORS, RES_TYPES,
} from './data.js';
import { CITIES, EDGES, REGIONS, regionAdjacency, cityById } from './map.js';

export class GameError extends Error {}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const byNumber = (a, b) => a.n - b.n;
const check = (cond, msg) => {
  if (!cond) throw new GameError(msg);
};

// Cost of buying `qty` of a resource when `available` sit in the market.
export function resourceCost(type, available, qty) {
  if (qty > available) return null;
  const prices = SLOT_PRICES[type];
  const start = prices.length - available;
  let cost = 0;
  for (let i = 0; i < qty; i++) cost += prices[start + i];
  return cost;
}

// Storage capacity: each plant holds twice its input of its own fuel.
export function storageCaps(plants) {
  const caps = { coal: 0, oil: 0, hybrid: 0, garbage: 0, uranium: 0 };
  for (const p of plants) if (p.type in caps) caps[p.type] += 2 * p.input;
  return caps;
}

export function canStore(plants, res) {
  const c = storageCaps(plants);
  return (
    res.coal <= c.coal + c.hybrid &&
    res.oil <= c.oil + c.hybrid &&
    res.coal + res.oil <= c.coal + c.oil + c.hybrid &&
    res.garbage <= c.garbage &&
    res.uranium <= c.uranium
  );
}

export class Game {
  constructor(players, { seed = Date.now(), regions = null } = {}) {
    const count = players.length;
    check(count >= 2 && count <= 6, 'Power Grid needs 2-6 players');
    this.rand = mulberry32(seed);
    this.rules = PLAYER_RULES[count];

    this.players = players.map((p, i) => ({
      id: p.id,
      name: p.name,
      color: PLAYER_COLORS[i],
      money: STARTING_MONEY,
      plants: [],
      res: { coal: 0, oil: 0, garbage: 0, uranium: 0 },
      cities: [],
      lastPowered: 0,
      lastIncome: 0,
    }));

    this.regions = regions || this.pickRegions(this.rules.regions);
    this.activeCities = new Set(CITIES.filter((c) => this.regions.includes(c.region)).map((c) => c.id));
    this.cityOwners = Object.fromEntries([...this.activeCities].map((id) => [id, []]));

    this.setupDeck();
    this.resMarket = { ...RES_START };

    this.round = 1;
    this.step = 1;
    this.order = this.shuffle(this.players.map((p) => p.id));
    this.log = [];
    this.winner = null;
    this.endTriggered = false;
    this.addLog(`Game started with ${count} players. Regions: ${this.regions.map((r) => REGIONS.find((x) => x.id === r).name).join(', ')}.`);
    this.startAuctionPhase();
  }

  // ---------- setup helpers ----------

  shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  pickRegions(n) {
    const adj = regionAdjacency();
    const ids = REGIONS.map((r) => r.id);
    const chosen = [ids[Math.floor(this.rand() * ids.length)]];
    while (chosen.length < n) {
      const frontier = [...new Set(chosen.flatMap((r) => [...adj[r]]))].filter((r) => !chosen.includes(r));
      chosen.push(frontier[Math.floor(this.rand() * frontier.length)]);
    }
    return chosen;
  }

  setupDeck() {
    const plants = PLANTS.map((p) => ({ ...p }));
    this.market = plants.filter((p) => p.n <= 10);
    let rest = plants.filter((p) => p.n > 10 && p.n !== 13);
    const p13 = plants.find((p) => p.n === 13);
    rest = this.shuffle(rest).slice(this.rules.removeCards);
    this.deck = [p13, ...rest, { ...STEP3_CARD }];
  }

  addLog(msg) {
    this.log.push({ round: this.round, msg });
    if (this.log.length > 200) this.log.shift();
  }

  player(id) {
    const p = this.players.find((x) => x.id === id);
    check(p, 'Unknown player');
    return p;
  }

  maxCities() {
    return Math.max(0, ...this.players.map((p) => p.cities.length));
  }

  // ---------- power plant market ----------

  sortMarket() {
    this.market.sort(byNumber);
  }

  actualMarket() {
    return this.step === 3 ? this.market : this.market.slice(0, 4);
  }

  // Draw a card into the market, following the "too small" and Step 3 rules.
  drawIntoMarket() {
    while (this.deck.length) {
      const card = this.deck.shift();
      if (card.type === 'step3') {
        if (this.phase === 'bureaucracy') {
          this.sortMarket();
          this.market.shift(); // remove lowest plant, no replacement
          this.beginStep3();
        } else {
          this.market.push(card);
          this.step3Pending = true;
          this.deck = this.shuffle(this.deck);
          this.addLog('The Step 3 card was drawn. Step 3 begins after this phase.');
        }
        this.sortMarket();
        return;
      }
      if (card.n <= this.maxCities()) {
        this.addLog(`Plant ${card.n} is too small for the leading network and is removed.`);
        continue;
      }
      this.market.push(card);
      this.sortMarket();
      return;
    }
    this.sortMarket();
  }

  beginStep3() {
    this.step = 3;
    this.step3Pending = false;
    this.market = this.market.filter((p) => p.type !== 'step3');
    this.deck = this.shuffle(this.deck);
    this.addLog('Step 3 has begun: every plant in the market can now be bought, and 3 houses fit in each city.');
  }

  resolvePendingStep3() {
    if (!this.step3Pending) return;
    this.market = this.market.filter((p) => p.type !== 'step3');
    this.sortMarket();
    this.market.shift();
    this.beginStep3();
  }

  removeLowestAndReplace() {
    this.sortMarket();
    const removed = this.market.find((p) => p.type !== 'step3');
    if (!removed) return;
    this.market = this.market.filter((p) => p !== removed);
    this.addLog(`Plant ${removed.n} is removed from the market.`);
    this.drawIntoMarket();
  }

  pruneSmallPlants() {
    const max = this.maxCities();
    let removed = this.market.filter((p) => p.type !== 'step3' && p.n <= max);
    while (removed.length) {
      for (const p of removed) {
        this.market = this.market.filter((x) => x !== p);
        this.addLog(`Plant ${p.n} is now smaller than the largest network and is removed.`);
        this.drawIntoMarket();
      }
      removed = this.market.filter((p) => p.type !== 'step3' && p.n <= max);
    }
  }

  // ---------- phase 1: turn order ----------

  determineOrder() {
    const highest = (p) => Math.max(0, ...p.plants.map((x) => x.n));
    this.order = [...this.players]
      .sort((a, b) => b.cities.length - a.cities.length || highest(b) - highest(a))
      .map((p) => p.id);
  }

  // ---------- phase 2: auction ----------

  startAuctionPhase() {
    this.phase = 'auction';
    this.auction = {
      queue: [...this.order], // players who may still start an auction
      boughtCount: 0,
      current: null,
      pendingDiscard: null,
    };
  }

  auctionChooser() {
    return this.auction.queue[0] ?? null;
  }

  startAuction(playerId, plantN, bid) {
    const a = this.auction;
    check(!a.current && !a.pendingDiscard, 'An auction is already running');
    check(this.auctionChooser() === playerId, 'It is not your turn to choose a plant');
    const plant = this.actualMarket().find((p) => p.n === plantN && p.type !== 'step3');
    check(plant, 'That plant is not available to buy');
    check(Number.isInteger(bid) && bid >= plant.n, `Opening bid must be at least ${plant.n}`);
    check(bid <= this.player(playerId).money, 'You cannot afford that bid');

    const bidders = a.queue.filter((id) => id === playerId || this.player(id).money > bid);
    a.current = { plant: plant.n, bid, high: playerId, bidders, turn: null };
    this.addLog(`${this.player(playerId).name} opens an auction for plant ${plant.n} at ${bid}.`);
    this.advanceBidTurn();
  }

  advanceBidTurn() {
    const c = this.auction.current;
    if (c.bidders.length === 1) return this.finishAuction();
    const from = c.turn ?? c.high;
    const idx = c.bidders.indexOf(from);
    c.turn = c.bidders[(idx + 1) % c.bidders.length];
    if (c.turn === c.high) return this.finishAuction();
  }

  bid(playerId, amount) {
    const c = this.auction.current;
    check(c && c.turn === playerId, 'It is not your turn to bid');
    check(Number.isInteger(amount) && amount > c.bid, `Bid must be more than ${c.bid}`);
    check(amount <= this.player(playerId).money, 'You cannot afford that bid');
    c.bid = amount;
    c.high = playerId;
    this.addLog(`${this.player(playerId).name} bids ${amount}.`);
    this.advanceBidTurn();
  }

  passBid(playerId) {
    const c = this.auction.current;
    check(c && c.turn === playerId, 'It is not your turn to bid');
    const idx = c.bidders.indexOf(playerId);
    c.bidders.splice(idx, 1);
    c.turn = c.bidders[(idx - 1 + c.bidders.length) % c.bidders.length];
    this.addLog(`${this.player(playerId).name} passes.`);
    this.advanceBidTurn();
  }

  finishAuction() {
    const c = this.auction.current;
    const winner = this.player(c.high);
    const plant = this.market.find((p) => p.n === c.plant);
    winner.money -= c.bid;
    this.market = this.market.filter((p) => p !== plant);
    winner.plants.push(plant);
    winner.plants.sort(byNumber);
    this.auction.current = null;
    this.auction.boughtCount++;
    this.auction.queue = this.auction.queue.filter((id) => id !== winner.id);
    this.addLog(`${winner.name} buys plant ${plant.n} for ${c.bid}.`);
    this.drawIntoMarket();

    if (winner.plants.length > this.rules.maxPlants) {
      this.auction.pendingDiscard = winner.id;
      this.auction.justBought = plant.n;
      return;
    }
    this.afterAuctionStep();
  }

  discardPlant(playerId, plantN) {
    check(this.auction?.pendingDiscard === playerId, 'You do not need to discard a plant');
    const p = this.player(playerId);
    const plant = p.plants.find((x) => x.n === plantN);
    check(plant, 'You do not own that plant');
    check(plantN !== this.auction.justBought, 'Scrap one of your older plants, not the one you just bought');
    p.plants = p.plants.filter((x) => x !== plant);
    this.trimResources(p);
    this.auction.pendingDiscard = null;
    this.addLog(`${p.name} scraps plant ${plantN}.`);
    this.afterAuctionStep();
  }

  passAuction(playerId) {
    const a = this.auction;
    check(!a.current && !a.pendingDiscard, 'An auction is running');
    check(this.auctionChooser() === playerId, 'It is not your turn');
    check(this.round > 1, 'Everyone must buy a plant in the first round');
    a.queue.shift();
    this.addLog(`${this.player(playerId).name} passes on buying a plant.`);
    this.afterAuctionStep();
  }

  afterAuctionStep() {
    if (this.auction.queue.length) return;
    if (this.auction.boughtCount === 0) this.removeLowestAndReplace();
    this.resolvePendingStep3();
    if (this.round === 1) this.determineOrder();
    this.startTurnPhase('resources');
  }

  // Excess resources are returned to the bank when storage shrinks.
  trimResources(p) {
    const c = storageCaps(p.plants);
    p.res.garbage = Math.min(p.res.garbage, c.garbage);
    p.res.uranium = Math.min(p.res.uranium, c.uranium);
    p.res.coal = Math.min(p.res.coal, c.coal + c.hybrid);
    p.res.oil = Math.min(p.res.oil, c.oil + c.hybrid);
    let over = p.res.coal + p.res.oil - (c.coal + c.oil + c.hybrid);
    while (over > 0) {
      if (p.res.oil > c.oil) p.res.oil--;
      else p.res.coal--;
      over--;
    }
  }

  // ---------- phases 3 & 4: reverse turn order ----------

  startTurnPhase(phase) {
    this.phase = phase;
    this.turnQueue = [...this.order].reverse();
    if (phase === 'build') this.builtThisTurn = [];
  }

  currentTurn() {
    return this.turnQueue?.[0] ?? null;
  }

  quoteResources(order) {
    let total = 0;
    for (const r of RES_TYPES) {
      const qty = order[r] || 0;
      check(Number.isInteger(qty) && qty >= 0, 'Invalid amount');
      const cost = resourceCost(r, this.resMarket[r], qty);
      check(cost !== null, `Not enough ${r} in the market`);
      total += cost;
    }
    return total;
  }

  buyResources(playerId, order) {
    check(this.phase === 'resources' && this.currentTurn() === playerId, 'It is not your turn to buy resources');
    const p = this.player(playerId);
    const total = this.quoteResources(order);
    check(total <= p.money, 'You cannot afford those resources');
    const next = { ...p.res };
    for (const r of RES_TYPES) next[r] += order[r] || 0;
    check(canStore(p.plants, next), 'Your plants cannot store that many resources');
    p.money -= total;
    p.res = next;
    for (const r of RES_TYPES) this.resMarket[r] -= order[r] || 0;
    const bought = RES_TYPES.filter((r) => order[r]).map((r) => `${order[r]} ${r}`);
    this.addLog(bought.length ? `${p.name} buys ${bought.join(', ')} for ${total}.` : `${p.name} buys no resources.`);
    this.turnQueue.shift();
    if (!this.turnQueue.length) this.startTurnPhase('build');
  }

  // Cheapest connection from the player's network to `target`, travelling
  // only through cities in play.
  connectionCost(p, target) {
    if (!p.cities.length) return 0;
    const dist = new Map(p.cities.map((c) => [c, 0]));
    const done = new Set();
    for (;;) {
      let best = null;
      for (const [c, d] of dist) if (!done.has(c) && (best === null || d < dist.get(best))) best = c;
      if (best === null) return Infinity;
      if (best === target) return dist.get(best);
      done.add(best);
      for (const e of EDGES) {
        const other = e.a === best ? e.b : e.b === best ? e.a : null;
        if (!other || !this.activeCities.has(other)) continue;
        const nd = dist.get(best) + e.cost;
        if (!dist.has(other) || nd < dist.get(other)) dist.set(other, nd);
      }
    }
  }

  quoteBuild(playerId, cityId) {
    const p = this.player(playerId);
    check(this.activeCities.has(cityId), 'That city is not in play');
    const owners = this.cityOwners[cityId];
    check(!owners.includes(playerId), 'You already have a house there');
    check(owners.length < this.step, `Only ${this.step} house(s) per city in Step ${this.step}`);
    const conn = this.connectionCost(p, cityId);
    return { connection: conn, slot: CITY_SLOT_COST[owners.length], total: conn + CITY_SLOT_COST[owners.length] };
  }

  build(playerId, cityId) {
    check(this.phase === 'build' && this.currentTurn() === playerId, 'It is not your turn to build');
    const p = this.player(playerId);
    const q = this.quoteBuild(playerId, cityId);
    check(q.total <= p.money, 'You cannot afford that city');
    p.money -= q.total;
    p.cities.push(cityId);
    this.cityOwners[cityId].push(playerId);
    this.builtThisTurn.push(cityId);
    this.addLog(`${p.name} builds in ${cityById[cityId].name} for ${q.total}.`);
    this.pruneSmallPlants();
  }

  endBuild(playerId) {
    check(this.phase === 'build' && this.currentTurn() === playerId, 'It is not your turn');
    if (!this.builtThisTurn.length) this.addLog(`${this.player(playerId).name} builds nothing.`);
    this.builtThisTurn = [];
    this.turnQueue.shift();
    if (this.turnQueue.length) return;

    if (this.maxCities() >= this.rules.endCities) {
      this.endTriggered = true;
      this.addLog('A network has reached the end-game size. This is the final Bureaucracy!');
    }
    if (this.step === 1 && this.maxCities() >= this.rules.step2Cities) {
      this.step = 2;
      this.addLog('Step 2 has begun: 2 houses fit in each city.');
      this.removeLowestAndReplace();
    }
    this.resolvePendingStep3();
    this.phase = 'bureaucracy';
    this.powerChoices = {};
  }

  // ---------- phase 5: bureaucracy ----------

  // Resources burned to fire `plantNs`; hybrids burn coal first unless the
  // player names how much coal each hybrid should use.
  firingPlan(p, plantNs, hybridCoal = {}) {
    check(Array.isArray(plantNs) && new Set(plantNs).size === plantNs.length, 'Invalid plant list');
    const use = { coal: 0, oil: 0, garbage: 0, uranium: 0 };
    let capacity = 0;
    const hybrids = [];
    for (const n of plantNs) {
      const plant = p.plants.find((x) => x.n === n);
      check(plant, `You do not own plant ${n}`);
      capacity += plant.output;
      if (plant.type === 'hybrid') hybrids.push(plant);
      else if (plant.type !== 'eco') use[plant.type] += plant.input;
    }
    for (const h of hybrids) {
      const wanted = hybridCoal[h.n];
      let coal;
      if (Number.isInteger(wanted)) coal = Math.max(0, Math.min(h.input, wanted));
      else coal = Math.min(h.input, Math.max(0, p.res.coal - use.coal));
      use.coal += coal;
      use.oil += h.input - coal;
    }
    for (const r of RES_TYPES) check(use[r] <= p.res[r], `Not enough ${r} to fire those plants`);
    return { use, capacity, powered: Math.min(capacity, p.cities.length) };
  }

  power(playerId, plantNs, hybridCoal) {
    check(this.phase === 'bureaucracy', 'It is not the Bureaucracy phase');
    check(!(playerId in this.powerChoices), 'You already chose which plants to fire');
    const p = this.player(playerId);
    this.firingPlan(p, plantNs, hybridCoal); // validate now
    this.powerChoices[playerId] = { plantNs, hybridCoal };
    if (Object.keys(this.powerChoices).length === this.players.length) this.resolveBureaucracy();
  }

  resolveBureaucracy() {
    for (const p of this.players) {
      const { plantNs, hybridCoal } = this.powerChoices[p.id];
      const plan = this.firingPlan(p, plantNs, hybridCoal);
      for (const r of RES_TYPES) p.res[r] -= plan.use[r];
      p.lastPowered = plan.powered;
      if (!this.endTriggered) {
        p.lastIncome = PAYMENT[Math.min(plan.powered, PAYMENT.length - 1)];
        p.money += p.lastIncome;
        this.addLog(`${p.name} powers ${plan.powered} cities and earns ${p.lastIncome}.`);
      } else {
        this.addLog(`${p.name} powers ${plan.powered} cities.`);
      }
    }
    if (this.endTriggered) return this.finishGame();

    this.resupply();
    this.updateMarketEndOfRound();
    this.round++;
    this.determineOrder();
    this.startAuctionPhase();
  }

  resupply() {
    const table = RESUPPLY[this.players.length];
    for (const r of RES_TYPES) {
      const inPlants = this.players.reduce((s, p) => s + p.res[r], 0);
      const bank = RES_TOTAL[r] - inPlants - this.resMarket[r];
      const room = SLOT_PRICES[r].length - this.resMarket[r];
      this.resMarket[r] += Math.max(0, Math.min(table[r][this.step - 1], bank, room));
    }
  }

  updateMarketEndOfRound() {
    this.sortMarket();
    if (this.step === 3) {
      this.removeLowestAndReplace();
    } else {
      const highest = this.market.pop();
      this.deck.push(highest);
      this.drawIntoMarket();
    }
  }

  finishGame() {
    const ranked = [...this.players].sort(
      (a, b) => b.lastPowered - a.lastPowered || b.money - a.money || b.cities.length - a.cities.length,
    );
    this.phase = 'gameover';
    this.winner = ranked[0].id;
    this.ranking = ranked.map((p) => p.id);
    this.addLog(`${ranked[0].name} wins by powering ${ranked[0].lastPowered} cities!`);
  }

  // ---------- dispatch & serialisation ----------

  apply(playerId, action) {
    check(this.phase !== 'gameover', 'The game is over');
    check(action && typeof action.type === 'string', 'Invalid action');
    switch (action.type) {
      case 'startAuction': return this.startAuction(playerId, action.plant, action.bid);
      case 'passAuction': return this.passAuction(playerId);
      case 'bid': return this.bid(playerId, action.amount);
      case 'passBid': return this.passBid(playerId);
      case 'discardPlant': return this.discardPlant(playerId, action.plant);
      case 'buyResources': return this.buyResources(playerId, action.order || {});
      case 'build': return this.build(playerId, action.city);
      case 'endBuild': return this.endBuild(playerId);
      case 'power': return this.power(playerId, action.plants || [], action.hybridCoal || {});
      default: throw new GameError('Unknown action');
    }
  }

  // Who the game is waiting on right now.
  waitingOn() {
    switch (this.phase) {
      case 'auction': {
        const a = this.auction;
        if (a.pendingDiscard) return [a.pendingDiscard];
        if (a.current) return [a.current.turn];
        return a.queue.length ? [a.queue[0]] : [];
      }
      case 'resources':
      case 'build':
        return this.turnQueue.length ? [this.turnQueue[0]] : [];
      case 'bureaucracy':
        return this.players.map((p) => p.id).filter((id) => !(id in this.powerChoices));
      default:
        return [];
    }
  }

  publicState() {
    const marketSize = this.step === 3 ? this.market.length : 4;
    return {
      round: this.round,
      step: this.step,
      phase: this.phase,
      order: this.order,
      regions: this.regions,
      rules: this.rules,
      players: this.players.map((p) => ({ ...p, plants: p.plants, res: { ...p.res } })),
      market: this.market.map((p, i) => ({ ...p, buyable: i < marketSize && p.type !== 'step3' })),
      deckSize: this.deck.length,
      resMarket: { ...this.resMarket },
      cityOwners: this.cityOwners,
      auction: this.phase === 'auction' ? {
        chooser: this.auctionChooser(),
        queue: this.auction.queue,
        current: this.auction.current,
        pendingDiscard: this.auction.pendingDiscard,
      } : null,
      turnQueue: this.phase === 'resources' || this.phase === 'build' ? this.turnQueue : [],
      powered: this.phase === 'bureaucracy' ? Object.keys(this.powerChoices) : [],
      waitingOn: this.waitingOn(),
      endTriggered: this.endTriggered,
      winner: this.winner,
      ranking: this.ranking || null,
      log: this.log.slice(-60),
    };
  }
}
