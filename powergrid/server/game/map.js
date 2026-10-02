// An original USA map: 42 cities in 6 regions of 7, positioned from real
// coordinates. Connection costs are derived from on-map distance.

export const REGIONS = [
  { id: 'nw', name: 'Northwest', color: '#9c6ade' },
  { id: 'sw', name: 'Southwest', color: '#26a6b8' },
  { id: 'central', name: 'Central', color: '#d9534f' },
  { id: 'south', name: 'South', color: '#e0b030' },
  { id: 'se', name: 'Southeast', color: '#a0703c' },
  { id: 'ne', name: 'Northeast', color: '#4caf50' },
];

const RAW_CITIES = [
  // [name, region, lon, lat]
  ['Seattle', 'nw', -122.3, 47.6],
  ['Portland', 'nw', -122.7, 45.5],
  ['Boise', 'nw', -116.2, 43.6],
  ['Billings', 'nw', -108.5, 45.8],
  ['Salt Lake City', 'nw', -111.9, 40.8],
  ['Cheyenne', 'nw', -104.8, 41.4],
  ['Denver', 'nw', -105.0, 39.4],
  ['San Francisco', 'sw', -122.4, 37.8],
  ['Reno', 'sw', -119.8, 39.5],
  ['Los Angeles', 'sw', -118.2, 34.0],
  ['San Diego', 'sw', -117.2, 32.5],
  ['Las Vegas', 'sw', -115.1, 36.2],
  ['Phoenix', 'sw', -112.0, 33.4],
  ['Santa Fe', 'sw', -105.9, 35.7],
  ['Fargo', 'central', -96.8, 46.9],
  ['Duluth', 'central', -92.1, 46.8],
  ['Minneapolis', 'central', -93.3, 44.9],
  ['Des Moines', 'central', -93.6, 41.6],
  ['Omaha', 'central', -96.0, 41.3],
  ['Kansas City', 'central', -94.6, 39.1],
  ['St. Louis', 'central', -90.2, 38.6],
  ['Oklahoma City', 'south', -97.5, 35.5],
  ['Dallas', 'south', -96.8, 32.8],
  ['Houston', 'south', -95.4, 29.8],
  ['San Antonio', 'south', -98.5, 29.4],
  ['Little Rock', 'south', -92.3, 34.7],
  ['Memphis', 'south', -89.6, 35.6],
  ['New Orleans', 'south', -90.1, 30.0],
  ['Nashville', 'se', -86.8, 36.2],
  ['Atlanta', 'se', -84.4, 33.7],
  ['Raleigh', 'se', -78.6, 35.8],
  ['Savannah', 'se', -81.1, 32.1],
  ['Jacksonville', 'se', -81.7, 30.3],
  ['Tampa', 'se', -82.5, 28.0],
  ['Miami', 'se', -80.2, 25.8],
  ['Chicago', 'ne', -87.6, 41.9],
  ['Detroit', 'ne', -83.0, 42.3],
  ['Pittsburgh', 'ne', -80.0, 40.4],
  ['Washington', 'ne', -77.2, 38.7],
  ['Philadelphia', 'ne', -75.6, 40.0],
  ['New York', 'ne', -73.6, 41.1],
  ['Boston', 'ne', -71.1, 42.6],
];

const RAW_EDGES = [
  ['Seattle', 'Portland'], ['Seattle', 'Boise'], ['Seattle', 'Billings'],
  ['Portland', 'Boise'], ['Portland', 'San Francisco'],
  ['Boise', 'Billings'], ['Boise', 'Salt Lake City'], ['Boise', 'Reno'],
  ['Billings', 'Cheyenne'], ['Billings', 'Fargo'],
  ['Salt Lake City', 'Cheyenne'], ['Salt Lake City', 'Denver'],
  ['Salt Lake City', 'Reno'], ['Salt Lake City', 'Las Vegas'],
  ['Cheyenne', 'Denver'], ['Cheyenne', 'Omaha'],
  ['Denver', 'Santa Fe'], ['Denver', 'Kansas City'],
  ['San Francisco', 'Reno'], ['San Francisco', 'Los Angeles'],
  ['Reno', 'Las Vegas'], ['Los Angeles', 'San Diego'], ['Los Angeles', 'Las Vegas'],
  ['San Diego', 'Phoenix'], ['Las Vegas', 'Phoenix'], ['Phoenix', 'Santa Fe'],
  ['Santa Fe', 'Oklahoma City'], ['Phoenix', 'San Antonio'],
  ['Fargo', 'Duluth'], ['Fargo', 'Minneapolis'], ['Duluth', 'Minneapolis'],
  ['Duluth', 'Chicago'], ['Minneapolis', 'Des Moines'], ['Minneapolis', 'Chicago'],
  ['Omaha', 'Des Moines'], ['Omaha', 'Kansas City'], ['Des Moines', 'Chicago'],
  ['Des Moines', 'St. Louis'], ['Kansas City', 'St. Louis'],
  ['Kansas City', 'Oklahoma City'], ['St. Louis', 'Chicago'],
  ['St. Louis', 'Memphis'], ['St. Louis', 'Nashville'],
  ['Oklahoma City', 'Dallas'], ['Oklahoma City', 'Little Rock'],
  ['Dallas', 'Houston'], ['Dallas', 'San Antonio'], ['Dallas', 'Little Rock'],
  ['Houston', 'San Antonio'], ['Houston', 'New Orleans'],
  ['Little Rock', 'Memphis'], ['Memphis', 'New Orleans'], ['Memphis', 'Nashville'],
  ['New Orleans', 'Atlanta'], ['New Orleans', 'Jacksonville'],
  ['Nashville', 'Atlanta'], ['Nashville', 'Chicago'],
  ['Atlanta', 'Raleigh'], ['Atlanta', 'Savannah'],
  ['Raleigh', 'Savannah'], ['Raleigh', 'Washington'],
  ['Savannah', 'Jacksonville'], ['Jacksonville', 'Tampa'], ['Tampa', 'Miami'],
  ['Jacksonville', 'Miami'],
  ['Chicago', 'Detroit'], ['Detroit', 'Pittsburgh'], ['Pittsburgh', 'Washington'],
  ['Pittsburgh', 'Philadelphia'], ['Washington', 'Philadelphia'],
  ['Philadelphia', 'New York'], ['New York', 'Boston'], ['Pittsburgh', 'Nashville'],
];

export const MAP_WIDTH = 1000;
export const MAP_HEIGHT = 580;

const project = (lon, lat) => ({
  x: Math.round((lon + 125) * 17),
  y: Math.round((50 - lat) * 22),
});

const slug = (name) => name.toLowerCase().replace(/[^a-z]+/g, '-');

export const CITIES = RAW_CITIES.map(([name, region, lon, lat]) => ({
  id: slug(name),
  name,
  region,
  ...project(lon, lat),
}));

const cityById = Object.fromEntries(CITIES.map((c) => [c.id, c]));

export const EDGES = RAW_EDGES.map(([a, b]) => {
  const ca = cityById[slug(a)];
  const cb = cityById[slug(b)];
  if (!ca || !cb) throw new Error(`Bad edge ${a}-${b}`);
  const dist = Math.hypot(ca.x - cb.x, ca.y - cb.y);
  return { a: ca.id, b: cb.id, cost: Math.max(2, Math.round(dist / 11)) };
});

export function regionAdjacency() {
  const adj = Object.fromEntries(REGIONS.map((r) => [r.id, new Set()]));
  for (const e of EDGES) {
    const ra = cityById[e.a].region;
    const rb = cityById[e.b].region;
    if (ra !== rb) {
      adj[ra].add(rb);
      adj[rb].add(ra);
    }
  }
  return adj;
}

export { cityById };
