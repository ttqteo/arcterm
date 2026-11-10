# Chat: skim highlights, a skim toggle, and the scroll after a send

**Verify:** `node scripts/verify.mjs`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs agent-chat`

Runs after run 009fc1e8 (agent chat document view) has landed: it edits the same chat files.

Three things the person found in Chat:

1. **Skim highlights never show.** The skim mod (`claude/skim-mod/hooks/register.ts:135-163`) strips the `==…==`
   marks from a reply before Claude Code stores it, and keeps the marked sentences apart in its plugin store, under
   the hash of the stored text. Chat reads the transcript, so it never sees a mark. The store is the JSON file
   `~/.claude/plugins/store/skim_<suffix>.json` (the suffix varies by install; today `skim_inline-2e2b7f082d52.json`),
   shaped `{ "highlightMarks": [[hash, [sentence, …]], …] }`, at most 500 entries, newest last
   (`keepMarks`, `claude/skim-mod/hooks/highlight-core.ts:146-149`). The hash is `hashText` of the stored block text
   (`highlight-core.ts:136-143`); Chat's prose part text is exactly that block text
   (`transcriptprojection.ts:172-173` pushes `block.text` as is). The mod writes the store before the transcript
   line (it awaits `$.store.set` before `next(e)`), so reading the store again whenever the transcript grows finds
   the marks of the newest reply.
2. **A quick skim toggle at the top of Chat**, to turn the highlights off when the person does not want them.
3. **Sending does not scroll to the end** when the person had scrolled up: the stick-to-bottom only follows while
   already at the bottom.

Decisions (the lead's calls, each with why):

- **The frontend reads the store file itself** (`RemoteListEntriesCommand` to list `~/.claude/plugins/store`,
  `FileInfoCommand` + `FileReadCommand` to read, the pattern in `canvassend.ts:80-87` and
  `appsuggeststore.ts:43-53`; `homeDir()` from `pathlinkroute.ts:75`). No new wshrpc command: nothing to generate,
  and the file is small (≤ 500 entries).
- **`hashText` is copied, not imported**, into the pure model: `claude/` is outside the frontend's tsconfig. Its test
  pins vectors computed with the mod's own function, so a drift fails.
- **The toggle is Chat's own, global and persisted** (localStorage `chat.skim`, default on, per-viewer convenience
  wrapped in try/catch). It does not type `/skim` into the agent: that is the terminal's fold and dim, per session,
  and typing a command into the agent from a display toggle would add a command row to its conversation.
- **The toggle sits in the chat pane's top-right corner**, floating over the scroller; the pinned prompt bar in Chat
  leaves room for it on the right so they never overlap.
- **A dev hook stands in for the store in scenarios** (`window.__chatSkimStore`, DEV only, the pattern of
  `window.__lineReviewSink` in `linereviewsend.ts:19-26`): Final's dev app reads the person's real home, so the
  scenario injects its own marks.

### Task 1: Skim marks in Chat, and the toggle

**Depends on:** none

**Files:** `frontend/app/view/agents/chatskim.ts`, `frontend/app/view/agents/chatskim.test.ts`, `frontend/app/view/agents/chatskimstore.ts`, `frontend/app/view/agents/chatconversation.tsx`, `frontend/app/view/agents/chatpane.tsx`

**Step 1: Write the failing tests** (`chatskim.test.ts`):

```ts
import { describe, expect, it } from "vitest";
import { hashText, marksByHash, withMarks } from "./chatskim";

describe("hashText", () => {
    it("matches the skim mod's hash", () => {
        // computed with claude/skim-mod/hooks/highlight-core.ts hashText on 2026-11-10
        expect(hashText("")).toBe("811c9dc50");
        expect(hashText("hello")).toBe("4f9f2cab5");
        expect(hashText("Skim ở chế độ chat: không mất.")).toBe("a9b9f3a81e");
    });
});

describe("marksByHash", () => {
    it("merges the files' entries, a later file winning a shared hash", () => {
        const a = JSON.stringify({ highlightMarks: [["h1", ["one"]], ["h2", ["two"]]] });
        const b = JSON.stringify({ highlightMarks: [["h2", ["TWO"]]] });
        const m = marksByHash([a, b]);
        expect(m.get("h1")).toEqual(["one"]);
        expect(m.get("h2")).toEqual(["TWO"]);
    });
    it("skips a file that is not JSON or not the shape", () => {
        expect(marksByHash(["{", JSON.stringify({ other: 1 }), JSON.stringify({ highlightMarks: [[1, "x"]] })]).size).toBe(0);
    });
});

describe("withMarks", () => {
    it("wraps each marked sentence in ==…==", () => {
        expect(withMarks("First. Second one. Third.", ["Second one."])).toBe("First. ==Second one.== Third.");
    });
    it("leaves a sentence it cannot find, and an empty list, as is", () => {
        expect(withMarks("Text.", ["Missing."])).toBe("Text.");
        expect(withMarks("Text.", [])).toBe("Text.");
    });
    it("never marks inside a code fence or inline code", () => {
        const text = "```\nSame.\n```\nSame.";
        expect(withMarks(text, ["Same."])).toBe("```\nSame.\n```\n==Same.==");
        expect(withMarks("`Same.` Same.", ["Same."])).toBe("`Same.` ==Same.==");
    });
    it("marks a sentence in a list item, keeping its bullet", () => {
        expect(withMarks("- Do this now.\n- Later.", ["Do this now."])).toBe("- ==Do this now.==\n- Later.");
    });
});
```

**Step 2:** `npx vitest run frontend/app/view/agents/chatskim.test.ts` → FAIL (module missing).

**Step 3: Implement `chatskim.ts`** (pure, header comment saying what it is and that `hashText` mirrors the mod's):
`hashText` copied verbatim from `highlight-core.ts:136-143`; `marksByHash(files: string[]): Map<string, string[]>`
parsing each, keeping only `[string, string[]]` pairs (the mod's `isKept` check, `register.ts:63-68`), later files
overriding; `withMarks(text, marks)`: for each mark, wrap its first occurrence that lies outside fenced blocks (lines
between ```` ``` ```` / `~~~`) and outside inline code spans, and not already inside `==`. If the mark text itself
contains markdown the stored text also contains (bold, a link), the substring match still works; a mark not found is
skipped. Return the text unchanged when `marks` is empty.

**Step 4:** `npx vitest run frontend/app/view/agents/chatskim.test.ts` → PASS.

**Step 5: The store** (`chatskimstore.ts`): a jotai atom holding the `Map` (empty at first) and the toggle:
- `chatSkimOnAtom`: boolean from localStorage `chat.skim` (default `true`), written on change; every access in
  try/catch.
- `refreshSkimMarks()`: throttled to once per second; in DEV, when `window.__chatSkimStore` is an array of JSON
  strings, use it instead of the disk; else list `<home>/.claude/plugins/store` (`homeDir()` from
  `pathlinkroute.ts`; path joined with `/`, which the server accepts on Windows too, as other `~/.claude` paths in
  this folder do), take the names starting `skim_` and ending `.json`, skip a file over 2 MB, read the rest and set
  the atom to `marksByHash(texts)`. Any failure leaves the atom as it was.
- `useSkimMarks(text: string): string[]`: the marks for `hashText(text)` while the toggle is on, else `[]`.
- Declare `window.__chatSkimStore?: string[]` in a `declare global` block, as `linereviewsend.ts:52-57` does.

**Step 6: Draw them.** In `chatconversation.tsx`, the prose part renders `withMarks(part.text, marks)` into
`CouncilText` (which already draws `==…==` as the skim highlight, `markdownmessage.tsx` `marks`). Do it in a small
component (`ProseText`) so the hook runs per part. In `chatpane.tsx`, call `refreshSkimMarks()` on mount and whenever
`entries` changes (the transcript grew), so the newest reply's marks arrive with it.

**Step 7: The toggle.** In `chatpane.tsx`, a button in the chat area's top-right corner, `absolute right-3 top-2
z-20`, 26×26, `rounded-[8px] border border-edge-mid bg-surface-raised`, lucide `Highlighter` 13px; on:
`text-warning` icon (the highlight's own hue, `bg-warning/25` is its fill in `markdownmessage.tsx`) and
`aria-pressed="true"`; off: `text-muted`, `aria-pressed="false"`. `data-chat-skim-toggle`,
`title="Skim highlights in Chat: on (click to turn off)"` / `"…: off (click to turn on)"`, `aria-label="Skim
highlights"`. It shows only when the conversation has prose. The pinned prompt bar in Chat gets right padding
(`pr-10` on its wrapper, or a prop on `PinnedPromptBar` used only by Chat) so it never runs under the toggle.

**Step 8:** vitest for `chatskim.test.ts` → PASS; eslint and prettier on the five files → clean.

**Step 9:** Commit: `git commit -m "feat(chat): skim highlights show in Chat, with a toggle to turn them off" --
<the five paths>`

### Task 2: Sending scrolls to the end

**Depends on:** Task 1 (edits `chatpane.tsx` after it, beside the toggle it adds)

**Files:** `frontend/app/view/agents/chatcomposer.tsx`, `frontend/app/view/agents/chatpane.tsx`

`ChatPane` has `jumpToBottom` from `useStickToBottom` (`chatpane.tsx`, beside `scrollRef`). `ChatComposer`'s
`submit` (`chatcomposer.tsx`, `if (send()) { … }`) never scrolls.

**Step 1:** `ChatComposer` takes `onSent?: () => void` and calls it right after `send()` returns true, before the
pending bubble is added (so the stick re-arms and the bubble lands in view). A wake send (asleep) counts too.

**Step 2:** `ChatPane` passes `onSent={jumpToBottom}`, keeping Task 1's toggle and refresh as they are.

**Step 3:** eslint and prettier on both files → clean.

**Step 4:** Commit: `git commit -m "fix(chat): sending a message scrolls the chat to the end" --
frontend/app/view/agents/chatcomposer.tsx frontend/app/view/agents/chatpane.tsx`

### Task 3: Scenario steps, changelog, hand checks

**Depends on:** Task 1 (asserts the marks and the `data-chat-skim-toggle` it adds), Task 2 (asserts the scroll after a send it adds)

**Files:** `scripts/cdp/scenarios.mjs`, `CHANGELOG.md`, `docs/hand-checks.md`

**Step 1: Scenario steps** in the `agent-chat` scenario (`scripts/cdp/scenarios.mjs`), each with its shot:
- `agent-chat-33-skim`: set `window.__chatSkimStore` to one JSON string holding `[hashText(<a prose text in the
  fixture>), [<one sentence of it>]]` (compute the hash in the page with the module:
  `mod("app/view/agents/chatskim.ts")`), trigger a refresh (call `refreshSkimMarks` through the module), then assert
  a `mark[data-council-mark]` inside `[data-chat-prose]` holds that sentence.
- `agent-chat-34-skim-off`: click `[data-chat-skim-toggle]` → `aria-pressed="false"` and no `mark` in the prose;
  click again → back. Restore `chat.skim` and delete `window.__chatSkimStore` in teardown.
- `agent-chat-35-send-scrolls`: scroll the chat to the top, send a message from the box → the scroller is at its
  end (`scrollHeight - scrollTop - clientHeight < 40`) and the pending bubble is in view.

**Step 2:** `node scripts/cdp/final-verify.mjs agent-chat` → every step PASS.

**Step 3: Changelog** (`CHANGELOG.md`, top `Unreleased` section; read its header first):
- under `Added`: `- Chat shows Claude's skim highlights, the sentences worth reading, as the terminal does; the
  highlighter button at the top of Chat turns them off and on.`
- under `Fixed`: `- Sending a message from Chat scrolls to the end, even when you had scrolled up to read.`

**Step 4: Hand check** (`docs/hand-checks.md`, at the top, `(arcterm)` title): in a live Claude agent's Chat, ask
for a long explanation → its marked sentences show highlighted once the reply lands, the same ones the Terminal view
highlights; the toggle turns them off and on and stays as set after a reload; scrolled up, send → the chat runs to
the end.

**Step 5:** Commit: `git commit -m "test(chat): scenario steps for skim in Chat and the scroll after a send" --
scripts/cdp/scenarios.mjs CHANGELOG.md docs/hand-checks.md`
