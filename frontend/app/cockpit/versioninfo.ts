// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { atom } from "jotai";

export type VersionInfo = {
    // this shell, from tauri.conf.json (synced from package.json by scripts/sync-tauri-version.mjs)
    app: string;
    // the wavesrv this shell spawned, read off its WAVESRV-ESTART line
    server: string;
    buildTime: number;
    platform: string;
    // the commit the frontend was bundled from (frontend/tauri/buildcommit.ts), "" when unknown
    commit: string;
    mismatch: boolean;
};

export const UNKNOWN_VERSION = "unknown";

declare const __ARC_COMMIT__: string | undefined;

// Baked in by vite.config.ts; absent under vitest, which bundles nothing.
export const BUILD_COMMIT: string = typeof __ARC_COMMIT__ === "string" ? __ARC_COMMIT__ : "";

// The two versions are stamped by different build steps — `cargo tauri build` bakes the shell's,
// `task build:backend` passes -X main.WaveVersion to the Go binaries — so a stale dist/bin runs an
// old wavesrv under a new shell. That failure surfaces as new wshrpc commands route-erroring, with
// nothing on screen saying why; derive the comparison so the UI can say it.
export function deriveVersionInfo(
    appVersion: string,
    serverVersion: string,
    buildTime: number,
    platform: string,
    commit = ""
): VersionInfo {
    const app = normalizeVersion(appVersion);
    const server = normalizeVersion(serverVersion);
    return {
        app: app || UNKNOWN_VERSION,
        server: server || UNKNOWN_VERSION,
        buildTime: Number.isFinite(buildTime) && buildTime > 0 ? buildTime : 0,
        platform: platform || UNKNOWN_VERSION,
        commit: (commit ?? "").trim(),
        // an absent version is a backend that never reported, not a disagreement — claiming a
        // mismatch there would fire on every slow or failed start.
        mismatch: app !== "" && server !== "" && app !== server,
    };
}

// wavesrv reports a bare "0.14.5" but callers elsewhere prefix a v; compare the numbers, not the
// punctuation.
function normalizeVersion(v: string): string {
    return (v ?? "").trim().replace(/^v/i, "");
}

// BuildTime is stamped as %Y%m%d%H%M (Taskfile build:server:internal), not a unix timestamp.
export function formatBuildTime(buildTime: number): string {
    const s = String(buildTime);
    if (!/^\d{12}$/.test(s)) {
        return buildTime > 0 ? s : UNKNOWN_VERSION;
    }
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)} ${s.slice(8, 10)}:${s.slice(10, 12)}`;
}

// Module-level: every surface but Agent unmounts on a nav switch, and boot seeds this exactly once.
export const versionInfoAtom = atom<VersionInfo>(deriveVersionInfo("", "", 0, ""));
