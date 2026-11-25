// Re-encodes the texture maps in public/textures to smaller web-friendly JPEGs.
// Usage: node scripts/optimize-textures.mjs [maxSize=1024] [quality=80]
// Source textures are CC0 from ambientCG (https://ambientcg.com), 1K-JPG downloads.
import sharp from 'sharp';
import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

const root = new URL('../public/textures/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const maxSize = Number(process.argv[2] ?? 1024);
const quality = Number(process.argv[3] ?? 80);

let before = 0;
let after = 0;
for (const dir of await readdir(root)) {
  const full = join(root, dir);
  if (!(await stat(full)).isDirectory()) continue;
  for (const file of await readdir(full)) {
    if (!file.endsWith('.jpg')) continue;
    const path = join(full, file);
    const input = await readFile(path);
    const meta = await sharp(input).metadata();
    const out = await sharp(input)
      .resize({ width: Math.min(maxSize, meta.width), height: Math.min(maxSize, meta.height), fit: 'inside' })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();
    before += input.length;
    if (out.length < input.length) {
      await writeFile(path, out);
      after += out.length;
    } else {
      after += input.length;
    }
    console.log(`${dir}/${file} ${meta.width}x${meta.height} ${(input.length / 1024) | 0}KB -> ${(Math.min(out.length, input.length) / 1024) | 0}KB`);
  }
}
console.log(`Total ${(before / 1048576).toFixed(1)}MB -> ${(after / 1048576).toFixed(1)}MB`);
