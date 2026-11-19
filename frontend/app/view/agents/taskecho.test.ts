// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { ECHO_BLOCK_MAX, taskEchoes } from "./taskecho";

describe("taskEchoes", () => {
    it("takes a multi-line command up to the blank line Task prints after it", () => {
        const lines = [
            'task: [install:windows] installer="D:/x/setup.exe"',
            'if [ -n "$WAVETERM_BLOCKID" ]; then',
            '    "$wsh" detach -- "$installer"',
            "fi",
            "",
            "started pid 16164",
        ];
        expect(taskEchoes(lines)).toEqual([{ start: 0, end: 4, prefix: "task: [install:windows] " }]);
    });

    it("takes a one-line command alone when the next echo follows it", () => {
        const lines = ["task: [check:ts] node tsc.js --noEmit", "task: [check:mods] node scripts/check-mods.mjs", "ok"];
        expect(taskEchoes(lines)).toEqual([
            { start: 0, end: 1, prefix: "task: [check:ts] " },
            { start: 1, end: 2, prefix: "task: [check:mods] " },
        ]);
    });

    it("takes the line alone when no blank line ends it in time", () => {
        const lines = [
            "task: [test] go test ./...",
            ...Array.from({ length: ECHO_BLOCK_MAX + 5 }, (_, i) => `ok ${i}`),
        ];
        expect(taskEchoes(lines)).toEqual([{ start: 0, end: 1, prefix: "task: [test] " }]);
    });

    it("finds nothing in output Task did not echo", () => {
        expect(taskEchoes(['task: Task "build" is up to date', "hello"])).toEqual([]);
    });
});
