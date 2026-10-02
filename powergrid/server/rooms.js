// In-memory lobbies. Each room has a short join code, a host, up to 6 seats
// and (once started) a Game. Players reconnect with a secret token.

import { randomBytes, randomUUID } from 'node:crypto';
import { Game, GameError } from './game/engine.js';
import { MAPS, DEFAULT_MAP } from './game/map.js';
import { Store } from './store.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_PLAYERS = 6;
const IDLE_ROOM_MS = 6 * 60 * 60 * 1000;

export class RoomError extends Error {}

export class RoomManager {
  constructor({ file = null } = {}) {
    this.rooms = new Map();
    this.store = new Store(file);
    const n = this.store.load(this.rooms);
    if (n) console.log(`Restored ${n} lobbies from ${file}`);
  }

  // Call after anything that changes a room.
  changed() {
    this.store.schedule(this.rooms);
  }

  newCode() {
    for (;;) {
      const bytes = randomBytes(5);
      const code = [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
      if (!this.rooms.has(code)) return code;
    }
  }

  get(code) {
    const room = this.rooms.get(String(code || '').toUpperCase());
    if (!room) throw new RoomError('Lobby not found');
    return room;
  }

  create(name) {
    const code = this.newCode();
    const room = { code, hostId: null, players: [], game: null, mapId: DEFAULT_MAP, touched: Date.now() };
    this.rooms.set(code, room);
    const seat = this.join(code, name);
    room.hostId = seat.id;
    this.changed();
    return { room, seat };
  }

  join(code, name) {
    const room = this.get(code);
    const clean = String(name || '').trim().slice(0, 20);
    if (!clean) throw new RoomError('Please enter a name');
    if (room.game) throw new RoomError('That game has already started');
    if (room.players.length >= MAX_PLAYERS) throw new RoomError('That lobby is full');
    if (room.players.some((p) => p.name.toLowerCase() === clean.toLowerCase())) {
      throw new RoomError('Someone in that lobby already has that name');
    }
    const seat = { id: randomUUID(), token: randomUUID(), name: clean, connected: false };
    room.players.push(seat);
    room.touched = Date.now();
    this.changed();
    return seat;
  }

  rejoin(code, token) {
    const room = this.get(code);
    const seat = room.players.find((p) => p.token === token);
    if (!seat) throw new RoomError('Could not rejoin that lobby');
    return { room, seat };
  }

  leave(room, playerId) {
    if (room.game) return; // seats are kept once the game is running
    room.players = room.players.filter((p) => p.id !== playerId);
    if (!room.players.length) {
      this.rooms.delete(room.code);
      this.changed();
      return;
    }
    if (room.hostId === playerId) room.hostId = room.players[0].id;
    this.changed();
  }

  configure(room, playerId, { mapId } = {}) {
    if (room.hostId !== playerId) throw new RoomError('Only the host can change settings');
    if (room.game) throw new RoomError('The game has already started');
    if (mapId !== undefined) {
      if (!Object.hasOwn(MAPS, mapId)) throw new RoomError('Unknown map');
      room.mapId = mapId;
    }
    this.changed();
  }

  start(room, playerId) {
    if (room.hostId !== playerId) throw new RoomError('Only the host can start the game');
    if (room.game) throw new RoomError('The game has already started');
    if (room.players.length < 2) throw new RoomError('You need at least 2 players');
    room.game = new Game(room.players.map(({ id, name }) => ({ id, name })), { mapId: room.mapId });
    room.touched = Date.now();
    this.changed();
  }

  act(room, playerId, action) {
    if (!room.game) throw new RoomError('The game has not started');
    room.game.apply(playerId, action);
    room.touched = Date.now();
    this.changed();
  }

  view(room) {
    return {
      code: room.code,
      hostId: room.hostId,
      mapId: room.mapId,
      players: room.players.map(({ id, name, connected }) => ({ id, name, connected })),
      game: room.game ? room.game.publicState() : null,
    };
  }

  sweep() {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      const anyone = room.players.some((p) => p.connected);
      if (!anyone && now - room.touched > IDLE_ROOM_MS) {
        this.rooms.delete(code);
        this.changed();
      }
    }
  }
}

export const isUserError = (err) => err instanceof RoomError || err instanceof GameError;
