// Rules data for Power Grid (Recharged). Every number the engine relies on
// lives here so it can be checked against the printed rulebook in one place.

export const RES_TYPES = ['coal', 'oil', 'garbage', 'uranium'];

// Power plant deck: n = plant number (minimum bid), type = fuel,
// input = resources burned per firing, output = cities powered.
// 'hybrid' burns any mix of coal and oil; 'eco' burns nothing.
export const PLANTS = [
  { n: 3, type: 'oil', input: 2, output: 1 },
  { n: 4, type: 'coal', input: 2, output: 1 },
  { n: 5, type: 'hybrid', input: 2, output: 1 },
  { n: 6, type: 'garbage', input: 1, output: 1 },
  { n: 7, type: 'oil', input: 3, output: 2 },
  { n: 8, type: 'coal', input: 3, output: 2 },
  { n: 9, type: 'oil', input: 1, output: 1 },
  { n: 10, type: 'coal', input: 2, output: 2 },
  { n: 11, type: 'uranium', input: 1, output: 2 },
  { n: 12, type: 'hybrid', input: 2, output: 2 },
  { n: 13, type: 'eco', input: 0, output: 1 },
  { n: 14, type: 'garbage', input: 2, output: 2 },
  { n: 15, type: 'coal', input: 2, output: 3 },
  { n: 16, type: 'oil', input: 2, output: 3 },
  { n: 17, type: 'uranium', input: 1, output: 2 },
  { n: 18, type: 'eco', input: 0, output: 2 },
  { n: 19, type: 'garbage', input: 2, output: 3 },
  { n: 20, type: 'coal', input: 3, output: 5 },
  { n: 21, type: 'hybrid', input: 2, output: 4 },
  { n: 22, type: 'eco', input: 0, output: 2 },
  { n: 23, type: 'uranium', input: 1, output: 3 },
  { n: 24, type: 'garbage', input: 2, output: 4 },
  { n: 25, type: 'coal', input: 2, output: 5 },
  { n: 26, type: 'oil', input: 2, output: 5 },
  { n: 27, type: 'eco', input: 0, output: 3 },
  { n: 28, type: 'uranium', input: 1, output: 4 },
  { n: 29, type: 'hybrid', input: 1, output: 4 },
  { n: 30, type: 'garbage', input: 3, output: 6 },
  { n: 31, type: 'coal', input: 3, output: 6 },
  { n: 32, type: 'oil', input: 3, output: 6 },
  { n: 33, type: 'eco', input: 0, output: 4 },
  { n: 34, type: 'uranium', input: 1, output: 5 },
  { n: 35, type: 'oil', input: 1, output: 5 },
  { n: 36, type: 'coal', input: 3, output: 7 },
  { n: 37, type: 'eco', input: 0, output: 4 },
  { n: 38, type: 'garbage', input: 3, output: 7 },
  { n: 39, type: 'uranium', input: 1, output: 6 },
  { n: 40, type: 'oil', input: 2, output: 6 },
  { n: 42, type: 'coal', input: 2, output: 6 },
  { n: 44, type: 'eco', input: 0, output: 5 },
  { n: 46, type: 'hybrid', input: 3, output: 7 },
  { n: 50, type: 'eco', input: 0, output: 6 },
];

// The "Step 3" card sorts above every plant in the market.
export const STEP3_CARD = { n: 99, type: 'step3', input: 0, output: 0 };

export const STARTING_MONEY = 50;

// Rules that depend on player count.
export const PLAYER_RULES = {
  2: { regions: 3, removeCards: 8, maxPlants: 4, step2Cities: 10, endCities: 21 },
  3: { regions: 3, removeCards: 8, maxPlants: 3, step2Cities: 7, endCities: 17 },
  4: { regions: 4, removeCards: 4, maxPlants: 3, step2Cities: 7, endCities: 17 },
  5: { regions: 5, removeCards: 0, maxPlants: 3, step2Cities: 7, endCities: 15 },
  6: { regions: 5, removeCards: 0, maxPlants: 3, step2Cities: 6, endCities: 14 },
};

// Price of each slot in the resource market, cheapest first.
export const SLOT_PRICES = {
  coal: [1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6, 6, 7, 7, 7, 8, 8, 8],
  oil: [1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6, 6, 7, 7, 7, 8, 8, 8],
  garbage: [1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6, 6, 7, 7, 7, 8, 8, 8],
  uranium: [1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 14, 16],
};

// Total pieces of each resource in the game (market + plants + bank).
export const RES_TOTAL = { coal: 24, oil: 24, garbage: 24, uranium: 12 };

// Starting market: coal fills 1-8, oil 3-8, garbage 7-8, uranium 14-16.
export const RES_START = { coal: 24, oil: 18, garbage: 6, uranium: 2 };

// Resupply per round: [step1, step2, step3] for each resource and player count.
export const RESUPPLY = {
  2: { coal: [3, 4, 3], oil: [2, 2, 4], garbage: [1, 2, 3], uranium: [1, 1, 1] },
  3: { coal: [4, 5, 3], oil: [2, 3, 4], garbage: [1, 2, 3], uranium: [1, 1, 1] },
  4: { coal: [5, 6, 4], oil: [3, 4, 5], garbage: [2, 3, 4], uranium: [1, 2, 2] },
  5: { coal: [5, 7, 5], oil: [4, 5, 6], garbage: [3, 3, 5], uranium: [2, 3, 2] },
  6: { coal: [7, 9, 6], oil: [5, 6, 7], garbage: [3, 5, 6], uranium: [2, 3, 3] },
};

// Cost of the 1st / 2nd / 3rd house in a city. Step N opens N slots.
export const CITY_SLOT_COST = [10, 15, 20];

// Income by number of cities powered (index = cities, capped at 20).
export const PAYMENT = [
  10, 22, 33, 44, 54, 64, 73, 82, 90, 98, 105, 112, 118, 124, 129, 134, 138, 142, 145, 148, 150,
];

export const PLAYER_COLORS = ['#e53935', '#1e88e5', '#43a047', '#fdd835', '#8e24aa', '#212121'];
