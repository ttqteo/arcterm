#!/usr/bin/env node
// Writes src-tauri/icons/icon.ico, icon.icns and icon.png: the arcterm "t>" mark drawn pixel-exact at
// every size Windows and macOS ask for, instead of downscaling public/logos/arcterm.png, which smears
// pixel art at taskbar sizes.
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
const ICNS_OUT = "src-tauri/icons/icon.icns";
const PNG_OUT = "src-tauri/icons/icon.png";
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

// macOS: [size, tile, step, block]. From 128px up the tile sits on Apple's icon grid (824 of 1024, the
// rest transparent margin) so it matches the Dock's other icons; smaller sizes stay full-bleed, where a
// margin would leave no room for 2px strokes.
const MAC_SIZES = [
    [16, 16, 1, 2],
    [32, 32, 2, 3],
    [64, 64, 3, 4],
    [128, 104, 5, 6],
    [256, 206, 10, 11],
    [512, 412, 20, 21],
    [1024, 824, 40, 42],
];

// icns entry types per pixel size; the @2x types reuse the next size up. 16 and 32px are ARGB, as
// iconutil writes them: macOS decodes a PNG in icp4/icp5 as noise (the Finder's 16px list icon).
const ICNS_TYPES = [
    ["ic04", 16, "argb"],
    ["ic05", 32, "argb"],
    ["ic11", 32],
    ["ic12", 64],
    ["ic07", 128],
    ["ic13", 256],
    ["ic08", 256],
    ["ic14", 512],
    ["ic09", 512],
    ["ic10", 1024],
];

function render(size, step, block, tile = size) {
    const px = new Uint8Array(size * size * 4);
    const r = tile * CORNER;
    const inset = (size - tile) / 2;
    const SS = 4;
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            let hit = 0;
            for (let sy = 0; sy < SS; sy++) {
                for (let sx = 0; sx < SS; sx++) {
                    const fx = x - inset + (sx + 0.5) / SS;
                    const fy = y - inset + (sy + 0.5) / SS;
                    const dx = Math.max(r - fx, fx - (tile - r), 0);
                    const dy = Math.max(r - fy, fy - (tile - r), 0);
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

// ic04/ic05 data: "ARGB", then each channel (all A, then R, G, B) in icns RLE: a byte n < 128 copies the
// next n + 1 bytes, a byte n >= 128 repeats the next byte n - 125 times
function argb(size, px) {
    const parts = [Buffer.from("ARGB", "ascii")];
    for (const ch of [3, 0, 1, 2]) {
        const v = Array.from({ length: size * size }, (_, i) => px[i * 4 + ch]);
        let i = 0;
        while (i < v.length) {
            let run = 1;
            while (i + run < v.length && run < 130 && v[i + run] === v[i]) run++;
            if (run >= 3) {
                parts.push(Buffer.from([run + 125, v[i]]));
                i += run;
                continue;
            }
            let j = i;
            while (j < v.length && j - i < 128 && !(v[j] === v[j + 1] && v[j] === v[j + 2])) j++;
            parts.push(Buffer.from([j - i - 1, ...v.slice(i, j)]));
            i = j;
        }
    }
    return Buffer.concat(parts);
}

// icns: a big-endian "icns" header, then one [type, length, data] entry per type
function icns(icons) {
    const entries = ICNS_TYPES.map(([type, size, format]) => {
        const icon = icons.get(size);
        const data = format === "argb" ? argb(size, icon.px) : icon.png;
        const head = Buffer.alloc(8);
        head.write(type, 0, "ascii");
        head.writeUInt32BE(8 + data.length, 4);
        return Buffer.concat([head, data]);
    });
    const header = Buffer.alloc(8);
    header.write("icns", 0, "ascii");
    header.writeUInt32BE(8 + entries.reduce((n, e) => n + e.length, 0), 4);
    return Buffer.concat([header, ...entries]);
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

const macIcons = new Map(
    MAC_SIZES.map(([size, tile, step, block]) => {
        const px = render(size, step, block, tile);
        const data = png(size, px);
        if (previewDir) writeFileSync(join(previewDir, `mac-${size}.png`), data);
        return [size, { px, png: data }];
    })
);
writeFileSync(ICNS_OUT, icns(macIcons));
console.log(`wrote ${ICNS_OUT}: ${MAC_SIZES.map(([s]) => s).join(", ")}px`);
// off Windows, Tauri's codegen needs a PNG for the window icon (the Dock icon of an unbundled `cargo tauri dev`)
writeFileSync(PNG_OUT, macIcons.get(512).png);
console.log(`wrote ${PNG_OUT}: 512px`);
