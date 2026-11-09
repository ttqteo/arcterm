import { describe, expect, it, vi } from "vitest";
import { insertAt, insertIntoChatBox, registerChatInsert } from "./chatinsert";

describe("insertAt", () => {
    it("puts the text at the caret and leaves the caret after it", () => {
        expect(insertAt("hello world", 5, 5, "@ab12 ")).toEqual({ text: "hello@ab12  world", caret: 11 });
    });
    it("fills an empty box", () => {
        expect(insertAt("", 0, 0, "@ab12 ")).toEqual({ text: "@ab12 ", caret: 6 });
    });
    it("appends at the end", () => {
        expect(insertAt("see ", 4, 4, "@ab12 ")).toEqual({ text: "see @ab12 ", caret: 10 });
    });
    it("replaces a selection", () => {
        expect(insertAt("fix THIS now", 4, 8, "@ab12 ")).toEqual({ text: "fix @ab12  now", caret: 10 });
    });
    it("reads a backwards selection as the same range", () => {
        expect(insertAt("fix THIS now", 8, 4, "@ab12 ")).toEqual({ text: "fix @ab12  now", caret: 10 });
    });
    it("clamps a caret that is outside the text", () => {
        expect(insertAt("abc", 99, 99, "X")).toEqual({ text: "abcX", caret: 4 });
        expect(insertAt("abc", -3, -3, "X")).toEqual({ text: "Xabc", caret: 1 });
    });
    it("counts the caret in UTF-16 units, as a textarea does", () => {
        expect(insertAt("ơ ư", 1, 1, "@a ")).toEqual({ text: "ơ@a  ư", caret: 4 });
    });
});

describe("insertIntoChatBox", () => {
    it("inserts through the registered box and says it did", () => {
        const fn = vi.fn(() => true);
        const off = registerChatInsert("ci-1", fn);
        expect(insertIntoChatBox("ci-1", "@ab12 ")).toBe(true);
        expect(fn).toHaveBeenCalledWith("@ab12 ");
        off();
    });
    it("says so when the agent has no chat box mounted", () => {
        expect(insertIntoChatBox("ci-none", "x")).toBe(false);
    });
    it("keeps agents apart", () => {
        const a = vi.fn(() => true);
        const b = vi.fn(() => true);
        const offA = registerChatInsert("ci-a", a);
        const offB = registerChatInsert("ci-b", b);
        insertIntoChatBox("ci-b", "x");
        expect(a).not.toHaveBeenCalled();
        expect(b).toHaveBeenCalledOnce();
        offA();
        offB();
    });
    it("reports a box that took nothing", () => {
        const off = registerChatInsert("ci-2", () => false);
        expect(insertIntoChatBox("ci-2", "x")).toBe(false);
        off();
    });
    it("stops reaching the box once unregistered", () => {
        registerChatInsert("ci-3", () => true)();
        expect(insertIntoChatBox("ci-3", "x")).toBe(false);
    });
    it("does not let a stale unregister remove the newer box of the same agent", () => {
        const oldFn = vi.fn(() => true);
        const newFn = vi.fn(() => true);
        const offOld = registerChatInsert("ci-4", oldFn);
        const offNew = registerChatInsert("ci-4", newFn);
        offOld();
        expect(insertIntoChatBox("ci-4", "x")).toBe(true);
        expect(newFn).toHaveBeenCalledOnce();
        expect(oldFn).not.toHaveBeenCalled();
        offNew();
    });
});
