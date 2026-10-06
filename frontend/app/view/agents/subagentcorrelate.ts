// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Pure: join on-disk subagent files (SubagentFileInfo, from GetSubagentsCommand) to the parent's Task
// spawns (SubagentSpawn) by prompt-match. type + state come from the matched spawn; an unmatched file
// (spawn not yet in the tailed parent window, or a fallback) stays "working" with a prompt-derived label.
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
// An orphan (no matching spawn) has no parent accept/reject signal, so the child file tells us only
// whether it *finished* — a terminated orphan is the neutral "done", never a green success. A background
// spawn is read the same way: its parent's tool_result was only the launch receipt.
function resolveState(spawn: SubagentSpawn | undefined, fileDone: boolean): SubagentVM["state"] {
    if (spawn != null && !spawn.async) {
        return !spawn.done ? "working" : spawn.failed ? "failure" : "success";
    }
    return fileDone ? "done" : "working";
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
        return { id: f.agentid, type, state: resolveState(spawn, f.done), transcriptPath: f.transcriptpath };
    });
}
