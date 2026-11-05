// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Update CLAUDE.md on a council's Memory tab: arcterm writes what each council settled into one block of the project's
// CLAUDE.md (pkg/council/projectdoc.go), and leaves the rest of the file to the agents. This is the prompt that asks a
// live Claude agent of the project to bring that rest in line (a status line, the next steps, a direction it outdates),
// and the agents it can go to. Pure, no React, no Wave runtime imports (councildocupdate.test.ts).

import { sameRepoPath } from "@/util/paths";
import { projectOf, type AgentVM } from "./agentsviewmodel";

const fold = (s: string | undefined): string => (s ?? "").replace(/\s+/g, " ").trim();

// the order the block lists a council's memory in, and each kind's word
const KINDS: readonly (readonly [string, string])[] = [
    ["agreed", "Agreed"],
    ["ruledout", "Ruled out"],
    ["open", "Open"],
];

/** Pure: a report as the prompt names it: relative to the project when it is inside it. */
function reportPath(path: string, project: string): string {
    const norm = (p: string) => p.replace(/[\\/]+/g, "/").replace(/\/+$/, "");
    const root = norm(project);
    const p = norm(path);
    return root !== "" && p.toLowerCase().startsWith(root.toLowerCase() + "/") ? p.slice(root.length + 1) : path;
}

/** Pure: the one-line prompt that asks an agent to bring the project's CLAUDE.md (AGENTS.md when it has none) in line
 *  with what the council settled: the council and its report, the direction and every entry, then the task, which
 *  leaves the arc block alone and asks for the diff first. Empty when the memory settles nothing. */
export function docUpdatePrompt(c: Council): string {
    const settled: string[] = [];
    const direction = fold(c.memory?.chosen?.text);
    if (direction !== "") {
        settled.push(`Direction: ${direction}`);
    }
    for (const [kind, label] of KINDS) {
        for (const e of c.memory?.entries ?? []) {
            if (e.kind !== kind || fold(e.text) === "") {
                continue;
            }
            const why = kind === "ruledout" ? fold(e.why) : "";
            settled.push(`${label}: ${fold(e.text)}${why !== "" ? ` (why: ${why})` : ""}`);
        }
    }
    if (settled.length === 0) {
        return "";
    }
    const report = c.docpath ? ` (${reportPath(c.docpath, c.project)})` : "";
    return (
        `The council "${fold(c.feature)}"${report} settled this: ${settled.join("; ")}. ` +
        "Bring this project's CLAUDE.md (AGENTS.md if it has no CLAUDE.md) in line with it: fix or remove the lines " +
        "these decisions make outdated, such as a status line, next steps, the direction or an open question, and add " +
        "nothing they do not say. Leave the block between the arc:council-decisions markers alone: arcterm writes it. " +
        "Show me the diff before you commit anything."
    );
}

/** Pure: the agents Update CLAUDE.md can hand its prompt to: the live Claude agent tabs with a terminal whose project
 *  folder (the registry's, else the agent's cwd) is the council's. Another harness's agent is never offered. */
export function docUpdateAgents(
    roster: readonly AgentVM[],
    registry: Readonly<Record<string, { path?: string }>> | null | undefined,
    project: string
): AgentVM[] {
    return roster.filter(
        (a) =>
            !!a.blockId &&
            (a.kind == null || a.kind === "agent") &&
            a.agent === "claude" &&
            sameRepoPath(registry?.[projectOf(a)]?.path || a.cwd || "", project)
    );
}
