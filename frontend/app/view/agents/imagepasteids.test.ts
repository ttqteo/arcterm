// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    dropUnsentPastes,
    hasRecentPaste,
    imagePasteNames,
    imagePasteNumbers,
    nameScreenPaste,
    newScreenNumber,
    normImagePath,
    samePasteNumbers,
    screenImageNumbers,
    sentImagePrompts,
    takenPasteNumbers,
} from "./imagepasteids";
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

describe("hasRecentPaste", () => {
    const rec = (path: string, source: UploadRecord["source"], name?: string) =>
        makeRecord({ path, source, now: 1, nonce: path.slice(-6), name, kind: "image" });

    it("is true while a paste made since `since` is listed, numbered or not", () => {
        expect(hasRecentPaste([rec(A, "paste", "Pasted image")], 0)).toBe(true);
        expect(hasRecentPaste([rec(A, "paste", "Image #3")], 0)).toBe(true);
        expect(hasRecentPaste([rec("D:\\pics\\x.png", "attach")], 0)).toBe(false);
        expect(hasRecentPaste([rec(A, "paste", "Image #3")], 2)).toBe(false);
    });
});

describe("dropping a paste taken back out of the prompt", () => {
    const T = Date.parse("2026-10-07T10:00:00.000Z");
    const sent = (promptId: string, ids: number[], at: number) =>
        JSON.stringify({ ...JSON.parse(prompt(promptId, ids, "x")), timestamp: new Date(at).toISOString() });
    const rec = (path: string, name: string, ts: number) =>
        makeRecord({ path, source: "paste", now: ts, nonce: path.slice(-6), name, kind: "image" });

    it("drops a paste a later prompt went out without, and keeps the one it carried", () => {
        // pasted twice (#1, #2), #1 deleted, sent with #2 only
        const list = [rec(B, "Image #2", T - 2000), rec(A, "Image #1", T - 3000)];
        const prompts = sentImagePrompts([sent("p1", [2], T), companion("p1", [B])]);
        expect(dropUnsentPastes(list, prompts).map((r) => r.name)).toEqual(["Image #2"]);
    });

    it("keeps a paste made after the prompt, or one the prompt names by file", () => {
        const list = [rec(A, "Image #1", T + 1000)];
        expect(dropUnsentPastes(list, sentImagePrompts([sent("p1", [2], T)]))).toBe(list);
        const named = [rec(A, "Image #1", T - 1000)];
        expect(dropUnsentPastes(named, sentImagePrompts([sent("p1", [3], T), companion("p1", [A])]))).toBe(named);
    });

    it("says nothing without a prompt that carried images, or about a paste with no number yet", () => {
        const list = [rec(A, "Pasted image", T - 1000), rec(B, "Image #1", T - 1000)];
        expect(dropUnsentPastes(list, sentImagePrompts([sent("p1", [], T)]))).toBe(list);
        expect(dropUnsentPastes(list, sentImagePrompts([sent("p1", [2], T)])).map((r) => r.name)).toEqual([
            "Pasted image",
        ]);
    });
});

describe("naming a paste off the screen", () => {
    const C = "C:\\Users\\u\\AppData\\Local\\Temp\\waveterm-attach-3\\waveterm_paste_3_cc.png";
    const rec = (path: string, name: string, ts = 1) =>
        makeRecord({ path, source: "paste", now: ts, nonce: path.slice(-6), name, kind: "image" });

    it("reads every [Image #N] the lines show", () => {
        expect([...screenImageNumbers(["> [Image #1] old prompt", "> [Image #2] and [Image #3] new", "x"])]).toEqual([
            1, 2, 3,
        ]);
    });

    it("takes the lowest number that is new and not held by another paste", () => {
        const s = (...n: number[]) => new Set(n);
        expect(newScreenNumber(s(1), s(1, 2), s())).toBe(2);
        // two pastes on screen by the time the first looks: it takes the lower
        expect(newScreenNumber(s(), s(1, 2), s())).toBe(1);
        // the second, whose screen-before missed the first's number, skips the one the first holds
        expect(newScreenNumber(s(), s(1, 2), s(1))).toBe(2);
        expect(newScreenNumber(s(1), s(1), s())).toBeUndefined();
    });

    it("counts only other recent pastes' numbers as taken", () => {
        const list = [rec(A, "Image #4", 100), rec(B, "Image #1", 1), rec(C, "Pasted image", 100)];
        expect([...takenPasteNumbers(list, C, 50)]).toEqual([4]);
        expect([...takenPasteNumbers(list, A, 50)]).toEqual([]);
    });

    it("names the paste unless something already numbered it", () => {
        const list = [rec(A, "Pasted image"), rec(B, "Image #1")];
        expect(nameScreenPaste(list, A, 2).map((r) => r.name)).toEqual(["Image #2", "Image #1"]);
        expect(nameScreenPaste(list, B, 5)).toBe(list);
    });
});
