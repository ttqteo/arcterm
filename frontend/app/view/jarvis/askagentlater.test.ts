import { describe, expect, it, vi } from "vitest";
import { askAgent, askTarget, ENDED_MESSAGE, type AskDeps, type AskItem } from "./askagentlater";

const item = (over: Partial<AskItem> = {}): AskItem => ({
    label: "Push DEV",
    note: "",
    ...over,
});

const transcript = (stem: string) => `C:\\Users\\x\\.claude\\projects\\p\\${stem}.jsonl`;

describe("askTarget", () => {
    it("finds the live agent whose conversation is the note's, before looking at the tab", () => {
        const roster = [
            { id: "tab-session", transcriptPath: transcript("other-conv") },
            { id: "tab-resumed", transcriptPath: transcript("conv-1") },
        ];
        expect(askTarget(item({ session: "agent:tab-session", conversation: "conv-1" }), roster)).toEqual({
            kind: "live",
            agentId: "tab-resumed",
        });
    });

    it("reads the conversation off a transcript path the way Chat does, forward or back slashes", () => {
        const roster = [{ id: "t", transcriptPath: "/home/x/.claude/projects/p/conv-2.jsonl" }];
        expect(askTarget(item({ conversation: "conv-2" }), roster)).toEqual({ kind: "live", agentId: "t" });
        expect(
            askTarget(item({ conversation: "conv-2" }), [{ id: "t", transcriptPath: transcript("conv-2") }])
        ).toEqual({
            kind: "live",
            agentId: "t",
        });
    });

    it("falls back to the note's tab when no live agent holds the conversation", () => {
        const roster = [{ id: "tab-1", transcriptPath: transcript("something-else") }];
        expect(askTarget(item({ session: "agent:tab-1", conversation: "conv-1" }), roster)).toEqual({
            kind: "live",
            agentId: "tab-1",
        });
    });

    it("uses the tab for a note written before the conversation id was kept", () => {
        expect(askTarget(item({ session: "agent:tab-1" }), [{ id: "tab-1" }])).toEqual({
            kind: "live",
            agentId: "tab-1",
        });
    });

    it("resumes by the conversation when neither is live", () => {
        const roster = [{ id: "tab-9", transcriptPath: transcript("unrelated") }];
        expect(askTarget(item({ session: "agent:tab-1", conversation: "conv-1" }), roster)).toEqual({
            kind: "resume",
            conversation: "conv-1",
        });
        expect(askTarget(item({ conversation: "conv-1" }), [])).toEqual({ kind: "resume", conversation: "conv-1" });
    });

    it("is ended when the tab is gone and no conversation was kept", () => {
        expect(askTarget(item({ session: "agent:tab-1" }), [{ id: "tab-2" }])).toEqual({ kind: "ended" });
    });

    it("is ended for an item that names no agent at all", () => {
        expect(askTarget(item(), [{ id: "tab-1" }])).toEqual({ kind: "ended" });
    });

    it("does not read a session that is not an agent tab as a tab id", () => {
        expect(askTarget(item({ session: "run:tab-1" }), [{ id: "tab-1" }])).toEqual({ kind: "ended" });
    });

    it("ignores a roster agent with no transcript when matching the conversation", () => {
        expect(askTarget(item({ conversation: "conv-1" }), [{ id: "a" }, { id: "b", transcriptPath: "" }])).toEqual({
            kind: "resume",
            conversation: "conv-1",
        });
    });
});

describe("askAgent", () => {
    const deps = (over: Partial<AskDeps> = {}) => {
        const quotes: { agentId: string; make: (box: string) => string | null }[] = [];
        const d: AskDeps = {
            jump: vi.fn(),
            reopen: vi.fn(async () => ({ tabId: "new-tab", title: "resumed" })),
            quote: vi.fn((agentId, make) => {
                quotes.push({ agentId, make });
            }),
            error: vi.fn(),
            ...over,
        };
        return { d, quotes };
    };
    const NOTE = "> the first line\n> the second line\n\nSaved from Chat";

    it("jumps to the live agent and quotes the passage the note quotes, under what is already in its box", async () => {
        const { d, quotes } = deps();
        const ok = await askAgent(item({ note: NOTE, session: "agent:tab-1" }), [{ id: "tab-1" }], d);
        expect(ok).toBe(true);
        expect(d.jump).toHaveBeenCalledWith("tab-1");
        expect(d.reopen).not.toHaveBeenCalled();
        expect(quotes).toHaveLength(1);
        expect(quotes[0].agentId).toBe("tab-1");
        expect(quotes[0].make("")).toBe("> the first line\n> the second line\n\n");
        expect(quotes[0].make("a draft")).toBe("a draft\n\n> the first line\n> the second line\n\n");
        expect(d.error).not.toHaveBeenCalled();
    });

    it("quotes the item's label when the note quotes nothing", async () => {
        const { d, quotes } = deps();
        await askAgent(item({ note: "plain words from the agent", session: "agent:tab-1" }), [{ id: "tab-1" }], d);
        expect(quotes[0].make("")).toBe("> Push DEV\n\n");
        const none = deps();
        await askAgent(item({ note: "", session: "agent:tab-1" }), [{ id: "tab-1" }], none.d);
        expect(none.quotes[0].make("")).toBe("> Push DEV\n\n");
    });

    it("jumps before it quotes", async () => {
        const order: string[] = [];
        const { d } = deps({
            jump: vi.fn(() => void order.push("jump")),
            quote: vi.fn(() => void order.push("quote")),
        });
        await askAgent(item({ session: "agent:tab-1" }), [{ id: "tab-1" }], d);
        expect(order).toEqual(["jump", "quote"]);
    });

    it("resumes the conversation of an ended agent, then quotes into the tab it opened", async () => {
        const { d, quotes } = deps();
        const ok = await askAgent(item({ note: NOTE, session: "agent:gone", conversation: "conv-1" }), [], d);
        expect(ok).toBe(true);
        expect(d.reopen).toHaveBeenCalledWith("conv-1");
        // the launch foregrounds the new tab itself
        expect(d.jump).not.toHaveBeenCalled();
        expect(quotes).toHaveLength(1);
        expect(quotes[0].agentId).toBe("new-tab");
        expect(quotes[0].make("")).toBe("> the first line\n> the second line\n\n");
        expect(d.error).not.toHaveBeenCalled();
    });

    it("quotes only after the resume has opened the tab", async () => {
        const order: string[] = [];
        const { d } = deps({
            reopen: vi.fn(async () => {
                order.push("reopen");
                return { tabId: "new-tab", title: "t" };
            }),
            quote: vi.fn(() => void order.push("quote")),
        });
        await askAgent(item({ conversation: "conv-1" }), [], d);
        expect(order).toEqual(["reopen", "quote"]);
    });

    it("tells why the session cannot be resumed, and quotes nothing", async () => {
        const { d, quotes } = deps({ reopen: vi.fn(async () => ({ error: "no session starts with conv-1" })) });
        const ok = await askAgent(item({ conversation: "conv-1" }), [], d);
        expect(ok).toBe(false);
        expect(d.error).toHaveBeenCalledWith("no session starts with conv-1");
        expect(quotes).toHaveLength(0);
    });

    it("tells a resume that throws", async () => {
        const { d, quotes } = deps({
            reopen: vi.fn(async () => {
                throw new Error("Pi session no longer exists");
            }),
        });
        expect(await askAgent(item({ conversation: "conv-1" }), [], d)).toBe(false);
        expect(d.error).toHaveBeenCalledWith("Pi session no longer exists");
        expect(quotes).toHaveLength(0);
    });

    it("says the session has ended when neither the tab nor a conversation is there", async () => {
        const { d, quotes } = deps();
        const ok = await askAgent(item({ session: "agent:gone" }), [], d);
        expect(ok).toBe(false);
        expect(d.error).toHaveBeenCalledWith(ENDED_MESSAGE);
        expect(ENDED_MESSAGE).toBe("That agent session has ended");
        expect(d.jump).not.toHaveBeenCalled();
        expect(d.reopen).not.toHaveBeenCalled();
        expect(quotes).toHaveLength(0);
    });
});
