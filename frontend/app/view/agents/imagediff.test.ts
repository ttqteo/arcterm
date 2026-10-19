import { RpcApi } from "@/app/store/wshclientapi";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadImageSides, reviewSelection } from "./imagediff";
import { IMAGE_MAX_BYTES } from "./imagemime";

vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));
vi.mock("@/app/store/wshclientapi", () => ({
    RpcApi: {
        FileReadCommand: vi.fn(),
        FileInfoCommand: vi.fn(),
        GitFileAtRefCommand: vi.fn(),
    },
}));
vi.mock("@/util/paths", () => ({ joinRepoPath: (root: string, rel: string) => `${root}/${rel}` }));

const PNG = "iVBORw0KGgo=";

beforeEach(() => {
    vi.resetAllMocks();
});

describe("reviewSelection", () => {
    it("reads the working tree against its base and a commit against its parent", () => {
        expect(reviewSelection("worktree", "main")).toEqual({ kind: "worktree", anchorRef: "main" });
        expect(reviewSelection("abc123", "main")).toEqual({ kind: "commit", hash: "abc123" });
    });
});

describe("loadImageSides", () => {
    it("is null for a path that is not an image", async () => {
        expect(await loadImageSides("/r", "blob.bin", undefined, reviewSelection("worktree", ""))).toBeNull();
        expect(RpcApi.GitFileAtRefCommand).not.toHaveBeenCalled();
    });

    it("reads the base as raw bytes and the working tree from disk", async () => {
        vi.mocked(RpcApi.GitFileAtRefCommand).mockResolvedValue({
            content: "",
            binary: true,
            size: 8,
            isrepo: true,
            data64: PNG,
        });
        vi.mocked(RpcApi.FileInfoCommand).mockResolvedValue({ path: "/r/a/i.png", size: 10 });
        vi.mocked(RpcApi.FileReadCommand).mockResolvedValue({ data64: "AAAA" });

        const sides = await loadImageSides("/r", "a/i.png", undefined, reviewSelection("worktree", ""));

        expect(sides).toEqual({
            before: { kind: "image", url: `data:image/png;base64,${PNG}`, bytes: 8 },
            after: { kind: "image", url: "data:image/png;base64,AAAA", bytes: 10 },
        });
        expect(RpcApi.GitFileAtRefCommand).toHaveBeenCalledWith(
            {},
            { cwd: "/r", ref: "HEAD", path: "a/i.png", maxbytes: IMAGE_MAX_BYTES, raw: true }
        );
        expect(RpcApi.FileReadCommand).toHaveBeenCalledWith({}, { info: { path: "/r/a/i.png" } });
    });

    it("reads a commit against its first parent, and the old path on a rename", async () => {
        vi.mocked(RpcApi.GitFileAtRefCommand).mockResolvedValue({
            content: "",
            binary: true,
            isrepo: true,
            data64: PNG,
        });

        await loadImageSides("/r", "new.jpg", "old.jpg", reviewSelection("abc", ""));

        const calls = vi.mocked(RpcApi.GitFileAtRefCommand).mock.calls.map((c) => [c[1].ref, c[1].path]);
        expect(calls).toEqual([
            ["abc^", "old.jpg"],
            ["abc", "new.jpg"],
        ]);
    });

    it("reads an added image as missing before and a deleted one as missing after", async () => {
        vi.mocked(RpcApi.GitFileAtRefCommand).mockResolvedValue({ content: "", missing: true, isrepo: true });
        vi.mocked(RpcApi.FileInfoCommand).mockResolvedValue({ path: "/r/i.png", size: 4 });
        vi.mocked(RpcApi.FileReadCommand).mockResolvedValue({ data64: PNG });
        const added = await loadImageSides("/r", "i.png", undefined, reviewSelection("worktree", ""));
        expect(added?.before).toEqual({ kind: "missing" });
        expect(added?.after.kind).toBe("image");

        vi.mocked(RpcApi.GitFileAtRefCommand).mockResolvedValue({
            content: "",
            binary: true,
            isrepo: true,
            data64: PNG,
        });
        vi.mocked(RpcApi.FileInfoCommand).mockResolvedValue({ path: "/r/i.png", notfound: true });
        const deleted = await loadImageSides("/r", "i.png", undefined, reviewSelection("worktree", ""));
        expect(deleted?.before.kind).toBe("image");
        expect(deleted?.after).toEqual({ kind: "missing" });
    });

    it("refuses a side over the cap without reading it", async () => {
        vi.mocked(RpcApi.GitFileAtRefCommand).mockResolvedValue({
            content: "",
            toolarge: true,
            size: 9e6,
            isrepo: true,
        });
        vi.mocked(RpcApi.FileInfoCommand).mockResolvedValue({ path: "/r/i.png", size: IMAGE_MAX_BYTES + 1 });

        const sides = await loadImageSides("/r", "i.png", undefined, reviewSelection("worktree", ""));

        expect(sides).toEqual({
            before: { kind: "toolarge", bytes: 9e6 },
            after: { kind: "toolarge", bytes: IMAGE_MAX_BYTES + 1 },
        });
        expect(RpcApi.FileReadCommand).not.toHaveBeenCalled();
    });

    it("reads a failed side as an error and keeps the other", async () => {
        vi.mocked(RpcApi.GitFileAtRefCommand).mockRejectedValue(new Error("git died"));
        vi.mocked(RpcApi.FileInfoCommand).mockResolvedValue({ path: "/r/i.webp", size: 4 });
        vi.mocked(RpcApi.FileReadCommand).mockResolvedValue({ data64: PNG });

        const sides = await loadImageSides("/r", "i.webp", undefined, reviewSelection("worktree", ""));

        expect(sides?.before).toEqual({ kind: "error" });
        expect(sides?.after).toEqual({ kind: "image", url: `data:image/webp;base64,${PNG}`, bytes: 4 });
    });
});
