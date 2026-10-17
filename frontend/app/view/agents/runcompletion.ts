// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Pure view derivations for a run's evidence: duration, size and clock formatting, verification counts and
// whether the evidence still needs sealing. No React, no jotai — unit-tested in runcompletion.test.ts.

export function fmtDuration(ms: number): string {
    const s = Math.max(0, Math.round(ms / 1000));
    const m = Math.floor(s / 60);
    const rem = s % 60;
    if (m === 0) {
        return `${rem}s`;
    }
    return `${m}m ${String(rem).padStart(2, "0")}s`;
}

export function fmtBytes(n: number): string {
    if (n < 1024) {
        return `${n} B`;
    }
    if (n < 1024 * 1024) {
        return `${Math.round(n / 1024)} KB`;
    }
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function fmtClock(tsMs: number): string {
    if (!tsMs) {
        return "—";
    }
    const d = new Date(tsMs);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function verifCounts(v: EvidenceVerif[]): { pass: number; fail: number; unknown: number } {
    const counts = { pass: 0, fail: 0, unknown: 0 };
    for (const item of v ?? []) {
        if (item.result === "pass") counts.pass++;
        else if (item.result === "fail") counts.fail++;
        else counts.unknown++;
    }
    return counts;
}

export function needsEvidenceSeal(run: Run): boolean {
    return run?.status === "done" && !run?.evidence;
}
