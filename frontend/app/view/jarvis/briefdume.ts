// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Brief header's DUM-E line: what DUM-E last decided, or the chunk it works, and how many of its branches wait
// for you to land them. Shown only while dume:enabled is on (the setting, read live, is the switch; the status can
// lag it by a tick). Pure.

export function dumeLine(s: DumeStatusData | null, enabled: boolean): string | null {
    if (!enabled || !s) {
        return null;
    }
    const head = s.running ? `working: ${s.running.chunk}` : s.reason || "not checked yet";
    const toLand = s.toland?.length ?? 0;
    return `DUM-E · ${head}${toLand > 0 ? ` · ${toLand} to land` : ""}`;
}
