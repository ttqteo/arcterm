import { describe, expect, it } from "vitest";
import { findPageByUrl, pickMainTarget, waitFor } from "./attach.mjs";

// an ev that answers from a script of results, one per call; an Error entry throws like a destroyed context
const scripted = (answers) => {
    let calls = 0;
    const ev = async () => {
        const a = answers[Math.min(calls++, answers.length - 1)];
        if (a instanceof Error) throw a;
        return a;
    };
    return { ev, calls: () => calls };
};

const page = (id, url) => ({ id, type: "page", url, webSocketDebuggerUrl: `ws://localhost:9222/devtools/page/${id}` });
const MAIN = page("main", "http://localhost:5174/");
const SIDECAR = page("sidecar", "http://localhost:5174/sidecar.html");
const TRAY = page("tray", "http://localhost:5174/tray.html");

describe("pickMainTarget", () => {
    it("takes the main page when the Sidecar and tray pages are open beside it", () => {
        expect(pickMainTarget([MAIN, SIDECAR, TRAY])).toBe(MAIN);
    });

    it("still takes the main page when the Sidecar page is listed first", () => {
        expect(pickMainTarget([SIDECAR, MAIN])).toBe(MAIN);
        expect(pickMainTarget([SIDECAR, TRAY, MAIN])).toBe(MAIN);
    });

    it("reads a packaged build's host and a query or hash on the page's url the same way", () => {
        const side = page("s", "http://tauri.localhost/sidecar.html?x=1");
        const tray = page("t", "http://tauri.localhost/tray.html#a");
        const main = page("m", "http://tauri.localhost/index.html");
        expect(pickMainTarget([side, tray, main])).toBe(main);
    });

    it("keeps preferring the app's own page, then any other page, as before", () => {
        const other = page("o", "https://example.com/");
        expect(pickMainTarget([other, MAIN])).toBe(MAIN);
        const onAnotherPort = page("p", "http://localhost:5199/");
        expect(pickMainTarget([SIDECAR, onAnotherPort])).toBe(onAnotherPort);
    });

    it("never takes a target that is not a page", () => {
        const worker = { id: "w", type: "service_worker", url: "http://localhost:5174/sw.js" };
        expect(pickMainTarget([worker, MAIN])).toBe(MAIN);
        expect(pickMainTarget([worker])).toBeUndefined();
    });

    it("finds no main page when only the Sidecar and tray pages are open", () => {
        expect(pickMainTarget([SIDECAR, TRAY])).toBeUndefined();
        expect(pickMainTarget([])).toBeUndefined();
    });
});

describe("findPageByUrl", () => {
    it("finds the Sidecar page whatever its place in the list", () => {
        expect(findPageByUrl([MAIN, TRAY, SIDECAR], /\/sidecar\.html/)).toBe(SIDECAR);
        expect(findPageByUrl([SIDECAR, MAIN], "sidecar.html")).toBe(SIDECAR);
    });

    it("is undefined when no page matches, and a non-page target never does", () => {
        expect(findPageByUrl([MAIN, TRAY], /sidecar\.html/)).toBeUndefined();
        const worker = { id: "w", type: "service_worker", url: "http://localhost:5174/sidecar.html" };
        expect(findPageByUrl([worker], /sidecar\.html/)).toBeUndefined();
    });
});

describe("waitFor", () => {
    it("keeps polling through a reload's destroyed context until the expression holds", async () => {
        const s = scripted([new Error("Execution context was destroyed"), false, true]);
        expect(await waitFor(s.ev, "x", 1000, 1)).toBe(true);
        expect(s.calls()).toBe(3);
    });

    it("is false once the time runs out on an expression that never holds", async () => {
        const s = scripted([false]);
        expect(await waitFor(s.ev, "x", 20, 5)).toBe(false);
        expect(s.calls()).toBeGreaterThan(1);
    });

    it("answers at once when the expression already holds", async () => {
        const s = scripted([true]);
        expect(await waitFor(s.ev, "x", 0)).toBe(true);
        expect(s.calls()).toBe(1);
    });
});
