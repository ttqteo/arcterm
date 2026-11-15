// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { buildCommit, type GitRunner } from "./buildcommit";

function fakeGit(head: string | null, status: string | null): GitRunner {
    return (args) => (args[0] === "rev-parse" ? head : status);
}

describe("buildCommit", () => {
    it("takes the stamp the release build passes, without asking git", () => {
        const git: GitRunner = () => {
            throw new Error("git asked");
        };
        expect(buildCommit({ ARC_BUILD_COMMIT: "e999f3db4" }, git)).toBe("e999f3db4");
        expect(buildCommit({ ARC_BUILD_COMMIT: " e999f3db4-dirty\n" }, git)).toBe("e999f3db4-dirty");
    });

    it("asks git when nothing is passed", () => {
        expect(buildCommit({}, fakeGit("e999f3db4\n", ""))).toBe("e999f3db4");
    });

    it("marks a tree with uncommitted edits dirty", () => {
        expect(buildCommit({ ARC_BUILD_COMMIT: "" }, fakeGit("e999f3db4\n", " M package.json\n"))).toBe(
            "e999f3db4-dirty"
        );
    });

    it("is empty outside a git checkout", () => {
        expect(buildCommit({}, fakeGit(null, null))).toBe("");
    });

    it("reads this checkout", () => {
        expect(buildCommit({})).toMatch(/^[0-9a-f]{7,}(-dirty)?$/);
    });
});
