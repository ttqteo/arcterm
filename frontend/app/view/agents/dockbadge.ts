// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The app icon's badge: what the nav rail's Agent and Jarvis badges count, added up, so a glance at the Dock says
// whether arcterm has something for you without bringing it forward.

/** Pure: the agents with a turn you have not looked at, plus what the channels wait on you for. undefined clears it. */
export function dockBadgeCount(unreadAgents: number, jarvisWaiting: number): number | undefined {
    const n = unreadAgents + jarvisWaiting;
    return n > 0 ? n : undefined;
}
