// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Pure: join on-disk subagent files (SubagentFileInfo, from GetSubagentsCommand) to the parent's Task
// spawns (SubagentSpawn) by prompt-match. type + state come from the matched spawn; an unmatched file
// (spawn not in the tailed parent window, or a fallback) gets a prompt-derived label, and its state from the file
// (finished, or ended by a parent notification) — see resolveState.
// The model comes from the file itself (its latest assistant turn), matched or not. Whether it runs in the background
// (async) and when it started come from the spawn; an unmatched file's start is its first record's time (else its last
// write), and every file carries its last write, about when a finished child ended. A matched file also
// carries its spawn's toolUseId, the link from an Agent / Task call to the subagent it started.
// No React, no runtime imports. SubagentFileInfo is a generated global type (gotypes.d.ts).
//
// Match strategy (Phase 0 spike, 2026-07-09): normalized-exact prompt equality. 582/606 (96%) of real
// child files match this way; the 24 that don't are workflow-orchestrated subagents whose parent has no
// Task tool_use (16) or a substantively-different prompt (7) — a prefix compare would rescue only 1 while
// risking false-positive collisions, so it was rejected. Unmatched files degrade to the fallback label.

import type { SubagentVM } from "./session-models/sessionviewmodel";
import type { SubagentSpawn } from "./transcriptprojection";

const FALLBACK_LABEL_MAX = 40;

function normPrompt(p: string): string {
    return p.trim().replace(/\s+/g, " ");
}

function firstLineLabel(prompt: string): string {
    const line = prompt.split("\n").find((l) => l.trim() !== "")?.trim() ?? "";
    return line.length > FALLBACK_LABEL_MAX ? line.slice(0, FALLBACK_LABEL_MAX) : line;
}

// state resolution: a matched spawn's parent tool_result is authoritative (working/failure/success).
// A background spawn's parent tool_result was only the launch ack, so it ends at its <task-notification>: in the
// tailed window (spawn.done), or anywhere in the parent, as the file's endstatus (listSubagents reads the whole parent,
// and joins a notice that names only the task id, such as a resumed session's "didn't finish before the previous
// session ended"). Either is a success or a failure like a foreground spawn's result. Short of both, the child file
// tells us only whether it *finished*: a terminated orphan is the neutral "done", never a green success.
function resolveState(spawn: SubagentSpawn | undefined, f: SubagentFileInfo): SubagentVM["state"] {
    if (spawn != null && (!spawn.async || spawn.done)) {
        return !spawn.done ? "working" : spawn.failed ? "failure" : "success";
    }
    if (f.endstatus) {
        return f.endstatus === "completed" ? "success" : "failure";
    }
    return f.done ? "done" : "working";
}

export function correlateSubagents(spawns: SubagentSpawn[], files: SubagentFileInfo[]): SubagentVM[] {
    const byPrompt = new Map<string, SubagentSpawn[]>();
    for (const s of spawns) {
        const key = normPrompt(s.prompt);
        const bucket = byPrompt.get(key);
        if (bucket) {
            bucket.push(s);
        } else {
            byPrompt.set(key, [s]);
        }
    }
    return files.map((f) => {
        // shift() consumes the match so parallel same-prompt spawns pair 1:1 with files in order
        const spawn = byPrompt.get(normPrompt(f.firstprompt))?.shift();
        const type = spawn?.subagentType || firstLineLabel(f.firstprompt) || "subagent";
        const sub: SubagentVM = {
            id: f.agentid,
            type,
            state: resolveState(spawn, f),
            model: f.model || undefined,
            transcriptPath: f.transcriptpath,
            ...(spawn?.async ? { async: true as const } : {}),
            ...(spawn?.startMs != null || f.startedatms > 0 ? { startedAtMs: spawn?.startMs ?? f.startedatms } : {}),
            ...(f.lastwritems > 0 ? { lastWriteMs: f.lastwritems } : {}),
        };
        // the call that started it, which a reviewer card finds its subagent by; an unmatched file has none
        if (spawn != null) {
            sub.toolUseId = spawn.toolUseId;
        }
        return sub;
    });
}
