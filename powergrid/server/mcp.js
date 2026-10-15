// MCP server so Claude, ChatGPT and other MCP clients can play through a
// connector. Stateless Streamable HTTP at POST /mcp: every tool call
// carries the seat token it got from create_lobby / join_lobby.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { RoomError, isUserError } from './rooms.js';
import { playerView, legalActions, RULES_SUMMARY } from './api.js';
import { VERSION } from './version.js';

const text = (obj) => ({ content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj) }] });

export function createMcp(rooms, { afterChange = () => {}, hub }) {
  const findSeat = (token) => {
    for (const room of rooms.rooms.values()) {
      const seat = room.players.find((p) => p.token === token);
      if (seat) { seat.connected = true; return { room, seat }; }
    }
    throw new RoomError('Unknown seat token');
  };
  const changed = (room) => afterChange(room);
  const guard = (fn) => async (args) => {
    try {
      return text(await fn(args));
    } catch (err) {
      if (!isUserError(err)) console.error(err);
      return { content: [{ type: 'text', text: `Error: ${isUserError(err) ? err.message : 'Something went wrong'}` }], isError: true };
    }
  };

  const build = () => {
    const server = new McpServer({ name: 'power-grid', version: VERSION });

    server.registerTool('rules', {
      description: 'The rules of Power Grid in brief, and the shape of each action. Read once before playing.',
      inputSchema: {},
    }, guard(() => RULES_SUMMARY));

    server.registerTool('create_lobby', {
      description: 'Create a new lobby and take the host seat. Returns the lobby code to share and your secret seat token (pass it to every other tool).',
      inputSchema: { name: z.string().describe('Your player name'), mapId: z.enum(['germany', 'usa', 'heroverse']).optional() },
    }, guard(({ name, mapId }) => {
      const { room, seat } = rooms.create(name);
      if (mapId) rooms.configure(room, seat.id, { mapId });
      changed(room);
      return { code: room.code, playerId: seat.id, token: seat.token };
    }));

    server.registerTool('join_lobby', {
      description: 'Join an existing lobby by its 5-letter code. Returns your secret seat token.',
      inputSchema: { code: z.string(), name: z.string() },
    }, guard(({ code, name }) => {
      const room = rooms.get(code);
      const seat = rooms.join(room.code, name);
      changed(room);
      return { code: room.code, playerId: seat.id, token: seat.token };
    }));

    server.registerTool('add_computer_player', {
      description: 'Host only: add a computer-controlled player to the lobby before the game starts.',
      inputSchema: { token: z.string() },
    }, guard(({ token }) => {
      const { room, seat } = findSeat(token);
      rooms.addBot(room, seat.id);
      changed(room);
      return { players: room.players.map((p) => p.name) };
    }));

    server.registerTool('start_game', {
      description: 'Host only: start the game once at least 2 players are in the lobby.',
      inputSchema: { token: z.string() },
    }, guard(({ token }) => {
      const { room, seat } = findSeat(token);
      rooms.start(room, seat.id);
      changed(room);
      return playerView(rooms, room, seat.id);
    }));

    server.registerTool('get_state', {
      description: 'The game from your seat: phase, your money/plants/fuel/cities, the market, every player, the playing zone, recent log, and legalActions (what you may do right now).',
      inputSchema: { token: z.string() },
    }, guard(({ token }) => {
      const { room, seat } = findSeat(token);
      return playerView(rooms, room, seat.id);
    }));

    server.registerTool('wait_for_turn', {
      description: 'Block until it is your turn (or the game ends), up to `seconds` (max 50). Returns the same as get_state. Call this in a loop while playing.',
      inputSchema: { token: z.string(), seconds: z.number().int().min(1).max(50).optional() },
    }, guard(({ token, seconds = 25 }) => {
      const { room, seat } = findSeat(token);
      const ready = () => { const v = playerView(rooms, room, seat.id); return v.yourTurn || v.gameOver ? v : null; };
      const now = ready();
      if (now) return now;
      return new Promise((resolve) => {
        const done = (v) => { clearTimeout(timer); hub.off(room.code, onChange); resolve(v); };
        const onChange = () => { const v = ready(); if (v) done(v); };
        const timer = setTimeout(() => done(playerView(rooms, room, seat.id)), seconds * 1000);
        hub.on(room.code, onChange);
      });
    }));

    server.registerTool('act', {
      description: 'Take an action. `action` is one of the legalActions from get_state, e.g. {"type":"startAuction","plant":12,"bid":12}, {"type":"bid","amount":14}, {"type":"passBid"}, {"type":"passAuction"}, {"type":"discardPlant","plant":4}, {"type":"buyResources","order":{"coal":2,"oil":0,"garbage":0,"uranium":0}}, {"type":"build","city":"berlin"}, {"type":"endBuild"}, {"type":"power","plants":[12,20],"hybridCoal":{"12":1}}, {"type":"placeTrust","city":"kassel"}.',
      inputSchema: { token: z.string(), action: z.record(z.any()) },
    }, guard(({ token, action }) => {
      const { room, seat } = findSeat(token);
      rooms.act(room, seat.id, action);
      changed(room);
      const v = playerView(rooms, room, seat.id);
      return { ok: true, yourTurn: v.yourTurn, phase: v.phase, legalActions: legalActions(room.game, seat.id), log: v.log.slice(-5) };
    }));

    server.registerTool('say', {
      description: 'Send a short chat message to the other players.',
      inputSchema: { token: z.string(), text: z.string().max(300) },
    }, guard(({ token, text: msg }) => {
      const { room, seat } = findSeat(token);
      hub.emit('chat', { room, from: seat, text: msg });
      return { ok: true };
    }));

    return server;
  };

  // One server+transport per request: stateless, nothing to clean up.
  return async function handleMcp(req, res) {
    try {
      const server = build();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on('close', () => { transport.close(); server.close(); });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error('mcp error', err);
      if (!res.headersSent) res.status(500).json({ error: 'MCP request failed' });
    }
  };
}
