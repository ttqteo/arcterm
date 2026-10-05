// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Which terminals the details rail's Terminals section lists. A terminal belongs to the project it was launched in
// (session:project); the rail shows the focused item's project's, and a toggle shows the rest, so a project that
// has terminals but no agent is never unreachable. A terminal that names no project shows everywhere. Pure.

import { projectOf, type AgentVM } from "./agentsviewmodel";

export interface RailTerminals {
    rows: AgentVM[]; // what the section lists, in the roster's order
    other: number; // terminals that belong to another project, whether or not they are listed
    scoped: boolean; // rows is narrowed to the project
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
