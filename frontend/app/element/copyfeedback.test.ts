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

describe("COPY_HOLD_MS", () => {
    it("holds the outcome long enough to read, short of blocking the next copy for seconds", () => {
        expect(COPY_HOLD_MS).toBeGreaterThanOrEqual(1000);
        expect(COPY_HOLD_MS).toBeLessThanOrEqual(2000);
    });
});
