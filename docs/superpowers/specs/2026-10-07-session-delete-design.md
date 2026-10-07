# Delete an ended session — design

Status: design settled 2026-10-07.

## Problem

Conversation History and the Agent sidebar's ended sessions fill up with throwaway sessions (a question
unrelated to the project). An ended session offers only Resume and Open session
(`frontend/app/cockpit/actions/session.ts`); nothing removes one. Claude Code's own `cleanupPeriodDays`
(default 30 days) deletes old transcripts eventually, but not on demand.

## Decisions

1. **Delete moves to a trash, kept 7 days.** Deleting an ended Claude session moves its transcript
   (`<projects dir>/<project>/<id>.jsonl`) and, when present, its sibling `<id>/` directory (subagents,
   tool-results) into `~/.arc/trash/<unix-ms>-<id>/`, keeping the original path in a `meta.json`.
   wavesrv purges trash entries older than 7 days at start and once a day. Restoring is by hand for now
   (move the files back); a Restore UI is out of scope.
2. **Only ended sessions.** The server refuses a session whose transcript a live agent is writing (an open
   tab's block has it as `agent:transcriptpath`, or the file changed in the last 2 minutes) and says why.
3. **Claude sessions only.** pi and other runtimes keep their sessions; the action is hidden for them.
4. **Confirm first.** The action opens ConfirmModal: "Xoá session '<task>'? Transcript được chuyển vào
   ~/.arc/trash và xoá hẳn sau 7 ngày; session sẽ không còn trong claude --resume." After it, the archive
   reloads so the row disappears.
5. **Usage history shrinks with it.** Usage totals are computed from transcripts, so a deleted session's
   tokens leave them. Accepted: a throwaway session's share is negligible; the dialog does not mention it.

## Surface

- RPC `DeleteAgentSessionCommand({ transcriptpath })` in `pkg/wshrpc/wshrpctypes_agents.go`; the path must
  resolve inside the Claude projects dir (`~/.claude/projects`, or `CLAUDE_CONFIG_DIR/projects`) and end
  in `.jsonl`, else it is refused.
- A `session:delete` action ("Xoá session") next to Resume and Open session, shown in Conversation
  History and on an ended session in the Agent sidebar.

## Testing

- Go: path validation (outside the projects dir, not `.jsonl`, `..` segments), the live-session refusal,
  the move with the sibling directory, and the purge by age, against a temp dir.
- vitest: the action's visibility (ended Claude session only) as a pure function.
