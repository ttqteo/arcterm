// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Which pieces of meta an agent row in the sidebar shows (Settings → Appearance → Agent sidebar): its model, a branch
// other than the default, the RAM its processes hold, its tokens and its age. All on by default; turning one off only
// hides it from the row, the rail still has it.

export const ROW_FIELDS = ["model", "branch", "ram", "tokens", "age"] as const;
export type RowField = (typeof ROW_FIELDS)[number];
export type RowFields = Record<RowField, boolean>;

export const DEFAULT_ROW_FIELDS: RowFields = { model: true, branch: true, ram: true, tokens: true, age: true };

/** Pure: a stored value read back; a field that is missing or not a boolean takes its default. */
export function rowFieldsOf(raw: unknown): RowFields {
    const src = raw != null && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const out = { ...DEFAULT_ROW_FIELDS };
    for (const f of ROW_FIELDS) {
        if (typeof src[f] === "boolean") {
            out[f] = src[f] as boolean;
        }
    }
    return out;
}

// The Agent tree's width: 248px, widened to 280px only while all three number columns (RAM · tokens · age, rowcols.ts)
// are on, the one layout that leaves line 2 too little room for its words at 248px. Turning a column off gives the room back.
export const AGENT_TREE_NARROW_PX = 248;
export const AGENT_TREE_WIDE_PX = 280;

/** Pure: the Agent tree's width in px for the fields the person keeps on. */
export function agentTreeWidth(fields: Pick<RowFields, "ram" | "tokens" | "age">): number {
    return fields.ram && fields.tokens && fields.age ? AGENT_TREE_WIDE_PX : AGENT_TREE_NARROW_PX;
}

/** The Settings row of each field: its id, title and what it shows. */
export const ROW_FIELD_ROWS: { field: RowField; id: string; title: string; desc: string }[] = [
    { field: "model", id: "appearance.rowmodel", title: "Model", desc: "The model each agent runs, under its name." },
    {
        field: "branch",
        id: "appearance.rowbranch",
        title: "Branch",
        desc: "The git branch an agent works on, when it is not the default one.",
    },
    {
        field: "ram",
        id: "appearance.rowram",
        title: "RAM",
        desc: "The memory an agent and the commands it runs hold now.",
    },
    {
        field: "tokens",
        id: "appearance.rowtokens",
        title: "Tokens",
        desc: "Tokens its session has used so far, cache reads included.",
    },
    {
        field: "age",
        id: "appearance.rowage",
        title: "Age",
        desc: "How long since it last changed state, or how long it has slept.",
    },
];
