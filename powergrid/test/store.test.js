import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { RoomManager } from '../server/rooms.js';

test('lobbies and games survive a restart through the save file', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'pg-'));
  const file = path.join(dir, 'rooms.json');
  try {
    const a = new RoomManager({ file });
    const { room, seat } = a.create('Anna');
    const bob = a.join(room.code, 'Bob');
    const cleo = a.join(room.code, 'Cleo');
    a.start(room, seat.id);
    const first = room.game.waitingOn()[0];
    const plant = room.game.actualMarket()[0];
    a.act(room, first, { type: 'startAuction', plant: plant.n, bid: room.game.minimumBid(plant) });
    a.store.save(a.rooms); // what the debounce timer would do

    const saved = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(saved.rooms.length, 1);
    assert.ok(saved.rooms[0].players.every((p) => p.token), 'rejoin tokens are kept');

    const b = new RoomManager({ file });
    const restored = b.get(room.code);
    assert.deepEqual(restored.game.publicState(), room.game.publicState());
    assert.ok(restored.players.every((p) => p.connected === false));
    const back = b.rejoin(room.code, bob.token);
    assert.equal(back.seat.name, 'Bob');
    assert.equal(b.rejoin(room.code, cleo.token).seat.id, cleo.id);

    // The restored game keeps playing with the same shuffle sequence.
    const bidder = restored.game.waitingOn()[0];
    b.act(restored, bidder, { type: 'passBid' });
    a.act(room, bidder, { type: 'passBid' });
    assert.deepEqual(restored.game.publicState(), room.game.publicState());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a missing or corrupt save file starts empty', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'pg-'));
  try {
    assert.equal(new RoomManager({ file: path.join(dir, 'nope.json') }).rooms.size, 0);
    const bad = path.join(dir, 'bad.json');
    writeFileSync(bad, '{not json');
    assert.equal(new RoomManager({ file: bad }).rooms.size, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('leaving mid-game keeps the seat; the host can end the game for everyone', () => {
  const m = new RoomManager();
  const { room, seat: host } = m.create('Anna');
  const bob = m.join(room.code, 'Bob');
  const cleo = m.join(room.code, 'Cleo');
  m.start(room, host.id);

  m.leave(room, bob.id);
  assert.equal(room.players.length, 3, 'seat kept while the game runs');
  assert.ok(room.players.find((p) => p.id === bob.id).quit);
  assert.ok(room.game.player(bob.id).quit);
  assert.throws(() => m.join(room.code, 'Dan'), /already started/);

  // Host leaves: host role passes to a remaining player.
  m.leave(room, host.id);
  assert.equal(room.hostId, cleo.id);

  // Host ends the game: back to the lobby, quit seats dropped, newcomers can join.
  assert.throws(() => m.endGame(room, bob.id), /Only the host/);
  m.endGame(room, cleo.id);
  assert.equal(room.game, null);
  assert.deepEqual(room.players.map((p) => p.name), ['Cleo']);
  m.join(room.code, 'Dan');
  assert.equal(room.players.length, 2);

  // Leaving a lobby or a finished game frees the seat outright.
  m.leave(room, cleo.id);
  assert.deepEqual(room.players.map((p) => p.name), ['Dan']);
});
