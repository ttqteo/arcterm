// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Claude Code stores transcripts at <home>/.claude/projects/<encoded-cwd>/<id>.jsonl,
// where <encoded-cwd> is the working directory with path separators replaced by '-'.
// The friendly project label is the last '-' segment (the repo dir). Best-effort: a
// repo dir containing a literal '-' will be clipped to its final token (display only).
// A worktree nested in a checkout (an engine task's .waveterm/worktrees/<run>-t-1, .claude/worktrees/<name>,
// .worktrees/<name>) is named for that checkout, not for its own last token ("1").
const NESTED_WORKTREE = /--(?:waveterm-|claude-)?worktrees-/;

export function projectNameFromTranscriptPath(path: string): string {
    if (!path) {
        return "";
    }
    const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
    const projIdx = parts.lastIndexOf("projects");
    if (projIdx < 0 || projIdx + 1 >= parts.length) {
        return "";
    }
    const segs = parts[projIdx + 1].split(NESTED_WORKTREE)[0].split("-").filter(Boolean);
    return segs[segs.length - 1] ?? "";
}
