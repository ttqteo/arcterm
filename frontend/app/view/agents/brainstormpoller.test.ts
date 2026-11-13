// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/store/wshclientapi", () => ({ RpcApi: {} }));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));

import { globalStore } from "@/app/store/jotaiStore";
import type { AgentVM } from "./agentsviewmodel";
import { parseBrainstorm } from "./brainstormmodel";
import {
    listAllOpenBrainstorms,
    listOpenBrainstorms,
    pollAndMerge,
    pollBrainstormOnce,
    reconcileBrainstorms,
    settleBrainstorm,
    type BrainstormIO,
} from "./brainstormpoller";
import {
    attachBrainstorm,
    brainstormBandAtom,
    brainstormSeenBoardsAtom,
    detachBrainstorm,
    getBrainstorm,
    setBrainstormMode,
    updateBrainstorm,
    type BrainstormState,
} from "./brainstormstore";

const PATH = "/p/.superpowers/brainstorm/t/brainstorm.json";
const BASE = "http://127.0.0.1:5005/canvas/tok";

function state(over: Partial<BrainstormState> = {}): BrainstormState {
    return {
        topic: "t",
        path: PATH,
        cwd: "/p",
        mode: "terminal",
        file: null,
        error: null,
        failedReads: 0,
        removed: false,
        modifiedMs: null,
        lastViewedMs: 0,
        board: null,
        showDesign: false,
        designOpen: false,
        boards: [],
        base: null,
        sent: null,
        sentCheckAt: null,
        review: { cursor: null, open: {} },
        starting: null,
        ...over,
    };
}

function fileText(over: Record<string, unknown> = {}): string {
    return JSON.stringify({
        v: 1,
        title: "Consumer lag alerts",
        spec: "",
        question: { n: 1, text: "Who gets paged?", part: "who" },
        working: null,
        parts: [{ id: "who", title: "Who", state: "asked", body: "" }],
        history: [],
        done: false,
        check: null,
        run: null,
        ...over,
    });
}

type Disk = { exists?: boolean; modifiedMs?: number | null; text?: string; readFails?: boolean };

function fakeIO(disk: Disk, served: string | null = BASE) {
    const calls = { reads: 0, serves: [] as string[], canvasJson: [] as string[] };
    const io: BrainstormIO = {
        async stat() {
            return { exists: disk.exists ?? true, modifiedMs: disk.modifiedMs ?? null };
        },
        async read() {
            calls.reads++;
            if (disk.readFails) {
                throw new Error("sharing violation");
            }
            return disk.text ?? "";
        },
        async serve(designDir) {
            calls.serves.push(designDir);
            return served;
        },
        async canvasJson(url) {
            calls.canvasJson.push(url);
            return { boards: { "Main.dc.html": { x: 0, y: 0, w: 1200, h: 800 } } };
        },
    };
    return { io, calls };
}

describe("pollBrainstormOnce", () => {
    it("marks a missing file removed", async () => {
        const { io, calls } = fakeIO({ exists: false });
        expect(await pollBrainstormOnce(state(), io)).toEqual({ removed: true });
        expect(calls.reads).toBe(0);
    });

    it("does not read a file whose mod time has not moved", async () => {
        const { io, calls } = fakeIO({ modifiedMs: 10, text: fileText() });
        expect(await pollBrainstormOnce(state({ modifiedMs: 10 }), io)).toEqual({});
        expect(calls.reads).toBe(0);
    });

    it("takes a good read", async () => {
        const { io } = fakeIO({ modifiedMs: 10, text: fileText() });
        const patch = await pollBrainstormOnce(state({ removed: true }), io);
        expect(patch.file?.title).toBe("Consumer lag alerts");
        expect(patch).toMatchObject({ error: null, failedReads: 0, removed: false, modifiedMs: 10 });
    });

    it("keeps the last good file and shows no error on one bad read", async () => {
        const good = (await pollBrainstormOnce(state(), fakeIO({ modifiedMs: 10, text: fileText() }).io)).file;
        const s = state({ file: good, modifiedMs: 10 });
        const patch = await pollBrainstormOnce(s, fakeIO({ modifiedMs: 11, text: '{"v": 1, "title": "Cons' }).io);
        expect(patch).toEqual({ failedReads: 1 });
        expect({ ...s, ...patch }.file).toBe(good);
        expect({ ...s, ...patch }.error).toBeNull();
    });

    it("counts a read that throws as a bad read", async () => {
        const patch = await pollBrainstormOnce(state(), fakeIO({ modifiedMs: 11, readFails: true }).io);
        expect(patch).toEqual({ failedReads: 1 });
    });

    it("sets the error on the second bad read in a row and still keeps the file", async () => {
        const good = (await pollBrainstormOnce(state(), fakeIO({ modifiedMs: 10, text: fileText() }).io)).file;
        // the mod time has not moved since the first bad read, but a pending failure reads again
        const { io, calls } = fakeIO({ modifiedMs: 10, text: "{" });
        const patch = await pollBrainstormOnce(state({ file: good, modifiedMs: 10, failedReads: 1 }), io);
        expect(calls.reads).toBe(1);
        expect(patch.failedReads).toBe(2);
        expect(patch.error).toContain("not valid JSON");
        expect(patch.file).toBeUndefined();
    });

    it("treats a question with no numeric n as a bad read", async () => {
        const text = fileText({ question: { text: "Who?", part: "who" } });
        const patch = await pollBrainstormOnce(state({ failedReads: 1 }), fakeIO({ modifiedMs: 11, text }).io);
        expect(patch.error).toContain("question");
    });

    it("clears the error on a good read after bad ones", async () => {
        const s = state({ failedReads: 2, error: "brainstorm.json is not valid JSON", modifiedMs: 10 });
        const patch = await pollBrainstormOnce(s, fakeIO({ modifiedMs: 12, text: fileText() }).io);
        expect(patch).toMatchObject({ error: null, failedReads: 0, modifiedMs: 12 });
        expect(patch.file).not.toBeNull();
    });

    it("asks wavesrv to serve the design folder once, for a file whose parts list boards", async () => {
        const parts = [{ id: "who", title: "Who", state: "asked", body: "", boards: ["Main.dc.html"] }];
        const text = fileText({ canvas: "lag", parts });
        const { io, calls } = fakeIO({ modifiedMs: 10, text });
        const first = await pollBrainstormOnce(state(), io);
        expect(calls.serves).toEqual(["/p/.superpowers/design"]);
        expect(calls.canvasJson).toEqual([`${BASE}/lag/project/canvas.json`]);
        expect(first.base).toBe(BASE);
        expect(first.boards).toEqual([expect.objectContaining({ name: "Main.dc.html", w: 1200, h: 800 })]);
        const s = { ...state(), ...first };
        const { io: io2, calls: calls2 } = fakeIO({ modifiedMs: 11, text });
        await pollBrainstormOnce(s, io2);
        expect(calls2.serves).toEqual([]);
    });

    it("asks nothing of wavesrv for a file with no canvas", async () => {
        const { io, calls } = fakeIO({ modifiedMs: 10, text: fileText() });
        const patch = await pollBrainstormOnce(state(), io);
        expect(calls.serves).toEqual([]);
        expect(patch.base).toBeUndefined();
    });
});

describe("reconcileBrainstorms", () => {
    const WIN_PATH = "C:\\p\\.superpowers\\brainstorm\\lag\\brainstorm.json";

    it("attaches a roster agent that carries a brainstorm file and has no state", () => {
        expect(reconcileBrainstorms({}, [{ id: "a1", brainstormFile: WIN_PATH }, { id: "a2" }])).toEqual({
            attach: [{ agentId: "a1", topic: "lag", cwd: "C:\\p" }],
            detach: [],
        });
    });

    it("re-attaches an agent whose state reads another path", () => {
        const r = reconcileBrainstorms({ a1: { path: PATH } }, [{ id: "a1", brainstormFile: WIN_PATH }]);
        expect(r.attach).toEqual([{ agentId: "a1", topic: "lag", cwd: "C:\\p" }]);
    });

    it("leaves an agent whose state already reads its file", () => {
        const r = reconcileBrainstorms({ a1: { path: WIN_PATH } }, [{ id: "a1", brainstormFile: WIN_PATH }]);
        expect(r).toEqual({ attach: [], detach: [] });
    });

    it("never attaches an unparsable path", () => {
        const r = reconcileBrainstorms({}, [{ id: "a1", brainstormFile: "C:\\p\\notes.json" }]);
        expect(r.attach).toEqual([]);
    });

    it("detaches an attached agent that left a non-empty roster", () => {
        const r = reconcileBrainstorms({ gone: { path: PATH } }, [{ id: "a1" }]);
        expect(r.detach).toEqual(["gone"]);
    });

    it("detaches nothing while the roster is empty (boot)", () => {
        expect(reconcileBrainstorms({ a1: { path: PATH } }, [])).toEqual({ attach: [], detach: [] });
    });
});

describe("settleBrainstorm", () => {
    const check = { at: 1000, modifiedMs: 500, kind: "check" as const };
    const agent = (over: Partial<AgentVM> = {}): AgentVM => ({
        id: "a1",
        name: "loom",
        task: "",
        state: "idle",
        idleSince: 1500,
        ...over,
    });

    it("keeps a check's send time once the agent's turn settles it", () => {
        const r = settleBrainstorm(state({ sent: check, modifiedMs: 500 }), {}, agent(), undefined);
        expect(r).toEqual({ sent: null, sentCheckAt: 1000 });
    });

    it("keeps nothing while the check line is still pending, nor for a line that was not a check", () => {
        const working = agent({ state: "working", idleSince: undefined });
        expect(settleBrainstorm(state({ sent: check, modifiedMs: 500 }), {}, working, undefined)).toEqual({
            sent: check,
            sentCheckAt: null,
        });
        const line = { ...check, kind: "line" as const };
        expect(settleBrainstorm(state({ sent: line, modifiedMs: 500 }), {}, agent(), undefined).sentCheckAt).toBeNull();
    });

    it("clears it once Arc's record is newer than the send, and keeps it past an older one", () => {
        const newer = agent({ builderCheck: { state: "reading", ts: 1200 } });
        expect(settleBrainstorm(state({ sentCheckAt: 1000 }), {}, newer, undefined).sentCheckAt).toBeNull();
        const older = agent({ builderCheck: { state: "failed", ts: 800, reason: "x" } });
        expect(settleBrainstorm(state({ sentCheckAt: 1000 }), {}, older, undefined).sentCheckAt).toBe(1000);
    });
});

describe("listOpenBrainstorms", () => {
    const dir = "/p/.superpowers/brainstorm";
    const at = (topic: string) => `${dir}/${topic}/brainstorm.json`;
    type Listed = { text: string; modifiedMs: number } | "fails";
    function listIO(topics: string[] | null, files: Record<string, Listed>) {
        return {
            async list(path: string) {
                expect(path).toBe(dir);
                return topics ?? [];
            },
            async stat(path: string) {
                if (path === dir) {
                    return { exists: topics != null, modifiedMs: null };
                }
                const f = files[path];
                return f == null
                    ? { exists: false, modifiedMs: null }
                    : { exists: true, modifiedMs: f === "fails" ? 1 : f.modifiedMs };
            },
            async read(path: string) {
                const f = files[path];
                if (f == null || f === "fails") {
                    throw new Error("sharing violation");
                }
                return f.text;
            },
        };
    }

    it("lists the unapproved brainstorms, newest first, with their open question", async () => {
        const io = listIO(["old", "approved", "new", "notes", "broken", "busy"], {
            [at("old")]: { text: fileText({ title: "Old one" }), modifiedMs: 10 },
            [at("approved")]: { text: fileText({ done: true }), modifiedMs: 30 },
            [at("new")]: { text: fileText({ title: "New one", question: null }), modifiedMs: 20 },
            [at("broken")]: { text: "{", modifiedMs: 40 },
            [at("busy")]: "fails",
        });
        expect(await listOpenBrainstorms("/p", io)).toEqual([
            { topic: "new", path: at("new"), title: "New one", question: null, modifiedMs: 20 },
            {
                topic: "old",
                path: at("old"),
                title: "Old one",
                question: { n: 1, text: "Who gets paged?" },
                modifiedMs: 10,
            },
        ]);
    });

    it("is empty for a project that never brainstormed", async () => {
        expect(await listOpenBrainstorms("/p", listIO(null, {}))).toEqual([]);
    });

    it("leaves out one dismissed since its last change, and lists it again once the brainstorm moves on", async () => {
        const marker = `${dir}/t/dismissed`;
        const files = (brainstormMs: number) => ({
            [at("t")]: { text: fileText({ title: "T" }), modifiedMs: brainstormMs },
            // the marker is an empty file: stat sees it, read is never asked for it
            [marker]: { text: "", modifiedMs: 50 },
        });
        expect(await listOpenBrainstorms("/p", listIO(["t"], files(40)))).toEqual([]);
        // a marker the same age as the file still hides it: the dismiss came after the last write
        expect(await listOpenBrainstorms("/p", listIO(["t"], files(50)))).toEqual([]);
        expect((await listOpenBrainstorms("/p", listIO(["t"], files(60)))).map((b) => b.topic)).toEqual(["t"]);
    });
});

describe("listAllOpenBrainstorms", () => {
    it("merges every project's open brainstorms newest first, naming the project, and skips one that fails", async () => {
        const file = (title: string, modifiedMs: number) => ({ text: fileText({ title }), modifiedMs });
        const trees: Record<string, Record<string, { text: string; modifiedMs: number }>> = {
            "/a/.superpowers/brainstorm": { "/a/.superpowers/brainstorm/x/brainstorm.json": file("X", 10) },
            "/b/.superpowers/brainstorm": { "/b/.superpowers/brainstorm/y/brainstorm.json": file("Y", 20) },
        };
        const all = Object.assign({}, ...Object.values(trees));
        const io = {
            async list(path: string) {
                if (path.startsWith("/broken")) {
                    throw new Error("access denied");
                }
                return Object.keys(trees[path] ?? {}).map((f) => f.split("/").at(-2)!);
            },
            async stat(path: string) {
                const f = all[path];
                return {
                    exists: path in trees || path.startsWith("/broken") || f != null,
                    modifiedMs: f?.modifiedMs ?? null,
                };
            },
            async read(path: string) {
                return all[path].text;
            },
        };
        const rows = await listAllOpenBrainstorms(
            [
                { name: "a", path: "/a" },
                { name: "b", path: "/b" },
                { name: "broken", path: "/broken" },
                { name: "nopath", path: "" },
            ],
            io
        );
        expect(rows.map((r) => [r.project, r.projectPath, r.title])).toEqual([
            ["b", "/b", "Y"],
            ["a", "/a", "X"],
        ]);
    });
});

describe("seen boards on a poll", () => {
    const A = "A.dc.html";
    const B = "B.dc.html";
    const withBoards = (...boards: string[]) =>
        fileText({
            canvas: "lag",
            question: null,
            parts: [{ id: "who", title: "Who", state: "yours", body: "Page the owner.", boards }],
        });
    const seenOf = () => globalStore.get(brainstormSeenBoardsAtom)[PATH];
    const band = () => globalStore.get(brainstormBandAtom("a1"));

    // an agent whose brainstorm was read with boards [A], the user having looked at the tab (or not) at that point
    function attachReadOnce(shown: boolean): void {
        attachBrainstorm("a1", { topic: "t", cwd: "/p" }, 100);
        const parsed = parseBrainstorm(withBoards(A));
        if (!parsed.ok) {
            throw new Error("fixture does not parse");
        }
        updateBrainstorm("a1", (s) => ({ ...s, file: parsed.file, modifiedMs: 5 }));
        setBrainstormMode("a1", "brainstorm", 200);
        if (!shown) {
            setBrainstormMode("a1", "terminal", 300);
        }
    }

    afterEach(() => {
        detachBrainstorm("a1");
        globalStore.set(brainstormSeenBoardsAtom, {});
    });

    it("refreshes the names when a poll reads a changed file while the agent's tab is shown", async () => {
        attachReadOnce(true);
        expect(seenOf()?.names).toEqual([A]);
        await pollAndMerge("a1", undefined, fakeIO({ modifiedMs: 10, text: withBoards(A, B) }).io);
        expect(seenOf()?.names).toEqual([A, B]);
        expect(band()?.newCount).toBe(0);
    });

    it("leaves the names alone for an agent not in brainstorm mode, and reports the board as new", async () => {
        attachReadOnce(false);
        await pollAndMerge("a1", undefined, fakeIO({ modifiedMs: 10, text: withBoards(A, B) }).io);
        expect(getBrainstorm("a1")?.file?.parts[0].boards).toEqual([A, B]);
        expect(seenOf()?.names).toEqual([A]);
        expect(band()?.newCount).toBe(1);
        expect(band()?.boards.map((b) => [b.name, b.isNew])).toEqual([
            [A, false],
            [B, true],
        ]);
    });

    it("writes no entry for an agent that never opened the tab: its first boards stay new", async () => {
        attachBrainstorm("a1", { topic: "t", cwd: "/p" }, 100);
        await pollAndMerge("a1", undefined, fakeIO({ modifiedMs: 10, text: withBoards(A) }).io);
        expect(seenOf()).toBeUndefined();
        expect(band()?.newCount).toBe(1);
    });

    it("does not touch the names when the poll reads nothing", async () => {
        attachReadOnce(true);
        const before = globalStore.get(brainstormSeenBoardsAtom);
        await pollAndMerge("a1", undefined, fakeIO({ modifiedMs: 5, text: withBoards(A, B) }).io);
        expect(globalStore.get(brainstormSeenBoardsAtom)).toBe(before);
    });

    it("keeps the names when a read fails to parse", async () => {
        attachReadOnce(true);
        await pollAndMerge("a1", undefined, fakeIO({ modifiedMs: 11, text: '{"v": 1, "title": "Cons' }).io);
        expect(seenOf()?.names).toEqual([A]);
    });
});
