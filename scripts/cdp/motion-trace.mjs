#!/usr/bin/env node
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Watches a UI change frame by frame in the running dev app, the way an end-state screenshot cannot: a panel that snaps
// instead of sliding, or a slide cut short that leaves a box stuck at a size between, shows only in the frames between.
// It records every animation frame in which the elements a selector matches change size, opacity or presence, groups
// those frames into motions, and prints each with its frame count and length; a change drawn in one frame is a SNAP.
// The arc:ux-check skill (skills/ux-check/) is where an agent is sent here from.
//
//   node scripts/cdp/motion-trace.mjs --selector "[data-board-turns-column], [data-board-turns-strip]" \
//       --do "document.querySelector('[data-board-turns-toggle]').click()" \
//       --do "document.querySelector('[data-board-turns-strip]').click()" --out /tmp/turns
//
// --selector  CSS for the elements to watch (a comma list watches several kinds; each is told apart by its tag and
//             data-* attribute names).
// --do        a JS expression run in the page (a promise is awaited); repeat for a sequence. Without one, it records
//             for --secs while you, or a scenario, drive the app.
// --gap       ms between --do steps and after the last (default 1500): long enough for a spring to settle. A small gap
//             (--gap 120) presses again mid-motion, the interrupt case.
// --secs      how long to record when there is no --do (default 10).
// --out       a folder for the frames (CDP screencast) and, when img2webp is on PATH, trace.webp, played at half speed.
// --port      CDP port (default CDP_PORT, else 9222): the Tauri dev app on Windows, `task dev:browser` on a Mac.
//
// Node 21+ (global WebSocket + fetch). Exit 0 always once attached: reading the motions is the caller's job.

import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pickMainTarget } from "./attach.mjs";

function parseArgs(argv) {
    const opts = { selector: "", dos: [], gap: 1500, secs: 10, out: "", port: Number(process.env.CDP_PORT) || 9222 };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        const next = () => argv[++i];
        if (a === "--selector") opts.selector = next();
        else if (a === "--do") opts.dos.push(next());
        else if (a === "--gap") opts.gap = Number(next());
        else if (a === "--secs") opts.secs = Number(next());
        else if (a === "--out") opts.out = next();
        else if (a === "--port") opts.port = Number(next());
        else throw new Error(`unknown argument ${a}`);
    }
    if (!opts.selector) throw new Error("--selector is required");
    return opts;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// the in-page recorder: every frame, the watched elements' boxes and opacity; a frame is kept only when that differs
// from the last one kept. Epoch times (timeOrigin + now), so they line up with the screencast's and survive a reload,
// where the recorder starts again (addScriptToEvaluateOnNewDocument) with its first frame marked.
function recorderSource(selector) {
    return `(() => {
        // a recorder an earlier run left on the page stops: this run's is a fresh one
        if (window.__motionTrace) window.__motionTrace.stop = true;
        const sel = ${JSON.stringify(selector)};
        const name = (el) => el.tagName.toLowerCase() + [...el.attributes].filter((a) => a.name.startsWith("data-")).map((a) => "[" + a.name + "]").join("");
        const rec = { frames: [], stop: false };
        window.__motionTrace = rec;
        let last = "";
        let first = true;
        const tick = () => {
            if (rec.stop) return;
            const items = [...document.querySelectorAll(sel)].map((el) => {
                const r = el.getBoundingClientRect();
                return { name: name(el), w: Math.round(r.width), h: Math.round(r.height), o: Math.round(Number(getComputedStyle(el).opacity) * 100) / 100 };
            });
            const sig = JSON.stringify(items);
            if (sig !== last) {
                rec.frames.push({ t: performance.timeOrigin + performance.now(), items, page: first });
                last = sig;
                first = false;
            }
            requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        return true;
    })()`;
}

function connect(wsUrl, onEvent) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(wsUrl);
        let id = 0;
        const pending = new Map();
        ws.addEventListener("open", () =>
            resolve({
                send(method, params = {}) {
                    const msgId = ++id;
                    ws.send(JSON.stringify({ id: msgId, method, params }));
                    return new Promise((res, rej) => pending.set(msgId, { res, rej, method }));
                },
                close: () => ws.close(),
            })
        );
        ws.addEventListener("error", () => reject(new Error(`CDP socket error on ${wsUrl}`)));
        // the app going away (a reload of the backend, the browser closed) fails what was waiting, not hangs it
        ws.addEventListener("close", () => {
            for (const p of pending.values()) p.rej(new Error("CDP socket closed: the dev app went away"));
            pending.clear();
        });
        ws.addEventListener("message", (e) => {
            const msg = JSON.parse(e.data);
            if (msg.id && pending.has(msg.id)) {
                const p = pending.get(msg.id);
                pending.delete(msg.id);
                if (msg.error) p.rej(new Error(`CDP ${p.method}: ${msg.error.message}`));
                else p.res(msg.result);
            } else if (msg.method) {
                onEvent(msg);
            }
        });
    });
}

// "column 300x759 o1" for one frame's items, "none" when nothing matches
function describe(items) {
    if (items.length === 0) return "none";
    return items.map((it) => `${it.name} ${it.w}x${it.h} o${it.o}`).join(" + ");
}

// Frames closer than this belong to one motion: a spring writes one every display frame (~16ms), so a pause past it is
// the motion ending, or a step the caller took.
const MOTION_JOIN_MS = 80;
// A spring's last frames come sparse (40 to 120ms apart) and move a pixel or two: a change this small this soon after a
// motion is that motion settling, not a new one.
const SETTLE_PX = 4;
const SETTLE_MS = 300;
// img2webp holds every frame in memory: past this many it keeps every Nth
const MAX_WEBP_FRAMES = 400;

// how far a frame's change moved things: the largest change in width or height of an element in both frames (matched by
// name and order), or the smaller side of one that appeared or left (a 1px-wide sliver leaving is no jump); and the
// largest change in opacity
function changeOf(from, to) {
    let px = 0;
    let op = 0;
    const byName = (items) => {
        const m = new Map();
        for (const it of items) m.set(it.name, [...(m.get(it.name) ?? []), it]);
        return m;
    };
    const a = byName(from);
    const b = byName(to);
    for (const name of new Set([...a.keys(), ...b.keys()])) {
        const xs = a.get(name) ?? [];
        const ys = b.get(name) ?? [];
        for (let i = 0; i < Math.max(xs.length, ys.length); i++) {
            const x = xs[i];
            const y = ys[i];
            if (x && y) {
                px = Math.max(px, Math.abs(x.w - y.w), Math.abs(x.h - y.h));
                op = Math.max(op, Math.abs(x.o - y.o));
            } else {
                const it = x ?? y;
                px = Math.max(px, Math.min(it.w, it.h));
                op = Math.max(op, it.o);
            }
        }
    }
    return { px, op };
}

// groups the recorded frames (the first is the state before) into motions: runs of changed frames with no pause longer
// than MOTION_JOIN_MS between them, a small settling change shortly after joining the run it ends. A motion of one frame
// that moved things more than SETTLE_PX or 0.25 opacity is a snap.
function motionsOf(frames) {
    const motions = [];
    for (let i = 1; i < frames.length; i++) {
        // a page (re)load draws its first frame from nothing: not a motion
        if (frames[i].page) continue;
        const cur = motions.at(-1);
        const gap = cur && cur.end === i - 1 ? frames[i].t - frames[cur.end].t : Infinity;
        const small = changeOf(frames[i - 1].items, frames[i].items);
        if (gap <= MOTION_JOIN_MS || (gap <= SETTLE_MS && small.px <= SETTLE_PX && small.op <= 0.25)) {
            cur.end = i;
        } else {
            motions.push({ start: i - 1, end: i });
        }
    }
    return motions.map((m) => {
        const moved = changeOf(frames[m.start].items, frames[m.end].items);
        return {
            from: frames[m.start].items,
            to: frames[m.end].items,
            t0: frames[m.start + 1].t,
            t1: frames[m.end].t,
            frames: m.end - m.start,
            ms: Math.round(frames[m.end].t - frames[m.start + 1].t),
            snap: m.end - m.start === 1 && (moved.px > SETTLE_PX || moved.op > 0.25),
        };
    });
}

async function main() {
    const opts = parseArgs(process.argv.slice(2));
    const targets = await (await fetch(`http://localhost:${opts.port}/json/list`)).json();
    const target = pickMainTarget(targets);
    if (!target) throw new Error(`no page on CDP :${opts.port}: is the dev app (or task dev:browser) running?`);

    let shots = 0;
    let recording = false;
    if (opts.out) mkdirSync(opts.out, { recursive: true });
    const client = await connect(target.webSocketDebuggerUrl, (msg) => {
        if (msg.method !== "Page.screencastFrame") return;
        client.send("Page.screencastFrameAck", { sessionId: msg.params.sessionId }).catch(() => {});
        if (!recording) return;
        const ms = Math.round(msg.params.metadata.timestamp * 1000);
        writeFileSync(join(opts.out, `f${String(++shots).padStart(4, "0")}_${ms}.jpg`), Buffer.from(msg.params.data, "base64"));
    });
    const ev = async (expression) => {
        const r = await client.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
        return r.result?.value;
    };

    await client.send("Page.enable");
    if (opts.out) await client.send("Page.startScreencast", { format: "jpeg", quality: 80, maxWidth: 1200 });
    await client.send("Page.addScriptToEvaluateOnNewDocument", { source: recorderSource(opts.selector) });
    await ev(recorderSource(opts.selector));
    recording = true;
    // the frames come over every 250ms, so a reload (a scenario's arrange does one) loses at most that much
    const frames = [];
    const pull = async () => {
        const got = await ev("window.__motionTrace ? window.__motionTrace.frames.splice(0) : []").catch(() => []);
        frames.push(...(got ?? []));
    };
    const puller = setInterval(pull, 250);
    await sleep(100);
    if (opts.dos.length > 0) {
        for (const step of opts.dos) {
            await ev(step);
            await sleep(opts.gap);
        }
    } else {
        console.log(`recording ${opts.secs}s: drive the app now`);
        await sleep(opts.secs * 1000);
    }
    recording = false;
    clearInterval(puller);
    await pull();
    await ev("window.__motionTrace && (window.__motionTrace.stop = true)").catch(() => {});
    if (opts.out) await client.send("Page.stopScreencast").catch(() => {});
    client.close();

    const motions = motionsOf(frames);
    console.log(`start: ${describe(frames[0]?.items ?? [])}`);
    if (motions.length === 0) console.log("no change recorded");
    motions.forEach((m, i) => {
        const tag = m.snap ? "SNAP" : `${m.frames} frames, ${m.ms}ms`;
        console.log(`motion ${i + 1} (${tag}): ${describe(m.from)} -> ${describe(m.to)}`);
    });
    const end = frames.at(-1);
    console.log(`end: ${describe(end?.items ?? [])}`);
    const snaps = motions.filter((m) => m.snap).length;
    console.log(`${motions.length} motion(s), ${snaps} snap(s)`);

    if (opts.out && shots > 1) {
        // the animation holds the frames around each motion (300ms either side), not the whole recording: a minute
        // of a still screen is thousands of frames and nothing to see
        const files = readdirSync(opts.out).filter((f) => /^f\d+_\d+\.jpg$/.test(f)).sort();
        const timeOf = (f) => Number(f.split("_")[1].split(".")[0]);
        let kept = files.filter((f) => motions.some((m) => timeOf(f) >= m.t0 - 300 && timeOf(f) <= m.t1 + 300));
        if (kept.length < 2) kept = files;
        if (kept.length > MAX_WEBP_FRAMES) kept = kept.filter((_, i) => i % Math.ceil(kept.length / MAX_WEBP_FRAMES) === 0);
        const args = ["-loop", "0", "-lossy", "-q", "60", "-mixed"];
        kept.forEach((f, i) => {
            // a jump between two motions' windows plays as a short pause, not the real seconds between them
            const d = Math.min(400, Math.max(10, (kept[i + 1] ? timeOf(kept[i + 1]) : timeOf(f) + 400) - timeOf(f)));
            args.push("-d", String(d * 2), join(opts.out, f));
        });
        const webp = join(opts.out, "trace.webp");
        args.push("-o", webp);
        try {
            execFileSync("img2webp", args, { stdio: ["ignore", "ignore", "pipe"] });
            console.log(`frames: ${opts.out} (${shots}), animation: ${webp} (${kept.length} frames, half speed)`);
        } catch (e) {
            const why = e.code === "ENOENT" ? "no img2webp on PATH" : `img2webp failed: ${String(e.stderr ?? e.message).trim().split("\n").at(-1)}`;
            console.log(`frames: ${opts.out} (${shots}); ${why}, so no trace.webp`);
        }
    }
}

main().catch((e) => {
    console.error(`motion-trace: ${e.message}`);
    process.exit(1);
});
