// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Entry of the phone page's projector bundle (pkg/remotemode/web/static/projectors.js, built by
// scripts/sync-remote-web.mjs). Import only the two projectors: the bundle must not pull in codex,
// opencode or anything under "@/", which the phone page cannot resolve.

import type { AgentEntry } from "./agentsviewmodel";
import { projectPiTranscript } from "./pitranscriptprojection";
import { projectTranscript } from "./transcriptprojection";

export function projectFor(runtime: string, lines: string[]): AgentEntry[] {
    if (runtime === "claude") {
        return projectTranscript(lines);
    }
    if (runtime === "pi") {
        return projectPiTranscript(lines);
    }
    return [];
}
