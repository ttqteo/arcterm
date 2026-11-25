// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { fenceBangLines } from "./bashlines";

describe("fenceBangLines", () => {
    it("fences a bare `! cmd` line as written, its `**` kept", () => {
        const cmd = `! python -c "t.replace('**CHỜ KÝ.**','**ĐÃ KÝ.**')"`;
        expect(fenceBangLines(`Dòng ký:\n\n${cmd}\n\nRồi tôi chạy.`)).toBe(
            `Dòng ký:\n\n\`\`\`\n${cmd}\n\`\`\`\n\nRồi tôi chạy.`
        );
    });

    it("fences a `! cmd` line straight under a sentence, with no blank line between", () => {
        expect(fenceBangLines("Type this:\n! task install")).toBe("Type this:\n```\n! task install\n```");
    });

    it("puts consecutive `! ` lines in one block", () => {
        expect(fenceBangLines("! npm test\n! task check:ts\nthen")).toBe("```\n! npm test\n! task check:ts\n```\nthen");
    });

    it("leaves a fenced block alone", () => {
        const text = "```\n! task install\n```\n~~~sh\n! ls\n~~~";
        expect(fenceBangLines(text)).toBe(text);
    });

    it("leaves a `!` with no space, an indented one, one in a list, a quote or a code span", () => {
        const text = "!important\n  ! ls\n- ! ls\n> ! ls\n`! task install`\nWow! nice";
        expect(fenceBangLines(text)).toBe(text);
    });

    it("leaves `! ` with nothing after it", () => {
        expect(fenceBangLines("! \n!  ")).toBe("! \n!  ");
    });

    it("picks a fence longer than any backtick run in the command", () => {
        expect(fenceBangLines("! echo ```hi```")).toBe("````\n! echo ```hi```\n````");
    });
});
