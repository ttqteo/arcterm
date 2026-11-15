// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// How a list of councils (councilstore's councilListAtom) takes one council that changed, without reading the list again.

import { councilProjectKey } from "./councilmodel";

/** Pure: what `CouncilListCommand` would now answer for `project` ("" is every project), given `list`, its last answer,
 *  and `c`, a council as it is now: the list without `c` (by id), then `c` back in if it belongs (`project` is "" or its
 *  own, and it is not a bench council, which the list command leaves out while `CouncilGetCommand` still answers it) at
 *  the place the server's order gives: `updated` newest first, then `id` ascending (council.List). A save stamps
 *  `updated`, so a changed council moves; it never keeps its old slot. A list `c` neither is in nor belongs to comes back
 *  as it was, the same array. */
export function spliceCouncil(list: Council[], c: Council, project: string): Council[] {
    const listed = list.some((x) => x.id === c.id);
    const belongs = !c.bench && (project === "" || councilProjectKey(c.project) === councilProjectKey(project));
    if (!listed && !belongs) {
        return list;
    }
    const rest = list.filter((x) => x.id !== c.id);
    if (!belongs) {
        return rest;
    }
    const at = rest.findIndex((x) => c.updated > x.updated || (c.updated === x.updated && c.id < x.id));
    return at < 0 ? [...rest, c] : [...rest.slice(0, at), c, ...rest.slice(at)];
}
