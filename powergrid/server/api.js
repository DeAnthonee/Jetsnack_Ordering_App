// HTTP API for programs and AIs that want to play. Every call goes through
// the same RoomManager and rules engine as the browser, so nothing here
// can put a game into a state the browser could not.
//
// Auth: each seat has a secret token (returned on create/join). Send it as
// `Authorization: Bearer <token>` or `?token=`.

import { EventEmitter } from 'node:events';
import express from 'express';
import { RoomError, isUserError } from './rooms.js';
import { RES_TYPES, PAYMENT, CITY_SLOT_COST } from './game/data.js';
import { resourceCost, storageCaps } from './game/engine.js';

export const RULES_SUMMARY = `Power Grid (Recharged). Goal: when the game ends, the player who can POWER the most cities wins (ties: most money). Each round: 1) player order (most cities first), 2) auction power plants in player order (pick a plant from the current market, open at >= its number; the smallest plant has a discount token, minimum bid 1; bidding goes round; winner pays; max 3 plants, buying a 4th means scrapping one; in round 1 everyone must buy; others may pass for the round), 3) buy resources in reverse order (prices rise as the market empties; a plant stores at most twice what it burns, of its own fuel type; hybrid plants burn any mix of coal and oil), 4) build houses in reverse order (first house anywhere in the playing zone; later houses must connect to your network, paying the cheapest path of link costs plus 10/15/20 for the 1st/2nd/3rd house in that city; 2nd and 3rd houses open in Steps 2 and 3), 5) bureaucracy (choose plants to run; each burns its full input and powers its output; income is by cities powered, capped at cities owned; resources restock). Step 2 starts when someone reaches 7 cities (6 with six players). Step 3 starts when its card is drawn: all 6 market plants are buyable. The game ends after a build phase where someone reaches 18 (2 players) / 17 (3-4) / 15 (5) / 14 (6) cities; a final bureaucracy with no income decides the winner by cities powered. With 2 players the Trust is an automatic third company that takes the biggest market plant each round and blocks city spaces. Strategy basics: keep enough fuel to run your plants, do not outbuild your capacity, keep cash for building, and remember going first is bad for buying.`;

const ACTION_SCHEMA = {
  placeTrust: { city: 'city id' },
  startAuction: { plant: 'plant number', bid: 'opening bid (>= minBid)' },
  passAuction: {},
  bid: { amount: 'more than the current bid' },
  passBid: {},
  discardPlant: { plant: 'plant number to scrap' },
  buyResources: { order: { coal: 0, oil: 0, garbage: 0, uranium: 0 } },
  build: { city: 'city id' },
  endBuild: {},
  power: { plants: ['plant numbers to run'], hybridCoal: { '<plantNumber>': 'coal units for a hybrid plant' } },
};

export class ApiHub extends EventEmitter {}

// What the player may do right now, with the numbers they need to decide.
export function legalActions(game, playerId) {
  const g = game;
  if (!g || g.phase === 'gameover' || !g.waitingOn().includes(playerId)) return [];
  const p = g.player(playerId);
  const out = [];
  switch (g.phase) {
    case 'trustSetup': {
      const cities = [...g.activeCities].filter((c) => {
        if (g.citySlots[c][0]) return false;
        return !g.trust.cities.length || g.neighbors[c].some((n) => g.trust.cities.includes(n.city));
      });
      out.push({ type: 'placeTrust', cities });
      break;
    }
    case 'auction': {
      const a = g.auction;
      if (a.pendingDiscard === playerId) {
        out.push({ type: 'discardPlant', plants: p.plants.filter((x) => x.n !== a.justBought).map((x) => x.n) });
      } else if (a.current) {
        const plant = g.market.find((x) => x.n === a.current.plant);
        if (a.current.bid + 1 <= p.money) out.push({ type: 'bid', plant, minAmount: a.current.bid + 1, maxAmount: p.money });
        out.push({ type: 'passBid' });
      } else {
        const plants = g.actualMarket().map((x) => ({ ...x, minBid: g.minimumBid(x) })).filter((x) => x.minBid <= p.money);
        if (plants.length) out.push({ type: 'startAuction', plants, maxBid: p.money });
        if (g.round > 1) out.push({ type: 'passAuction' });
      }
      break;
    }
    case 'resources': {
      const caps = storageCaps(p.plants);
      const market = {};
      for (const r of RES_TYPES) {
        market[r] = { available: g.resMarket[r], priceOfNext: g.resMarket[r] ? resourceCost(r, g.resMarket[r], 1) : null };
      }
      out.push({ type: 'buyResources', market, storage: caps, holding: p.res, money: p.money, note: 'order may be all zeros' });
      break;
    }
    case 'build': {
      const cities = [];
      for (const city of g.activeCities) {
        try {
          const q = g.quoteBuild(playerId, city);
          if (q.total <= p.money) cities.push({ city, name: g.cityName(city), cost: q.total, connection: q.connection, house: q.building });
        } catch {}
      }
      cities.sort((x, y) => x.cost - y.cost);
      if (cities.length) out.push({ type: 'build', cities, money: p.money, builtThisTurn: g.builtThisTurn });
      out.push({ type: 'endBuild' });
      break;
    }
    case 'bureaucracy':
      out.push({
        type: 'power',
        plants: p.plants,
        holding: p.res,
        cities: p.cities.length,
        incomeByCitiesPowered: PAYMENT.slice(0, Math.min(p.cities.length, 20) + 1),
        note: 'list the plant numbers to run; each burns its full input; hybridCoal says how much coal a hybrid burns (rest is oil)',
      });
      break;
    default:
  }
  return out;
}

// The game from one player's point of view, compact enough for an LLM.
export function playerView(rooms, room, playerId) {
  const g = room.game;
  const base = {
    code: room.code,
    playerId,
    name: room.players.find((p) => p.id === playerId)?.name,
    isHost: room.hostId === playerId,
    players: room.players.map((p) => ({ id: p.id, name: p.name, bot: !!p.bot, connected: p.connected, quit: !!p.quit })),
    started: !!g,
    mapId: room.mapId,
  };
  if (!g) return { ...base, yourTurn: false, legalActions: [] };
  const s = g.publicState();
  const map = g.map;
  const me = s.players.find((p) => p.id === playerId);
  return {
    ...base,
    round: s.round,
    step: s.step,
    phase: s.phase,
    order: s.order,
    waitingOn: s.waitingOn,
    yourTurn: s.waitingOn.includes(playerId),
    gameOver: s.phase === 'gameover',
    winner: s.winner,
    ranking: s.ranking,
    you: me,
    players: s.players.map((p) => ({ id: p.id, name: p.name, money: p.money, cities: p.cities.length, plants: p.plants.map((x) => x.n), lastPowered: p.lastPowered, quit: p.quit })),
    trust: s.trust ? { plants: s.trust.plants.map((x) => x.n), cities: s.trust.cities, housesLeft: s.trust.housesLeft } : null,
    market: s.market.filter((p) => p.type !== 'step3').map((p) => ({ n: p.n, type: p.type, input: p.input, output: p.output, buyable: p.buyable, minBid: p.minBid })),
    discount: s.discount,
    deckSize: s.deckSize,
    resMarket: s.resMarket,
    cities: Object.fromEntries([...g.activeCities].map((c) => [c, { name: map.cityById[c].name, region: map.cityById[c].region, houses: g.citySlots[c] }])),
    links: map.edges.filter((e) => g.activeCities.has(e.a) && g.activeCities.has(e.b)),
    houseCosts: CITY_SLOT_COST,
    auction: s.auction,
    log: s.log.slice(-15).map((l) => `R${l.round}: ${l.msg}`),
    legalActions: legalActions(g, playerId),
  };
}

export function createApi(rooms, { afterChange = () => {}, hub = new ApiHub() } = {}) {
  hub.setMaxListeners(500);
  const router = express.Router();
  router.use(express.json({ limit: '64kb' }));

  // afterChange is expected to notify everyone, including hub listeners.
  const changed = (room) => afterChange(room);

  // Resolve the seat from the token; mark it as present.
  const auth = (req) => {
    const header = req.get('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : req.query.token;
    if (!token) throw new RoomError('Missing seat token');
    for (const room of rooms.rooms.values()) {
      const seat = room.players.find((p) => p.token === token);
      if (seat) {
        seat.connected = true;
        return { room, seat };
      }
    }
    throw new RoomError('Unknown seat token (did the lobby close?)');
  };

  const wrap = (fn) => async (req, res) => {
    try {
      res.json(await fn(req, res));
    } catch (err) {
      if (!isUserError(err)) console.error(err);
      res.status(isUserError(err) ? 400 : 500).json({ error: isUserError(err) ? err.message : 'Something went wrong' });
    }
  };

  router.get('/rules', wrap(() => ({ rules: RULES_SUMMARY, actions: ACTION_SCHEMA })));

  router.post('/lobbies', wrap((req) => {
    const { room, seat } = rooms.create(req.body?.name);
    if (req.body?.mapId) rooms.configure(room, seat.id, { mapId: req.body.mapId });
    changed(room);
    return { code: room.code, playerId: seat.id, token: seat.token };
  }));

  router.post('/lobbies/:code/join', wrap((req) => {
    const room = rooms.get(req.params.code);
    const seat = rooms.join(room.code, req.body?.name);
    changed(room);
    return { code: room.code, playerId: seat.id, token: seat.token };
  }));

  router.get('/lobbies/:code', wrap((req) => {
    const room = rooms.get(req.params.code);
    return { code: room.code, started: !!room.game, mapId: room.mapId, players: room.players.map((p) => ({ name: p.name, bot: !!p.bot })) };
  }));

  router.get('/me', wrap((req) => {
    const { room, seat } = auth(req);
    return playerView(rooms, room, seat.id);
  }));

  // Long-poll: returns when it's your turn, the game ends, the lobby
  // starts, or `timeout` seconds pass (max 50).
  router.get('/wait', wrap(async (req) => {
    const { room, seat } = auth(req);
    const timeout = Math.min(50, Math.max(1, Number(req.query.timeout) || 25)) * 1000;
    const ready = () => {
      const v = playerView(rooms, room, seat.id);
      return v.yourTurn || v.gameOver || (req.query.until === 'start' && v.started) ? v : null;
    };
    const now = ready();
    if (now) return now;
    return new Promise((resolve) => {
      const done = (v) => { clearTimeout(timer); hub.off(room.code, onChange); resolve(v); };
      const onChange = () => { const v = ready(); if (v) done(v); };
      const timer = setTimeout(() => done(playerView(rooms, room, seat.id)), timeout);
      hub.on(room.code, onChange);
    });
  }));

  router.post('/act', wrap((req) => {
    const { room, seat } = auth(req);
    rooms.act(room, seat.id, req.body);
    changed(room);
    return playerView(rooms, room, seat.id);
  }));

  router.post('/start', wrap((req) => {
    const { room, seat } = auth(req);
    rooms.start(room, seat.id);
    changed(room);
    return playerView(rooms, room, seat.id);
  }));

  router.post('/bots', wrap((req) => {
    const { room, seat } = auth(req);
    rooms.addBot(room, seat.id);
    changed(room);
    return playerView(rooms, room, seat.id);
  }));

  router.post('/settings', wrap((req) => {
    const { room, seat } = auth(req);
    rooms.configure(room, seat.id, req.body || {});
    changed(room);
    return playerView(rooms, room, seat.id);
  }));

  router.post('/leave', wrap((req) => {
    const { room, seat } = auth(req);
    seat.connected = false;
    rooms.leave(room, seat.id);
    if (rooms.rooms.has(room.code)) changed(room);
    return { ok: true };
  }));

  router.post('/chat', wrap((req) => {
    const { room, seat } = auth(req);
    const text = String(req.body?.text || '').trim().slice(0, 300);
    if (text) hub.emit('chat', { room, from: seat, text });
    return { ok: true };
  }));

  return { router, hub };
}
