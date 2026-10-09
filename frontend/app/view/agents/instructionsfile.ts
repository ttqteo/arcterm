// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The project instructions file the details rail links to: the CLAUDE.md or AGENTS.md at the root the agent works in,
// whichever its harness reads. Only the project's own file: the user's global one and CLAUDE.local.md are not listed.

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { joinRepoPath } from "@/util/paths";
import { atom } from "jotai";

// the files a harness reads as its project instructions, in the order it looks: Claude Code reads CLAUDE.md (at the
// root or under .claude/) and falls back to AGENTS.md; pi, codex, opencode and the rest read AGENTS.md
export function instructionCandidates(runtime?: string): string[] {
    if (runtime == null || runtime === "" || runtime === "claude") {
        return ["CLAUDE.md", ".claude/CLAUDE.md", "AGENTS.md"];
    }
    return ["AGENTS.md"];
}

export function instructionsKey(cwd: string, runtime?: string): string {
    return `${instructionCandidates(runtime)[0]}|${cwd}`;
}

// keyed by instructionsKey: the absolute path found, null when the root has none; absent while unread
export const instructionsFileAtom = atom<Record<string, string | null>>({});

const inflight = new Set<string>();

// loadInstructionsFile looks for the first candidate that exists under cwd, once per root and harness: a stat each
export async function loadInstructionsFile(cwd: string, runtime?: string): Promise<void> {
    const key = instructionsKey(cwd, runtime);
    if (key in globalStore.get(instructionsFileAtom) || inflight.has(key)) {
        return;
    }
    inflight.add(key);
    let found: string | null = null;
    try {
        for (const rel of instructionCandidates(runtime)) {
            const abs = joinRepoPath(cwd, rel);
            try {
                const info = await RpcApi.FileInfoCommand(TabRpcClient, { info: { path: abs } });
                if (info != null && !info.notfound && !info.isdir) {
                    found = abs;
                    break;
                }
            } catch {
                // unreadable: try the next
            }
        }
    } finally {
        inflight.delete(key);
    }
    globalStore.set(instructionsFileAtom, { ...globalStore.get(instructionsFileAtom), [key]: found });
}
