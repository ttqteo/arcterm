// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Whether two transcript paths name the same session. Pure, no Wave runtime imports.

function norm(p: string): string {
    return p.replace(/\\/g, "/").toLowerCase();
}

/** Pure: true when a and b are one session's transcript: the same path written either way, or the same file name in
 *  another folder. A session synced from another computer, and a council file synced with it, carry that machine's
 *  path, which names a folder this disk does not have; the file name (claude's session id, pi's and codex's
 *  timestamped id) is the same on both. */
export function sameTranscript(a: string, b: string): boolean {
    if (a === "" || b === "") {
        return false;
    }
    const x = norm(a);
    const y = norm(b);
    return x === y || x.slice(x.lastIndexOf("/") + 1) === y.slice(y.lastIndexOf("/") + 1);
}
