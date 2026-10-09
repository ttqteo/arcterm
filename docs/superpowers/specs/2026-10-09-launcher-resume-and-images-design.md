# New agent launcher: resume a session, paste images into the task

Two additions to the agent half of the New launcher (`launchermodal.tsx`, `launcheragentfields.tsx`; base design
`2026-10-08-new-launcher-design.md`): pick one of the picked agent's recent sessions in the picked project and resume
it, and paste or drop images into the Task box.

## Resume a session

**Data.** On open the dialog calls `GetRecentSessionsCommand` once (14 days, limit 50). The backend scan already
covers claude, codex, opencode, pi and agy. The frontend keeps the sessions whose runtime is the picked runtime and
whose `projectpath` is the picked project's path (`\` → `/`, case-insensitive), newest first, at most 5. No Go change.
A project used rarely enough to fall outside the 50 newest sessions shows none; a `projectpath` filter on the RPC is
the fix if that bites.

**UI.** A "Resume" section between Task and Command, shown only for a runtime that resumes (not Terminal) and only when
the project has at least one session. Its first row is **New session** (the default); then one row per session: a radio
dot, the task title (or "(untitled session)"), branch, age and tokens, styled like `agentlaunchhero.tsx`'s list.
Keyboard: Tab into the list, ↑↓ to move, Enter to launch. Digits 1–9 stay with the project column.

**With a session picked:**

- The launch button reads **Resume agent**; the footer reads "Resumes <title> · <branch>".
- Command shows the session's `resumecommand`; pi launches with `startupArgs: resumeargs` and `resumePath`, as the hero
  does. Enabled flags still apply.
- The Task label reads "optional · sent as the next message"; a task given is appended after the resume directive, so
  the agent receives it as a new message in the old session.
- The worktree toggle is hidden: the session runs in its own cwd.

**State.** `launcherResumeAtom` (session id or null) in `launcherstore.ts`. It resets when the runtime or project
changes and is cleared by `endLauncherDraft`.

**Pure logic** in `launcherresume.ts` with `launcherresume.test.ts`: `resumeChoices(sessions, runtime, projectPath)`
and `resumeLaunchSpec(session, task, flags)`.

## Paste images into the task

**Input.** Only for runtimes that show the Task box (Claude, Codex, Antigravity).

- Ctrl+V: `onPaste` looks for image items in `clipboardData`. With images it prevents the default, writes each with
  `createTempFileFromBlob`, and still inserts any text the clipboard also carried. Without images the paste is
  untouched.
- Drop: image files dropped on the Task box go through `createTempFileFromFile`; other files are ignored.
- At most 8 images.

**Display.** A row of 48px thumbnails under the textarea (`URL.createObjectURL` previews), each with an ✕. An image
still writing shows a spinner and holds the launch button until it lands. A failed write (over 3.5 MB, unsupported
type) shows one `text-warning` line under the box, like the RAM warning.

**State.** `launcherImagesAtom` (`{id, path?, previewUrl, error?}[]`) in `launcherstore.ts`, so images survive a close
like the rest of the draft. `clearLauncherDraft` / `endLauncherDraft` empty it and revoke the preview URLs.

**At launch**, by runtime:

- Codex: its native `--image <p1>,<p2>` placed after the task prompt (the option is variadic and would swallow a prompt
  that followed it). A path containing a comma falls back to the text block below.
- Claude and Antigravity: a block appended to the task, which the agent reads with its file tools:
  ```
  Attached images:
  - C:\…\waveterm_paste_….png
  ```
- An empty task with images sends only the block.
- Resuming a session: the images ride the next message the same way.

**Pure logic** in `launcherimages.ts` with `launcherimages.test.ts`: `imageFilesFromClipboard`, `imageFilesFromDrop`,
`composeTaskWithImages(runtime, task, paths)` → task text plus extra args, and the image cap.

## Verification

Unit tests for both pure modules. The rendered dialog is checked on the dev app over CDP (a resume list with a session
picked, and the thumbnail row), not with a release build.

## Changelog

`Added`: "New agent: paste or drop images into the task, and resume a recent session of the picked agent and project."
