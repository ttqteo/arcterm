// code-image-zoom: a markdown Preview image on Code opens in the zoom view (element/imagezoom.tsx), which zooms, pans and
// closes on Esc without leaving Code. Task 4 of docs/superpowers/plans/2026-11-06-kael-sync-surfaces.md; ported from the
// kaeltran16 fork's scenarios-code-imagezoom.mjs onto our tree (the project picker and tree helpers come from the kit).
//
// The fixture repo's image is generated here: a striped PNG larger than any stage, so the view fits it below 100% on open
// and has room to pan once zoomed. A second image in the doc points at a file that is not there and stays an [img]
// placeholder, which never becomes clickable.
//
// kit is scenarios.mjs's CODE_KIT. SURFACE_LABEL is imported from ./attach.mjs, not in the kit. verify.mjs pins the
// viewport (1600x950) before every scenario, so this one sets none.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { SURFACE_LABEL } from "./attach.mjs";

const PROJECT = "verify-code-imagezoom";
const DOC_FILE = "guide.md";
const IMG_W = 2400;
const IMG_H = 1600;
const STRIPE_PX = 40;
const DOC = `# Image zoom

![wide stripes](img/stripes.png)

A missing image stays text:

![gone](img/missing.png)
`;

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
function pngChunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
}
// an RGB PNG of diagonal stripes, with no image library
function stripesPng(width, height) {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr.set([8, 2, 0, 0, 0], 8);
    const row = width * 3 + 1;
    const raw = Buffer.alloc(row * height);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const on = Math.floor((x + y) / STRIPE_PX) % 2 === 0;
            raw.set(on ? [230, 120, 40] : [30, 60, 110], y * row + 1 + x * 3);
        }
    }
    return Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        pngChunk("IHDR", ihdr),
        pngChunk("IDAT", deflateSync(raw)),
        pngChunk("IEND", Buffer.alloc(0)),
    ]);
}

const OVERLAY = `document.querySelector("[data-image-zoom]")`;
const STAGE = `document.querySelector("[data-image-zoom-stage]")`;
const READOUT = `(document.querySelector("[data-image-zoom-readout]")?.textContent ?? "").trim()`;
const IMG_POS = `(() => { const r = document.querySelector("[data-image-zoom-img]")?.getBoundingClientRect(); return r ? { x: Math.round(r.left), y: Math.round(r.top) } : null; })()`;
const PREVIEW_IMG = `document.querySelector('[data-code-preview] .markdown img')`;

export default function ({ git, openProjectPicker, chooseProjectNamed, waitForProjectInConfig, polishWaitFor }) {
    const scenario = {
        name: "code-image-zoom",
        surface: "code",
        async arrange(h) {
            const ctx = { name: PROJECT };
            try {
                ctx.dir = mkdtempSync(join(tmpdir(), "verify-code-imagezoom-"));
                git(ctx.dir, "init", "-q", "--initial-branch=main");
                mkdirSync(join(ctx.dir, "img"));
                writeFileSync(join(ctx.dir, "img", "stripes.png"), stripesPng(IMG_W, IMG_H));
                writeFileSync(join(ctx.dir, DOC_FILE), DOC);
                git(ctx.dir, "add", ".");
                git(ctx.dir, "commit", "-q", "-m", "seed the image zoom fixture");
                await h.rpc("createproject", { name: ctx.name, path: ctx.dir });
                ctx.madeProject = true;
                await waitForProjectInConfig(h, ctx.name);
                await h.reload();
            } catch (e) {
                ctx.arrangeError = String(e?.message ?? e);
            }
            return ctx;
        },
        async assert(h, ctx) {
            if (ctx.arrangeError) {
                return [{ step: "arrange the fixture project", ok: false, detail: ctx.arrangeError }];
            }
            const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
            const steps = [];
            const rec = (step, ok, detail) => steps.push({ step, ok: ok === true, detail });
            const key = (k) =>
                h.ev(`(() => {
                    const t = document.activeElement ?? document.body;
                    t.dispatchEvent(new KeyboardEvent("keydown", { key: ${JSON.stringify(k)}, bubbles: true, cancelable: true }));
                    return true;
                })()`);
            const percent = async () => Number((await h.ev(READOUT)).replace("%", "")) || null;
            const mouse = (type, x, y) =>
                h.cdp("Input.dispatchMouseEvent", {
                    type,
                    x,
                    y,
                    button: "left",
                    buttons: type === "mouseReleased" ? 0 : 1,
                    clickCount: 1,
                });

            await h.goto("code");
            const surfaceNow = await h.activeSurfaceLabel();
            rec("Code surface is active", surfaceNow === SURFACE_LABEL.code, `active=${surfaceNow}`);

            if ((await openProjectPicker(h)) === true) {
                await sleep(300);
                const picked = await chooseProjectNamed(h, ctx.name);
                rec("select the fixture project", picked === true, `picked=${picked}`);
            }

            await h.ev(`document.querySelector('[data-code-column-tab="files"]')?.click()`);
            const TREE_ROW = `[...document.querySelectorAll('[data-code-tree] [role="treeitem"]')].find((r) => r.textContent.trim() === ${JSON.stringify(DOC_FILE)})`;
            const listed = await polishWaitFor(h, `!!${TREE_ROW}`, 10000);
            await h.ev(`${TREE_ROW}?.click()`);
            const loaded =
                listed &&
                (await polishWaitFor(
                    h,
                    `(() => { const i = ${PREVIEW_IMG}; return !!i && i.complete && i.naturalWidth > 0; })()`,
                    10000
                ));
            const cursor = await h.ev(`${PREVIEW_IMG} ? getComputedStyle(${PREVIEW_IMG}).cursor : null`);
            const missing = await h.ev(
                `[...document.querySelectorAll('[data-code-preview] .markdown span')].some((s) => s.textContent === "[img]")`
            );
            const imgCount = await h.ev(`document.querySelectorAll('[data-code-preview] .markdown img').length`);
            await h.shot("cdp-shots/code-image-zoom-preview.png");
            rec(
                "guide.md's image renders in Preview with a zoom-in cursor",
                loaded === true && cursor === "zoom-in",
                `listed=${listed} loaded=${loaded} cursor=${cursor}`
            );
            rec(
                "an image that failed to resolve stays an [img] placeholder, not a clickable image",
                missing === true && imgCount === 1,
                `placeholder=${missing} images=${imgCount}`
            );

            // a real click on the image: the zoom view opens fitted, and a 2400px image fits below 100%
            const at = await h.ev(
                `(() => { const r = ${PREVIEW_IMG}?.getBoundingClientRect(); return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null; })()`
            );
            if (at != null) {
                await mouse("mousePressed", at.x, at.y);
                await mouse("mouseReleased", at.x, at.y);
            }
            const overlay = await polishWaitFor(h, `!!${OVERLAY} && ${READOUT}.endsWith("%")`, 6000);
            const fit = await percent();
            await sleep(300); // the open motion
            await h.shot("cdp-shots/code-image-zoom-open.png");
            rec(
                "clicking the image opens the zoom view fitted below 100%",
                overlay === true && fit != null && fit < 100,
                `overlay=${overlay} readout=${fit}%`
            );

            // the wheel zooms around the pointer: the readout rises and the image's top-left moves
            const stage = await h.ev(
                `(() => { const r = ${STAGE}?.getBoundingClientRect(); return r ? { x: r.left, y: r.top, w: r.width, h: r.height } : null; })()`
            );
            const before = await h.ev(IMG_POS);
            if (stage != null) {
                await h.ev(`(() => {
                    ${STAGE}.dispatchEvent(new WheelEvent("wheel", { deltaY: -400, clientX: ${stage.x + stage.w / 4}, clientY: ${stage.y + stage.h / 4}, bubbles: true, cancelable: true }));
                    return true;
                })()`);
            }
            const wheeled = await polishWaitFor(h, `Number(${READOUT}.replace("%", "")) > ${fit ?? 0}`, 6000);
            const wheelPct = await percent();
            await sleep(100);
            await h.shot("cdp-shots/code-image-zoom-wheel.png");
            rec(
                "the wheel zooms in around the pointer and the percent readout changes",
                wheeled === true && wheelPct != null && fit != null && wheelPct > fit,
                `readout ${fit}% -> ${wheelPct}% img ${JSON.stringify(before)} -> ${JSON.stringify(await h.ev(IMG_POS))}`
            );

            await key("+");
            const plus = await polishWaitFor(h, `Number(${READOUT}.replace("%", "")) > ${wheelPct ?? 0}`, 6000);
            const plusPct = await percent();
            await key("-");
            const minus = await polishWaitFor(h, `Number(${READOUT}.replace("%", "")) < ${plusPct ?? 0}`, 6000);
            rec("+ and - step the zoom in and out", plus === true && minus === true, `+ -> ${plusPct}% - -> ${await percent()}%`);

            const panFrom = await h.ev(IMG_POS);
            if (stage != null) {
                const cx = stage.x + stage.w / 2;
                const cy = stage.y + stage.h / 2;
                await mouse("mousePressed", cx, cy);
                for (let i = 1; i <= 5; i++) await mouse("mouseMoved", cx + i * 30, cy + i * 20);
                await mouse("mouseReleased", cx + 150, cy + 100);
            }
            await sleep(200);
            const panTo = await h.ev(IMG_POS);
            await h.shot("cdp-shots/code-image-zoom-zoomed.png");
            const moved = panFrom != null && panTo != null && panTo.x > panFrom.x && panTo.y > panFrom.y;
            rec(
                "dragging pans the zoomed image",
                moved && (await h.ev(`!!${OVERLAY}`)) === true,
                `img ${JSON.stringify(panFrom)} -> ${JSON.stringify(panTo)}`
            );

            await key("0");
            const refit = await polishWaitFor(h, `Number(${READOUT}.replace("%", "")) === ${fit ?? -1}`, 6000);
            rec("0 fits the image again", refit === true, `readout=${await h.ev(READOUT)} fit=${fit}%`);

            await key("Escape");
            const closed = await polishWaitFor(h, `!${OVERLAY}`, 6000);
            await sleep(300); // the close motion
            const surface = await h.activeSurfaceLabel();
            const focus = await h.ev(`!!document.activeElement?.closest("[data-code-preview]")`);
            const stillPreview = await h.ev(`!!${PREVIEW_IMG}`);
            await h.shot("cdp-shots/code-image-zoom-closed.png");
            rec(
                "Esc closes the zoom view, stays on Code with the Preview showing and hands focus back to it",
                closed === true && surface === SURFACE_LABEL.code && stillPreview === true && focus === true,
                `closed=${closed} surface=${surface} preview=${stillPreview} focusInPreview=${focus}`
            );
            return steps;
        },
        async teardown(h, ctx) {
            try {
                await h.goto("cockpit");
            } finally {
                try {
                    if (ctx?.madeProject) await h.rpc("deleteproject", { name: ctx.name });
                } finally {
                    if (ctx?.dir) rmSync(ctx.dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 });
                }
            }
        },
    };
    return [scenario];
}
