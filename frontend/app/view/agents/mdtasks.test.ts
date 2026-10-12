// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { toggleTaskLine } from "./mdtasks";

describe("toggleTaskLine", () => {
    it("ticks an open box and clears a ticked one", () => {
        expect(toggleTaskLine("a\n- [ ] one\n", 2)).toBe("a\n- [x] one\n");
        expect(toggleTaskLine("- [x] one", 1)).toBe("- [ ] one");
        expect(toggleTaskLine("- [X] one", 1)).toBe("- [ ] one");
    });

    it("keeps CRLF line endings and the rest of the file", () => {
        expect(toggleTaskLine("x\r\n  * [ ] two [ ] here\r\ny\r\n", 2)).toBe("x\r\n  * [x] two [ ] here\r\ny\r\n");
    });

    it("handles ordered and quoted items", () => {
        expect(toggleTaskLine("1. [ ] a", 1)).toBe("1. [x] a");
        expect(toggleTaskLine("> - [ ] a", 1)).toBe("> - [x] a");
    });

    it("refuses a line with no box, or out of range", () => {
        expect(toggleTaskLine("- plain [ ] item", 1)).toBeNull();
        expect(toggleTaskLine("[ ] not a list", 1)).toBeNull();
        expect(toggleTaskLine("- [ ] a", 0)).toBeNull();
        expect(toggleTaskLine("- [ ] a", 2)).toBeNull();
    });

    it("refuses when the line changed since the view showed it", () => {
        expect(toggleTaskLine("- [ ] new\r\n", 1, "- [ ] old")).toBeNull();
        expect(toggleTaskLine("- [ ] same\r\n", 1, "- [ ] same")).toBe("- [x] same\r\n");
    });
});
