import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { attentionAtom, loadAttention, splitAttention } from "./attentionstore";

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

describe("splitAttention", () => {
    it("counts every item but radar triage on Cockpit, channel or not", () => {
        const out = splitAttention([
            item({ key: "a", channelid: "c1" }),
            item({ key: "b" }),
            item({ key: "c", kind: "dag-gate", channelid: "c2" }),
            item({ key: "d", kind: "escalation", channelid: "c1" }),
            item({ key: "e", kind: "run-land-held", channelid: "c1" }),
        ]);
        expect(out.cockpit.map((i) => i.key)).toEqual(["a", "b", "c", "d", "e"]);
        expect(out.radar).toHaveLength(0);
    });

    it("gives Jarvis no group: its nav entry carries no attention badge", () => {
        const out = splitAttention([item({ key: "a", channelid: "c1" })]);
        expect(Object.keys(out).sort()).toEqual(["cockpit", "radar"]);
    });

    it("routes radar triage to the Radar badge, not Cockpit, even though it names no channel", () => {
        const out = splitAttention([
            item({ key: "r", kind: "radar-triage", channelid: "", oref: "radarreport:x" }),
            item({ key: "b" }),
        ]);
        expect(out.radar.map((i) => i.key)).toEqual(["r"]);
        expect(out.cockpit.map((i) => i.key)).toEqual(["b"]);
    });

    it("keeps the two groups disjoint and complete, in server order", () => {
        const items = [
            item({ key: "a", channelid: "c1" }),
            item({ key: "r", kind: "radar-triage" }),
            item({ key: "b" }),
        ];
        const out = splitAttention(items);
        expect(out.cockpit.length + out.radar.length).toBe(items.length);
        expect(out.cockpit.map((i) => i.key)).toEqual(["a", "b"]);
    });

    it("reads a missing list as empty", () => {
        const out = splitAttention(undefined as unknown as AttentionItem[]);
        expect(out.cockpit).toHaveLength(0);
        expect(out.radar).toHaveLength(0);
    });
});
