// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from "vitest";
import { COPY_HOLD_MS, writeClipboard } from "./copyfeedback";

function stubClipboard(clipboard: unknown) {
    vi.stubGlobal("navigator", { clipboard });
}

describe("writeClipboard", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it("writes the text and reports copied", async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        stubClipboard({ writeText });
        expect(await writeClipboard("abc")).toBe("copied");
        expect(writeText).toHaveBeenCalledWith("abc");
    });

    it("reports failed, and says why, when the write rejects", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        stubClipboard({ writeText: vi.fn().mockRejectedValue(new Error("denied")) });
        expect(await writeClipboard("abc")).toBe("failed");
        expect(warn).toHaveBeenCalled();
    });

    it("reports failed when there is no clipboard API rather than claiming a copy", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        stubClipboard(undefined);
        expect(await writeClipboard("abc")).toBe("failed");
        expect(warn).toHaveBeenCalled();
    });
});

describe("writeClipboard, rich", () => {
    const rich = { text: "a\tb", html: "<table><tr><td>a</td><td>b</td></tr></table>" };

    class FakeClipboardItem {
        constructor(readonly items: Record<string, Blob>) {}
    }

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it("writes the HTML and the text as one clipboard item", async () => {
        const write = vi.fn().mockResolvedValue(undefined);
        const writeText = vi.fn();
        stubClipboard({ write, writeText });
        vi.stubGlobal("ClipboardItem", FakeClipboardItem);
        expect(await writeClipboard(rich)).toBe("copied");
        const item: FakeClipboardItem = write.mock.calls[0][0][0];
        expect(await item.items["text/html"].text()).toBe(rich.html);
        expect(await item.items["text/plain"].text()).toBe(rich.text);
        expect(writeText).not.toHaveBeenCalled();
    });

    it("copies the text alone where there is no ClipboardItem", async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        stubClipboard({ write: vi.fn(), writeText });
        vi.stubGlobal("ClipboardItem", undefined);
        expect(await writeClipboard(rich)).toBe("copied");
        expect(writeText).toHaveBeenCalledWith(rich.text);
    });

    it("copies the text alone when the rich write is refused", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {});
        const writeText = vi.fn().mockResolvedValue(undefined);
        stubClipboard({ write: vi.fn().mockRejectedValue(new Error("NotAllowed")), writeText });
        vi.stubGlobal("ClipboardItem", FakeClipboardItem);
        expect(await writeClipboard(rich)).toBe("copied");
        expect(writeText).toHaveBeenCalledWith(rich.text);
    });

    it("reports failed when the text fallback is refused too", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {});
        stubClipboard({
            write: vi.fn().mockRejectedValue(new Error("NotAllowed")),
            writeText: vi.fn().mockRejectedValue(new Error("NotAllowed")),
        });
        vi.stubGlobal("ClipboardItem", FakeClipboardItem);
        expect(await writeClipboard(rich)).toBe("failed");
    });
});

describe("COPY_HOLD_MS", () => {
    it("holds the outcome long enough to read, short of blocking the next copy for seconds", () => {
        expect(COPY_HOLD_MS).toBeGreaterThanOrEqual(1000);
        expect(COPY_HOLD_MS).toBeLessThanOrEqual(2000);
    });
});
