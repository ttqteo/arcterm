// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { findingRef, taskOfHeading } from "./docreviewlinks";

describe("findingRef", () => {
    it("reads one task", () => {
        expect(findingRef("Task 6 also takes comparestore.ts").tasks).toEqual([6]);
    });

    it("reads every task, in order, once", () => {
        expect(findingRef("Task 7 changes Shift+H; Task 8 adds Shift+C. Task 7 again").tasks).toEqual([7, 8]);
    });

    it("reads a list after Tasks", () => {
        expect(findingRef("Tasks 3, 4 and Task 9 share it").tasks).toEqual([3, 4, 9]);
        expect(findingRef("tasks 2 & 5").tasks).toEqual([2, 5]);
    });

    it("does not read a step number as a task", () => {
        expect(findingRef("diff-log-tab steps 3–4 move").tasks).toEqual([]);
    });

    it("reads inline-code terms, skipping short ones", () => {
        expect(findingRef("Pull reports `rev-list old..HEAD` after `a` and `rev-list old..HEAD`").terms).toEqual([
            "rev-list old..HEAD",
        ]);
    });
});

describe("taskOfHeading", () => {
    it("reads a task heading", () => {
        expect(taskOfHeading("Task 3: Sync bar")).toBe(3);
        expect(taskOfHeading("  task 12 — pull")).toBe(12);
    });

    it("ignores other headings", () => {
        expect(taskOfHeading("Tasks overview")).toBeNull();
        expect(taskOfHeading("File map")).toBeNull();
        expect(taskOfHeading("Task 10x")).toBeNull();
    });
});
