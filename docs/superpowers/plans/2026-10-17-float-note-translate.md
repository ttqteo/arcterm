# Float Note and Translate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In Float, the strip under the terminal (the ledge) gets two fixed tabs: **Note**, one global markdown scratch note, and **Translate**, a translate-shell terminal whose prompt names the target language.

**Architecture:**
- **The note:** a markdown file in the vault (`<vault>/notes/scratch.md`). wavesrv reads and writes it over two new wshrpc commands. In Float, a `FloatNote` overlay covers the terminal area; the terminal stack stays mounted under it, so the terminal never refits or replays.
- **Translate:** translate-shell becomes a built-in tool in `pkg/arctools`. It runs with an arcterm theme file that `wsh install-agent-hooks` writes to `~/.arc/translate-shell/arc.trans`, and rlwrap keeps its input history. The Translate tab shows the trans tool's terminal, or opens or installs it through the existing tool actions.

**Tech Stack:** Go (notestore, wshrpc, arctools, wsh), React 19 + jotai + Tailwind 4, vitest, CDP scenario harness.

**Spec:** This file's Design section, agreed in chat on 2026-10-17, together with the canvas named on the Prototype line, approved the same day.

**Prototype:** .superpowers/design/float-note-translate/project/Main.dc.html

**Verify:** `node scripts/verify.mjs ./pkg/notestore ./pkg/arctools ./pkg/wshrpc/... ./cmd/wsh/...`

**Final:** `node scripts/cdp/final-verify.mjs float-note`

## Design

The canvas boards are the look; this section is the behavior. Each board, and what it shows:

| Board | State |
|---|---|
| Main | Note in Edit |
| NotePreview | Note in Preview |
| Terminal | Float on one agent |
| Translate | the trans terminal |
| TranslateInstall | the install terminal |
| NoteEmpty | an empty note |
| NoteError | a failed save |

- **The ledge's fixed tabs.**
  - In Float, the ledge (`frontend/app/cockpit/float-ledge.tsx`) shows two icon-only tabs at its left: Note (lucide `StickyNote`) and Translate (lucide `Languages`). A 1px `edge-mid` divider follows them, then the agent and terminal tabs.
  - A fixed tab is pressed as an agent tab is (`bg-surface-hover`, `ring-1 ring-edge-mid`, `text-primary`).
  - Because these tabs are always there, the agent and terminal tabs show even when only one agent floats (board Terminal), so there is always a way back.
  - The trans terminal is left out of the agent and terminal tabs, since its tab is Translate. It stays in the Ctrl+Tab switcher and the sidebar.
- **The Note overlay.**
  - Picking Note sets `floatNoteOpenAtom` and draws `FloatNote` over the terminal area, in `bg-surface` (one tone above the terminal's `bg-background`). It never changes `focusIdAtom`.
  - The note closes:
    - when focus changes by any route (a ledge tab, Ctrl+Tab, j/k…)
    - when an agent tab is clicked
    - on Escape in the editor
    - when Float ends
  - Re-entering Float shows the terminal, not the note.
- **One global note.**
  - It is stored at `<vault>/notes/scratch.md` as raw markdown with no title heading.
  - `notestore.List` skips it, since `scratch` does not match the dated id, so it is not in the palette's Notes.
- **The editor.**
  - **Edit** (boards Main and NoteEmpty): a monospace textarea at 13px, 21px line height, `px-5 py-3.5`. Its placeholder is two lines: `Write markdown…`, a blank line, then `It saves as you type. Esc goes back to the terminal.`
  - **Preview** (board NotePreview): renders with `MarkdownMessage` (`frontend/app/view/agents/markdownmessage`), as the palette's notes do.
  - **Saving:** 500 ms after the last keystroke, and at once when the note closes. If two places edit at once, the last write wins.
  - **A failed save** (board NoteError) keeps the text and shows one line under it: an `error` circle icon, then `Couldn't save the note: <the error>. Your text stays here, and your next edit tries again.` The next save that works clears it.
- **The float bar while on Note** (board Main):
  - The left side shows the StickyNote icon and `Note`.
  - An **Edit | Preview** word switch sits before the pin: a 2px-padded `surface-raised` group with `edge-mid` border; the pressed half is `surface-hover`, `font-semibold`, `text-primary`.
  - The close button (X) is not rendered. Pin, Leave float and the Mac − stay.
- **The `float-note` binding.**
  - It is global: `float-note`, `Mod:Shift:n`.
  - Outside Float, or in Float on a terminal, it opens Float straight on the Note. In Float on the Note, it goes back to the terminal.
- **The built-in tool.** translate-shell is added as a built-in tool:

  | Field | Value |
  |---|---|
  | id | `trans` |
  | name | `translate-shell` |
  | category | `Docs and data` |
  | purpose | `Translate: a word with its dictionary entry, or whole sentences` |
  | command | `trans` |
  | args | `-shell -theme ~/.arc/translate-shell/arc.trans` |
  | opens in | `home` |
  | shows | `centre` |
  | Darwin install | `brew install translate-shell rlwrap` |
  | Windows install | none |

  - rlwrap is what gives the shell its ↑ and Ctrl+R history across sessions: trans uses it on its own whenever it is on PATH.
  - A user's `tools.json` overrides the args, for example to add `:en+vi`.
- **The theme file** `cmd/wsh/cmd/trans-theme.trans`.
  - It holds trans's default theme (the `setDefaultTheme` values of translate-shell 0.9.7.1) with the prompt changed to `:fmt-prompt "%s → %t ❯ "`. The prompt then reads ` → Tiếng Việt ❯ ` with the source detected, `English → Tiếng Việt ❯ ` with `en:vi`, and follows `:fr`, `en:vi` and `:swap` typed in the shell.
  - It must be a theme file passed with `-theme`: trans applies its theme after `init.trans`, which resets any prompt set there.
  - `wsh install-agent-hooks` writes it to `~/.arc/translate-shell/arc.trans` on every launch.
  - Without the file, trans prints no prompt at all, so the scenario passes its own copy (Task 4).
- **The Translate tab.**
  - If a terminal with `toolId === "trans"` exists, the tab focuses it (board Translate).
  - Otherwise, with `trans` on PATH, it opens the tool with `place: "centre"`.
  - Without `trans` on PATH, it runs the tool's install and shows that terminal, `Install translate-shell` (board TranslateInstall). The install terminal closes itself when the install succeeds, and the next press opens trans.
  - The tab is pressed while the trans terminal is in focus and the note is closed.
- **Not included:**
  - the Note outside Float
  - more than one global note
  - translating a selection
  - a list of past lookups to review (rlwrap's ↑ and Ctrl+R recall what you typed)
  - Google account features
  - Windows

## Global Constraints

- Colors come from `@theme` tokens (`frontend/tailwindsetup.css`); no raw hex or rgba in components. Prefer Tailwind.
- The Agent surface's terminal stack is never rendered conditionally and never re-parented. The note overlays it; it does not replace `CockpitShell`.
- `focusIdAtom` stays the one selected agent. Nothing in this plan writes it except the existing tool and terminal routes.
- Never hand-edit generated files; run `task generate` after changing a wshrpc type.
- Typecheck with `NODE_OPTIONS=--max-old-space-size=4096 task check:ts`, using a timeout of at least 5 minutes. Never use `npx tsc`.
- Run prettier and eslint only on the files you touched. Never run prettier on `scripts/*.mjs`, and never `--write` the tree.
- Never run `wsh install-agent-hooks` against the real home; tests use a temp home.
- Commits carry no Co-Authored-By or other attribution lines.

## Review Focus

Each line names the case and the test that pins it.

1. **Typing in the note:** capital letters and single keys (`F`, `r`, digits) must type into the note and never fire a single-key Agent binding, such as `Shift:f` leaving Float. Pinned by Task 4's scenario, step 3.
2. **A save that fails:** the text stays, the error line shows, and the next edit retries and clears it. Pinned by Task 3's `editScratch` failure test and Task 4's scenario, step 5.
3. **The read resolving after typing began:** the read must not overwrite what was typed. Pinned by Task 3's `loadScratch` race test.
4. **Leaving with a save pending** (a tab switch, Leave float, the binding): the edit saves at once. Pinned by Task 3's `closeFloatNote` flush test; the overlay calls `closeFloatNote` on unmount.
5. **The prompt naming the language:** trans with the theme prints `English → Tiếng Việt ❯` for `en:vi`. Pinned by Task 2's `TestTransThemeNamesTheTargetLanguage`, which skips where trans is not installed.

---

### Task 1: Scratch note storage and RPC

**Depends on:** none
**Files:** `pkg/notestore/notestore.go`, `pkg/notestore/notestore_test.go`, `pkg/wshrpc/wshrpctypes_note.go`, `pkg/wshrpc/wshserver/wshserver_note.go`, `pkg/wshrpc/wshclient/wshclient.go`, `frontend/app/store/wshclientapi.ts`, `frontend/types/gotypes.d.ts`

**Interfaces:**
- Produces (Go):
  - `notestore.ReadScratch() (string, error)` returns `""` when the file is missing.
  - `notestore.WriteScratch(body string) error` writes `body` byte for byte to `<vault>/notes/scratch.md`.
- Produces (RPC), on `NoteCommands`:
  - `NoteScratchReadCommand(ctx context.Context) (string, error)`
  - `NoteScratchWriteCommand(ctx context.Context, data CommandNoteScratchWriteData) error`, with `type CommandNoteScratchWriteData struct { Body string \`json:"body"\` }`. `Body` has no `omitempty`, so an empty write clears the note.
- Produces (TS, generated):
  - `RpcApi.NoteScratchReadCommand(client): Promise<string>`
  - `RpcApi.NoteScratchWriteCommand(client, { body }): Promise<void>`
  - The scenario's RPC names are `notescratchread` and `notescratchwrite`.

- [ ] **Step 1: Write the failing tests** in `pkg/notestore/notestore_test.go`, using the existing `useTempRoot`:

```go
func TestScratchReadsEmptyWhenMissing(t *testing.T) // ReadScratch() == "", err == nil on a fresh root
func TestScratchWriteThenReadKeepsTheBytes(t *testing.T)
// WriteScratch("# Plan\n\n- one\n  ") then ReadScratch() == "# Plan\n\n- one\n  " exactly;
// the file is filepath.Join(root, NotesDir, "scratch.md") with the same bytes; wavevault.PokedForTest() is true
func TestScratchWriteEmptyClearsIt(t *testing.T) // WriteScratch("x"); WriteScratch(""); ReadScratch() == ""
func TestListSkipsTheScratchNote(t *testing.T)   // WriteScratch("x"); Add("Real", ""); List() holds only the "Real" note
```

- [ ] **Step 2: Run them and see them fail.**
Run: `go test ./pkg/notestore -run 'Scratch'`
Expected: FAIL, `undefined: ReadScratch`.

- [ ] **Step 3: Implement `ReadScratch` and `WriteScratch` in `pkg/notestore/notestore.go`.**
  - Add a `scratchFile = "scratch.md"` const and a `scratchPath()` beside `notesDir()`.
  - `WriteScratch` takes `mu` and calls the existing `write(path, []byte(body))`.
  - `ReadScratch` takes `mu`, returns `""` on `fs.ErrNotExist`, and otherwise returns the content untrimmed.
  - Add one line to the package doc: the scratch note is `notes/scratch.md`, kept out of `List`.

- [ ] **Step 4: Run the tests and see them pass.**
Run: `go test ./pkg/notestore`
Expected: PASS.

- [ ] **Step 5: Add the two commands.** Add them to `NoteCommands` with `CommandNoteScratchWriteData`, and implement them in `wshserver_note.go` as one-line calls into notestore, like the existing four.

- [ ] **Step 6: Regenerate the bindings and build.**
Run: `task generate && go build ./cmd/... ./pkg/...`
Expected: exit 0. `git diff --stat` shows the three generated files changed only by the two commands and their data type.

- [ ] **Step 7: Commit.**
`git commit -m "feat(notes): one scratch note, read and written over wshrpc"`.

### Task 2: translate-shell as a built-in tool, with arcterm's prompt theme

**Depends on:** none
**Files:** `pkg/arctools/catalog.go`, `pkg/arctools/catalog_test.go`, `cmd/wsh/cmd/trans-theme.trans`, `cmd/wsh/cmd/wshcmd-installhooks.go`, `cmd/wsh/cmd/wshcmd-installhooks_test.go`

**Interfaces:**
- Produces:
  - a built-in `Tool` with `Id: "trans"`, which the frontend sees in `toolsStatusAtom` as a `ToolStatus` with `id: "trans"`
  - the file `cmd/wsh/cmd/trans-theme.trans`, which Task 4's scenario reads
  - `transThemePath(home string) string`, which returns `filepath.Join(home, ".arc", "translate-shell", "arc.trans")`
  - `installTransTheme(home string) error`

- [ ] **Step 1: Write the failing tests.**
  - In `catalog_test.go`, `TestBuiltinOrder`: append `"trans"` to `want` after `"visidata"`, and add this check to the loop:

```go
if tool.Id == "trans" && (tool.Command != "trans" || tool.Args != "-shell -theme ~/.arc/translate-shell/arc.trans" ||
	tool.OpensIn != "home" || tool.Install.Darwin != "brew install translate-shell rlwrap" || tool.Install.Windows != "") {
	t.Errorf("trans: %+v", tool)
}
```

  - In `wshcmd-installhooks_test.go`:
    - **`TestInstallTransTheme_writesTheThemeUnderDotArc`:**
      - in a `t.TempDir()` home, `installTransTheme(home)` writes `transThemePath(home)`
      - the content equals `transTheme`, the embedded file
      - the content holds `:fmt-prompt "%s → %t ❯ "` and `:sgr-translation "bold"`
      - a second call after the file is edited by hand writes it back
    - **`TestTransThemeNamesTheTargetLanguage`:**
      - `t.Skip` when `exec.LookPath("trans")` fails
      - write the theme to a temp file
      - run `trans -shell -no-rlwrap -no-ansi -theme <file> en:vi` with empty stdin, under a 15 s `exec.CommandContext` timeout
      - the combined output contains `English → Tiếng Việt ❯`. With empty stdin the shell prints its prompt once and exits, with no network.

- [ ] **Step 2: Run them and see them fail.**
Run: `go test ./pkg/arctools -run Builtin` and `go test ./cmd/wsh/cmd -run 'TransTheme'`
Expected: FAIL (10 built-ins wanted; `undefined: installTransTheme`).

- [ ] **Step 3: Write `cmd/wsh/cmd/trans-theme.trans`** with this content:

```
;; arcterm's theme for translate-shell (wsh install-agent-hooks writes it to ~/.arc/translate-shell/arc.trans): trans's
;; default theme, with a prompt that names the languages. A prompt set in init.trans does not hold: trans applies its
;; theme after init.trans, so the prompt has to live in a theme.
{
  :sgr-translation "bold"
  :sgr-translation-phonetics "bold"
  :sgr-prompt-message-original "underline"
  :sgr-languages-sl "underline"
  :sgr-languages-tl "bold"
  :sgr-original-dictionary-detailed-explanation "bold"
  :sgr-original-dictionary-detailed-synonyms-item "bold"
  :sgr-original-dictionary-synonyms-synonyms-item "bold"
  :sgr-original-dictionary-examples-original ["bold" "underline"]
  :sgr-original-dictionary-see-also-phrases-item "bold"
  :sgr-dictionary-word "bold"
  :sgr-alternatives-original "underline"
  :sgr-alternatives-translations-item "bold"
  :fmt-welcome-message "Translate Shell"
  :sgr-welcome-message "bold"
  :fmt-welcome-submessage "(:q to quit)"
  :fmt-prompt "%s → %t ❯ "
  :sgr-prompt "bold"
}
```

- [ ] **Step 4: Add the installer.**
  - Embed the file with `//go:embed trans-theme.trans` as `var transTheme string`, next to `claudeAskSettings`.
  - Add `transThemePath` and `installTransTheme`, which is `writeFileIfChanged(transThemePath(home), transTheme)` (it makes the folder).
  - Call it in `installAgentHooksRun` right after `installClaudeAskSettings(home)`, returning its error the same way.

- [ ] **Step 5: Add the catalog entry** after visidata in `Builtin()`, with the values from the Design section's table.
  - Add a comment on the `Args` naming `cmd/wsh/cmd/trans-theme.trans` and `installTransTheme`, which put the file there.
  - Update `Builtin()`'s doc comment: visidata and translate-shell are the Mac-only tools.

- [ ] **Step 6: Run the tests and see them pass.**
Run: `go test ./pkg/arctools && go test ./cmd/wsh/cmd -run 'TransTheme|InstallClaudeAskSettings'`
Expected: PASS. On this Mac `TestTransThemeNamesTheTargetLanguage` runs (trans is installed) rather than skipping; `-v` shows it.

- [ ] **Step 7: Commit.**
`git commit -m "feat(tools): translate-shell joins the tool library, its prompt naming the target language"`.

### Task 3: Float note and Translate model and store

**Depends on:** Task 1
**Files:** `frontend/app/view/agents/floatnote.ts`, `frontend/app/view/agents/floatnote.test.ts`, `frontend/app/view/agents/floatnotestore.ts`, `frontend/app/view/agents/floatnotestore.test.ts`, `frontend/app/view/agents/sproutroster.ts`, `frontend/app/view/agents/sproutroster.test.ts`

**Interfaces:**
- **Consumes:**
  - `RpcApi.NoteScratchReadCommand` and `RpcApi.NoteScratchWriteCommand` (Task 1)
  - `enterFloat(model)` and `floatModeAtom` from `./floatstore`
  - `toolsStatusAtom`, `loadTools()`, `openTool(model, tool, { place })` and `installTool(model, tool)` from `./toolsstore`
  - `model.openTerminal(id)`, `model.terminalsAtom` and `model.focusIdAtom`
- **Produces in `floatnote.ts` (pure):**
  - `TRANSLATE_TOOL_ID = "trans"`
  - `SCRATCH_SAVE_MS = 500`
  - `isTranslateTerminal(a: Pick<AgentVM, "toolId">): boolean`
  - `type TranslateStep = { kind: "show"; id: string } | { kind: "open"; tool: ToolStatus } | { kind: "install"; tool: ToolStatus } | { kind: "missing" }`
  - `translateStep(terminals: readonly AgentVM[], tools: readonly ToolStatus[] | null): TranslateStep`
  - `scratchErrorLine(err: unknown): string`, which returns `Couldn't save the note: <message>. Your text stays here, and your next edit tries again.` The message is the error's message with any leading `Error: ` and a trailing period removed.
- **Produces in `floatnotestore.ts`:**
  - Atoms:
    - `floatNoteOpenAtom: PrimitiveAtom<boolean>`
    - `scratchBodyAtom: PrimitiveAtom<string | null>` (null until read)
    - `scratchErrorAtom: PrimitiveAtom<string | null>` (the error line)
    - `scratchPreviewAtom: PrimitiveAtom<boolean>`
  - Functions:
    - `loadScratch(): Promise<void>`
    - `editScratch(body: string): void`
    - `flushScratch(): Promise<void>`
    - `openFloatNote(model: AgentsViewModel): Promise<void>`
    - `closeFloatNote(): void`
    - `toggleFloatNote(model: AgentsViewModel): Promise<void>`
    - `showTranslate(model: AgentsViewModel): Promise<void>`
- **Changes `floatTabs` in `sproutroster.ts`:** it leaves out `isTranslateTerminal` terminals and returns tabs when one or more remain (it used to need two). `floatTabOrder` is unchanged, so the Ctrl+Tab switcher still lists the trans terminal.

- [ ] **Step 1: Write the failing pure tests.**
  - In `floatnote.test.ts`:
    - `translateStep` returns `show` with the first terminal whose `toolId` is `"trans"`.
    - It returns `open` with no such terminal and the `trans` status `found: true`.
    - It returns `install` when `found: false`.
    - It returns `missing` when `tools` is null and when the catalog has no `trans`.
    - `isTranslateTerminal` is true only for `toolId: "trans"`.
    - `scratchErrorLine(new Error("open /v/notes/.scratch.md.tmp: permission denied"))` equals `Couldn't save the note: open /v/notes/.scratch.md.tmp: permission denied. Your text stays here, and your next edit tries again.`
  - In `sproutroster.test.ts`:
    - Replace `"shows no tabs for a float with nothing to switch to"` with `"shows the one agent's tab, the way back from Note and Translate"`, which expects one shown tab.
    - Add `"leaves the translate terminal out of the ledge's tabs"`: a `toolId: "trans"` terminal is in neither `shown` nor `rest`.
    - Add `"floatTabOrder keeps the translate terminal for the switcher"`.

- [ ] **Step 2: Run them and see them fail.**
Run: `npx vitest run frontend/app/view/agents/floatnote.test.ts frontend/app/view/agents/sproutroster.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `floatnote.ts` and the `floatTabs` change.** Update `floatTabs`' doc comment: no tabs only when nothing at all floats.

- [ ] **Step 4: Run the pure tests and see them pass.** Same command. Expected: PASS.

- [ ] **Step 5: Write the failing store tests** in `floatnotestore.test.ts`.
  - Setup: mock `@/app/store/wshclientapi`, `@/app/store/wshrpcutil` (as `palette-notesstore.test.ts` does), `./floatstore` (`enterFloat: vi.fn()`, a real `floatModeAtom` from `jotai`'s `atom(false)`) and `./toolsstore`; use `vi.useFakeTimers()`.
  - `"editScratch saves once, SCRATCH_SAVE_MS after the last edit"`:
    - edit `"a"` at 0 ms and `"ab"` at 300 ms
    - at 799 ms, no write
    - at 800 ms, exactly one `NoteScratchWriteCommand` call with `{ body: "ab" }`
  - `"closeFloatNote saves a pending edit at once and closes"`:
    - edit `"x"`, then `closeFloatNote()`
    - one write with `{ body: "x" }`, and `floatNoteOpenAtom` is false
    - after advancing 1000 ms, still one write
  - `"a failed save keeps the text, shows the error line, and the next edit retries"`:
    - the first write rejects `new Error("permission denied")`
    - `scratchBodyAtom` is still `"x"`, and `scratchErrorAtom` equals `scratchErrorLine` of that error
    - the next edit's write resolves, and `scratchErrorAtom` is null
  - `"loadScratch does not overwrite an edit made while it was reading"`:
    - the read resolves `"old"` after `editScratch("new")`
    - the body stays `"new"`
  - `"openFloatNote reads the note each time and enters Float when not floating"`:
    - two opens make two reads
    - `enterFloat` is called only while `floatModeAtom` is false
  - `"toggleFloatNote goes back to the terminal from the open note"`:
    - floating with the note open, the toggle closes it and does not call `enterFloat`

- [ ] **Step 6: Run them and see them fail.**
Run: `npx vitest run frontend/app/view/agents/floatnotestore.test.ts`
Expected: FAIL.

- [ ] **Step 7: Implement `floatnotestore.ts`.**
  - **Saving:** one module-level debounce timer and one pending body. `flushScratch` clears the timer and writes the pending body if there is one; a rejection sets `scratchErrorAtom` to `scratchErrorLine(err)`, and a success sets it to null. `closeFloatNote` calls `void flushScratch()`, then sets the open atom false and Preview off.
  - **Loading:** `loadScratch` leaves the body alone when an edit was made after the read began (use a counter).
  - **`showTranslate`:**
    - First close the note.
    - Read `toolsStatusAtom`; if it is null, `await loadTools()` and read it again.
    - Then act on `translateStep`:
      - `show`: `model.openTerminal(id)`
      - `open`: `openTool(model, tool, { place: "centre" })`
      - `install`: `installTool(model, tool)`, then `model.openTerminal(res.tabId)` when `res.ok`
      - `missing`: `console.warn`
  - Give the file a header comment in the house style: what it holds and who calls it.

- [ ] **Step 8: Run all of this task's tests and see them pass.**
Run: `npx vitest run frontend/app/view/agents/floatnote.test.ts frontend/app/view/agents/floatnotestore.test.ts frontend/app/view/agents/sproutroster.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit.**
`git commit -m "feat(float): the note and translate model: scratch saves, the translate step, the ledge's tabs"`.

### Task 4: Float note and Translate UI, binding, docs and scenario

**Depends on:** Task 2, Task 3
**Files:** `frontend/app/cockpit/float-note.tsx`, `frontend/app/cockpit/float-ledge.tsx`, `frontend/app/cockpit/float-bar.tsx`, `frontend/app/cockpit/cockpit-root.tsx`, `frontend/app/store/keybindings/bindings.ts`, `docs/keyboard-shortcuts.md`, `docs/guide/agent.md`, `scripts/cdp/scenarios.mjs`, `CHANGELOG.md`

**Interfaces:**
- **Consumes:** everything in Task 3's Produces block, and the file `cmd/wsh/cmd/trans-theme.trans` (Task 2).
- **Produces:** `FloatNote({ model }: { model: AgentsViewModel })`. The DOM hooks the scenario uses:
  - the overlay `[data-float-note]`
  - the textarea `[data-float-note-editor]`
  - the preview `[data-float-note-body]`
  - the error line `[data-float-note-error]`
  - the ledge tabs `[data-float-pin="note"]` and `[data-float-pin="translate"]`, each with `aria-pressed`
  - the bar switch `[data-float-note-view]`, holding two buttons `[data-float-note-view="edit"]` and `[data-float-note-view="preview"]`, each with `aria-pressed`
  - the global binding id `float-note`

Match every board of the canvas on the Prototype line (Design section table). Copy sizes and classes from the existing ledge tab and `ICON_BTN`.

- [ ] **Step 1: Build `frontend/app/cockpit/float-note.tsx`.**
  - The overlay is `absolute inset-0 flex flex-col bg-surface`. It holds either the textarea (Design → The editor; `spellCheck={false}`, autofocus) or, with `scratchPreviewAtom` on, a scrolling `MarkdownMessage`. The error line (`role="status"`) sits under it while `scratchErrorAtom` is set.
  - `onChange` calls `editScratch`. Escape in the textarea calls `closeFloatNote()`.
  - One effect calls `closeFloatNote()` when `model.focusIdAtom` changes (not on its first value) and on unmount.
  - The overlay calls `loadScratch()` on mount, and shows the textarea once `scratchBodyAtom` is non-null.

- [ ] **Step 2: Mount it in `cockpit-root.tsx`.** The terminal area's wrapper becomes `relative min-h-0 flex-1`. After `<CockpitShell>`, inside that wrapper, add `{floating && noteOpen ? <FloatNote model={model} /> : null}`. `CockpitShell` itself is untouched.

- [ ] **Step 3: Update the ledge (`float-ledge.tsx`).**
  - Add the fixed tabs and the divider before `data-float-tabs`. Note calls `toggleFloatNote(model)`; Translate calls `showTranslate(model)`. Each has `aria-label` and `title`: `Note (⌘⇧N)` from `useBindingKeys("float-note")`, and `Translate`.
  - An agent tab calls `closeFloatNote()` before `show(id)`, and is pressed only while the note is closed.
  - Update the file's header comment.

- [ ] **Step 4: Update the float bar (`float-bar.tsx`).** While the note is open:
  - the left side is the StickyNote icon and `Note`
  - the Edit | Preview switch is rendered before the pin
  - the close button is not rendered

- [ ] **Step 5: Add the binding and the docs.**
  - **The binding:** in `buildGlobalBindings`, add `{ id: "float-note", keys: "Mod:Shift:n", group: "Global", label: "Float the note", when: (ctx) => !ctx.modalOpen, run: () => void toggleFloatNote(model) }`, with a comment that it is a chord so it works from a focused terminal.
  - **`docs/keyboard-shortcuts.md`:** add its row next to `Shift`+`F`, naming the ledge's Note and Translate tabs.
  - **`docs/guide/agent.md`** (Vietnamese, like the rest of it):
    - Change "chín tool dựng sẵn … glow và visidata" to ten tools ending "glow, visidata và translate-shell".
    - Extend the Float row with the Note and Translate tabs and `⌘⇧N`.
    - Add the `⌘⇧N` row to its key table next to `Shift+F`.

- [ ] **Step 6: Add the `float-note` scenario** to `scripts/cdp/scenarios.mjs`, modeled on `floatMini`, and register it beside `floatMini`. It is `surface: "agent"` and not `host: true`: it asserts the DOM and the PTY size only, and the browser shim answers every window call Float makes.
  - **Arrange:**
    - Open one rail terminal (`openRailTerminal`).
    - Keep the current note (`h.rpc("notescratchread", null)`) and the user's `tools.trans` entry from `getfullconfig`.
    - Write `""` to the note.
    - Copy `cmd/wsh/cmd/trans-theme.trans` to a temp dir.
  - **Teardown** (in a `finally`, each step even if an earlier one failed):
    - Write the note back.
    - Restore the notes folder's mode.
    - Restore or remove the `trans` entry (`toolssetuser`).
    - Leave Float and close the scenario's tabs, as `floatMini` does.
  - **Steps**, with a shot for each board:
    1. **Board Terminal.** Float the terminal (`pickHeaderMenu(h, "Float window")`). `[data-float-pin="note"]`, `[data-float-pin="translate"]` and the terminal's one `[data-float-tab]` are shown. Shot `cdp-shots/float-note-terminal.png`.
    2. **Board NoteEmpty.** Click Note. `[data-float-note]` is shown with an empty editor whose placeholder starts `Write markdown…`, and there is no `[data-float-close]`. The terminal's `termsize` is unchanged. Shot `float-note-empty.png`.
    3. **Board Main.** Type `## Hôm nay`, Enter, `- Fr1` into the editor with `Input.insertText` and key events. Then:
       - the editor's value ends with `- Fr1`
       - `[data-float-bar]` is still shown (Shift+F did not leave Float)
       - after 900 ms, `notescratchread` returns the typed text
       
       Shot `float-note-edit.png`.
    4. **Board NotePreview.** Click `[data-float-note-view="preview"]`. `[data-float-note-body]` holds an `h2` reading `Hôm nay` and a list item `Fr1`. Shot `float-note-preview.png`.
    5. **Board NoteError.** Back to Edit, then:
       - With the vault root from `vaultRoot(h)` (refuse, with a failing step, when `vaultRemote(root)` is non-empty, as `notes-wsh.mjs` does), `chmodSync(<root>/notes, 0o555)` and type one character.
       - `[data-float-note-error]` shows within 2 s, its text starting `Couldn't save the note:`. Shot `float-note-error.png`.
       - Restore the mode and type another character; the error line is gone within 2 s.
    6. **Note toggling.** Clicking the terminal's tab hides the note. `Mod+Shift+N` shows it, and `Mod+Shift+N` again hides it.
    7. **Board TranslateInstall.**
       - Set `trans` with `toolssetuser` to `{ command: "arc-no-such-trans", "install:darwin": "echo Installing translate-shell; sleep 6" }`.
       - Poll `toolsstatus` until `trans` reads `found: false` (the config reload is asynchronous).
       - Click `[data-float-pin="translate"]`. A tab labeled `Install translate-shell` is in focus within 3 s. Shot `float-note-install.png`.
    8. **Board Translate.**
       - Set `trans` to `{ command: "trans", args: "-shell -no-rlwrap -theme <the temp copy>" }` and poll until `found: true`. If `trans` is not installed, the step fails with the detail `translate-shell is not installed`.
       - Click Translate. A terminal whose block meta `tool:id` is `trans` is in focus, the Translate pin is `aria-pressed="true"`, and no `[data-float-tab]` is that terminal.
       - Type `deploy` and Enter into it and wait 4 s. Shot `float-note-translate.png`.

- [ ] **Step 7: Add a CHANGELOG line** under `## Unreleased` → `### Added`, written for the user:
  - In Float, the strip under the terminal now has a **Note** tab (one markdown note that saves itself, with Preview) and a **Translate** tab that opens translate-shell, its prompt showing the language it translates into, with ↑ recalling past lookups.
  - `Cmd`+`Shift`+`N` floats the note.
  - End it with `<!-- try: float-note -->`, and add `<!-- big -->` only if the Unreleased section has fewer than 5 big lines.
  - Build the line onto `git show HEAD:CHANGELOG.md` at commit time: other sessions edit this file.

- [ ] **Step 8: Check the whole change.** Each must exit 0:
  - `NODE_OPTIONS=--max-old-space-size=4096 task check:ts`
  - `npx vitest run frontend/app/store/keybindings frontend/app/cockpit/whatsnew.test.ts frontend/app/view/agents`
  - `npx eslint` and `npx prettier --check` on this task's `.ts`/`.tsx` files
  - on a Mac, `task dev:browser`, then `node --experimental-websocket scripts/cdp/verify.mjs float-note`. Expect a PASS row for each step, and compare each shot with its board.

- [ ] **Step 9: Commit.**
`git commit -m "feat(float): Note and Translate tabs on the float's ledge, and Cmd+Shift+N floats the note"`.
