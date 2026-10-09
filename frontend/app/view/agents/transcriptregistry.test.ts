import { describe, expect, it } from "vitest";
import { projectorFor, resolveAgentIdentity } from "./transcriptregistry";

// A line each format understands; the other format projects it to nothing — so which entries come
// back tells us which projector the resolver picked, without coupling to the registry internals.
const codexLine = JSON.stringify({
    type: "response_item",
    payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "hi" }] },
});
const claudeLine = JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "hi" }] } });
const MSG = [{ kind: "message", text: "hi" }];

describe("projectorFor", () => {
    it("routes by explicit agent: codex", () => {
        expect(projectorFor("codex").project([codexLine])).toEqual(MSG);
        expect(projectorFor("codex").project([claudeLine])).toEqual([]);
    });

    it("routes by explicit agent: claude", () => {
        expect(projectorFor("claude").project([claudeLine])).toEqual(MSG);
        expect(projectorFor("claude").project([codexLine])).toEqual([]);
    });

    it("falls back to the transcript path when the agent is absent", () => {
        expect(projectorFor(undefined, "C:/Users/u/.codex/sessions/2026/r.jsonl").project([codexLine])).toEqual(MSG);
        expect(projectorFor(undefined, "/home/u/.claude/projects/enc/x.jsonl").project([claudeLine])).toEqual(MSG);
    });

    it("prefers a .claude path even when it also contains .codex (claude working in a codex dir)", () => {
        const p = "/home/u/.claude/projects/C--Users-u--codex-spike/x.jsonl";
        expect(projectorFor(undefined, p).project([claudeLine])).toEqual(MSG);
    });

    it("defaults to claude for an unknown agent and no path", () => {
        expect(projectorFor("gemini").project([claudeLine])).toEqual(MSG);
        expect(projectorFor(undefined, undefined).project([claudeLine])).toEqual(MSG);
    });

    it("routes by explicit agent: opencode", () => {
        expect(projectorFor("opencode", "/no/such/path").project).toBeDefined();
    });

    it("routes by explicit agent: pi", () => {
        // a line only the Pi projector renders (parent-linked v3 message record)
        const piLine = JSON.stringify({
            type: "message",
            id: "m1",
            parentId: null,
            message: { role: "assistant", content: "hi" },
        });
        expect(projectorFor("pi").project([piLine])).toEqual(MSG);
    });

    it("falls back to the pi projector for a native sessions path (POSIX)", () => {
        const piLine = JSON.stringify({
            type: "message",
            id: "m1",
            parentId: null,
            message: { role: "assistant", content: "hi" },
        });
        expect(projectorFor(undefined, "/home/u/.pi/agent/sessions/proj/s.jsonl").project([piLine])).toEqual(MSG);
    });

    it("falls back to the pi projector for a native sessions path (Windows)", () => {
        const piLine = JSON.stringify({
            type: "message",
            id: "m1",
            parentId: null,
            message: { role: "assistant", content: "hi" },
        });
        expect(projectorFor(undefined, "C:\\Users\\u\\.pi\\agent\\sessions\\proj\\s.jsonl").project([piLine])).toEqual(
            MSG
        );
    });

    it("does not route a project path merely containing 'pi'", () => {
        const piLine = JSON.stringify({
            type: "message",
            id: "m1",
            parentId: null,
            message: { role: "assistant", content: "hi" },
        });
        expect(projectorFor(undefined, "/home/u/repo-pi/proj/x.jsonl").project([piLine])).toEqual([]);
    });

    it("falls back to opencode for a shadow path", () => {
        // a shadow transcript line only the opencode projector understands
        const opencodeLine = JSON.stringify({ type: "assistant", text: "hi" });
        const shadow = "C:\\Users\\u\\.local\\share\\opencode\\waveterm\\ses_x.jsonl";
        expect(projectorFor(undefined, shadow).project([opencodeLine])).toEqual(MSG);
    });

    it("routes by explicit agent: agy", () => {
        const agyLine = JSON.stringify({ type: "PLANNER_RESPONSE", status: "DONE", content: "hi" });
        expect(projectorFor("agy").project([agyLine])).toEqual(MSG);
        expect(projectorFor("agy").project([claudeLine])).toEqual([]);
        expect(projectorFor("agy").extractTitle).toBeDefined();
    });

    it("falls back to the agy projector for a brain path (POSIX)", () => {
        const agyLine = JSON.stringify({ type: "PLANNER_RESPONSE", status: "DONE", content: "hi" });
        const p = "/Users/u/.gemini/antigravity-cli/brain/abc/.system_generated/logs/transcript_full.jsonl";
        expect(projectorFor(undefined, p).project([agyLine])).toEqual(MSG);
    });

    it("falls back to the agy projector for a brain path (Windows)", () => {
        const agyLine = JSON.stringify({ type: "PLANNER_RESPONSE", status: "DONE", content: "hi" });
        const p = "C:\\Users\\u\\.gemini\\antigravity-cli\\brain\\abc\\.system_generated\\logs\\transcript_full.jsonl";
        expect(projectorFor(undefined, p).project([agyLine])).toEqual(MSG);
    });

    it("does not route a path merely containing 'antigravity'", () => {
        const agyLine = JSON.stringify({ type: "PLANNER_RESPONSE", status: "DONE", content: "hi" });
        expect(projectorFor(undefined, "/home/u/antigravity-notes/x.jsonl").project([agyLine])).toEqual([]);
    });

    it("exposes extractTitle for claude (ai-title) and omits it for codex (deferred)", () => {
        const titleLine = JSON.stringify({ type: "ai-title", aiTitle: "Fix it" });
        expect(projectorFor("claude").extractTitle?.([titleLine])).toBe("Fix it");
        expect(projectorFor("codex").extractTitle).toBeUndefined();
    });
});

describe("roster identity fallback", () => {
    it("uses launch metadata when a status omits its runtime", () => {
        expect(resolveAgentIdentity(undefined, "codex")).toBe("codex");
    });
    it("recognizes Windows Codex transcript paths", () => {
        expect(resolveAgentIdentity(undefined, undefined, "C:\\Users\\u\\.codex\\sessions\\rollout.jsonl")).toBe(
            "codex"
        );
    });
    it("keeps an explicit runtime and leaves absent identity unknown", () => {
        expect(resolveAgentIdentity("pi", "codex", "/u/.codex/sessions/r.jsonl")).toBe("pi");
        expect(resolveAgentIdentity(undefined, undefined, "/unknown/r.jsonl")).toBeUndefined();
    });
});
