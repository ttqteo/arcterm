// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { pickBaseline } from "./docbaseline";

describe("pickBaseline", () => {
    it("diffs against what the previous review showed, with when it was shown", () => {
        expect(pickBaseline({ shown: { text: "round one", at: 1700 }, atSession: "session", atHead: "head" })).toEqual({
            text: "round one",
            from: "previous",
            reviewedAt: 1700,
        });
    });

    it("takes an empty previous review over the session and HEAD", () => {
        expect(pickBaseline({ shown: { text: "", at: 5 }, atSession: "session", atHead: "head" })).toEqual({
            text: "",
            from: "previous",
            reviewedAt: 5,
        });
    });

    it("falls to the file at the session's start ref", () => {
        expect(pickBaseline({ atSession: "session", atHead: "head" })).toEqual({ text: "session", from: "session" });
        expect(pickBaseline({ atSession: "", atHead: "head" })).toEqual({ text: "", from: "session" });
    });

    it("falls to HEAD when there is no session read", () => {
        expect(pickBaseline({ atSession: null, atHead: "head" })).toEqual({ text: "head", from: "head" });
        expect(pickBaseline({ atHead: "head" })).toEqual({ text: "head", from: "head" });
    });

    it("treats a file in neither as new: everything is an insertion", () => {
        expect(pickBaseline({ atSession: null, atHead: null })).toEqual({ text: "", from: "new" });
        expect(pickBaseline({})).toEqual({ text: "", from: "new" });
    });
});
