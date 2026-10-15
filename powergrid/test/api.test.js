import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';

let base;
let httpServer;

before(async () => {
  ({ httpServer } = createApp({ dataFile: null, botDelayMs: 5 }));
  await new Promise((r) => httpServer.listen(0, r));
  base = `http://127.0.0.1:${httpServer.address().port}`;
});
after(() => new Promise((r) => httpServer.close(r)));

const call = async (method, route, { token, body } = {}) => {
  const res = await fetch(`${base}${route}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json() };
};

test('a program can create a lobby, add bots, start, and play through the API', async () => {
  const rules = await call('GET', '/api/v1/rules');
  assert.match(rules.data.rules, /Power Grid/);

  const created = await call('POST', '/api/v1/lobbies', { body: { name: 'Script', mapId: 'usa' } });
  assert.equal(created.status, 200);
  const { code, token } = created.data;
  assert.match(code, /^[A-Z2-9]{5}$/);

  const joined = await call('POST', `/api/v1/lobbies/${code}/join`, { body: { name: 'Friend' } });
  assert.equal(joined.status, 200);
  const friend = joined.data.token;

  assert.equal((await call('POST', '/api/v1/bots', { token: friend })).status, 400, 'only the host adds bots');
  await call('POST', '/api/v1/bots', { token });
  const lobby = await call('GET', `/api/v1/lobbies/${code}`);
  assert.deepEqual(lobby.data.players.map((p) => p.name), ['Script', 'Friend', 'Tesla']);

  assert.equal((await call('POST', '/api/v1/start', { token: friend })).status, 400);
  const started = await call('POST', '/api/v1/start', { token });
  assert.equal(started.status, 200);
  assert.equal(started.data.phase, 'auction');

  // Both humans play a round with the simplest legal moves; the bot plays itself.
  const tokens = { Script: token, Friend: friend };
  let moves = 0;
  for (let guard = 0; guard < 60; guard++) {
    let acted = false;
    for (const t of Object.values(tokens)) {
      const me = (await call('GET', '/api/v1/me', { token: t })).data;
      if (me.round >= 2 || me.gameOver) return finish(me, moves);
      if (!me.yourTurn) continue;
      const legal = me.legalActions;
      const has = (type) => legal.find((a) => a.type === type);
      let action;
      if (has('passBid')) action = { type: 'passBid' };
      else if (has('startAuction')) { const p = has('startAuction').plants[0]; action = { type: 'startAuction', plant: p.n, bid: p.minBid }; }
      else if (has('passAuction')) action = { type: 'passAuction' };
      else if (has('buyResources')) action = { type: 'buyResources', order: { coal: 0, oil: 0, garbage: 0, uranium: 0 } };
      else if (has('build')) action = { type: 'build', city: has('build').cities[0].city };
      else if (has('endBuild')) action = { type: 'endBuild' };
      else if (has('power')) action = { type: 'power', plants: [], hybridCoal: {} };
      const r = await call('POST', '/api/v1/act', { token: t, body: action });
      assert.equal(r.status, 200, JSON.stringify(r.data));
      moves++;
      acted = true;
    }
    if (!acted) await new Promise((r) => setTimeout(r, 30)); // let the bot move
  }
  assert.fail('round 1 did not complete');

  function finish(me, n) {
    assert.ok(n >= 6, `humans made moves (${n})`);
    assert.equal(me.round, 2);
  }
});

test('illegal moves and bad tokens are rejected cleanly', async () => {
  const { data: { token } } = await call('POST', '/api/v1/lobbies', { body: { name: 'Solo' } });
  assert.equal((await call('GET', '/api/v1/me')).status, 400);
  assert.equal((await call('GET', '/api/v1/me', { token: 'nope' })).status, 400);
  assert.equal((await call('POST', '/api/v1/start', { token })).status, 400, 'needs 2 players');
  await call('POST', '/api/v1/bots', { token });
  await call('POST', '/api/v1/start', { token });
  const bad = await call('POST', '/api/v1/act', { token, body: { type: 'build', city: 'berlin' } });
  assert.equal(bad.status, 400);
  assert.match(bad.data.error, /not your turn|not the Bureaucracy|cannot|not/i);
  const me = (await call('GET', '/api/v1/me', { token })).data;
  assert.equal(me.started, true);
});

test('wait returns as soon as it is your turn', async () => {
  const { data: { token } } = await call('POST', '/api/v1/lobbies', { body: { name: 'Waiter' } });
  const t0 = Date.now();
  const waiting = call('GET', '/api/v1/wait?timeout=20&until=start', { token });
  await new Promise((r) => setTimeout(r, 50));
  await call('POST', '/api/v1/bots', { token });
  await call('POST', '/api/v1/start', { token });
  const res = await waiting;
  assert.equal(res.data.started, true);
  assert.ok(Date.now() - t0 < 5000, 'returned early rather than at the timeout');
});

test('wait wakes up when a bot or another player moves', async () => {
  const { data: { token } } = await call('POST', '/api/v1/lobbies', { body: { name: 'Host' } });
  await call('POST', '/api/v1/bots', { token });
  await call('POST', '/api/v1/bots', { token });
  await call('POST', '/api/v1/start', { token });
  const simplest = (legal) => {
    const has = (t) => legal.find((a) => a.type === t);
    if (has('passBid')) return { type: 'passBid' };
    if (has('startAuction')) return { type: 'startAuction', plant: has('startAuction').plants[0].n, bid: has('startAuction').plants[0].minBid };
    if (has('passAuction')) return { type: 'passAuction' };
    if (has('buyResources')) return { type: 'buyResources', order: {} };
    if (has('endBuild')) return { type: 'endBuild' };
    if (has('power')) return { type: 'power', plants: [] };
    throw new Error('no simple move');
  };
  // Several host turns in a row: each wait must return as soon as the bots have moved.
  for (let i = 0; i < 4; i++) {
    const t0 = Date.now();
    const me = (await call('GET', '/api/v1/wait?timeout=20', { token })).data;
    assert.ok(me.yourTurn, 'it is the host\'s turn');
    assert.ok(Date.now() - t0 < 5000, `woke on bot moves, not the timeout (${Date.now() - t0}ms)`);
    const r = await call('POST', '/api/v1/act', { token, body: simplest(me.legalActions) });
    assert.equal(r.status, 200, JSON.stringify(r.data));
  }
});

test('the MCP endpoint lists its tools and plays a move', async () => {
  const rpc = async (id, method, params) => {
    const res = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    });
    const text = await res.text();
    // Stateless transport may answer as JSON or as a one-event SSE stream.
    const line = text.split('\n').find((l) => l.startsWith('data:'));
    return JSON.parse(line ? line.slice(5) : text);
  };
  const init = await rpc(1, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } });
  assert.equal(init.result.serverInfo.name, 'power-grid');
  const tools = await rpc(2, 'tools/list', {});
  const names = tools.result.tools.map((t) => t.name);
  for (const n of ['rules', 'create_lobby', 'join_lobby', 'get_state', 'wait_for_turn', 'act', 'start_game', 'add_computer_player', 'send_chat', 'say', 'read_chat']) assert.ok(names.includes(n), n);

  const created = await rpc(3, 'tools/call', { name: 'create_lobby', arguments: { name: 'Claude' } });
  const { token } = JSON.parse(created.result.content[0].text);
  await rpc(4, 'tools/call', { name: 'add_computer_player', arguments: { token } });
  const started = await rpc(5, 'tools/call', { name: 'start_game', arguments: { token } });
  const view = JSON.parse(started.result.content[0].text);
  assert.equal(view.phase, 'trustSetup');
  const turn = await rpc(6, 'tools/call', { name: 'wait_for_turn', arguments: { token, seconds: 5 } });
  const v2 = JSON.parse(turn.result.content[0].text);
  assert.ok(v2.yourTurn);
  const city = v2.legalActions[0].cities[0];
  const acted = await rpc(7, 'tools/call', { name: 'act', arguments: { token, action: { type: 'placeTrust', city } } });
  assert.ok(JSON.parse(acted.result.content[0].text).ok);
  const bad = await rpc(8, 'tools/call', { name: 'act', arguments: { token: 'nope', action: {} } });
  assert.ok(bad.result.isError);
});

test('chat is stored with the room and readable by AIs', async () => {
  const { data: { token, code } } = await call('POST', '/api/v1/lobbies', { body: { name: 'Host' } });
  const { data: { token: guest } } = await call('POST', `/api/v1/lobbies/${code}/join`, { body: { name: 'Guest' } });
  assert.equal((await call('POST', '/api/v1/chat', { token, body: { text: '   ' } })).status, 400, 'empty messages rejected');
  await call('POST', '/api/v1/chat', { token, body: { text: 'hello table' } });
  const me = (await call('GET', '/api/v1/me', { token: guest })).data;
  assert.equal(me.chat.length, 1);
  assert.equal(me.chat[0].from, 'Host');
  assert.equal(me.chatCursor, 1);

  // wait?chat=1 wakes on a new message from someone else.
  const t0 = Date.now();
  const waiting = call('GET', `/api/v1/wait?timeout=20&chat=1&since=${me.chatCursor}`, { token: guest });
  await new Promise((r) => setTimeout(r, 50));
  await call('POST', '/api/v1/chat', { token, body: { text: 'you there?' } });
  const woke = await waiting;
  assert.ok(Date.now() - t0 < 5000, 'woke on chat');
  assert.equal(woke.data.chat.at(-1).text, 'you there?');
  const since = (await call('GET', '/api/v1/chat?since=1', { token: guest })).data.messages;
  assert.deepEqual(since.map((m) => m.text), ['you there?']);

  // MCP: say and read_chat.
  const rpc = async (id, method, params) => {
    const res = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id, method, params }) });
    const text = await res.text();
    const line = text.split('\n').find((l) => l.startsWith('data:'));
    return JSON.parse(line ? line.slice(5) : text);
  };
  const said = await rpc(1, 'tools/call', { name: 'send_chat', arguments: { token: guest, text: 'yes, ready' } });
  assert.ok(JSON.parse(said.result.content[0].text).ok);
  const alias = await rpc(9, 'tools/call', { name: 'say', arguments: { token: guest, text: 'alias works' } });
  assert.ok(JSON.parse(alias.result.content[0].text).ok);
  const read = JSON.parse((await rpc(2, 'tools/call', { name: 'read_chat', arguments: { token, since: 2 } })).result.content[0].text);
  assert.deepEqual(read.messages.map((m) => `${m.from}: ${m.text}`), ['Guest: yes, ready', 'Guest: alias works']);
  assert.equal(read.cursor, 4);
});

test('a program can watch a game without a seat', async () => {
  const { data: { token, code } } = await call('POST', '/api/v1/lobbies', { body: { name: 'Host' } });
  await call('POST', '/api/v1/bots', { token });
  await call('POST', '/api/v1/start', { token });
  const w = await call('GET', `/api/v1/lobbies/${code}/watch`);
  assert.equal(w.status, 200);
  assert.equal(w.data.game.phase, 'trustSetup');
  assert.ok(!JSON.stringify(w.data).includes(token), 'no seat tokens in the spectator view');
  assert.equal((await call('GET', '/api/v1/lobbies/NOPE1/watch')).status, 400);
});
