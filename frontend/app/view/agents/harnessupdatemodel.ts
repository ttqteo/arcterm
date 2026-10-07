// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Pure: a harness's row in Settings → About, from what ListHarnesses says (installed version, the latest release the
// update check saw) and the update the user started, if any. No React.

export interface UpdateRun {
    status: "running" | "done" | "failed";
    version?: string; // done: the version it left installed
    error?: string; // failed: the updater's last line
}

export type HarnessRowState =
    | { kind: "current"; version: string }
    | { kind: "available"; version: string; latest: string }
    | { kind: "updating"; version: string; latest?: string }
    | { kind: "updated"; version: string }
    | { kind: "failed"; version: string; latest?: string; error: string };

const X_Y_Z = /(\d+)\.(\d+)\.(\d+)/;

export function shortVersion(v: string | undefined): string {
    return X_Y_Z.exec(v ?? "")?.[0] ?? v ?? "";
}

function newer(latest: string, installed: string): boolean {
    const l = X_Y_Z.exec(latest);
    const i = X_Y_Z.exec(installed);
    if (l == null || i == null) {
        return false;
    }
    for (let k = 1; k <= 3; k++) {
        if (Number(l[k]) !== Number(i[k])) {
            return Number(l[k]) > Number(i[k]);
        }
    }
    return false;
}

export function harnessRowState(h: HarnessInfo, run: UpdateRun | undefined): HarnessRowState | null {
    if (!h.installed) {
        return null;
    }
    const version = shortVersion(h.version);
    const latest = h.latestversion && newer(h.latestversion, version) ? h.latestversion : undefined;
    if (run?.status === "running") {
        return { kind: "updating", version, latest };
    }
    if (run?.status === "done") {
        return { kind: "updated", version: run.version || version };
    }
    if (run?.status === "failed") {
        return { kind: "failed", version, latest, error: run.error ?? "Update failed" };
    }
    return latest ? { kind: "available", version, latest } : { kind: "current", version };
}

export function rowLabel(s: HarnessRowState): string {
    switch (s.kind) {
        case "current":
            return s.version;
        case "available":
            return `${s.latest} available`;
        case "updating":
            return "Updating…";
        case "updated":
            return `Updated to ${s.version} · new sessions use it`;
        case "failed":
            return s.error;
    }
}
