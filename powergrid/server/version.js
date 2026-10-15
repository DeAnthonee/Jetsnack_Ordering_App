// Bump VERSION and add a changelog entry with every change that ships.
// The client shows VERSION bottom-left; clicking it opens the changelog.

export const VERSION = '1.6.0';

export const CHANGELOG = [
  {
    version: '1.6.0',
    date: '2026-10-15',
    changes: [
      'HTTP API (/api/v1) so programs and AIs can join lobbies, read the game and act',
      'MCP endpoint (/mcp) so Claude and ChatGPT can play through a connector',
      'agents/play.mjs: lets a model from Anthropic, OpenAI or xAI play a seat via its API',
    ],
  },
  {
    version: '1.5.0',
    date: '2026-10-15',
    changes: [
      'Computer players: the host can add up to five from the lobby; they bid, buy fuel, build and power on their own',
    ],
  },
  {
    version: '1.4.1',
    date: '2026-10-02',
    changes: [
      'Fix: after an update, browsers and Cloudflare could keep serving the old script, so new buttons did nothing. Files are now versioned so every update loads fresh.',
    ],
  },
  {
    version: '1.4.0',
    date: '2026-10-02',
    changes: [
      'Version number shown bottom-left; click it for this changelog',
    ],
  },
  {
    version: '1.3.0',
    date: '2026-10-02',
    changes: [
      'Leave game (anyone) and End game (host) buttons in the top bar',
      'Brighter, more distinct player colours; player initials inside houses on the map',
      'Your own panel first with a YOU badge; owned plants carry their owner\'s colour',
      'Map zooms with the mouse wheel and pans by dragging; double-click resets',
      'Link costs on short links no longer hide under cities',
    ],
  },
  {
    version: '1.2.0',
    date: '2026-10-02',
    changes: [
      'USA map transcribed from the Recharged board',
      'Heroverse map: the USA layout with fictional pop-culture cities',
    ],
  },
  {
    version: '1.1.0',
    date: '2026-10-02',
    changes: [
      'Games are saved to disk and survive a server restart',
      'How to play guide',
    ],
  },
  {
    version: '1.0.0',
    date: '2026-10-02',
    changes: [
      'First playable version: lobbies with join codes, Germany map, full Recharged rules, 2-player Trust variant',
    ],
  },
];
