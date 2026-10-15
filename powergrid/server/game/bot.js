// A computer player. chooseAction(game, playerId) returns the action the
// bot wants to take whenever the game is waiting on it. The strategy is a
// set of simple heuristics: buy plants that pay for themselves, keep
// enough fuel to run them, expand to the cheapest cities, and keep a
// cash reserve for building.

import { RES_TYPES, PAYMENT } from './data.js';
import { canStore, resourceCost } from './engine.js';

export const BOT_NAMES = ['Tesla', 'Edison', 'Faraday', 'Volta', 'Ampère', 'Ohm'];

const capacity = (p) => p.plants.reduce((s, pl) => s + pl.output, 0);
const incomeFor = (cities) => PAYMENT[Math.min(cities, PAYMENT.length - 1)];

// Rough cost of one firing of a plant at today's prices.
function fuelCost(g, plant) {
  if (plant.type === 'eco') return 0;
  const price = (r) => resourceCost(r, g.resMarket[r], 1) ?? 12;
  if (plant.type === 'hybrid') return plant.input * Math.min(price('coal'), price('oil'));
  return plant.input * price(plant.type);
}

// How much a plant is worth to this player, as a maximum bid.
function plantValue(g, p, plant) {
  const cap = capacity(p);
  const target = Math.max(p.cities.length + 2, cap + 1);
  const gain = Math.min(plant.output, Math.max(0, target - cap)) + plant.output * 0.4;
  const roundsLeft = Math.max(3, 12 - g.round);
  let value = gain * 9 * Math.min(roundsLeft, 6) / 4 - fuelCost(g, plant) * 2;
  if (plant.type === 'uranium' && g.resMarket.uranium < 2) value *= 0.6;
  if (plant.type === 'eco') value += 8;
  // In round 1 everyone must buy; later, early plants are cheap upgrades.
  if (g.round === 1) value = Math.max(value, 20);
  return Math.floor(value);
}

function reserve(g, p) {
  // Keep money for building: more when the network is small.
  return p.cities.length < 3 ? 14 : 10;
}

function chooseAuction(g, p) {
  const a = g.auction;
  if (a.pendingDiscard === p.id) {
    const victims = p.plants.filter((x) => x.n !== a.justBought).sort((x, y) => x.output - y.output || x.n - y.n);
    return { type: 'discardPlant', plant: victims[0].n };
  }
  if (a.current) {
    const plant = g.market.find((x) => x.n === a.current.plant);
    const max = Math.min(p.money - (g.round === 1 ? 0 : reserve(g, p)), plantValue(g, p, plant));
    const next = a.current.bid + 1;
    if (next <= max) return { type: 'bid', amount: next };
    return { type: 'passBid' };
  }
  const options = g.actualMarket()
    .map((plant) => ({ plant, min: g.minimumBid(plant), value: plantValue(g, p, plant) }))
    .filter((o) => o.min <= p.money);
  if (!options.length) return g.round === 1 ? null : { type: 'passAuction' };
  const worth = options.filter((o) => o.value >= o.min + 2 && o.min <= p.money - (g.round === 1 ? 0 : reserve(g, p)));
  if (!worth.length) {
    if (g.round > 1) return { type: 'passAuction' };
    const cheapest = options.sort((x, y) => x.min - y.min)[0];
    return { type: 'startAuction', plant: cheapest.plant.n, bid: cheapest.min };
  }
  // Prefer the plant with the biggest surplus of value over price, and a bit of upside.
  worth.sort((x, y) => (y.value - y.min) - (x.value - x.min));
  const pick = worth[0];
  const needsUpgrade = capacity(p) <= p.cities.length && p.plants.length >= g.rules.maxPlants;
  if (needsUpgrade && pick.plant.output <= Math.min(...p.plants.map((x) => x.output))) return { type: 'passAuction' };
  return { type: 'startAuction', plant: pick.plant.n, bid: pick.min };
}

function chooseResources(g, p) {
  const order = { coal: 0, oil: 0, garbage: 0, uranium: 0 };
  const want = { coal: 0, oil: 0, garbage: 0, uranium: 0 };
  // Enough to fire every plant once, plus one spare firing if cheap.
  for (const pl of p.plants) {
    if (pl.type === 'eco') continue;
    const type = pl.type === 'hybrid'
      ? ((resourceCost('coal', g.resMarket.coal, pl.input) ?? 99) <= (resourceCost('oil', g.resMarket.oil, pl.input) ?? 99) ? 'coal' : 'oil')
      : pl.type;
    want[type] += pl.input * 2;
  }
  const budget = p.money - reserve(g, p);
  let spent = 0;
  // Fill the first firing for every plant before topping up spares.
  for (const pass of [0.5, 1]) {
    for (const r of RES_TYPES) {
      const target = Math.ceil(want[r] * pass) - p.res[r];
      while (order[r] < target) {
        const next = { ...p.res };
        for (const t of RES_TYPES) next[t] += order[t];
        next[r] += 1;
        const cost = resourceCost(r, g.resMarket[r] - order[r], 1);
        if (cost === null || spent + cost > budget || !canStore(p.plants, next)) break;
        order[r]++;
        spent += cost;
      }
    }
  }
  return { type: 'buyResources', order };
}

function chooseBuild(g, p) {
  const cap = capacity(p);
  const endCities = g.rules.endCities;
  // Don't build far beyond what can be powered, unless cash is piling up
  // (nothing better to spend it on) or the game can be closed out.
  const rich = p.money >= 120;
  const limit = rich ? endCities : Math.max(cap + 1, p.cities.length);
  const closing = p.cities.length >= endCities - 3 && (cap >= p.cities.length - 2 || rich);
  if (p.cities.length >= limit && !closing) return { type: 'endBuild' };
  let best = null;
  for (const city of g.activeCities) {
    let q;
    try { q = g.quoteBuild(p.id, city); } catch { continue; }
    if (!best || q.total < best.total) best = { city, total: q.total };
  }
  const keep = closing || rich ? 0 : reserve(g, p) - 4;
  if (best && best.total <= p.money - keep) return { type: 'build', city: best.city };
  return { type: 'endBuild' };
}

function choosePower(g, p) {
  const left = { ...p.res };
  const plants = [];
  const hybridCoal = {};
  let powered = 0;
  for (const pl of [...p.plants].sort((a, b) => b.output - a.output)) {
    if (powered >= p.cities.length) break;
    if (pl.type === 'eco') { plants.push(pl.n); powered += pl.output; continue; }
    if (pl.type === 'hybrid') {
      if (left.coal + left.oil < pl.input) continue;
      const coal = Math.min(pl.input, left.coal);
      left.coal -= coal; left.oil -= pl.input - coal;
      hybridCoal[pl.n] = coal;
    } else {
      if (left[pl.type] < pl.input) continue;
      left[pl.type] -= pl.input;
    }
    plants.push(pl.n);
    powered += pl.output;
  }
  return { type: 'power', plants, hybridCoal };
}

function chooseTrustSetup(g, p) {
  const options = [...g.activeCities].filter((c) => {
    if (g.citySlots[c][0]) return false;
    return !g.trust.cities.length || g.neighbors[c].some((n) => g.trust.cities.includes(n.city));
  });
  return { type: 'placeTrust', city: options[Math.floor(g.rand() * options.length)] };
}

export function chooseAction(g, playerId) {
  const p = g.player(playerId);
  switch (g.phase) {
    case 'trustSetup': return chooseTrustSetup(g, p);
    case 'auction': return chooseAuction(g, p);
    case 'resources': return chooseResources(g, p);
    case 'build': return chooseBuild(g, p);
    case 'bureaucracy': return choosePower(g, p);
    default: return null;
  }
}

// Fallback when the chosen action is rejected by the rules.
export function safeAction(g, playerId) {
  const p = g.player(playerId);
  switch (g.phase) {
    case 'trustSetup': return chooseTrustSetup(g, p);
    case 'auction': {
      const a = g.auction;
      if (a.pendingDiscard === playerId) return { type: 'discardPlant', plant: p.plants.find((x) => x.n !== a.justBought).n };
      if (a.current) return { type: 'passBid' };
      if (g.round > 1) return { type: 'passAuction' };
      const cheapest = g.actualMarket().sort((x, y) => g.minimumBid(x) - g.minimumBid(y))[0];
      return { type: 'startAuction', plant: cheapest.n, bid: g.minimumBid(cheapest) };
    }
    case 'resources': return { type: 'buyResources', order: {} };
    case 'build': return { type: 'endBuild' };
    case 'bureaucracy': return { type: 'power', plants: [], hybridCoal: {} };
    default: return null;
  }
}

export { incomeFor };
