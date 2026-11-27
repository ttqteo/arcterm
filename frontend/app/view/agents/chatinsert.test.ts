import { describe, expect, it, vi } from "vitest";
import {
    appendToChatBox,
    cancelQueuedChat,
    chatBoxText,
    focusChatBox,
    hasChatBox,
    insertAt,
    insertIntoChatBox,
    interruptChat,
    quoteWhenReady,
    registerChatBox,
    registerChatInsert,
    replaceChatBox,
    submitIntoChatBox,
    writeChatBox,
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
        write: vi.fn(() => true),
        focus: vi.fn(() => true),
        interrupt: vi.fn(() => true),
        cancelQueued: vi.fn(() => true),
        ...over,
    });
    it("reads an empty text and takes nothing when no box is mounted", () => {
        expect(chatBoxText("cb-none")).toBe("");
        expect(submitIntoChatBox("cb-none", "x")).toBe(false);
        expect(appendToChatBox("cb-none", "x")).toBe(false);
        expect(replaceChatBox("cb-none", "x")).toBe(false);
        expect(focusChatBox("cb-none")).toBe(false);
        expect(cancelQueuedChat("cb-none")).toBe(false);
    });
    it("cancels the queued messages through the registered box", () => {
        const b = box();
        const off = registerChatBox("cb-q", b);
        expect(cancelQueuedChat("cb-q")).toBe(true);
        expect(b.cancelQueued).toHaveBeenCalledOnce();
        off();
        expect(cancelQueuedChat("cb-q")).toBe(false);
    });
    it("interrupts through the registered box, and knows which agents have one", () => {
        expect(hasChatBox("cb-i")).toBe(false);
        expect(interruptChat("cb-i")).toBe(false);
        const b = box();
        const off = registerChatBox("cb-i", b);
        expect(hasChatBox("cb-i")).toBe(true);
        expect(interruptChat("cb-i")).toBe(true);
        expect(b.interrupt).toHaveBeenCalledOnce();
        off();
        expect(hasChatBox("cb-i")).toBe(false);
        const offIdle = registerChatBox("cb-ii", box({ interrupt: vi.fn(() => false) }));
        expect(interruptChat("cb-ii")).toBe(false);
        offIdle();
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
    it("writes the text through the registered box without the focus, and says what it answered", () => {
        const b = box();
        const off = registerChatBox("cb-7", b);
        expect(writeChatBox("cb-7", "> quoted\n\n")).toBe(true);
        expect(b.write).toHaveBeenCalledWith("> quoted\n\n");
        expect(b.replace).not.toHaveBeenCalled();
        expect(b.focus).not.toHaveBeenCalled();
        off();
        expect(writeChatBox("cb-7", "x")).toBe(false);
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

describe("quoteWhenReady", () => {
    const box = (over: Partial<Parameters<typeof registerChatBox>[1]> = {}) => ({
        text: vi.fn(() => "a draft"),
        submit: vi.fn(() => true),
        append: vi.fn(() => true),
        replace: vi.fn(() => true),
        write: vi.fn(() => true),
        focus: vi.fn(() => true),
        interrupt: vi.fn(() => true),
        cancelQueued: vi.fn(() => true),
        ...over,
    });
    const quoting = (text: string) => vi.fn((draft: string) => `${draft}|${text}`);

    it("puts the quote into a mounted box at once, built from the box's own text", () => {
        const b = box();
        const off = registerChatBox("qw-1", b);
        const quote = quoting("q");
        expect(quoteWhenReady("qw-1", quote)).toBe(true);
        expect(quote).toHaveBeenCalledWith("a draft");
        expect(b.replace).toHaveBeenCalledWith("a draft|q");
        off();
    });
    it("holds the quote for an agent with no box yet and applies it when the box registers", () => {
        const quote = quoting("held");
        expect(quoteWhenReady("qw-2", quote)).toBe(false);
        expect(quote).not.toHaveBeenCalled();
        const b = box();
        const off = registerChatBox("qw-2", b);
        expect(quote).toHaveBeenCalledOnce();
        expect(b.replace).toHaveBeenCalledWith("a draft|held");
        off();
    });
    it("applies a held quote once: a second registration of the same agent leaves its box alone", () => {
        quoteWhenReady("qw-3", quoting("once"));
        registerChatBox("qw-3", box())();
        const again = box();
        const off = registerChatBox("qw-3", again);
        expect(again.replace).not.toHaveBeenCalled();
        off();
    });
    it("holds one quote per agent: a newer one replaces the held one", () => {
        const older = quoting("older");
        const newer = quoting("newer");
        quoteWhenReady("qw-4", older);
        quoteWhenReady("qw-4", newer);
        const b = box();
        const off = registerChatBox("qw-4", b);
        expect(older).not.toHaveBeenCalled();
        expect(b.replace).toHaveBeenCalledOnce();
        expect(b.replace).toHaveBeenCalledWith("a draft|newer");
        off();
    });
    it("keeps agents apart: another agent's box does not take a held quote", () => {
        const quote = quoting("mine");
        quoteWhenReady("qw-5", quote);
        const other = box();
        const off = registerChatBox("qw-5-other", other);
        expect(other.replace).not.toHaveBeenCalled();
        expect(quote).not.toHaveBeenCalled();
        off();
        registerChatBox("qw-5", box())();
    });
    it("takes a quote that says nothing to add as nothing: the box is left alone and nothing is held", () => {
        const b = box();
        const off = registerChatBox("qw-6", b);
        expect(quoteWhenReady("qw-6", () => null)).toBe(false);
        expect(b.replace).not.toHaveBeenCalled();
        off();
        const none = vi.fn(() => null);
        quoteWhenReady("qw-6b", none);
        const late = box();
        const offLate = registerChatBox("qw-6b", late);
        expect(late.replace).not.toHaveBeenCalled();
        offLate();
    });
    it("says so when the mounted box refuses the text (a wake in flight)", () => {
        const b = box({ replace: vi.fn(() => false) });
        const off = registerChatBox("qw-7", b);
        expect(quoteWhenReady("qw-7", quoting("x"))).toBe(false);
        off();
    });
});
