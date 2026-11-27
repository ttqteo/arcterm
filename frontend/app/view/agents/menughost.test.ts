// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { menuGhost } from "./menughost";

describe("menuGhost", () => {
    it("is the rest of the first name the typed word starts", () => {
        expect(menuGhost("co", ["context"])).toBe("ntext");
        expect(menuGhost("chated", ["frontend/app/view/agents/chateditor.tsx", "chateditor.tsx"])).toBe("itor.tsx");
        expect(menuGhost("frontend/app/v", ["frontend/app/view/x.ts", "x.ts"])).toBe("iew/x.ts");
    });

    it("ignores case and keeps the name's own letters", () => {
        expect(menuGhost("CO", ["context"])).toBe("ntext");
        expect(menuGhost("prac", ["Practicing English"])).toBe("ticing English");
    });

    it("is empty when no name starts with the word, the word is the whole name, or nothing is typed", () => {
        expect(menuGhost("ag", ["Practicing English"])).toBe("");
        expect(menuGhost("context", ["context"])).toBe("");
        expect(menuGhost("", ["context"])).toBe("");
        expect(menuGhost("co", [])).toBe("");
    });
});
