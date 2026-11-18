// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { shellLine } from "./shellhighlight";

// the line as `text:class` pairs, whitespace left out, for short expectations
const pairs = (line: string) =>
    shellLine(line)
        .filter((t) => t.t.trim() !== "")
        .map((t) => `${t.t}:${t.cls.replace("text-syntax-", "")}`);

describe("shellLine", () => {
    it("draws the command apart from its arguments", () => {
        expect(pairs("task install")).toEqual(["task:keyword", "install:string"]);
    });

    it("gives every character back, the spaces included", () => {
        const line = "git  log --oneline -3 | head";
        expect(
            shellLine(line)
                .map((t) => t.t)
                .join("")
        ).toBe(line);
    });

    it("draws flags as flags", () => {
        expect(pairs("ls -la --color=auto")).toEqual(["ls:keyword", "-la:punct", "--color=auto:punct"]);
    });

    it("starts a new command after a pipe, &&, || or ;", () => {
        expect(pairs("a x | b && c || d; e")).toEqual([
            "a:keyword",
            "x:string",
            "|:punct",
            "b:keyword",
            "&&:punct",
            "c:keyword",
            "||:punct",
            "d:keyword",
            ";:punct",
            "e:keyword",
        ]);
    });

    it("keeps a quoted argument whole, spaces and all", () => {
        expect(pairs(`git commit -m "fix: a b"`)).toEqual([
            "git:keyword",
            "commit:string",
            "-m:punct",
            `"fix: a b":string`,
        ]);
    });

    it("draws variables, and an assignment before the command", () => {
        expect(pairs("FOO=1 echo $HOME ${X}")).toEqual(["FOO=1:number", "echo:keyword", "$HOME:number", "${X}:number"]);
    });

    it("draws a comment to the end of the line, but not a # inside a word", () => {
        expect(pairs("echo a#b # note here")).toEqual(["echo:keyword", "a#b:string", "# note here:comment"]);
    });

    it("draws an empty line as one space, so the line keeps its height", () => {
        expect(shellLine("")).toEqual([{ t: " ", cls: "text-syntax-ident" }]);
    });
});
