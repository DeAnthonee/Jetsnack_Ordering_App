# Power Grid Online

A browser-based, multiplayer version of Friedemann Friese's board game
*Power Grid* (Recharged edition). One player creates a lobby, shares a
five-letter code, and 2–6 people play in their browsers. The server
enforces the rules; nothing is trusted from the client.

This is an unofficial fan project. Power Grid is © 2F-Spiele / Rio Grande
Games; buy the real game.

## Run it

```sh
cd powergrid
npm install
npm start          # http://localhost:3000
```

`PORT=8080 npm start` changes the port.

## Host it online

The server keeps games in memory, so it needs one always-on instance.
The repo includes a `render.yaml` (Render), `railway.json` (Railway) and
a `Dockerfile` (anything that runs containers).

**Render (free tier):** sign in at render.com with GitHub, choose
*New → Blueprint*, pick this repository, and Render reads `render.yaml`.
A few minutes later you get a `https://….onrender.com` address to share.
Free instances sleep after 15 minutes without visitors; the first visit
after that takes about a minute to wake, and sleeping ends any game in
progress, so finish a game in one sitting or use a paid instance.

**Railway:** *New Project → Deploy from GitHub repo*, pick this repository.
Railway reads `railway.json` and builds the Dockerfile.

## What's implemented

- Lobbies with join codes, host-chosen map, reconnect after a page refresh
- Full round structure: player order, auctions with the discount token,
  resource buying with storage limits, building with cheapest-path
  connection costs, bureaucracy with payment and resupply
- Steps 1–3, including the Step 3 card drawn during the auction or during
  bureaucracy, and game end with the "most cities powered" tiebreaks
- Two maps: Germany (from the Recharged board) and an original USA layout
- The 2-player "Against the Trust" variant
- Germany's nuclear phase-out rule (plant 39 stops uranium resupply)
- In-game chat and log

## Layout

```
server/index.js        Express + Socket.IO entry point
server/rooms.js        lobbies, seats, reconnect tokens
server/game/engine.js  the rules engine (all game state lives here)
server/game/data.js    plants, prices, resupply and payment tables
server/game/map.js     the two maps
public/                the browser client (vanilla JS, no build step)
test/                  engine tests, including bot-played full games
```

## Tests

```sh
npm test
```

The test suite plays 250 complete games with simple bots across both maps
and every player count, checking rule invariants after every action.
