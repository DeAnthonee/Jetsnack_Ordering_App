/* global io */
(() => {
  const $ = (sel) => document.querySelector(sel);
  const socket = io();

  const state = {
    me: null,        // my player id
    token: null,
    code: null,
    room: null,      // latest room view from the server
    data: null,      // static data (maps, prices)
    ui: {            // local, per-phase scratch state
      bid: null,
      order: { coal: 0, oil: 0, garbage: 0, uranium: 0 },
      fire: new Set(),
      hybridCoal: {},
      quoteCity: null,
    },
    chat: [],
  };

  const RES = ['coal', 'oil', 'garbage', 'uranium'];
  const RES_ICON = { coal: '⚫', oil: '🛢️', garbage: '🗑️', uranium: '☢️', eco: '🌿', hybrid: '⚫/🛢️', step3: '③' };
  const TYPE_LABEL = { coal: 'Coal', oil: 'Oil', garbage: 'Garbage', uranium: 'Uranium', eco: 'Eco', hybrid: 'Hybrid', step3: 'Step 3' };

  // ---------- helpers ----------

  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => { el.hidden = true; }, 3500);
  }

  function emit(event, payload) {
    socket.emit(event, payload, (res) => {
      if (res && !res.ok) toast(res.error);
    });
  }

  const act = (action) => emit('action', action);
  const game = () => state.room?.game;
  const myPlayer = () => game()?.players.find((p) => p.id === state.me);
  const playerById = (id) => (id === 'trust' ? game()?.trust : game()?.players.find((p) => p.id === id));
  const nameOf = (id) => playerById(id)?.name ?? '?';
  const colorOf = (id) => playerById(id)?.color ?? '#888';
  const isMyTurn = () => game()?.waitingOn.includes(state.me);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function resourceCost(type, available, qty) {
    if (qty > available) return null;
    const prices = state.data.slotPrices[type];
    let cost = 0;
    for (let i = 0; i < qty; i++) cost += prices[prices.length - available + i];
    return cost;
  }

  function storageCaps(plants) {
    const caps = { coal: 0, oil: 0, hybrid: 0, garbage: 0, uranium: 0 };
    for (const p of plants) if (p.type in caps) caps[p.type] += 2 * p.input;
    return caps;
  }

  function canStore(plants, res) {
    const c = storageCaps(plants);
    return res.coal <= c.coal + c.hybrid && res.oil <= c.oil + c.hybrid &&
      res.coal + res.oil <= c.coal + c.oil + c.hybrid && res.garbage <= c.garbage && res.uranium <= c.uranium;
  }

  function show(screen) {
    for (const id of ['home', 'lobby', 'game']) $(`#${id}`).hidden = id !== screen;
  }

  function saveSession() {
    try { localStorage.setItem('pg-session', JSON.stringify({ code: state.code, token: state.token })); } catch {}
  }

  function clearSession() {
    try { localStorage.removeItem('pg-session'); } catch {}
  }

  // ---------- home & lobby ----------

  $('#create').onclick = () => emit('create', { name: $('#name').value });
  $('#join').onclick = () => emit('join', { name: $('#name').value, code: $('#code').value.toUpperCase() });
  $('#code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#join').click(); });
  $('#start').onclick = () => emit('start', {});
  $('#leave').onclick = () => { emit('leave', {}); clearSession(); state.room = null; show('home'); };
  $('#map-select').onchange = (e) => emit('settings', { mapId: e.target.value });
  $('#chat-form').onsubmit = (e) => {
    e.preventDefault();
    const text = $('#chat-input').value.trim();
    if (text) emit('chat', { text });
    $('#chat-input').value = '';
  };

  socket.on('joined', ({ code, playerId, token }) => {
    state.code = code;
    state.me = playerId;
    state.token = token;
    saveSession();
  });

  socket.on('error-message', toast);

  socket.on('chat', (msg) => {
    state.chat.push(msg);
    if (state.chat.length > 60) state.chat.shift();
    renderLog();
  });

  socket.on('room', (room) => {
    state.room = room;
    if (!room.game) renderLobby();
    else renderGame();
  });

  socket.on('connect', () => {
    if (state.code && state.token) emit('rejoin', { code: state.code, token: state.token });
  });

  function renderLobby() {
    const room = state.room;
    show('lobby');
    $('#lobby-code').textContent = room.code;
    $('#lobby-players').innerHTML = room.players.map((p) => `
      <li><span>${esc(p.name)}${p.id === room.hostId ? ' <span class="muted">(host)</span>' : ''}${p.id === state.me ? ' <span class="muted">(you)</span>' : ''}</span>
      <span class="${p.connected ? 'muted' : 'offline'}">${p.connected ? 'online' : 'offline'}</span></li>`).join('');
    const sel = $('#map-select');
    sel.innerHTML = Object.values(state.data.maps).map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join('');
    sel.value = room.mapId;
    const host = room.hostId === state.me;
    sel.disabled = !host;
    $('#start').disabled = !host || room.players.length < 2;
    $('#lobby-hint').textContent = room.players.length < 2
      ? 'Waiting for at least one more player…'
      : room.players.length === 2 ? '2 players: you will play against the Trust.' : `${room.players.length} players ready.`;
  }

  // ---------- game rendering ----------

  function renderGame() {
    show('game');
    const g = game();
    const phaseNames = {
      trustSetup: 'Setup: place the Trust', auction: 'Phase 2: Auction', resources: 'Phase 3: Buy resources',
      build: 'Phase 4: Build houses', bureaucracy: 'Phase 5: Bureaucracy', gameover: 'Game over',
    };
    $('#status-main').innerHTML = `Round <b>${g.round}</b> · Step <b>${g.step}</b> · <b>${phaseNames[g.phase]}</b>` +
      (g.endTriggered ? ' · <b>final round</b>' : '') +
      ` · Order: ${g.order.map((id) => `<span style="color:${colorOf(id)}">${esc(nameOf(id))}</span>`).join(' → ')}`;
    const waiting = $('#status-waiting');
    if (g.phase === 'gameover') waiting.textContent = `${nameOf(g.winner)} wins!`;
    else {
      const names = g.waitingOn.map(nameOf);
      waiting.textContent = isMyTurn() ? 'Your move' : `Waiting for ${names.join(', ')}`;
    }
    waiting.classList.toggle('me', !!isMyTurn());

    renderMap();
    renderAction();
    renderMarket();
    renderResMarket();
    renderPlayers();
    renderLog();
  }

  function renderMap() {
    const g = game();
    const map = state.data.maps[g.mapId];
    const svg = $('#map');
    const active = new Set(g.activeCities);
    const byId = Object.fromEntries(map.cities.map((c) => [c.id, c]));
    const regionColor = Object.fromEntries(map.regions.map((r) => [r.id, r.color]));
    const me = myPlayer();
    const canClick = isMyTurn() && (g.phase === 'build' || g.phase === 'trustSetup');

    let out = '';
    for (const e of map.edges) {
      const a = byId[e.a]; const b = byId[e.b];
      const on = active.has(e.a) && active.has(e.b);
      out += `<line class="edge ${on ? '' : 'inactive'}" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/>`;
      if (on) {
        const mx = (a.x + b.x) / 2; const my = (a.y + b.y) / 2;
        out += `<circle class="edge-label-bg" cx="${mx}" cy="${my}" r="11"/><text class="edge-label" x="${mx}" y="${my}">${e.cost}</text>`;
      }
    }
    for (const c of map.cities) {
      const on = active.has(c.id);
      const slots = g.citySlots[c.id] || [null, null, null];
      const mine = me?.cities.includes(c.id);
      out += `<g class="city ${on ? '' : 'inactive'} ${on && canClick ? 'clickable' : ''}" data-city="${c.id}">`;
      out += `<circle class="city-circle" cx="${c.x}" cy="${c.y}" r="24" fill="${regionColor[c.region]}"${mine ? ' stroke="#fff" stroke-width="4"' : ''}/>`;
      slots.forEach((owner, i) => {
        const x = c.x - 19 + i * 13; const y = c.y - 6;
        const cls = owner ? '' : i < g.step ? 'empty' : 'locked';
        out += `<rect class="slot ${cls}" x="${x}" y="${y}" width="12" height="12" rx="2"${owner ? ` fill="${colorOf(owner)}"` : ''}/>`;
      });
      out += `<text class="city-name" x="${c.x}" y="${c.y + 40}">${esc(c.name)}</text></g>`;
    }
    svg.setAttribute('viewBox', `0 0 ${map.width} ${map.height}`);
    svg.innerHTML = out;

    svg.querySelectorAll('.city.clickable').forEach((el) => {
      el.addEventListener('click', () => onCityClick(el.dataset.city));
    });

    $('#map-legend').innerHTML = map.regions.filter((r) => g.regions.includes(r.id))
      .map((r) => `<span><i class="dot" style="background:${r.color}"></i>${esc(r.name)}</span>`).join('') +
      (g.trust ? `<span><i class="dot" style="background:${g.trust.color}"></i>The Trust</span>` : '');
  }

  function onCityClick(cityId) {
    const g = game();
    if (g.phase === 'trustSetup') return act({ type: 'placeTrust', city: cityId });
    if (g.phase === 'build') {
      state.ui.quoteCity = cityId;
      renderAction();
    }
  }

  function plantCard(p, extra = '', tag = '') {
    const io = p.type === 'eco' ? `→ ${p.output} 🏠` : p.type === 'step3' ? '' : `${p.input} ${RES_ICON[p.type]} → ${p.output} 🏠`;
    return `<div class="plant ${p.type} ${extra}" data-plant="${p.n}" title="${TYPE_LABEL[p.type]}">
      <div class="n">${p.type === 'step3' ? 'Step 3' : String(p.n).padStart(2, '0')}</div>
      <div class="io">${io}</div>${tag ? `<span class="tag">${tag}</span>` : ''}
    </div>`;
  }

  function renderMarket() {
    const g = game();
    $('#deck-size').textContent = `(${g.deckSize} in stack)`;
    $('#market').innerHTML = g.market.map((p) => {
      const cls = [p.buyable ? '' : 'future', p.n === g.discount ? 'discount' : ''].join(' ');
      return plantCard(p, cls, p.n === g.discount ? 'min 1' : '');
    }).join('') || '<span class="muted">empty</span>';
  }

  function renderResMarket() {
    const g = game();
    $('#res-market').innerHTML = RES.map((r) => {
      const prices = state.data.slotPrices[r];
      const n = g.resMarket[r];
      const cells = prices.map((_, i) => `<i class="res-cell ${i >= prices.length - n ? 'full ' + r : ''}" title="${prices[i]}"></i>`).join('');
      const next = n ? `next: ${prices[prices.length - n]}` : 'sold out';
      return `<div class="res-row"><span class="name">${RES_ICON[r]} ${TYPE_LABEL[r]}</span><span class="res-track">${cells}</span><span class="res-price">${n} · ${next}</span></div>`;
    }).join('') + (g.uraniumPhaseOut ? '<div class="muted">Nuclear phase-out: no more uranium resupply.</div>' : '');
  }

  function renderPlayers() {
    const g = game();
    const seats = Object.fromEntries(state.room.players.map((p) => [p.id, p]));
    const list = g.trust ? [...g.players, g.trust] : g.players;
    $('#players').innerHTML = list.map((p) => {
      const isTrust = p.id === 'trust';
      const active = g.waitingOn.includes(p.id);
      const res = RES.filter((r) => p.res[r]).map((r) => `${p.res[r]}${RES_ICON[r]}`).join(' ');
      return `<div class="player ${active ? 'active' : ''}" style="border-color:${p.color}">
        <div class="head"><b>${esc(p.name)}${p.id === state.me ? ' (you)' : ''}</b>
          ${isTrust ? `<span class="muted">${p.housesLeft} houses left</span>` : `<span>💰 ${p.money}</span>`}
          ${!isTrust && seats[p.id] && !seats[p.id].connected ? '<span class="offline">offline</span>' : ''}</div>
        <div class="stats"><span>🏠 ${p.cities.length} cities</span>${isTrust ? '' : `<span>⚡ powered ${p.lastPowered}</span>`}<span>${res || 'no resources'}</span></div>
        <div class="plants">${p.plants.map((pl) => plantCard(pl)).join('')}</div>
      </div>`;
    }).join('');
  }

  function renderLog() {
    const g = game();
    if (!g) return;
    const entries = [
      ...g.log.map((l) => ({ at: 0, html: `<span class="round">R${l.round}</span>${esc(l.msg)}` })),
    ];
    const chat = state.chat.map((c) => `<div class="chat"><b style="color:${colorOf(c.playerId)}">${esc(c.from)}:</b> ${esc(c.text)}</div>`);
    const el = $('#log');
    el.innerHTML = entries.map((e) => `<div>${e.html}</div>`).join('') + chat.join('');
    el.scrollTop = el.scrollHeight;
  }

  // ---------- action panel ----------

  function renderAction() {
    const g = game();
    const el = $('#action');
    const me = myPlayer();
    if (g.phase === 'gameover') return renderGameOver(el);
    if (!isMyTurn()) {
      el.innerHTML = `<h3>Waiting</h3><p class="muted">${g.waitingOn.map(nameOf).join(', ')} ${g.waitingOn.length > 1 ? 'are' : 'is'} taking a turn.</p>`;
      return;
    }
    switch (g.phase) {
      case 'trustSetup':
        el.innerHTML = `<h3>Place a Trust house</h3><p class="muted">Click a city in the playing zone${g.trust.cities.length ? ' next to a city that already has a Trust house' : ''}.</p>`;
        break;
      case 'auction': renderAuction(el, g, me); break;
      case 'resources': renderResources(el, g, me); break;
      case 'build': renderBuild(el, g, me); break;
      case 'bureaucracy': renderPower(el, g, me); break;
      default: el.innerHTML = '';
    }
  }

  function renderAuction(el, g, me) {
    const a = g.auction;
    if (a.pendingDiscard === state.me) {
      el.innerHTML = `<h3>Too many plants</h3><p class="muted">Pick one of your older plants to scrap.</p>
        <div class="plants">${me.plants.filter((p) => p.n !== a.justBought).map((p) => plantCard(p, 'clickable')).join('')}</div>`;
      el.querySelectorAll('.plant').forEach((c) => { c.onclick = () => act({ type: 'discardPlant', plant: +c.dataset.plant }); });
      return;
    }
    if (a.current) {
      const c = a.current;
      const min = c.bid + 1;
      el.innerHTML = `<h3>Auction: plant ${c.plant}</h3>
        <p>High bid <b>${c.bid}</b> by ${esc(nameOf(c.high))}. You have ${me.money}.</p>
        <div class="row"><input id="bid" type="number" min="${min}" max="${me.money}" value="${Math.min(min, me.money)}">
        <button id="bid-btn" class="primary" ${min > me.money ? 'disabled' : ''}>Bid</button><button id="pass-bid">Pass</button></div>`;
      $('#bid-btn').onclick = () => act({ type: 'bid', amount: +$('#bid').value });
      $('#pass-bid').onclick = () => act({ type: 'passBid' });
      return;
    }
    const buyable = g.market.filter((p) => p.buyable);
    const sel = state.ui.bid?.plant && buyable.find((p) => p.n === state.ui.bid.plant) ? state.ui.bid.plant : buyable[0]?.n;
    const plant = buyable.find((p) => p.n === sel);
    const min = plant ? plant.minBid : 0;
    el.innerHTML = `<h3>Choose a plant to auction</h3>
      <p class="muted">You have ${me.money}. ${g.round === 1 ? 'Everyone must buy a plant in round 1.' : ''}</p>
      <div class="plants">${buyable.map((p) => plantCard(p, (p.n === sel ? 'selected ' : '') + 'clickable')).join('')}</div>
      <div class="row"><span>Opening bid</span><input id="open-bid" type="number" min="${min}" max="${me.money}" value="${min}">
        <button id="open-btn" class="primary" ${!plant || min > me.money ? 'disabled' : ''}>Start auction</button>
        <button id="pass-auction" ${g.round === 1 ? 'disabled' : ''}>Pass this round</button></div>`;
    el.querySelectorAll('.plant').forEach((c) => { c.onclick = () => { state.ui.bid = { plant: +c.dataset.plant }; renderAction(); }; });
    $('#open-btn').onclick = () => act({ type: 'startAuction', plant: sel, bid: +$('#open-bid').value });
    $('#pass-auction').onclick = () => act({ type: 'passAuction' });
  }

  function renderResources(el, g, me) {
    const order = state.ui.order;
    let total = 0;
    const rows = RES.map((r) => {
      const cost = resourceCost(r, g.resMarket[r], order[r]);
      total += cost ?? 0;
      return `<div class="res-row"><span class="name">${RES_ICON[r]} ${TYPE_LABEL[r]}</span>
        <span class="counter"><button class="small" data-r="${r}" data-d="-1">−</button><b>${order[r]}</b><button class="small" data-r="${r}" data-d="1">+</button></span>
        <span class="res-price">${cost === null ? 'n/a' : cost + ' €'}</span></div>`;
    }).join('');
    const next = { ...me.res };
    for (const r of RES) next[r] += order[r];
    const storable = canStore(me.plants, next);
    const caps = storageCaps(me.plants);
    el.innerHTML = `<h3>Buy resources</h3>
      <p class="muted">You have ${me.money}. Storage: ${caps.coal} coal, ${caps.oil} oil, ${caps.hybrid} coal/oil, ${caps.garbage} garbage, ${caps.uranium} uranium.</p>
      ${rows}
      <div class="row"><b>Total: ${total}</b> ${!storable ? '<span class="offline">exceeds storage</span>' : ''}
        <button id="buy" class="primary" ${!storable || total > me.money ? 'disabled' : ''}>Buy</button></div>`;
    el.querySelectorAll('[data-r]').forEach((b) => {
      b.onclick = () => {
        const r = b.dataset.r;
        order[r] = Math.max(0, Math.min(g.resMarket[r], order[r] + +b.dataset.d));
        renderAction();
      };
    });
    $('#buy').onclick = () => {
      act({ type: 'buyResources', order: { ...order } });
      state.ui.order = { coal: 0, oil: 0, garbage: 0, uranium: 0 };
    };
  }

  // Cheapest connection from my network to a target, through cities in play.
  function connectionCost(me, target) {
    if (!me.cities.length) return 0;
    const g = game();
    const map = state.data.maps[g.mapId];
    const active = new Set(g.activeCities);
    const dist = new Map(me.cities.map((c) => [c, 0]));
    const done = new Set();
    for (;;) {
      let best = null;
      for (const [c, d] of dist) if (!done.has(c) && (best === null || d < dist.get(best))) best = c;
      if (best === null) return Infinity;
      if (best === target) return dist.get(best);
      done.add(best);
      for (const e of map.edges) {
        const other = e.a === best ? e.b : e.b === best ? e.a : null;
        if (!other || !active.has(other)) continue;
        const nd = dist.get(best) + e.cost;
        if (!dist.has(other) || nd < dist.get(other)) dist.set(other, nd);
      }
    }
  }

  function renderBuild(el, g, me) {
    const map = state.data.maps[g.mapId];
    let quote = '';
    const cityId = state.ui.quoteCity;
    if (cityId) {
      const city = map.cities.find((c) => c.id === cityId);
      const slots = g.citySlots[cityId];
      let slot = -1;
      for (let i = 0; i < g.step; i++) if (slots[i] === null) { slot = i; break; }
      if (me.cities.includes(cityId)) quote = `<div class="quote">You already have a house in ${esc(city.name)}.</div>`;
      else if (slot < 0) quote = `<div class="quote">${esc(city.name)} has no free space in Step ${g.step}.</div>`;
      else {
        const conn = connectionCost(me, cityId);
        const building = state.data.citySlotCost[slot];
        const total = conn + building;
        quote = `<div class="quote"><b>${esc(city.name)}</b>: connection ${conn} + house ${building} = <b>${total}</b>
          <button id="build-btn" class="primary small" ${total > me.money ? 'disabled' : ''}>Build</button></div>`;
      }
    }
    el.innerHTML = `<h3>Build houses</h3>
      <p class="muted">You have ${me.money}. Click a city on the map to see its price.${g.builtThisTurn.length ? ` Built this turn: ${g.builtThisTurn.length}.` : ''}</p>
      ${quote}
      <div class="row"><button id="end-build">${g.builtThisTurn.length ? 'Done building' : 'Build nothing'}</button></div>`;
    const b = $('#build-btn');
    if (b) b.onclick = () => { act({ type: 'build', city: cityId }); state.ui.quoteCity = null; };
    $('#end-build').onclick = () => { act({ type: 'endBuild' }); state.ui.quoteCity = null; };
  }

  function renderPower(el, g, me) {
    const fire = state.ui.fire;
    const hc = state.ui.hybridCoal;
    const use = { coal: 0, oil: 0, garbage: 0, uranium: 0 };
    let capacity = 0;
    const hybrids = [];
    for (const p of me.plants) {
      if (!fire.has(p.n)) continue;
      capacity += p.output;
      if (p.type === 'hybrid') hybrids.push(p);
      else if (p.type !== 'eco') use[p.type] += p.input;
    }
    for (const h of hybrids) {
      const coal = Math.max(0, Math.min(h.input, hc[h.n] ?? Math.min(h.input, me.res.coal - use.coal)));
      hc[h.n] = coal;
      use.coal += coal; use.oil += h.input - coal;
    }
    const ok = RES.every((r) => use[r] <= me.res[r]);
    const powered = Math.min(capacity, me.cities.length);
    const income = g.endTriggered ? null : state.data.payment[Math.min(powered, 20)];
    el.innerHTML = `<h3>Power your cities</h3>
      <p class="muted">Select the plants to run. You have ${me.cities.length} cities and ${RES.map((r) => `${me.res[r]}${RES_ICON[r]}`).join(' ')}.</p>
      <div class="plants">${me.plants.map((p) => plantCard(p, (fire.has(p.n) ? 'selected ' : '') + 'clickable')).join('')}</div>
      ${hybrids.map((h) => `<div class="row"><span>Plant ${h.n} coal:</span><input type="number" data-h="${h.n}" min="0" max="${h.input}" value="${hc[h.n]}"><span class="muted">oil: ${h.input - hc[h.n]}</span></div>`).join('')}
      <div class="quote">Powers <b>${powered}</b> of ${me.cities.length} cities${income === null ? ' (final round: no income)' : ` → earn <b>${income}</b>`}
        ${!ok ? '<div class="offline">Not enough resources for that selection.</div>' : ''}</div>
      <div class="row"><button id="power-btn" class="primary" ${ok ? '' : 'disabled'}>Confirm</button></div>`;
    el.querySelectorAll('.plant').forEach((c) => {
      c.onclick = () => { const n = +c.dataset.plant; if (fire.has(n)) fire.delete(n); else fire.add(n); renderAction(); };
    });
    el.querySelectorAll('[data-h]').forEach((i) => { i.onchange = () => { hc[+i.dataset.h] = +i.value; renderAction(); }; });
    $('#power-btn').onclick = () => {
      act({ type: 'power', plants: [...fire], hybridCoal: { ...hc } });
      state.ui.fire = new Set();
      state.ui.hybridCoal = {};
    };
  }

  // Largest-first greedy pick of plants the player can fuel right now.
  function defaultFiring(me) {
    const left = { ...me.res };
    const fire = new Set();
    for (const p of [...me.plants].sort((a, b) => b.output - a.output)) {
      if (p.type === 'eco') { fire.add(p.n); continue; }
      if (p.type === 'hybrid') {
        if (left.coal + left.oil < p.input) continue;
        const coal = Math.min(p.input, left.coal);
        left.coal -= coal; left.oil -= p.input - coal;
        state.ui.hybridCoal[p.n] = coal;
      } else {
        if (left[p.type] < p.input) continue;
        left[p.type] -= p.input;
      }
      fire.add(p.n);
    }
    return fire;
  }

  function renderGameOver(el) {
    const g = game();
    el.innerHTML = `<h3>Game over</h3><ol class="ranking">${g.ranking.map((id) => {
      const p = playerById(id);
      return `<li><b style="color:${p.color}">${esc(p.name)}</b> — powered ${p.lastPowered}, ${p.money} Elektro, ${p.cities.length} cities</li>`;
    }).join('')}</ol><div class="row"><button id="back-home">Back to home</button></div>`;
    $('#back-home').onclick = () => { emit('leave', {}); clearSession(); state.room = null; show('home'); };
  }

  // Pre-select all plants the first time the Bureaucracy phase renders.
  socket.on('room', (room) => {
    const g = room.game;
    if (g?.phase === 'bureaucracy' && !g.powered.includes(state.me) && !renderGame.preselected) {
      const me = g.players.find((p) => p.id === state.me);
      if (me) state.ui.fire = defaultFiring(me);
      renderGame.preselected = true;
      renderAction();
    }
    if (g?.phase !== 'bureaucracy') renderGame.preselected = false;
  });

  // ---------- boot ----------

  fetch('/api/static-data').then((r) => r.json()).then((data) => {
    state.data = data;
    try {
      const saved = JSON.parse(localStorage.getItem('pg-session'));
      if (saved?.code && saved?.token) {
        state.code = saved.code;
        state.token = saved.token;
        socket.emit('rejoin', saved, (res) => { if (!res.ok) clearSession(); });
      }
    } catch {}
  });
})();
