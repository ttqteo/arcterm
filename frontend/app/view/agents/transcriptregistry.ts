// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Transcript projection registry: maps a coding agent to the pure projector for its transcript
// format. AgentEntry[] is the shared, format-neutral contract every consumer renders, so adding a
// new agent (e.g. opencode) is a new projector file + one entry here + its tests — nothing else.

import type { AgentEntry, CardTask } from "./agentsviewmodel";
import { extractAgyTitle, projectAgyTranscript } from "./agytranscriptprojection";
import { extractCodexTasks, projectCodexTranscript } from "./codextranscriptprojection";
import { extractOpencodeTitle, projectOpencodeTranscript } from "./opencodetranscriptprojection";
import { extractPiTasks, extractPiTitle, projectPiTranscript } from "./pitranscriptprojection";
import { extractAiTitle, extractTasks, projectTranscript } from "./transcriptprojection";

export interface TranscriptProjector {
    project(lines: string[]): AgentEntry[];
    // optional because title derivation is format-specific and not yet implemented for every agent
    extractTitle?(lines: string[]): string | undefined;
    // optional because a card task list needs a TodoWrite-equivalent; Codex maps its update_plan
    extractTasks?(lines: string[]): CardTask[] | undefined;
}

const PROJECTORS: Record<string, TranscriptProjector> = {
    claude: { project: projectTranscript, extractTitle: extractAiTitle, extractTasks },
    codex: { project: projectCodexTranscript, extractTasks: extractCodexTasks },
    opencode: { project: projectOpencodeTranscript, extractTitle: extractOpencodeTitle },
    pi: { project: projectPiTranscript, extractTitle: extractPiTitle, extractTasks: extractPiTasks },
    agy: { project: projectAgyTranscript, extractTitle: extractAgyTitle },
};

const DEFAULT_AGENT = "claude";

// Fallback when the agent identity is missing/unknown: infer the format from the transcript path.
// Among the rest `.claude` is checked first because a Claude transcript path always contains it but may also
// contain `.codex` (e.g. Claude working on codex tooling); a Codex rollout path never contains
// `.claude`, so this ordering disambiguates correctly. Separators are normalized to `/` before
// matching so a Windows `.pi/agent/sessions/` path resolves the same as a POSIX one. agy's brain
// path (`.gemini/antigravity-cli/brain/<id>/`) names no project, so it is tested before all of these.
export function agentFromPath(path?: string): string | undefined {
    if (!path) {
        return undefined;
    }
    const norm = path.replace(/\\/g, "/");
    if (norm.includes("/antigravity-cli/brain/")) {
        return "agy";
    }
    if (norm.includes(".claude")) {
        return "claude";
    }
    if (norm.includes(".codex")) {
        return "codex";
    }
    if (norm.includes("/.pi/agent/sessions/")) {
        return "pi";
    }
    if (norm.includes("opencode")) {
        return "opencode";
    }
    return undefined;
}

/** Pure: pick the projector for an agent. The explicit agent identity wins; the transcript path is
 *  a resilience fallback; anything unrecognized defaults to Claude. Never returns undefined. */
export function projectorFor(agent?: string, transcriptPath?: string): TranscriptProjector {
    const key = (agent && PROJECTORS[agent] ? agent : undefined) ?? agentFromPath(transcriptPath) ?? DEFAULT_AGENT;
    return PROJECTORS[key] ?? PROJECTORS[DEFAULT_AGENT];
}

/** Resolve roster identity without defaulting an unidentified session to Claude. */
export function resolveAgentIdentity(
    agent?: string,
    launchedAgent?: string,
    transcriptPath?: string
): string | undefined {
    return agent || launchedAgent || agentFromPath(transcriptPath);
}
