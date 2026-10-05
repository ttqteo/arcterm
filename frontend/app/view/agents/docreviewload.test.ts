// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ensureSessionStart } from "./agentsessionstore";
import type { AgentAsk } from "./agentsviewmodel";
import { docReviewLoadAtom, IMAGE_MAX_BYTES, imageMime, loadDocReview, loadImage } from "./docreviewload";
import { recordShown, shownContentAtom, syncDocReview } from "./docreviewstore";

vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));
vi.mock("@/app/store/wshclientapi", () => ({
    RpcApi: {
        FileReadCommand: vi.fn(),
        FileInfoCommand: vi.fn(),
        GitChangesCommand: vi.fn(),
        GitFileAtRefCommand: vi.fn(),
    },
}));
vi.mock("./agentsessionstore", () => ({ ensureSessionStart: vi.fn() }));

const PATH = "/r/paper/main.tex";
const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
const fileData = (text: string): FileData => ({ data64: b64(text) });

const docAsk = (askId: string, path = PATH): AgentAsk => ({
    askId,
    questions: [
        {
            header: "Doc review",
            question: `${path}\nRewrote §3.`,
            options: [{ label: "Approve" }, { label: "Request changes" }],
        },
    ],
});

// each test gets its own agent, so atom families start empty
let n = 0;
function freshAgent(askId = "a1", path = PATH): string {
    const id = `agent-${++n}`;
    syncDocReview(id, docAsk(askId, path));
    return id;
}

function deferred<T>() {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

beforeEach(() => {
    for (const fn of Object.values(RpcApi)) {
        vi.mocked(fn as any).mockReset();
    }
    vi.mocked(ensureSessionStart).mockReset();
    vi.mocked(ensureSessionStart).mockResolvedValue(null);
});

describe("loadDocReview", () => {
    it("picks the baseline from the previous record before recording what it shows", async () => {
        const id = freshAgent("a2");
        recordShown(id, PATH, "Old text.", 100);
        vi.mocked(RpcApi.FileReadCommand).mockResolvedValue(fileData("New text."));

        const load = await loadDocReview(id, { askId: "a2", path: PATH }, 200);

        expect(load).toMatchObject({
            askId: "a2",
            current: "New text.",
            baseline: "Old text.",
            from: "previous",
            reviewedAt: 100,
            round: 2,
        });
        expect(globalStore.get(shownContentAtom(id))[PATH]).toEqual({ text: "New text.", at: 200 });
        expect(RpcApi.GitFileAtRefCommand).not.toHaveBeenCalled();
    });

    it("reads and records once per ask, however often it is asked", async () => {
        const id = freshAgent("a1");
        const read = deferred<FileData>();
        vi.mocked(RpcApi.FileReadCommand).mockReturnValue(read.promise);
        vi.mocked(RpcApi.GitFileAtRefCommand).mockResolvedValue({ content: "Before.", isrepo: true });

        const first = loadDocReview(id, { askId: "a1", path: PATH }, 200);
        const racing = loadDocReview(id, { askId: "a1", path: PATH }, 250);
        read.resolve(fileData("After."));
        const [a, b] = await Promise.all([first, racing]);
        const later = await loadDocReview(id, { askId: "a1", path: PATH }, 300);

        expect(a).toBe(b);
        expect(later).toBe(a);
        expect(RpcApi.FileReadCommand).toHaveBeenCalledTimes(1);
        expect(globalStore.get(shownContentAtom(id))[PATH]).toEqual({ text: "After.", at: 200 });
        expect(globalStore.get(docReviewLoadAtom(id))).toBe(a);
    });

    it("drops a load that lands after the ask changed", async () => {
        const id = freshAgent("a1");
        const read = deferred<FileData>();
        vi.mocked(RpcApi.FileReadCommand).mockReturnValue(read.promise);
        vi.mocked(RpcApi.GitFileAtRefCommand).mockResolvedValue({ content: "Before.", isrepo: true });

        const pending = loadDocReview(id, { askId: "a1", path: PATH }, 200);
        syncDocReview(id, docAsk("a2"));
        read.resolve(fileData("After."));

        expect(await pending).toBeNull();
        expect(globalStore.get(docReviewLoadAtom(id))).toBeNull();
        expect(globalStore.get(shownContentAtom(id))).toEqual({});
    });

    it("reads a missing file as current null and records nothing", async () => {
        for (const missing of [
            () => vi.mocked(RpcApi.FileReadCommand).mockRejectedValue(new Error("not found")),
            // what wavesrv answers for a path that doesn't exist
            () =>
                vi
                    .mocked(RpcApi.FileReadCommand)
                    .mockResolvedValue({ info: { path: "/r/notes/gone.md", notfound: true } }),
        ]) {
            const id = freshAgent("a1", "/r/notes/gone.md");
            missing();

            const load = await loadDocReview(id, { askId: "a1", path: "/r/notes/gone.md" }, 200);

            expect(load?.current).toBeNull();
            expect(globalStore.get(shownContentAtom(id))).toEqual({});
        }
    });

    it("falls back to HEAD with no session, reading the file's own folder", async () => {
        const id = freshAgent("a1");
        vi.mocked(RpcApi.FileReadCommand).mockResolvedValue(fileData("After."));
        vi.mocked(RpcApi.GitFileAtRefCommand).mockResolvedValue({ content: "At head.", isrepo: true });

        const load = await loadDocReview(id, { askId: "a1", path: PATH }, 200);

        expect(load).toMatchObject({ baseline: "At head.", from: "head", round: 1 });
        expect(RpcApi.GitFileAtRefCommand).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ cwd: "/r/paper", ref: "HEAD", path: "main.tex" })
        );
        expect(RpcApi.GitChangesCommand).not.toHaveBeenCalled();
    });

    it("diffs a first review against the session's start ref", async () => {
        const id = freshAgent("a1");
        vi.mocked(ensureSessionStart).mockResolvedValue(1_700_000_000);
        vi.mocked(RpcApi.FileReadCommand).mockResolvedValue(fileData("After."));
        vi.mocked(RpcApi.GitChangesCommand).mockResolvedValue({
            branch: "main",
            statusz: "",
            numstat: "",
            isrepo: true,
            ref: "5eb0de2412345678901234567890123456789012",
        });
        vi.mocked(RpcApi.GitFileAtRefCommand).mockResolvedValue({ content: "At start.", isrepo: true });

        const load = await loadDocReview(id, { askId: "a1", path: PATH, transcriptPath: "/t.jsonl" }, 200);

        expect(load).toMatchObject({ baseline: "At start.", from: "session", ref: "5eb0de24" });
        expect(RpcApi.GitChangesCommand).toHaveBeenCalledWith(expect.anything(), {
            cwd: "/r/paper",
            sessionstartts: 1_700_000_000,
        });
    });

    it("diffs a file created this session against nothing, not HEAD", async () => {
        const id = freshAgent("a1");
        vi.mocked(ensureSessionStart).mockResolvedValue(1_700_000_000);
        vi.mocked(RpcApi.FileReadCommand).mockResolvedValue(fileData("After."));
        vi.mocked(RpcApi.GitChangesCommand).mockResolvedValue({
            branch: "main",
            statusz: "",
            numstat: "",
            isrepo: true,
            ref: "abc",
        });
        vi.mocked(RpcApi.GitFileAtRefCommand).mockResolvedValue({ content: "", missing: true, isrepo: true });

        const load = await loadDocReview(id, { askId: "a1", path: PATH, transcriptPath: "/t.jsonl" }, 200);

        expect(load).toMatchObject({ baseline: "", from: "session", ref: "abc" });
    });

    it("is a new file outside a repo", async () => {
        const id = freshAgent("a1");
        vi.mocked(RpcApi.FileReadCommand).mockResolvedValue(fileData("After."));
        vi.mocked(RpcApi.GitFileAtRefCommand).mockResolvedValue({ content: "", isrepo: false });

        expect(await loadDocReview(id, { askId: "a1", path: PATH }, 200)).toMatchObject({ baseline: "", from: "new" });
    });
});

describe("imageMime", () => {
    it("knows the image types a data URL can carry", () => {
        expect(imageMime("a/b.PNG")).toBe("image/png");
        expect(imageMime("d.svg")).toBe("image/svg+xml");
        expect(imageMime("d.jpg")).toBe("image/jpeg");
        expect(imageMime("d.jpeg")).toBe("image/jpeg");
        expect(imageMime("d.gif")).toBe("image/gif");
        expect(imageMime("d.webp")).toBe("image/webp");
        expect(imageMime("d.bmp")).toBeNull();
        expect(imageMime("noext")).toBeNull();
    });
});

describe("loadImage", () => {
    it("makes a data URL of a readable image under the cap", async () => {
        vi.mocked(RpcApi.FileInfoCommand).mockResolvedValue({ path: "/r/a.png", size: 10 });
        vi.mocked(RpcApi.FileReadCommand).mockResolvedValue({ data64: "iVBORw0KGgo=" });
        expect(await loadImage("/r/ok/a.png")).toEqual({ ok: true, url: "data:image/png;base64,iVBORw0KGgo=" });
    });

    it("refuses an unknown type without reading it", async () => {
        expect(await loadImage("/r/a.tiff")).toEqual({ ok: false, why: "type" });
        expect(RpcApi.FileInfoCommand).not.toHaveBeenCalled();
    });

    it("refuses a file over the cap without reading it", async () => {
        vi.mocked(RpcApi.FileInfoCommand).mockResolvedValue({ path: "/r/big.png", size: IMAGE_MAX_BYTES + 1 });
        expect(await loadImage("/r/big/big.png")).toEqual({ ok: false, why: "size" });
        expect(RpcApi.FileReadCommand).not.toHaveBeenCalled();
    });

    it("reads a missing or unreadable file as unreadable", async () => {
        vi.mocked(RpcApi.FileInfoCommand).mockResolvedValue({ path: "/r/gone.png", notfound: true });
        expect(await loadImage("/r/gone/gone.png")).toEqual({ ok: false, why: "read" });
        vi.mocked(RpcApi.FileInfoCommand).mockResolvedValue({ path: "/r/x.png", size: 4 });
        vi.mocked(RpcApi.FileReadCommand).mockRejectedValue(new Error("denied"));
        expect(await loadImage("/r/denied/x.png")).toEqual({ ok: false, why: "read" });
    });
});
