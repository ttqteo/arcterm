# Report an arcterm bug on the spot, Jarvis handles them in one pass

Date: 2026-11-19. Brainstorm: `.superpowers/brainstorm/bug-report/brainstorm.json`. Mockup:
`.superpowers/design/bug-report/project/B-footer.dc.html` (absolute: `D:\work\arcterm\.superpowers\design\bug-report\project\B-footer.dc.html`).

## Why

On 2026-11-19 the suggested-reply chips did not show after a turn, and nothing could say why: the installed app logs
nothing on the chatsuggest path, and by the time the person described it the state was gone. A bug seen in arcterm
should be caught where it happens, with what the app looked like and what it logged, and handled later in one pass.

## Scope

Only bugs in arcterm itself: a chip that does not show, a button that does nothing, something drawn wrong, something
slow. An agent behaving badly and bugs in other projects are out of scope.

## The button and its box

- A bug icon button (lucide `Bug`), no text, in the footer's right group (`frontend/app/cockpit/footerstatus.tsx`),
  beside `?` and the version. Tooltip: "Báo lỗi arcterm · Ctrl+Alt+R" (the shortcut drawn from the binding).
- Also opened by a new global binding, `Ctrl+Alt+R` (`Ctrl+Shift+B` is taken by `agent:view-chord`), defined in
  `frontend/app/store/keybindings/bindings.ts` and listed in `docs/keyboard-shortcuts.md`, and by a palette entry
  "Báo lỗi arcterm".
- On press, the app first captures the window, then opens a small box above the button (from the shortcut or palette:
  the same box), so the box is never in the picture. The box, as the board draws it: title "Báo lỗi arcterm", the count
  waiting for Jarvis at its right ("3 đang chờ Jarvis"), a thumbnail of the capture, a text box "Chuyện gì sai?", the
  line "Kèm ảnh chụp cửa sổ lúc bấm và log 5 phút cuối. Chỉ lưu trên máy này.", and Huỷ / Gửi (Ctrl+Enter sends). Gửi
  with an empty text box is not allowed. Esc or Huỷ closes it and keeps nothing.
- Styling follows `DESIGN.md`: the box is an overlay, so it takes the `frost` utility; colours come from tokens.

## What a report holds

Captured at the press, automatically:

- **A screenshot of the window**, through the Tauri command `capture_webview` (`src-tauri/src/canvas.rs`; already used by
  the canvas's Copy screenshot, `frontend/app/view/agents/canvassend.ts`). It works on Windows and macOS; elsewhere the
  report is kept without a picture.
- **The last 5 minutes of the log**: the lines of `waveapp.log` in the data dir (wavesrv stderr, frontend `fe-log`,
  `[tauri]` lines, all timestamped) from 5 minutes before the press, reading `waveapp.1.log` too when the file rolled
  inside that window.
- The person's text, the time, the app version and commit, and the surface and agent in focus.

Not captured: the app's internal state, an agent's transcript.

## Where reports are kept

One folder per report in arcterm's data dir, `reports/<time>/`: `report.json` (text, time, version, commit, surface,
agent), `screen.png`, `log.txt`. Nothing is sent anywhere and nothing goes into git. Once Jarvis has handled a report it
writes the outcome into `report.json` (the run, the initiative, or the question it asked back) and moves the folder to
`reports/done/`; a handled report is deleted after 30 days.

## Jarvis handles them when you press Process

- While reports wait, Jarvis's Waiting on you has one row: "3 báo lỗi arcterm chờ xử lý" with a Xử lý (Process) button.
  The row counts toward Jarvis's badge on the nav rail (`pkg/jarvis/attention.go` computes the list).
- Nothing reads reports on its own: no schedule, no threshold.
- Xử lý opens one Jarvis agent that reads every waiting report in one pass and acts on its own, without a review step:
  it groups reports of the same bug, starts a run that fixes a small one, creates an initiative (with chunks) for a large
  one, and reports back what it did. A report it cannot make sense of (what went wrong or where is unclear) it does not
  guess at: it asks the person back, through the agent's ordinary question, and that report stays `handling` with
  that agent until the person answers (see Report states).
- When it is done the row goes away; each report's outcome can be read in that agent and in its `report.json`.

### The agent, and the repo it works in (Agent's call)

- **The repo.** The agent works in arcterm's own checkout, found among the projects arcterm already knows: the one
  whose root is the arcterm repo (its `Taskfile.yml` and `src-tauri/` beside a `go.mod` naming
  `github.com/wavetermdev/waveterm`). If none matches, the Waiting on you row reads "Không tìm thấy repo arcterm ·
  Chọn thư mục…", the folder picked is kept as a setting, and Process is offered once it is set. Runs and initiatives
  it creates are filed under that project.
- **What the agent is.** A plain Claude agent started with the existing `launchAgent` path (as
  `initiativeworkaction.ts` starts one), in that project, named "Báo lỗi arcterm", with a seeded prompt that lists the
  report folders to read. It shows in the Agent tree under that project like any agent; the person reads its outcome
  in its Chat. Its "question back" is the agent's ordinary turn ending on a question in that Chat (no `wsh ask`).
- **Runs it starts.** Every small fix of one pass goes into one ordinary engine run started with `wsh runs start` in
  that project, its goal listing each fix with its report id, never a run per bug (the person's call, 2026-11-20: a run
  per report was too many runs); a small fix that turns up while that run works waits for it to land. The run has the
  engine's default landing: it lands on `wave/<runId>` and merges back into the base when it completes, held with a
  reason when it cannot, exactly as a run the person starts. A large one becomes an initiative with chunks, no run.

### Report states (Agent's call)

A report is `waiting`, `handling`, or `done`:

- Process claims every `waiting` report for the one agent it starts (`handling`, with that agent's id in
  `report.json`). While any report is `handling`, the Waiting on you row reads "Đang xử lý N báo lỗi · Mở agent" and
  offers no second Process, so two agents never hold the same reports.
- A report the agent asks back about stays `handling` with that same agent: the person answers in its Chat, and the
  agent finishes it. If that agent is closed while it still holds reports, they go back to `waiting`.
- Reports sent while an agent is working stay `waiting`; once nothing is `handling`, the row shows them with Process
  again. The box's "N đang chờ Jarvis" counts `waiting` reports only.
- The agent marks each report `done` with its outcome as it finishes it.

## Left to the builder

- The exact shape of `report.json`.
- Cutting 5 minutes of log by the timestamps in `waveapp.log`, across a roll to `waveapp.1.log`.
- Where "small" (one quick run) ends and "large" (an initiative) begins.
- The prompt the Jarvis agent reads reports with.
- Add one short log line on the chatsuggest path (which way the answer came: the mod or the headless call, how long it
  took, how many chips): it is the first bug that today's log could not explain.

## Checks

- Unit tests for the pure parts: cutting the log window, the report folder's content, the Jarvis attention row.
- A CDP scenario that opens the box from the footer button and from `Ctrl+Alt+R`, checks the thumbnail and the text box,
  sends, and sees the count rise; and one for the Waiting on you row.

## Builder's decisions (2026-11-19, autonomous run)

What the spec left to the builder, and the contracts the parallel tasks share. Each decision says why.

### Store: `pkg/bugreport`

- Root `filepath.Join(wavebase.GetWaveDataDir(), "reports")`; a handled report lives under `reports/done/<id>/`. The
  dev app has its own data dir, so scenarios never touch the packaged app's reports. Why: the spec's folder layout,
  and one package owns every read and write so the wire, the attention row and `wsh` cannot disagree.
- Report id = the folder name: the press time in local time, `20261119-153012`, with `-2`, `-3`… on a collision.
  Why: sortable, readable in a file browser, unique without a counter file.
- `report.json`:
  `{"id","ts" (press time, unix ms),"text","version","commit","surface","agent":{"id","name"} (omitted when none),
  "state":"waiting"|"handling"|"done","handler" (the Jarvis agent's tab id while handling or done),"claimedts",
  "outcome":{"text","runid","effortoid"} (set by done),"donets"}`. `screen.png` is absent when the capture failed.
- Every write of `report.json` is write-temp-then-rename. Why: the cockpit polls while the agent marks reports done.
- Done moves the folder to `reports/done/`. Reports in `done/` whose `donets` is older than 30 days are deleted on each
  Save and each Done (not on the attention poll). Why: the poll runs every few seconds; a save or a done is rare.
- **Agent closed:** Reconcile turns every `handling` report whose handler tab no longer exists in the store back to
  `waiting` (clearing handler and claimedts). Status and the attention gather call it, so it is re-checked on every
  poll, like `LivePendingAsks`. Why: the spec's "if that agent is closed while it still holds reports, they go back".
- Claim takes the agent tab id and the exact ids the prompt listed, and moves only those that are still `waiting`. It
  refuses (error) when any report is already `handling` under a live agent. Why: two agents never hold the same
  reports, and a report sent between the list and the claim stays waiting for the next Process.

### The log window

- `waveapp.log` lines start with the host's local timestamp `2006-01-02 15:04:05.000` (`src-tauri/src/applog.rs`). The
  window is from 5 minutes before the press to the moment of saving (what was logged while the person typed is kept
  too). A line with no parseable timestamp belongs to the line before it (a panic's frames). `waveapp.1.log` is read
  only when `waveapp.log`'s first timestamped line is after the window's start. The cut is a pure function over the
  two files' bytes with the times passed in.
- `log.txt` is capped at 1 MB, keeping the newest lines. Why: a wavesrv panic loop writes ~20 stack traces a second;
  the tail is what explains the press.
- No log file (a browser build, a fresh data dir) is not an error: `log.txt` is written with one line saying so.

### The repo

- `bugreport:repo` (a new setting) wins when set: found iff that folder exists. Otherwise the first project in the
  registry (sorted by name, for determinism) whose path holds `Taskfile.yml`, a `src-tauri/` dir, and a `go.mod`
  whose module line is `github.com/wavetermdev/waveterm`. Why: the spec's rule, with the setting as the person's
  override; a set path that no longer exists must read as "not found" so the person can pick again.
- "Chọn thư mục…" opens the Tauri folder dialog, writes `bugreport:repo`, and when no project is registered at that
  path registers one named after the folder's base name (`CreateProjectCommand`). Why: `launchAgent`, runs and
  initiatives all file under a registered project.

### The Jarvis row (`pkg/jarvis/attention.go`, kind `bug-reports`, key `bug-reports`)

At most one row, last in the list (after councils: nothing is stopped while reports wait):

- some `handling`: Text "Đang xử lý N báo lỗi", Action "Mở agent", ORef `agent:<handler tab id>`.
- else some `waiting`, repo found: Text "N báo lỗi arcterm chờ xử lý", Action "Xử lý", ProjectPath the repo.
- else some `waiting`, no repo: Text "Không tìm thấy repo arcterm", Action "Chọn thư mục…", no ProjectPath.
- nothing waiting or handling: no row. Source is "arcterm"; WaitingSince is the oldest waiting (or claimed) report's ts.

The frontend tells the three apart without a new wire field: ORef `agent:` → Open (label "Mở agent"); empty
ProjectPath → pick-repo; else process. It counts toward the Jarvis badge like any non-ask item (`splitAttention`), and
is not a notifying kind (`DECISION_KINDS` is left alone): nothing is blocked while reports wait.

### Process

- Process: read the waiting reports (`BugReportListCommand`), launch the agent with `launchAgent` in the repo's project
  (the harness preference, as `initiativeworkaction.ts` resolves it, falling back to claude), label "Báo lỗi arcterm",
  then claim those ids for the returned tab id. A failed launch claims nothing; a failed claim is a toast (the agent is
  already open, and its prompt says to stop if `wsh bugreport list --state handling` does not show its reports).
- A DEV-only `window.__bugReportLaunchFake` stands in for `launchAgent` in scenarios, as `__chatSuggestFake` does, so
  no scenario starts a real Claude agent.
- The agent's prompt is a pure function (`bugreportprompt.ts`): the absolute report folders, what each file is, then:
  group reports of the same bug; **small** = one clear cause in one area of the code (a few files), fixed by one run
  → `wsh runs start --mode orchestrator --project <repo> "<goal naming the report ids>"` (the engine's default
  landing, as the spec says); **large** = several areas, a design call, or more than one run's work →
  `wsh effort create "<title>" --project <project> --chunk …`; **unclear** (what went wrong or where cannot be told
  from the text, the picture and the log) → ask the person one question at the end of the turn and leave that report
  `handling`; mark each finished report with `wsh bugreport done <id> --outcome "<one line>" [--run <id>] [--effort
  <oid>]`; finish with a short list of what was done per report. Why the threshold: a run's lead plans one change; work
  that needs splitting or a decision is what initiatives are for.

### `wsh bugreport`

`wsh bugreport list [--state waiting|handling|done] [--json]` and `wsh bugreport done <id> --outcome <text> [--run
<id>] [--effort <oid>]`. Done refuses a report that is not `handling`. Why: the agent marks reports through one tool
rather than editing `report.json` by hand, so the state rules stay in `pkg/bugreport`.

### The box

- Opening: set the box's state to capturing (nothing drawn), `invoke("capture_webview")`, then draw the box with the
  thumbnail; a failed capture opens the box with a "Không có ảnh" placeholder and the report is saved without
  `screen.png`. The surface and the focused agent (`focusIdAtom`, resolved to its name) are read at the press.
- The box is mounted once in `cockpit-root.tsx` (the always-mounted shell), fixed above the footer's right group, with
  `frost`. Pressing the button or the binding while it is open does nothing (no second capture).
- Gửi is disabled until the text has a non-space character; Ctrl+Enter sends; Esc / Huỷ close and drop the capture.
  A failed save keeps the box open with the error under the text box. After a save the box closes and a toast says
  "Đã gửi báo lỗi · N đang chờ Jarvis".
- The binding is `global:bug-report`, keys `Ctrl:Alt:r`, group Help, label "Báo lỗi arcterm" (the palette row is the
  binding's own), working from inside a terminal like Ctrl+Tab. `docs/keyboard-shortcuts.md` lists it.

### The chatsuggest log line

`ChatSuggestCommand` logs one line per answer: `chatsuggest: block=<8 chars> via=mod|headless <ms>ms chips=<n>`, with
`err=<…>` on a failure. Why: the spec's first unexplained bug.
