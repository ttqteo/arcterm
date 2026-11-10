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

**Files:** `frontend/app/view/agents/chatskim.ts`, `frontend/app/view/agents/chatskim.test.ts`, `frontend/app/view/agents/chatskimstore.ts`, `frontend/app/view/agents/chatconversation.tsx`, `frontend/app/view/agents/chatpane.tsx`, `scripts/cdp/scenarios.mjs`, `CHANGELOG.md`, `docs/hand-checks.md`

**Acceptance:** the vitest cases below pass, and `agent-chat` steps 34 (skim) and 35 (skim off) pass with their shots
`agent-chat-34-skim.png` and `agent-chat-35-skim-off.png`.

**Step 1: Write the failing tests** (`chatskim.test.ts`):

```ts
import { describe, expect, it } from "vitest";
import { hashText, marksByHash, parseSkimOn, skimStoreFiles, withMarks } from "./chatskim";

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

describe("skimStoreFiles", () => {
    it("keeps the skim_*.json files of 2 MB or less, by name", () => {
        const MB = 1024 * 1024;
        expect(
            skimStoreFiles([
                { name: "skim_inline-2e2b7f082d52.json", size: 160_000 },
                { name: "skim_other.json", size: 2 * MB },
                { name: "skim_huge.json", size: 2 * MB + 1 },
                { name: "skim_notes.txt", size: 10 },
                { name: "arc_x.json", size: 10 },
                { name: "skim_dir.json", size: 10, isdir: true },
            ])
        ).toEqual(["skim_inline-2e2b7f082d52.json", "skim_other.json"]);
    });
});

describe("parseSkimOn", () => {
    it("is on unless the stored value is false", () => {
        expect(parseSkimOn(null)).toBe(true);
        expect(parseSkimOn("true")).toBe(true);
        expect(parseSkimOn("false")).toBe(false);
        expect(parseSkimOn("garbage")).toBe(true);
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
skipped. Return the text unchanged when `marks` is empty. `skimStoreFiles(entries: { name: string; size: number;
isdir?: boolean }[]): string[]`: the names that start `skim_` and end `.json`, are not a directory and are at most
2 MB (`2 * 1024 * 1024` bytes), in input order. `parseSkimOn(raw: string | null): boolean`: `false` only for the
stored string `"false"`, else `true`.

**Step 4:** `npx vitest run frontend/app/view/agents/chatskim.test.ts` → PASS.

**Step 5: The store** (`chatskimstore.ts`): a jotai atom holding the `Map` (empty at first) and the toggle:
- `chatSkimOnAtom`: boolean whose initial value is `parseSkimOn(localStorage.getItem("chat.skim"))`, written back as
  `"true"`/`"false"` on change; every access in try/catch (a throw reads as on).
- `refreshSkimMarks()`: throttled to once per second, **leading and trailing**: a call inside the window is never
  dropped, it runs once at the window's end (several calls in one window collapse into that one trailing run). In
  DEV, when `window.__chatSkimStore` is an array of JSON strings, use it instead of the disk; else list
  `<home>/.claude/plugins/store` (`homeDir()` from `pathlinkroute.ts`; path joined with `/`, which the server accepts
  on Windows too, as other `~/.claude` paths in this folder do) with `RemoteListEntriesCommand` (a stream of
  `FileInfo` chunks, whose `name`/`size` are optional: map them as `name ?? ""`, `size ?? 0`), pick the names with
  `skimStoreFiles`, read each with `FileReadCommand` and decode its `data64` with `base64ToString` from `@/util/util`
  (as `appsuggeststore.ts:49-50` does; UTF-8 safe, so Vietnamese marks survive), and set the atom to
  `marksByHash(texts)`. Any failure leaves the atom as it was and logs one `console.warn` (not per refresh: once per
  distinct error message).
- `useSkimMarks(text: string): string[]`: the marks for `hashText(text)` while the toggle is on, else `[]`.
- Declare `window.__chatSkimStore?: string[]` in a `declare global` block, as `linereviewsend.ts:52-57` does.

**Step 6: Draw them.** In `chatconversation.tsx`, the prose part (`case "prose"` in `drawPart`, ~line 469) renders
`withMarks(part.text, marks)` into `CouncilText` (which already draws `==…==` as the skim highlight,
`markdownmessage.tsx` `marks`); the copy button and context menu keep copying `part.text` unmarked. Do it in a small
component (`ProseText`) so the hook runs per part. In `chatpane.tsx`, call `refreshSkimMarks()` on mount and whenever
`entries` changes (the transcript grew), so the newest reply's marks arrive with it.

**Step 7: The toggle.** In `chatpane.tsx`, a button in the chat area's top-right corner, `absolute right-3 top-2
z-20`, 26×26, `rounded-[8px] border border-edge-mid bg-surface-raised`, lucide `Highlighter` 13px; on:
`text-warning` icon (the highlight's own hue, `bg-warning/25` is its fill in `markdownmessage.tsx`) and
`aria-pressed="true"`; off: `text-muted`, `aria-pressed="false"`. `data-chat-skim-toggle`,
`title="Skim highlights in Chat: on (click to turn off)"` / `"…: off (click to turn on)"`, `aria-label="Skim
highlights"`. It shows whenever the chat pane shows a conversation (not on the loading or empty state). The pinned
prompt bar in Chat gets right padding so it never runs under the toggle: in `chatconversation.tsx` (line ~531), change
the `className` Chat passes to `PinnedPromptBar` from `"-mb-4"` to `"-mb-4 pr-10"` (the component already takes
`className` on its sticky row); `pinnedpromptbar.tsx` is not edited.

**Step 8: Scenario steps** in the `agent-chat` scenario (`scripts/cdp/scenarios.mjs`), after step 33 (whose shots
are `agent-chat-33-transitions-*`, ~line 43625), in its style (`rec(...)`, `h.shot(...)`, `polishWaitFor`):
- **34. skim**: pick a prose part's text from the fixture (the raw string the fixture feeds, not the DOM's
  `textContent`), and one sentence of it. In the page, import `mod("app/view/agents/chatskim.ts")` to compute
  `hashText(<that raw text>)`, set `window.__chatSkimStore = [JSON.stringify({ highlightMarks: [[hash, [sentence]]] })]`,
  then import `mod("app/view/agents/chatskimstore.ts")` and call `refreshSkimMarks()`. **Poll** with `polishWaitFor`
  (up to 4000 ms, since the throttle may defer the refresh up to a second) for a `mark[data-council-mark]` inside
  `[data-chat-prose]` whose text is that sentence; assert it, and that `[data-chat-skim-toggle]` exists with
  `aria-pressed="true"`. Shot `cdp-shots/agent-chat-34-skim.png`.
- **35. skim off**: click `[data-chat-skim-toggle]` → poll for `aria-pressed="false"` and no `mark[data-council-mark]`
  inside `[data-chat-prose]`; assert `localStorage.getItem("chat.skim") === "false"`. Shot
  `cdp-shots/agent-chat-35-skim-off.png`. Click again → poll for `aria-pressed="true"`, the mark back and
  `localStorage.getItem("chat.skim") === "true"`.
- Teardown (where the scenario's teardown is): remove `chat.skim` from localStorage and
  `delete window.__chatSkimStore`.

**Step 9: Changelog** (`CHANGELOG.md`, top `Unreleased` section; read its header first), under `Added`: `- Chat shows
Claude's skim highlights, the sentences worth reading, as the terminal does; the highlighter button at the top of Chat
turns them off and on.`

**Step 10: Hand check** (`docs/hand-checks.md`, a new first `- [ ]` line of the list, `(arcterm)` title): in a live
Claude agent's Chat, ask for a long explanation → its marked sentences show highlighted once the reply lands, the same
ones the Terminal view highlights (the scenario injects its own store; only a live agent proves the real skim store
file is found and its hashes match). Name `chatskimstore.ts` and `agent-chat` 34.

**Step 11:** vitest for `chatskim.test.ts` → PASS; eslint and prettier on the `.ts`/`.tsx` files → clean (never
prettier on `scripts/*.mjs`).

**Step 12:** Commit: `git commit -m "feat(chat): skim highlights show in Chat, with a toggle to turn them off" --
<the eight paths>`

### Task 2: Sending scrolls to the end

**Depends on:** Task 1 (edits `chatpane.tsx`, `scripts/cdp/scenarios.mjs` and `CHANGELOG.md` after it)

**Files:** `frontend/app/view/agents/chatcomposer.tsx`, `frontend/app/view/agents/chatpane.tsx`, `scripts/cdp/scenarios.mjs`, `CHANGELOG.md`

**Acceptance:** `agent-chat` step 36 (send scrolls) passes with its shot `agent-chat-36-send-scrolls.png`.

`ChatPane` has `jumpToBottom` from `useStickToBottom` (`chatpane.tsx`, beside `scrollRef`). `ChatComposer`'s
`submit` (`chatcomposer.tsx`, `if (send()) { … }`) never scrolls.

**Step 1:** `ChatComposer` takes `onSent?: () => void` and calls it right after `send()` returns true, before the
pending bubble is added (so the stick re-arms and the bubble lands in view). A wake send (asleep) counts too.

**Step 2:** `ChatPane` passes `onSent={jumpToBottom}`, keeping Task 1's toggle and refresh as they are.

**Step 3: Scenario step** in `agent-chat` (`scripts/cdp/scenarios.mjs`), after Task 1's step 35, in the same style:
- **36. send scrolls**: with a conversation taller than the scroller, set the chat scroller's `scrollTop = 0` and poll
  until it is away from the end; send a message from the box (type into it and press Enter, or click send, as the
  scenario's earlier send steps do, against the same mock). Then **poll** with `polishWaitFor` (up to 3000 ms:
  `jumpToBottom` scrolls smoothly) for the scroller at its end (`scrollHeight - scrollTop - clientHeight < 40`), and
  assert the pending bubble's rect lies inside the scroller's rect. Shot `cdp-shots/agent-chat-36-send-scrolls.png`.

**Step 4: Changelog** (`CHANGELOG.md`, top `Unreleased` section), under `Fixed`: `- Sending a message from Chat
scrolls to the end, even when you had scrolled up to read.`

**Step 5:** eslint and prettier on the two `.tsx` files → clean (never prettier on `scripts/*.mjs`).

**Step 6:** Commit: `git commit -m "fix(chat): sending a message scrolls the chat to the end" --
frontend/app/view/agents/chatcomposer.tsx frontend/app/view/agents/chatpane.tsx scripts/cdp/scenarios.mjs CHANGELOG.md`
