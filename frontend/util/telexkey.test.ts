// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { telexBaseKey } from "./telexkey";

describe("telexBaseKey", () => {
    it("reads đ back as the d that made it", () => {
        expect(telexBaseKey("đ")).toBe("d");
        expect(telexBaseKey("Đ")).toBe("D");
    });

    it("reads a vowel shaped by w back as w, and a doubled vowel as the vowel", () => {
        expect(["ư", "ơ", "ă"].map(telexBaseKey)).toEqual(["w", "w", "w"]);
        expect(["â", "ê", "ô"].map(telexBaseKey)).toEqual(["a", "e", "o"]);
    });

    it("reads a toned vowel back as its tone's key, even with a shape", () => {
        expect(["á", "à", "ả", "ã", "ạ"].map(telexBaseKey)).toEqual(["s", "f", "r", "x", "j"]);
        expect(telexBaseKey("ấ")).toBe("s");
        expect(telexBaseKey("Ự")).toBe("J");
    });

    it("is null for anything else", () => {
        for (const ch of ["d", "j", "1", "[", "é".normalize("NFD"), "ß", "ñ", "ç", "Enter"]) {
            expect(telexBaseKey(ch), ch).toBe(null);
        }
    });
});
