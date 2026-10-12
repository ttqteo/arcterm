// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { bestPassage, findingRef, taskOfHeading } from "./docreviewlinks";

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

    it("reads identifier-like words outside inline code", () => {
        expect(
            findingRef("ChangeSpec and artifacts are FieldPolicy fields of release_items; see `x.y_z`, e.g. /infra")
                .words
        ).toEqual(["ChangeSpec", "FieldPolicy", "release_items", "/infra"]);
    });

    it("reads no word from plain prose", () => {
        expect(findingRef("Bump the version before the build, i.e. first").words).toEqual([]);
    });
});

describe("bestPassage", () => {
    const ref = findingRef("ChangeSpec and artifacts are FieldPolicy fields of release_items");

    it("picks the passage sharing the most identifiers, across languages", () => {
        const texts = [
            "Phạm vi: ChangeSpec, registry phiên bản",
            "ChangeSpec và artifact là trường FieldPolicy của release_items",
            "Ngoài phạm vi: GitHub",
        ];
        expect(bestPassage(texts, ref)).toBe(1);
    });

    it("prefers the list item over the list that holds it", () => {
        const item = "ChangeSpec là trường FieldPolicy";
        expect(bestPassage([`Quyết định: ${item} và nhiều thứ khác`, item], ref)).toBe(1);
    });

    it("is -1 when nothing shares a term", () => {
        expect(bestPassage(["Ngày: 2026-10-12"], ref)).toBe(-1);
        expect(bestPassage(["anything"], findingRef("plain prose only"))).toBe(-1);
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
