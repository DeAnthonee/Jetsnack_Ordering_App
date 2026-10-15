import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, GameError } from '../server/game/engine.js';
import { chooseAction, safeAction } from '../server/game/bot.js';
import { RoomManager } from '../server/rooms.js';

const makePlayers = (n) => Array.from({ length: n }, (_, i) => ({ id: `b${i}`, name: `Bot${i}` }));

function playOut(g) {
  let guard = 0;
  let fallbacks = 0;
  while (g.phase !== 'gameover') {
    const [id] = g.waitingOn();
    try {
      g.apply(id, chooseAction(g, id));
    } catch (err) {
      if (!(err instanceof GameError)) throw err;
      fallbacks++;
      g.apply(id, safeAction(g, id));
    }
    assert.ok(++guard < 20000, 'game makes progress');
  }
  return fallbacks;
}

test('bots finish games on every map and player count, and play sensibly', () => {
  let games = 0;
  let totalRounds = 0;
  let fallbacks = 0;
  for (const mapId of ['germany', 'usa', 'heroverse']) {
    for (let players = 2; players <= 6; players++) {
      for (let seed = 1; seed <= 6; seed++) {
        const g = new Game(makePlayers(players), { seed: seed * 104729 + players, mapId });
        fallbacks += playOut(g);
        games++;
        totalRounds += g.round;
        const winner = g.player(g.winner);
        assert.ok(winner.lastPowered >= 7, `winner powers a real network (${winner.lastPowered})`);
        assert.ok(g.round <= 40, `game ends in reasonable time (${g.round} rounds)`);
        for (const p of g.players) assert.ok(p.plants.length >= 1, 'every bot ends with plants');
      }
    }
  }
  console.log(`bot games: ${games}, avg rounds ${(totalRounds / games).toFixed(1)}, rule fallbacks ${fallbacks}`);
  assert.ok(fallbacks < games, 'bots rarely need the safe fallback');
});

test('the host can add and remove computer players, and they take their turns', () => {
  const m = new RoomManager();
  const { room, seat: host } = m.create('Anna');
  const b1 = m.addBot(room, host.id);
  const b2 = m.addBot(room, host.id);
  assert.deepEqual(room.players.map((p) => p.name), ['Anna', 'Tesla', 'Edison']);
  assert.throws(() => m.removeBot(room, host.id, host.id), /not a computer player/);
  m.removeBot(room, host.id, b2.id);
  const b3 = m.addBot(room, host.id);
  assert.equal(b3.name, 'Edison', 'freed names are reused');

  m.start(room, host.id);
  const g = room.game;
  // Bots act until it is the human's turn.
  m.runBots(room);
  assert.equal(m.pendingBot(room), null);
  assert.ok(g.waitingOn().includes(host.id));

  // Play the human's turns minimally; bots fill in the rest of the round.
  let guard = 0;
  while (g.round === 1 && g.phase !== 'gameover' && guard++ < 50) {
    const action = safeAction(g, host.id);
    if (g.phase === 'auction' && g.round === 1 && !g.auction.current && g.auction.pendingDiscard !== host.id) {
      const plant = g.actualMarket()[0];
      g.apply(host.id, { type: 'startAuction', plant: plant.n, bid: g.minimumBid(plant) });
    } else {
      g.apply(host.id, action);
    }
    m.runBots(room);
  }
  assert.equal(g.round, 2, 'a full round completed with bots filling their turns');
  assert.ok(g.player(b1.id).plants.length >= 1, 'the bot bought a plant in round 1');

  // When the last human leaves, the room goes away rather than living on with bots.
  m.leave(room, host.id);
  assert.throws(() => m.get(room.code), /not found/);
});

test('a human plus one bot plays the Trust variant', () => {
  const m = new RoomManager();
  const { room, seat: host } = m.create('Anna');
  m.addBot(room, host.id);
  m.start(room, host.id);
  assert.ok(room.game.trust);
  m.runBots(room);
  assert.ok(room.game.waitingOn().includes(host.id));
});
