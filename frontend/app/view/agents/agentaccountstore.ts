// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The Claude account word of each open agent (agentaccountbadge.ts), read by the chat footer and the sidebar rows. It
// reads the roster the sidebar draws (devRosterAtom: the live one, or a dev fixture standing in for it).

import { atom, useAtomValue } from "jotai";
import { selectAtom } from "jotai/utils";
import { useMemo } from "react";
import { agentAccountBadges, type AccountBadge } from "./agentaccountbadge";
import { devRosterAtom } from "./devmock";
import { activeClaudeAccountAtom, claudeIdentityAtom } from "./ratelimitstore";

export const agentAccountBadgesAtom = atom((get) =>
    agentAccountBadges(get(devRosterAtom), get(claudeIdentityAtom), get(activeClaudeAccountAtom))
);

function sameBadge(a: AccountBadge | undefined, b: AccountBadge | undefined): boolean {
    return a?.text === b?.text && a?.title === b?.title;
}

// One agent's badge, or undefined while there is nothing to tell apart; a change to another agent's badge does not
// redraw this one.
export function useAccountBadge(agentId: string): AccountBadge | undefined {
    const a = useMemo(() => selectAtom(agentAccountBadgesAtom, (all) => all[agentId], sameBadge), [agentId]);
    return useAtomValue(a);
}
