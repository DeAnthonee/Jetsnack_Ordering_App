// In-memory lobbies. Each room has a short join code, a host, up to 6 seats
// and (once started) a Game. Players reconnect with a secret token.

import { randomBytes, randomUUID } from 'node:crypto';
import { Game, GameError } from './game/engine.js';
import { MAPS, DEFAULT_MAP } from './game/map.js';
import { Store } from './store.js';
import { chooseAction, safeAction, BOT_NAMES } from './game/bot.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_PLAYERS = 6;
const CHAT_KEEP = 200;
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
    const room = { code, hostId: null, players: [], game: null, mapId: DEFAULT_MAP, chat: [], chatSeq: 0, touched: Date.now() };
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

  // ---------- chat ----------

  // Append a chat message from a seat; kept with the room so it survives
  // refreshes and restarts, and so AIs can read it.
  say(room, playerId, text) {
    const seat = room.players.find((p) => p.id === playerId);
    if (!seat) throw new RoomError('You are not in this lobby');
    const clean = String(text || '').trim().slice(0, 300);
    if (!clean) throw new RoomError('Empty message');
    room.chat ||= [];
    room.chatSeq = (room.chatSeq || 0) + 1;
    const msg = { id: room.chatSeq, from: seat.name, playerId: seat.id, text: clean, at: Date.now() };
    room.chat.push(msg);
    if (room.chat.length > CHAT_KEEP) room.chat.splice(0, room.chat.length - CHAT_KEEP);
    room.touched = Date.now();
    this.changed();
    return msg;
  }

  // Spectators can chat too; their messages carry no player id.
  saySpectator(room, name, text) {
    const clean = String(text || '').trim().slice(0, 300);
    const who = String(name || '').trim().slice(0, 20) || 'Spectator';
    if (!clean) throw new RoomError('Empty message');
    room.chat ||= [];
    room.chatSeq = (room.chatSeq || 0) + 1;
    const msg = { id: room.chatSeq, from: who, playerId: null, spectator: true, text: clean, at: Date.now() };
    room.chat.push(msg);
    if (room.chat.length > CHAT_KEEP) room.chat.splice(0, room.chat.length - CHAT_KEEP);
    this.changed();
    return msg;
  }

  chatSince(room, sinceId = 0) {
    return (room.chat || []).filter((m) => m.id > sinceId);
  }

  // ---------- computer players ----------

  addBot(room, playerId) {
    if (room.hostId !== playerId) throw new RoomError('Only the host can add computer players');
    if (room.game) throw new RoomError('The game has already started');
    if (room.players.length >= MAX_PLAYERS) throw new RoomError('That lobby is full');
    const used = new Set(room.players.map((p) => p.name.toLowerCase()));
    const name = BOT_NAMES.find((n) => !used.has(n.toLowerCase())) || `Bot ${room.players.length + 1}`;
    const seat = { id: randomUUID(), token: randomUUID(), name, connected: true, bot: true };
    room.players.push(seat);
    room.touched = Date.now();
    this.changed();
    return seat;
  }

  removeBot(room, playerId, botId) {
    if (room.hostId !== playerId) throw new RoomError('Only the host can remove computer players');
    if (room.game) throw new RoomError('The game has already started');
    const seat = room.players.find((p) => p.id === botId && p.bot);
    if (!seat) throw new RoomError('That is not a computer player');
    room.players = room.players.filter((p) => p !== seat);
    this.changed();
  }

  // The bot the game is waiting on, if any.
  pendingBot(room) {
    const g = room.game;
    if (!g || g.phase === 'gameover') return null;
    const bots = new Set(room.players.filter((p) => p.bot).map((p) => p.id));
    return g.waitingOn().find((id) => bots.has(id)) || null;
  }

  // Let one bot take one action. Returns true if it did.
  stepBot(room) {
    const id = this.pendingBot(room);
    if (!id) return false;
    const g = room.game;
    let action = chooseAction(g, id);
    try {
      g.apply(id, action);
    } catch (err) {
      if (!(err instanceof GameError)) throw err;
      g.apply(id, safeAction(g, id));
    }
    room.touched = Date.now();
    this.changed();
    return true;
  }

  // Run bots until a human is up (used by tests and by the server loop).
  runBots(room, limit = 1000) {
    let n = 0;
    while (n < limit && this.stepBot(room)) n++;
    return n;
  }

  humansLeft(room) {
    return room.players.filter((p) => !p.bot && !p.quit).length;
  }

  rejoin(code, token) {
    const room = this.get(code);
    const seat = room.players.find((p) => p.token === token);
    if (!seat) throw new RoomError('Could not rejoin that lobby');
    return { room, seat };
  }

  leave(room, playerId) {
    const running = room.game && room.game.phase !== 'gameover';
    if (running) {
      // The seat stays so the game can go on; the engine auto-passes for it.
      room.game.resign(playerId);
      const seat = room.players.find((p) => p.id === playerId);
      if (seat) seat.quit = true;
    } else {
      room.players = room.players.filter((p) => p.id !== playerId);
    }
    if (!room.players.length || !this.humansLeft(room)) {
      this.rooms.delete(room.code);
      this.changed();
      return;
    }
    if (room.hostId === playerId) {
      const humans = room.players.filter((p) => !p.bot && !p.quit);
      room.hostId = (humans.find((p) => p.connected) || humans[0]).id;
    }
    this.changed();
  }

  // The host stops the game; everyone goes back to the lobby together.
  endGame(room, playerId) {
    if (room.hostId !== playerId) throw new RoomError('Only the host can end the game');
    if (!room.game) throw new RoomError('There is no game to end');
    room.game = null;
    room.players = room.players.filter((p) => !p.quit);
    room.touched = Date.now();
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
      players: room.players.map(({ id, name, connected, quit, bot }) => ({ id, name, connected, quit: !!quit, bot: !!bot })),
      chat: (room.chat || []).slice(-80),
      game: room.game ? room.game.publicState() : null,
    };
  }

  sweep() {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      const anyone = room.players.some((p) => p.connected && !p.bot);
      if (!anyone && now - room.touched > IDLE_ROOM_MS) {
        this.rooms.delete(code);
        this.changed();
      }
    }
  }
}

export const isUserError = (err) => err instanceof RoomError || err instanceof GameError;
