// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ list: vi.fn(), listDir: vi.fn() }));
vi.mock("@/app/store/wshclientapi", () => ({
    RpcApi: { GitListFilesCommand: mocks.list, GitListIgnoredDirCommand: mocks.listDir },
}));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));

import { globalStore } from "@/app/store/jotaiStore";
import { EMPTY_RAIL_TREE } from "./railtree";
import {
    listIgnoredDirs,
    railIgnoredListedAtom,
    railListingsAtom,
    railTreeStateAtom,
    reachableListed,
    reloadTree,
} from "./railtreestore";

const CWD = "/repo";
const AGENT = "agent-1";

function deferred<T>() {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

const listing = () => globalStore.get(railListingsAtom)[CWD];

beforeEach(() => {
    mocks.list.mockReset();
    mocks.listDir.mockReset();
    globalStore.set(railListingsAtom, {});
    globalStore.set(railIgnoredListedAtom, {});
    globalStore.set(railTreeStateAtom(AGENT), EMPTY_RAIL_TREE);
});

describe("reloadTree", () => {
    it("loads a repo's files, ignored entries and truncation", async () => {
        mocks.list.mockResolvedValue({
            files: ["a.ts", "src/b.ts"],
            ignored: ["build/"],
            isrepo: true,
            truncated: true,
        });
        const pending = reloadTree(CWD, AGENT);
        expect(listing()?.status).toBe("loading");
        await pending;
        expect(listing()).toEqual({
            status: "ready",
            files: ["a.ts", "src/b.ts"],
            ignored: ["build/"],
            truncated: true,
        });
    });

    it("keeps the rows it has while a reload is in flight", async () => {
        mocks.list.mockResolvedValueOnce({ files: ["a.ts"], isrepo: true });
        await reloadTree(CWD, AGENT);
        const next = deferred<unknown>();
        mocks.list.mockReturnValueOnce(next.promise);
        const pending = reloadTree(CWD, AGENT);
        expect(listing()?.status).toBe("loading");
        expect(listing()?.files).toEqual(["a.ts"]);
        next.resolve({ files: ["a.ts", "NEW.md"], isrepo: true });
        await pending;
        expect(listing()?.status).toBe("ready");
        expect(listing()?.files).toEqual(["a.ts", "NEW.md"]);
    });

    it("drops the reply of a load a newer one overtook", async () => {
        const slow = deferred<unknown>();
        mocks.list.mockReturnValueOnce(slow.promise);
        const first = reloadTree(CWD, AGENT);
        mocks.list.mockResolvedValueOnce({ files: ["new.ts"], isrepo: true });
        await reloadTree(CWD, AGENT);
        slow.resolve({ files: ["stale.ts"], isrepo: true });
        await first;
        expect(listing()?.files).toEqual(["new.ts"]);
    });

    it("drops the error of a load a newer one overtook", async () => {
        const slow = deferred<unknown>();
        mocks.list.mockReturnValueOnce(slow.promise);
        const first = reloadTree(CWD, AGENT);
        mocks.list.mockResolvedValueOnce({ files: ["new.ts"], isrepo: true });
        await reloadTree(CWD, AGENT);
        slow.reject(new Error("boom"));
        await first;
        expect(listing()?.status).toBe("ready");
    });

    it("stores a failure with its message in place of the rows", async () => {
        mocks.list.mockResolvedValueOnce({ files: ["a.ts"], isrepo: true });
        await reloadTree(CWD, AGENT);
        mocks.list.mockRejectedValueOnce(new Error("fatal: bad index file"));
        await reloadTree(CWD, AGENT);
        expect(listing()).toMatchObject({ status: "error", error: "fatal: bad index file", files: [] });
    });

    it("says a directory that is not a repository is one", async () => {
        mocks.list.mockResolvedValue({ files: [], isrepo: false });
        await reloadTree(CWD, AGENT);
        expect(listing()).toMatchObject({ status: "notrepo", files: [] });
    });

    it("drops the agent's expanded and selected paths that the reload removed", async () => {
        globalStore.set(railTreeStateAtom(AGENT), {
            expanded: ["src", "gone"],
            selected: ["src/b.ts", "gone/c.ts"],
            anchor: "gone/c.ts",
            cursor: "src/b.ts",
        });
        mocks.list.mockResolvedValue({ files: ["src/b.ts"], isrepo: true });
        await reloadTree(CWD, AGENT);
        expect(globalStore.get(railTreeStateAtom(AGENT))).toEqual({
            expanded: ["src"],
            selected: ["src/b.ts"],
            anchor: null,
            cursor: "src/b.ts",
        });
    });

    it("does not prune against a failed load", async () => {
        const state = { expanded: ["src"], selected: [], anchor: null, cursor: null };
        globalStore.set(railTreeStateAtom(AGENT), state);
        mocks.list.mockRejectedValue(new Error("boom"));
        await reloadTree(CWD, AGENT);
        expect(globalStore.get(railTreeStateAtom(AGENT))).toBe(state);
    });

    it("refreshes the ignored directories it had listed, and retires the ones no longer ignored whole", async () => {
        mocks.list.mockResolvedValueOnce({ files: ["a.ts"], ignored: ["build/", "dist/"], isrepo: true });
        await reloadTree(CWD, AGENT);
        globalStore.set(railIgnoredListedAtom, { [CWD]: { build: ["build/out.js"], dist: ["dist/x.js"] } });
        mocks.list.mockResolvedValueOnce({ files: ["a.ts"], ignored: ["build/"], isrepo: true });
        mocks.listDir.mockResolvedValue({ entries: ["build/out.js", "build/new.js"] });
        await reloadTree(CWD, AGENT);
        expect(mocks.listDir).toHaveBeenCalledTimes(1);
        expect(globalStore.get(railIgnoredListedAtom)[CWD]).toEqual({ build: ["build/out.js", "build/new.js"] });
    });
});

describe("listIgnoredDirs", () => {
    it("lists an expanded ignored directory once and stores its entries", async () => {
        mocks.list.mockResolvedValue({ files: ["a.ts"], ignored: ["build/"], isrepo: true });
        await reloadTree(CWD, AGENT);
        mocks.listDir.mockResolvedValue({ entries: ["build/out.js"] });
        await listIgnoredDirs(CWD, ["build"]);
        await listIgnoredDirs(CWD, ["build"]);
        expect(mocks.listDir).toHaveBeenCalledTimes(1);
        expect(mocks.listDir).toHaveBeenCalledWith({}, { cwd: CWD, dir: "build" });
        expect(globalStore.get(railIgnoredListedAtom)[CWD]).toEqual({ build: ["build/out.js"] });
    });

    it("lists nothing for a directory that is not ignored whole", async () => {
        mocks.list.mockResolvedValue({ files: ["src/a.ts"], ignored: ["build/"], isrepo: true });
        await reloadTree(CWD, AGENT);
        await listIgnoredDirs(CWD, ["src"]);
        expect(mocks.listDir).not.toHaveBeenCalled();
    });

    it("opens an unreadable directory empty", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        mocks.list.mockResolvedValue({ files: [], ignored: ["build/"], isrepo: true });
        await reloadTree(CWD, AGENT);
        mocks.listDir.mockRejectedValue(new Error("denied"));
        await listIgnoredDirs(CWD, ["build"]);
        expect(globalStore.get(railIgnoredListedAtom)[CWD]).toEqual({ build: [] });
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });
});

describe("reachableListed", () => {
    it("keeps the listed directories the listing leads to, nested ones included", () => {
        const listed = {
            build: ["build/out.js", "build/cache/"],
            "build/cache": ["build/cache/x"],
            dist: ["dist/y"],
            "gone/deep": ["gone/deep/z"],
        };
        expect(reachableListed(["build/"], listed)).toEqual({
            build: listed.build,
            "build/cache": listed["build/cache"],
        });
    });

    it("keeps nothing for a directory that was never listed", () => {
        expect(reachableListed(["build/"], {})).toEqual({});
    });
});
