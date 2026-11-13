// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => ({ SetMetaCommand: vi.fn() }));
// vitest runs in node here: the seen board names (chat.brainstorm.seenBoards) need a storage to be written to
const ls = vi.hoisted(() => {
    const store = new Map<string, string>();
    const mock = {
        store,
        failWrites: false,
        getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
        setItem: (k: string, v: string) => {
            if (mock.failWrites) {
                throw new Error("storage denied");
            }
            store.set(k, v);
        },
        removeItem: (k: string) => void store.delete(k),
        clear: () => store.clear(),
    };
    (globalThis as any).localStorage = mock;
    return mock;
});

vi.mock("@/app/store/wshclientapi", () => ({ RpcApi: rpc }));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));

import { globalStore } from "@/app/store/jotaiStore";
import { parseSeenBoards } from "./brainstormband";
import type { BrainstormFile, BrainstormPart } from "./brainstormmodel";
import {
    attachBrainstorm,
    brainstormAtom,
    brainstormBandAtom,
    brainstormOwner,
    brainstormsAtom,
    brainstormSeenBoardsAtom,
    detachBrainstorm,
    dismissBrainstorm,
    getBrainstorm,
    markBoardsSeen,
    moveReviewCursor,
    openBrainstormBoard,
    SEEN_BOARDS_KEY,
    setBrainstormMode,
    setReviewCursor,
    toggleReviewRow,
    updateBrainstorm,
} from "./brainstormstore";

const IDS = ["a1", "a2"];
const LAG = { topic: "lag", cwd: "/p" };
const LAG_PATH = "/p/.superpowers/brainstorm/lag/brainstorm.json";

afterEach(() => {
    IDS.forEach(detachBrainstorm);
    rpc.SetMetaCommand.mockReset();
    globalStore.set(brainstormSeenBoardsAtom, {});
    ls.clear();
    ls.failWrites = false;
});

function boardsFile(boards: string[], over: Partial<BrainstormFile> = {}): BrainstormFile {
    const parts: BrainstormPart[] = [
        { id: "who", title: "Who", state: "yours", body: "Page the owner.", boards },
        { id: "how", title: "How", state: "guess", body: "" },
    ];
    return {
        v: 1,
        title: "Lag alerts",
        spec: "",
        canvas: "lag",
        question: null,
        working: null,
        parts,
        history: [],
        done: false,
        check: null,
        run: null,
        ...over,
    };
}

function readFile(agentId: string, f: BrainstormFile): void {
    updateBrainstorm(agentId, (s) => ({ ...s, file: f }));
}

describe("attachBrainstorm", () => {
    it("starts in terminal mode with nothing read", () => {
        attachBrainstorm("a1", LAG, 100);
        expect(getBrainstorm("a1")).toEqual({
            topic: "lag",
            path: "/p/.superpowers/brainstorm/lag/brainstorm.json",
            cwd: "/p",
            mode: "terminal",
            file: null,
            error: null,
            failedReads: 0,
            removed: false,
            modifiedMs: null,
            lastViewedMs: 100,
            board: null,
            showDesign: false,
            designOpen: false,
            boards: [],
            base: null,
            sent: null,
            sentCheckAt: null,
            starting: null,
            review: { cursor: null, open: {} },
        });
        expect(globalStore.get(brainstormAtom("a1"))?.topic).toBe("lag");
    });

    it("keeps the state when the same brainstorm is revealed again", () => {
        attachBrainstorm("a1", LAG, 100);
        setBrainstormMode("a1", "brainstorm", 200);
        updateBrainstorm("a1", (s) => ({ ...s, modifiedMs: 5 }));
        attachBrainstorm("a1", LAG, 300);
        expect(getBrainstorm("a1")).toMatchObject({ mode: "brainstorm", modifiedMs: 5, lastViewedMs: 200 });
    });

    it("keeps the state when the same project is spelled with other slashes or case", () => {
        attachBrainstorm("a1", { topic: "lag", cwd: "C:/Users/me/proj" }, 100);
        setBrainstormMode("a1", "brainstorm", 200);
        attachBrainstorm("a1", { topic: "lag", cwd: "c:\\Users\\me\\proj" }, 300);
        expect(getBrainstorm("a1")).toMatchObject({ mode: "brainstorm", lastViewedMs: 200 });
    });

    it("replaces the old brainstorm when a second topic is revealed on the same agent", () => {
        attachBrainstorm("a1", LAG, 100);
        setBrainstormMode("a1", "brainstorm", 200);
        updateBrainstorm("a1", (s) => ({ ...s, modifiedMs: 5, base: "http://x" }));
        attachBrainstorm("a1", { topic: "other", cwd: "/p" }, 300);
        expect(getBrainstorm("a1")).toMatchObject({
            topic: "other",
            path: "/p/.superpowers/brainstorm/other/brainstorm.json",
            mode: "terminal",
            modifiedMs: null,
            base: null,
        });
        expect(brainstormOwner("lag")).toBeNull();
        expect(Object.keys(globalStore.get(brainstormsAtom))).toEqual(["a1"]);
    });

    it("starts over for the same topic in another project", () => {
        attachBrainstorm("a1", LAG, 100);
        updateBrainstorm("a1", (s) => ({ ...s, base: "http://x" }));
        attachBrainstorm("a1", { topic: "lag", cwd: "/q" }, 200);
        expect(getBrainstorm("a1")).toMatchObject({ cwd: "/q", base: null });
    });
});

describe("brainstorm state", () => {
    it("records when brainstorm mode is entered, not when it is left", () => {
        attachBrainstorm("a1", LAG, 100);
        setBrainstormMode("a1", "brainstorm", 250);
        expect(getBrainstorm("a1")).toMatchObject({ mode: "brainstorm", lastViewedMs: 250 });
        setBrainstormMode("a1", "terminal", 400);
        expect(getBrainstorm("a1")).toMatchObject({ mode: "terminal", lastViewedMs: 250 });
    });

    it("finds the agent that has a topic attached", () => {
        attachBrainstorm("a1", LAG, 100);
        attachBrainstorm("a2", { topic: "other", cwd: "/p" }, 100);
        expect(brainstormOwner("other")).toBe("a2");
        expect(brainstormOwner("nope")).toBeNull();
    });

    it("opens and closes a board", () => {
        attachBrainstorm("a1", LAG, 100);
        openBrainstormBoard("a1", "Main.dc.html");
        expect(getBrainstorm("a1")?.board).toBe("Main.dc.html");
        openBrainstormBoard("a1", null);
        expect(getBrainstorm("a1")?.board).toBeNull();
    });

    it("ignores an update for an agent with nothing attached", () => {
        updateBrainstorm("a2", (s) => ({ ...s, mode: "brainstorm" }));
        expect(getBrainstorm("a2")).toBeNull();
    });
});

describe("review cursor", () => {
    const ids = ["x", "y", "z"];
    const cursor = () => getBrainstorm("a1")?.review.cursor;

    it("starts at the first row from no cursor, whichever way it moves", () => {
        attachBrainstorm("a1", LAG, 100);
        moveReviewCursor("a1", ids, -1);
        expect(cursor()).toBe("x");
        updateBrainstorm("a1", (s) => ({ ...s, review: { ...s.review, cursor: null } }));
        moveReviewCursor("a1", ids, 1);
        expect(cursor()).toBe("x");
    });

    it("moves by one and stops at both ends", () => {
        attachBrainstorm("a1", LAG, 100);
        setReviewCursor("a1", "y");
        moveReviewCursor("a1", ids, 1);
        expect(cursor()).toBe("z");
        moveReviewCursor("a1", ids, 1);
        expect(cursor()).toBe("z");
        setReviewCursor("a1", "x");
        moveReviewCursor("a1", ids, -1);
        expect(cursor()).toBe("x");
    });

    it("restarts at the first row when the cursor's row is gone", () => {
        attachBrainstorm("a1", LAG, 100);
        setReviewCursor("a1", "gone");
        moveReviewCursor("a1", ids, 1);
        expect(cursor()).toBe("x");
    });

    it("leaves the cursor alone with no rows", () => {
        attachBrainstorm("a1", LAG, 100);
        setReviewCursor("a1", "y");
        moveReviewCursor("a1", [], 1);
        expect(cursor()).toBe("y");
    });

    it("toggles one row open and closed, the others untouched", () => {
        attachBrainstorm("a1", LAG, 100);
        toggleReviewRow("a1", "x");
        toggleReviewRow("a1", "y");
        toggleReviewRow("a1", "x");
        expect(getBrainstorm("a1")?.review.open).toEqual({ x: false, y: true });
    });
});

describe("seen boards", () => {
    const seenOf = (path = LAG_PATH) => globalStore.get(brainstormSeenBoardsAtom)[path];
    const band = (agentId = "a1") => globalStore.get(brainstormBandAtom(agentId));

    it("takes the names when the Brainstorm tab opens", () => {
        attachBrainstorm("a1", LAG, 100);
        readFile("a1", boardsFile(["A.dc.html", "B.dc.html"]));
        expect(band()?.newCount).toBe(2);
        setBrainstormMode("a1", "brainstorm", 250);
        expect(seenOf()).toEqual({ names: ["A.dc.html", "B.dc.html"], at: 250 });
        expect(band()?.newCount).toBe(0);
    });

    it("does not take them when the tab goes back to the terminal", () => {
        attachBrainstorm("a1", LAG, 100);
        readFile("a1", boardsFile(["A.dc.html"]));
        setBrainstormMode("a1", "brainstorm", 250);
        readFile("a1", boardsFile(["A.dc.html", "B.dc.html"]));
        setBrainstormMode("a1", "terminal", 400);
        expect(seenOf()).toEqual({ names: ["A.dc.html"], at: 250 });
        expect(band()?.newCount).toBe(1);
    });

    it("takes nothing while the file has not been read yet", () => {
        attachBrainstorm("a1", LAG, 100);
        setBrainstormMode("a1", "brainstorm", 250);
        expect(seenOf()).toBeUndefined();
    });

    it("reports a board added after the tab was opened as new", () => {
        attachBrainstorm("a1", LAG, 100);
        readFile("a1", boardsFile(["A.dc.html"]));
        setBrainstormMode("a1", "brainstorm", 250);
        setBrainstormMode("a1", "terminal", 300);
        readFile("a1", boardsFile(["A.dc.html", "B.dc.html"]));
        const m = band();
        expect(m?.newCount).toBe(1);
        expect(m?.boards.map((b) => [b.name, b.isNew])).toEqual([
            ["A.dc.html", false],
            ["B.dc.html", true],
        ]);
    });

    it("reads every board as new for a brainstorm with no entry", () => {
        attachBrainstorm("a1", LAG, 100);
        readFile("a1", boardsFile(["A.dc.html", "B.dc.html"]));
        expect(band()?.newCount).toBe(2);
    });

    it("is persisted under chat.brainstorm.seenBoards", () => {
        attachBrainstorm("a1", LAG, 100);
        readFile("a1", boardsFile(["A.dc.html"]));
        setBrainstormMode("a1", "brainstorm", 250);
        expect(SEEN_BOARDS_KEY).toBe("chat.brainstorm.seenBoards");
        expect(parseSeenBoards(ls.store.get("chat.brainstorm.seenBoards"))).toEqual({
            [LAG_PATH]: { names: ["A.dc.html"], at: 250 },
        });
    });

    it("is kept per brainstorm file, so another agent's names are its own", () => {
        attachBrainstorm("a1", LAG, 100);
        attachBrainstorm("a2", { topic: "other", cwd: "/p" }, 100);
        readFile("a1", boardsFile(["A.dc.html"]));
        readFile("a2", boardsFile(["A.dc.html"]));
        setBrainstormMode("a1", "brainstorm", 250);
        expect(band("a1")?.newCount).toBe(0);
        expect(band("a2")?.newCount).toBe(1);
    });

    it("writes nothing when the names are already the stored ones", () => {
        attachBrainstorm("a1", LAG, 100);
        readFile("a1", boardsFile(["A.dc.html"]));
        setBrainstormMode("a1", "brainstorm", 250);
        const before = globalStore.get(brainstormSeenBoardsAtom);
        markBoardsSeen(LAG_PATH, boardsFile(["A.dc.html"]), 900);
        expect(globalStore.get(brainstormSeenBoardsAtom)).toBe(before);
        expect(seenOf()?.at).toBe(250);
    });

    it("has no band model with no brainstorm attached, or before its file is read", () => {
        expect(band("a2")).toBeNull();
        attachBrainstorm("a1", LAG, 100);
        expect(band()).toBeNull();
    });

    it("keeps the band's decisions and an empty board list before any board exists", () => {
        attachBrainstorm("a1", LAG, 100);
        readFile("a1", boardsFile([]));
        const m = band();
        expect(m?.boards).toEqual([]);
        expect(m?.newCount).toBe(0);
        expect(m?.decided.map((g) => g.id)).toEqual(["who"]);
    });

    it("degrades to memory with one warning when the storage cannot be written", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        ls.failWrites = true;
        markBoardsSeen(LAG_PATH, boardsFile(["A.dc.html"]), 10);
        markBoardsSeen(LAG_PATH, boardsFile(["A.dc.html", "B.dc.html"]), 20);
        expect(seenOf()).toEqual({ names: ["A.dc.html", "B.dc.html"], at: 20 });
        expect(warn).toHaveBeenCalledTimes(1);
        warn.mockRestore();
    });

    it("is seeded from the storage at module load", async () => {
        ls.store.set(SEEN_BOARDS_KEY, JSON.stringify({ [LAG_PATH]: { names: ["A.dc.html"], at: 7 } }));
        vi.resetModules();
        const fresh = await import("./brainstormstore");
        const { globalStore: freshStore } = await import("@/app/store/jotaiStore");
        expect(freshStore.get(fresh.brainstormSeenBoardsAtom)).toEqual({ [LAG_PATH]: { names: ["A.dc.html"], at: 7 } });
    });
});

describe("dismissBrainstorm", () => {
    it("detaches and clears the tab's brainstorm meta", async () => {
        rpc.SetMetaCommand.mockResolvedValue(undefined);
        attachBrainstorm("a1", LAG, 100);
        await dismissBrainstorm("a1");
        expect(getBrainstorm("a1")).toBeNull();
        expect(rpc.SetMetaCommand).toHaveBeenCalledWith(expect.anything(), {
            oref: "tab:a1",
            meta: { "session:brainstorm": null },
        });
    });

    it("still detaches when the meta write fails", async () => {
        rpc.SetMetaCommand.mockRejectedValue(new Error("no route"));
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        attachBrainstorm("a1", LAG, 100);
        await dismissBrainstorm("a1");
        expect(getBrainstorm("a1")).toBeNull();
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });
});
