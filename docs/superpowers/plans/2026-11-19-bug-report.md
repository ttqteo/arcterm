# Report an arcterm bug on the spot, Jarvis handles them in one pass

**Spec:** `docs/superpowers/specs/2026-11-19-bug-report-design.md` — read its "Builder's decisions" section first: it
holds every contract the tasks share (the `report.json` shape, the states, the Jarvis row's three forms, the `wsh
bugreport` CLI, the box's behaviour).
**Verify:** `node scripts/verify.mjs ./pkg/bugreport ./pkg/jarvis ./pkg/wshrpc/... ./cmd/wsh/...`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs bug-report-box bug-report-jarvis surface-smoke`
**Prototype:** D:\work\arcterm\.superpowers\design\bug-report\project\B-footer.dc.html

Goal: a bug button in the footer (and `Ctrl+Alt+R`, and the palette) captures the window, takes a line of text and
saves a report folder (picture, last 5 minutes of `waveapp.log`, text, version, surface, agent) in the data dir; Jarvis's
Waiting on you shows one row while reports wait, and its Xử lý button starts one Claude agent in arcterm's own repo
that handles every waiting report (a run for a small fix, an initiative for a large one, a question back when unclear).

Architecture: Go owns the reports (`pkg/bugreport`: folder layout, states, log window, repo lookup) behind five wshrpc
commands; `pkg/jarvis/attention.go` turns its status into the one Waiting row; `wsh bugreport` is how the agent marks
reports done. The frontend has two independent halves: the box (footer button, binding, capture, save) and the
Jarvis row's actions (Process launches the agent through `launchAgent`, pick-repo writes the setting).

Shape: Task 1 lands the wire (types, stub handlers, the setting, generated bindings, scenario file stubs). Tasks 2, 3,
4 and 5 then run beside each other.

Lead's notes for every worker:

- UI strings are the Vietnamese ones the spec and the mockup give, verbatim.
- Styling follows `DESIGN.md`: the box is an overlay, so it takes `frost`; colours only from `@theme` tokens
  (`frontend/tailwindsetup.css`), never the mockup's hex values.
- `task generate` is Task 1's alone. No later task changes a wshrpc type; if one finds it must, it stops and says so
  in its report rather than regenerating.
- Pure logic goes in a `foo.ts` with a `foo.test.ts` beside it, consumed by a thin `.tsx` (AGENTS.md, Frontend
  conventions). No jsdom render tests.
- On Windows run a Go test with `CGO_ENABLED=1 CC="zig cc -target x86_64-windows-gnu"` in front (Bash).

### Task 1: The wire: types, stub handlers, the setting, scenario stubs
**Depends on:** none
**Model:** sonnet
**Files:** `pkg/wshrpc/wshrpctypes_bugreport.go`, `pkg/wshrpc/wshrpctypes.go`, `pkg/wshrpc/wshserver/wshserver_bugreport.go`, `pkg/wconfig/settingsconfig.go`, `pkg/wconfig/metaconsts.go`, `schema/settings.json`, `pkg/wshrpc/wshclient/wshclient.go`, `frontend/app/store/wshclientapi.ts`, `frontend/types/gotypes.d.ts`, `docs/guide/settings.md`, `scripts/cdp/scenarios.mjs`, `scripts/cdp/scenarios-bug-report-box.mjs`, `scripts/cdp/scenarios-bug-report-jarvis.mjs`

Every later task builds on these names; keep them exactly.

`pkg/wshrpc/wshrpctypes_bugreport.go`, embedded in `WshRpcInterface` (`wshrpctypes.go`) as `BugReportCommands`:

```go
const (
	BugReportState_Waiting  = "waiting"
	BugReportState_Handling = "handling"
	BugReportState_Done     = "done"
)

type BugReportAgent struct {
	Id   string `json:"id"`
	Name string `json:"name"`
}

type BugReportOutcome struct {
	Text      string `json:"text"`
	RunId     string `json:"runid,omitempty"`
	EffortOID string `json:"effortoid,omitempty"`
}

// BugReport is report.json plus where it lives; Dir and HasScreen are never written to the file.
type BugReport struct {
	Id        string            `json:"id"`
	Ts        int64             `json:"ts"` // the press, unix ms
	Text      string            `json:"text"`
	Version   string            `json:"version"`
	Commit    string            `json:"commit,omitempty"`
	Surface   string            `json:"surface,omitempty"`
	Agent     *BugReportAgent   `json:"agent,omitempty"`
	State     string            `json:"state"`
	Handler   string            `json:"handler,omitempty"` // the Jarvis agent's tab id
	ClaimedTs int64             `json:"claimedts,omitempty"`
	Outcome   *BugReportOutcome `json:"outcome,omitempty"`
	DoneTs    int64             `json:"donets,omitempty"`
	Dir       string            `json:"dir,omitempty"`       // absolute folder (wire only)
	HasScreen bool              `json:"hasscreen,omitempty"` // screen.png exists (wire only)
}

// BugReportStatus is what the box's count and the Jarvis row read.
type BugReportStatus struct {
	Waiting     int    `json:"waiting"`
	Handling    int    `json:"handling"`
	Handler     string `json:"handler,omitempty"`     // the tab id holding the handling reports
	RepoPath    string `json:"repopath,omitempty"`    // arcterm's checkout, when found
	RepoProject string `json:"repoproject,omitempty"` // the registered project at RepoPath, when one is
}

type CommandBugReportSaveData struct {
	Text      string          `json:"text"`
	Ts        int64           `json:"ts"`
	Version   string          `json:"version"`
	Commit    string          `json:"commit,omitempty"`
	Surface   string          `json:"surface,omitempty"`
	Agent     *BugReportAgent `json:"agent,omitempty"`
	Screen64  string          `json:"screen64,omitempty"` // the PNG, base64; empty when the capture failed
}

type CommandBugReportListData struct {
	State string `json:"state,omitempty"` // empty lists waiting and handling
}

type CommandBugReportClaimData struct {
	AgentId string   `json:"agentid"`
	Ids     []string `json:"ids"`
}

type CommandBugReportClaimRtnData struct {
	Claimed []string `json:"claimed"`
}

type CommandBugReportDoneData struct {
	Id      string           `json:"id"`
	Outcome BugReportOutcome `json:"outcome"`
}

type BugReportCommands interface {
	BugReportSaveCommand(ctx context.Context, data CommandBugReportSaveData) (*BugReportStatus, error)
	BugReportStatusCommand(ctx context.Context) (*BugReportStatus, error)
	BugReportListCommand(ctx context.Context, data CommandBugReportListData) ([]BugReport, error)
	BugReportClaimCommand(ctx context.Context, data CommandBugReportClaimData) (*CommandBugReportClaimRtnData, error)
	BugReportDoneCommand(ctx context.Context, data CommandBugReportDoneData) error
}
```

- `pkg/wshrpc/wshserver/wshserver_bugreport.go`: the five methods on `*WshServer`, each returning
  `fmt.Errorf("bug reports: not implemented yet")`. Task 2 replaces the bodies.
- Setting `bugreport:repo` (string, `BugReportRepo`) in `SettingsType` (`pkg/wconfig/settingsconfig.go`), with a
  comment saying it is arcterm's checkout for the Jarvis bug-report agent and that unset means "found among the
  projects"; a row for it in `docs/guide/settings.md`.
- Run `task generate`; commit what it writes (`metaconsts.go`, `schema/settings.json`, `wshclient.go`,
  `wshclientapi.ts`, `gotypes.d.ts`). Never hand-edit those.
- Scenario stubs: `scripts/cdp/scenarios-bug-report-box.mjs` and `scripts/cdp/scenarios-bug-report-jarvis.mjs`, each
  `export default function (kit) { return []; }` with a header comment naming the spec and the scenario
  (`bug-report-box`, `bug-report-jarvis`) the later task adds; import both in `scripts/cdp/scenarios.mjs` and spread them
  into `SCENARIOS` the way `runQueueRecheckScenarios(RUN_START_KIT)` is (pass `RUN_START_KIT`). This is the only edit to
  `scenarios.mjs` in the plan.

Acceptance: `go build ./pkg/... ./cmd/...` passes; `task check:ts` passes; `RpcApi.BugReportSaveCommand` and the
`"bugreport:repo"` settings key exist in the generated TS; `node -e "import('./scripts/cdp/scenarios.mjs')"` loads.

### Task 2: The report store, the server commands, the Jarvis row, the chatsuggest log line
**Depends on:** Task 1
**Model:** sonnet
**Files:** `pkg/bugreport/bugreport.go`, `pkg/bugreport/bugreport_test.go`, `pkg/bugreport/logwindow.go`, `pkg/bugreport/logwindow_test.go`, `pkg/bugreport/repo.go`, `pkg/bugreport/repo_test.go`, `pkg/wshrpc/wshserver/wshserver_bugreport.go`, `pkg/wshrpc/wshserver/wshserver_chatsuggest.go`, `pkg/jarvis/attention.go`, `pkg/jarvis/attention_bugreport_test.go`, `pkg/jarvis/bugreports.go`

Implements the spec's "Store", "The log window", "The repo", "The Jarvis row" and "The chatsuggest log line" decisions.

`pkg/bugreport` (no import of `wstore` or `jarvis`: callers pass what it needs, so it tests on a temp dir):

- `type Store struct{ Root string; Now func() time.Time }`, `Default()` rooted at
  `filepath.Join(wavebase.GetWaveDataDir(), "reports")`.
- `(s *Store) Save(data wshrpc.CommandBugReportSaveData, logDir string) (wshrpc.BugReport, error)`: refuses empty
  (all-space) text; id from the press time (`20261119-153012`, `-2`… on collision); writes `report.json`
  (temp+rename), `screen.png` when `Screen64` decodes, `log.txt` from the log window over `logDir`
  (`waveapp.log`, `waveapp.1.log`); state `waiting`; then prunes `done/` older than 30 days.
- `List(state string) ([]wshrpc.BugReport, error)` (oldest first, `Dir`/`HasScreen` filled; `done` lists `done/`),
  `Status() (waiting, handling int, handler string, err error)`, `Reconcile(alive func(tabID string) bool) error`,
  `Claim(agentID string, ids []string) ([]string, error)`, `Done(id string, outcome wshrpc.BugReportOutcome) error`
  — rules exactly as the spec's decisions say (Claim refuses while any report is handling; Done refuses a report
  that is not handling, then moves it to `done/` with `donets` and prunes).
- `logwindow.go`: `CutWindow(older, current []byte, since, until time.Time, maxBytes int) []byte`, pure. Timestamp
  layout `2006-01-02 15:04:05.000` in `time.Local`; untimestamped lines follow their predecessor; `older` used only when
  `current`'s first timestamped line is after `since`; keeps the newest lines within `maxBytes` (1 MB in Save).
- `repo.go`: `FindRepo(setting string, projects map[string]wconfig.ProjectKeywords) (path, project string, ok bool)`
  and `IsArctermRepo(dir string) bool` (Taskfile.yml, `src-tauri/` dir, go.mod module line
  `github.com/wavetermdev/waveterm`). `project` is the name in the **passed map** whose path matches `path` (cleaned,
  case-insensitive on Windows), empty when none. Do not call `wconfig.ProjectNameAtPath`: it reads the projects file
  from disk and ignores the map, so the tests would read the real config.

One shared helper so the box's count and the Jarvis row cannot differ: in `pkg/jarvis` (e.g.
`pkg/jarvis/bugreports.go`), `GatherBugReports(ctx) (wshrpc.BugReportStatus, int64, error)` — Reconcile with an
`alive` that checks the tab exists in `wstore` (a missing tab is dead; a store error counts as alive, logged — never
revert reports on a read failure), then Status, then `FindRepo` over the full config's `bugreport:repo` and projects;
the int64 is WaitingSince, computed from `List` (the oldest waiting report's ts, or while handling the oldest claimed
one's `claimedts`), since the wire `BugReportStatus` is frozen after Task 1. `pkg/bugreport` itself never imports
`wstore` or `jarvis`.

Server (`wshserver_bugreport.go`): `BugReportStatusCommand` returns `GatherBugReports`'s status; List, Claim and Done
call the same Reconcile first (export the reconcile half from the helper so it is written once). Save passes the
data dir as `logDir` and returns the status the helper gives after the save.

Jarvis row (`attention.go`): a `BugReports *wshrpc.BugReportStatus` and `BugReportsSince int64` on `AttentionInput`;
`bugReportItems` builds the one row (kind constant `AttentionBugReports = "bug-reports"`, key `bug-reports`) in the
three forms the spec's decision lists, appended after councils. `GatherAttentionFromLedger` fills both from
`GatherBugReports`, logging and omitting the row when it fails (the councils' posture).

chatsuggest: in `ChatSuggestCommand`, one `log.Printf` per answer: `chatsuggest: block=<first 8 of BlockId>
via=mod|headless <ms>ms chips=<n>` and `err=<…>` when the headless call failed.

Tests (each focused, run with `go test ./pkg/bugreport -run '<names>'` and `go test ./pkg/jarvis -run
'TestBugReport'`):
- `TestCutWindow*`: a window inside one file; across the roll (older read only when needed); a panic frame with no
  timestamp kept with its line; the 1 MB cap keeps the tail; empty inputs.
- `TestSave*`: folder content (report.json fields, screen.png present/absent, log.txt), empty text refused, id
  collision gets `-2`.
- `TestClaim*`, `TestDone*`, `TestReconcile*`, `TestPrune*`: the state rules, a closed agent's reports back to waiting,
  done moved and pruned after 30 days (inject `Now`).
- `TestFindRepo*`: setting wins and a missing set folder is not found; project scan with a fake repo dir; none.
- `TestBugReportAttention*` in `pkg/jarvis/attention_bugreport_test.go`: no row; waiting+repo → "2 báo lỗi arcterm chờ
  xử lý"/"Xử lý" with ProjectPath; waiting without repo → "Không tìm thấy repo arcterm"/"Chọn thư mục…"; handling →
  "Đang xử lý 2 báo lỗi"/"Mở agent" with ORef `agent:<tab>`; the row sorts last.

### Task 3: `wsh bugreport list | done`
**Depends on:** Task 1 (uses the generated `wshclient.BugReportListCommand` and `BugReportDoneCommand`)
**Model:** sonnet
**Files:** `cmd/wsh/cmd/wshcmd-bugreport.go`, `cmd/wsh/cmd/wshcmd-bugreport_test.go`

The CLI the Jarvis agent marks reports with, as the spec's "`wsh bugreport`" decision says: `wsh bugreport list
[--state waiting|handling|done] [--json]` (a plain listing prints one line per report: id, state, the first line of
its text, its folder) and `wsh bugreport done <id> --outcome <text> [--run <id>] [--effort <oid>]` (`--outcome`
required). Follow the shape of an existing small command (`wshcmd-note.go`): the RPC call, error text that says what
to do, `--json` output for list. Keep the formatting in a pure function so it tests without an RPC.

Acceptance: `go test ./cmd/wsh/cmd -run 'TestBugReport'` covers the list formatting (no reports, one with a multi-line
text) and the flag checks (done without `--outcome`, done without an id); `wsh bugreport --help` reads clearly.

### Task 4: The box: footer button, Ctrl+Alt+R, capture, save
**Depends on:** Task 1 (uses `RpcApi.BugReportSaveCommand` / `BugReportStatusCommand` and the scenario stub)
**Model:** sonnet
**Files:** `frontend/app/cockpit/bugreportbox.tsx`, `frontend/app/cockpit/bugreportboxmodel.ts`, `frontend/app/cockpit/bugreportboxmodel.test.ts`, `frontend/app/cockpit/bugreportstore.ts`, `frontend/app/cockpit/footerstatus.tsx`, `frontend/app/cockpit/cockpit-root.tsx`, `frontend/app/store/keybindings/bindings.ts`, `docs/keyboard-shortcuts.md`, `CHANGELOG.md`, `scripts/cdp/scenarios-bug-report-box.mjs`

The spec's "The button and its box" and the decision "The box", matching the mockup board `B-footer.dc.html` (a 380 px
popover above the footer's right group: title and "N đang chờ Jarvis" on one line, a 96×60 thumbnail beside the
"Chuyện gì sai?" text box, the "Kèm ảnh chụp…" line, Huỷ / Gửi with `Ctrl+↵`).

- `bugreportstore.ts`: the box's atom (`closed | capturing | open {capture: Blob | null, surface, agent, ts, waiting,
  text, error?, sending}`), `openBugReport(model)` (no-op unless closed; capture through
  `invoke("capture_webview")` as `canvassend.ts` does, a failure → null; read `model.surfaceAtom` and `focusIdAtom`
  with the agent's name at the press; `BugReportStatusCommand` for the count), `sendBugReport()` (base64 the PNG,
  `BugReportSaveCommand`, then close and `pushToast` "Đã gửi báo lỗi · N đang chờ Jarvis"; a failure keeps the box open
  with the error), `closeBugReport()`. Version and commit from `versionInfoAtom`.
- `bugreportboxmodel.ts`, pure: `canSend(text, sending)`, the count's wording ("N đang chờ Jarvis", nothing at 0),
  the save payload built from the open state. Tests in `bugreportboxmodel.test.ts`.
- `bugreportbox.tsx`: the box, `frost`, tokens only; the thumbnail is an `<img>` from an object URL (revoked on close)
  or a "Không có ảnh" placeholder; Gửi disabled until `canSend`; Ctrl+Enter sends, Esc closes (the box's own
  key handling, so it works while focus is in the text box). Data attributes for the scenario:
  `data-bug-report-box`, `data-bug-report-thumb` (`="img"` or `="none"`), `data-bug-report-text`,
  `data-bug-report-waiting`, `data-bug-report-send`, `data-bug-report-cancel`, `data-bug-report-error`.
- `footerstatus.tsx`: an icon-only lucide `Bug` button before the `?` (`data-bug-report-button`, `aria-label`
  "Báo lỗi arcterm", title "Báo lỗi arcterm · Ctrl+Alt+R" with the keys drawn from the binding, lit while the box is
  open). Mount `<BugReportBox model={model} />` once in `cockpit-root.tsx` beside `ShortcutsCheatSheet`.
- `bindings.ts`: in `buildGlobalBindings`, `id: "global:bug-report"`, `keys: "Ctrl:Alt:r"`, group "Help", label
  "Báo lỗi arcterm" (its palette row), firing from inside a terminal as the other global chords that do. List it in
  `docs/keyboard-shortcuts.md`.
- `CHANGELOG.md` (Unreleased): an `Added` line for the button and box ending `<!-- try: global:bug-report -->`, and one
  for Jarvis's Xử lý that handles every waiting report in one agent. Written for the user.
- DEV-only hooks, declared in a `declare global` as `__chatSuggestFake` is and read only under `import.meta.env.DEV`:
  `window.__bugReportCaptureFake?: () => Promise<Blob>` (stands in for `capture_webview`; a rejection gives the
  no-picture state) and `window.__bugReportSaveFake?: (data) => Promise<BugReportStatus>` (stands in for
  `BugReportSaveCommand`; a rejection gives the error state).
- Scenario `bug-report-box` in `scripts/cdp/scenarios-bug-report-box.mjs` (surface `cockpit`). Final runs the Tauri dev
  app, where `capture_webview` works, so the real capture is asserted there. Steps:
  (1) click `data-bug-report-button` → the box shows above the footer, the thumbnail is `img` when the page has a
  Tauri host (`window.__TAURI_INTERNALS__`), `none` only under the browser shim; the text box is focused; Gửi is
  disabled; the count reads the `bugreportstatus` waiting number; shot (this is the B-footer board's state).
  (2) Esc → the box is gone, the waiting count unchanged. (3) `Ctrl+Alt+R` (dispatched as a key event) → the box
  opens again; press `data-bug-report-cancel` (Huỷ) → closed, the count unchanged. (4) install a capture fake that
  rejects, open the box → the thumbnail is `none` with "Không có ảnh"; shot; remove the fake, Esc. (5) install a save
  fake that rejects with a known message, open, type a text, `Ctrl+Enter` → the box stays open, `data-bug-report-error`
  shows the message, the count unchanged; shot; remove the fake, Esc. (6) open, type a text, `Ctrl+Enter` → the box
  closes, the toast reads "Đã gửi báo lỗi · N đang chờ Jarvis" with N the new count, `bugreportstatus` waiting rose
  by 1; reopen → the shown count rose by 1; shot. Teardown deletes the folders of the reports it created (their `dir`
  from `bugreportlist`), removes the fakes and closes the box.

Acceptance: `npx vitest run frontend/app/cockpit/bugreportboxmodel.test.ts`; `task check:ts`; the `bug-report-box`
scenario's steps above (run in Final).

### Task 5: Jarvis's row: Xử lý, Mở agent, Chọn thư mục…
**Depends on:** Task 1 (uses `RpcApi.BugReportListCommand` / `BugReportClaimCommand`, the `bugreport:repo` key and the scenario stub)
**Model:** sonnet
**Files:** `frontend/app/view/jarvis/attentionact.ts`, `frontend/app/view/jarvis/attentionact.test.ts`, `frontend/app/view/jarvis/attentionrun.ts`, `frontend/app/view/jarvis/briefingmodel.ts`, `frontend/app/view/jarvis/briefingmodel.test.ts`, `frontend/app/view/jarvis/briefsurface.tsx`, `frontend/app/view/agents/needsyou.ts`, `frontend/app/view/agents/needsyoustripmodel.ts`, `frontend/app/view/agents/needsyoustripmodel.test.ts`, `frontend/app/view/jarvis/petacts.ts`, `frontend/app/view/jarvis/petacts.test.ts`, `frontend/app/view/jarvis/petactrun.ts`, `frontend/app/view/jarvis/petpeek.tsx`, `frontend/app/cockpit/command-palette.tsx`, `frontend/app/cockpit/sidecarneeds.ts`, `frontend/app/view/jarvis/bugreportprocess.ts`, `frontend/app/view/jarvis/bugreportprompt.ts`, `frontend/app/view/jarvis/bugreportprompt.test.ts`, `docs/hand-checks.md`, `scripts/cdp/scenarios-bug-report-jarvis.mjs`
**Files:** `frontend/app/view/jarvis/attentionrun.test.ts`, `frontend/app/cockpit/palette-needs.ts`, `frontend/app/view/jarvis/briefrows.ts`

The spec's "Jarvis handles them when you press Process" and the decisions "The Jarvis row" and "Process". The wire
row is Task 2's; this task gives it its buttons wherever a waiting item is listed.

- `attentionact.ts`: for wire kind `bug-reports`, derive the act from the item without a new field (spec decision):
  ORef starting `agent:` → `{label: "Mở agent", kind: "open"}`; else empty ProjectPath → `{label: "Chọn thư mục…",
  kind: "pick-repo"}`; else `{label: "Xử lý", kind: "process-reports"}`. Add `oref`/`projectPath` to
  `AttentionActInput` as optional fields and fill them where the inputs are built (`briefingmodel.ts`,
  `needsyoustripmodel.ts`, `petacts.ts`). `runAttentionAct` returns false for both new kinds (the caller runs them,
  like `work-on`), so `attentionDoneText` needs no case.
- `bugreportprocess.ts`: `processBugReports(model)` — guard against a second press while one is in flight; read
  `BugReportStatusCommand` (refuse with a toast while reports are handling); `BugReportListCommand` for the waiting
  ones; resolve the runtime as `initiativeworkaction.ts` does; `launchAgent` in `RepoPath`/`RepoProject`, label
  "Báo lỗi arcterm", task = `bugReportPrompt(...)` — or, in DEV only, `window.__bugReportLaunchFake(opts)` when set
  (declared in a `declare global`, as `__chatSuggestFake` is); then `BugReportClaimCommand` with the returned tab id and
  the listed ids; `loadAttention()`. Errors become toasts naming what failed. When the status has a `RepoPath` but no
  `RepoProject` (the setting was written by hand, or the project was removed since), it first registers the project
  through the same `ensureRepoProject(path)` the picker uses, then launches under that name: an agent, a run and an
  initiative all need a registered project.
  `pickBugReportRepo(model)` — the Tauri folder dialog (as `newprojectmodal.tsx` imports it), or in DEV
  `window.__bugReportPickFake?: () => Promise<string | null>` when set; then `SetConfigCommand` `bugreport:repo`, then
  `ensureRepoProject(path)`: `CreateProjectCommand` named after the folder's base name when no project in
  `projectsAtom` has that path (a name already taken by another path gets `-2`, `-3`…), then `loadAttention()`. A
  cancelled dialog does nothing.
- `bugreportprompt.ts`, pure: `bugReportPrompt({repoPath, project, reports})` → the seeded prompt the spec's
  "Process" decision describes (folders and files, grouping, small → `wsh runs start --mode orchestrator --project
  <repo> "<goal>"`, large → `wsh effort create … --project <project> --chunk …`, unclear → one question back and leave
  it handling, `wsh bugreport done …` per report, a closing list; stop if `wsh bugreport list --state handling` does
  not show its reports). Tests: every report's folder and id appear, the three commands appear with the repo and
  project filled, one report vs several.
- The Brief (`briefingmodel.ts` `buildAttentionQueue`): a row gets its `action` only when it has a channel, a due
  oref, a plan nav or a council oref (the `action:` line, ~245); add the `bug-reports` kind to that gate so all three
  forms draw their button, and give the handling form the nav `{kind: "agent", oref}` (as `planNav` does) so the row
  and Mở agent open the agent. `briefsurface.tsx` `actOnQueue` runs `process-reports` / `pick-repo`.
- The Cockpit's Needs-you strip (`needsyoustripmodel.ts`, `needsyou.ts` `act`) gets the same three buttons. The Office
  notice board reads the strip's rows and `act` unchanged; do not edit its files.
- The creature's peek (`petacts.ts`, `petactrun.ts`) gives the row one act, Open, landing on the Brief (Jarvis
  surface) with that row selected: Process and the folder picker stay where there is room to explain them.
- Every other list of attention kinds learns the kind: labels "Báo lỗi" in `QUEUE_KIND_LABEL`,
  `needsyoustripmodel.ts`, `command-palette.tsx`, `sidecarneeds.ts`; `palette-needs.ts` (its scope map and its open
  target: the Brief, or the agent in the handling form); `briefrows.ts` (`ANSWER_KINDS` / `REMINDER_KINDS`: it is a
  reminder, not an answer); a dot colour in `petpeek.tsx`.
- `docs/hand-checks.md`: a `- [ ] (arcterm) …` line for pressing Xử lý with a real Claude agent on two reports and
  reading its runs/initiative/question (the scenario uses the fake launcher).
- Scenario `bug-report-jarvis` in `scripts/cdp/scenarios-bug-report-jarvis.mjs` (surface `jarvis`). Arrange saves two
  reports through `bugreportsave` (no screen), records the prior `bugreport:repo` and the projects, and makes a temp
  folder for the picker. Steps:
  (1) set `bugreport:repo` to a folder that does not exist → the Brief's Waiting list shows "Không tìm thấy repo
  arcterm" with a "Chọn thư mục…" button; shot.
  (2) install `window.__bugReportPickFake` returning the temp folder, press Chọn thư mục… → `getfullconfig` shows
  `bugreport:repo` = that folder and a project registered at it; the row reads "2 báo lỗi arcterm chờ xử lý" with a
  "Xử lý" button; shot.
  (3) the Cockpit's Needs-you strip shows the same row with its Xử lý button; shot.
  (4) open the creature's peek (as the `peek-item-views` scenario does) → the row is listed; its Open lands on the
  Brief with the row selected; shot.
  (5) create a plain terminal tab, install `window.__bugReportLaunchFake` returning its tab id, press Xử lý in the
  Brief → the row reads "Đang xử lý 2 báo lỗi" with "Mở agent", and `bugreportlist` shows both `handling` under that
  tab; shot.
  (6) press Mở agent → the Agent surface shows, with `focusIdAtom` on that tab.
  (7) close that tab → after the next poll the row is back to "2 báo lỗi arcterm chờ xử lý".
  (8) press Xử lý again with a second fake tab, then `bugreportdone` both with an outcome → the row is gone from the
  Brief, and `bugreportlist --state done` lists both; shot.
  Teardown restores the setting, removes the project it registered, deletes the reports' folders and the temp folder,
  removes the fakes and the tabs. Each wait polls (no fixed sleeps past the attention poll interval).

Acceptance: `npx vitest run frontend/app/view/jarvis/attentionact.test.ts frontend/app/view/jarvis/bugreportprompt.test.ts frontend/app/view/jarvis/briefingmodel.test.ts frontend/app/view/agents/needsyoustripmodel.test.ts frontend/app/view/jarvis/petacts.test.ts`
(new cases for the three forms); `task check:ts`; the `bug-report-jarvis` scenario's steps above (run in Final).
