// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { COMMIT_ASK_CONTEXT, COMMIT_ASK_REMINDER, commitAskContext, type CommitAskState } from "./commitask-core";

const base: CommitAskState = {
    isActive: true,
    isInteractive: true,
    isCommand: false,
    isPersonTurn: true,
    hasTold: false,
};

describe("commitAskContext", () => {
    it("tells the person's first prompt in full and reminds every one after", () => {
        expect(commitAskContext(base)).toBe(COMMIT_ASK_CONTEXT);
        expect(commitAskContext({ ...base, hasTold: true })).toBe(COMMIT_ASK_REMINDER);
    });

    it("names the block, its separator and the skill", () => {
        for (const want of ["```arc-commit", "`---`", "arc:commit"]) {
            expect(COMMIT_ASK_CONTEXT).toContain(want);
        }
        expect(COMMIT_ASK_REMINDER).toContain("arc-commit");
    });

    it("stays quiet outside arcterm, headless, on a command, or on a turn that is not the person's", () => {
        expect(commitAskContext({ ...base, isActive: false })).toBeNull();
        expect(commitAskContext({ ...base, isInteractive: false })).toBeNull();
        expect(commitAskContext({ ...base, isCommand: true })).toBeNull();
        expect(commitAskContext({ ...base, isPersonTurn: false })).toBeNull();
    });
});
