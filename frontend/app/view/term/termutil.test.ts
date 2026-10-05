import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    write: vi.fn(async (_client: unknown, data: { filename: string; data64: string }, _opts?: { timeout?: number }) => {
        return `/tmp/attach/${data.filename}`;
    }),
    client: { routeId: "tab" },
}));

vi.mock("@/app/store/wshclientapi", () => ({ RpcApi: { WriteTempFileCommand: mocks.write } }));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: mocks.client }));

import { MAX_UPLOAD_BYTES, UploadError } from "@/app/view/agents/uploadfile";
import { createTempFileFromBlob, createTempFileFromFile } from "./termutil";

// the tests run in node, which has no FileReader; this one reads a Blob the way the real one hands bytes back
class FakeFileReader {
    result: ArrayBuffer | null = null;
    onload: (() => void) | null = null;
    onerror: ((err: unknown) => void) | null = null;

    readAsArrayBuffer(blob: Blob) {
        blob.arrayBuffer().then(
            (buf) => {
                this.result = buf;
                this.onload?.();
            },
            (err) => this.onerror?.(err)
        );
    }
}

beforeAll(() => {
    vi.stubGlobal("FileReader", FakeFileReader);
});

afterEach(() => {
    mocks.write.mockClear();
});

const bytes = (n: number) => new Uint8Array(n);

describe("createTempFileFromFile", () => {
    it("sends the bytes under the cleaned name, with a timeout so a lost message cannot hang the caller", async () => {
        const f = new File([new Uint8Array([1, 2, 3])], "we:ird name.bin");
        await expect(createTempFileFromFile(f)).resolves.toBe("/tmp/attach/we_ird name.bin");
        expect(mocks.write).toHaveBeenCalledTimes(1);
        const [client, data, opts] = mocks.write.mock.calls[0];
        expect(client).toBe(mocks.client);
        expect(data).toEqual({ filename: "we_ird name.bin", data64: "AQID" });
        expect(opts?.timeout).toBeGreaterThan(0);
    });
    it("takes a file of exactly the cap", async () => {
        await createTempFileFromFile(new File([bytes(MAX_UPLOAD_BYTES)], "edge.bin"));
        expect(mocks.write).toHaveBeenCalledTimes(1);
    });
    it("refuses a file over the cap before anything is read or sent", async () => {
        const f = new File([bytes(MAX_UPLOAD_BYTES + 1)], "big.bin");
        await expect(createTempFileFromFile(f)).rejects.toMatchObject({
            code: "too-large",
            fileName: "big.bin",
            message: "big.bin is over 3.5 MB",
        });
        expect(mocks.write).not.toHaveBeenCalled();
    });
    it("turns a failed write into an UploadError that names the file", async () => {
        const logged = vi.spyOn(console, "error").mockImplementation(() => {});
        mocks.write.mockRejectedValueOnce(new Error("EC-TIME: timeout waiting for response"));
        const err = await createTempFileFromFile(new File([bytes(4)], "a.txt")).catch((e) => e);
        logged.mockRestore();
        expect(err).toBeInstanceOf(UploadError);
        expect(err).toMatchObject({ code: "error", fileName: "a.txt" });
    });
});

describe("createTempFileFromBlob", () => {
    it("writes a pasted image under a generated name, with the same timeout", async () => {
        const path = await createTempFileFromBlob(new Blob([bytes(4)], { type: "image/png" }));
        expect(path).toMatch(/^\/tmp\/attach\/waveterm_paste_\d+_[a-z0-9]+\.png$/);
        expect(mocks.write.mock.calls[0][2]?.timeout).toBeGreaterThan(0);
    });
    it("shares the cap with file copies", async () => {
        await createTempFileFromBlob(new Blob([bytes(MAX_UPLOAD_BYTES)], { type: "image/png" }));
        expect(mocks.write).toHaveBeenCalledTimes(1);
        const over = new Blob([bytes(MAX_UPLOAD_BYTES + 1)], { type: "image/png" });
        await expect(createTempFileFromBlob(over)).rejects.toThrow("Image too large (>3.5 MB)");
        expect(mocks.write).toHaveBeenCalledTimes(1);
    });
    it("still refuses a blob that is not an image", async () => {
        await expect(createTempFileFromBlob(new Blob([bytes(4)], { type: "text/plain" }))).rejects.toThrow(
            "Unsupported or invalid image type: text/plain"
        );
        expect(mocks.write).not.toHaveBeenCalled();
    });
});
