// Saves every lobby to one JSON file so a server restart does not end the
// games in progress. Writes are debounced and atomic (write temp, rename).

import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { Game } from './game/engine.js';

export class Store {
  constructor(file) {
    this.file = file;
    this.timer = null;
  }

  load(rooms) {
    if (!this.file || !existsSync(this.file)) return 0;
    let data;
    try {
      data = JSON.parse(readFileSync(this.file, 'utf8'));
    } catch (err) {
      console.error(`Could not read ${this.file}; starting empty.`, err.message);
      return 0;
    }
    let count = 0;
    for (const r of data.rooms || []) {
      try {
        rooms.set(r.code, {
          ...r,
          players: r.players.map((p) => ({ ...p, connected: false })),
          game: r.game ? Game.restore(r.game) : null,
        });
        count++;
      } catch (err) {
        console.error(`Skipping saved lobby ${r.code}:`, err.message);
      }
    }
    return count;
  }

  // Coalesce bursts of changes into one write.
  schedule(rooms) {
    if (!this.file || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.save(rooms);
    }, 250);
    this.timer.unref();
  }

  save(rooms) {
    if (!this.file) return;
    const data = {
      savedAt: new Date().toISOString(),
      rooms: [...rooms.values()].map((r) => ({ ...r, game: r.game ? r.game.serialize() : null })),
    };
    try {
      mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify(data));
      renameSync(tmp, this.file);
    } catch (err) {
      console.error(`Could not save ${this.file}:`, err.message);
    }
  }
}
