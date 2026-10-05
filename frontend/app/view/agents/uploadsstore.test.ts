import { globalStore } from "@/app/store/jotaiStore";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    addRecord,
    baseName,
    isExpired,
    kindForName,
    makeRecord,
    MAX_OWNERS,
    MAX_RECORDS_PER_OWNER,
    parseStored,
    pasteTextFor,
    planInserts,
    pruneOwners,
    pruneThumbs,
    quotePath,
    recordUpload,
    rowState,
    serialize,
    TEMP_RETENTION_MS,
    UPLOADS_STORAGE_KEY,
    uploadsAtom,
    uploadsMapAtom,
    uploadThumbsAtom,
    type UploadRecord,
} from "./uploadsstore";

const NOW = 1_800_000_000_000;
const HOUR = 3_600_000;

function rec(over: Partial<UploadRecord> = {}): UploadRecord {
    return {
        id: "r1",
        name: "a.png",
        path: "C:\\tmp\\waveterm-attach-1\\a.png",
        kind: "image",
        source: "paste",
        ts: NOW,
        ...over,
    };
}

function mockLocalStorage(initial: Record<string, string> = {}): Record<string, string> {
    const store: Record<string, string> = { ...initial };
    (globalThis as any).localStorage = {
        getItem: (k: string) => (k in store ? store[k] : null),
        setItem: (k: string, v: string) => {
            store[k] = v;
        },
        removeItem: (k: string) => {
            delete store[k];
        },
    };
    return store;
}

describe("baseName", () => {
    it("takes the last segment of a Windows or POSIX path", () => {
        expect(baseName("C:\\Users\\me\\a b.png")).toBe("a b.png");
        expect(baseName("/tmp/x/y.txt")).toBe("y.txt");
    });
    it("ignores a trailing separator and passes a bare name through", () => {
        expect(baseName("/tmp/dir/")).toBe("dir");
        expect(baseName("plain.txt")).toBe("plain.txt");
    });
});

describe("kindForName", () => {
    it("reads an image extension in any case", () => {
        expect(kindForName("photo.PNG")).toBe("image");
        expect(kindForName("shot.jpeg")).toBe("image");
    });
    it("calls everything else a file", () => {
        expect(kindForName("README")).toBe("file");
        expect(kindForName("archive.png.zip")).toBe("file");
        expect(kindForName("notes.pdf")).toBe("file");
    });
});

describe("isExpired", () => {
    it("keeps a fresh paste or drop", () => {
        expect(isExpired(rec({ ts: NOW }), NOW)).toBe(false);
        expect(isExpired(rec({ source: "drop", ts: NOW - 23 * HOUR }), NOW)).toBe(false);
    });
    it("expires a paste or drop only once it is older than the retention", () => {
        expect(isExpired(rec({ ts: NOW - TEMP_RETENTION_MS }), NOW)).toBe(false);
        expect(isExpired(rec({ ts: NOW - TEMP_RETENTION_MS - 1 }), NOW)).toBe(true);
        expect(isExpired(rec({ source: "drop", ts: NOW - 25 * HOUR }), NOW)).toBe(true);
    });
    it("never expires an attach, however old", () => {
        expect(isExpired(rec({ source: "attach", ts: NOW - 90 * 24 * HOUR }), NOW)).toBe(false);
    });
});

describe("quotePath and pasteTextFor", () => {
    it("leaves a path with no space alone", () => {
        expect(quotePath("C:\\tmp\\a.png")).toBe("C:\\tmp\\a.png");
    });
    it("double-quotes a path with a space", () => {
        expect(quotePath("C:\\Users\\Jo Doe\\a.png")).toBe('"C:\\Users\\Jo Doe\\a.png"');
        expect(quotePath("/home/jo/my file.txt")).toBe('"/home/jo/my file.txt"');
    });
    it("drops control characters, so a name cannot press Enter", () => {
        expect(quotePath("/tmp/a\nb.txt")).toBe("/tmp/ab.txt");
    });
    it("ends the paste with a space and never a newline", () => {
        expect(pasteTextFor("/tmp/a.png")).toBe("/tmp/a.png ");
        expect(pasteTextFor("/tmp/a b.png")).toBe('"/tmp/a b.png" ');
        expect(pasteTextFor("/tmp/a.png")).not.toMatch(/[\r\n]/);
    });
});

describe("makeRecord", () => {
    it("derives the name and kind from the path", () => {
        const r = makeRecord({ path: "C:\\x\\shot.png", source: "attach", now: NOW, nonce: "abc" });
        expect(r).toEqual({
            id: `${NOW.toString(36)}-abc`,
            name: "shot.png",
            path: "C:\\x\\shot.png",
            kind: "image",
            source: "attach",
            ts: NOW,
        });
    });
    it("takes an explicit name and kind over the derived ones", () => {
        const r = makeRecord({ path: "/t/1/x", source: "drop", now: NOW, nonce: "n", name: " Report ", kind: "file" });
        expect(r.name).toBe("Report");
        expect(r.kind).toBe("file");
    });
    it("falls back to the base name when the given one is blank", () => {
        expect(makeRecord({ path: "/t/a.txt", source: "drop", now: NOW, nonce: "n", name: "  " }).name).toBe("a.txt");
    });
});

describe("addRecord", () => {
    it("puts the newest first", () => {
        const out = addRecord([rec({ id: "old", path: "/p/old" })], rec({ id: "new", path: "/p/new" }));
        expect(out.map((r) => r.id)).toEqual(["new", "old"]);
    });
    it("replaces an earlier record of the same path and moves it to the front", () => {
        const list = [rec({ id: "a", path: "/p/a" }), rec({ id: "b", path: "/p/b" })];
        const out = addRecord(list, rec({ id: "b2", path: "/p/b", source: "attach", ts: NOW + 1 }));
        expect(out.map((r) => r.id)).toEqual(["b2", "a"]);
        expect(out[0].source).toBe("attach");
    });
    it("caps the list, dropping the oldest", () => {
        let list: UploadRecord[] = [];
        for (let i = 0; i < MAX_RECORDS_PER_OWNER + 5; i++) {
            list = addRecord(list, rec({ id: `r${i}`, path: `/p/${i}` }));
        }
        expect(list).toHaveLength(MAX_RECORDS_PER_OWNER);
        expect(list[0].id).toBe(`r${MAX_RECORDS_PER_OWNER + 4}`);
    });
});

describe("pruneOwners", () => {
    it("leaves a map within the limit as it is", () => {
        const map = { a: [rec()] };
        expect(pruneOwners(map, 2)).toBe(map);
    });
    it("keeps the owners with the newest records", () => {
        const map = {
            old: [rec({ ts: NOW - 3 * HOUR })],
            mid: [rec({ ts: NOW - HOUR })],
            fresh: [rec({ ts: NOW })],
        };
        expect(Object.keys(pruneOwners(map, 2)).sort()).toEqual(["fresh", "mid"]);
    });
});

describe("pruneThumbs", () => {
    it("drops a thumbnail no record points at and keeps the rest", () => {
        const map = { b1: [rec({ path: "/p/a.png" })] };
        expect(pruneThumbs({ "/p/a.png": "t1", "/p/gone.png": "t2" }, map)).toEqual({ "/p/a.png": "t1" });
    });
    it("returns the same object when nothing is dropped", () => {
        const thumbs = { "/p/a.png": "t1" };
        expect(pruneThumbs(thumbs, { b1: [rec({ path: "/p/a.png" })] })).toBe(thumbs);
    });
});

describe("parseStored", () => {
    it("reads nothing, garbage and a non-object as empty", () => {
        expect(parseStored(null)).toEqual({});
        expect(parseStored("")).toEqual({});
        expect(parseStored("{not json")).toEqual({});
        expect(parseStored("[1,2]")).toEqual({});
        expect(parseStored("7")).toEqual({});
    });
    it("round-trips what serialize wrote", () => {
        const map = { b1: [rec({ id: "a", path: "/p/a" }), rec({ id: "b", path: "/p/b", source: "attach" })] };
        expect(parseStored(serialize(map))).toEqual(map);
    });
    it("drops a malformed record and an owner left with none", () => {
        const raw = JSON.stringify({
            b1: [rec(), { id: "x" }, { ...rec({ id: "y" }), kind: "movie" }, { ...rec({ id: "z" }), ts: "soon" }],
            b2: [{ nope: true }],
            b3: "not a list",
        });
        const out = parseStored(raw);
        expect(Object.keys(out)).toEqual(["b1"]);
        expect(out.b1.map((r) => r.id)).toEqual(["r1"]);
    });
    it("keeps only the record fields, so a stored thumbnail cannot come back", () => {
        const raw = JSON.stringify({ b1: [{ ...rec(), thumb: "data:image/png;base64,AAAA" }] });
        expect(parseStored(raw).b1[0]).toEqual(rec());
        expect(JSON.stringify(parseStored(raw))).not.toContain("data:image");
    });
    it("skips a __proto__ key, which would otherwise swap the map's prototype", () => {
        const raw = `{"__proto__": ${JSON.stringify([rec()])}, "b1": ${JSON.stringify([rec({ id: "k" })])}}`;
        const out = parseStored(raw);
        expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
        expect(Object.keys(out)).toEqual(["b1"]);
    });
    it("caps one owner's list and the number of owners", () => {
        const many = Array.from({ length: MAX_RECORDS_PER_OWNER + 10 }, (_, i) =>
            rec({ id: `r${i}`, path: `/p/${i}` })
        );
        expect(parseStored(JSON.stringify({ b1: many })).b1).toHaveLength(MAX_RECORDS_PER_OWNER);
        const owners = Object.fromEntries(
            Array.from({ length: MAX_OWNERS + 3 }, (_, i) => [
                `b${i}`,
                [rec({ id: `o${i}`, path: `/p/${i}`, ts: NOW + i })],
            ])
        );
        expect(Object.keys(parseStored(JSON.stringify(owners)))).toHaveLength(MAX_OWNERS);
    });
});

describe("rowState", () => {
    it("shows a thumbnail when there is one", () => {
        expect(rowState(rec(), NOW, true)).toEqual({ expired: false, icon: "thumb", enlargeable: true });
    });
    it("falls back to an image or file icon without a thumbnail", () => {
        expect(rowState(rec(), NOW, false).icon).toBe("image");
        expect(rowState(rec({ kind: "file", name: "a.pdf" }), NOW, false).icon).toBe("file");
    });
    it("does not offer to enlarge a file or an expired image", () => {
        expect(rowState(rec({ kind: "file" }), NOW, false).enlargeable).toBe(false);
        expect(rowState(rec({ ts: NOW - 2 * 24 * HOUR }), NOW, true)).toEqual({
            expired: true,
            icon: "thumb",
            enlargeable: false,
        });
    });
    it("keeps an old attached image enlargeable", () => {
        expect(rowState(rec({ source: "attach", ts: NOW - 9 * 24 * HOUR }), NOW, false).enlargeable).toBe(true);
    });
});

describe("planInserts", () => {
    it("makes one record and one paste per path, quoting the ones with spaces", () => {
        let n = 0;
        const plan = planInserts(
            ["C:\\x\\a b.png", "", "C:\\x\\a b.png", "C:\\x\\c.txt"],
            "attach",
            NOW,
            () => `n${n++}`
        );
        expect(plan.map((p) => p.text)).toEqual(['"C:\\x\\a b.png" ', "C:\\x\\c.txt "]);
        expect(plan.map((p) => p.record.source)).toEqual(["attach", "attach"]);
        expect(plan.map((p) => p.record.kind)).toEqual(["image", "file"]);
        expect(plan.map((p) => p.record.name)).toEqual(["a b.png", "c.txt"]);
        expect(new Set(plan.map((p) => p.record.id)).size).toBe(2);
    });
    it("plans nothing for no paths", () => {
        expect(planInserts([], "attach", NOW, () => "n")).toEqual([]);
    });
});

describe("recordUpload", () => {
    let store: Record<string, string>;
    beforeEach(() => {
        store = mockLocalStorage();
        globalStore.set(uploadsMapAtom, {});
        globalStore.set(uploadThumbsAtom, {});
    });
    afterEach(() => {
        delete (globalThis as any).localStorage;
    });

    it("reads an owner with nothing as an empty list", () => {
        expect(globalStore.get(uploadsAtom("nobody"))).toEqual([]);
    });
    it("lists the record under its owner and persists it", () => {
        recordUpload("b1", rec());
        expect(globalStore.get(uploadsAtom("b1"))).toEqual([rec()]);
        expect(globalStore.get(uploadsAtom("b2"))).toEqual([]);
        expect(parseStored(store[UPLOADS_STORAGE_KEY])).toEqual({ b1: [rec()] });
    });
    it("keeps the thumbnail in memory and never writes it to storage", () => {
        recordUpload("b1", rec(), "data:image/png;base64,AAAA");
        expect(globalStore.get(uploadThumbsAtom)).toEqual({ [rec().path]: "data:image/png;base64,AAAA" });
        expect(store[UPLOADS_STORAGE_KEY]).not.toContain("data:image");
        expect(store[UPLOADS_STORAGE_KEY]).not.toContain("AAAA");
    });
    it("drops the thumbnail of a record the cap pushed out", () => {
        recordUpload("b1", rec({ id: "first", path: "/p/first.png" }), "t1");
        for (let i = 0; i < MAX_RECORDS_PER_OWNER; i++) {
            recordUpload("b1", rec({ id: `y${i}`, path: `/p/y${i}.png` }));
        }
        expect(globalStore.get(uploadThumbsAtom)).toEqual({});
    });
    it("keeps the earlier thumbnail when a path is recorded again without one", () => {
        recordUpload("b1", rec({ id: "a" }), "t1");
        recordUpload("b1", rec({ id: "b", source: "attach" }));
        expect(globalStore.get(uploadThumbsAtom)).toEqual({ [rec().path]: "t1" });
    });
    it("lists a repeated path once", () => {
        recordUpload("b1", rec({ id: "a" }));
        recordUpload("b1", rec({ id: "b", source: "attach" }));
        expect(globalStore.get(uploadsAtom("b1")).map((r) => r.id)).toEqual(["b"]);
    });
    it("leaves another owner's list, and its subscribers, untouched", () => {
        recordUpload("b2", rec({ id: "other", path: "/p/other" }));
        const listed = globalStore.get(uploadsAtom("b2"));
        const empty = globalStore.get(uploadsAtom("b3"));
        const seen: string[] = [];
        const unsubs = [
            globalStore.sub(uploadsAtom("b2"), () => seen.push("b2")),
            globalStore.sub(uploadsAtom("b3"), () => seen.push("b3")),
        ];
        recordUpload("b1", rec());
        unsubs.forEach((unsub) => unsub());
        expect(globalStore.get(uploadsAtom("b2"))).toBe(listed);
        expect(globalStore.get(uploadsAtom("b3"))).toBe(empty);
        expect(seen).toEqual([]);
    });
    it("keeps at most MAX_OWNERS owners, dropping the one with the oldest records and its thumbnail", () => {
        recordUpload("o0", rec({ id: "o0", path: "/p/o0.png", ts: NOW }), "t0");
        for (let i = 1; i <= MAX_OWNERS; i++) {
            recordUpload(`o${i}`, rec({ id: `o${i}`, path: `/p/o${i}`, ts: NOW + i }));
        }
        const map = globalStore.get(uploadsMapAtom);
        expect(Object.keys(map)).toHaveLength(MAX_OWNERS);
        expect(map.o0).toBeUndefined();
        expect(map[`o${MAX_OWNERS}`]).toHaveLength(1);
        expect(Object.keys(parseStored(store[UPLOADS_STORAGE_KEY]))).toHaveLength(MAX_OWNERS);
        expect(globalStore.get(uploadThumbsAtom)).toEqual({});
    });
    it("takes an owner named like an Object.prototype member", () => {
        expect(globalStore.get(uploadsAtom("toString"))).toEqual([]);
        expect(globalStore.get(uploadsAtom("constructor"))).toEqual([]);
        expect(() => recordUpload("constructor", rec())).not.toThrow();
        expect(globalStore.get(uploadsAtom("constructor"))).toEqual([rec()]);
        expect(globalStore.get(uploadsAtom("toString"))).toEqual([]);
        expect(parseStored(store[UPLOADS_STORAGE_KEY])).toEqual({ constructor: [rec()] });
    });
    it("still works in memory when storage is unavailable", () => {
        delete (globalThis as any).localStorage;
        recordUpload("b1", rec());
        expect(globalStore.get(uploadsAtom("b1"))).toEqual([rec()]);
    });
    it("still works when storage throws", () => {
        (globalThis as any).localStorage = {
            getItem: () => null,
            setItem: () => {
                throw new Error("quota");
            },
        };
        expect(() => recordUpload("b1", rec())).not.toThrow();
        expect(globalStore.get(uploadsAtom("b1"))).toEqual([rec()]);
    });
});

describe("module load", () => {
    afterEach(() => {
        delete (globalThis as any).localStorage;
        vi.resetModules();
    });
    it("starts from what an earlier session stored", async () => {
        mockLocalStorage({ [UPLOADS_STORAGE_KEY]: serialize({ b9: [rec({ id: "old" })] }) });
        vi.resetModules();
        const fresh = await import("./uploadsstore");
        const { globalStore: freshStore } = await import("@/app/store/jotaiStore");
        expect(freshStore.get(fresh.uploadsAtom("b9"))).toEqual([rec({ id: "old" })]);
    });
    it("loads with no localStorage at all", async () => {
        delete (globalThis as any).localStorage;
        vi.resetModules();
        const fresh = await import("./uploadsstore");
        const { globalStore: freshStore } = await import("@/app/store/jotaiStore");
        expect(freshStore.get(fresh.uploadsMapAtom)).toEqual({});
    });
    it("loads when reaching localStorage throws", async () => {
        Object.defineProperty(globalThis, "localStorage", {
            configurable: true,
            get() {
                throw new Error("denied");
            },
        });
        vi.resetModules();
        const fresh = await import("./uploadsstore");
        const { globalStore: freshStore } = await import("@/app/store/jotaiStore");
        expect(freshStore.get(fresh.uploadsMapAtom)).toEqual({});
        expect(() => fresh.recordUpload("b1", rec())).not.toThrow();
        expect(freshStore.get(fresh.uploadsAtom("b1"))).toEqual([rec()]);
    });
});
