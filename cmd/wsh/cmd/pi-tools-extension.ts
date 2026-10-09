// pi extension: wave_* tools (pi drives arc), the notification bridge (B3) and the job queue slot on bash.
// Installed by `wsh install-agent-hooks` into ~/.pi/agent/extensions/waveterm-tools.ts with __WSH_PATH__
// substituted for the absolute wsh path. Bare pi outside a Wave block is inert: the tools fail closed
// with a clear error.
import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { Type } from "typebox";
import {
    captureTailArgs,
    dagRulesArgs,
    jobslotArgs,
    jobslotLine,
    notifyArgs,
    openFileArgs,
    querySessionsArgs,
    runCommandArgs,
    withOrchestrationRules,
} from "./waveterm-tools-core";

export function registerWavetermTools(pi: any, wshPath: string): void {
    const wsh = async (args: string[]): Promise<{ ok: boolean; stdout: string; stderr: string }> => {
        try {
            const { stdout } = await pi.exec(wshPath, args);
            return { ok: true, stdout, stderr: "" };
        } catch (e) {
            return { ok: false, stdout: "", stderr: String(e) };
        }
    };

    // --- B1: wave_* tools --------------------------------------------------

    pi.registerTool({
        name: "wave_run_command",
        label: "Run Command in Wave",
        description:
            "Run a shell command in a new arcterm terminal tab the user can see, and return the id of the block it runs in. " +
            "With capture, also returns up to the last 4000 characters of that command's output as it stood when the tool returned. " +
            "Use it when the user should watch the command; fails outside an arcterm block.",
        promptSnippet: "Run a command visibly in a Wave tab",
        promptGuidelines: ["Use wave_run_command when the user wants a command run and visible in Wave."],
        parameters: Type.Object({
            command: Type.String({ description: "Full command line to run (shell string)" }),
            cwd: Type.Optional(Type.String({ description: "Working directory for the command" })),
            capture: Type.Optional(Type.Boolean({ description: "Also return a truncated tail of the output" })),
        }),
        async execute(_toolCallId: string, params: any): Promise<unknown> {
            const r = await wsh(runCommandArgs(params.command, params.cwd));
            if (!r.ok) {
                return { content: [{ type: "text", text: `wave_run_command failed: ${r.stderr}` }], details: {} };
            }
            let text = r.stdout.trim();
            if (params.capture) {
                const blockId = (r.stdout.match(/block\s+(\S+)/i)?.[1] ?? "").trim();
                if (blockId) {
                    const tail = await wsh(captureTailArgs(blockId));
                    text += `\n\nTail:\n${tail.ok ? tail.stdout.slice(-4000) : tail.stderr}`;
                }
            }
            return { content: [{ type: "text", text }], details: {} };
        },
    });

    pi.registerTool({
        name: "wave_open_file",
        label: "Open File in Wave",
        description:
            "Open an existing file in the arcterm cockpit's code surface, for the user to read. Takes an absolute path. " +
            "It does not return the file's contents; fails outside an arcterm block.",
        promptSnippet: "Open a file in the arcterm code surface",
        promptGuidelines: ["Use wave_open_file when the user wants a file opened in Wave."],
        parameters: Type.Object({
            path: Type.String({ description: "Absolute path to the file to open" }),
        }),
        async execute(_toolCallId: string, params: any): Promise<unknown> {
            const r = await wsh(openFileArgs(params.path));
            if (!r.ok) {
                return { content: [{ type: "text", text: `wave_open_file failed: ${r.stderr}` }], details: {} };
            }
            return { content: [{ type: "text", text: r.stdout.trim() }], details: {} };
        },
    });

    pi.registerTool({
        name: "wave_query_sessions",
        label: "Query Wave Sessions",
        description:
            "List the open arcterm blocks (terminal and edit views) as JSON, so a later call can name one by id. " +
            "The output is cut to its last 8000 characters, so a long list loses its earliest entries. " +
            "Fails outside an arcterm block.",
        promptSnippet: "List open Wave tabs/blocks",
        promptGuidelines: ["Use wave_query_sessions to list open Wave tabs before referencing one."],
        parameters: Type.Object({}),
        async execute(): Promise<unknown> {
            const r = await wsh(querySessionsArgs());
            if (!r.ok) {
                return { content: [{ type: "text", text: `wave_query_sessions failed: ${r.stderr}` }], details: {} };
            }
            return { content: [{ type: "text", text: r.stdout.slice(-8000) }], details: {} };
        },
    });

    pi.registerTool({
        name: "wave_notify",
        label: "Notify in Wave",
        description:
            "Show the user a notification in arcterm. The title is required; message and level (info, warn or error; default info) are optional. " +
            "Returns only a confirmation; fails outside an arcterm block.",
        promptSnippet: "Send a Wave notification",
        promptGuidelines: ["Use wave_notify to send a short notification into Wave."],
        parameters: Type.Object({
            title: Type.String({ description: "Notification title" }),
            message: Type.Optional(Type.String({ description: "Optional message body" })),
            level: Type.Optional(Type.String({ description: "info, warn, or error (default info)" })),
        }),
        async execute(_toolCallId: string, params: any): Promise<unknown> {
            const r = await wsh(notifyArgs(params.title, { message: params.message, level: params.level }));
            if (!r.ok) {
                return { content: [{ type: "text", text: `wave_notify failed: ${r.stderr}` }], details: {} };
            }
            return { content: [{ type: "text", text: "Notification sent." }], details: {} };
        },
    });

    // --- job queue: a heavy bash command waits for its turn and holds its slot while it runs ---------

    // `wsh jobslot` keeps the slot until it is killed, so the child stays alive across the command: it is kept
    // by tool call id and killed at that call's tool_result, or at shutdown. spawn, not pi.exec: the queue can
    // hold the command for a long while, and this has no timeout. any failure of wsh's lets the command run:
    // a broken queue never blocks pi
    const heldSlots = new Map<string, ChildProcess>();
    const releaseSlot = (toolCallId: string): void => {
        heldSlots.get(toolCallId)?.kill();
        heldSlots.delete(toolCallId);
    };
    // the status bar is a courtesy: pi builds without it, or without a UI, show nothing
    const showQueue = (ctx: any, text: string | undefined): void => {
        try {
            ctx?.ui?.setStatus?.("arc-jobslot", text);
        } catch {
            // never breaks the command
        }
    };
    // resolves with the reason the command may not run, or null when it may (a verdict, or wsh gone without one)
    const awaitVerdict = (child: ChildProcess, ctx: any): Promise<string | null> =>
        new Promise((resolve) => {
            let settled = false;
            const settle = (refusal: string | null) => {
                if (!settled) {
                    settled = true;
                    resolve(refusal);
                }
            };
            if (!child.stdout) {
                settle(null);
                return;
            }
            createInterface({ input: child.stdout }).on("line", (line) => {
                const read = jobslotLine(line);
                if (read && "hold" in read) {
                    showQueue(ctx, read.hold);
                } else if (read) {
                    settle(read.refusal);
                }
            });
            child.on("error", () => settle(null));
            child.on("close", () => settle(null));
        });

    pi.on("tool_call", async (event: any, ctx: any) => {
        if (event?.toolName !== "bash" || !process.env.WAVETERM_BLOCKID) {
            return undefined;
        }
        const toolCallId = typeof event.toolCallId === "string" ? event.toolCallId : "";
        let child: ChildProcess;
        try {
            child = spawn(wshPath, jobslotArgs(event.input?.command ?? ""), { stdio: ["ignore", "pipe", "ignore"] });
        } catch {
            return undefined;
        }
        const refusal = await awaitVerdict(child, ctx);
        showQueue(ctx, undefined);
        // a call with no id has no result to release the slot at: the queue only orders its start
        if (refusal !== null || toolCallId === "") {
            child.kill();
            return refusal === null ? undefined : { block: true, reason: refusal };
        }
        heldSlots.set(toolCallId, child);
        child.once("close", () => {
            if (heldSlots.get(toolCallId) === child) {
                heldSlots.delete(toolCallId);
            }
        });
        return undefined;
    });
    pi.on("tool_result", (event: any) => {
        if (typeof event?.toolCallId === "string") {
            releaseSlot(event.toolCallId);
        }
    });
    pi.on("session_shutdown", () => {
        for (const toolCallId of [...heldSlots.keys()]) {
            releaseSlot(toolCallId);
        }
    });

    // --- B3: notification bridge (event → wsh notify) ----------------------

    const notify = async (title: string, opts: { message?: string; level?: string }): Promise<void> => {
        try {
            await wsh(notifyArgs(title, opts));
        } catch {
            // best-effort: a failed notify never breaks the session
        }
    };

    pi.on("agent_settled", async (event: any, ctx: any) => {
        // The settled-payload error signal is confirmed during Task 8's live round-trip; the
        // predicate below covers the documented error carriers (event.error / ctx.lastError).
        if (event?.error || ctx?.lastError) {
            await notify("Pi session ended with an error", { level: "error" });
        }
    });

    // --- orchestrator lead: the rules after a compaction ------------------------------------------

    // a compaction drops the lead's launch prompt, so the rules are fetched once per compaction and ride
    // on every later request. a failed fetch keeps the last rules: they only name the run and its files.
    let rules = "";
    pi.on("session_compact", async () => {
        const r = await wsh(dagRulesArgs());
        if (r.ok) {
            rules = r.stdout;
        }
    });
    pi.on("context", (event: any) => {
        const messages = withOrchestrationRules(event?.messages ?? [], rules, Date.now());
        return messages ? { messages } : undefined;
    });
}

export default function wavetermTools(pi: any): void {
    registerWavetermTools(pi, "__WSH_PATH__");
}
