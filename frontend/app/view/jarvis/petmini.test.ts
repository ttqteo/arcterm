// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { miniLook, nextUnread, type MiniLookInput } from "./petmini";
import type { PetErrand } from "./petstore";

const errand = (status: PetErrand["status"]): PetErrand => ({
    prompt: "What is arc-dev stuck on?",
    runtime: "claude",
    text: "arc-dev is waiting on a plan review.",
    status,
});
const base: MiniLookInput = { posture: "none", waiting: 0, errand: null, unread: false, chatOpen: false, frame: 0 };

describe("miniLook", () => {
    it("stands bare when there is nothing to say", () => {
        expect(miniLook(base)).toEqual({ pose: "stand", marks: [], chip: null, bob: false, label: "Open Jarvis chat" });
    });
    it("types at the laptop while a reply streams, one frame per tick", () => {
        expect(miniLook({ ...base, errand: errand("streaming") }).pose).toBe("work1");
        expect(miniLook({ ...base, errand: errand("streaming"), frame: 1 }).pose).toBe("work2");
        expect(miniLook({ ...base, errand: errand("streaming") }).label).toBe("Open Jarvis chat — thinking");
    });
    it("speaks with the unread mark when a reply landed while folded", () => {
        expect(miniLook({ ...base, errand: errand("done"), unread: true })).toMatchObject({
            pose: "speak",
            marks: ["unread"],
            label: "Open Jarvis chat — new reply",
        });
    });
    it("stops telling once the chat is open", () => {
        expect(miniLook({ ...base, errand: errand("done"), unread: true, chatOpen: true })).toMatchObject({
            pose: "stand",
            marks: [],
            label: "Collapse Jarvis chat",
        });
    });
    it("wears the review gate's eye and counts what waits", () => {
        expect(miniLook({ ...base, posture: "review-gate", waiting: 2 })).toMatchObject({
            marks: ["gate"],
            chip: 2,
            label: "Open Jarvis chat — 2 waiting on you",
        });
    });
    it("counts a plain question with the chip alone", () => {
        expect(miniLook({ ...base, waiting: 1 })).toMatchObject({ marks: [], chip: 1 });
    });
    it("lets the posture's mark win over the unread mark", () => {
        expect(miniLook({ ...base, posture: "escalation", errand: errand("done"), unread: true })).toMatchObject({
            pose: "speak",
            marks: ["escalation"],
        });
    });
    it("wears no mark while typing, so the notes above its head stay clear", () => {
        expect(miniLook({ ...base, posture: "review-gate", errand: errand("streaming") }).marks).toEqual([]);
    });
    it("bobs up on the second frame", () => {
        expect(miniLook({ ...base, frame: 1 }).bob).toBe(true);
        expect(miniLook(base).bob).toBe(false);
    });
});

describe("nextUnread", () => {
    it("marks a reply that finishes while folded", () => {
        expect(nextUnread(errand("streaming"), errand("done"), false, false)).toBe(true);
    });
    it("marks a failed reply too", () => {
        expect(nextUnread(errand("streaming"), errand("error"), false, false)).toBe(true);
    });
    it("clears when the chat opens", () => {
        expect(nextUnread(errand("done"), errand("done"), true, true)).toBe(false);
    });
    it("clears when the errand goes away", () => {
        expect(nextUnread(errand("done"), null, false, true)).toBe(false);
    });
    it("keeps what it had otherwise", () => {
        expect(nextUnread(errand("done"), errand("done"), false, true)).toBe(true);
        expect(nextUnread(null, errand("streaming"), false, false)).toBe(false);
    });
});
