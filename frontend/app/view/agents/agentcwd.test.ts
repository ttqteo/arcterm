// frontend/app/view/agents/agentcwd.test.ts
import { describe, expect, it } from "vitest";
import { agentCwd } from "./agentcwd";

describe("agentCwd", () => {
    it("reads cwd from a Claude record (top-level cwd)", () => {
        const lines = [
            JSON.stringify({ type: "mode", sessionId: "s" }),
            JSON.stringify({ type: "user", cwd: "C:\\Users\\k\\proj", gitBranch: "main" }),
        ];
        expect(agentCwd(lines)).toBe("C:\\Users\\k\\proj");
    });

    it("reads cwd from a Codex session_meta record (payload.cwd)", () => {
        const lines = [JSON.stringify({ type: "session_meta", payload: { cwd: "/home/k/proj" } })];
        expect(agentCwd(lines)).toBe("/home/k/proj");
    });

    it("returns null when no record carries a cwd", () => {
        expect(agentCwd([JSON.stringify({ type: "mode" })])).toBeNull();
    });

    it("skips a top-level cwd that is not a non-empty string", () => {
        const lines = [JSON.stringify({ cwd: 42 }), JSON.stringify({ cwd: "" }), JSON.stringify({ cwd: "/real" })];
        expect(agentCwd(lines)).toBe("/real");
    });

    it("reads payload.cwd only from a session_meta record holding a non-empty string", () => {
        const lines = [
            JSON.stringify({ type: "turn_context", payload: { cwd: "/not-meta" } }),
            JSON.stringify({ type: "session_meta", payload: { cwd: 7 } }),
            JSON.stringify({ type: "session_meta", payload: { cwd: "" } }),
            JSON.stringify({ type: "session_meta", payload: { cwd: "/home/k/proj" } }),
        ];
        expect(agentCwd(lines)).toBe("/home/k/proj");
    });

    it("skips blank and malformed lines", () => {
        const lines = ["", "not json", JSON.stringify({ cwd: "/x" })];
        expect(agentCwd(lines)).toBe("/x");
    });
});
