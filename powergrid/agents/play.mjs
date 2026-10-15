#!/usr/bin/env node
// Lets an LLM play one seat. Polls the game's HTTP API; whenever it is
// this seat's turn, sends the state and legal actions to the model and
// submits the action it picks. Needs only Node 18+ (built-in fetch).
//
//   node agents/play.mjs --provider openai --model gpt-5 --lobby ABCDE --name GPT
//   node agents/play.mjs --provider xai --model grok-4 --create --name Grok --bots 2
//   node agents/play.mjs --provider anthropic --model claude-sonnet-4-5 --lobby ABCDE
//
// Keys: ANTHROPIC_API_KEY, OPENAI_API_KEY, XAI_API_KEY in the environment,
// or in agents/keys.json as {"anthropic":"...","openai":"...","xai":"..."}.
// Server: --server https://powergrid.deanthoneeking.com (default: localhost:3000).

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]);
  return acc;
}, []));

const SERVER = (args.server || process.env.PG_SERVER || 'http://localhost:3000').replace(/\/$/, '');
const PROVIDER = args.provider || 'openai';
const MODEL = args.model || { openai: 'gpt-5', anthropic: 'claude-sonnet-4-5', xai: 'grok-4' }[PROVIDER];
const NAME = args.name || `${PROVIDER}-${MODEL}`.slice(0, 20);
const VERBOSE = !!args.verbose;

const here = path.dirname(fileURLToPath(import.meta.url));
const keysFile = path.join(here, 'keys.json');
const keys = existsSync(keysFile) ? JSON.parse(readFileSync(keysFile, 'utf8')) : {};
const KEY = {
  openai: process.env.OPENAI_API_KEY || keys.openai,
  anthropic: process.env.ANTHROPIC_API_KEY || keys.anthropic,
  xai: process.env.XAI_API_KEY || keys.xai,
}[PROVIDER];
if (!KEY && PROVIDER !== 'random') {
  console.error(`No API key for ${PROVIDER}. Set the env var or agents/keys.json.`);
  process.exit(1);
}

const log = (...m) => console.log(new Date().toISOString().slice(11, 19), `[${NAME}]`, ...m);

// ---------- game API ----------

let token = null;
async function api(method, route, body) {
  const res = await fetch(`${SERVER}/api/v1${route}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${res.status} ${route}`);
  return data;
}

// ---------- model calls ----------

const SYSTEM = `You are playing the board game Power Grid against other players. You will receive the rules, the current state from your seat, and the list of legal actions. Reply with ONLY a JSON object for your chosen action, exactly in the shape shown in legalActions / the action schema, with no commentary. Think about: fuel needed to run your plants, keeping cash for building, not outbuilding your capacity, and that going first is bad for buying.`;

async function askModel(prompt) {
  if (PROVIDER === 'random') return null;
  if (PROVIDER === 'anthropic') {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODEL, max_tokens: 400, system: SYSTEM, messages: [{ role: 'user', content: prompt }] }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`anthropic: ${JSON.stringify(data).slice(0, 300)}`);
    return data.content.map((c) => c.text || '').join('');
  }
  const base = PROVIDER === 'xai' ? 'https://api.x.ai/v1' : 'https://api.openai.com/v1';
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ model: MODEL, messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }] }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${PROVIDER}: ${JSON.stringify(data).slice(0, 300)}`);
  return data.choices[0].message.content;
}

function parseAction(textOut) {
  const m = textOut.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('no JSON in reply');
  return JSON.parse(m[0]);
}

// A legal fallback when the model's choice is rejected or unparseable.
function fallback(view) {
  const legal = view.legalActions;
  const has = (t) => legal.find((a) => a.type === t);
  if (has('passBid')) return { type: 'passBid' };
  if (has('passAuction')) return { type: 'passAuction' };
  if (has('startAuction')) { const p = has('startAuction').plants[0]; return { type: 'startAuction', plant: p.n, bid: p.minBid }; }
  if (has('discardPlant')) return { type: 'discardPlant', plant: has('discardPlant').plants[0] };
  if (has('buyResources')) return { type: 'buyResources', order: { coal: 0, oil: 0, garbage: 0, uranium: 0 } };
  if (has('endBuild')) return { type: 'endBuild' };
  if (has('power')) return { type: 'power', plants: [], hybridCoal: {} };
  if (has('placeTrust')) return { type: 'placeTrust', city: has('placeTrust').cities[0] };
  return null;
}

async function decide(view, rules, lastError) {
  const prompt = `RULES:\n${rules.rules}\n\nACTION SHAPES:\n${JSON.stringify(rules.actions)}\n\nSTATE (your seat):\n${JSON.stringify(view)}\n\n${lastError ? `Your previous action was rejected: ${lastError}. Choose a legal one.\n\n` : ''}Reply with one JSON action.`;
  const out = await askModel(prompt);
  if (out === null) return fallback(view);
  if (VERBOSE) log('model said:', out.slice(0, 200));
  return parseAction(out);
}

// ---------- main loop ----------

async function main() {
  const rules = await api('GET', '/rules');
  if (args.create) {
    const r = await api('POST', '/lobbies', { name: NAME, mapId: args.map });
    token = r.token;
    log(`created lobby ${r.code}`);
    for (let i = 0; i < Number(args.bots || 0); i++) await api('POST', '/bots');
    if (args.start) await api('POST', '/start');
    else log('share the code; start the game from the browser or with --start');
  } else {
    if (!args.lobby) { console.error('Need --lobby CODE or --create'); process.exit(1); }
    const r = await api('POST', `/lobbies/${String(args.lobby).toUpperCase()}/join`, { name: NAME });
    token = r.token;
    log(`joined lobby ${r.code}`);
  }

  let lastError = null;
  for (;;) {
    let view;
    try {
      view = await api('GET', '/wait?timeout=45');
    } catch (err) {
      log('wait failed:', err.message); await new Promise((r) => setTimeout(r, 3000)); continue;
    }
    if (view.gameOver) {
      const winner = view.players.find((p) => p.id === view.winner);
      log(`game over. Winner: ${winner?.name}. Ranking: ${view.ranking.map((id) => view.players.find((p) => p.id === id)?.name).join(' > ')}`);
      return;
    }
    if (!view.yourTurn) continue;
    let action;
    try {
      action = await decide(view, rules, lastError);
    } catch (err) {
      log('model error:', err.message);
      action = fallback(view);
    }
    try {
      const after = await api('POST', '/act', action);
      lastError = null;
      log(`${view.phase}: ${JSON.stringify(action)} ->`, after.log.at(-1) || '');
    } catch (err) {
      log('rejected:', err.message, 'for', JSON.stringify(action));
      if (lastError) {
        // Second rejection in a row: take the safe move so the game never stalls.
        const safe = fallback(view);
        await api('POST', '/act', safe).catch((e) => log('fallback rejected too:', e.message));
        lastError = null;
      } else {
        lastError = err.message;
      }
    }
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
