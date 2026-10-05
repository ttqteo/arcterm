#!/usr/bin/env node
// Writes src-tauri/icons/icon.ico: the arcterm "t>" mark drawn pixel-exact at every size Windows asks
// for, instead of downscaling public/logos/arcterm.png, which smears pixel art at taskbar sizes.
//
// The geometry is measured from public/logos/arcterm.png (2048px): a #111 tile with circular corners
// of radius 400/2048, and a white glyph on a 12x9 cell grid (one cell = 91 source px) whose blocks
// overlap their neighbours slightly. Each size here draws the cells at a whole-pixel step with a block
// one or more pixels larger than the step, so the overlap survives and every glyph edge lands on a
// pixel. Only the tile's rounded corners are antialiased.
//
//   node scripts/gen-app-icon.mjs [preview-dir]   # preview-dir: also write each size as a PNG

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

const OUT = "src-tauri/icons/icon.ico";
const TILE = [0x11, 0x11, 0x11];
const GLYPH = [0xff, 0xff, 0xff];
const CORNER = 400 / 2048;

// [cx, cy, cw, ch] runs of cells: the t (stem, crossbar, hook, base), then the chevron's nine blocks
const CELLS = [
    [1, 1, 1, 6],
    [0, 3, 5, 1],
    [5, 6, 1, 1],
    [2, 7, 3, 1],
    ...[[7, 0], [8, 1], [9, 2], [10, 3], [11, 4], [10, 5], [9, 6], [8, 7], [7, 8]].map(([x, y]) => [x, y, 1, 1]),
];

// size -> [step, block]; the glyph spans 11*step+block by 8*step+block, about 56% of the tile in the
// source. Small sizes run larger than that so the strokes stay at least 2px.
const SIZES = [
    [32, 2, 3], // first: Tauri's codegen takes entries[0] as the fallback window icon
    [16, 1, 2],
    [20, 1, 2],
    [24, 1, 2],
    [40, 2, 3],
    [48, 2, 3],
    [64, 3, 4],
    [96, 4, 5],
    [128, 6, 7],
    [256, 12, 13],
];

function render(size, step, block) {
    const px = new Uint8Array(size * size * 4);
    const r = size * CORNER;
    const SS = 4;
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            let hit = 0;
            for (let sy = 0; sy < SS; sy++) {
                for (let sx = 0; sx < SS; sx++) {
                    const fx = x + (sx + 0.5) / SS;
                    const fy = y + (sy + 0.5) / SS;
                    const dx = Math.max(r - fx, fx - (size - r), 0);
                    const dy = Math.max(r - fy, fy - (size - r), 0);
                    if (dx * dx + dy * dy <= r * r) hit++;
                }
            }
            const i = (y * size + x) * 4;
            px.set(TILE, i);
            px[i + 3] = Math.round((255 * hit) / (SS * SS));
        }
    }
    const w = 11 * step + block;
    const h = 8 * step + block;
    const ox = Math.round((size - w) / 2);
    const oy = Math.round((size - h) / 2);
    for (const [cx, cy, cw, ch] of CELLS) {
        const x0 = ox + cx * step;
        const y0 = oy + cy * step;
        const x1 = x0 + cw * step + (block - step);
        const y1 = y0 + ch * step + (block - step);
        for (let y = y0; y < y1; y++) {
            for (let x = x0; x < x1; x++) {
                const i = (y * size + x) * 4;
                px.set(GLYPH, i);
                px[i + 3] = 255;
            }
        }
    }
    return px;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
});

function crc32(buf) {
    let c = 0xffffffff;
    for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
}

function png(size, px) {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(size, 0);
    ihdr.writeUInt32BE(size, 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 6; // RGBA
    const raw = Buffer.alloc(size * (size * 4 + 1));
    for (let y = 0; y < size; y++) {
        raw[y * (size * 4 + 1)] = 0; // filter: none
        Buffer.from(px.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
    }
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk("IHDR", ihdr),
        chunk("IDAT", deflateSync(raw, { level: 9 })),
        chunk("IEND", Buffer.alloc(0)),
    ]);
}

function ico(images) {
    const header = Buffer.alloc(6);
    header.writeUInt16LE(1, 2); // type: icon
    header.writeUInt16LE(images.length, 4);
    const dir = Buffer.alloc(16 * images.length);
    let offset = 6 + dir.length;
    images.forEach(({ size, data }, n) => {
        const e = n * 16;
        dir[e] = size >= 256 ? 0 : size;
        dir[e + 1] = size >= 256 ? 0 : size;
        dir.writeUInt16LE(1, e + 4); // planes
        dir.writeUInt16LE(32, e + 6); // bits per pixel
        dir.writeUInt32LE(data.length, e + 8);
        dir.writeUInt32LE(offset, e + 12);
        offset += data.length;
    });
    return Buffer.concat([header, dir, ...images.map((i) => i.data)]);
}

const previewDir = process.argv[2];
if (previewDir) mkdirSync(previewDir, { recursive: true });
const images = SIZES.map(([size, step, block]) => {
    const data = png(size, render(size, step, block));
    if (previewDir) writeFileSync(join(previewDir, `icon-${size}.png`), data);
    return { size, data };
});
writeFileSync(OUT, ico(images));
console.log(`wrote ${OUT}: ${SIZES.map(([s]) => s).join(", ")}px`);
