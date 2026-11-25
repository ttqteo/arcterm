// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// releases/ keeps only the newest installers: each one is 30-50 MB, and a day of builds left 490 MB there. `task
// install` installs from src-tauri/target, never from releases/, so an older copy here is only an older build to go
// back to. release-build.mjs calls pruneReleases after it copies an installer.

import { readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

// how many installers releases/ keeps: the one just built and two to go back to
export const KEEP_RELEASES = 3;

const INSTALLER = /^arcterm_.+\.(exe|dmg)$/;

// Pure: the installers to delete, given releases/'s files with their mtimes: every installer past the `keep` newest.
// Other files are never touched, and `keepName` (the one just built) is kept whatever its mtime says.
export function releasesToDrop(files, keep = KEEP_RELEASES, keepName = null) {
    const installers = files.filter((f) => INSTALLER.test(f.name)).sort((a, b) => b.mtimeMs - a.mtimeMs);
    const kept = new Set(installers.slice(0, keep).map((f) => f.name));
    if (keepName != null && !kept.has(keepName) && installers.some((f) => f.name === keepName)) {
        // the new build wins over the oldest of the kept ones
        const oldest = installers.slice(0, keep).at(-1);
        if (oldest) kept.delete(oldest.name);
        kept.add(keepName);
    }
    return installers.filter((f) => !kept.has(f.name)).map((f) => f.name);
}

// delete the old installers from dir; returns the names deleted. A file that cannot go (open in Explorer) is reported
// and left for the next build.
export function pruneReleases(dir, keepName = null, keep = KEEP_RELEASES) {
    const files = readdirSync(dir).map((name) => ({ name, mtimeMs: statSync(join(dir, name)).mtimeMs }));
    const dropped = [];
    for (const name of releasesToDrop(files, keep, keepName)) {
        try {
            rmSync(join(dir, name));
            dropped.push(name);
        } catch (e) {
            console.warn(`releases/${name} not deleted: ${e?.message ?? e}`);
        }
    }
    return dropped;
}
