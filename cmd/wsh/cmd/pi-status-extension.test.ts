import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import wavetermStatus, { registerWavetermStatus, sessionTitle } from "./pi-status-extension";

type Handler = (event: any, ctx: any) => void;

const LIFECYCLE_EVENTS = [
    "session_start",
    "session_info_changed",
    "model_select",
    "agent_start",
    "tool_execution_start",
    "message_end",
    "agent_settled",
    "session_shutdown",
    "session_before_compact",
    "session_compact",
    "session_compact_failed",
];

function fakePi() {
    const handlers = new Map<string, Handler[]>();
    const exec = vi.fn(async () => {});
    return {
        on: (event: string, fn: Handler) => {
            handlers.set(event, [...(handlers.get(event) ?? []), fn]);
        },
        exec,
        handlers,
    };
}

function sessionCtx(over: Record<string, unknown> = {}) {
    return {
        cwd: "C:\\Users\\Jane Doe\\proj",
        sessionManager: {
            getSessionFile: () => "C:\\Users\\Jane Doe\\.pi\\agent\\sessions\\s.jsonl",
            getSessionId: () => "session-1",
            getSessionName: () => "fix the bug",
            getEntries: () => [],
        },
        model: { provider: "openai-codex", id: "gpt-5.5" },
        ...over,
    };
}

function usageCtx(over: Record<string, unknown> = {}) {
    return {
        ...sessionCtx(),
        getContextUsage: () => ({ percent: 42.5, contextWindow: 200000 }),
        ...over,
    };
}

function statusArgs(over: Record<string, string> = {}) {
    return {
        agentstatus: "agentstatus",
        "--agent": "pi",
        "--state": "",
        "--cwd": "C:\\Users\\Jane Doe\\proj",
        "--transcript": "C:\\Users\\Jane Doe\\.pi\\agent\\sessions\\s.jsonl",
        "--session-id": "session-1",
        "--title": "fix the bug",
        "--provider": "openai-codex",
        "--model": "gpt-5.5",
        ...over,
    };
}

function assertStatusExec(pi: ReturnType<typeof fakePi>, wshPath: string, over: Record<string, string> = {}) {
    const want = statusArgs(over);
    expect(pi.exec).toHaveBeenCalledWith(wshPath, expect.arrayContaining(Object.entries(want).flat()));
}

// the extension registers its reporters only inside a Wave block (the agentstatus RPC is
// unreachable elsewhere); every handler test below runs with a block env present
beforeEach(() => {
    process.env.WAVETERM_BLOCKID = "block:test";
});
afterEach(() => {
    delete process.env.WAVETERM_BLOCKID;
});

describe("registerWavetermStatus", () => {
    it("registers nothing outside a Wave block", () => {
        delete process.env.WAVETERM_BLOCKID;
        const pi = fakePi();
        registerWavetermStatus(pi, "wsh");
        expect(pi.handlers.size).toBe(0);
    });
    it("registers every lifecycle event", () => {
        const pi = fakePi();
        registerWavetermStatus(pi, "wsh");
        for (const ev of LIFECYCLE_EVENTS) {
            expect(pi.handlers.get(ev)?.length).toBeGreaterThan(0);
        }
    });

    it("reports idle on session_start", async () => {
        const pi = fakePi();
        registerWavetermStatus(pi, "wsh");
        await pi.handlers.get("session_start")![0]({}, sessionCtx());
        assertStatusExec(pi, "wsh", { "--state": "idle" });
    });

    it("reports working for a compaction and idle after it", async () => {
        const pi = fakePi();
        registerWavetermStatus(pi, "wsh");
        await pi.handlers.get("session_before_compact")![0]({ reason: "manual" }, sessionCtx());
        expect(pi.exec).toHaveBeenLastCalledWith("wsh", expect.arrayContaining(["--state", "working"]));
        await pi.handlers.get("session_compact")![0]({ reason: "manual" }, sessionCtx());
        expect(pi.exec).toHaveBeenLastCalledWith("wsh", expect.arrayContaining(["--state", "idle"]));
    });

    it("keeps a turn working across a compaction inside it", async () => {
        const pi = fakePi();
        registerWavetermStatus(pi, "wsh");
        await pi.handlers.get("agent_start")![0]({}, sessionCtx());
        await pi.handlers.get("session_before_compact")![0]({ reason: "threshold" }, sessionCtx());
        await pi.handlers.get("session_compact")![0]({ reason: "threshold" }, sessionCtx());
        expect(pi.exec).toHaveBeenLastCalledWith("wsh", expect.arrayContaining(["--state", "working"]));
    });

    it("restores the prior state when a compaction fails", async () => {
        const pi = fakePi();
        registerWavetermStatus(pi, "wsh");
        await pi.handlers.get("session_before_compact")![0]({ reason: "manual" }, sessionCtx());
        await pi.handlers.get("session_compact_failed")![0]({ reason: "manual", aborted: false }, sessionCtx());
        expect(pi.exec).toHaveBeenLastCalledWith("wsh", expect.arrayContaining(["--state", "idle"]));
    });

    it("reports working on agent_start", async () => {
        const pi = fakePi();
        registerWavetermStatus(pi, "wsh");
        await pi.handlers.get("agent_start")![0]({}, sessionCtx());
        assertStatusExec(pi, "wsh", { "--state": "working" });
    });

    it("reports working with tool detail on tool_execution_start", async () => {
        const pi = fakePi();
        registerWavetermStatus(pi, "wsh");
        await pi.handlers.get("tool_execution_start")![0]({ toolName: "bash" }, sessionCtx());
        assertStatusExec(pi, "wsh", { "--state": "working", "--detail": "bash" });
    });

    it("extracts the file path for read/edit/write", async () => {
        const pi = fakePi();
        registerWavetermStatus(pi, "wsh");
        const cases: [string, any, string][] = [
            ["read", { path: "src/foo.ts" }, "reading foo.ts"],
            ["edit", { path: "C:\\Users\\Jane Doe\\main.go" }, "editing main.go"],
            ["write", { path: "/home/jane/new.rs" }, "writing new.rs"],
            // Claude Code-style file_path key works too
            ["write", { file_path: "out.md" }, "writing out.md"],
        ];
        for (const [toolName, args, detail] of cases) {
            await pi.handlers.get("tool_execution_start")![0]({ toolName, args }, sessionCtx());
        }
        const details = pi.exec.mock.calls.map((c) => {
            const idx = c[1].indexOf("--detail");
            return idx >= 0 ? c[1][idx + 1] : undefined;
        });
        expect(details).toEqual(cases.map(([, , detail]) => detail));
    });

    it("reports the bash command and truncates it to 60 chars", async () => {
        const pi = fakePi();
        registerWavetermStatus(pi, "wsh");
        await pi.handlers.get("tool_execution_start")![0](
            { toolName: "bash", args: { command: "ls -la" } },
            sessionCtx()
        );
        assertStatusExec(pi, "wsh", { "--state": "working", "--detail": "running ls -la" });
        const long = "npm test -- --runInBand ".repeat(10);
        await pi.handlers.get("tool_execution_start")![0]({ toolName: "Bash", args: { command: long } }, sessionCtx());
        assertStatusExec(pi, "wsh", { "--state": "working", "--detail": "running " + long.slice(0, 60) });
    });

    it("falls back to the tool name when no path is present", async () => {
        const pi = fakePi();
        registerWavetermStatus(pi, "wsh");
        await pi.handlers.get("tool_execution_start")![0]({ toolName: "Read", args: {} }, sessionCtx());
        assertStatusExec(pi, "wsh", { "--state": "working", "--detail": "read" });
    });

    it("clamps detail to 160 chars", async () => {
        const pi = fakePi();
        registerWavetermStatus(pi, "wsh");
        const long = "x".repeat(500);
        await pi.handlers.get("tool_execution_start")![0]({ toolName: long }, sessionCtx());
        assertStatusExec(pi, "wsh", { "--state": "working", "--detail": "x".repeat(160) });
    });

    it("reports idle on agent_settled and session_shutdown", async () => {
        for (const ev of ["agent_settled", "session_shutdown"]) {
            const pi = fakePi();
            registerWavetermStatus(pi, "wsh");
            await pi.handlers.get(ev)![0]({}, sessionCtx());
            assertStatusExec(pi, "wsh", { "--state": "idle" });
        }
    });

    // the roster drops a running tab whose latest status is ended, so an exited pi takes no typed send
    it("marks only session_shutdown as ended", async () => {
        for (const [ev, ended] of [
            ["session_shutdown", true],
            ["agent_settled", false],
            ["session_start", false],
        ] as const) {
            const pi = fakePi();
            registerWavetermStatus(pi, "wsh");
            await pi.handlers.get(ev)![0]({}, sessionCtx());
            expect(pi.exec.mock.calls[0][1].includes("--ended"), ev).toBe(ended);
        }
    });

    it("message_end reports current state then usage", async () => {
        const pi = fakePi();
        registerWavetermStatus(pi, "wsh");
        const handler = pi.handlers.get("message_end")![0];
        await handler({}, usageCtx());
        assertStatusExec(pi, "wsh", { "--state": "idle" });
        expect(pi.exec).toHaveBeenLastCalledWith("wsh", [
            "agentstatus",
            "--usage",
            "--context-pct",
            "42.5",
            "--context-max",
            "200000",
        ]);
    });

    it("message_end without usage reports state only", async () => {
        const pi = fakePi();
        registerWavetermStatus(pi, "wsh");
        await pi.handlers.get("message_end")![0]({}, sessionCtx());
        assertStatusExec(pi, "wsh", { "--state": "idle" });
        const all = pi.exec.mock.calls.map((c) => c[1]);
        expect(all).toHaveLength(1);
    });

    it("swallows exec errors (best-effort live reporting)", async () => {
        const pi = fakePi();
        pi.exec.mockRejectedValue(new Error("boom"));
        registerWavetermStatus(pi, "wsh");
        await expect(pi.handlers.get("agent_start")![0]({}, sessionCtx())).resolves.toBeUndefined();
    });

    it("falls back to empty strings when optional ctx fields are absent", async () => {
        const pi = fakePi();
        registerWavetermStatus(pi, "wsh");
        // the extension contract requires ctx.sessionManager with getSessionFile/getSessionId;
        // everything else (cwd, model, session name, entries) is optional and falls back to "".
        const ctx = { sessionManager: { getSessionFile: () => "", getSessionId: () => "" } };
        await pi.handlers.get("agent_start")![0]({}, ctx);
        assertStatusExec(pi, "wsh", {
            "--state": "working",
            "--cwd": "",
            "--transcript": "",
            "--session-id": "",
            "--title": "",
            "--provider": "",
            "--model": "",
        });
    });

    it("reports the explicit session name as the title", async () => {
        const pi = fakePi();
        registerWavetermStatus(pi, "wsh");
        await pi.handlers.get("agent_start")![0]({}, sessionCtx());
        assertStatusExec(pi, "wsh", { "--state": "working", "--title": "fix the bug" });
    });
});

describe("sessionTitle", () => {
    function sm(over: Record<string, unknown> = {}) {
        return { getSessionName: () => "", ...over };
    }

    it("returns the explicit session name", () => {
        expect(sessionTitle(sm({ getSessionName: () => "my name" }))).toBe("my name");
    });

    it("trims the explicit session name", () => {
        expect(sessionTitle(sm({ getSessionName: () => "  my name  " }))).toBe("my name");
    });

    it("returns empty when the session has no explicit name (the backend generates auto titles)", () => {
        expect(sessionTitle(sm())).toBe("");
        expect(sessionTitle(undefined)).toBe("");
        // a first user message is NOT a title — the backend PiTitleProvider summarizes it
        expect(
            sessionTitle(
                sm({
                    getEntries: () => [
                        { type: "message", message: { role: "user", content: "first prompt" } },
                    ],
                })
            )
        ).toBe("");
    });

    it("reports an empty title through agentstatus for a nameless session", async () => {
        const pi = fakePi();
        registerWavetermStatus(pi, "wsh");
        const ctx = sessionCtx({
            sessionManager: {
                getSessionFile: () => "C:\\Users\\Jane Doe\\.pi\\agent\\sessions\\s.jsonl",
                getSessionId: () => "session-1",
                getSessionName: () => "",
                getEntries: () => [
                    {
                        type: "message",
                        message: { role: "user", content: "rename me to this" },
                    },
                ],
            },
        });
        await pi.handlers.get("agent_start")![0]({}, ctx);
        assertStatusExec(pi, "wsh", { "--state": "working", "--title": "" });
    });
});

describe("default export", () => {
    it("wires registerWavetermStatus with the placeholder wsh path", async () => {
        const pi = fakePi();
        wavetermStatus(pi);
        expect(pi.handlers.get("session_start")?.length).toBe(1);
        await pi.handlers.get("agent_start")![0]({}, sessionCtx());
        assertStatusExec(pi, "__WSH_PATH__", { "--state": "working" });
    });
});
