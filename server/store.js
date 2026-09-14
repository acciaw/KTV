// tiny json file persistence in ./data, writes to the same file are queued
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';

const pending = new Map();

export async function readJson(name, fallback) {
  try {
    return JSON.parse(await readFile(path.join(config.dataDir, name), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
}

export function writeJson(name, value) {
  const file = path.join(config.dataDir, name);
  const previous = pending.get(file) ?? Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(async () => {
      await mkdir(config.dataDir, { recursive: true });
      const tmp = `${file}.tmp`;
      await writeFile(tmp, JSON.stringify(value, null, 2));
      await rename(tmp, file);
    });
  pending.set(file, next);
  return next;
}

export const removeJson = (name) => rm(path.join(config.dataDir, name), { force: true });
