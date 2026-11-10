# Chat: your sent files as cards, your @mentions as pills, pasted and tagged content folded

**Verify:** `node scripts/verify.mjs`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs agent-chat`

Runs after queue entry q-1876 (inline visuals in Chat) has landed: it edits `markdownmessage.tsx` and `chatpane.tsx` too.

Your bubble in Chat shows a sent file as text: the composer sends attachments as a trailing block
(`composerattachments.ts:49-58`, `Attachments (read these files):` then `- <path>` lines), and the bubble prints it
as is; an `@path` you mentioned is plain text too. Images are already drawn as pictures (`chatconversation.tsx:85-95`,
`splitAttachedImages`, `launcherimages.ts:65-81`). This plan draws the files the way the canvas
`.superpowers/design/chat-file-mentions/project/Main.dc.html` ("Sent" and "Edge cases" tabs) shows: a mention is a
pill in the text, and attached files are cards under the bubble. The pills in the box while you type are a later plan
(`2026-11-10-chat-file-pills.md`); both read mentions with `filementiontokens.ts` (`mentionTokens`,
`mentionBaseName`), which is on `main` already: do not change its rule.

Decisions:

- **Parse the text you sent, do not change what is sent.** The agent reads the same message as before; only your
  bubble draws it differently. The pending bubble (`chatpane.tsx` `PendingBubble`) draws the same way, so nothing
  jumps when the transcript's copy replaces it.
- **A card opens the file in the File tab**, as a path link does (`PathLink`, `pathlinkcontext.tsx:27`); a pill
  too. A relative mention resolves against the agent's folder, as `PathLink` already does.
- **Size and "Not found" come from `FileInfoCommand`**, one call per card when it mounts; failure or `notfound`
  draws the missing card. No watcher.
- **Five cards, then "+N more"**, which unfolds in place (per bubble, not persisted).

### Task 1: The pure parts

**Depends on:** none

**Files:** `frontend/app/view/agents/chatfiles.ts`, `frontend/app/view/agents/chatfiles.test.ts`

**Step 1: Write the failing tests** for each export below: `splitAttachments` on a message with only text, with the
files block, with the images block, with both (files block, blank line, images block, as `messageWithAttachments`
writes them), with a files block whose lines are not absolute paths (left as text), and with text only before
neither; `fileTag` for `.pdf`, `.tex`, `.ts`, `.md`, `.csv`, a name with no extension, a long extension (cut to 4);
`foldCards` under, at and over the limit, open and closed.

**Step 2:** `npx vitest run frontend/app/view/agents/chatfiles.test.ts` → FAIL.

**Step 3: Implement** (pure, header comment):

```ts
export const FILES_HEADER = "Attachments (read these files):"; // composerattachments.ts writes it; import it from there if exported, else export it there
export function splitAttachments(text: string): { text: string; files: string[]; images: string[] };
// images: splitAttachedImages first (the images block is always last); then a trailing FILES_HEADER block of "- <abs path>" lines
export type FileTone = "pdf" | "code" | "doc" | "data" | "other";
export function fileTag(name: string): { tag: string; tone: FileTone }; // tag: the extension upper-cased, at most 4, "FILE" with none
// pdf → pdf; ts tsx js jsx go rs py tex sh json yaml toml css html → code; md txt docx → doc; csv tsv xlsx parquet → data
export const CARD_LIMIT = 5;
export function foldCards<T>(items: T[], open: boolean): { shown: T[]; more: number };
```

**Step 4:** the Step 2 command → PASS; eslint and prettier on both → clean.

**Step 5:** Commit: `git commit -m "feat(chat): read the files and images a sent message carries" --
frontend/app/view/agents/chatfiles.ts frontend/app/view/agents/chatfiles.test.ts`

### Task 2: Mention pills in markdown

**Depends on:** none

**Files:** `frontend/app/view/agents/remarkfilemention.ts`, `frontend/app/view/agents/remarkfilemention.test.ts`, `frontend/app/view/agents/chatfilepill.tsx`, `frontend/app/view/agents/markdownmessage.tsx`

Read `frontend/app/element/remark-mark.ts` (the pattern: a remark plugin turning text into a custom node) first.

**Step 1: Write the failing test** (`remarkfilemention.test.ts`, run the plugin through `unified().use(remarkParse)
.use(remarkFileMention)` as remark-mark's own test does, if it has one; else on a hand-built mdast): a paragraph
`see @src/app.ts and @alice` gives a `filemention` node with `data.hName = "filemention"`, `data.hProperties.path =
"src/app.ts"`, its text kept, and `@alice` stays text; nothing changes inside inline code, a code block or a link.

**Step 2:** `npx vitest run frontend/app/view/agents/remarkfilemention.test.ts` → FAIL.

**Step 3: Implement.**
- `remarkfilemention.ts`: split each text node by `mentionTokens(value)` (no caret) into text and `filemention` nodes
  (`children: [{ type: "text", value: <the @ token as written> }]`), skipping `inlineCode`, `code` and `link`
  ancestors.
- `chatfilepill.tsx`: `FilePill({ path })`, the canvas's pill: a `PathLink` (path, no line) wrapping `<span
  data-chat-file-pill={path} title={path} className="inline-flex h-5 max-w-full items-center gap-1 rounded-[6px]
  border border-edge-mid bg-surface px-1.5 align-middle text-[12.5px] leading-none text-ink-hi hover:bg-surface-hover">`
  with lucide `File` 12px `text-muted` `aria-hidden` and `<span className="max-w-[220px] truncate">
  {mentionBaseName(path)}</span>`. `align-middle` and `leading-none` matter: an inline-flex box whose first child is
  an icon aligns on the icon's bottom edge otherwise and rides high (the person's review of the canvas).
- `markdownmessage.tsx`: `MarkdownExtras.mentions?: boolean`; with it, add `remarkFileMention` to the plugins and a
  `filemention` component drawing `FilePill`; extend `componentsFor`'s key and the plugin choice (`renderMd`) so
  marks, diagrams and mentions combine; say so in the extras comment.

**Step 4:** the Step 2 command → PASS; eslint and prettier on the four → clean apart from what HEAD already fails.

**Step 5:** Commit: `git commit -m "feat(chat): an @path in markdown can draw as a file pill" -- <the four paths>`

### Task 3: Cards and pills in your bubble

**Depends on:** Task 1 (`splitAttachments`, `fileTag`, `foldCards`), Task 2 (`mentions` and `FilePill`)

**Files:** `frontend/app/view/agents/chatfilecards.tsx`, `frontend/app/view/agents/chatconversation.tsx`, `frontend/app/view/agents/narrationtimeline.tsx`, `frontend/app/view/agents/chatpane.tsx`

**Step 1: The cards** (`chatfilecards.tsx`, header comment): `ChatFileCards({ paths })`, a `flex flex-wrap justify-end
gap-2` row, `data-chat-file-cards`. Each card, the canvas's: a `button` (open the file as `PathLink` does: use the
same opener it calls) `data-chat-file-card={path}`, `title={path}`, `flex h-[46px] w-[236px] items-center gap-2.5
rounded-[8px] border border-edge-mid bg-surface px-2.5 text-left hover:bg-surface-hover`; a 30×30 tile `flex-none
rounded-[6px] bg-surface-hover font-mono text-[9.5px] font-semibold` centred, its colour by tone (pdf `text-error`,
code `text-accent-soft`, data `text-accent-soft`, doc and other `text-muted`), holding `fileTag(name).tag`; then the
name `max-w-[168px] truncate text-[12.5px] text-ink-hi` over the sub line `max-w-[168px] truncate text-[11px]
text-ink-faint`: the parent folder's name, then ` · ` and the size once `FileInfoCommand` answers (format it as the
tray does, `attachmenttray.tsx` `fmtSize`; export it from there if it is not). Missing (`notfound` or an error):
`opacity-60`, the name `line-through`, the sub line `Not found` in `text-error`, `data-chat-file-missing`; still a
button (the path can be copied from its title). `foldCards(paths, open)`: past `CARD_LIMIT` a `+N more` button
`h-[22px] rounded-[6px] border border-edge-mid px-2 text-[12px] text-muted hover:text-secondary`,
`data-chat-file-more`, unfolds.

**Step 2: The bubble** (`chatconversation.tsx` `YouBubble`): `splitAttachments(item.text)` in place of
`splitAttachedImages`; the bubble draws `said.text` with mentions (Step 3) and the pictures as now; the bubble and a
`ChatFileCards` of `said.files` (when any) stack in a `flex flex-col items-end gap-2` wrapper that keeps the bubble's
`max-w-[75%] self-end`; copy and the context menu keep the whole original text. A message that is only files draws
the cards with no empty bubble.

**Step 3: Mentions in the bubble** (`narrationtimeline.tsx` `PromptText`): an optional `mentions` prop passed to
`MarkdownMessage` as the `mentions` extra; only Chat's bubble and pending bubble pass it, so the narration timeline
and the other callers draw as before.

**Step 4: The pending bubble** (`chatpane.tsx` `PendingBubble`): the same split, pills and cards, so the bubble does
not change when the transcript's copy replaces it.

**Step 5:** eslint and prettier on the four → clean apart from what HEAD already fails (compare with `git show
HEAD:<file> | npx prettier --stdin-filepath <file>`).

**Step 6:** Commit: `git commit -m "feat(chat): your sent files show as cards and your @mentions as pills" -- <the
four paths>`

### Task 4: Pasted and tagged content as folded cards

**Depends on:** Task 3 (edits the same bubble code after it)

**Files:** `frontend/app/view/agents/chattagblocks.ts`, `frontend/app/view/agents/chattagblocks.test.ts`, `frontend/app/view/agents/chattagblock.tsx`, `frontend/app/view/agents/chatconversation.tsx`, `frontend/app/view/agents/chatpane.tsx`

A user message often carries XML-tagged blocks the person never typed as such: `<pasted_content …>…</pasted_content>`
(a paste the harness wraps), `<system-reminder>`, `<task-notification>` (already a marker, leave it),
`<command-name>` / `<command-message>` / `<command-args>`, `<local-command-stdout>`, `<local-command-caveat>`, and any
other `<tag>…</tag>` a hook or tool adds. Chat prints them raw in your bubble today. The person asked for a custom UI
for pasted content and all XML content: each block draws as a folded card.

**Step 1: Write the failing tests** (`chattagblocks.test.ts`): `splitTagged` keeps plain text as one text part; finds
a block whose open tag starts a line (attributes allowed: `<pasted_content id="a1b2">`) and whose matching close tag
ends one, returning text before, the block (`tag`, `attrs` as a record, `body` trimmed of one leading and trailing
newline) and text after; handles two blocks and a block of a tag nested in another tag's body (only the outer one
is split); leaves an unclosed tag, a tag that does not start a line, a closing tag of another name, and anything
inside a ``` fence as text; `tagLabel` maps `pasted_content` → `Pasted`, `system-reminder` → `System reminder`,
`local-command-stdout` → `Command output`, `local-command-caveat` → `Note`, `command-name` → `Command`, and any other
tag to its words capitalised (`foo_bar-baz` → `Foo bar baz`); `lineCount` counts lines.

**Step 2:** `npx vitest run frontend/app/view/agents/chattagblocks.test.ts` → FAIL.

**Step 3: Implement** `chattagblocks.ts` (pure, header comment naming the tags it was written for and that any tag
folds) with `splitTagged(text): ({ kind: "text"; text: string } | { kind: "tag"; tag: string; attrs: Record<string,
string>; body: string })[]`, `tagLabel(tag)`, `lineCount(body)`. Tag names `[A-Za-z][\w-]{0,63}`; `task-notification`
is never split (the projection turns it into a marker before it reaches a bubble).

**Step 4: The card** (`chattagblock.tsx`): `ChatTagBlock({ tag, attrs, body })`, `data-chat-tag={tag}`, a `<details>`
-like toggle drawn with a button (keyboard and `aria-expanded`), closed at first: `w-full rounded-[8px] border
border-edge-mid bg-surface`; the header `flex h-8 w-full items-center gap-2 px-3 text-[12px] text-muted
hover:text-secondary`: lucide `ClipboardPaste` 13px for `pasted_content`, `Terminal` for the `command-*` and
`local-command-*` tags, `Braces` for any other; `tagLabel(tag)`; for a paste, ` · N lines` (`lineCount`); a `flex-1`
spacer; `ChevronRight` 12px turning to `ChevronDown` when open. Open, the body under a `border-t border-edge-faint`:
`max-h-[320px] overflow-auto px-3 py-2 font-mono text-[12px] leading-[1.55] whitespace-pre-wrap text-ink-mid
[overflow-wrap:anywhere]`, with a `CopyButton` (`@/app/element/copybutton`) in its top-right corner copying `body`.
A `command-name` block whose sibling blocks are `command-message` / `command-args` draws as one card labelled with the
command (`/name args`), its body the message.

**Step 5: Wire it** in `YouBubble` and `PendingBubble`: `splitTagged(said.text)`; text parts draw as `PromptText` with
mentions as now, tag parts as `ChatTagBlock` inside the bubble, full width of the bubble, `my-1.5`. A message that is
only tag blocks keeps the bubble.

**Step 6:** the Step 2 command → PASS; eslint and prettier on the five → clean apart from what HEAD already fails.

**Step 7:** Commit: `git commit -m "feat(chat): pasted and XML-tagged content in your messages folds into cards" --
<the five paths>`

### Task 5: Scenario steps, changelog, hand check

**Depends on:** Task 3 (asserts the cards and pills), Task 4 (asserts the folded tag cards)

**Files:** `scripts/cdp/scenarios.mjs`, `CHANGELOG.md`, `docs/hand-checks.md`

**Step 1: Scenario steps** in `agent-chat` (read its header and fixture transcript writer; never run prettier on
this file), numbered 60-62. Arrange, in the scenario's temp dir: `notes.md` (a few bytes) and `paper.pdf` (a few
bytes); append to the main agent's fixture transcript one user entry: `Compare @src/app.ts with the notes\n\n
Attachments (read these files):\n- <tmp>/notes.md\n- <tmp>/paper.pdf\n- <tmp>/gone.md`, and one with eight files
(seven `<tmp>/f<N>.txt` written, one missing). Each step takes its shot:

- `agent-chat-60-file-cards`: the first bubble's text holds no "Attachments (read these files)"; `[data-chat-file-pill
  ="src/app.ts"]` reads `app.ts` and its vertical centre is within 2 px of the text line's centre (compare with a
  sibling text range's `getBoundingClientRect`); three `[data-chat-file-card]` with tags `MD`, `PDF`, `MD`, and the
  `paper.pdf` card's sub line holds a size.
- `agent-chat-61-file-missing`: the `gone.md` card has `data-chat-file-missing` and reads `Not found`.
- `agent-chat-62-file-more`: the eight-file bubble shows five cards and `+3 more`; a click shows all eight.
- `agent-chat-63-tag-blocks`: a third user entry `Look at this\n<pasted_content id="p1">\nline one\nline two\nline
  three\n</pasted_content>\n<system-reminder>\nkeep it short\n</system-reminder>` → no `<pasted_content` or
  `<system-reminder` text in the bubble; `[data-chat-tag="pasted_content"]` reads `Pasted · 3 lines`, closed; a click
  opens it and shows `line two`; `[data-chat-tag="system-reminder"]` reads `System reminder`.

**Step 2:** `node scripts/cdp/final-verify.mjs agent-chat` → every step PASS.

**Step 3: Changelog** under `Changed`: `- In Chat, the files you send show as cards under your message (type, name,
folder and size; click to open), the files you @mention as pills, and pasted or tagged content (a paste, a system
reminder, command output) as a folded card, instead of raw paths and tags.`

**Step 4: Hand check** (`docs/hand-checks.md`, top, `(arcterm)` title): send a message with a dropped PDF, a picked
`.ts` file and an `@` mention in a live Claude agent's Chat → pill and cards as the canvas draws them; a card and a
pill open the file in the File tab; delete one file → its card reads Not found after a reload.

**Step 5:** Commit: `git commit -m "test(chat): scenario steps for file cards and mention pills" --
scripts/cdp/scenarios.mjs CHANGELOG.md docs/hand-checks.md`
