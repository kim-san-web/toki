/**
 * Rebuild `icon.ico` and `tray.ico` from the committed PNG frames.
 *
 * A PNG-embedded ICO is a 6-byte header, one 16-byte directory entry per frame,
 * and the PNG bytes themselves — so this needs no image library and no native
 * dependency, and the PNGs stay the single source of truth for the mark.
 *
 * The 256x256 frame is not optional: electron-builder refuses an icon without
 * one, and it fails at the very end of a long packaging run.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const icons = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'icons');

/** ICO stores 256 as 0 in a single byte — the field cannot hold 256 itself. */
const dimension = (n) => (n >= 256 ? 0 : n);

function buildIco(frames) {
  const images = frames.map((size) => {
    const path = join(icons, `${frames.prefix}-${size}.png`);
    if (!existsSync(path)) throw new Error(`missing frame: ${path}`);
    return { size, data: readFileSync(path) };
  });

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);

  const directory = Buffer.alloc(16 * images.length);
  let offset = header.length + directory.length;

  images.forEach((image, index) => {
    const entry = index * 16;
    directory.writeUInt8(dimension(image.size), entry);
    directory.writeUInt8(dimension(image.size), entry + 1);
    directory.writeUInt8(0, entry + 2); // palette colours
    directory.writeUInt8(0, entry + 3); // reserved
    directory.writeUInt16LE(1, entry + 4); // colour planes
    directory.writeUInt16LE(32, entry + 6); // bits per pixel
    directory.writeUInt32LE(image.data.length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += image.data.length;
  });

  return Buffer.concat([header, directory, ...images.map((image) => image.data)]);
}

function write(name, prefix, sizes) {
  const frames = sizes.slice().sort((a, b) => a - b);
  frames.prefix = prefix;
  if (!frames.includes(256)) throw new Error(`${name} needs a 256x256 frame`);
  const out = join(icons, name);
  writeFileSync(out, buildIco(frames));
  console.log(`${name}: ${frames.join(', ')}`);
}

write('icon.ico', 'icon', [16, 24, 32, 48, 64, 128, 256]);
write('tray.ico', 'tray', [16, 20, 24, 32, 48, 64, 128, 256]);
