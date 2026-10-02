// Game maps. Each map has 42 cities in 6 regions of 7, plus the connections
// between them. Germany is transcribed from the Recharged board; USA is an
// original layout positioned from real coordinates.

const slug = (name) => name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]+/g, '-');

function buildMap({ id, name, regions, cities, edges, width, height }) {
  const cityList = cities.map(([cityName, region, x, y]) => ({ id: slug(cityName), name: cityName, region, x, y }));
  const byId = Object.fromEntries(cityList.map((c) => [c.id, c]));
  const edgeList = edges.map(([a, b, cost]) => {
    const ca = byId[slug(a)];
    const cb = byId[slug(b)];
    if (!ca || !cb) throw new Error(`Bad edge ${a}-${b} on map ${id}`);
    return { a: ca.id, b: cb.id, cost: cost ?? Math.max(2, Math.round(Math.hypot(ca.x - cb.x, ca.y - cb.y) / 11)) };
  });
  return { id, name, regions, cities: cityList, edges: edgeList, width, height, cityById: byId };
}

const GERMANY = buildMap({
  id: 'germany',
  name: 'Germany',
  width: 1260,
  height: 1680,
  regions: [
    { id: 'teal', name: 'North Sea', color: '#3fa39b' },
    { id: 'orange', name: 'Baltic', color: '#d27a4f' },
    { id: 'red', name: 'Ruhr', color: '#c8555f' },
    { id: 'yellow', name: 'Saxony', color: '#c2b244' },
    { id: 'blue', name: 'Rhine', color: '#6b87b8' },
    { id: 'purple', name: 'Bavaria', color: '#9a6cc0' },
  ],
  cities: [
    ['Flensburg', 'teal', 510, 30], ['Kiel', 'teal', 590, 135], ['Cuxhaven', 'teal', 425, 235],
    ['Wilhelmshaven', 'teal', 340, 305], ['Hamburg', 'teal', 580, 290], ['Bremen', 'teal', 455, 395],
    ['Hannover', 'teal', 590, 550],
    ['Lübeck', 'orange', 690, 195], ['Rostock', 'orange', 845, 155], ['Schwerin', 'orange', 770, 290],
    ['Stralsund', 'orange', 1110, 265], ['Berlin', 'orange', 1030, 490], ['Magdeburg', 'orange', 835, 560],
    ['Frankfurt-O', 'orange', 1170, 560],
    ['Osnabrück', 'red', 350, 530], ['Münster', 'red', 280, 630], ['Duisburg', 'red', 90, 680],
    ['Essen', 'red', 185, 725], ['Dortmund', 'red', 305, 770], ['Düsseldorf', 'red', 120, 820],
    ['Kassel', 'red', 530, 800],
    ['Erfurt', 'yellow', 770, 840], ['Halle', 'yellow', 860, 740], ['Leipzig', 'yellow', 940, 770],
    ['Dresden', 'yellow', 1130, 845], ['Fulda', 'yellow', 590, 935], ['Würzburg', 'yellow', 625, 1120],
    ['Nürnberg', 'yellow', 785, 1195],
    ['Köln', 'blue', 205, 900], ['Aachen', 'blue', 80, 950], ['Trier', 'blue', 140, 1140],
    ['Mainz', 'blue', 370, 1080], ['Frankfurt-M', 'blue', 460, 1025], ['Mannheim', 'blue', 445, 1250],
    ['Saarbrücken', 'blue', 260, 1280],
    ['Stuttgart', 'purple', 495, 1380], ['Freiburg', 'purple', 320, 1540], ['Konstanz', 'purple', 495, 1590],
    ['Augsburg', 'purple', 715, 1400], ['München', 'purple', 860, 1500], ['Regensburg', 'purple', 890, 1295],
    ['Passau', 'purple', 1105, 1335],
  ],
  edges: [
    ['Flensburg', 'Kiel', 4], ['Kiel', 'Hamburg', 8], ['Kiel', 'Lübeck', 4],
    ['Cuxhaven', 'Hamburg', 11], ['Cuxhaven', 'Bremen', 8], ['Wilhelmshaven', 'Bremen', 11],
    ['Wilhelmshaven', 'Osnabrück', 14], ['Hamburg', 'Bremen', 11], ['Hamburg', 'Lübeck', 6],
    ['Hamburg', 'Schwerin', 8], ['Hamburg', 'Hannover', 17], ['Bremen', 'Osnabrück', 11],
    ['Bremen', 'Hannover', 10], ['Lübeck', 'Schwerin', 6], ['Rostock', 'Schwerin', 6],
    ['Rostock', 'Stralsund', 19], ['Schwerin', 'Stralsund', 19], ['Schwerin', 'Hannover', 19],
    ['Schwerin', 'Magdeburg', 16], ['Schwerin', 'Berlin', 18], ['Stralsund', 'Berlin', 15],
    ['Berlin', 'Magdeburg', 10], ['Berlin', 'Frankfurt-O', 6], ['Berlin', 'Halle', 17],
    ['Frankfurt-O', 'Leipzig', 21], ['Frankfurt-O', 'Dresden', 16], ['Magdeburg', 'Hannover', 15],
    ['Magdeburg', 'Halle', 11], ['Halle', 'Leipzig', 0], ['Halle', 'Erfurt', 6],
    ['Leipzig', 'Dresden', 13], ['Erfurt', 'Dresden', 19], ['Hannover', 'Osnabrück', 16],
    ['Hannover', 'Kassel', 15], ['Hannover', 'Erfurt', 19], ['Osnabrück', 'Münster', 7],
    ['Osnabrück', 'Kassel', 20], ['Münster', 'Essen', 6], ['Münster', 'Dortmund', 2],
    ['Duisburg', 'Essen', 0], ['Essen', 'Dortmund', 5], ['Essen', 'Düsseldorf', 2],
    ['Dortmund', 'Kassel', 18], ['Dortmund', 'Köln', 10], ['Dortmund', 'Frankfurt-M', 20],
    ['Düsseldorf', 'Köln', 4], ['Düsseldorf', 'Aachen', 9], ['Köln', 'Aachen', 7],
    ['Köln', 'Trier', 20], ['Köln', 'Mainz', 21], ['Aachen', 'Trier', 19],
    ['Trier', 'Mainz', 18], ['Trier', 'Saarbrücken', 11], ['Kassel', 'Frankfurt-M', 13],
    ['Kassel', 'Fulda', 8], ['Kassel', 'Erfurt', 15], ['Mainz', 'Frankfurt-M', 0],
    ['Mainz', 'Mannheim', 11], ['Mainz', 'Saarbrücken', 10], ['Frankfurt-M', 'Fulda', 8],
    ['Frankfurt-M', 'Würzburg', 13], ['Fulda', 'Würzburg', 11], ['Fulda', 'Erfurt', 13],
    ['Erfurt', 'Nürnberg', 21], ['Saarbrücken', 'Mannheim', 16], ['Saarbrücken', 'Stuttgart', 17],
    ['Mannheim', 'Würzburg', 10], ['Mannheim', 'Stuttgart', 6], ['Würzburg', 'Nürnberg', 8],
    ['Würzburg', 'Stuttgart', 12], ['Würzburg', 'Augsburg', 19], ['Nürnberg', 'Augsburg', 18],
    ['Nürnberg', 'Regensburg', 12], ['Stuttgart', 'Augsburg', 15], ['Stuttgart', 'Freiburg', 16],
    ['Stuttgart', 'Konstanz', 16], ['Freiburg', 'Konstanz', 14], ['Konstanz', 'Augsburg', 17],
    ['Augsburg', 'Regensburg', 13], ['Augsburg', 'München', 6], ['Regensburg', 'München', 10],
    ['Regensburg', 'Passau', 12], ['München', 'Passau', 14],
  ],
});

const usaPoint = (lon, lat) => [Math.round((lon + 125) * 17), Math.round((50 - lat) * 22)];
const usaCity = (name, region, lon, lat) => [name, region, ...usaPoint(lon, lat)];

const USA = buildMap({
  id: 'usa',
  name: 'USA',
  width: 1000,
  height: 580,
  regions: [
    { id: 'nw', name: 'Northwest', color: '#9c6ade' },
    { id: 'sw', name: 'Southwest', color: '#26a6b8' },
    { id: 'central', name: 'Central', color: '#d9534f' },
    { id: 'south', name: 'South', color: '#e0b030' },
    { id: 'se', name: 'Southeast', color: '#a0703c' },
    { id: 'ne', name: 'Northeast', color: '#4caf50' },
  ],
  cities: [
    usaCity('Seattle', 'nw', -122.3, 47.6), usaCity('Portland', 'nw', -122.7, 45.5),
    usaCity('Boise', 'nw', -116.2, 43.6), usaCity('Billings', 'nw', -108.5, 45.8),
    usaCity('Salt Lake City', 'nw', -111.9, 40.8), usaCity('Cheyenne', 'nw', -104.8, 41.4),
    usaCity('Denver', 'nw', -105.0, 39.4),
    usaCity('San Francisco', 'sw', -122.4, 37.8), usaCity('Reno', 'sw', -119.8, 39.5),
    usaCity('Los Angeles', 'sw', -118.2, 34.0), usaCity('San Diego', 'sw', -117.2, 32.5),
    usaCity('Las Vegas', 'sw', -115.1, 36.2), usaCity('Phoenix', 'sw', -112.0, 33.4),
    usaCity('Santa Fe', 'sw', -105.9, 35.7),
    usaCity('Fargo', 'central', -96.8, 46.9), usaCity('Duluth', 'central', -92.1, 46.8),
    usaCity('Minneapolis', 'central', -93.3, 44.9), usaCity('Des Moines', 'central', -93.6, 41.6),
    usaCity('Omaha', 'central', -96.0, 41.3), usaCity('Kansas City', 'central', -94.6, 39.1),
    usaCity('St. Louis', 'central', -90.2, 38.6),
    usaCity('Oklahoma City', 'south', -97.5, 35.5), usaCity('Dallas', 'south', -96.8, 32.8),
    usaCity('Houston', 'south', -95.4, 29.8), usaCity('San Antonio', 'south', -98.5, 29.4),
    usaCity('Little Rock', 'south', -92.3, 34.7), usaCity('Memphis', 'south', -89.6, 35.6),
    usaCity('New Orleans', 'south', -90.1, 30.0),
    usaCity('Nashville', 'se', -86.8, 36.2), usaCity('Atlanta', 'se', -84.4, 33.7),
    usaCity('Raleigh', 'se', -78.6, 35.8), usaCity('Savannah', 'se', -81.1, 32.1),
    usaCity('Jacksonville', 'se', -81.7, 30.3), usaCity('Tampa', 'se', -82.5, 28.0),
    usaCity('Miami', 'se', -80.2, 25.8),
    usaCity('Chicago', 'ne', -87.6, 41.9), usaCity('Detroit', 'ne', -83.0, 42.3),
    usaCity('Pittsburgh', 'ne', -80.0, 40.4), usaCity('Washington', 'ne', -77.2, 38.7),
    usaCity('Philadelphia', 'ne', -75.6, 40.0), usaCity('New York', 'ne', -73.6, 41.1),
    usaCity('Boston', 'ne', -71.1, 42.6),
  ],
  // Costs are derived from distance when not given.
  edges: [
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
  ],
});

export const MAPS = { germany: GERMANY, usa: USA };
export const DEFAULT_MAP = 'germany';

export function getMap(id) {
  const map = Object.hasOwn(MAPS, id) ? MAPS[id] : null;
  if (!map) throw new Error(`Unknown map ${id}`);
  return map;
}

export function regionAdjacency(map) {
  const adj = Object.fromEntries(map.regions.map((r) => [r.id, new Set()]));
  for (const e of map.edges) {
    const ra = map.cityById[e.a].region;
    const rb = map.cityById[e.b].region;
    if (ra !== rb) {
      adj[ra].add(rb);
      adj[rb].add(ra);
    }
  }
  return adj;
}

// Public description of a map for clients.
export function mapView(map) {
  const { id, name, regions, cities, edges, width, height } = map;
  return { id, name, regions, cities, edges, width, height };
}
