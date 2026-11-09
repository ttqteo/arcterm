import { describe, expect, it } from "vitest";
import { canSendComposer, canStop } from "./agentcomposer";

describe("canSendComposer", () => {
    it("is false when block-less (idle composer with no live terminal — T4)", () => {
        expect(canSendComposer("hello", undefined)).toBe(false);
    });
    it("is false when text is empty or whitespace", () => {
        expect(canSendComposer("", "block:1")).toBe(false);
        expect(canSendComposer("   ", "block:1")).toBe(false);
    });
    it("is true with non-empty text and a live block", () => {
        expect(canSendComposer("hi", "block:1")).toBe(true);
    });
});

describe("canStop", () => {
    it("is true while an awake agent works or asks", () => {
        expect(canStop("working", false)).toBe(true);
        expect(canStop("asking", false)).toBe(true);
    });
    it("is false for an idle agent", () => {
        expect(canStop("idle", false)).toBe(false);
    });
    it("is false for an asleep agent, whatever its state: there is no process to send Esc to", () => {
        expect(canStop("working", true)).toBe(false);
        expect(canStop("asking", true)).toBe(false);
        expect(canStop("idle", true)).toBe(false);
    });
    it("reads the roster's sleeping record as asleep, and its absence as awake", () => {
        expect(canStop("working", { since: 1, freedBytes: 0 })).toBe(false);
        expect(canStop("working", undefined)).toBe(true);
    });
});
