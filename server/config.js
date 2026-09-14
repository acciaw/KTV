import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

dotenv.config({ quiet: true });

const env = process.env;
const num = (value, fallback) => (value === undefined || value === '' ? fallback : Number(value));
const port = num(env.PORT, 8787);

// deployment settings only, channel name and services are managed in /admin (settings.js)
export const config = {
  port,
  baseUrl: (env.BASE_URL || `http://127.0.0.1:${port}`).replace(/\/$/, ''),
  accessKey: env.ACCESS_KEY || '',
  libraryTtlHours: num(env.LIBRARY_TTL_HOURS, 12),
  maxClipSeconds: num(env.MAX_CLIP_SECONDS, 0),
  endCutSeconds: num(env.END_CUT_SECONDS, 10),
  dataDir: env.DATA_DIR ? path.resolve(env.DATA_DIR) : fileURLToPath(new URL('../data/', import.meta.url)),
  publicDir: fileURLToPath(new URL('../public/', import.meta.url)),
};
