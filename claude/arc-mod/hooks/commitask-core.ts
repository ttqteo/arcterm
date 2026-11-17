// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// arcterm's Chat draws an ```arc-commit block as an editable commit card (frontend/app/view/agents/chatcommit.ts). A
// skill reaches claude only through its description, and at the moment the block is needed claude is following the
// repo's rules about asking before a commit, not looking for an arcterm skill. So each of the person's prompts inside
// arcterm carries a line saying so: whole the first time, short after that, as the skim mod's Highlighting line does.

export const COMMIT_ASK_CONTEXT =
    "Commit asks in arcterm: when you are about to stop and ask the person before committing (the repo's rules want " +
    "their approval), write the suggestion as an ```arc-commit block instead of prose: the message (in the repo's " +
    "format), a line that is exactly `---`, then one path per line, relative to your working directory; then end the " +
    "turn. Chat draws it as an editable commit card, and its Commit button sends you the exact message and files to " +
    "commit. The arc:commit skill has the details.";

export const COMMIT_ASK_REMINDER =
    "If you are about to ask before committing, write an arc-commit block instead (arc:commit).";

export interface CommitAskState {
    isActive: boolean;
    isInteractive: boolean;
    isCommand: boolean;
    // the prompt is the person's turn, not a peer's message, a subagent's hand-back or a background report
    isPersonTurn: boolean;
    hasTold: boolean;
}

// the context the submitted prompt carries, or null: only inside arcterm, only on an interactive session's own turns,
// never on a command
export function commitAskContext(s: CommitAskState): string | null {
    if (!s.isActive || !s.isInteractive || s.isCommand || !s.isPersonTurn) {
        return null;
    }
    return s.hasTold ? COMMIT_ASK_REMINDER : COMMIT_ASK_CONTEXT;
}
