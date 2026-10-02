// Authoritative Power Grid (Recharged) game engine. The server owns one Game
// per room; clients send actions and receive publicState() snapshots.

import {
  PLANTS, STEP3_CARD, STARTING_MONEY, PLAYER_RULES, PLUG_MAX, TRUST, SLOT_PRICES,
  RES_TOTAL, RES_START, RESUPPLY, CITY_SLOT_COST, PAYMENT, PLAYER_COLORS, RES_TYPES,
} from './data.js';
import { getMap, regionAdjacency, DEFAULT_MAP } from './map.js';

export class GameError extends Error {}

// Seeded PRNG whose state is a single integer, so a saved game can resume
// with the same shuffle sequence.
function nextRandom(game) {
  game.randState = (game.randState + 0x6d2b79f5) >>> 0;
  let t = game.randState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const byNumber = (a, b) => a.n - b.n;
const isPlant = (p) => p.type !== 'step3';
const emptyRes = () => ({ coal: 0, oil: 0, garbage: 0, uranium: 0 });
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
  constructor(players, { seed = Date.now(), mapId = DEFAULT_MAP, regions = null } = {}) {
    const count = players.length;
    check(count >= 2 && count <= 6, 'Power Grid needs 2-6 players');
    this.randState = seed >>> 0;
    this.rules = PLAYER_RULES[count];
    this.mapId = mapId;
    this.attachMap();

    this.players = players.map((p, i) => ({
      id: p.id,
      name: p.name,
      color: PLAYER_COLORS[i],
      money: STARTING_MONEY,
      plants: [],
      res: emptyRes(),
      cities: [],
      lastPowered: 0,
      lastIncome: 0,
      quit: false,
    }));
    this.trust = count === 2
      ? { id: TRUST.id, name: TRUST.name, color: TRUST.color, plants: [], res: emptyRes(), cities: [], housesLeft: TRUST.houses }
      : null;

    this.regions = regions || this.pickRegions(this.rules.regions);
    this.activeCities = new Set(this.map.cities.filter((c) => this.regions.includes(c.region)).map((c) => c.id));
    // Each city has three spaces (10 / 15 / 20); holds a player id, 'trust' or null.
    this.citySlots = Object.fromEntries([...this.activeCities].map((id) => [id, [null, null, null]]));

    this.log = [];
    this.round = 1;
    this.step = 1;
    this.step3Pending = false;
    this.step3NextRound = false;
    this.discount = null;
    this.winner = null;
    this.endTriggered = false;
    this.uraniumPhaseOut = false;
    this.setupDeck();
    this.resMarket = { ...RES_START };

    const humans = this.shuffle(this.players.map((p) => p.id));
    this.order = this.trust ? [humans[0], TRUST.id, humans[1]] : humans;

    const zone = this.regions.map((r) => this.map.regions.find((x) => x.id === r).name).join(', ');
    this.addLog(`Game started on the ${this.map.name} map with ${count} players. Playing zone: ${zone}.`);

    if (this.trust) {
      const [a, , b] = this.order;
      this.phase = 'trustSetup';
      this.trustSetupQueue = [a, b, b, a, a, b];
      this.addLog(`${this.player(a).name} places the Trust's first house; then players alternate placing its 6 starting houses.`);
    } else {
      this.startAuctionPhase();
    }
  }

  // ---------- setup helpers ----------

  rand() {
    return nextRandom(this);
  }

  // Derived, non-serialised lookups for the current map.
  attachMap() {
    this.map = getMap(this.mapId);
    this.neighbors = {};
    for (const e of this.map.edges) {
      (this.neighbors[e.a] ||= []).push({ city: e.b, cost: e.cost });
      (this.neighbors[e.b] ||= []).push({ city: e.a, cost: e.cost });
    }
  }

  // Plain-object snapshot that restore() turns back into a Game.
  serialize() {
    const { map, neighbors, activeCities, ...rest } = this;
    return { ...rest, activeCities: [...activeCities] };
  }

  static restore(data) {
    const g = Object.create(Game.prototype);
    Object.assign(g, data);
    g.activeCities = new Set(data.activeCities);
    g.attachMap();
    return g;
  }

  shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  pickRegions(n) {
    const adj = regionAdjacency(this.map);
    const ids = this.map.regions.map((r) => r.id);
    const chosen = [ids[Math.floor(this.rand() * ids.length)]];
    while (chosen.length < n) {
      const frontier = [...new Set(chosen.flatMap((r) => [...adj[r]]))].filter((r) => !chosen.includes(r));
      chosen.push(frontier[Math.floor(this.rand() * frontier.length)]);
    }
    return chosen;
  }

  // Rulebook p. 3: 8 random plug cards (03-15) form the market; one more plug
  // card is set aside to go on top of the stack; random plug and socket cards
  // are removed by player count; Step 3 goes to the bottom.
  setupDeck() {
    const plants = PLANTS.map((p) => ({ ...p }));
    const plugs = this.shuffle(plants.filter((p) => p.n <= PLUG_MAX));
    const sockets = this.shuffle(plants.filter((p) => p.n > PLUG_MAX));
    this.market = plugs.splice(0, 8).sort(byNumber);
    const top = plugs.shift();
    plugs.splice(0, this.rules.removePlug);
    sockets.splice(0, this.rules.removeSocket);
    this.deck = [top, ...this.shuffle([...plugs, ...sockets]), { ...STEP3_CARD }];
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

  humanOrder() {
    return this.order.filter((id) => id !== TRUST.id);
  }

  maxCities() {
    return Math.max(0, ...this.players.map((p) => p.cities.length));
  }

  cityName(id) {
    return this.map.cityById[id].name;
  }

  // ---------- 2-player Trust setup ----------

  placeTrust(playerId, cityId) {
    check(this.phase === 'trustSetup' && this.trustSetupQueue[0] === playerId, 'It is not your turn to place a Trust house');
    check(this.activeCities.has(cityId), 'That city is not in the playing zone');
    check(!this.citySlots[cityId][0], 'The Trust already has a house there');
    if (this.trust.cities.length) {
      const adjacent = this.neighbors[cityId].some((n) => this.trust.cities.includes(n.city));
      check(adjacent, 'Trust houses must be placed next to a city that already has one');
    }
    this.citySlots[cityId][0] = TRUST.id;
    this.trust.cities.push(cityId);
    this.trust.housesLeft--;
    this.trustSetupQueue.shift();
    this.addLog(`${this.player(playerId).name} places a Trust house in ${this.cityName(cityId)}.`);
    if (!this.trustSetupQueue.length) this.startAuctionPhase();
  }

  // ---------- power plant market ----------

  sortMarket() {
    this.market.sort(byNumber);
  }

  actualMarket() {
    return (this.step === 3 ? this.market : this.market.slice(0, 4)).filter(isPlant);
  }

  // Draw one card into the market, applying the discount-token and Step 3 rules.
  drawIntoMarket() {
    while (this.deck.length) {
      const card = this.deck.shift();
      if (card.type === 'step3') {
        this.deck = this.shuffle(this.deck);
        if (this.phase === 'bureaucracy') {
          // Rulebook p. 11 (2): remove the card and the lowest plant, no replacement.
          this.sortMarket();
          this.market.shift();
          this.step3NextRound = true;
          this.addLog('The Step 3 card was drawn. Step 3 begins next round.');
        } else {
          this.market.push(card);
          this.step3Pending = true;
          this.addLog('The Step 3 card was drawn. Step 3 begins after this phase.');
        }
        this.sortMarket();
        return;
      }
      if (this.phase === 'auction' && this.discount !== null && card.n < this.discount) {
        this.addLog(`Plant ${card.n} is smaller than the discounted plant; it is removed along with the discount token.`);
        this.discount = null;
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
    this.step3NextRound = false;
    this.market = this.market.filter(isPlant);
    this.deck = this.shuffle(this.deck);
    this.addLog('Step 3 has begun: all plants in the market can be bought, and 3 houses fit in each city.');
  }

  resolvePendingStep3() {
    if (!this.step3Pending) return;
    this.market = this.market.filter(isPlant);
    this.sortMarket();
    const lowest = this.market.shift();
    if (lowest) this.addLog(`Plant ${lowest.n} is removed for Step 3.`);
    this.beginStep3();
  }

  removePlant(plant, reason) {
    this.market = this.market.filter((p) => p !== plant);
    this.addLog(`Plant ${plant.n} ${reason}.`);
    this.drawIntoMarket();
  }

  removeLowestAndReplace(reason = 'is removed from the market') {
    this.sortMarket();
    const lowest = this.market.find(isPlant);
    if (lowest) this.removePlant(lowest, reason);
  }

  // ---------- phase 1: turn order ----------

  determineOrder() {
    const highest = (p) => Math.max(0, ...p.plants.map((x) => x.n));
    const humans = [...this.players]
      .sort((a, b) => b.cities.length - a.cities.length || highest(b) - highest(a))
      .map((p) => p.id);
    this.order = this.trust ? [humans[0], TRUST.id, humans[1]] : humans;
  }

  // ---------- phase 2: auction ----------

  startAuctionPhase() {
    this.phase = 'auction';
    this.auction = {
      queue: this.humanOrder(), // players who may still start an auction
      current: null,
      pendingDiscard: null,
      justBought: null,
      trustTook: !this.trust,
    };
    const smallest = this.actualMarket()[0];
    this.discount = smallest ? smallest.n : null;
  }

  auctionChooser() {
    return this.auction.queue[0] ?? null;
  }

  minimumBid(plant) {
    return plant.n === this.discount ? 1 : plant.n;
  }

  startAuction(playerId, plantN, bid) {
    const a = this.auction;
    check(this.phase === 'auction' && !a.current && !a.pendingDiscard, 'You cannot start an auction now');
    check(this.auctionChooser() === playerId, 'It is not your turn to choose a plant');
    const plant = this.actualMarket().find((p) => p.n === plantN);
    check(plant, 'That plant is not available to buy');
    const min = this.minimumBid(plant);
    check(Number.isInteger(bid) && bid >= min, `Opening bid must be at least ${min}`);
    check(bid <= this.player(playerId).money, 'You cannot afford that bid');

    const bidders = a.queue.filter((id) => id === playerId || this.player(id).money > bid);
    a.current = { plant: plant.n, bid, high: playerId, bidders, turn: null };
    this.addLog(`${this.player(playerId).name} opens an auction for plant ${plant.n} at ${bid}.`);
    this.advanceBidTurn();
  }

  advanceBidTurn() {
    const c = this.auction.current;
    if (c.bidders.length === 1) return this.finishAuction();
    const idx = c.bidders.indexOf(c.turn ?? c.high);
    c.turn = c.bidders[(idx + 1) % c.bidders.length];
    if (c.turn === c.high) return this.finishAuction();
  }

  bid(playerId, amount) {
    const c = this.auction?.current;
    check(this.phase === 'auction' && c && c.turn === playerId, 'It is not your turn to bid');
    check(Number.isInteger(amount) && amount > c.bid, `Bid must be more than ${c.bid}`);
    check(amount <= this.player(playerId).money, 'You cannot afford that bid');
    c.bid = amount;
    c.high = playerId;
    this.addLog(`${this.player(playerId).name} bids ${amount}.`);
    this.advanceBidTurn();
  }

  passBid(playerId) {
    const c = this.auction?.current;
    check(this.phase === 'auction' && c && c.turn === playerId, 'It is not your turn to bid');
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
    if (plant.n === this.discount) this.discount = null;
    winner.plants.push(plant);
    winner.plants.sort(byNumber);
    this.auction.current = null;
    this.auction.queue = this.auction.queue.filter((id) => id !== winner.id);
    this.addLog(`${winner.name} buys plant ${plant.n} for ${c.bid}.`);
    // Rulebook p. 7, Germany map: buying plant 39 ends uranium resupply.
    if (this.map.id === 'germany' && plant.n === 39 && !this.uraniumPhaseOut) {
      this.uraniumPhaseOut = true;
      this.addLog('Nuclear phase-out: uranium will no longer be resupplied.');
    }
    this.drawIntoMarket();

    if (winner.plants.length > this.rules.maxPlants) {
      this.auction.pendingDiscard = winner.id;
      this.auction.justBought = plant.n;
      return;
    }
    this.afterAuctionStep();
  }

  discardPlant(playerId, plantN) {
    check(this.phase === 'auction' && this.auction.pendingDiscard === playerId, 'You do not need to scrap a plant');
    const p = this.player(playerId);
    const plant = p.plants.find((x) => x.n === plantN);
    check(plant, 'You do not own that plant');
    check(plantN !== this.auction.justBought, 'Scrap one of your older plants, not the one you just bought');
    p.plants = p.plants.filter((x) => x !== plant);
    this.trimResources(p);
    this.auction.pendingDiscard = null;
    this.auction.justBought = null;
    this.addLog(`${p.name} scraps plant ${plantN}.`);
    this.afterAuctionStep();
  }

  passAuction(playerId) {
    const a = this.auction;
    check(this.phase === 'auction' && !a.current && !a.pendingDiscard, 'You cannot pass now');
    check(this.auctionChooser() === playerId, 'It is not your turn');
    check(this.round > 1 || this.player(playerId).quit, 'Everyone must buy a plant in the first round');
    a.queue.shift();
    this.addLog(`${this.player(playerId).name} passes on buying a plant.`);
    this.afterAuctionStep();
  }

  afterAuctionStep() {
    if (!this.auction.trustTook) this.trustTakePlant();
    if (this.auction.queue.length) return;

    if (this.discount !== null) {
      const plant = this.market.find((p) => p.n === this.discount);
      this.discount = null;
      if (plant) this.removePlant(plant, 'had the discount token and nobody bought it, so it is removed');
    }
    this.resolvePendingStep3();
    if (this.round === 1) this.determineOrder();
    this.startTurnPhase('resources');
  }

  // Rulebook p. 9: after the first purchase (or the first player opting out),
  // the Trust takes the biggest plant in the current market for free.
  trustTakePlant() {
    this.auction.trustTook = true;
    const t = this.trust;
    const biggest = this.actualMarket().at(-1);
    if (!biggest) return;
    if (t.plants.length >= 3) {
      if (biggest.n <= t.plants[0].n) {
        this.addLog(`The Trust does not take a plant (plant ${biggest.n} is not bigger than its smallest).`);
        return;
      }
      const scrapped = t.plants.shift();
      this.addLog(`The Trust scraps plant ${scrapped.n}.`);
    }
    if (biggest.n === this.discount) this.discount = null;
    this.market = this.market.filter((p) => p !== biggest);
    t.plants.push(biggest);
    t.plants.sort(byNumber);
    this.addLog(`The Trust takes plant ${biggest.n}.`);
    this.drawIntoMarket();
  }

  // Excess resources go back to the supply when storage shrinks.
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

  // ---------- phases 3 & 4: reverse player order ----------

  startTurnPhase(phase) {
    this.phase = phase;
    const order = phase === 'build' ? this.humanOrder() : this.order;
    this.turnQueue = [...order].reverse();
    this.builtThisTurn = [];
    this.runAutomaticTurns();
  }

  runAutomaticTurns() {
    while (this.turnQueue[0] === TRUST.id) {
      this.trustTakeResources();
      this.turnQueue.shift();
    }
    if (!this.turnQueue.length) {
      if (this.phase === 'resources') this.startTurnPhase('build');
      else if (this.phase === 'build') this.startBureaucracy();
    }
  }

  currentTurn() {
    return this.turnQueue?.[0] ?? null;
  }

  // The Trust takes what its plants need for one firing, free of charge.
  trustTakeResources() {
    const t = this.trust;
    const taken = emptyRes();
    const take = (r) => {
      if (this.resMarket[r] <= 0) return false;
      this.resMarket[r]--;
      t.res[r]++;
      taken[r]++;
      return true;
    };
    for (const plant of t.plants) {
      if (plant.type === 'eco') continue;
      for (let i = 0; i < plant.input; i++) {
        if (plant.type !== 'hybrid') take(plant.type);
        else if (!take(i % 2 === 0 ? 'coal' : 'oil')) take(i % 2 === 0 ? 'oil' : 'coal');
      }
    }
    const list = RES_TYPES.filter((r) => taken[r]).map((r) => `${taken[r]} ${r}`);
    this.addLog(list.length ? `The Trust takes ${list.join(', ')}.` : 'The Trust takes no resources.');
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
    this.runAutomaticTurns();
  }

  // Cheapest connection from the player's network to `target`, travelling
  // only through cities in the playing zone.
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
      for (const { city, cost } of this.neighbors[best] || []) {
        if (!this.activeCities.has(city)) continue;
        const nd = dist.get(best) + cost;
        if (!dist.has(city) || nd < dist.get(city)) dist.set(city, nd);
      }
    }
  }

  quoteBuild(playerId, cityId) {
    const p = this.player(playerId);
    check(this.activeCities.has(cityId), 'That city is not in the playing zone');
    const slots = this.citySlots[cityId];
    check(!slots.includes(playerId), 'You already have a house there');
    let slot = -1;
    for (let i = 0; i < this.step; i++) {
      if (slots[i] === null) {
        slot = i;
        break;
      }
    }
    check(slot >= 0, `${this.cityName(cityId)} has no free space during Step ${this.step}`);
    const connection = this.connectionCost(p, cityId);
    return { slot, connection, building: CITY_SLOT_COST[slot], total: connection + CITY_SLOT_COST[slot] };
  }

  build(playerId, cityId) {
    check(this.phase === 'build' && this.currentTurn() === playerId, 'It is not your turn to build');
    const p = this.player(playerId);
    const q = this.quoteBuild(playerId, cityId);
    check(q.total <= p.money, 'You cannot afford that city');
    p.money -= q.total;
    p.cities.push(cityId);
    this.citySlots[cityId][q.slot] = playerId;
    this.builtThisTurn.push(cityId);
    this.addLog(`${p.name} builds in ${this.cityName(cityId)} for ${q.total}.`);
    // Rulebook p. 10: connecting an empty city puts a Trust house on its 15 space.
    if (this.trust && q.slot === 0 && this.trust.housesLeft > 0) {
      this.citySlots[cityId][1] = TRUST.id;
      this.trust.cities.push(cityId);
      this.trust.housesLeft--;
      this.addLog(`The Trust also moves into ${this.cityName(cityId)}.`);
    }
  }

  endBuild(playerId) {
    check(this.phase === 'build' && this.currentTurn() === playerId, 'It is not your turn');
    if (!this.builtThisTurn.length) this.addLog(`${this.player(playerId).name} builds nothing.`);
    this.builtThisTurn = [];
    this.turnQueue.shift();
    this.runAutomaticTurns();
  }

  // ---------- phase 5: bureaucracy ----------

  startBureaucracy() {
    this.phase = 'bureaucracy';
    this.powerChoices = {};
    if (this.maxCities() >= this.rules.endCities) {
      this.endTriggered = true;
      this.addLog('A network has reached the end-game size. This is the final Bureaucracy!');
    }
    if (this.step === 1 && this.maxCities() >= this.rules.step2Cities) {
      this.step = 2;
      this.addLog('Step 2 has begun: 2 houses fit in each city.');
      this.removeLowestAndReplace('is removed for Step 2');
    }
  }

  // Resources burned to fire `plantNs`; hybrids burn coal first unless the
  // player names how much coal each hybrid should use.
  firingPlan(p, plantNs, hybridCoal = {}) {
    check(Array.isArray(plantNs) && new Set(plantNs).size === plantNs.length, 'Invalid plant list');
    const use = emptyRes();
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
      const wanted = hybridCoal?.[h.n];
      const coal = Number.isInteger(wanted)
        ? Math.max(0, Math.min(h.input, wanted))
        : Math.min(h.input, Math.max(0, p.res.coal - use.coal));
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
    if (this.trust) this.trust.res = emptyRes(); // back to the supply
    if (this.endTriggered) return this.finishGame();

    this.resupply();
    if (!this.step3NextRound) this.updateMarketEndOfRound();
    if (this.step3NextRound) this.beginStep3();
    this.round++;
    this.determineOrder();
    this.startAuctionPhase();
  }

  resupply() {
    const table = RESUPPLY[this.players.length];
    const holders = this.trust ? [...this.players, this.trust] : this.players;
    for (const r of RES_TYPES) {
      if (r === 'uranium' && this.uraniumPhaseOut) continue;
      const held = holders.reduce((s, p) => s + p.res[r], 0);
      const bank = RES_TOTAL[r] - held - this.resMarket[r];
      const room = SLOT_PRICES[r].length - this.resMarket[r];
      this.resMarket[r] += Math.max(0, Math.min(table[r][this.step - 1], bank, room));
    }
  }

  updateMarketEndOfRound() {
    this.sortMarket();
    if (this.step === 3) {
      this.removeLowestAndReplace();
    } else {
      this.deck.push(this.market.pop());
      this.drawIntoMarket();
    }
  }

  finishGame(reason = null) {
    const ranked = [...this.players].sort(
      (a, b) => a.quit - b.quit || b.lastPowered - a.lastPowered || b.money - a.money || b.cities.length - a.cities.length,
    );
    this.phase = 'gameover';
    this.winner = ranked[0].id;
    this.ranking = ranked.map((p) => p.id);
    this.addLog(reason || `${ranked[0].name} wins by powering ${ranked[0].lastPowered} cities!`);
  }

  // ---------- quitting ----------

  // A player who leaves mid-game stays in the game as a seat that always
  // passes, so the others can keep playing.
  resign(playerId) {
    const p = this.player(playerId);
    if (p.quit || this.phase === 'gameover') return;
    p.quit = true;
    this.addLog(`${p.name} has left the game.`);
    const left = this.players.filter((x) => !x.quit);
    if (left.length <= 1) {
      const last = left[0];
      return this.finishGame(last ? `${last.name} wins: everyone else has left.` : 'Everyone has left the game.');
    }
    this.autoplay();
  }

  // Take the default action for every quit player the game is waiting on.
  autoplay() {
    for (let guard = 0; guard < 500 && this.phase !== 'gameover'; guard++) {
      const id = this.waitingOn().find((x) => this.player(x).quit);
      if (!id) return;
      const p = this.player(id);
      switch (this.phase) {
        case 'trustSetup': {
          const city = [...this.activeCities].find((c) => {
            if (this.citySlots[c][0]) return false;
            return !this.trust.cities.length || this.neighbors[c].some((n) => this.trust.cities.includes(n.city));
          });
          this.placeTrust(id, city);
          break;
        }
        case 'auction':
          if (this.auction.pendingDiscard === id) this.discardPlant(id, p.plants.find((x) => x.n !== this.auction.justBought).n);
          else if (this.auction.current) this.passBid(id);
          else this.passAuction(id);
          break;
        case 'resources': this.buyResources(id, {}); break;
        case 'build': this.endBuild(id); break;
        case 'bureaucracy': this.power(id, [], {}); break;
        default: return;
      }
    }
  }

  // ---------- dispatch & serialisation ----------

  apply(playerId, action) {
    check(this.phase !== 'gameover', 'The game is over');
    check(action && typeof action.type === 'string', 'Invalid action');
    check(!this.player(playerId).quit, 'You have left this game');
    try {
      this.dispatch(playerId, action);
    } finally {
      this.autoplay();
    }
  }

  dispatch(playerId, action) {
    switch (action.type) {
      case 'placeTrust': return this.placeTrust(playerId, action.city);
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
      case 'trustSetup':
        return [this.trustSetupQueue[0]];
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
    const actual = new Set(this.actualMarket());
    return {
      mapId: this.map.id,
      round: this.round,
      step: this.step,
      phase: this.phase,
      order: this.order,
      regions: this.regions,
      activeCities: [...this.activeCities],
      rules: this.rules,
      players: this.players.map((p) => ({ ...p, plants: [...p.plants], res: { ...p.res }, cities: [...p.cities] })),
      trust: this.trust ? { ...this.trust, plants: [...this.trust.plants], res: { ...this.trust.res }, cities: [...this.trust.cities] } : null,
      market: this.market.map((p) => ({ ...p, buyable: actual.has(p), minBid: isPlant(p) ? this.minimumBid(p) : null })),
      discount: this.phase === 'auction' ? this.discount : null,
      deckSize: this.deck.length,
      step3Pending: this.step3Pending,
      uraniumPhaseOut: this.uraniumPhaseOut,
      resMarket: { ...this.resMarket },
      citySlots: this.citySlots,
      trustSetupQueue: this.phase === 'trustSetup' ? this.trustSetupQueue : [],
      auction: this.phase === 'auction' ? {
        chooser: this.auctionChooser(),
        queue: this.auction.queue,
        current: this.auction.current,
        pendingDiscard: this.auction.pendingDiscard,
        justBought: this.auction.justBought,
      } : null,
      turnQueue: this.phase === 'resources' || this.phase === 'build' ? this.turnQueue : [],
      builtThisTurn: this.phase === 'build' ? this.builtThisTurn : [],
      powered: this.phase === 'bureaucracy' ? Object.keys(this.powerChoices) : [],
      waitingOn: this.waitingOn(),
      endTriggered: this.endTriggered,
      winner: this.winner,
      ranking: this.ranking || null,
      log: this.log.slice(-80),
    };
  }
}
