// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { recordPeekFacts } from "./peekrecordmodel";

const summary = (status: string): SpaceSummary => ({
    id: "d1",
    objective: "Ship the vault sync",
    ticket: "",
    status,
    updated: 1,
});

describe("recordPeekFacts", () => {
    it("is gone once the list no longer has the record", () => {
        expect(recordPeekFacts(undefined)).toEqual({ gone: true });
    });

    it("is present while the list has the record, whatever its status", () => {
        expect(recordPeekFacts(summary("active"))).toEqual({ gone: false });
        expect(recordPeekFacts(summary("archived"))).toEqual({ gone: false });
    });
});
