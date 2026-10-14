// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The app icon's badge: what the nav rail's Agent, Cockpit and Jarvis badges count, added up, so a glance at the Dock
// says whether arcterm has something for you without bringing it forward.

/** Pure: the agents with a turn you have not looked at, plus what waits on you (Cockpit, Jarvis). undefined clears it. */
export function dockBadgeCount(unreadAgents: number, cockpitWaiting: number): number | undefined {
    const n = unreadAgents + cockpitWaiting;
    return n > 0 ? n : undefined;
}
