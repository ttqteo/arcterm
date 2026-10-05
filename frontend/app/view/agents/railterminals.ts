// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Which terminals the details rail's Terminals section lists. A terminal belongs to the project it was launched in
// (session:project); the rail shows the focused item's project's, and a toggle shows the rest, so a project that
// has terminals but no agent is never unreachable (projectFocusTarget is the project banner's half of that). A terminal
// that names no project shows everywhere. Pure.

import { projectOf, type AgentVM } from "./agentsviewmodel";

export interface RailTerminals {
    rows: AgentVM[]; // what the section lists, in the roster's order
    other: number; // terminals that belong to another project, whether or not they are listed
    // rows is narrowed to the project. True whenever a project narrowed the list, even when nothing was hidden
    // (other === 0), so the show-other-projects toggle must be gated on other > 0.
    scoped: boolean;
}

export function railTerminals(terminals: AgentVM[], project: string, showAll: boolean): RailTerminals {
    if (project === "") {
        return { rows: terminals, other: 0, scoped: false };
    }
    const mine = terminals.filter((t) => {
        const p = projectOf(t);
        return p === "" || p === project;
    });
    const other = terminals.length - mine.length;
    return showAll ? { rows: terminals, other, scoped: false } : { rows: mine, other, scoped: true };
}

// Where the Agent surface's "Show the project" button goes: the project's first agent, else its first terminal. A
// project can have terminals and no agent, and the button must not be dead for it.
export function projectFocusTarget(agents: AgentVM[], terminals: AgentVM[], project: string): AgentVM | undefined {
    return agents.find((a) => projectOf(a) === project) ?? terminals.find((t) => projectOf(t) === project);
}
