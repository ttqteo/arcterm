import { describe, expect, it } from "vitest";
import {
    chipGroups,
    edgeStyle,
    factOf,
    fitScale,
    glyphKind,
    graphKey,
    kindOf,
    nodeInView,
    openView,
    pickNext,
    relatives,
    wordOf,
    ZOOM_FLOOR,
    ZOOM_MIN,
    ZOOM_STEP,
    type FactCtx,
} from "./dagcanvas";
import { FINAL_NODE_ID, withFinalNode } from "./dagfinal";

const task = (id: string, state: string, extra: Partial<TaskNode> = {}): TaskNode => ({ id, state, ...extra });
const ctx = (tasks: TaskNode[], extra: Partial<FactCtx> = {}): FactCtx => ({
    byId: new Map(tasks.map((t) => [t.id, t])),
    digest: undefined,
    mergeReady: new Set(),
    nowMs: 10 * 60_000,
    ...extra,
});

describe("kindOf / wordOf / glyphKind", () => {
    it("treats a gated done task as needing you", () => {
        const t = task("t-1", "done", { gate: true });
        expect(kindOf(t)).toBe("attention");
        expect(wordOf(t)).toBe("at gate");
        expect(glyphKind(t)).toBe("attention");
    });
    it("names the compound states in words", () => {
        expect(wordOf(task("t", "blocked-merge"))).toBe("merge blocked");
        expect(wordOf(task("t", "verify-failed"))).toBe("verify failed");
    });
    it("maps every state to its glyph", () => {
        expect(
            ["done", "failed", "stalled", "verify-failed", "running", "verifying", "ready", "skipped", "pending"].map(
                (s) => glyphKind(task("t", s))
            )
        ).toEqual(["done", "failed", "stalled", "attention", "running", "live", "ready", "inert", "waiting"]);
    });
    it("reads an unknown state as waiting", () => {
        expect(kindOf(task("t", "mystery"))).toBe("waiting");
    });
});

describe("factOf", () => {
    it("says how long a running task has run, its tool and its attempt", () => {
        const t = task("t-1", "running", { firstactivity: 4 * 60_000, latesttool: "Edit", attempts: 2 });
        expect(factOf(t, ctx([t]))).toBe("6m · Edit · attempt 2");
    });
    it("says starting before any activity", () => {
        const t = task("t-1", "running");
        expect(factOf(t, ctx([t]))).toBe("starting");
    });
    it("tells merged, merge-ready and awaiting-merge apart", () => {
        const a = task("a", "done", { merged: true });
        const b = task("b", "done");
        const c = task("c", "done");
        const c2 = ctx([a, b, c], { mergeReady: new Set(["b"]) });
        expect([factOf(a, c2), factOf(b, c2), factOf(c, c2)]).toEqual(["merged", "merge ready", "awaiting merge"]);
    });
    it("names what a waiting task waits on, counting a skipped dependency as finished", () => {
        const deps = ["t-1", "t-2", "t-3"].map((id) => task(id, "running"));
        const skipped = task("t-4", "skipped");
        const w = task("t-9", "pending", { deps: ["t-1", "t-3", "t-4"] });
        expect(factOf(w, ctx([...deps, skipped, w]))).toBe("waits on t-1, t-3");
        const many = task("t-8", "pending", { deps: ["a", "b", "c", "d", "e"] });
        const five = ["a", "b", "c", "d", "e"].map((id) => task(id, "pending"));
        expect(factOf(many, ctx([...five, many]))).toBe("waits on 5 tasks");
        const free = task("t-7", "ready", { deps: ["t-4"] });
        expect(factOf(free, ctx([skipped, free]))).toBe("next to start");
    });
    it("says a waiting task asked you", () => {
        const t = task("t-1", "pending");
        expect(
            factOf(t, ctx([t], { digest: { taskid: "t-1", waitreason: "ask", mergestate: "", cleanupstate: "" } }))
        ).toBe("asked you");
    });
    it("shows the first line of a failed Verify", () => {
        const t = task("t-1", "verify-failed", { verifyerror: "exit 1: FAIL\nmore" });
        expect(factOf(t, ctx([t]))).toBe("exit 1: FAIL");
    });
});

describe("relatives / edgeStyle", () => {
    const tasks = [
        task("a", "done"),
        task("b", "running", { deps: ["a"] }),
        task("c", "pending", { deps: ["b"] }),
        task("x", "failed"),
    ];
    const byId = new Map(tasks.map((t) => [t.id, t]));
    it("collects ancestors and descendants", () => {
        const r = relatives(tasks, "b");
        expect([...r.up]).toEqual(["a"]);
        expect([...r.down]).toEqual(["c"]);
    });
    it("ignores unknown deps and survives a cycle", () => {
        const r = relatives(
            [
                { id: "p", deps: ["q", "ghost"] },
                { id: "q", deps: ["p"] },
            ],
            "p"
        );
        expect([...r.up]).toEqual(["q", "p"]);
        expect([...r.down]).toEqual(["q", "p"]);
    });
    it("styles edges by their endpoints", () => {
        expect(edgeStyle(byId.get("a")!, byId.get("b")!, null)).toEqual({ kind: "live", dashed: false, faded: false });
        expect(edgeStyle(byId.get("b")!, byId.get("c")!, null)).toEqual({
            kind: "waiting",
            dashed: true,
            faded: false,
        });
        expect(edgeStyle(byId.get("a")!, byId.get("x")!, null)).toEqual({
            kind: "needs-you",
            dashed: true,
            faded: false,
        });
        expect(edgeStyle(byId.get("a")!, task("d", "done"), null)).toEqual({
            kind: "satisfied",
            dashed: false,
            faded: false,
        });
    });
    it("marks the focused task's path and fades the rest only while selected", () => {
        const focus = { id: "b", rel: relatives(tasks, "b"), selected: true };
        expect(edgeStyle(byId.get("a")!, byId.get("b")!, focus).kind).toBe("path");
        expect(edgeStyle(byId.get("b")!, byId.get("c")!, focus)).toEqual({ kind: "path", dashed: true, faded: false });
        expect(edgeStyle(byId.get("a")!, byId.get("x")!, focus).faded).toBe(true);
        expect(edgeStyle(byId.get("a")!, byId.get("x")!, { ...focus, selected: false }).faded).toBe(false);
    });
});

describe("graphKey", () => {
    // a -> b, a -> c, b -> d; column 1 holds b (y 0) and c (y 100)
    const tasks = [{ id: "a" }, { id: "b", deps: ["a"] }, { id: "c", deps: ["a"] }, { id: "d", deps: ["b"] }];
    const layer = new Map([
        ["a", 0],
        ["b", 1],
        ["c", 1],
        ["d", 2],
    ]);
    const pos = new Map([
        ["a", { x: 0, y: 50 }],
        ["b", { x: 244, y: 0 }],
        ["c", { x: 244, y: 100 }],
        ["d", { x: 488, y: 0 }],
    ]);
    const key = (k: string, selected: string | null) => graphKey(k, { tasks, selected, layer, pos });
    it("steps through plan order with j and k, clamped", () => {
        expect(key("j", "a")).toEqual({ kind: "select", id: "b" });
        expect(key("k", "a")).toEqual({ kind: "none" });
    });
    it("follows edges with left and right, to the nearest in y, ties to the earlier task", () => {
        // b (y 0) and c (y 100) are both 50 from a (y 50): b comes first in plan order
        expect(key("ArrowRight", "a")).toEqual({ kind: "select", id: "b" });
        expect(key("ArrowRight", "b")).toEqual({ kind: "select", id: "d" });
        expect(key("ArrowLeft", "c")).toEqual({ kind: "select", id: "a" });
        expect(key("ArrowRight", "d")).toEqual({ kind: "none" });
    });
    it("moves within a column with up and down", () => {
        expect(key("ArrowDown", "b")).toEqual({ kind: "select", id: "c" });
        expect(key("ArrowUp", "b")).toEqual({ kind: "none" });
    });
    it("selects the first task when nothing is selected", () => {
        expect(key("ArrowLeft", null)).toEqual({ kind: "select", id: "a" });
    });
    it("fits and zooms", () => {
        expect(key("f", null)).toEqual({ kind: "fit" });
        expect(key("=", null)).toEqual({ kind: "zoom", factor: ZOOM_STEP });
        expect(key("-", null)).toEqual({ kind: "zoom", factor: 1 / ZOOM_STEP });
        expect(key("x", null)).toEqual({ kind: "none" });
    });
    it("reaches the final node as the layout's last task", () => {
        // the sinks are c (y 100) and d (y 0); the final node sits level with c
        const withFinal = withFinalNode(tasks);
        const finalKey = (k: string, selected: string | null) =>
            graphKey(k, {
                tasks: withFinal,
                selected,
                layer: new Map([...layer, [FINAL_NODE_ID, 3]]),
                pos: new Map([...pos, [FINAL_NODE_ID, { x: 732, y: 100 }]]),
            });
        expect(finalKey("ArrowRight", "d")).toEqual({ kind: "select", id: FINAL_NODE_ID });
        expect(finalKey("ArrowRight", "c")).toEqual({ kind: "select", id: FINAL_NODE_ID });
        expect(finalKey("ArrowLeft", FINAL_NODE_ID)).toEqual({ kind: "select", id: "c" });
        expect(finalKey("j", "d")).toEqual({ kind: "select", id: FINAL_NODE_ID });
        expect(finalKey("j", FINAL_NODE_ID)).toEqual({ kind: "none" });
        expect(finalKey("ArrowRight", FINAL_NODE_ID)).toEqual({ kind: "none" });
    });
});

describe("chipGroups / pickNext", () => {
    const tasks = [task("a", "failed"), task("b", "running"), task("c", "stalled"), task("d", "pending")];
    it("counts only the non-empty groups, need-you first", () => {
        expect(chipGroups(tasks).map((g) => [g.key, g.count])).toEqual([
            ["attention", 2],
            ["live", 1],
            ["waiting", 1],
        ]);
    });
    it("cycles through a group", () => {
        expect(pickNext(tasks, ["attention"], null)).toBe("a");
        expect(pickNext(tasks, ["attention"], "a")).toBe("c");
        expect(pickNext(tasks, ["attention"], "c")).toBe("a");
        expect(pickNext(tasks, ["done"], null)).toBeNull();
    });
});

describe("fitScale / openView / nodeInView", () => {
    const pane = { w: 900, h: 700 };
    const row = (n: number) => new Map(Array.from({ length: n }, (_, i) => [`t-${i}`, { x: i * 244, y: 0 }]));
    it("fits a small graph at 1:1", () => {
        expect(fitScale(row(2), pane, false)).toBe(1);
        expect(fitScale(new Map(), pane, false)).toBe(1);
    });
    it("opens an empty group on neutral values", () => {
        expect(openView([], new Map(), pane, false)).toEqual({ fitIds: null, minZoom: ZOOM_MIN });
    });
    it("fits everything while that stays above the floor", () => {
        const tasks = [task("t-0", "running"), task("t-1", "pending")];
        expect(openView(tasks, row(2), pane, false).fitIds).toBeNull();
    });
    it("fits the tasks that need you at the floor when everything would be too small", () => {
        const tasks = Array.from({ length: 8 }, (_, i) =>
            task(`t-${i}`, i === 5 ? "failed" : i === 6 ? "running" : "done")
        );
        expect(openView(tasks, row(8), pane, false)).toEqual({ fitIds: ["t-5"], minZoom: ZOOM_FLOOR });
        const settled = tasks.map((t) => ({ ...t, state: "done" }));
        expect(openView(settled, row(8), pane, false)).toEqual({ fitIds: null, minZoom: ZOOM_FLOOR });
    });
    it("knows whether a node is comfortably on screen", () => {
        expect(nodeInView({ x: 0, y: 0, zoom: 1 }, { x: 100, y: 100 }, pane)).toBe(true);
        expect(nodeInView({ x: 0, y: 0, zoom: 1 }, { x: 800, y: 100 }, pane)).toBe(false);
    });
});
