import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const obsolete = [
  'client/src/components/CustomerPanel.jsx',
  'client/src/pages/Operations.jsx', 'client/src/pages/OperationsReports.jsx',
  'client/src/services/operations.js', 'client/src/styles/operations.css',
  'server/src/routes/operations.routes.js',
  'server/src/services/operations-domain.service.js',
  'server/src/services/operations-report.service.js',
  'server/src/services/operations-store.service.js',
  'server/db/migrations/005_shiftcare_operations.sql',
  'server/test/operations-http.test.js', 'server/test/operations.test.js',
  'server/src/routes/store.service.js', 'server/src/routes/fast-query.service.js',
  'UPDATE_OPERATIONS_V11.md', 'README 2.md'
];
const targets = new Set(obsolete.map(name => path.resolve(root, name)));
async function scan(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
  for (const entry of entries) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) { await scan(file); continue; }
    if (targets.has(file) || !/\.(js|jsx|mjs|css)$/.test(file)) continue;
    const source = await fs.readFile(file, 'utf8');
    for (const match of source.matchAll(/(?:from\s*|import\s*\(?\s*)['"]([^'"]+)['"]/g)) {
      if (!match[1].startsWith('.')) continue;
      const resolved = path.resolve(path.dirname(file), match[1]);
      if (['', '.js', '.jsx', '.mjs', '.css'].some(extension => targets.has(resolved + extension))) {
        throw new Error(`Còn import file cũ trong ${path.relative(root, file)}. Chép đủ file của bản sửa trước khi dọn.`);
      }
    }
  }
}
await scan(path.join(root, 'client/src')); await scan(path.join(root, 'server/src'));
const backup = path.join(root, `backup-obsolete-${new Date().toISOString().replace(/[:.]/g, '-')}`);
let count = 0;
for (const name of obsolete) {
  const file = path.join(root, name);
  try {
    await fs.access(file);
    const target = path.join(backup, name); await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(file, target); await fs.unlink(file); count++;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
console.log(count ? `Đã dọn ${count} file dư. Bản sao: ${path.basename(backup)}` : 'Không còn file dư trong danh sách.');
console.log('Không sửa server/.env hoặc server/data.');
