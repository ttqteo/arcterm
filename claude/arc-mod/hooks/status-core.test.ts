import { describe, expect, it } from "vitest";
import { idleArgs } from "./status-core";

describe("idleArgs", () => {
    it("leaves an answered turn to the Stop settings hook", () => {
        expect(idleArgs({ reason: "answer" }, "/t.jsonl")).toBeNull();
    });

    it("reports idle for an answered turn that put a question in claude's dialog: a dismissal runs no Stop", () => {
        expect(idleArgs({ reason: "answer" }, null, true)).toEqual(["agentstatus", "--state", "idle", "--agent", "claude"]);
        expect(idleArgs({ reason: "answer", agentId: "a1" }, null, true)).toBeNull();
    });

    it("reports idle for an interrupted turn, with the transcript it knows", () => {
        expect(idleArgs({ reason: "aborted" }, "/t.jsonl")).toEqual([
            "agentstatus", "--state", "idle", "--agent", "claude", "--transcript", "/t.jsonl",
        ]);
    });

    it("reports idle for a turn an API error or a refusal ended", () => {
        for (const reason of ["error", "refusal"]) {
            expect(idleArgs({ reason }, "/t.jsonl")).toEqual([
                "agentstatus", "--state", "idle", "--agent", "claude", "--transcript", "/t.jsonl",
            ]);
        }
    });

    it("sends no transcript flag before the session has named one", () => {
        expect(idleArgs({ reason: "aborted" }, null)).toEqual([
            "agentstatus", "--state", "idle", "--agent", "claude",
        ]);
    });

    it("ignores a subagent's turn: the session is still working", () => {
        expect(idleArgs({ reason: "aborted", agentId: "a1" }, "/t.jsonl")).toBeNull();
    });
});
