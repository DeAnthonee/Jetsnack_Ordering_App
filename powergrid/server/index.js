import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import express from 'express';
import { Server } from 'socket.io';
import { RoomManager, RoomError, isUserError } from './rooms.js';
import { MAPS, mapView } from './game/map.js';
import { SLOT_PRICES, PAYMENT, CITY_SLOT_COST, RESUPPLY } from './game/data.js';

const PORT = process.env.PORT || 3000;
const here = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.static(path.join(here, '..', 'public')));
app.get('/api/static-data', (_req, res) => {
  res.json({
    maps: Object.fromEntries(Object.values(MAPS).map((m) => [m.id, mapView(m)])),
    slotPrices: SLOT_PRICES,
    payment: PAYMENT,
    citySlotCost: CITY_SLOT_COST,
    resupply: RESUPPLY,
  });
});

const httpServer = createServer(app);
const io = new Server(httpServer);
const rooms = new RoomManager();
setInterval(() => rooms.sweep(), 10 * 60 * 1000).unref();

const broadcast = (room) => io.to(room.code).emit('room', rooms.view(room));

io.on('connection', (socket) => {
  let room = null;
  let seat = null;

  const attach = (r, s) => {
    if (room && room !== r) socket.leave(room.code);
    room = r;
    seat = s;
    seat.connected = true;
    socket.data.playerId = seat.id;
    socket.join(room.code);
    socket.emit('joined', { code: room.code, playerId: seat.id, token: seat.token });
    broadcast(room);
  };

  const inRoom = () => {
    if (!room) throw new RoomError('You are not in a lobby');
  };

  // Run a handler, reporting rule/lobby errors back to the caller only.
  const handle = (fn) => (payload = {}, ack) => {
    try {
      fn(payload);
      if (typeof ack === 'function') ack({ ok: true });
    } catch (err) {
      if (!isUserError(err)) console.error(err);
      const message = isUserError(err) ? err.message : 'Something went wrong';
      if (typeof ack === 'function') ack({ ok: false, error: message });
      else socket.emit('error-message', message);
    }
  };

  socket.on('create', handle(({ name }) => {
    const created = rooms.create(name);
    attach(created.room, created.seat);
  }));

  socket.on('join', handle(({ code, name }) => {
    const r = rooms.get(code);
    attach(r, rooms.join(code, name));
  }));

  socket.on('rejoin', handle(({ code, token }) => {
    const found = rooms.rejoin(code, token);
    attach(found.room, found.seat);
  }));

  socket.on('leave', handle(() => {
    if (!room) return;
    socket.leave(room.code);
    rooms.leave(room, seat.id);
    if (room.game) seat.connected = false;
    broadcast(room);
    room = null;
    seat = null;
  }));

  socket.on('start', handle(() => {
    inRoom();
    rooms.start(room, seat.id);
    broadcast(room);
  }));

  socket.on('settings', handle((settings) => {
    inRoom();
    rooms.configure(room, seat.id, settings);
    broadcast(room);
  }));

  socket.on('action', handle((action) => {
    inRoom();
    rooms.act(room, seat.id, action);
    broadcast(room);
  }));

  socket.on('chat', handle(({ text }) => {
    if (!room) return;
    const clean = String(text || '').trim().slice(0, 300);
    if (clean) io.to(room.code).emit('chat', { from: seat.name, playerId: seat.id, text: clean, at: Date.now() });
  }));

  socket.on('disconnect', () => {
    if (!room || !seat) return;
    const stillHere = [...(io.sockets.adapter.rooms.get(room.code) || [])].some(
      (sid) => io.sockets.sockets.get(sid)?.data.playerId === seat.id,
    );
    if (!stillHere) seat.connected = false;
    broadcast(room);
  });
});

httpServer.listen(PORT, () => {
  console.log(`Power Grid server running on http://localhost:${PORT}`);
});
