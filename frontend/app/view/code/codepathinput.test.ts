// frontend/app/view/code/codepathinput.test.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { cleanPathInput, pathErrorMessage, statPathError, validatePathInput } from "./codepathinput";

describe("cleanPathInput", () => {
    it("strips the quotes Explorer's Copy as path adds", () => {
        expect(cleanPathInput('  "C:\\repos\\alpha"  ')).toBe("C:\\repos\\alpha");
    });

    it("trims the space left inside the quotes", () => {
        expect(cleanPathInput('"  C:\\repos\\alpha  "')).toBe("C:\\repos\\alpha");
    });

    it("leaves an unquoted path alone", () => {
        expect(cleanPathInput("C:\\repos\\alpha")).toBe("C:\\repos\\alpha");
    });

    it("keeps a quote that does not have a partner on the other end", () => {
        expect(cleanPathInput('"C:\\repos')).toBe('"C:\\repos');
        expect(cleanPathInput('C:\\repos"')).toBe('C:\\repos"');
    });

    it("does not treat one lone quote as a quoted path", () => {
        expect(cleanPathInput('"')).toBe('"');
    });
});

describe("validatePathInput", () => {
    it("rejects a blank entry", () => {
        expect(validatePathInput("   ")).toBe("empty");
        expect(validatePathInput('""')).toBe("empty");
    });

    it("rejects a path with nothing to resolve it against", () => {
        for (const raw of ["src/app", "alpha", "./alpha", "..\\alpha", "C:repos"]) {
            expect(validatePathInput(raw)).toBe("relative");
        }
    });

    it("accepts absolute paths in either separator style", () => {
        for (const raw of ["C:\\repos\\alpha", "c:/repos/alpha", "/home/u/alpha", "\\\\server\\share", '"D:\\x"']) {
            expect(validatePathInput(raw)).toBeNull();
        }
    });
});

describe("statPathError", () => {
    it("accepts a directory", () => {
        expect(statPathError({ isdir: true })).toBeNull();
    });

    it("reports a missing path, including no answer at all", () => {
        expect(statPathError({ notfound: true })).toBe("notfound");
        expect(statPathError(null)).toBe("notfound");
    });

    it("reports a file, and a stat that does not say it is a directory", () => {
        expect(statPathError({ isdir: false })).toBe("notdir");
        expect(statPathError({})).toBe("notdir");
    });
});

describe("pathErrorMessage", () => {
    it("names the missing directory", () => {
        expect(pathErrorMessage("notfound", "C:\\gone")).toBe("No such directory: C:\\gone");
    });

    it("explains a file and a relative path", () => {
        expect(pathErrorMessage("notdir", "C:\\a.txt")).toBe("That is a file, not a directory");
        expect(pathErrorMessage("relative", "alpha")).toBe("Enter an absolute path");
    });
});
