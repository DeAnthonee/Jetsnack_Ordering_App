import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, GameError, resourceCost, canStore } from '../server/game/engine.js';
import { RES_TOTAL, RES_TYPES } from '../server/game/data.js';

const makePlayers = (n) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
const plant = (n, type, input, output) => ({ n, type, input, output });

test('resource prices take the cheapest units first', () => {
  assert.equal(resourceCost('coal', 24, 3), 3);
  assert.equal(resourceCost('coal', 24, 4), 5);
  assert.equal(resourceCost('oil', 18, 2), 6); // oil starts at 3
  assert.equal(resourceCost('uranium', 2, 1), 14);
  assert.equal(resourceCost('uranium', 2, 3), null);
});

test('storage allows double capacity and shares hybrid space', () => {
  const plants = [plant(4, 'coal', 2, 1), plant(5, 'hybrid', 2, 1)];
  assert.ok(canStore(plants, { coal: 8, oil: 0, garbage: 0, uranium: 0 }));
  assert.ok(canStore(plants, { coal: 4, oil: 4, garbage: 0, uranium: 0 }));
  assert.ok(!canStore(plants, { coal: 4, oil: 5, garbage: 0, uranium: 0 }));
  assert.ok(!canStore(plants, { coal: 9, oil: 0, garbage: 0, uranium: 0 }));
  assert.ok(!canStore(plants, { coal: 0, oil: 0, garbage: 1, uranium: 0 }));
});

test('setup follows player-count rules', () => {
  const g = new Game(makePlayers(4), { seed: 1 });
  assert.equal(g.regions.length, 4);
  assert.deepEqual(g.market.map((p) => p.n), [3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(g.deck[0].n, 13);
  assert.equal(g.deck.at(-1).type, 'step3');
  assert.equal(g.deck.length, 42 - 8 - 4 + 1); // plants 11-50, minus 4 removed, plus the Step 3 card
  assert.ok(g.players.every((p) => p.money === 50));
});

test('everyone must buy a plant in round one and the auction runs in order', () => {
  const g = new Game(makePlayers(3), { seed: 2 });
  const [a, b, c] = g.order;
  assert.throws(() => g.apply(a, { type: 'passAuction' }), GameError);
  assert.throws(() => g.apply(b, { type: 'startAuction', plant: 3, bid: 3 }), GameError);
  assert.throws(() => g.apply(a, { type: 'startAuction', plant: 7, bid: 7 }), /not available/);

  g.apply(a, { type: 'startAuction', plant: 3, bid: 3 });
  g.apply(b, { type: 'bid', amount: 4 });
  g.apply(c, { type: 'passBid' });
  g.apply(a, { type: 'passBid' });
  assert.equal(g.player(b).plants[0].n, 3);
  assert.equal(g.player(b).money, 46);
  // a still chooses next because they did not win
  assert.equal(g.auction.queue[0], a);
  assert.equal(g.market.length, 8);
  assert.equal(g.market.at(-1).n, 13);
});

test('building costs connection plus slot, and Step 1 allows one house per city', () => {
  const g = new Game(makePlayers(2), { seed: 3, regions: ['ne', 'central', 'se'] });
  const [first, second] = g.order;
  g.apply(first, { type: 'startAuction', plant: 4, bid: 4 });
  g.apply(second, { type: 'passBid' });
  g.apply(second, { type: 'startAuction', plant: 3, bid: 3 });
  const buyFirst = g.currentTurn();
  g.apply(buyFirst, { type: 'buyResources', order: {} });
  g.apply(g.currentTurn(), { type: 'buyResources', order: {} });
  assert.equal(g.phase, 'build');

  const builder = g.currentTurn();
  const other = g.players.find((p) => p.id !== builder).id;
  const before = g.player(builder).money;
  g.apply(builder, { type: 'build', city: 'new-york' });
  assert.equal(g.player(builder).money, before - 10);
  g.apply(builder, { type: 'build', city: 'boston' });
  assert.equal(g.player(builder).money, before - 10 - 15); // 5 connection + 10
  assert.throws(() => g.apply(builder, { type: 'build', city: 'seattle' }), /not in play/);
  g.apply(builder, { type: 'endBuild' });
  assert.throws(() => g.apply(other, { type: 'build', city: 'new-york' }), /house/);
});

test('plants removed from a scrapped plant spill back to the bank', () => {
  const g = new Game(makePlayers(3), { seed: 4 });
  const p = g.players[0];
  p.plants = [plant(4, 'coal', 2, 1), plant(8, 'coal', 3, 2)];
  p.res.coal = 10;
  p.plants = p.plants.slice(1);
  g.trimResources(p);
  assert.equal(p.res.coal, 6);
});

// ---------- full-game simulation with simple bots ----------

function chooseAction(g, id) {
  const p = g.player(id);
  const rand = g.rand;
  switch (g.phase) {
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
      const options = g.actualMarket().filter((x) => x.type !== 'step3' && x.n <= p.money);
      if (!options.length || (g.round > 1 && rand() < 0.4)) {
        if (g.round > 1) return { type: 'passAuction' };
      }
      const pick = options[Math.floor(rand() * options.length)];
      return { type: 'startAuction', plant: pick.n, bid: pick.n };
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
        const r = RES_TYPES.filter((x) => order[x] > 0)[0];
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
  for (const r of RES_TYPES) {
    const held = g.players.reduce((s, p) => s + p.res[r], 0);
    assert.ok(held + g.resMarket[r] <= RES_TOTAL[r], `${r} conserved`);
    assert.ok(g.resMarket[r] >= 0);
  }
  for (const p of g.players) {
    assert.ok(p.money >= 0, 'money never negative');
    const discarding = g.auction?.pendingDiscard === p.id ? 1 : 0;
    assert.ok(p.plants.length <= g.rules.maxPlants + discarding, 'plant limit');
    assert.ok(canStore(p.plants, p.res), 'storage respected');
  }
  for (const [city, owners] of Object.entries(g.cityOwners)) {
    assert.ok(owners.length <= g.step, `slots in ${city}`);
  }
  assert.ok(g.market.filter((p) => p.type === 'step3').length <= 1);
  if (g.step === 3) assert.ok(g.market.length <= 6);
}

test('bots can play complete games for every player count', () => {
  let finished = 0;
  let reachedStep3 = 0;
  for (let players = 2; players <= 6; players++) {
    for (let seed = 1; seed <= 40; seed++) {
      const g = new Game(makePlayers(players), { seed: seed * 7919 + players });
      let guard = 0;
      while (g.phase !== 'gameover' && g.round < 80) {
        const [id] = g.waitingOn();
        g.apply(id, chooseAction(g, id));
        checkInvariants(g);
        assert.ok(++guard < 20000, 'game made progress');
      }
      if (g.phase === 'gameover') finished++;
      if (g.step === 3) reachedStep3++;
      const state = JSON.parse(JSON.stringify(g.publicState()));
      assert.ok(state.players.length === players);
    }
  }
  console.log(`finished ${finished}/200, step3 ${reachedStep3}/200`);
  assert.ok(finished > 150, `most games finish (${finished}/200)`);
  assert.ok(reachedStep3 > 50, `step 3 is reached (${reachedStep3}/200)`);
});
