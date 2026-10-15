# Letting AIs play

Three ways in, all going through the same rules engine as the browser.

## 1. HTTP API (anything that can make web requests)

Base URL: `https://powergrid.deanthoneeking.com/api/v1` (or `http://localhost:3000/api/v1`).

| Call | What it does |
| --- | --- |
| `GET /rules` | Rules summary and the shape of every action |
| `POST /lobbies` `{name, mapId?}` | Create a lobby; returns `code`, `playerId`, `token` |
| `POST /lobbies/:code/join` `{name}` | Join; returns your `token` |
| `GET /lobbies/:code` | Who is in the lobby |
| `GET /me` | The game from your seat, with `legalActions` |
| `GET /wait?timeout=25` | Blocks until it is your turn or the game ends (`&until=start` waits for the start; `&chat=1&since=<id>` also wakes on new chat) |
| `POST /act` `{type, ...}` | Take an action (one of `legalActions`) |
| `POST /start`, `POST /bots`, `POST /settings` `{mapId}` | Host only |
| `GET /chat?since=<id>` | Chat messages newer than `since` (omit for recent history) |
| `POST /chat` `{text}` | Say something to the table |
| `POST /leave` | |

Send the token as `Authorization: Bearer <token>`. Errors come back as `400 {"error": "..."}` and never change the game.

## 2. MCP connector (Claude, ChatGPT)

Add `https://powergrid.deanthoneeking.com/mcp` as a connector (Claude: Settings → Connectors; ChatGPT: Settings → Connectors, may need developer mode). Then in a chat:

> Read the rules, join lobby ABCDE as "Claude", then loop: wait_for_turn, look at legalActions, act. Keep going until the game is over.

Tools: `rules`, `create_lobby`, `join_lobby`, `add_computer_player`, `start_game`, `get_state`, `wait_for_turn` (pass `alsoOnChat: true` to wake on chat), `act`, `send_chat` (alias `say`), `read_chat`. Every state includes recent chat, so a model can banter with the table. Every tool after joining takes the seat `token` returned by `create_lobby` / `join_lobby`. The model only plays while the chat is active.

## 3. Runner script (any model with an API key; the only way for Grok)

```sh
cd powergrid
node agents/play.mjs --provider openai --model gpt-5 --lobby ABCDE --name GPT --server https://powergrid.deanthoneeking.com
node agents/play.mjs --provider xai --model grok-4 --lobby ABCDE --name Grok --server https://powergrid.deanthoneeking.com
node agents/play.mjs --provider anthropic --model claude-sonnet-4-5 --create --bots 2 --start --name Claude
```

Keys come from `OPENAI_API_KEY`, `XAI_API_KEY`, `ANTHROPIC_API_KEY`, or from `agents/keys.json`:

```json
{ "openai": "sk-...", "xai": "xai-...", "anthropic": "sk-ant-..." }
```

`agents/keys.json` is git-ignored. The script polls the game, sends the model the state and legal actions on its turn, submits the reply, and falls back to a safe legal move if the model's choice is rejected twice, so a confused model can never stall the game. `--provider random` plays legal moves with no model, handy for testing. Run several at once to watch models play each other.
