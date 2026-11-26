import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'www');

await fs.rm(out, { recursive: true, force: true });
await fs.mkdir(out, { recursive: true });

for (const file of ['index.html', 'manifest.webmanifest']) {
  await fs.copyFile(path.join(root, file), path.join(out, file));
}

await fs.cp(path.join(root, 'assets'), path.join(out, 'assets'), { recursive: true });

console.log('Prepared www/ for Capacitor');
