// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { imagePasteNames, imagePasteNumbers, normImagePath, samePasteNumbers } from "./imagepasteids";
import { makeRecord, type UploadRecord } from "./uploadsstore";

const A = "C:\\Users\\u\\AppData\\Local\\Temp\\waveterm-attach-1\\waveterm_paste_1_aa.png";
const B = "C:\\Users\\u\\AppData\\Local\\Temp\\waveterm-attach-2\\waveterm_paste_2_bb.png";

const prompt = (promptId: string, ids: number[], text: string) =>
    JSON.stringify({
        type: "user",
        promptId,
        imagePasteIds: ids,
        message: {
            content: [
                { type: "text", text },
                ...ids.map(() => ({ type: "image", source: { type: "base64", data: "AA==" } })),
            ],
        },
    });
const companion = (promptId: string, paths: string[]) =>
    JSON.stringify({
        type: "user",
        promptId,
        isMeta: true,
        turnCompanion: true,
        message: { content: paths.map((p) => ({ type: "text", text: `[Image: source: ${p}]` })) },
    });

describe("imagePasteNumbers", () => {
    it("pairs each pasted file with the number Claude Code gave it, in order", () => {
        const got = imagePasteNumbers([prompt("p1", [3, 4], "[Image #3] and [Image #4]"), companion("p1", [A, B])]);
        expect([...got]).toEqual([
            [normImagePath(A), 3],
            [normImagePath(B), 4],
        ]);
    });

    it("pairs by prompt, whichever record comes first", () => {
        const got = imagePasteNumbers([
            companion("p2", [B]),
            prompt("p1", [1], "x"),
            prompt("p2", [2], "y"),
            companion("p1", [A]),
        ]);
        expect(got.get(normImagePath(A))).toBe(1);
        expect(got.get(normImagePath(B))).toBe(2);
    });

    it("leaves out a prompt whose companion lists a different number of files: the order cannot be trusted", () => {
        expect(imagePasteNumbers([prompt("p1", [1, 2], "x"), companion("p1", [A])]).size).toBe(0);
    });

    it("has nothing for a prompt queued mid-turn, which carries no companion, or for unparsable lines", () => {
        expect(imagePasteNumbers([prompt("p1", [2], "x"), "{not json", ""]).size).toBe(0);
    });

    it("ignores a companion that is not a source list, such as an image's size", () => {
        const size = JSON.stringify({
            type: "user",
            promptId: "p1",
            isMeta: true,
            message: { content: "[Image: original 1300×2400, displayed at 1000×1846.]" },
        });
        expect([...imagePasteNumbers([prompt("p1", [1], "x"), size, companion("p1", [A])])]).toEqual([
            [normImagePath(A), 1],
        ]);
    });

    it("matches a path however its separators and case were written", () => {
        expect(normImagePath("C:\\Temp\\A.PNG")).toBe(normImagePath("c:/temp/a.png"));
    });
});

describe("samePasteNumbers", () => {
    it("is true only for the same paths with the same numbers", () => {
        const m = new Map([["a", 1]]);
        expect(samePasteNumbers(new Map([["a", 1]]), m)).toBe(true);
        expect(samePasteNumbers(undefined, m)).toBe(false);
        expect(samePasteNumbers(new Map([["a", 2]]), m)).toBe(false);
        expect(
            samePasteNumbers(
                new Map([
                    ["a", 1],
                    ["b", 2],
                ]),
                m
            )
        ).toBe(false);
    });
});

describe("imagePasteNames", () => {
    const rec = (path: string, source: UploadRecord["source"], name?: string) =>
        makeRecord({ path, source, now: 1, nonce: path.slice(-6), name, kind: "image" });

    it("names a pasted image by its number, and changes nothing else", () => {
        const list = [
            rec(A, "paste", "Pasted image"),
            rec(B, "paste", "Pasted image"),
            rec("D:\\pics\\x.png", "attach"),
        ];
        const named = imagePasteNames(list, new Map([[normImagePath(A), 2]]));
        expect(named.map((r) => r.name)).toEqual(["Image #2", "Pasted image", "x.png"]);
        expect(named[1]).toBe(list[1]);
    });

    it("returns the same list when nothing changes, so the store is not rewritten", () => {
        const list = [rec(A, "paste", "Image #2")];
        expect(imagePasteNames(list, new Map([[normImagePath(A), 2]]))).toBe(list);
        expect(imagePasteNames(list, new Map())).toBe(list);
    });
});
