// pi extension reporting a running session into the Wave cockpit.
// Installed by `wsh install-agent-hooks` into ~/.pi/agent/extensions/waveterm-status.ts with
// __WSH_PATH__ substituted for the absolute wsh path. pi auto-loads every file in that directory.
// A bare pi outside a Wave block is fully inert: nothing runs without WAVETERM_BLOCKID + JWT.

/** Session title for the cockpit row: pi's explicit session name, else "" — the backend
 *  (PiTitleProvider) generates auto titles from the first user message, so the extension never
 *  fabricates a fallback that could overwrite a generated one. */
export function sessionTitle(sm: any): string {
    return sm?.getSessionName?.()?.trim() ?? "";
}

// basename strips the directory prefix from a tool file path (posix or windows separators).
export function basename(p: string): string {
    const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
    return i >= 0 ? p.slice(i + 1) : p;
}

// detailForTool mirrors the Claude Code hook's activity line (wshcmd-agenthook.go): a compact
// "reading/editing/writing <basename>" from the tool call args, falling back to the bare tool name.
export function detailForTool(toolName: string, args: any): string {
    const name = String(toolName ?? "").toLowerCase();
    const path =
        typeof args?.path === "string" && args.path
            ? args.path
            : typeof args?.file_path === "string"
              ? args.file_path
              : "";
    switch (name) {
        case "read":
            return path ? "reading " + basename(path) : name;
        case "edit":
            return path ? "editing " + basename(path) : name;
        case "write":
            return path ? "writing " + basename(path) : name;
        case "bash":
            return typeof args?.command === "string" && args.command ? "running " + args.command.slice(0, 60) : name;
    }
    return name || "tool";
}

export function registerWavetermStatus(pi: any, wshPath: string): void {
    // outside a Wave block the agentstatus RPC is unreachable — registering the handlers would
    // exec a failing wsh process on every lifecycle event, so stay inert instead
    if (!process.env.WAVETERM_BLOCKID) return;
    let state: "working" | "idle" = "idle";
    const report = async (ctx: any, next: "working" | "idle", detail = "", ended = false) => {
        state = next;
        const args = [
            "agentstatus",
            "--agent",
            "pi",
            "--state",
            next,
            "--cwd",
            ctx.cwd ?? "",
            "--transcript",
            ctx.sessionManager.getSessionFile() ?? "",
            "--session-id",
            ctx.sessionManager.getSessionId() ?? "",
            "--title",
            sessionTitle(ctx.sessionManager),
            "--provider",
            ctx.model?.provider ?? "",
            "--model",
            ctx.model?.id ?? "",
        ];
        if (detail) args.push("--detail", detail.slice(0, 160));
        if (ended) args.push("--ended");
        try {
            await pi.exec(wshPath, args);
        } catch {
            /* live reporting is best-effort */
        }
    };

    const reportUsage = async (ctx: any) => {
        const usage = ctx.getContextUsage?.();
        if (usage?.percent == null) return;
        try {
            await pi.exec(wshPath, [
                "agentstatus",
                "--usage",
                "--context-pct",
                String(usage.percent),
                "--context-max",
                String(usage.contextWindow),
            ]);
        } catch {
            /* live reporting is best-effort */
        }
    };

    pi.on("session_start", (_event: any, ctx: any) => report(ctx, "idle"));
    pi.on("session_info_changed", (_event: any, ctx: any) => report(ctx, state));
    pi.on("model_select", (_event: any, ctx: any) => report(ctx, state));
    pi.on("agent_start", (_event: any, ctx: any) => report(ctx, "working"));
    pi.on("tool_execution_start", (event: any, ctx: any) =>
        report(ctx, "working", detailForTool(event.toolName, event.args))
    );
    pi.on("message_end", async (_event: any, ctx: any) => {
        await report(ctx, state);
        await reportUsage(ctx);
    });
    pi.on("agent_settled", (_event: any, ctx: any) => report(ctx, "idle"));
    // ended: a pi that exited back to its shell leaves `wsh agents list`, so a send is never typed into the shell.
    // A session switch fires this too, and the new session's session_start lists the tab again at once.
    pi.on("session_shutdown", (_event: any, ctx: any) => report(ctx, "idle", "", true));
    // a compaction holds the session like a turn: it confirms a typed handoff /compact and keeps wakes out
    // while it runs. afterwards the session is back in whatever state the compaction interrupted.
    let beforeCompact: "working" | "idle" = "idle";
    pi.on("session_before_compact", async (_event: any, ctx: any) => {
        beforeCompact = state;
        await report(ctx, "working");
    });
    pi.on("session_compact", (_event: any, ctx: any) => report(ctx, beforeCompact));
    pi.on("session_compact_failed", (_event: any, ctx: any) => report(ctx, beforeCompact));
}

export default function wavetermStatus(pi: any): void {
    registerWavetermStatus(pi, "__WSH_PATH__");
}
