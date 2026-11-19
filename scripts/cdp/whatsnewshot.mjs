// What's new pictures straight from the dev app: a 2:1 WebP of the page (or of the area around an element), small enough
// for whatsnew.test.ts (120 KB), written to public/whatsnew/<next minor>-<topic>.webp. Chrome encodes the WebP itself
// (Page.captureScreenshot), so no cwebp or image library is needed. Used by scripts/whatsnew-shot.mjs on a running dev
// app, and by a scenario through its handle's whatsnewShot(topic, opts), so a Final run leaves the picture in its tree.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const MAX_SHOT_BYTES = 120 * 1024;
// a card is at most ~560 CSS px wide; twice that keeps the picture sharp on a 2x screen
export const SHOT_WIDTH = 1120;
const QUALITIES = [82, 72, 62, 52, 42];

// The version a line now in Unreleased ships under: a build makes only minor releases (scripts/release-bump.mjs).
export function nextMinor(version) {
    const m = /^(\d+)\.(\d+)\.\d+/.exec(version);
    if (!m) throw new Error(`not a version: ${version}`);
    return `${m[1]}.${Number(m[2]) + 1}.0`;
}

// A topic as a file name part: lower case, words joined by `-`.
export function shotSlug(topic) {
    const slug = topic
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    if (slug === "") throw new Error(`no letters or digits in topic "${topic}"`);
    return slug;
}

// The 2:1 area to capture: the element's box (or the whole viewport when there is none) widened or heightened to 2:1
// around its centre, kept inside the viewport, and as large as the viewport allows when the box is too big for it.
export function clip2to1(box, viewport) {
    const vw = viewport.width;
    const vh = viewport.height;
    const b = box ?? { x: 0, y: 0, width: vw, height: vh };
    let w = Math.max(b.width, b.height * 2);
    let h = w / 2;
    if (w > vw) {
        w = vw;
        h = w / 2;
    }
    if (h > vh) {
        h = vh;
        w = h * 2;
    }
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;
    const x = Math.min(Math.max(cx - w / 2, 0), vw - w);
    const y = Math.min(Math.max(cy - h / 2, 0), vh - h);
    return { x: Math.round(x), y: Math.round(y), width: Math.round(w), height: Math.round(h) };
}

// Captures the picture through h (an attach.mjs handle) and writes it under root's public/whatsnew. opts: selector (the
// element to centre on, padded by pad CSS px; none for the whole window), version (default: the next minor after root's
// package.json). Returns the file name and the comment to end the CHANGELOG line with.
export async function captureWhatsnewShot(h, topic, { selector, pad = 24, version, root = process.cwd() } = {}) {
    const ver = version ?? nextMinor(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version);
    const file = `${ver}-${shotSlug(topic)}.webp`;
    const viewport = await h.ev(`({ width: window.innerWidth, height: window.innerHeight })`);
    let box = null;
    if (selector) {
        box = await h.ev(`(() => {
            const el = document.querySelector(${JSON.stringify(selector)});
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return { x: r.x - ${pad}, y: r.y - ${pad}, width: r.width + ${pad * 2}, height: r.height + ${pad * 2} };
        })()`);
        if (box == null) throw new Error(`no element matches ${selector}`);
    }
    const clip = clip2to1(box, viewport);
    const scale = Math.min(1, SHOT_WIDTH / clip.width);
    let bytes = null;
    for (const quality of QUALITIES) {
        const { data } = await h.cdp("Page.captureScreenshot", { format: "webp", quality, clip: { ...clip, scale } });
        bytes = Buffer.from(data, "base64");
        if (bytes.length <= MAX_SHOT_BYTES) break;
    }
    if (bytes.length > MAX_SHOT_BYTES) {
        throw new Error(`${file} is ${Math.round(bytes.length / 1024)} KB even at quality ${QUALITIES.at(-1)}: pick a smaller selector`);
    }
    const dir = join(root, "public", "whatsnew");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, file), bytes);
    return { file, bytes: bytes.length, clip, comment: `<!-- shot: ${file} -->` };
}
