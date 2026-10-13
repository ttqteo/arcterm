// Shared CDP transport for the verification harness — one pickTarget + websocket wrapper, instead of the
// copy per one-off driver this replaced. Requires the dev app running with the debug flag (dev-only in
// src-tauri/src/main.rs): --remote-debugging-port=9222.
// Node 21+ (global WebSocket + fetch; the repo runs Node 24).
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname } from "node:path";

// SurfaceKey -> nav-rail label, mirrored from frontend/app/view/agents/navrail.tsx ITEMS. goto clicks
// the nav button by label because globalStore/the agents model are NOT exposed on window (boot-core
// exposes only globalAtoms/globalWS/TabRpcClient) — the nav click is the proven, app-change-free way
// to switch surfaces. Note: the "files" surface is labelled "Diff".
export const SURFACE_LABEL = {
    cockpit: "Cockpit",
    jarvis: "Jarvis",
    agent: "Agent",
    radar: "Radar",
    sessions: "Sessions",
    files: "Diff",
    usage: "Usage",
    code: "Code",
    settings: "Settings",
    setup: "Setup",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A single CDP command must never hang the whole run: if the socket drops mid-command (dev app HMR
// teardown / exit), the reply never arrives and a bare `await` would block forever. Bound every
// command so a drop surfaces as an error. 30s is far above any real CDP round-trip.
const CMD_TIMEOUT_MS = 30_000;

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

async function pickTarget(port) {
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
    const targets = await res.json();
    return (
        targets.find((t) => t.type === "page" && /localhost:5174|wave|arc/i.test(t.url ?? "")) ??
        targets.find((t) => t.type === "page")
    );
}

export async function attach(port = 9222) {
    const target = await pickTarget(port);
    if (!target) {
        throw new Error(
            `no page target on :${port} — is the dev app running with the debug flag? ` +
                `(task dev; the flag is dev-only in src-tauri/src/main.rs)`
        );
    }
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

    const shots = [];

    return {
        url: target.url,
        shots,
        ev,
        // raw CDP passthrough: Runtime.evaluate covers most driving, but Emulation (deterministic shot
        // size) and Input.dispatchKeyEvent (real key events, not synthetic DOM ones) have no wrapper.
        cdp: (method, params) => client.send(method, params),
        rpc: (command, data, opts) =>
            ev(
                `window.TabRpcClient.wshRpcCall(${JSON.stringify(command)}, ${JSON.stringify(data ?? null)}, ${JSON.stringify(opts ?? {})})`
            ),
        async goto(surface) {
            const label = SURFACE_LABEL[surface];
            if (!label) throw new Error(`unknown surface "${surface}"`);
            // aria-label first: the nav rail drops its visible labels below a narrow window
            // (view/agents/navrailwidth.ts), so matching on text alone cannot navigate a narrow app.
            const clicked = await ev(`(() => {
                const want = ${JSON.stringify(label)};
                const b = [...document.querySelectorAll('nav button')]
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
                const b = [...document.querySelectorAll('nav button')]
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
}
