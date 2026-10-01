/**
 * Draws the extension icon (a calendar page with a check mark) at every size the stores need
 * and writes PNGs to public/icon/. No image libraries: a tiny rasteriser and PNG encoder.
 * Run with: npm run gen:icons -w @w2msync/extension
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';

const SIZES = [16, 32, 48, 96, 128];
const GREEN: Rgb = [26, 127, 55];
const WHITE: Rgb = [255, 255, 255];
const RING: Rgb = [15, 81, 35];
type Rgb = [number, number, number];

/** Coverage of a shape at a point in unit coordinates (0..1 across the icon). */
type Shape = (x: number, y: number) => boolean;

const roundedRect =
  (x0: number, y0: number, x1: number, y1: number, r: number): Shape =>
  (x, y) => {
    if (x < x0 || x > x1 || y < y0 || y > y1) return false;
    const cx = Math.min(Math.max(x, x0 + r), x1 - r);
    const cy = Math.min(Math.max(y, y0 + r), y1 - r);
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  };

const segment =
  (ax: number, ay: number, bx: number, by: number, width: number): Shape =>
  (x, y) => {
    const dx = bx - ax;
    const dy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
    return (x - (ax + t * dx)) ** 2 + (y - (ay + t * dy)) ** 2 <= (width / 2) ** 2;
  };

const layers: [Shape, Rgb][] = [
  [roundedRect(0.04, 0.04, 0.96, 0.96, 0.2), GREEN],
  [roundedRect(0.18, 0.24, 0.82, 0.84, 0.08), WHITE],
  [roundedRect(0.18, 0.24, 0.82, 0.38, 0.06), [220, 240, 226]],
  [roundedRect(0.31, 0.15, 0.37, 0.31, 0.03), RING],
  [roundedRect(0.63, 0.15, 0.69, 0.31, 0.03), RING],
  [segment(0.33, 0.6, 0.45, 0.72, 0.09), GREEN],
  [segment(0.45, 0.72, 0.68, 0.47, 0.09), GREEN],
];

function render(size: number): Buffer {
  const samples = 4;
  const rows: Buffer[] = [];
  for (let py = 0; py < size; py++) {
    const row = Buffer.alloc(1 + size * 4); // filter byte 0, then RGBA
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const x = (px + (sx + 0.5) / samples) / size;
          const y = (py + (sy + 0.5) / samples) / size;
          let color: Rgb | null = null;
          for (const [shape, c] of layers) if (shape(x, y)) color = c;
          if (color) {
            r += color[0];
            g += color[1];
            b += color[2];
            a += 1;
          }
        }
      }
      const n = samples * samples;
      const o = 1 + px * 4;
      row[o] = a ? Math.round(r / a) : 0;
      row[o + 1] = a ? Math.round(g / a) : 0;
      row[o + 2] = a ? Math.round(b / a) : 0;
      row[o + 3] = Math.round((a / n) * 255);
    }
    rows.push(row);
  }
  return png(size, size, Buffer.concat(rows));
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(data: Buffer): number {
  let c = 0xffffffff;
  for (const byte of data) c = (CRC_TABLE[(c ^ byte) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function png(width: number, height: number, raw: Buffer): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const outDir = new URL('../public/icon/', import.meta.url);
await mkdir(outDir, { recursive: true });
for (const size of SIZES) {
  await writeFile(new URL(`${size}.png`, outDir), render(size));
}
console.log(`Wrote icons: ${SIZES.join(', ')}`);
