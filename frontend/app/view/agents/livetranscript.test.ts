// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from "vitest";

const returned: string[] = [];
let openCount = 0;
// per-test generator factory so a test can stream real chunks; null = the blocking default
let genFactory: (() => any) | null = null;
// every StreamAgentTranscriptCommand request payload (path + taillines)
const streamCalls: { path: string; taillines: number }[] = [];
// a generator that blocks until we release it, and records return()
function makeGen() {
    let release: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const gen: any = {
        async next() {
            await gate; // never yields a chunk in this test; simulates a live-but-quiet stream
            return { value: undefined, done: true };
        },
        async return(v: any) {
            returned.push("returned");
            release!();
            return { value: v, done: true };
        },
        [Symbol.asyncIterator]() {
            return this;
        },
    };
    return gen;
}
// a generator that yields fixed chunks then completes
function makeChunkGen(chunks: string[][]) {
    let i = 0;
    const gen: any = {
        async next() {
            if (i < chunks.length) {
                return { value: { lines: chunks[i++] }, done: false };
            }
            return { value: undefined, done: true };
        },
        async return(v: any) {
            returned.push("returned");
            return { value: v, done: true };
        },
        [Symbol.asyncIterator]() {
            return this;
        },
    };
    return gen;
}

// the request options (timeout) of every StreamAgentTranscriptCommand call
const streamOpts: any[] = [];
// per-test projector; null = the default below
let projectorOverride: any = null;
// a generator the test feeds chunks into by hand; return() is recorded but does not end it, like a
// generator with a chunk already in flight when the stream is stopped
function makeFeedGen() {
    const waiting: ((r: IteratorResult<any>) => void)[] = [];
    const buffered: IteratorResult<any>[] = [];
    const deliver = (r: IteratorResult<any>) => {
        const w = waiting.shift();
        if (w) {
            w(r);
        } else {
            buffered.push(r);
        }
    };
    const gen: any = {
        next() {
            const b = buffered.shift();
            return b ? Promise.resolve(b) : new Promise<IteratorResult<any>>((res) => waiting.push(res));
        },
        async return(v: any) {
            returned.push("returned");
            return { value: v, done: true };
        },
        [Symbol.asyncIterator]() {
            return this;
        },
    };
    return {
        gen,
        push: (lines: string[]) => deliver({ value: { lines }, done: false }),
        end: () => deliver({ value: undefined, done: true }),
    };
}
const settle = () => new Promise((r) => setTimeout(r, 0));

vi.mock("@/app/store/wshclientapi", () => ({
    RpcApi: {
        StreamAgentTranscriptCommand: vi.fn((_client: any, data: any, opts: any) => {
            streamCalls.push(data);
            streamOpts.push(opts);
            openCount++;
            return (genFactory ?? makeGen)();
        }),
    },
}));
vi.mock("@/app/store/jotaiStore", () => {
    const store = new Map<any, any>();
    return {
        globalStore: {
            get: (a: any) => store.get(a) ?? {},
            set: (a: any, v: any) => store.set(a, v),
        },
        __store: store,
    };
});
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));
const reconnectHandlers: (() => void)[] = [];
vi.mock("@/app/store/ws", () => ({
    addWSReconnectHandler: (h: () => void) => reconnectHandlers.push(h),
}));
vi.mock("./transcriptregistry", () => ({
    // project reflects the retained line count, so a test can observe capping
    projectorFor: () =>
        projectorOverride ?? {
            project: (l: string[]) => [{ kind: "message", text: String(l.length) }],
            extractTasks: () => undefined,
        },
}));

afterEach(() => {
    returned.length = 0;
    openCount = 0;
    genFactory = null;
    projectorOverride = null;
    streamOpts.length = 0;
    streamCalls.length = 0;
    reconnectHandlers.length = 0;
    vi.clearAllMocks();
});

describe("capLines", () => {
    it("keeps all when under the cap", async () => {
        const { capLines } = await import("./livetranscript");
        expect(capLines(["a", "b"], 5)).toEqual(["a", "b"]);
    });
    it("keeps only the last max lines when over", async () => {
        const { capLines } = await import("./livetranscript");
        expect(capLines(["a", "b", "c", "d"], 2)).toEqual(["c", "d"]);
    });
});

describe("restartActiveStreams", () => {
    it("re-opens every active stream and returns the old generators", async () => {
        const { startTranscriptStream, restartActiveStreams, stopTranscriptStream } = await import("./livetranscript");
        startTranscriptStream("a", "/p/a", "claude");
        startTranscriptStream("b", "/p/b", "claude");
        expect(openCount).toBe(2);
        restartActiveStreams();
        // old two returned, two new opens
        expect(returned.length).toBe(2);
        expect(openCount).toBe(4);

        // let the stale generators' finally blocks settle (their return() already
        // resolved the blocking gate synchronously during restartActiveStreams's
        // stop(), but the for-await loop's finally runs on a later microtask)
        await new Promise((r) => setTimeout(r, 0));
        stopTranscriptStream("a");
        // proves the map still holds the restarted handle for "a": stop() reaches the
        // NEW generator and calls its return() -> 3rd push. If the finally-guard were
        // an unconditional streams.delete(id), the stale generator's finally would
        // already have deleted "a" (and "b") from the map, making this stop() a no-op
        // and returned.length would stay at 2.
        expect(returned.length).toBe(3);
    });
});

describe("pi full-history streaming", () => {
    it("requests taillines -1 for a pi agent and 300 for claude", async () => {
        const { startTranscriptStream } = await import("./livetranscript");
        startTranscriptStream("p", "/home/u/.pi/agent/sessions/s.jsonl", "pi");
        startTranscriptStream("c", "/home/u/.claude/projects/x/y.jsonl", "claude");
        const byPath = new Map(streamCalls.map((c) => [c.path, c]));
        expect(byPath.get("/home/u/.pi/agent/sessions/s.jsonl")?.taillines).toBe(-1);
        expect(byPath.get("/home/u/.claude/projects/x/y.jsonl")?.taillines).toBe(300);
    });

    it("retains every streamed line for pi but caps claude at 4000", async () => {
        genFactory = () => makeChunkGen(Array.from({ length: 4500 }, (_, i) => [`line-${i}`]));
        const { startTranscriptStream } = await import("./livetranscript");
        const store = (await import("@/app/store/jotaiStore")) as unknown as { __store: Map<any, any> };
        const { liveEntriesByIdAtom } = await import("./livetranscriptatoms");
        startTranscriptStream("pi1", "/home/u/.pi/agent/sessions/s2.jsonl", "pi");
        startTranscriptStream("c1", "/home/u/.claude/projects/x/y2.jsonl", "claude");
        await new Promise((r) => setTimeout(r, 20));
        const live = store.__store.get(liveEntriesByIdAtom) ?? {};
        // pi retains all 4500 streamed lines; claude keeps only the last 4000
        expect(live["pi1"]?.[0]?.text).toBe("4500");
        expect(live["c1"]?.[0]?.text).toBe("4000");
    });
});

describe("stream setup", () => {
    it("opens no stream for an empty path, and only one per id", async () => {
        const { startTranscriptStream, stopTranscriptStream } = await import("./livetranscript");
        startTranscriptStream("setup-empty", "", "claude");
        expect(openCount).toBe(0);
        startTranscriptStream("setup-dup", "/p/dup.jsonl", "claude");
        startTranscriptStream("setup-dup", "/p/dup.jsonl", "claude");
        expect(openCount).toBe(1);
        stopTranscriptStream("setup-dup");
    });

    it("requests the whole file for pi, by agent name in any case or by session path, and a tail for the rest", async () => {
        const { startTranscriptStream, stopTranscriptStream } = await import("./livetranscript");
        const winPi = "C:\\Users\\u\\.pi\\agent\\sessions\\s.jsonl";
        startTranscriptStream("setup-pi-a", "/p/a.jsonl", "pi");
        startTranscriptStream("setup-pi-b", "/p/b.jsonl", "PI");
        startTranscriptStream("setup-pi-c", winPi);
        startTranscriptStream("setup-other", "/p/d.jsonl", "claude");
        expect(streamCalls.map((c) => [c.path, c.taillines])).toEqual([
            ["/p/a.jsonl", -1],
            ["/p/b.jsonl", -1],
            [winPi, -1],
            ["/p/d.jsonl", 300],
        ]);
        for (const id of ["setup-pi-a", "setup-pi-b", "setup-pi-c", "setup-other"]) {
            stopTranscriptStream(id);
        }
    });

    it("asks for a stream that outlives the server's default request timeout", async () => {
        const { startTranscriptStream, stopTranscriptStream } = await import("./livetranscript");
        startTranscriptStream("setup-timeout", "/p/t.jsonl", "claude");
        expect(streamOpts).toEqual([{ timeout: 31536000000 }]);
        stopTranscriptStream("setup-timeout");
    });
});

describe("stream chunks", () => {
    const readStore = async () => {
        const store = (await import("@/app/store/jotaiStore")) as unknown as { __store: Map<any, any> };
        const atoms = await import("./livetranscriptatoms");
        const get = (a: any) => store.__store.get(a) ?? {};
        return {
            live: () => get(atoms.liveEntriesByIdAtom),
            activity: () => get(atoms.lastActivityByIdAtom),
            tasks: () => get(atoms.tasksByIdAtom),
        };
    };

    it("stops projecting once the stream is stopped, even for a chunk already in flight", async () => {
        const feed = makeFeedGen();
        genFactory = () => feed.gen;
        const { startTranscriptStream, stopTranscriptStream } = await import("./livetranscript");
        const s = await readStore();
        startTranscriptStream("chunk-cancel", "/p/c.jsonl", "claude");
        feed.push(["a"]);
        await settle();
        expect(s.live()["chunk-cancel"]).toEqual([{ kind: "message", text: "1" }]);
        stopTranscriptStream("chunk-cancel");
        feed.push(["b"]);
        await settle();
        expect(s.live()["chunk-cancel"]).toBeUndefined();
        expect(s.activity()["chunk-cancel"]).toBeUndefined();
    });

    it("skips a chunk with no lines", async () => {
        const feed = makeFeedGen();
        genFactory = () => feed.gen;
        const { startTranscriptStream, stopTranscriptStream } = await import("./livetranscript");
        const s = await readStore();
        startTranscriptStream("chunk-empty", "/p/e.jsonl", "claude");
        feed.push([]);
        await settle();
        expect(s.live()["chunk-empty"]).toBeUndefined();
        expect(s.activity()["chunk-empty"]).toBeUndefined();
        feed.push(["x"]);
        await settle();
        expect(s.live()["chunk-empty"]).toEqual([{ kind: "message", text: "1" }]);
        stopTranscriptStream("chunk-empty");
    });

    it("stamps each stream's last activity with the time its chunk arrived", async () => {
        const feeds: ReturnType<typeof makeFeedGen>[] = [];
        genFactory = () => {
            const f = makeFeedGen();
            feeds.push(f);
            return f.gen;
        };
        const now = vi.spyOn(Date, "now").mockReturnValue(12345);
        try {
            const { startTranscriptStream, stopTranscriptStream } = await import("./livetranscript");
            const s = await readStore();
            startTranscriptStream("chunk-act-1", "/p/a1.jsonl", "claude");
            startTranscriptStream("chunk-act-2", "/p/a2.jsonl", "claude");
            feeds[0].push(["a"]);
            feeds[1].push(["b"]);
            await settle();
            expect(s.activity()["chunk-act-1"]).toBe(12345);
            expect(s.activity()["chunk-act-2"]).toBe(12345);
            stopTranscriptStream("chunk-act-1");
            stopTranscriptStream("chunk-act-2");
        } finally {
            now.mockRestore();
        }
    });

    it("records a task list only when the projector extracts one", async () => {
        const feed = makeFeedGen();
        genFactory = () => feed.gen;
        const list = [{ text: "write tests", done: false }];
        projectorOverride = {
            project: () => [],
            extractTasks: (l: string[]) => (l.length > 1 ? list : undefined),
        };
        const { startTranscriptStream, stopTranscriptStream } = await import("./livetranscript");
        const s = await readStore();
        startTranscriptStream("chunk-tasks", "/p/k.jsonl", "claude");
        feed.push(["a"]);
        await settle();
        expect(Object.keys(s.tasks())).not.toContain("chunk-tasks");
        feed.push(["b"]);
        await settle();
        expect(s.tasks()["chunk-tasks"]).toEqual(list);
        stopTranscriptStream("chunk-tasks");
    });

    it("frees the id once its stream ends, so the id can be opened again", async () => {
        genFactory = () => makeChunkGen([["a"]]);
        const { startTranscriptStream, stopTranscriptStream } = await import("./livetranscript");
        startTranscriptStream("chunk-end", "/p/z.jsonl", "claude");
        await new Promise((r) => setTimeout(r, 10));
        startTranscriptStream("chunk-end", "/p/z.jsonl", "claude");
        expect(openCount).toBe(2);
        await new Promise((r) => setTimeout(r, 10));
        stopTranscriptStream("chunk-end");
    });
});
