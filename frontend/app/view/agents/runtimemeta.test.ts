// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { runtimeMeta } from "./runtimemeta";

describe("runtimeMeta", () => {
    it("maps known providers case-insensitively", () => {
        expect(runtimeMeta("codex").id).toBe("codex");
        expect(runtimeMeta("Codex").id).toBe("codex");
        expect(runtimeMeta("claude").glyph).toBe("✳");
        expect(runtimeMeta("opencode").id).toBe("opencode");
        expect(runtimeMeta("opencode").label).toBe("OpenCode");
        expect(runtimeMeta("Opencode").id).toBe("opencode");
        expect(runtimeMeta("pi").id).toBe("pi");
        expect(runtimeMeta("PI").label).toBe("Pi");
        expect(runtimeMeta("agy").id).toBe("agy");
        expect(runtimeMeta("Agy").label).toBe("Antigravity");
        expect(runtimeMeta("agy").glyph).toBe("◭");
        expect(runtimeMeta("agy").text).toBe("text-rt-agy");
    });

    it("returns an unknown record for unknown/empty providers instead of claude", () => {
        expect(runtimeMeta(undefined).id).toBe("unknown");
        expect(runtimeMeta("mystery").id).toBe("unknown");
        expect(runtimeMeta("").id).toBe("unknown");
        expect(runtimeMeta("antigravity").id).toBe("unknown"); // old stored records get no alias
    });
});
