import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { VERSION } from './version.js';

const PORT = process.env.PORT || 3000;
const here = path.dirname(fileURLToPath(import.meta.url));
// Where lobbies are saved between restarts. Set DATA_FILE=none to disable.
const DATA_FILE = process.env.DATA_FILE === 'none' ? null : (process.env.DATA_FILE || path.join(here, '..', 'data', 'rooms.json'));

const { httpServer, rooms } = createApp({ dataFile: DATA_FILE });

// Flush pending saves when the process is told to stop (deploys, Ctrl-C).
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    rooms.store.save(rooms.rooms);
    process.exit(0);
  });
}

httpServer.listen(PORT, () => {
  console.log(`Power Grid v${VERSION} running on http://localhost:${PORT}`);
});
