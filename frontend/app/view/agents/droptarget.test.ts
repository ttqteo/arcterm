// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { dropTargetFor } from "./droptarget";
import { formatDroppedPaths } from "./pathdrop";

describe("dropTargetFor", () => {
    it("makes a block with an agent row an agent, with that row's resolved cwd", () => {
        const agents = [
            { blockId: "b1", cwd: "D:\\proj\\a" },
            { blockId: "b2", cwd: "D:\\proj\\b" },
        ];
        expect(dropTargetFor("b2", agents, "D:\\elsewhere")).toEqual({ agent: true, cwd: "D:\\proj\\b" });
    });

    it("leaves an agent with no cwd with none, whatever the block's meta says", () => {
        expect(dropTargetFor("b1", [{ blockId: "b1" }], "D:\\proj")).toEqual({ agent: true, cwd: null });
        expect(dropTargetFor("b1", [{ blockId: "b1", cwd: null }], null)).toEqual({ agent: true, cwd: null });
        expect(dropTargetFor("b1", [{ blockId: "b1", cwd: "" }], null)).toEqual({ agent: true, cwd: null });
    });

    it("makes a block no agent row names a plain terminal with the block's cmd:cwd", () => {
        const agents = [{ blockId: "b1", cwd: "D:\\proj\\a" }, { cwd: "D:\\proj\\nobody" }];
        expect(dropTargetFor("b9", agents, "D:\\proj\\shell")).toEqual({ agent: false, cwd: "D:\\proj\\shell" });
        expect(dropTargetFor("b9", [], "/home/u/work")).toEqual({ agent: false, cwd: "/home/u/work" });
    });

    it("leaves a plain terminal with no cmd:cwd with none", () => {
        expect(dropTargetFor("b9", [{ blockId: "b1", cwd: "D:\\proj" }], null)).toEqual({ agent: false, cwd: null });
        expect(dropTargetFor("b9", [], "")).toEqual({ agent: false, cwd: null });
    });

    it("keeps a '~' cwd as stored, so a plain terminal there is typed absolute paths", () => {
        const target = dropTargetFor("b9", [], "~");
        expect(target).toEqual({ agent: false, cwd: "~" });
        expect(formatDroppedPaths(["/home/u/work/src/a.ts", "/home/u/work/src/"], target)).toBe(
            "/home/u/work/src/a.ts /home/u/work/src/ "
        );
    });

    it("ends in the text the target types", () => {
        const agents = [{ blockId: "b1", cwd: "D:\\proj" }];
        const paths = ["D:\\proj\\src\\app\\", "D:\\proj\\docs\\my notes.md"];
        expect(formatDroppedPaths(paths, dropTargetFor("b1", agents, null))).toBe('@src/app/ @"docs/my notes.md" ');
        expect(formatDroppedPaths(paths, dropTargetFor("b2", agents, "D:\\proj"))).toBe('src/app/ "docs/my notes.md" ');
    });
});
