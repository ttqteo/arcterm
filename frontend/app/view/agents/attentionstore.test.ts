import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentVM } from "./agentsviewmodel";
import {
    attentionAtom,
    brainstormAttentionItems,
    cockpitWaitingCount,
    loadAttention,
    splitAttention,
    taskbarSignal,
} from "./attentionstore";
import type { BrainstormFile } from "./brainstormmodel";
import type { BrainstormState } from "./brainstormstore";

vi.mock("@/app/store/wshclientapi", () => ({
    RpcApi: { GetAttentionCommand: vi.fn() },
}));

const item = (over: Partial<AttentionItem>): AttentionItem =>
    ({ kind: "ask", key: "k", source: "s", text: "t", action: "Answer", waitingsince: 0, ...over }) as AttentionItem;

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

describe("loadAttention", () => {
    beforeEach(() => {
        vi.mocked(RpcApi.GetAttentionCommand).mockReset();
        globalStore.set(attentionAtom, []);
    });

    it("ignores an older response that finishes after a newer load", async () => {
        const older = deferred<{ items: AttentionItem[] }>();
        const newer = deferred<{ items: AttentionItem[] }>();
        vi.mocked(RpcApi.GetAttentionCommand).mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);

        const olderLoad = loadAttention();
        const newerLoad = loadAttention();
        newer.resolve({ items: [item({ key: "newer" })] });
        await newerLoad;
        older.resolve({ items: [item({ key: "older" })] });
        await olderLoad;

        expect(globalStore.get(attentionAtom).map((entry) => entry.key)).toEqual(["newer"]);
    });
});

describe("taskbarSignal", () => {
    it("flashes for an item that was not in the previous list while Arc is unfocused", () => {
        expect(taskbarSignal([item({ key: "a" })], [item({ key: "a" }), item({ key: "b" })], false)).toBe("flash");
    });

    it("flashes when an item is replaced by another, though the count is unchanged", () => {
        expect(taskbarSignal([item({ key: "a" })], [item({ key: "b" })], false)).toBe("flash");
    });

    it("does not flash again for an item it already flashed for", () => {
        expect(taskbarSignal([item({ key: "a" })], [item({ key: "a" })], false)).toBeNull();
    });

    it("does not flash while Arc has focus", () => {
        expect(taskbarSignal([], [item({ key: "a" })], true)).toBeNull();
    });

    it("clears once the list empties, and only then", () => {
        expect(taskbarSignal([item({ key: "a" })], [], false)).toBe("clear");
        expect(taskbarSignal([], [], false)).toBeNull();
    });
});

describe("splitAttention", () => {
    it("counts asks on Cockpit, channel or not", () => {
        const out = splitAttention([item({ key: "a", kind: "ask", channelid: "c1" }), item({ key: "b", kind: "ask" })]);
        expect(out.cockpit.map((i) => i.key)).toEqual(["a", "b"]);
        expect(out.jarvis).toHaveLength(0);
    });

    it("counts gates, runs, escalations, due chunks, learn proposals and councils on Jarvis, not Cockpit", () => {
        const out = splitAttention([
            item({ key: "a", kind: "ask" }),
            item({ key: "c", kind: "dag-gate", channelid: "c2" }),
            item({ key: "d", kind: "escalation", channelid: "c1" }),
            item({ key: "e", kind: "run-land-held", channelid: "c1" }),
            item({ key: "f", kind: "run-unverified", channelid: "c1" }),
            item({ key: "g", kind: "chunk-due" }),
            item({ key: "h", kind: "learn-proposal" }),
            item({ key: "i", kind: "council", oref: "council:c1" }),
        ]);
        expect(out.cockpit.map((i) => i.key)).toEqual(["a"]);
        expect(out.jarvis.map((i) => i.key)).toEqual(["c", "d", "e", "f", "g", "h", "i"]);
    });

    it("routes radar triage to the Radar badge, even though it names no channel", () => {
        const out = splitAttention([
            item({ key: "r", kind: "radar-triage", channelid: "", oref: "radarreport:x" }),
            item({ key: "b", kind: "ask" }),
        ]);
        expect(out.radar.map((i) => i.key)).toEqual(["r"]);
        expect(out.cockpit.map((i) => i.key)).toEqual(["b"]);
    });

    it("keeps the three groups disjoint and complete, in server order", () => {
        const items = [
            item({ key: "a", kind: "ask" }),
            item({ key: "r", kind: "radar-triage" }),
            item({ key: "g", kind: "dag-gate" }),
            item({ key: "b", kind: "ask" }),
        ];
        const out = splitAttention(items);
        expect(out.cockpit.length + out.jarvis.length + out.radar.length).toBe(items.length);
        expect(out.cockpit.map((i) => i.key)).toEqual(["a", "b"]);
    });

    it("reads a missing list as empty", () => {
        const out = splitAttention(undefined as unknown as AttentionItem[]);
        expect(out.cockpit).toHaveLength(0);
        expect(out.jarvis).toHaveLength(0);
        expect(out.radar).toHaveLength(0);
    });
});

describe("brainstormAttentionItems", () => {
    const agent = (over: Partial<AgentVM>): AgentVM =>
        ({ id: "a1", name: "Planner", task: "", state: "idle", agent: "claude", model: "", ...over }) as AgentVM;
    const file = (over: Partial<BrainstormFile> = {}): BrainstormFile => ({
        v: 1,
        title: "Lag alerts",
        spec: "",
        question: { n: 5, text: "Who gets paged?", part: "who" },
        working: null,
        parts: [],
        history: [],
        done: false,
        check: null,
        run: null,
        ...over,
    });
    const state = (over: Partial<BrainstormState> = {}): BrainstormState => ({
        topic: "lag-alerts",
        path: "/p/.superpowers/brainstorm/lag-alerts/brainstorm.json",
        cwd: "/p",
        mode: "terminal",
        file: file(),
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
        ...over,
    });

    it("lists an agent whose file holds a question and whose turn ended, with the question's number in its key", () => {
        const items = brainstormAttentionItems([agent({})], { a1: state() });
        expect(items).toHaveLength(1);
        expect(items[0]).toMatchObject({
            kind: "brainstorm",
            key: "brainstorm:a1:5",
            source: "Planner",
            text: "Who gets paged?",
            oref: "brainstorm:lag-alerts",
        });
    });

    it("reads an agent at its prompt as ended, whatever state its status folds to", () => {
        const items = brainstormAttentionItems([agent({ state: "working", atPrompt: true })], { a1: state() });
        expect(items.map((i) => i.key)).toEqual(["brainstorm:a1:5"]);
    });

    it("lists nothing for an agent still working, or one with no question, a note being written or no file", () => {
        expect(brainstormAttentionItems([agent({ state: "working" })], { a1: state() })).toEqual([]);
        expect(brainstormAttentionItems([agent({})], { a1: state({ file: file({ question: null }) }) })).toEqual([]);
        expect(brainstormAttentionItems([agent({})], { a1: state({ file: file({ working: "Writing" }) }) })).toEqual(
            []
        );
        expect(brainstormAttentionItems([agent({})], { a1: state({ file: null }) })).toEqual([]);
        expect(brainstormAttentionItems([agent({})], {})).toEqual([]);
    });

    it("lists nothing while a line Arc sent is not yet taken: the pane shows the agent writing", () => {
        const sent = { at: 1, modifiedMs: null, kind: "answer" as const };
        expect(brainstormAttentionItems([agent({})], { a1: state({ sent }) })).toEqual([]);
    });

    it("keeps the roster's order and skips the agents that have no brainstorm", () => {
        const items = brainstormAttentionItems(
            [agent({ id: "a2", name: "Second" }), agent({ id: "a3", name: "Third" }), agent({})],
            { a1: state(), a2: state({ topic: "two" }) }
        );
        expect(items.map((i) => i.key)).toEqual(["brainstorm:a2:5", "brainstorm:a1:5"]);
    });

    it("a new question flashes the taskbar while Arc is unfocused, and the same one does not flash again", () => {
        const server = [item({ key: "ask:block:b1" })];
        const first = [...server, ...brainstormAttentionItems([agent({})], { a1: state() })];
        expect(taskbarSignal(server, first, false)).toBe("flash");
        expect(
            taskbarSignal(first, [...server, ...brainstormAttentionItems([agent({})], { a1: state() })], false)
        ).toBeNull();
        const nextFile = file({ question: { n: 6, text: "How often?", part: "rate" } });
        const next = [...server, ...brainstormAttentionItems([agent({})], { a1: state({ file: nextFile }) })];
        expect(taskbarSignal(first, next, false)).toBe("flash");
        // answered: the question leaves the list, and the button clears once nothing else is waiting
        expect(taskbarSignal(next, [], false)).toBe("clear");
    });
});

describe("cockpitWaitingCount", () => {
    const agent = (over: Partial<AgentVM>): AgentVM =>
        ({ id: "a", name: "a", task: "", state: "idle", agent: "claude", model: "", ...over }) as AgentVM;

    it("counts an agent at a permission prompt that the server list does not know", () => {
        const agents = [agent({ id: "a1", state: "asking", blockId: "b1" }), agent({ id: "a2", state: "working" })];
        expect(cockpitWaitingCount([], agents, new Set())).toBe(1);
    });

    it("counts an ask both the roster and the server list know once", () => {
        const agents = [agent({ id: "a1", state: "asking", blockId: "b1" })];
        const items = [item({ kind: "ask", key: "ask:block:b1" }), item({ kind: "ask", key: "ask:block:b2" })];
        expect(cockpitWaitingCount(items, agents, new Set())).toBe(2);
    });

    it("keeps a server ask whose agent is not in the roster, and drops an ask Jarvis answered", () => {
        const agents = [agent({ id: "a1", state: "asking", blockId: "b1", ask: { askId: "x" } as AgentVM["ask"] })];
        const items = [item({ kind: "ask", key: "ask:block:b9" })];
        expect(cockpitWaitingCount(items, agents, new Set(["x"]))).toBe(1);
    });
});
