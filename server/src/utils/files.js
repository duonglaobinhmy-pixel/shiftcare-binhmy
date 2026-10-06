import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const dataDir = process.env.SHIFTCARE_DATA_DIR || path.resolve(__dirname, '../../data');

export async function readJson(name, fallback) {
  try {
    return JSON.parse(await fs.readFile(path.join(dataDir, name), 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return fallback;
  }
}

export async function writeJson(name, value) {
  await fs.mkdir(dataDir, { recursive: true });
  const file = path.join(dataDir, name);
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
  await fs.rename(tmp, file);
}
