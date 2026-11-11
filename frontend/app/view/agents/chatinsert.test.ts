import { describe, expect, it, vi } from "vitest";
import {
    appendToChatBox,
    chatBoxText,
    focusChatBox,
    insertAt,
    insertIntoChatBox,
    registerChatBox,
    registerChatInsert,
    replaceChatBox,
    submitIntoChatBox,
} from "./chatinsert";

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

describe("the chat box registry (chatBoxText, submitIntoChatBox, appendToChatBox)", () => {
    const box = (over: Partial<Parameters<typeof registerChatBox>[1]> = {}) => ({
        text: vi.fn(() => "a draft"),
        submit: vi.fn(() => true),
        append: vi.fn(() => true),
        replace: vi.fn(() => true),
        focus: vi.fn(() => true),
        ...over,
    });
    it("reads an empty text and takes nothing when no box is mounted", () => {
        expect(chatBoxText("cb-none")).toBe("");
        expect(submitIntoChatBox("cb-none", "x")).toBe(false);
        expect(appendToChatBox("cb-none", "x")).toBe(false);
        expect(replaceChatBox("cb-none", "x")).toBe(false);
        expect(focusChatBox("cb-none")).toBe(false);
    });
    it("focuses the registered box and says whether it took the focus", () => {
        const b = box();
        const off = registerChatBox("cb-f", b);
        expect(focusChatBox("cb-f")).toBe(true);
        expect(b.focus).toHaveBeenCalledOnce();
        off();
        const offRo = registerChatBox("cb-fr", box({ focus: vi.fn(() => false) }));
        expect(focusChatBox("cb-fr")).toBe(false);
        offRo();
    });
    it("replaces the text through the registered box and says what it answered", () => {
        const b = box();
        const off = registerChatBox("cb-6", b);
        expect(replaceChatBox("cb-6", "/usage ")).toBe(true);
        expect(b.replace).toHaveBeenCalledWith("/usage ");
        expect(b.submit).not.toHaveBeenCalled();
        off();
    });
    it("reads the text of the registered box", () => {
        const b = box();
        const off = registerChatBox("cb-1", b);
        expect(chatBoxText("cb-1")).toBe("a draft");
        off();
    });
    it("submits through the registered box with the text and says what it answered", () => {
        const b = box();
        const off = registerChatBox("cb-2", b);
        expect(submitIntoChatBox("cb-2", "go")).toBe(true);
        expect(b.submit).toHaveBeenCalledWith("go");
        expect(b.append).not.toHaveBeenCalled();
        off();
        const refusing = box({ submit: vi.fn(() => false) });
        const offRefusing = registerChatBox("cb-2r", refusing);
        expect(submitIntoChatBox("cb-2r", "go")).toBe(false);
        offRefusing();
    });
    it("appends through the registered box with the text and says what it answered", () => {
        const b = box();
        const off = registerChatBox("cb-3", b);
        expect(appendToChatBox("cb-3", "more")).toBe(true);
        expect(b.append).toHaveBeenCalledWith("more");
        expect(b.submit).not.toHaveBeenCalled();
        off();
        const refusing = box({ append: vi.fn(() => false) });
        const offRefusing = registerChatBox("cb-3r", refusing);
        expect(appendToChatBox("cb-3r", "more")).toBe(false);
        offRefusing();
    });
    it("keeps agents apart, and leaves the insert registry alone", () => {
        const a = box();
        const b = box();
        const offA = registerChatBox("cb-a", a);
        const offB = registerChatBox("cb-b", b);
        submitIntoChatBox("cb-b", "x");
        expect(a.submit).not.toHaveBeenCalled();
        expect(b.submit).toHaveBeenCalledOnce();
        expect(insertIntoChatBox("cb-a", "x")).toBe(false);
        offA();
        offB();
    });
    it("stops reaching the box once unregistered", () => {
        registerChatBox("cb-4", box())();
        expect(chatBoxText("cb-4")).toBe("");
        expect(submitIntoChatBox("cb-4", "x")).toBe(false);
        expect(appendToChatBox("cb-4", "x")).toBe(false);
    });
    it("does not let a stale unregister remove the newer box of the same agent", () => {
        const oldBox = box();
        const newBox = box({ text: vi.fn(() => "newer") });
        const offOld = registerChatBox("cb-5", oldBox);
        const offNew = registerChatBox("cb-5", newBox);
        offOld();
        expect(chatBoxText("cb-5")).toBe("newer");
        expect(submitIntoChatBox("cb-5", "x")).toBe(true);
        expect(newBox.submit).toHaveBeenCalledOnce();
        expect(oldBox.submit).not.toHaveBeenCalled();
        offNew();
    });
});
