// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Sidecar wall: one tile per agent, fitted by count (spec 2026-11-13-sidecar-design.md, section 3). This is the
// contract stub; Task 7 fills it. The pure shape and fit model goes in sidecarwallmodel.ts, never sidecarwall.ts:
// Vite and TS resolve .ts before .tsx, so a sidecarwall.ts beside this file would break the page's import of it.

import type { SidecarAct, SidecarSnapshot } from "./sidecartypes";

export interface SidecarWallProps {
    snap: SidecarSnapshot;
    // `receivedAt` and `clock` are both Date.now() on the Sidecar page, and only their difference is used: a tile's age
    // is `snap.now + (clock - receivedAt) - tile.since`. `receivedAt` is when `snap` arrived; `clock` is bumped every 30 s.
    receivedAt: number;
    clock: number;
    send: (act: SidecarAct) => void;
}

/** TODO(Task 7): the wall. For now it only says how many tiles there are. */
export function SidecarWall(props: SidecarWallProps) {
    return <div data-sidecar-wall data-tiles={props.snap.tiles.length} />;
}
