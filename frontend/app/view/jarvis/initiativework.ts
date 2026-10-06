// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Working on an initiative from the Brief. Most sessions on an initiative used to open with a typed-out
// "check the <name> initiative, where are we"; Work on sends that prompt itself, and when an agent linked
// to the initiative is still open the Brief sends you back to it rather than starting a second session.
// Pure: no React, no Wave runtime imports.

import { formatAgeShort, type AgentVM } from "@/app/view/agents/agentsviewmodel";

const pad = (n: number) => String(n).padStart(2, "0");

// "09-29 16:17": the stamp `wsh effort show` prints on every note, so the prompt and the note agree
export function noteStamp(ts: number): string {
    const d = new Date(ts);
    return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function workOnPrompt(title: string, effortOid: string, lastNote?: { ts: number }): string {
    const base = `check the initiative ${title} (effort:${effortOid}), where are we`;
    return lastNote != null ? `${base}. Pick up from the newest note (${noteStamp(lastNote.ts)}).` : base;
}

const STATE_RANK: Record<AgentVM["state"], number> = { asking: 0, working: 1, idle: 2 };

// A run's agents answer to their run, and a terminal is not an agent session: neither is "the session on
// this initiative". Among the rest, the one that needs you, then the busy one, then the most recently idle.
export function openAgentFor(effortOid: string, agents: AgentVM[]): AgentVM | undefined {
    return agents
        .filter((a) => a.effortId === effortOid && a.runId == null && a.kind !== "terminal")
        .sort((a, b) => STATE_RANK[a.state] - STATE_RANK[b.state] || (b.idleSince ?? 0) - (a.idleSince ?? 0))[0];
}

export type InitiativeResume =
    | { kind: "go"; agentId: string; status: string }
    | { kind: "work"; status: string; when: string; note: string };

export function initiativeResume(
    effortOid: string,
    lastNote: { ts: number; text: string } | undefined,
    agents: AgentVM[],
    now: number
): InitiativeResume {
    const open = openAgentFor(effortOid, agents);
    if (open != null) {
        const how = open.state === "idle" ? `idle ${formatAgeShort(now - (open.idleSince ?? now))}` : open.state;
        return { kind: "go", agentId: open.id, status: `open · ${how}` };
    }
    if (lastNote == null) {
        return { kind: "work", status: "no notes yet", when: "", note: "" };
    }
    return { kind: "work", status: "last note", when: noteStamp(lastNote.ts), note: lastNote.text };
}

// wshserver_effort.go stamps every new effort with this note, so it says nothing about where work was left
const CREATED_NOTE = "effort created";

// Whether the resume line has anything to say beyond "nobody has touched this": no agent open on it, and no
// note but the creation stamp. An idea's row drops such a line rather than repeating it on every idea.
export function resumeIsBlank(resume: InitiativeResume): boolean {
    return resume.kind === "work" && (resume.note === "" || resume.note === CREATED_NOTE);
}

// The Agent header's link back to the initiative. A session launched from it is already named after it, so
// the link then says only "initiative" rather than the title twice. No progress: the header reads the
// initiative once, and a count would go stale while the agent works on it.
export function initiativeLinkText(agentName: string, effort: { title: string } | undefined): string {
    return effort == null || effort.title === agentName ? "◇ initiative" : `◇ ${effort.title}`;
}

// an initiative names its project; the project registry holds the folder an agent starts in
export function projectPathFor(project: string | undefined, registry: Record<string, { path?: string }>): string {
    return (project && registry[project]?.path) || "";
}
