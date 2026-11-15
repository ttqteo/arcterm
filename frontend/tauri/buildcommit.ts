// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { spawnSync } from "child_process";

// The commit a frontend bundle is built from, baked in by vite.config.ts as __ARC_COMMIT__, so the app can say which
// build is running: one version number has shipped from several commits (1.0.6 was built nine times).
// scripts/release-build.mjs sets ARC_BUILD_COMMIT to the stamp it names the installer with (`<short>` or
// `<short>-dirty`): its snapshot tree reads dirty after a bump writes package.json, so asking git there would lie.
// Anywhere else (a dev app) git is asked, and a tree with uncommitted edits reads `-dirty`. Empty when git can't say.
export type GitRunner = (args: string[]) => string | null;

export function buildCommit(env: Record<string, string | undefined>, git: GitRunner = runGit): string {
    const given = env.ARC_BUILD_COMMIT?.trim();
    if (given) {
        return given;
    }
    const short = git(["rev-parse", "--short", "HEAD"])?.trim();
    if (!short) {
        return "";
    }
    const status = git(["status", "--porcelain", "--untracked-files=no"]);
    return status != null && status.trim() !== "" ? `${short}-dirty` : short;
}

function runGit(args: string[]): string | null {
    const r = spawnSync("git", args, { cwd: __dirname, encoding: "utf8" });
    return r.status === 0 ? r.stdout : null;
}
