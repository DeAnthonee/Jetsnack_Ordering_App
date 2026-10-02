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

// USA, transcribed from the Recharged board. Pixel positions are taken
// from the board photo so the layout matches the printed map.
const USA_REGIONS = [
  { id: 'purple', name: 'Northwest', color: '#9c6ade' },
  { id: 'teal', name: 'Southwest', color: '#3fa39b' },
  { id: 'yellow', name: 'Midwest', color: '#c2b244' },
  { id: 'red', name: 'South', color: '#c8555f' },
  { id: 'green', name: 'Southeast', color: '#6aa84f' },
  { id: 'orange', name: 'Northeast', color: '#d27a4f' },
];

const USA_CITIES = [
  ['Seattle', 'purple', 120, 60], ['Portland', 'purple', 70, 150], ['Boise', 'purple', 300, 230],
  ['Billings', 'purple', 560, 150], ['Cheyenne', 'purple', 680, 330], ['Denver', 'purple', 650, 430],
  ['Omaha', 'purple', 920, 330],
  ['San Francisco', 'teal', 70, 470], ['Los Angeles', 'teal', 190, 640], ['San Diego', 'teal', 260, 720],
  ['Las Vegas', 'teal', 330, 540], ['Salt Lake City', 'teal', 430, 370], ['Phoenix', 'teal', 440, 660],
  ['Santa Fe', 'teal', 620, 570],
  ['Fargo', 'yellow', 900, 150], ['Duluth', 'yellow', 1040, 90], ['Minneapolis', 'yellow', 1020, 210],
  ['Chicago', 'yellow', 1180, 310], ['St. Louis', 'yellow', 1120, 460], ['Cincinnati', 'yellow', 1340, 430],
  ['Knoxville', 'yellow', 1320, 560],
  ['Kansas City', 'red', 950, 460], ['Oklahoma City', 'red', 880, 580], ['Dallas', 'red', 920, 690],
  ['Houston', 'red', 960, 820], ['Memphis', 'red', 1120, 600], ['Birmingham', 'red', 1230, 700],
  ['New Orleans', 'red', 1130, 810],
  ['Atlanta', 'green', 1340, 690], ['Raleigh', 'green', 1550, 600], ['Norfolk', 'green', 1670, 550],
  ['Savannah', 'green', 1460, 740], ['Jacksonville', 'green', 1450, 830], ['Tampa', 'green', 1390, 940],
  ['Miami', 'green', 1510, 1020],
  ['Detroit', 'orange', 1350, 290], ['Buffalo', 'orange', 1540, 210], ['Pittsburgh', 'orange', 1500, 350],
  ['Washington', 'orange', 1590, 470], ['Philadelphia', 'orange', 1700, 410], ['New York', 'orange', 1760, 310],
  ['Boston', 'orange', 1830, 200],
];

const USA_EDGES = [
  ['Seattle', 'Portland', 3], ['Seattle', 'Boise', 12], ['Seattle', 'Billings', 9],
  ['Portland', 'Boise', 13], ['Portland', 'San Francisco', 24],
  ['Boise', 'Billings', 12], ['Boise', 'Cheyenne', 21], ['Boise', 'Salt Lake City', 8],
  ['Boise', 'San Francisco', 23],
  ['Billings', 'Cheyenne', 9], ['Billings', 'Fargo', 17], ['Billings', 'Minneapolis', 18],
  ['Cheyenne', 'Denver', 0], ['Cheyenne', 'Minneapolis', 18], ['Cheyenne', 'Omaha', 14],
  ['Denver', 'Salt Lake City', 21], ['Denver', 'Santa Fe', 13], ['Denver', 'Kansas City', 16],
  ['Omaha', 'Minneapolis', 8], ['Omaha', 'Chicago', 13], ['Omaha', 'Kansas City', 5],
  ['San Francisco', 'Salt Lake City', 27], ['San Francisco', 'Las Vegas', 14],
  ['San Francisco', 'Los Angeles', 9],
  ['Los Angeles', 'Las Vegas', 9], ['Los Angeles', 'San Diego', 3],
  ['San Diego', 'Las Vegas', 9], ['San Diego', 'Phoenix', 14],
  ['Las Vegas', 'Salt Lake City', 18], ['Las Vegas', 'Phoenix', 15], ['Las Vegas', 'Santa Fe', 27],
  ['Salt Lake City', 'Santa Fe', 28],
  ['Phoenix', 'Santa Fe', 18],
  ['Santa Fe', 'Kansas City', 16], ['Santa Fe', 'Oklahoma City', 15], ['Santa Fe', 'Dallas', 16],
  ['Santa Fe', 'Houston', 20],
  ['Fargo', 'Duluth', 6], ['Fargo', 'Minneapolis', 6],
  ['Duluth', 'Minneapolis', 5], ['Duluth', 'Detroit', 15],
  ['Minneapolis', 'Chicago', 8],
  ['Chicago', 'Detroit', 7], ['Chicago', 'Cincinnati', 7], ['Chicago', 'St. Louis', 10],
  ['Chicago', 'Kansas City', 8],
  ['St. Louis', 'Kansas City', 6], ['St. Louis', 'Cincinnati', 12], ['St. Louis', 'Memphis', 7],
  ['St. Louis', 'Atlanta', 12],
  ['Cincinnati', 'Detroit', 4], ['Cincinnati', 'Pittsburgh', 7], ['Cincinnati', 'Raleigh', 15],
  ['Cincinnati', 'Knoxville', 6],
  ['Knoxville', 'Atlanta', 5],
  ['Kansas City', 'Oklahoma City', 8], ['Kansas City', 'Memphis', 12],
  ['Oklahoma City', 'Dallas', 3], ['Oklahoma City', 'Memphis', 14],
  ['Dallas', 'Houston', 5], ['Dallas', 'Memphis', 12], ['Dallas', 'New Orleans', 12],
  ['Houston', 'New Orleans', 8],
  ['Memphis', 'New Orleans', 7], ['Memphis', 'Birmingham', 6],
  ['Birmingham', 'New Orleans', 11], ['Birmingham', 'Atlanta', 3], ['Birmingham', 'Jacksonville', 9],
  ['New Orleans', 'Jacksonville', 16],
  ['Atlanta', 'Raleigh', 7], ['Atlanta', 'Savannah', 7],
  ['Raleigh', 'Norfolk', 3], ['Raleigh', 'Savannah', 7], ['Raleigh', 'Pittsburgh', 7],
  ['Norfolk', 'Washington', 5],
  ['Savannah', 'Jacksonville', 0],
  ['Jacksonville', 'Tampa', 4],
  ['Tampa', 'Miami', 4],
  ['Detroit', 'Buffalo', 7], ['Detroit', 'Pittsburgh', 6],
  ['Buffalo', 'Pittsburgh', 7], ['Buffalo', 'New York', 8],
  ['Pittsburgh', 'Washington', 6],
  ['Washington', 'Philadelphia', 3],
  ['Philadelphia', 'New York', 0],
  ['New York', 'Boston', 3],
];

const USA = buildMap({
  id: 'usa',
  name: 'USA',
  width: 1900,
  height: 1100,
  regions: USA_REGIONS,
  cities: USA_CITIES,
  edges: USA_EDGES,
});

// A pop-culture America: the USA board's layout with fictional cities from
// comics, film, TV and games standing in for the real ones.
const HERO_NAMES = {
  Seattle: 'Forks', Portland: 'Gravity Falls', Boise: 'Twin Peaks', Billings: 'Silent Hill',
  Cheyenne: 'Smallville', Denver: 'South Park', Omaha: 'Hill Valley',
  'San Francisco': 'San Fransokyo', 'Los Angeles': 'Los Santos', 'San Diego': 'Coast City',
  'Las Vegas': 'New Vegas', 'Salt Lake City': 'Star City', Phoenix: 'Radiator Springs', 'Santa Fe': 'Night City',
  Fargo: 'Bedrock', Duluth: 'Derry', Minneapolis: 'Hawkins', Chicago: 'Raccoon City',
  'St. Louis': 'Springfield', Cincinnati: 'Pawnee', Knoxville: 'Central City',
  'Kansas City': 'Keystone City', 'Oklahoma City': 'Greendale', Dallas: 'Dillon', Houston: 'Arlen',
  Memphis: 'Hazzard', Birmingham: 'Mystic Falls', 'New Orleans': 'Bon Temps',
  Atlanta: 'Woodbury', Raleigh: 'Tree Hill', Norfolk: 'Amity Island', Savannah: 'Bluebell',
  Jacksonville: 'Bikini Bottom', Tampa: 'Metroville', Miami: 'Vice City',
  Detroit: 'Delta City', Buffalo: 'Blüdhaven', Pittsburgh: 'Castle Rock', Washington: 'The Capitol',
  Philadelphia: 'Metropolis', 'New York': 'Gotham City', Boston: 'Quahog',
};

const HEROVERSE = buildMap({
  id: 'heroverse',
  name: 'Heroverse (fictional USA)',
  width: 1900,
  height: 1100,
  regions: [
    { id: 'purple', name: 'The Frontier', color: '#9c6ade' },
    { id: 'teal', name: 'The Sunbelt', color: '#3fa39b' },
    { id: 'yellow', name: 'The Heartland', color: '#c2b244' },
    { id: 'red', name: 'The Delta', color: '#c8555f' },
    { id: 'green', name: 'The Coast', color: '#6aa84f' },
    { id: 'orange', name: 'The Metro', color: '#d27a4f' },
  ],
  cities: USA_CITIES.map(([name, region, x, y]) => [HERO_NAMES[name], region, x, y]),
  edges: USA_EDGES.map(([a, b, cost]) => [HERO_NAMES[a], HERO_NAMES[b], cost]),
});

export const MAPS = { germany: GERMANY, usa: USA, heroverse: HEROVERSE };
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
