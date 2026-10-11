// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Usage surface's Subagent cost card (Claude tab): what finished subagents of each type cost over the last 30
// days (GetSubagentCostsCommand). These rows price the Token burn card (pkg/tokengate Price): a type with
// TYPE_SAMPLES or more prices its own agents, the every-type row the rest once it has ALL_SAMPLES.

import { fmt } from "./usagestats";

export const TYPE_SAMPLES = 3;
export const ALL_SAMPLES = 5;

export interface CostRow {
    type: string;
    label: string; // the type, or "All types" for the every-type row
    samples: number;
    avg: string; // "2.8M"
    range: string; // p25 to p90, "300K–6.1M"
    all: boolean;
    prices: boolean; // whether the Token burn card prices from this row
}

export function costRows(costs: SubagentCostData[]): CostRow[] {
    return costs.map((c) => {
        const all = c.type === "all";
        return {
            type: c.type,
            label: all ? "All types" : c.type,
            samples: c.samples,
            avg: fmt(c.mean),
            range: `${fmt(c.p25)}–${fmt(c.p90)}`,
            all,
            prices: c.samples >= (all ? ALL_SAMPLES : TYPE_SAMPLES),
        };
    });
}
