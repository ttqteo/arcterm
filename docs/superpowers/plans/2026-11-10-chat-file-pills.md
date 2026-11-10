# Chat: file pills in the message box, and an @ that walks folders

**Verify:** `node scripts/verify.mjs`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs agent-chat agent-sleep launcher`

Runs after queue entry q-5783 (the full slash menu and the + menu) has landed: it rewrites the box those runs edit
(`chatcomposer.tsx`, `slashmenu.tsx`, `pickerlist.tsx`). Read the code as it is then, not as this plan quotes it.

Two things the person asked for, both in the canvas `.superpowers/design/chat-file-mentions/project/Main.dc.html`
("Typing" tab, and the Backspace case under "Edge cases"):

1. **A file you `@`-mention shows as a pill in the box** (file icon and the short name, the full path on hover),
   not as `@docs/notes/related.tex`. A `<textarea>` cannot draw a pill, so the box becomes a small rich
   editor on **Lexical 0.53.0**, which `main` already depends on (`10859ad8f`; installed in the main checkout, which
   every run worktree junctions: never run `npm install` in a run). Lexical handles IME composition, which the
   person relies on (Vietnamese Telex), better than a hand-rolled `contenteditable`.
2. **`@` walks folders**: `@../`, `@./`, `@~/`, `@D:/` or `@/` list that folder's entries, folders first, and a
   folder pick steps into it. Today `@` only ranks the project's own file list (`launchermention.ts`
   `fileMentionMatches`, `filemention.tsx` `reloadFileIndex`), and an agent outside a registered project gets no
   picker at all (`chatFilesRoot` returns `""`).

Decisions (the lead's calls, each with why):

- **The plain text stays the source of truth.** `useAgentSend`'s `text` keeps the message as the agent receives it,
  pills written as `@<path>` (quoted `@"…"` when the path holds a space). The editor is a view of that text: it
  splits it into text and pills with `mentionTokens(text, caret)` (`filementiontokens.ts`, on `main`; the bubble's
  pills use the same rule), and every edit serialises back to text and a caret. So the slash menu, the `@` picker,
  ↑ recall, the insert registries and the send path keep working on a string and offsets.
- **A pill is a Lexical `DecoratorNode`**, inline and keyboard-selectable: Backspace beside it selects it (the
  canvas's accent ring), a second Backspace deletes it whole; arrows step over it.
- **The editor looks like a textarea to its callers.** `EditorLike` is the part of `HTMLTextAreaElement` they use
  (`value`, `selectionStart`, `selectionEnd`, `readOnly`, `focus`, `setSelectionRange`, `getBoundingClientRect`), so
  the New launcher's Task box (a textarea) passes as is, and floating-ui anchors the pickers to it as a virtual
  element. Key handlers take a `KeyLike` (the fields they read), which a React keyboard event satisfies.
- **Never rebuild while composing.** An outside change to the text (a pick, recall, an insert) rebuilds the editor
  only when `editor.isComposing()` is false and the text differs from what the editor last emitted.
- **Folder walking reads the disk through wavesrv** (`RemoteListEntriesCommand`, the pattern in `canvassend.ts:80-87`),
  from the agent's folder (`cmd:cwd`), also when it is not a registered project; the project-wide ranking stays as it
  is for a bare query.

### Task 1: The editor's text model

**Depends on:** none

**Files:** `frontend/app/view/agents/chateditormodel.ts`, `frontend/app/view/agents/chateditormodel.test.ts`

**Step 1: Write the failing tests** for each export: `segmentsOf("see @src/a.ts now", 17)` → text, pill
(`src/a.ts`), text; the caret inside a still-typed token keeps it text; `mentionText` quotes a path with a space;
`plainOffset` and `locate` round-trip every offset of a text with two pills, and an offset inside a pill's text snaps
to its end.

**Step 2:** `npx vitest run frontend/app/view/agents/chateditormodel.test.ts` → FAIL.

**Step 3: Implement** (pure, header comment):

```ts
export type Segment = { kind: "text"; text: string } | { kind: "pill"; path: string };
export function mentionText(path: string): string; // `@path`, or `@"path"` when it holds whitespace
export function segmentsOf(text: string, caret?: number): Segment[]; // mentionTokens(text, caret), merged text runs
export function segmentLength(s: Segment): number; // text length, or mentionText(path).length
export function plainOffset(segments: Segment[], index: number, offset: number): number; // offset 0|1 for a pill: before|after
export function locate(segments: Segment[], plain: number): { index: number; offset: number };
```

**Step 4:** the Step 2 command → PASS; eslint and prettier → clean.

**Step 5:** Commit: `git commit -m "feat(chat): the message box's text model: text runs and file pills" --
frontend/app/view/agents/chateditormodel.ts frontend/app/view/agents/chateditormodel.test.ts`

### Task 2: `@` walks folders

**Depends on:** none

**Files:** `frontend/app/view/agents/launchermention.ts`, `frontend/app/view/agents/launchermention.test.ts`, `frontend/app/view/agents/filemention.tsx`

**Step 1: Write the failing tests** (extend `launchermention.test.ts`): `browseQuery` → `{ dir: "../", leaf: "" }`
for `../`, `{ dir: "../src/", leaf: "ap" }` for `../src/ap`, the same shapes for `./`, `~/`, `D:/x/`, `D:\x\`, `/etc/`,
and `null` for `src/ap` and `foo`; `resolveBrowseDir(base, dir, home)` joins and normalises (`..` steps up, `~` is home,
an absolute dir ignores base; forward slashes); `browseMatches(entries, leaf)` lists folders first then files, each
alphabetical case-insensitively, prefix matches before contains, hides dot-names unless `leaf` starts with `.`, at
most 50; `insertBrowsePick(text, start, caret, dir, entry)`: a folder → `@<dir><name>/` with no space and the caret
after it (the picker stays open), a file → `@<dir><name> ` as `insertFileMention` does.

**Step 2:** `npx vitest run frontend/app/view/agents/launchermention.test.ts` → FAIL.

**Step 3: Implement** the four in `launchermention.ts`. `fileMentionAt`'s pattern already stops at whitespace and
allows `/`, `\`, `.`, `~` and `:`; check it keeps `D:/` (widen it if not).

**Step 4: The picker** (`filemention.tsx`): an optional `cwd` (the agent's `cmd:cwd`); when `browseQuery(query)` is
not null, list `resolveBrowseDir(filesRoot || cwd, dir, home)` with `RemoteListEntriesCommand` (one listing per
directory, kept in state while the picker is open), and show `browseMatches`; a folder row draws lucide `Folder`, its
name with a trailing `/`, a file row `File`; Tab or Enter on a folder calls `insertBrowsePick` and keeps the list open
on the new folder; Esc closes. A listing error shows the picker's note `Cannot read <dir>`. When `filesRoot` is `""`
but `cwd` is set, browse mode works and a bare query lists nothing (as today). Pass `cwd` from the chat box
(`chatcomposer.tsx` reads `block.meta["cmd:cwd"]` already) in Task 4, not here.

**Step 5:** the Step 2 command → PASS; eslint and prettier on the three → clean apart from what HEAD already fails.

**Step 6:** Commit: `git commit -m "feat(chat): @ walks folders: ../, ~/, a drive, and into a picked folder" -- <the
three paths>`

### Task 3: The Lexical editor and its pill

**Depends on:** Task 1 (its text model)

**Files:** `frontend/app/view/agents/chateditor.tsx`, `frontend/app/view/agents/chateditorpill.tsx`

Read `node_modules/lexical` and `node_modules/@lexical/react` docs or types for `LexicalComposer`,
`PlainTextPlugin`, `ContentEditable`, `HistoryPlugin`, `DecoratorNode`, `KEY_DOWN_COMMAND`, `PASTE_COMMAND`,
`registerUpdateListener`, `isComposing`.

**Step 1: The pill node** (`chateditorpill.tsx`): `FileMentionNode extends DecoratorNode<JSX.Element>`, inline,
`isKeyboardSelectable() → true`, `getTextContent() → mentionText(path)`, JSON import/export, and `decorate()` →
`<span data-chat-pill={path} title={path} className="mx-px inline-flex h-5 max-w-[240px] items-center gap-1
rounded-[6px] border px-1.5 align-middle text-[12.5px] leading-none text-ink-hi">`: unselected `border-edge-mid
bg-surface`, selected (the node is in a `NodeSelection`) `border-accent bg-accent/12` with the icon `text-accent-soft`;
lucide `File` (or `Folder` for a path ending in a separator) 12px `text-muted` `aria-hidden`, then `<span
className="truncate">{mentionBaseName(path)}</span>`. `align-middle leading-none` keeps it centred on the text line
(the person's canvas review). `$createFileMentionNode(path)`, `$isFileMentionNode`.

**Step 2: The editor** (`chateditor.tsx`, header comment saying it is a view of plain text and why):
`ChatEditor` as a `forwardRef<EditorLike>` with props `{ value: string; onChange(text: string, caret: number): void;
onKeyDown?(e: KeyLike): void; onPasteFiles?(e: ClipboardEvent): boolean; placeholder: string; readOnly?: boolean;
className?: string; minHeight: number; maxHeight: number; dataAttrs?: Record<string, string> }`:

- `LexicalComposer` with the node, `PlainTextPlugin` with a `ContentEditable` (`data-chat-input`, `role="textbox"`,
  `aria-multiline="true"`, `aria-label="Message"`, `className` + `overflow-y-auto outline-none whitespace-pre-wrap
  [overflow-wrap:anywhere]`, `style={{ minHeight, maxHeight }}`, `leading-[1.9]` so a pill fits the line) and its
  placeholder drawn where the textarea's was, `HistoryPlugin`.
- An update listener: unless the update is tagged `"external"` or the editor is composing, read the root as
  `Segment[]` (a text node's text, a pill's path, a paragraph break as `\n`), compute the caret with `plainOffset`
  from the selection, remember the text as last emitted, call `onChange`.
- When `value` differs from the last emitted text and the editor is not composing: `editor.update(() => rebuild
  (segmentsOf(value, caretRequest)), { tag: "external" })`, the caret put back with `locate`.
- `KEY_DOWN_COMMAND` at high priority: call `onKeyDown` with a `KeyLike` wrapping the native event; return `true`
  when it called `preventDefault` (so Enter sends instead of breaking the line, and the menus get their arrows).
- `PASTE_COMMAND`: when the clipboard holds files, `onPasteFiles?.(e)` and return its answer; otherwise let
  `PlainTextPlugin` paste plain text.
- `readOnly` → `editor.setEditable(!readOnly)`.
- The `EditorLike` handle: `value` (last emitted text), `selectionStart`/`selectionEnd` (plain offsets of the current
  selection), `readOnly`, `focus(opts)`, `setSelectionRange(a, b)` (via `locate`), `getBoundingClientRect()` of the
  content-editable root.
- Export `EditorLike` and `KeyLike` types from here.

**Step 3:** eslint and prettier on both → clean.

**Step 4:** Commit: `git commit -m "feat(chat): a Lexical message editor that draws @mentions as file pills" --
frontend/app/view/agents/chateditor.tsx frontend/app/view/agents/chateditorpill.tsx`

### Task 4: The chat box uses it

**Depends on:** Task 3 (the editor), Task 2 (edits `filemention.tsx` before this task retypes it)

**Files:** `frontend/app/view/agents/chatcomposer.tsx`, `frontend/app/view/agents/slashmenu.tsx`, `frontend/app/view/agents/filemention.tsx`, `frontend/app/view/agents/pickerlist.tsx`, `frontend/app/view/agents/chatinsert.ts`

**Step 1: Retype the pickers.** `pickerlist.tsx` (`usePickerFloating`, `PickerList`) takes `RefObject<EditorLike |
null>` as its anchor (floating-ui's `setReference` accepts a virtual element with `getBoundingClientRect`);
`useSlashMenu` and `useFileMention` take `inputRef: RefObject<EditorLike | null>`, `onKeyDown(e: KeyLike)`,
`onCaret(el: EditorLike)`. A textarea satisfies both types, so the New launcher's Task box compiles unchanged: check it
with `task check:ts`.

**Step 2: Swap the textarea** in `chatcomposer.tsx` for `<ChatEditor ref={editorRef} value={text} onChange={(t, c)
=> { setText(t); slash.onCaret(editorRef.current!); mention.onCaret(editorRef.current!); }} …/>`, keeping every
handler the textarea had (the menus' keys, recall, Enter to send and Shift+Enter for a new line, Ctrl+U, paste of
files through `att.onPaste`, drop on the container) and its classes for size and type; `useGrowingTextarea` goes (the
editor grows itself between `ChatMinH` and `ChatMaxH`). Every `taRef` use becomes `editorRef`: the insert registry
(`chatinsert.ts` stays a string API; `insertAt` works on `editorRef.current.value` and its selection), the visuals
run's submit and text registries, `caretAfter`, focus calls, `readOnly` checks. Pass `cwd` to `useFileMention`.
The box keeps `data-sleeping-composer` and `data-agent-chat-composer` on its wrapper.

**Step 3:** `npx vitest run frontend/app/view/agents` (the agents folder's unit tests) → PASS; `task check:ts` → exit
0; eslint and prettier on the five → clean apart from what HEAD already fails.

**Step 4:** Commit: `git commit -m "feat(chat): the message box draws @mentions as pills" -- <the five paths>`

### Task 5: Scenario steps, changelog, hand checks

**Depends on:** Task 4 (the box the steps type into), Task 2 (the folder walk they assert)

**Files:** `scripts/cdp/scenarios.mjs`, `CHANGELOG.md`, `docs/hand-checks.md`

**Step 1: Retarget the box.** Every `agent-chat` and `agent-sleep` step that finds the box as a `textarea` (`[data-sleeping-composer] textarea`, `[data-agent-chat-composer] textarea`,
or sets `.value`) now targets `[data-chat-input]`: focus it and type with CDP `Input.insertText`, read it with
`innerText`. Keep each step's meaning; never run prettier on this file.

**Step 2: New steps** in `agent-chat`, numbered 70-73, each with its shot:

- `agent-chat-70-pill`: type `@` then part of a fixture file's name, Enter → `[data-chat-pill]` reads its base name and
  sits centred on the line (its vertical centre within 2 px of the caret line's); send → the mock records `@<path>`
  in the typed text, then `\r`.
- `agent-chat-71-pill-backspace`: with the caret after a pill, Backspace → the pill shows the selected look
  (`border-accent`); Backspace again → no pill and the box's text has no `@`.
- `agent-chat-72-at-folders`: in the scenario's temp dir as the agent's `cmd:cwd` (or a folder the fixture already
  uses), type `@../` → rows for the parent's entries, folders first with a trailing `/`; Tab on a folder → the box reads
  `@../<folder>/` and the list shows that folder's entries.
- `agent-chat-73-recall-pills`: ↑ in the empty box after step 70's send → the recalled text shows the pill again.

**Step 3:** `node scripts/cdp/final-verify.mjs agent-chat agent-sleep launcher` → every step PASS.

**Step 4: Changelog** under `Changed`: `- Chat's message box shows a file you @mention as a pill, and @ walks folders:
type @../ or @D:/ to browse, Tab to step into a folder.`

**Step 5: Hand checks** (`docs/hand-checks.md`, top, `(arcterm)` titles): (a) type Vietnamese with Telex in the box,
before and after a pill, and with the `/` and `@` menus open: no lost or doubled letters, the caret stays put; (b)
paste a screenshot (an attachment chip), paste text (plain, no formatting), Alt-drop a file from the tree (its
`@mention` lands as a pill); (c) a long message scrolls inside the box past its max height, Shift+Enter breaks a line,
undo and redo work; (d) a sleeping agent's box wakes it with a pill in the message.

**Step 6:** Commit: `git commit -m "test(chat): scenario steps for file pills and the folder walk" --
scripts/cdp/scenarios.mjs CHANGELOG.md docs/hand-checks.md`
