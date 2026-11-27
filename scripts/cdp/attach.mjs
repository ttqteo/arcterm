// Shared CDP transport for the verification harness — one pickTarget + websocket wrapper, instead of the
// copy per one-off driver this replaced. Requires the dev app running with the debug flag (dev-only in
// src-tauri/src/main.rs): --remote-debugging-port=9222.
// Node 21+ (global WebSocket + fetch; the repo runs Node 24).
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import { captureWhatsnewShot } from "./whatsnewshot.mjs";

// SurfaceKey -> nav-rail label, mirrored from frontend/app/view/agents/navrail.tsx ITEMS. goto clicks
// the nav button by label because globalStore/the agents model are NOT exposed on window (boot-core
// exposes only globalAtoms/globalWS/TabRpcClient) — the nav click is the proven, app-change-free way
// to switch surfaces. (agent-history step 14 in scenarios.mjs is the one place a scenario reads an atom: it imports the
// app's own modules from the dev server.) Note: the "files" surface is labelled "Diff".
export const SURFACE_LABEL = {
    cockpit: "Cockpit",
    jarvis: "Jarvis",
    agent: "Agent",
    files: "Diff",
    usage: "Usage",
    library: "Library",
    code: "Code",
    settings: "Settings",
    setup: "Setup",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// a reloaded cockpit took ~2.6s to render its nav in run 5d24e7b8's Final, past the fixed 2.5s a teardown waited
const NAV_WAIT_MS = 30_000;
const NAV_POLL_MS = 250;
const NAV_RENDERED = `!!document.querySelector("nav button")`;
// a page a scenario can drive: its nav drawn and the RPC client h.rpc calls in place. Right after a teardown's reload
// the next scenario's arrange read `window.TabRpcClient` as undefined (2026-11-03, 2026-11-05)
const PAGE_READY = `${NAV_RENDERED} && typeof window.TabRpcClient?.wshRpcCall === "function"`;

// polls expr until it is truthy, false past ms. An evaluate that throws counts as not yet: a reload destroys the
// execution context mid-boot.
export async function waitFor(ev, expr, ms, pollMs = NAV_POLL_MS) {
    for (const start = Date.now(); ; ) {
        if (await ev(expr).catch(() => false)) return true;
        if (Date.now() - start >= ms) return false;
        await sleep(pollMs);
    }
}

// A single CDP command must never hang the whole run: if the socket drops mid-command (dev app HMR
// teardown / exit), the reply never arrives and a bare `await` would block forever. Bound every
// command so a drop surfaces as an error (a closed socket already fails every pending command at once, so this bounds
// only a hang on an open one). A Runtime.evaluate that awaits a wavesrv RPC is no CDP round-trip: on a machine under load
// (a Final beside other builds, the app's first scan of every transcript on disk) createrun, cancelrun and the sessions
// scan took over 30 s, which failed agent-chat's arrange and teardown and launcher-resume's Conversations row.
const CMD_TIMEOUT_MS = Number(process.env.CDP_CMD_TIMEOUT_MS) || 120_000;

function connect(wsUrl) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(wsUrl);
        let id = 0;
        let closed = false;
        const pending = new Map();
        const failAll = (err) => {
            for (const p of pending.values()) p.reject(err);
            pending.clear();
        };
        ws.addEventListener("open", () =>
            resolve({
                send: (method, params = {}) => {
                    if (closed) return Promise.reject(new Error(`CDP socket closed; cannot send ${method}`));
                    const msgId = ++id;
                    ws.send(JSON.stringify({ id: msgId, method, params }));
                    return new Promise((res, rej) => {
                        const timer = setTimeout(() => {
                            pending.delete(msgId);
                            rej(new Error(`CDP ${method} timed out after ${CMD_TIMEOUT_MS}ms`));
                        }, CMD_TIMEOUT_MS);
                        pending.set(msgId, {
                            method,
                            resolve: (v) => {
                                clearTimeout(timer);
                                res(v);
                            },
                            reject: (e) => {
                                clearTimeout(timer);
                                rej(e);
                            },
                        });
                    });
                },
                close: () => ws.close(),
            })
        );
        // error can fire before open (ws refused) or after (drop). reject() is a no-op once resolved;
        // failAll unblocks any in-flight commands so callers see an error instead of hanging.
        ws.addEventListener("error", (e) => {
            const err = new Error(`CDP socket error: ${e?.message ?? e?.error?.message ?? "connection failed"}`);
            reject(err);
            failAll(err);
        });
        ws.addEventListener("close", () => {
            closed = true;
            failAll(new Error("CDP socket closed (dev app went away — HMR teardown or exit?)"));
        });
        ws.addEventListener("message", (e) => {
            let msg;
            try {
                msg = JSON.parse(e.data);
            } catch {
                return; // ignore non-JSON frames rather than crashing the listener
            }
            const p = msg.id && pending.get(msg.id);
            if (!p) return;
            pending.delete(msg.id);
            if (msg.error) p.reject(new Error(`CDP ${p.method} failed: ${msg.error.message ?? "error"}`));
            else p.resolve(msg.result);
        });
    });
}

// the app's other windows have pages of their own, listed beside the main window's in the same /json/list: the tray
// popover (tray.html) and the Sidecar window (sidecar.html). A scenario drives the main page, so the pick skips them.
const SECONDARY_PAGE_URL = /\/(?:tray|sidecar)\.html(?:[?#]|$)/i;

// The page every scenario attaches to: the main window's. Prefers the app's own url, then any other page, and never a
// secondary window's page, which may be listed first. undefined when no main page is open.
export function pickMainTarget(targets) {
    const pages = targets.filter((t) => t.type === "page" && !SECONDARY_PAGE_URL.test(t.url ?? ""));
    return pages.find((t) => /localhost:5174|wave|arc/i.test(t.url ?? "")) ?? pages[0];
}

// The first page target whose url matches (a RegExp, or a string it contains): how a scenario finds a secondary
// window's page, such as /sidecar\.html/.
export function findPageByUrl(targets, match) {
    const hit = (url) => (match instanceof RegExp ? match.test(url) : url.includes(match));
    return targets.find((t) => t.type === "page" && hit(t.url ?? ""));
}

async function listTargets(port) {
    let res;
    try {
        res = await fetch(`http://localhost:${port}/json/list`, { signal: AbortSignal.timeout(5000) });
    } catch (e) {
        // ECONNREFUSED (dev app down / debug flag off) or timeout is the common failure. Turn undici's
        // opaque "fetch failed" into an actionable message instead of an unhandled-rejection stack.
        const why = e?.cause?.code ?? e?.code ?? e?.name ?? "unreachable";
        throw new Error(
            `cannot reach CDP on :${port} (${why}) — is the dev app running with the debug flag? ` +
                `(task dev; the flag is dev-only in src-tauri/src/main.rs)`
        );
    }
    return res.json();
}

export async function attach(port = 9222) {
    const target = pickMainTarget(await listTargets(port));
    if (!target) {
        throw new Error(
            `no page target on :${port} — is the dev app running with the debug flag? ` +
                `(task dev; the flag is dev-only in src-tauri/src/main.rs)`
        );
    }
    return attachTarget(target);
}

// Attaches to another window's page by url match on the harness's CDP port (CDP_PORT, default 9222), waiting up to
// waitMs for it to open: Sidecar's window opens a moment after the command that opens it. The handle is attach()'s, with
// pageReady (a JS expression, default: the main page's nav and RPC client) deciding when reload() and ready() are done,
// and shots (default: its own list) the array shot() records into, so a scenario can share the main handle's contact sheet.
export async function attachByUrl(match, { port = Number(process.env.CDP_PORT) || 9222, waitMs = 15_000, pageReady, shots } = {}) {
    for (const start = Date.now(); ; ) {
        const target = findPageByUrl(await listTargets(port), match);
        if (target) return attachTarget(target, { pageReady, shots });
        if (Date.now() - start >= waitMs) {
            throw new Error(`no page matching ${match} on :${port} after ${waitMs / 1000}s`);
        }
        await sleep(250);
    }
}

// Attaches to a page of another browser (remote-phone's headless phone), whose shots join the run's list; it has no
// cockpit, so its ready check is trivially true.
export function openPage(target, shots) {
    return attachTarget(target, { pageReady: "true", shots });
}

async function attachTarget(target, { pageReady = PAGE_READY, shots = [] } = {}) {
    const client = await connect(target.webSocketDebuggerUrl);
    await client.send("Runtime.enable");
    await client.send("Page.enable");

    async function ev(expr) {
        const x = await client.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
        if (x.exceptionDetails) {
            throw new Error(x.exceptionDetails.exception?.description || x.exceptionDetails.text);
        }
        return x.result?.value;
    }

    const handle = {
        url: target.url,
        shots,
        ev,
        // a What's new picture of the page as it is now, written to public/whatsnew (whatsnewshot.mjs): a scenario
        // that shows a big CHANGELOG line's feature calls it, so a Final run leaves the picture in its tree
        whatsnewShot: (topic, opts) => captureWhatsnewShot(handle, topic, opts),
        // raw CDP passthrough: Runtime.evaluate covers most driving, but Emulation (deterministic shot
        // size) and Input.dispatchKeyEvent (real key events, not synthetic DOM ones) have no wrapper.
        cdp: (method, params) => client.send(method, params),
        rpc: (command, data, opts) =>
            ev(
                `window.TabRpcClient.wshRpcCall(${JSON.stringify(command)}, ${JSON.stringify(data ?? null)}, ${JSON.stringify(opts ?? {})})`
            ),
        // reloads the page and resolves once the new one has booted: the old window's marker is gone with it, and
        // the nav has rendered. Polling the nav alone could read the old page before the reload commits.
        async reload() {
            await ev("window.__cdpReloading = true; location.reload()");
            const booted = await waitFor(ev, `!window.__cdpReloading && ${pageReady}`, NAV_WAIT_MS);
            if (!booted) throw new Error(`the page did not render its nav within ${NAV_WAIT_MS / 1000}s of a reload`);
        },
        // true once the page can be driven (pageReady), false past ms: a scenario that starts before then fails on it
        ready: (ms = NAV_WAIT_MS) => waitFor(ev, pageReady, ms),
        async goto(surface) {
            const label = SURFACE_LABEL[surface];
            if (!label) throw new Error(`unknown surface "${surface}"`);
            // a page still booting from a reload has no nav yet; a missing label on a rendered nav still fails at once
            await waitFor(ev, NAV_RENDERED, NAV_WAIT_MS);
            // aria-label first: the nav rail drops its visible labels below a narrow window
            // (view/agents/navrailwidth.ts), so matching on text alone cannot navigate a narrow app.
            const clicked = await ev(`(() => {
                const want = ${JSON.stringify(label)};
                const b = [...document.querySelectorAll('nav button:not([data-nav-app]):not([data-nav-translate]):not([data-nav-note])')]
                    .find((x) => x.getAttribute('aria-label') === want || (x.textContent || '').trim() === want);
                if (!b) return false;
                b.click();
                return true;
            })()`);
            if (!clicked) throw new Error(`nav button "${label}" not found for surface "${surface}"`);
            await sleep(800); // settle before asserting/screenshotting
        },
        activeSurfaceLabel: () =>
            ev(`(() => {
                const b = [...document.querySelectorAll('nav button:not([data-nav-app]):not([data-nav-translate]):not([data-nav-note])')]
                    .find((x) => (x.className || '').includes('text-accent-soft'));
                if (!b) return null;
                // same reason as goto: the visible label is absent on a narrow rail
                return b.getAttribute('aria-label') || (b.textContent || '').trim();
            })()`),
        async shot(outPath) {
            const { data } = await client.send("Page.captureScreenshot", { format: "png" });
            mkdirSync(dirname(outPath), { recursive: true });
            writeFileSync(outPath, Buffer.from(data, "base64"));
            const png = basename(outPath);
            shots.push({ name: png.replace(/\.png$/, ""), png, path: outPath });
        },
        close: () => client.close(),
    };
    return handle;
}
