// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { guardDollars } from "./mathdollars";

describe("guardDollars", () => {
    it("keeps inline math", () => {
        expect(guardDollars("rate $\\hat p_h = c_h / n_h$ per stratum")).toBe(
            "rate $\\hat p_h = c_h / n_h$ per stratum"
        );
        expect(guardDollars("$2^n$ and $x$")).toBe("$2^n$ and $x$");
    });

    it("escapes prices and shell variables", () => {
        expect(guardDollars("costs $5 and $10")).toBe("costs \\$5 and \\$10");
        expect(guardDollars("set $HOME first")).toBe("set \\$HOME first");
        expect(guardDollars("a $ b $ c")).toBe("a \\$ b \\$ c");
        expect(guardDollars("between $x$5")).toBe("between \\$x\\$5");
    });

    it("leaves code spans and fenced code alone", () => {
        expect(guardDollars("run `echo $HOME` now")).toBe("run `echo $HOME` now");
        expect(guardDollars("``a ` $b``")).toBe("``a ` $b``");
        const fenced = "```sh\necho $PATH\n```\nthen $5";
        expect(guardDollars(fenced)).toBe("```sh\necho $PATH\n```\nthen \\$5");
    });

    it("keeps display blocks and splits a one-line display", () => {
        const block = "$$\nN = \\sum_h N_h (1 - \\hat p_h)\n$$";
        expect(guardDollars(block)).toBe(block);
        expect(guardDollars("$$\\hat p = \\sum_h w_h \\hat p_h$$")).toBe("$$\n\\hat p = \\sum_h w_h \\hat p_h\n$$");
        expect(guardDollars("  $$x$$ ")).toBe("  $$\n  x\n  $$");
    });

    it("keeps inline $$…$$ and escapes an unclosed one", () => {
        expect(guardDollars("so $$x^2$$ holds")).toBe("so $$x^2$$ holds");
        expect(guardDollars("so $$ alone")).toBe("so \\$\\$ alone");
    });

    it("keeps an escaped dollar", () => {
        expect(guardDollars("pay \\$5 for $x$")).toBe("pay \\$5 for $x$");
    });

    it("returns text with no dollar unchanged", () => {
        const t = "plain *text*";
        expect(guardDollars(t)).toBe(t);
    });
});
