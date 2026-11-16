// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { fenceRanges, splitFenceInfo } from "./chatfences";

describe("fenceRanges", () => {
    it("finds a closed block, its fence lines included", () => {
        expect(fenceRanges(["see", "```bash", "ls", "```", "done"])).toEqual([{ open: 1, close: 3 }]);
    });

    it("runs a block still being typed to the end", () => {
        expect(fenceRanges(["```", "curl x \\", "  -H y"])).toEqual([{ open: 0, close: null }]);
    });

    it("finds several blocks and tilde fences", () => {
        expect(fenceRanges(["```", "a", "```", "text", "~~~", "b", "~~~"])).toEqual([
            { open: 0, close: 2 },
            { open: 4, close: 6 },
        ]);
    });

    it("closes only on a fence of the same kind, at least as long, with nothing after it", () => {
        expect(fenceRanges(["````", "```", "~~~", "```js", "````"])).toEqual([{ open: 0, close: 4 }]);
    });

    it("takes a line with code after the fence as an opener", () => {
        expect(fenceRanges(["```curl https://x \\", "-H y", "```"])).toEqual([{ open: 0, close: 2 }]);
    });

    it("does not take inline code or a fence indented four spaces", () => {
        expect(fenceRanges(["```a``` b", "    ```", "x"])).toEqual([]);
    });
});

describe("splitFenceInfo", () => {
    it("moves code typed on the fence line into the block", () => {
        expect(splitFenceInfo('```curl https://api.x/v1 \\\n  -H "A: b"\n```')).toBe(
            '```\ncurl https://api.x/v1 \\\n  -H "A: b"\n```'
        );
    });

    it("keeps a one-word language", () => {
        const text = "```bash\nls\n```\n```c++\nint x;\n```";
        expect(splitFenceInfo(text)).toBe(text);
    });

    it("keeps the fence's indent and kind", () => {
        expect(splitFenceInfo("  ~~~~ echo hi\nx\n  ~~~~")).toBe("  ~~~~\necho hi\nx\n  ~~~~");
    });

    it("leaves a fence-like line inside a block alone", () => {
        const text = "````\n```js and more\n````";
        expect(splitFenceInfo(text)).toBe(text);
    });

    it("leaves text without fences as it is", () => {
        expect(splitFenceInfo("no code here")).toBe("no code here");
    });
});
