import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, GameError, resourceCost, canStore } from '../server/game/engine.js';
import { RES_TOTAL, RES_TYPES, PLANTS } from '../server/game/data.js';

const makePlayers = (n) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
const plant = (n) => ({ ...PLANTS.find((p) => p.n === n) });

// Build a game and force a known market so tests do not depend on shuffling.
function gameWithMarket(players, marketNs, opts = {}) {
  const g = new Game(makePlayers(players), { seed: 1, ...opts });
  g.market = marketNs.map(plant);
  if (g.phase === 'auction') g.startAuctionPhase();
  return g;
}

test('resource prices take the cheapest units first', () => {
  assert.equal(resourceCost('coal', 24, 3), 3);
  assert.equal(resourceCost('coal', 24, 4), 5);
  assert.equal(resourceCost('oil', 18, 2), 6); // oil starts at 3
  assert.equal(resourceCost('garbage', 9, 1), 6); // garbage starts at 6
  assert.equal(resourceCost('uranium', 2, 1), 14);
  assert.equal(resourceCost('uranium', 2, 3), null);
});

test('storage allows double capacity and shares hybrid space', () => {
  const plants = [plant(4), plant(5)]; // coal 2, hybrid 2
  assert.ok(canStore(plants, { coal: 8, oil: 0, garbage: 0, uranium: 0 }));
  assert.ok(canStore(plants, { coal: 4, oil: 4, garbage: 0, uranium: 0 }));
  assert.ok(!canStore(plants, { coal: 4, oil: 5, garbage: 0, uranium: 0 }));
  assert.ok(!canStore(plants, { coal: 9, oil: 0, garbage: 0, uranium: 0 }));
  assert.ok(!canStore(plants, { coal: 0, oil: 0, garbage: 1, uranium: 0 }));
});

test('setup follows the Recharged rules for each player count', () => {
  // top plug card + remaining plugs + remaining sockets + Step 3 card
  const expectedDeck = { 2: 1 + 3 + 24 + 1, 3: 1 + 2 + 23 + 1, 4: 1 + 3 + 26 + 1, 5: 1 + 4 + 29 + 1, 6: 1 + 4 + 29 + 1 };
  for (let n = 2; n <= 6; n++) {
    const g = new Game(makePlayers(n), { seed: n });
    assert.equal(g.market.length, 8);
    assert.ok(g.market.every((p) => p.n <= 15), 'market drawn from plants 03-15');
    assert.deepEqual(g.market.map((p) => p.n), [...g.market.map((p) => p.n)].sort((a, b) => a - b));
    assert.ok(g.deck[0].n <= 15, 'a plug plant sits on top of the stack');
    assert.equal(g.deck.at(-1).type, 'step3');
    assert.equal(g.deck.length, expectedDeck[n]);
    assert.equal(g.regions.length, { 2: 3, 3: 3, 4: 4, 5: 5, 6: 5 }[n]);
    assert.deepEqual(g.resMarket, { coal: 24, oil: 18, garbage: 9, uranium: 2 });
    assert.ok(g.players.every((p) => p.money === 50));
  }
});

test('the smallest plant is discounted to 1 and removed if nobody buys it', () => {
  const g = gameWithMarket(3, [3, 4, 5, 6, 7, 8, 9, 10]);
  g.round = 2; // allow passing
  g.deck.unshift(plant(20));
  const [a, b, c] = g.order;
  assert.equal(g.discount, 3);
  assert.throws(() => g.apply(a, { type: 'startAuction', plant: 4, bid: 1 }), /at least 4/);
  g.apply(a, { type: 'passAuction' });
  g.apply(b, { type: 'passAuction' });
  g.apply(c, { type: 'passAuction' });
  assert.ok(!g.market.some((p) => p.n === 3), 'discounted plant removed');
  assert.ok(g.market.some((p) => p.n === 20), 'replacement drawn');
  assert.equal(g.phase, 'resources');
});

test('a replacement smaller than the discounted plant is removed with the token', () => {
  const g = gameWithMarket(3, [8, 9, 10, 11, 12, 13, 14, 15]);
  g.deck.unshift(plant(4), plant(30));
  const [a, b, c] = g.order;
  g.apply(a, { type: 'startAuction', plant: 9, bid: 9 });
  g.apply(b, { type: 'passBid' });
  g.apply(c, { type: 'passBid' });
  assert.equal(g.discount, null);
  assert.ok(!g.market.some((p) => p.n === 4));
  assert.ok(g.market.some((p) => p.n === 30));
  // The formerly discounted plant can still be bought, now at full price.
  assert.throws(() => g.apply(b, { type: 'startAuction', plant: 8, bid: 1 }), /at least 8/);
});

test('everyone must buy a plant in round one and the auction runs in order', () => {
  const g = gameWithMarket(3, [3, 4, 5, 6, 7, 8, 9, 10]);
  g.deck.unshift(plant(13));
  const [a, b, c] = g.order;
  assert.throws(() => g.apply(a, { type: 'passAuction' }), GameError);
  assert.throws(() => g.apply(b, { type: 'startAuction', plant: 4, bid: 4 }), GameError);
  assert.throws(() => g.apply(a, { type: 'startAuction', plant: 7, bid: 7 }), /not available/);

  g.apply(a, { type: 'startAuction', plant: 4, bid: 4 });
  g.apply(b, { type: 'bid', amount: 5 });
  g.apply(c, { type: 'passBid' });
  g.apply(a, { type: 'passBid' });
  assert.equal(g.player(b).plants[0].n, 4);
  assert.equal(g.player(b).money, 45);
  assert.equal(g.auction.queue[0], a, 'a chooses again because they did not win');
  assert.equal(g.market.length, 8);
  assert.equal(g.market.at(-1).n, 13);
});

test('building pays connection plus space cost, including zero-cost links', () => {
  const g = gameWithMarket(3, [3, 4, 5, 6, 7, 8, 9, 10], { mapId: 'germany', regions: ['red', 'blue', 'yellow'] });
  g.deck.unshift(plant(20), plant(21), plant(22));
  const [a, b, c] = g.order;
  g.apply(a, { type: 'startAuction', plant: 4, bid: 4 });
  g.apply(b, { type: 'passBid' });
  g.apply(c, { type: 'passBid' });
  g.apply(b, { type: 'startAuction', plant: 5, bid: 5 });
  g.apply(c, { type: 'passBid' });
  g.apply(c, { type: 'startAuction', plant: 6, bid: 6 });
  for (let i = 0; i < 3; i++) g.apply(g.currentTurn(), { type: 'buyResources', order: {} });
  assert.equal(g.phase, 'build');

  const builder = g.currentTurn();
  const other = g.turnQueue[1];
  const start = g.player(builder).money;
  g.apply(builder, { type: 'build', city: 'essen' });
  g.apply(builder, { type: 'build', city: 'duisburg' }); // 0 connection
  g.apply(builder, { type: 'build', city: 'dortmund' }); // 5 connection
  assert.equal(g.player(builder).money, start - 10 - 10 - 15);
  assert.throws(() => g.apply(builder, { type: 'build', city: 'hamburg' }), /playing zone/);
  g.apply(builder, { type: 'endBuild' });
  assert.throws(() => g.apply(other, { type: 'build', city: 'essen' }), /no free space/);
});

test('2 players play against the Trust', () => {
  const g = new Game(makePlayers(2), { seed: 1, mapId: 'germany', regions: ['red', 'blue', 'yellow'] });
  const [a, trust, b] = g.order;
  assert.equal(trust, 'trust');
  assert.equal(g.phase, 'trustSetup');
  assert.deepEqual(g.trustSetupQueue, [a, b, b, a, a, b]);

  g.apply(a, { type: 'placeTrust', city: 'kassel' });
  assert.throws(() => g.apply(b, { type: 'placeTrust', city: 'aachen' }), /next to/);
  for (const [who, city] of [[b, 'fulda'], [b, 'erfurt'], [a, 'dortmund'], [a, 'frankfurt-m'], [b, 'mainz']]) {
    g.apply(who, { type: 'placeTrust', city });
  }
  assert.equal(g.phase, 'auction');
  assert.equal(g.trust.housesLeft, 10);

  g.market = [3, 4, 5, 6, 7, 8, 9, 10].map(plant);
  g.deck.unshift(plant(13), plant(25));
  g.startAuctionPhase();
  g.apply(a, { type: 'startAuction', plant: 4, bid: 4 });
  g.apply(b, { type: 'passBid' });
  // Current market is now 3 5 6 7, so the Trust takes the biggest: 7.
  assert.deepEqual(g.trust.plants.map((p) => p.n), [7]);
  g.apply(b, { type: 'startAuction', plant: 3, bid: 1 }); // discounted
  assert.equal(g.player(b).money, 49);
  assert.deepEqual(g.trust.plants.map((p) => p.n), [7], 'the Trust only takes one plant per round');

  // Resources: reverse order, the Trust takes 3 oil for plant 7 on its turn.
  g.apply(g.currentTurn(), { type: 'buyResources', order: {} });
  assert.equal(g.trust.res.oil, 3);
  assert.equal(g.resMarket.oil, 15);
  g.apply(g.currentTurn(), { type: 'buyResources', order: {} });
  assert.equal(g.phase, 'build');

  const builder = g.currentTurn();
  assert.throws(() => g.apply(builder, { type: 'build', city: 'kassel' }), /no free space/);
  g.apply(builder, { type: 'build', city: 'koln' });
  assert.deepEqual(g.citySlots.koln, [builder, 'trust', null]);
  assert.equal(g.trust.housesLeft, 9);
});

test('drawing Step 3 during Bureaucracy starts Step 3 next round', () => {
  const g = gameWithMarket(3, [3, 4, 5, 6, 7, 8, 9, 10]);
  g.phase = 'bureaucracy';
  g.powerChoices = {};
  g.deck = [{ n: 99, type: 'step3', input: 0, output: 0 }];
  for (const p of g.players) g.apply(p.id, { type: 'power', plants: [] });
  assert.equal(g.step, 3);
  assert.deepEqual(g.market.map((p) => p.n), [4, 5, 6, 7, 8, 9]);
  assert.equal(g.phase, 'auction');
});

test('on the Germany map, buying plant 39 stops uranium resupply', () => {
  const g = gameWithMarket(3, [3, 4, 5, 6, 7, 8, 9, 39], { mapId: 'germany' });
  g.step = 3; // make 39 buyable
  g.market = [4, 5, 6, 7, 8, 39].map(plant);
  g.startAuctionPhase();
  const [a, b, c] = g.order;
  g.apply(a, { type: 'startAuction', plant: 39, bid: 39 });
  g.apply(b, { type: 'passBid' });
  g.apply(c, { type: 'passBid' });
  assert.ok(g.uraniumPhaseOut);
  const before = g.resMarket.uranium;
  g.resupply();
  assert.equal(g.resMarket.uranium, before);
});

// ---------- full-game simulation with simple bots ----------

function chooseAction(g, id) {
  const p = g.players.find((x) => x.id === id);
  const rand = () => g.rand();
  switch (g.phase) {
    case 'trustSetup': {
      const options = [...g.activeCities].filter((c) => {
        if (g.citySlots[c][0]) return false;
        return !g.trust.cities.length || g.neighbors[c].some((n) => g.trust.cities.includes(n.city));
      });
      return { type: 'placeTrust', city: options[Math.floor(rand() * options.length)] };
    }
    case 'auction': {
      const a = g.auction;
      if (a.pendingDiscard === id) {
        const victim = p.plants.find((x) => x.n !== a.justBought);
        return { type: 'discardPlant', plant: victim.n };
      }
      if (a.current) {
        const next = a.current.bid + 1 + Math.floor(rand() * 3);
        if (rand() < 0.3 && next <= p.money) return { type: 'bid', amount: next };
        return { type: 'passBid' };
      }
      const options = g.actualMarket().filter((x) => g.minimumBid(x) <= p.money);
      if (g.round > 1 && (!options.length || rand() < 0.4)) return { type: 'passAuction' };
      const pick = options[Math.floor(rand() * options.length)];
      return { type: 'startAuction', plant: pick.n, bid: g.minimumBid(pick) };
    }
    case 'resources': {
      const order = { coal: 0, oil: 0, garbage: 0, uranium: 0 };
      for (const pl of p.plants) {
        if (pl.type === 'eco') continue;
        const type = pl.type === 'hybrid' ? (rand() < 0.5 ? 'coal' : 'oil') : pl.type;
        order[type] += pl.input;
      }
      // Back off until the order is affordable, storable and available.
      for (let tries = 0; tries < 40; tries++) {
        try {
          const next = { ...p.res };
          for (const r of RES_TYPES) next[r] += order[r];
          if (canStore(p.plants, next) && g.quoteResources(order) <= p.money) break;
        } catch {}
        const r = RES_TYPES.find((x) => order[x] > 0);
        if (!r) break;
        order[r]--;
      }
      return { type: 'buyResources', order };
    }
    case 'build': {
      if (g.builtThisTurn.length < 3) {
        let best = null;
        for (const city of g.activeCities) {
          try {
            const q = g.quoteBuild(id, city);
            if (q.total <= p.money - 5 && (!best || q.total < best.total)) best = { city, total: q.total };
          } catch {}
        }
        if (best) return { type: 'build', city: best.city };
      }
      return { type: 'endBuild' };
    }
    case 'bureaucracy': {
      const fire = [];
      for (const pl of p.plants) {
        try {
          g.firingPlan(p, [...fire, pl.n]);
          fire.push(pl.n);
        } catch {}
      }
      return { type: 'power', plants: fire };
    }
    default:
      throw new Error(`unexpected phase ${g.phase}`);
  }
}

function checkInvariants(g) {
  const holders = g.trust ? [...g.players, g.trust] : g.players;
  for (const r of RES_TYPES) {
    const held = holders.reduce((s, p) => s + p.res[r], 0);
    assert.ok(held + g.resMarket[r] <= RES_TOTAL[r], `${r} conserved`);
    assert.ok(g.resMarket[r] >= 0);
  }
  for (const p of g.players) {
    assert.ok(p.money >= 0, 'money never negative');
    const discarding = g.auction?.pendingDiscard === p.id ? 1 : 0;
    assert.ok(p.plants.length <= g.rules.maxPlants + discarding, 'plant limit');
    assert.ok(canStore(p.plants, p.res), 'storage respected');
  }
  if (g.trust) assert.ok(g.trust.plants.length <= 3 && g.trust.housesLeft >= 0);
  for (const [city, slots] of Object.entries(g.citySlots)) {
    const people = slots.filter((s) => s && s !== 'trust');
    assert.equal(new Set(people).size, people.length, `no duplicate houses in ${city}`);
  }
  assert.ok(g.market.filter((p) => p.type === 'step3').length <= 1);
  if (g.step === 3) assert.ok(g.market.length <= 6);
}

test('bots can play complete games for every player count on both maps', () => {
  let finished = 0;
  let reachedStep3 = 0;
  let games = 0;
  for (const mapId of ['germany', 'usa']) {
    for (let players = 2; players <= 6; players++) {
      for (let seed = 1; seed <= 25; seed++) {
        const g = new Game(makePlayers(players), { seed: seed * 7919 + players, mapId });
        games++;
        let guard = 0;
        while (g.phase !== 'gameover' && g.round < 80) {
          const [id] = g.waitingOn();
          g.apply(id, chooseAction(g, id));
          checkInvariants(g);
          assert.ok(++guard < 20000, 'game made progress');
        }
        // A game saved and restored mid-way must continue identically.
        if (seed % 5 === 0 && g.phase !== 'gameover') {
          const copy = Game.restore(JSON.parse(JSON.stringify(g.serialize())));
          assert.deepEqual(copy.publicState(), g.publicState());
          for (let k = 0; k < 30 && g.phase !== 'gameover'; k++) {
            const [id] = g.waitingOn();
            const action = chooseAction(g, id);
            g.apply(id, action);
            copy.apply(id, action);
          }
          assert.deepEqual(copy.publicState(), g.publicState(), 'restored game stays in sync');
        }
        if (g.phase === 'gameover') finished++;
        if (g.step === 3) reachedStep3++;
        const state = JSON.parse(JSON.stringify(g.publicState()));
        assert.equal(state.players.length, players);
      }
    }
  }
  console.log(`finished ${finished}/${games}, reached step 3 in ${reachedStep3}/${games}`);
  assert.ok(finished > games * 0.75, `most games finish (${finished}/${games})`);
  assert.ok(reachedStep3 > games * 0.25, `step 3 is reached (${reachedStep3}/${games})`);
});
