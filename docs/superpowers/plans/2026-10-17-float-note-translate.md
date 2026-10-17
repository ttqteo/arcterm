# Float Note and Translate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In Float, the strip under the terminal (the ledge) gets two fixed tabs: **Note**, one global markdown scratch note, and **Translate**, a translate-shell terminal.

**Architecture:** The note is a markdown file in the vault (`<vault>/notes/scratch.md`). wavesrv reads and writes it through two new wshrpc commands. In Float, a `FloatNote` overlay covers the terminal area. The terminal stack stays mounted under it, so the terminal never refits or replays. translate-shell becomes a built-in tool in `pkg/arctools`. The Translate tab shows the trans tool's terminal if one is open, and otherwise opens or installs it through the existing tool actions.

**Tech Stack:** Go (notestore, wshrpc, arctools), React 19 + jotai + Tailwind 4, vitest, CDP scenario harness.

**Spec:** There is no separate spec file. The design was agreed in chat on 2026-10-17 and is restated in the Design section below, so the plan carries it.

**Verify:** `node scripts/verify.mjs ./pkg/notestore ./pkg/arctools ./pkg/wshrpc/...`

**Final:** `node scripts/cdp/final-verify.mjs float-note`

## Design

- **Fixed tabs.** In Float, the ledge (`frontend/app/cockpit/float-ledge.tsx`) shows two icon-only tabs at its left, before the agent and terminal tabs: Note (lucide `StickyNote`) and Translate (lucide `Languages`). A thin divider separates them from the agent tabs. Because these tabs are always there, the agent and terminal tabs show even when only one agent floats, so there is always a way back to it.
- **The Note overlay.**
  - Picking Note sets `floatNoteOpenAtom` and draws `FloatNote` over the terminal area. It never changes `focusIdAtom`, which stays "the one selected agent" (AGENTS.md).
  - The note closes when focus changes by any route (a ledge tab, Ctrl+Tab, j/k…), when a ledge agent tab is clicked, when Escape is pressed in the editor, and when Float ends.
  - Re-entering Float shows the terminal, not the note.
- **One global note.** It is stored at `<vault>/notes/scratch.md`, raw markdown with no title heading. `notestore.List` already skips it, because `scratch` does not match the dated note id. The note is not part of the palette's Notes.
- **The editor.**
  - It opens in Edit mode: a monospace textarea with placeholder `Write markdown…`.
  - A Preview toggle in the float bar renders the note with `MarkdownMessage` (`frontend/app/view/agents/markdownmessage`), as the palette's notes do.
  - The note saves itself 500 ms after the last keystroke, and at once when the note closes. If two places edit at once, the last write wins. A failed save keeps the text and shows a one-line error; the next edit retries.
- **The float bar while on Note.** The title reads "Note" with the StickyNote icon. A Preview/Edit toggle shows, and the close (X) does not. Pin, Leave float and Hide stay.
- **The `float-note` binding.** `float-note`, `Mod:Shift:n`, is a global binding. Pressed outside Float, or in Float on a terminal, it opens Float straight on the Note. Pressed in Float on the Note, it goes back to the terminal.
- **The built-in tool.** translate-shell is added as a built-in tool:
  - id `trans`, name `translate-shell`, category `Docs and data`
  - purpose `Translate: a word with its dictionary entry, or whole sentences`
  - command `trans`, args `-shell`, opens in `home`, shows `centre`
  - Darwin install `brew install translate-shell`, no Windows line
  
  A user's `tools.json` overrides the args (the person sets `-shell :en+vi` themselves, after the run).
- **The Translate tab.**
  - If a terminal with `toolId === "trans"` exists, the tab focuses it. Otherwise it opens the tool with `place: "centre"` if `trans` is on PATH, or runs the tool's install and shows that terminal if it is not.
  - The trans terminal is left out of the ledge's agent and terminal tabs, because it lives in the fixed slot. It stays in the Ctrl+Tab switcher and the sidebar.
  - The Translate tab is pressed while the trans terminal is in focus and the note is closed.
- **Not included:** the Note outside Float, more than one global note, translating a selection, Google account features, Windows.

## Global Constraints

- Colors come from `@theme` tokens (`frontend/tailwindsetup.css`); no raw hex or rgba in components. Prefer Tailwind.
- The Agent surface's terminal stack is never rendered conditionally and never re-parented: the note overlays it and does not replace `CockpitShell`.
- `focusIdAtom` stays the one selected agent; nothing in this plan writes it except the existing tool and terminal routes.
- Never hand-edit generated files; run `task generate` after changing a wshrpc type.
- Typecheck with `NODE_OPTIONS=--max-old-space-size=4096 task check:ts`, using a timeout of at least 5 minutes. Never use `npx tsc`.
- Run prettier and eslint only on the files you touched; never run prettier on `scripts/*.mjs`; never `--write` the tree.
- Commits carry no Co-Authored-By or other attribution lines.

## Review Focus

1. **Typing in the note:** capital letters and single keys (`F`, `r`, digits) must type into the note and never fire a single-key Agent binding, such as `Shift:f` toggling Float or `r` opening Review. Pinned by Task 4 Step 6, scenario step 3.
2. **A save that fails** (backend down): the text stays in the editor, an error line shows, and the next edit retries. Pinned by Task 3, the `editScratch` failure test.
3. **The read resolving after typing began:** the read must not overwrite what was typed. Pinned by Task 3, the `loadScratch` race test.
4. **Leaving with a save pending** (switching tab, Leave float, the binding): the edit is saved at once, not lost. Pinned by Task 3, the `closeFloatNote` flush test; the overlay calls `closeFloatNote` on unmount.
5. **Only one agent in Float:** its tab still shows, so you can get back from Note or Translate. Pinned by Task 3, the `floatTabs` single-agent test.

---

### Task 1: Scratch note storage and RPC

**Depends on:** none
**Files:** `pkg/notestore/notestore.go`, `pkg/notestore/notestore_test.go`, `pkg/wshrpc/wshrpctypes_note.go`, `pkg/wshrpc/wshserver/wshserver_note.go`, `pkg/wshrpc/wshclient/wshclient.go`, `frontend/app/store/wshclientapi.ts`, `frontend/types/gotypes.d.ts`

**Interfaces:**
- Produces (Go): `notestore.ReadScratch() (string, error)` returns `""` when the file is missing; `notestore.WriteScratch(body string) error` writes `body` byte for byte to `<vault>/notes/scratch.md`.
- Produces (RPC): `NoteScratchReadCommand(ctx context.Context) (string, error)` and `NoteScratchWriteCommand(ctx context.Context, data CommandNoteScratchWriteData) error` on `NoteCommands`, with `type CommandNoteScratchWriteData struct { Body string \`json:"body"\` }`. `Body` has no `omitempty`, so an empty write clears the note.
- Produces (TS, generated): `RpcApi.NoteScratchReadCommand(client): Promise<string>` and `RpcApi.NoteScratchWriteCommand(client, { body }): Promise<void>`.

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

- [ ] **Step 3: Implement `ReadScratch` and `WriteScratch` in `pkg/notestore/notestore.go`.** Add a `scratchFile = "scratch.md"` const and a `scratchPath()` beside `notesDir()`. `WriteScratch` takes `mu` and calls the existing `write(path, []byte(body))` (atomic write plus `wavevault.Poke`). `ReadScratch` takes `mu`, returns `""` on `fs.ErrNotExist`, and otherwise returns the content with no trimming. Add one comment line to the package doc: the scratch note is `notes/scratch.md`, kept out of `List`.

- [ ] **Step 4: Run the tests and see them pass.**
Run: `go test ./pkg/notestore`
Expected: PASS (the old tests too).

- [ ] **Step 5: Add the two commands.** Add them to `NoteCommands` in `pkg/wshrpc/wshrpctypes_note.go`, with `CommandNoteScratchWriteData`, and implement them in `pkg/wshrpc/wshserver/wshserver_note.go` as one-line calls into notestore, following the existing four.

- [ ] **Step 6: Regenerate the bindings and build.**
Run: `task generate && go build ./cmd/... ./pkg/...`
Expected: exit 0. `git diff --stat` shows `wshclientapi.ts`, `wshclient.go` and `gotypes.d.ts` changed only by the two commands and their data type.

- [ ] **Step 7: Commit.**
`git commit -m "feat(notes): one scratch note, read and written over wshrpc"` (the files on the Files line).

### Task 2: translate-shell as a built-in tool

**Depends on:** none
**Files:** `pkg/arctools/catalog.go`, `pkg/arctools/catalog_test.go`

**Interfaces:**
- Produces: a built-in `Tool` with `Id: "trans"`, which the frontend sees in `toolsStatusAtom` as a `ToolStatus` with `id: "trans"`.

- [ ] **Step 1: Write the failing test.** In `TestBuiltinOrder`, append `"trans"` to `want` after `"visidata"`, and add this check to the loop:

```go
if tool.Id == "trans" && (tool.Command != "trans" || tool.Args != "-shell" || tool.OpensIn != "home" ||
	tool.Install.Darwin != "brew install translate-shell" || tool.Install.Windows != "") {
	t.Errorf("trans: %+v", tool)
}
```

- [ ] **Step 2: Run it and see it fail.**
Run: `go test ./pkg/arctools -run 'Builtin'`
Expected: FAIL, `got 9 built-ins, want 10`.

- [ ] **Step 3: Add the entry** after visidata in `Builtin()`, with the field values from the Design section. Update the doc comment's "every other tool has a Windows and a Mac line" sentence to name both visidata and translate-shell as Mac-only (translate-shell has no winget package).

- [ ] **Step 4: Run the tests and see them pass.**
Run: `go test ./pkg/arctools`
Expected: PASS.

- [ ] **Step 5: Commit.**
`git commit -m "feat(tools): translate-shell joins the tool library"`.

### Task 3: Float note and Translate model and store

**Depends on:** Task 1
**Files:** `frontend/app/view/agents/floatnote.ts`, `frontend/app/view/agents/floatnote.test.ts`, `frontend/app/view/agents/floatnotestore.ts`, `frontend/app/view/agents/floatnotestore.test.ts`, `frontend/app/view/agents/sproutroster.ts`, `frontend/app/view/agents/sproutroster.test.ts`

**Interfaces:**
- Consumes: `RpcApi.NoteScratchReadCommand` and `RpcApi.NoteScratchWriteCommand` (Task 1); `enterFloat(model)` and `floatModeAtom` from `./floatstore`; `toolsStatusAtom`, `loadTools()`, `openTool(model, tool, { place })` and `installTool(model, tool)` from `./toolsstore`; `model.openTerminal(id)`, `model.terminalsAtom` and `model.focusIdAtom`.
- Produces in `floatnote.ts` (pure):
  - `TRANSLATE_TOOL_ID = "trans"`
  - `SCRATCH_SAVE_MS = 500`
  - `isTranslateTerminal(a: Pick<AgentVM, "toolId">): boolean`
  - `type TranslateStep = { kind: "show"; id: string } | { kind: "open"; tool: ToolStatus } | { kind: "install"; tool: ToolStatus } | { kind: "missing" }`
  - `translateStep(terminals: readonly AgentVM[], tools: readonly ToolStatus[] | null): TranslateStep`
- Produces in `floatnotestore.ts`:
  - Atoms: `floatNoteOpenAtom: PrimitiveAtom<boolean>`, `scratchBodyAtom: PrimitiveAtom<string | null>` (null until read), `scratchErrorAtom: PrimitiveAtom<string | null>`, `scratchPreviewAtom: PrimitiveAtom<boolean>`.
  - Functions: `loadScratch(): Promise<void>`, `editScratch(body: string): void`, `flushScratch(): Promise<void>`, `openFloatNote(model: AgentsViewModel): Promise<void>`, `closeFloatNote(): void`, `toggleFloatNote(model: AgentsViewModel): Promise<void>`, `showTranslate(model: AgentsViewModel): Promise<void>`.
- Changes `floatTabs` in `sproutroster.ts`: it leaves out `isTranslateTerminal` terminals, and it returns tabs when one or more remain (it used to need two). `floatTabOrder` is unchanged, so the Ctrl+Tab switcher still lists the trans terminal.

- [ ] **Step 1: Write the failing pure tests.**
  - In `floatnote.test.ts`:
    - `translateStep` returns `show` with the id of the first terminal whose `toolId` is `"trans"`.
    - It returns `open` when there is no such terminal and the `trans` status has `found: true`.
    - It returns `install` when `found: false`.
    - It returns `missing` when `tools` is null, and when the catalog has no `trans`.
    - `isTranslateTerminal({ toolId: "trans" })` is true; `{}` and `{ toolId: "lazygit" }` are false.
  - In `sproutroster.test.ts`:
    - Replace `"shows no tabs for a float with nothing to switch to"` with `"shows the one agent's tab, the way back from Note and Translate"`, which expects one shown tab.
    - Add `"leaves the translate terminal out of the ledge's tabs"`: a terminal with `toolId: "trans"` is in neither `shown` nor `rest`.
    - Add `"floatTabOrder keeps the translate terminal for the switcher"`.

- [ ] **Step 2: Run them and see them fail.**
Run: `npx vitest run frontend/app/view/agents/floatnote.test.ts frontend/app/view/agents/sproutroster.test.ts`
Expected: FAIL (the module is missing; the old one-tab rule fails).

- [ ] **Step 3: Implement `floatnote.ts` and the `floatTabs` change.** `floatTabs` filters the terminals before `floatTabOrder`'s result is cut. Update its doc comment: no tabs only when nothing at all floats.

- [ ] **Step 4: Run the pure tests and see them pass.**
Run: the same command as Step 2.
Expected: PASS.

- [ ] **Step 5: Write the failing store tests** in `floatnotestore.test.ts`. Mock `@/app/store/wshclientapi`, `@/app/store/wshrpcutil` (as `palette-notesstore.test.ts` does), `./floatstore` (`enterFloat: vi.fn()`, `floatModeAtom: atom(false)`) and `./toolsstore`, and use `vi.useFakeTimers()`.
  - `"editScratch saves once, SCRATCH_SAVE_MS after the last edit"`:
    - edit `"a"` at 0 ms, then `"ab"` at 300 ms
    - at 799 ms, no write
    - at 800 ms, exactly one `NoteScratchWriteCommand` call with `{ body: "ab" }`
  - `"closeFloatNote saves a pending edit at once and closes"`:
    - edit `"x"`, then `closeFloatNote()` without advancing time
    - expect one write with `{ body: "x" }`, and `floatNoteOpenAtom` false
    - after advancing 1000 ms, still only one write
  - `"a failed save keeps the text, shows an error, and the next edit retries"`:
    - the first write rejects, so `scratchBodyAtom` is still `"x"` and `scratchErrorAtom` is non-null
    - after the next edit's save resolves, `scratchErrorAtom` is null
  - `"loadScratch does not overwrite an edit made while it was reading"`:
    - the read resolves `"old"` after `editScratch("new")`
    - `scratchBodyAtom` stays `"new"`
  - `"openFloatNote reads the note each time and enters Float when not floating"`:
    - two opens make two `NoteScratchReadCommand` calls
    - `enterFloat` is called when `floatModeAtom` is false and not when it is true
  - `"toggleFloatNote goes back to the terminal from the open note"`:
    - with `floatModeAtom` true and the note open, the toggle sets `floatNoteOpenAtom` false and does not call `enterFloat`

- [ ] **Step 6: Run them and see them fail.**
Run: `npx vitest run frontend/app/view/agents/floatnotestore.test.ts`
Expected: FAIL (the module is missing).

- [ ] **Step 7: Implement `floatnotestore.ts`.**
  - **Saving:** one module-level debounce timer and one pending body. `flushScratch` clears the timer and writes the pending body if there is one. `closeFloatNote` calls `void flushScratch()`, then sets the open atom false and Preview off.
  - **Loading:** `loadScratch` skips setting the body when an edit is pending or was made after the read began (use a counter).
  - **`showTranslate`:**
    - First close the note.
    - Read `toolsStatusAtom`; if it is null, `await loadTools()` and read it again.
    - Then act on `translateStep`:
      - `show`: `model.openTerminal(id)`
      - `open`: `openTool(model, tool, { place: "centre" })`
      - `install`: `installTool(model, tool)`, then `model.openTerminal(res.tabId)` when `res.ok`
      - `missing`: `console.warn` and nothing more
  - Write a header comment in the house style: what the file holds and who calls it.

- [ ] **Step 8: Run all of this task's tests and see them pass.**
Run: `npx vitest run frontend/app/view/agents/floatnote.test.ts frontend/app/view/agents/floatnotestore.test.ts frontend/app/view/agents/sproutroster.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit.**
`git commit -m "feat(float): the note and translate model: scratch saves, the translate step, the ledge's tabs"`.

### Task 4: Float note and Translate UI, binding and scenario

**Depends on:** Task 2, Task 3
**Files:** `frontend/app/cockpit/float-note.tsx`, `frontend/app/cockpit/float-ledge.tsx`, `frontend/app/cockpit/float-bar.tsx`, `frontend/app/cockpit/cockpit-root.tsx`, `frontend/app/store/keybindings/bindings.ts`, `docs/keyboard-shortcuts.md`, `scripts/cdp/scenarios.mjs`, `CHANGELOG.md`

**Interfaces:**
- Consumes: everything in Task 3's Produces block.
- Produces: `FloatNote({ model }: { model: AgentsViewModel })`. The DOM hooks the scenario uses:
  - the overlay `[data-float-note]`, the textarea `[data-float-note-editor]`, the preview `[data-float-note-body]`, the error line `[data-float-note-error]`
  - the ledge tabs `[data-float-pin="note"]` and `[data-float-pin="translate"]` (with `aria-pressed`)
  - the bar toggle `[data-float-note-preview]`
  - the global binding id `float-note`

- [ ] **Step 1: Build `frontend/app/cockpit/float-note.tsx`.**
  - The overlay is `absolute inset-0` over the terminal area, with a token background. It shows the textarea (monospace, `spellCheck={false}`, autofocus, placeholder `Write markdown…`) or, with `scratchPreviewAtom` on, a scrolling `MarkdownMessage`. The error line shows under it when `scratchErrorAtom` is set.
  - `onChange` calls `editScratch`. Escape in the textarea calls `closeFloatNote()`.
  - One effect subscribes to `model.focusIdAtom` and calls `closeFloatNote()` on a change (not on the first value), and calls `closeFloatNote()` on unmount.

- [ ] **Step 2: Mount it in `cockpit-root.tsx`.** The terminal area's wrapper becomes `relative min-h-0 flex-1`. After `<CockpitShell>`, inside that wrapper, render `{floating && noteOpen ? <FloatNote model={model} /> : null}`. `CockpitShell` itself is untouched.

- [ ] **Step 3: Update the ledge (`float-ledge.tsx`).**
  - Render the two fixed tabs and a divider before `data-float-tabs`. They are icon-only buttons, 26px tall, in the style of the agent tabs, with `aria-label` and `title` `Note` and `Translate`.
  - Note's `onClick` calls `toggleFloatNote(model)`; Translate's calls `showTranslate(model)`.
  - An agent tab's `onClick` calls `closeFloatNote()` before `show(id)`, and its pressed state becomes `a.id === focusId && !noteOpen`.
  - Update the file's header comment to describe the fixed tabs.

- [ ] **Step 4: Update the float bar (`float-bar.tsx`).**
  - While the note is open, the left side shows the StickyNote icon and `Note` instead of the agent's dot, name and state.
  - A toggle button `data-float-note-preview` (icon `Eye` with label `Preview` while editing; `Pencil` with label `Edit` while previewing) flips `scratchPreviewAtom`.
  - The close button is not rendered. Pin, Leave float and the Mac − stay as they are.

- [ ] **Step 5: Add the binding and its docs.**
  - In `buildGlobalBindings`, add `{ id: "float-note", keys: "Mod:Shift:n", group: "Global", label: "Float the note", when: (ctx) => !ctx.modalOpen, run: () => void toggleFloatNote(model) }`, with a one-line comment saying it is a chord so it works from a focused terminal.
  - Add its row to `docs/keyboard-shortcuts.md` next to `Shift`+`F`, and mention the ledge's Note and Translate tabs in that row.

- [ ] **Step 6: Add the `float-note` scenario** to `scripts/cdp/scenarios.mjs`, next to `floatMini` and modeled on it, and register it in the scenario list beside `floatMini`. It is `surface: "agent"` and not `host: true`: it asserts only the DOM and the PTY size, and the browser shim answers every window call Float makes.
  - **Arrange:** open one rail terminal (`openRailTerminal`) and keep the current note (`h.rpc("notescratchread", null)`) in the context.
  - **Teardown:** write that note back, leave Float, and close the scenario's tabs as `floatMini` does.
  - **Steps:**
    1. Floating the terminal (`pickHeaderMenu(h, "Float window")`) shows `[data-float-pin="note"]`, `[data-float-pin="translate"]` and the one terminal's `[data-float-tab]`.
    2. Clicking Note shows `[data-float-note]`. The bar reads `Note` and has no `[data-float-close]`. The terminal's `termsize` is unchanged. Shot `cdp-shots/float-note-edit.png`.
    3. Type `# Hello` then Enter then `- Fr1` with `Input.insertText` and key events into the editor. The textarea's value ends with `- Fr1`, `[data-float-bar]` is still shown (Shift+F did not leave Float), and after 900 ms `notescratchread` returns the typed text.
    4. `[data-float-note-preview]` renders an `h1` reading `Hello` in `[data-float-note-body]`. Shot `cdp-shots/float-note-preview.png`.
    5. Clicking the terminal's tab hides the note. `Mod+Shift+N` shows it again, and `Mod+Shift+N` once more hides it.
    6. Clicking `[data-float-pin="translate"]` does one of two things, depending on `trans` in the tools status (`(await h.rpc("toolsstatus", null)).tools.find((t) => t.id === "trans").found`): if `trans` is found, a terminal whose block meta `tool:id` is `trans` gets focus and the pin is `aria-pressed="true"`; otherwise an install terminal opens. Shot `cdp-shots/float-note-translate.png`.

- [ ] **Step 7: Add a CHANGELOG line** under `## Unreleased` → `### Added`, written for the user. It says that in Float the strip under the terminal now has a Note tab (one markdown note that saves itself, with Preview) and a Translate tab that opens translate-shell, and that `Cmd`+`Shift`+`N` floats the note. End it with `<!-- try: float-note -->`. Add `<!-- big -->` only if the Unreleased section has fewer than 5 big lines (`whatsnew.test.ts` enforces this).

- [ ] **Step 8: Check the whole change.**
Run, each to exit 0:
  - `NODE_OPTIONS=--max-old-space-size=4096 task check:ts`
  - `npx vitest run frontend/app/store/keybindings frontend/app/cockpit/whatsnew.test.ts frontend/app/view/agents`
  - `npx eslint` and `npx prettier --check` on the `.ts`/`.tsx` files of this task
  - on a Mac, `task dev:browser`, then `node --experimental-websocket scripts/cdp/verify.mjs float-note`, expecting a PASS row for every step; look at the three shots

- [ ] **Step 9: Commit.**
`git commit -m "feat(float): Note and Translate tabs on the float's ledge, and Cmd+Shift+N floats the note"`.
