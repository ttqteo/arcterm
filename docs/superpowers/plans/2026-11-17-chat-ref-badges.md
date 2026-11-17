# Chat ref badges Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** `agent:<id>`, `tab:<id>`, `run:<id>` and `council:<id>` in Chat's message box and in your sent bubbles draw
as badges tinted by the kind's identity colour, with the thing's name, opening it on click.

**Architecture:** One pure module (`refbadge.ts`) finds the tokens, resolves them against the roster and the chat
project's runs and councils, and picks the look. The bubble gets them through a remark plugin beside the file-mention
one; the box through a Lexical decorator node beside `FileMentionNode`. Both draw one `RefBadgeFace`, fed by a
context Chat provides. The text never changes: a badge's text is the token as written.

**Tech Stack:** React 19, jotai, Tailwind 4 `@theme` tokens, Lexical, react-markdown + remark (mdast), vitest, CDP
scenarios.

Mockup: board `C-tinted.dc.html` of `.superpowers/design/chat-ref-mentions/project/` (option C). Its "đã đóng",
initiative and conversation cells are out of this plan; the canvas's `Session-effort.dc.html` board is part 2, built
later on these pieces.

## Scope

The design (`docs/superpowers/specs/2026-11-17-chat-ref-badges-design.md`, kept untracked in the main checkout, so its
decisions are repeated here):

- **What gets a badge:** `agent:`, `tab:` (read as agent), `run:` and `council:` followed by a hex id of 4+ characters
  (dashes allowed), standing as its own word, optionally after `@`. Not inside inline code or a code block. `session:`
  and `effort:` stay text (part 2).
- **Resolution:** the id matches without case against the roster (`devRosterAtom`), the chat project's runs and its
  councils: the exact id first, else a unique prefix. None, or two or more, is unresolved. The chat's project is the
  registered project's path (`projects[agent.project]?.path`), the path runs and councils are kept under; a chat outside
  a project resolves agents only.
- **The text does not change.** A badge's text content is the token as written: the agent receives the prompt
  unchanged and copy gives the same text.
- **Look (option C):** the file pill's frame (h-5, `rounded-[6px]`, 12.5px, `-top-[1.5px]` lift), filled and bordered
  in the kind's identity colour. Agent: its runtime's `rt-*-soft` / `rt-*-line` (an unknown runtime takes
  `runtimeMeta`'s own fallback), its runtime mark at 12px, the tab name. Run: a rotated `mark-run` square, new
  `mark-run-soft` / `mark-run-line` tokens, the goal's first line. Council: a `mark-council` dot, new
  `mark-council-soft` / `mark-council-line` tokens, the feature. The name truncates at 240px; the tooltip holds name,
  kind, 8-char id and state, ending "(click to open)".
- **Agent state:** working = a green dot, asking = an amber ring (differs by shape too), both pulsing through
  `pulsedriver.tsx`; idle and asleep = no dot. It follows the roster live.
- **Unresolved:** the token in `font-mono` 11.5px, `text-muted`, a dashed `edge-strong` border, no fill, no mark, not
  a link. The tooltip says why ("No agent 7cd99627 is open", "No run 071a8e3b in this project", "agent:7cd9 names 2
  agents").
- **In the box** the token is a Lexical decorator node as `@path` is: a click selects it, Backspace beside it selects
  it (`border-accent bg-accent/12`), Backspace again deletes the whole token. No motion. It forms when the box's text
  is set from outside (a pick from `@`, a draft or prompt brought back), the same rule `@path` pills follow today
  (`chateditor.tsx` rebuilds only on an outside value); a token typed or pasted by hand stays text. A half-typed token
  (the caret in it or at its end) is never boxed.
- **In the bubble** a resolved badge is a button: click or Enter opens its target through the router with the full
  id (`openOrPeek`: agent → its terminal, run → Jarvis, council → its discussion; Ctrl-click peeks). Hover lifts the
  fill one step.
- **Out of scope:** badges in an agent's own replies; mapping an ended agent to its conversation (it shows
  unresolved).

**Verify:** `node scripts/verify.mjs`

**Check:** `task check:ts`

**Final:** `node scripts/cdp/final-verify.mjs chat-ref-badges`

---

### Task 1: Identity tint tokens for run and council

**Depends on:** none

**Files:** `frontend/tailwindsetup.css`

Modify `frontend/tailwindsetup.css` after `--color-mark-council` (~line 362).

**Step 1: Add the tokens**

Under `--color-mark-council: #c58cff;` add:

```css
    /* a run's and a council's badge in Chat (chatrefbadge.tsx): its fill and border in the mark's colour, as an
       agent's badge takes its runtime's rt-*-soft / rt-*-line; identity like the marks, so not mirrored in themes.ts */
    --color-mark-run-soft: rgba(92, 200, 216, 0.12);
    --color-mark-run-line: rgba(92, 200, 216, 0.34);
    --color-mark-council-soft: rgba(197, 140, 255, 0.12);
    --color-mark-council-line: rgba(197, 140, 255, 0.34);
```

Check the rgb values against `--color-mark-run` / `--color-mark-council` beside them and use theirs if they differ.

**Acceptance:** Task 7's scenario step 3 reads a non-transparent computed background on the run and council badges.

**Step 2: Commit**

```bash
git commit -m "feat(chat): identity tint tokens for run and council badges" -- frontend/tailwindsetup.css
```

### Task 2: The pure model: find, resolve, look

**Depends on:** none

**Files:** `frontend/app/view/agents/refbadge.ts`, `frontend/app/view/agents/refbadge.test.ts`

Create both.

**Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { badgeLook, refSpans, refTitle, resolveRef, type RefSources } from "./refbadge";

const src: RefSources = {
    agents: [
        { id: "7cd99627-1111-4a4a-8b8b-000000000001", name: "chat-commit-card", state: "working", agent: "claude" },
        { id: "3fa1c2e0-2222-4a4a-8b8b-000000000002", name: "api-tests", state: "asking", agent: "codex" },
        { id: "3fa1c2ff-3333-4a4a-8b8b-000000000003", name: "docs-sweep", state: "idle", agent: "claude" },
        { id: "9a9a9a9a-6666-4a4a-8b8b-000000000006", name: "odd-one", state: "idle", agent: "nosuchruntime" },
    ],
    runs: [{ oid: "071a8e3b-4444-4a4a-8b8b-000000000004", goal: "Close the tree's picked rows\ntogether" }],
    councils: [{ id: "c41d9e02-5555-4a4a-8b8b-000000000005", feature: "Chat compact work" }],
    project: "D:\\projects\\arcterm",
};

describe("refSpans", () => {
    it("finds a token as its own word, after @ too, and keeps the text as written", () => {
        const text = "có gồm agent:7cd99627 không? @run:071a8e3b, (council:C41D9E02)";
        expect(refSpans(text).map((s) => [s.kind, s.id, s.raw, text.slice(s.start, s.end)])).toEqual([
            ["agent", "7cd99627", "agent:7cd99627", "agent:7cd99627"],
            ["run", "071a8e3b", "@run:071a8e3b", "@run:071a8e3b"],
            ["council", "c41d9e02", "council:C41D9E02", "council:C41D9E02"],
        ]);
    });
    it("reads tab: as agent", () => {
        expect(refSpans("tab:7cd99627")[0].kind).toBe("agent");
    });
    it("leaves glued, too short, non-hex and other kinds as text", () => {
        expect(refSpans("xagent:7cd99627 agent:7cd agent:zzzz9999 session:9f31d0b4 effort:e9b20f17 agent:7cd99627x")).toEqual([]);
    });
    it("leaves the token the caret is in or at the end of", () => {
        expect(refSpans("agent:7cd99627", 14)).toEqual([]);
        expect(refSpans("agent:7cd99627 ", 15)).toHaveLength(1);
    });
});

describe("resolveRef", () => {
    it("resolves an agent by unique prefix, with its runtime and state", () => {
        expect(resolveRef("agent", "7cd99627", src)).toEqual({
            status: "resolved", kind: "agent", id: src.agents[0].id, name: "chat-commit-card", runtime: "claude", state: "working",
        });
    });
    it("names a run by its goal's first line and a council by its feature", () => {
        expect(resolveRef("run", "071a8e3b", src)).toMatchObject({ status: "resolved", name: "Close the tree's picked rows" });
        expect(resolveRef("council", "c41d9e02", src)).toMatchObject({ status: "resolved", name: "Chat compact work" });
    });
    it("prefers an exact id over prefixes", () => {
        const exact = { ...src, agents: [...src.agents, { id: "3fa1", name: "short", state: "idle" as const, agent: "pi" }] };
        expect(resolveRef("agent", "3fa1", exact)).toMatchObject({ status: "resolved", name: "short" });
    });
    it("says why it cannot resolve", () => {
        expect(resolveRef("agent", "deadbeef", src)).toEqual({ status: "unresolved", reason: "No agent deadbeef is open" });
        expect(resolveRef("agent", "3fa1", src)).toEqual({ status: "unresolved", reason: "agent:3fa1 names 2 agents" });
        expect(resolveRef("run", "deadbeef", src)).toEqual({ status: "unresolved", reason: "No run deadbeef in this project" });
        expect(resolveRef("council", "deadbeef", { ...src, project: "" })).toEqual({
            status: "unresolved", reason: "This chat has no project to find council deadbeef in",
        });
    });
});

describe("badgeLook and refTitle", () => {
    it("tints an agent by its runtime, a run and a council by their marks", () => {
        expect(badgeLook(resolveRef("agent", "7cd99627", src))).toEqual({
            frame: "border-rt-claude-line bg-rt-claude-soft", mark: "runtime", dot: "working",
        });
        expect(badgeLook(resolveRef("agent", "3fa1c2e0", src)).dot).toBe("asking");
        expect(badgeLook(resolveRef("agent", "3fa1c2ff", src)).dot).toBeNull();
        expect(badgeLook(resolveRef("run", "071a8e3b", src))).toEqual({
            frame: "border-mark-run-line bg-mark-run-soft", mark: "run", dot: null,
        });
        expect(badgeLook(resolveRef("council", "c41d9e02", src)).mark).toBe("council");
    });
    it("gives an agent of an unknown runtime runtimeMeta's fallback frame", () => {
        expect(badgeLook(resolveRef("agent", "9a9a9a9a", src))).toEqual({
            frame: "border-border bg-surface-hover", mark: "runtime", dot: null,
        });
    });
    it("draws an unresolved token dashed with no mark", () => {
        expect(badgeLook(resolveRef("agent", "deadbeef", src))).toEqual({
            frame: "border-dashed border-edge-strong bg-transparent text-muted", mark: null, dot: null,
        });
    });
    it("titles a badge with name, kind, short id and state, or the reason", () => {
        expect(refTitle(resolveRef("agent", "3fa1c2e0", src))).toBe("api-tests · agent 3fa1c2e0 · asking (click to open)");
        expect(refTitle(resolveRef("run", "071a8e3b", src))).toBe("Close the tree's picked rows · run 071a8e3b (click to open)");
        expect(refTitle(resolveRef("agent", "deadbeef", src))).toBe("No agent deadbeef is open");
    });
});
```

**Step 2: Run them to see them fail**

Run: `npx vitest run frontend/app/view/agents/refbadge.test.ts`
Expected: FAIL, cannot resolve `./refbadge`.

**Step 3: Write the module**

The kind type is `refmention.ts`'s `RefKind` (`"agent" | "run" | "council"`, the `@` picker's kinds); import it, do
not declare a second one. `runtimeMeta` (`runtimemeta.ts`) never returns empty classes (an unknown runtime gets its
`UNKNOWN` entry, `border-border` / `bg-surface-hover`), so the agent frame is always `${meta.line} ${meta.softBg}`.

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// A reference to an agent, a run or a council in Chat (`agent:7cd99627`, as the `@` picker writes it, refmention.ts
// refToken), drawn as a badge: which words are references, what each names, and how its badge looks. Pure: the box's
// pills (chateditorrefpill.tsx) and your sent bubble's (remarkrefmention.ts, chatrefbadge.tsx) share it, so the two
// agree. The text is never changed: a badge stands for its token as written. session: and effort: stay text for now.

import type { RefKind } from "./refmention";
import { runtimeMeta } from "./runtimemeta";

export interface RefSpan {
    start: number;
    end: number;
    kind: RefKind;
    /** lowercased */
    id: string;
    /** the token as written, `@` and case kept */
    raw: string;
}

// a token stands as its own word: at the start, or after whitespace or an opening bracket; it ends at whitespace,
// punctuation or the end. 4+ hex characters, dashes inside (a whole uuid pastes too).
const REF_RE = /(^|[\s([{])(@?(agent|tab|run|council):([0-9a-f]{4,}(?:-[0-9a-f]+)*))(?=$|[\s.,;:!?)\]}'"])/gi;

/** Pure: the references in `text`, in order. With `caret`, one the caret is in or at the end of (still being typed) is
 *  left out, as `mentionTokens` does for a file. */
export function refSpans(text: string, caret?: number): RefSpan[] {
    const out: RefSpan[] = [];
    for (const m of text.matchAll(REF_RE)) {
        const start = (m.index ?? 0) + m[1].length;
        const raw = m[2];
        const end = start + raw.length;
        if (caret != null && caret > start && caret <= end) {
            continue;
        }
        const k = m[3].toLowerCase();
        out.push({ start, end, raw, kind: k === "tab" ? "agent" : (k as RefKind), id: m[4].toLowerCase() });
    }
    return out;
}

export interface RefSources {
    agents: readonly { id: string; name: string; state: "asking" | "working" | "idle"; agent?: string }[];
    runs: readonly { oid: string; goal?: string }[];
    councils: readonly { id: string; feature?: string }[];
    /** the chat's project folder, "" for a chat outside one (its runs and councils are not looked up) */
    project: string;
}

export type ResolvedRef =
    | {
          status: "resolved";
          kind: RefKind;
          /** the full id, for the router */
          id: string;
          name: string;
          runtime?: string;
          state?: "asking" | "working" | "idle";
      }
    | { status: "unresolved"; reason: string };

const firstLine = (s: string | undefined) => (s ?? "").split("\n")[0].replace(/\s+/g, " ").trim();

function pick<T>(items: readonly T[], idOf: (t: T) => string, id: string): T[] {
    const exact = items.filter((t) => idOf(t).toLowerCase() === id);
    return exact.length > 0 ? exact : items.filter((t) => idOf(t).toLowerCase().startsWith(id));
}

/** Pure: what `kind:id` names among the chat's sources: the exact id, else the one id it starts. */
export function resolveRef(kind: RefKind, id: string, src: RefSources): ResolvedRef {
    id = id.toLowerCase();
    const many = (n: number): ResolvedRef => ({ status: "unresolved", reason: `${kind}:${id} names ${n} ${kind}s` });
    if (kind === "agent") {
        const hits = pick(src.agents, (a) => a.id, id);
        if (hits.length === 0) return { status: "unresolved", reason: `No agent ${id} is open` };
        if (hits.length > 1) return many(hits.length);
        const a = hits[0];
        return { status: "resolved", kind, id: a.id, name: a.name, runtime: a.agent, state: a.state };
    }
    if (src.project === "") {
        return { status: "unresolved", reason: `This chat has no project to find ${kind} ${id} in` };
    }
    if (kind === "run") {
        const hits = pick(src.runs, (r) => r.oid, id);
        if (hits.length === 0) return { status: "unresolved", reason: `No run ${id} in this project` };
        if (hits.length > 1) return many(hits.length);
        return { status: "resolved", kind, id: hits[0].oid, name: firstLine(hits[0].goal) || id };
    }
    const hits = pick(src.councils, (c) => c.id, id);
    if (hits.length === 0) return { status: "unresolved", reason: `No council ${id} in this project` };
    if (hits.length > 1) return many(hits.length);
    return { status: "resolved", kind, id: hits[0].id, name: firstLine(hits[0].feature) || id };
}

export interface BadgeLook {
    /** border and fill classes (the frame itself is chatrefbadge.tsx's) */
    frame: string;
    mark: "runtime" | "run" | "council" | null;
    dot: "working" | "asking" | null;
}

const UNRESOLVED_FRAME = "border-dashed border-edge-strong bg-transparent text-muted";

/** Pure: how a badge looks (option C): an agent in its runtime's tint with its state's dot, a run and a council in
 *  their marks' tints, an unresolved token dashed. */
export function badgeLook(r: ResolvedRef): BadgeLook {
    if (r.status === "unresolved") {
        return { frame: UNRESOLVED_FRAME, mark: null, dot: null };
    }
    if (r.kind === "run") return { frame: "border-mark-run-line bg-mark-run-soft", mark: "run", dot: null };
    if (r.kind === "council") return { frame: "border-mark-council-line bg-mark-council-soft", mark: "council", dot: null };
    const meta = runtimeMeta(r.runtime);
    const dot = r.state === "working" || r.state === "asking" ? r.state : null;
    return { frame: `${meta.line} ${meta.softBg}`, mark: "runtime", dot };
}

/** Pure: the badge's tooltip: name · kind short-id · state (click to open), or why it is not one. */
export function refTitle(r: ResolvedRef): string {
    if (r.status === "unresolved") {
        return r.reason;
    }
    const state = r.kind === "agent" && r.state != null ? ` · ${r.state}` : "";
    return `${r.name} · ${r.kind} ${r.id.slice(0, 8)}${state} (click to open)`;
}
```

**Step 4: Run the tests**

Run: `npx vitest run frontend/app/view/agents/refbadge.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git commit -m "feat(chat): find, resolve and style agent, run and council references" -- frontend/app/view/agents/refbadge.ts frontend/app/view/agents/refbadge.test.ts
```

### Task 3: The badge, its sources and its context

**Depends on:** Task 2 (uses `resolveRef`, `badgeLook` and `refTitle` from refbadge.ts)

**Files:** `frontend/app/view/agents/chatrefbadge.tsx`, `frontend/app/view/agents/pathlinkcontext.tsx`

Create `chatrefbadge.tsx`. In `pathlinkcontext.tsx` export `selectingInto` (~line 42, today module-private) so the
badge shares the drag-select guard instead of copying it.

**Step 1: The context**

`RefLinks` context `{ model: AgentsViewModel; project: string; selfId: string }`, provider `ChatRefLinks`
(`value` prop). With no provider, `RefBadge` renders its children (the token as text), as `PathLink` does with no
agent, and `useResolvedRef` resolves with an empty roster and `project: ""`.

**Step 2: `useResolvedRef(kind, id)`**

Reads `devRosterAtom` (`devmock.ts`), `projectRunsAtom(project).runs` (`projecthistorystore.ts`, `[]` while null) and
`councilListAtom(project)` (`councilstore.ts`, `[]` while null), and returns
`resolveRef(kind, id, { agents, runs, councils, project })` in a `useMemo`. A `useEffect` calls
`loadProjectRuns(project)` for a `run` token while `projectRunsAtom(project).runs` is still `null`, and
`loadCouncils(project)` for a `council` token while `councilListAtom(project)` is still `null`, never with
`project === ""`: a bubble with ten badges, or a list the `@` picker already read (`refmentionstore.ts` reloads it on
each `@`), loads nothing again. The roster is the agents list `useRefItems` reads, so a badge and the picker agree.

**Step 3: `RefBadgeFace({ resolved, raw, selected })`**

A `span` with the file pill's frame (`relative -top-[1.5px] mx-px inline-flex h-5 max-w-[240px] items-center gap-1
rounded-[6px] border px-1.5 align-middle text-[12.5px] leading-none text-ink-hi`), `badgeLook`'s `frame` (or
`border-accent bg-accent/12` when `selected`), `title={refTitle(resolved)}`, `data-chat-ref={raw}`,
`data-ref-state={resolved.status}`, `data-ref-mark={look.mark ?? ""}`, then:

- mark `runtime`: `<RuntimeMark runtime={resolved.runtime} className="size-3 shrink-0" />` (`runtimemark.tsx`);
  `run`: `<span className="size-[7px] mx-0.5 shrink-0 rotate-45 bg-mark-run" />`; `council`:
  `<span className="size-[7px] mx-px shrink-0 rounded-full bg-mark-council" />`;
- the name `<span data-ref-name className="min-w-0 truncate">`; unresolved shows `raw` in `font-mono text-[11.5px]`;
- dot `working`: `<span data-ref-dot="working" className="pulse-dot ml-0.5 size-1.5 shrink-0 rounded-full bg-working" />`;
  `asking`: `<span data-ref-dot="asking" className="pulse-dot ml-0.5 size-[7px] shrink-0 rounded-full border-[1.5px] border-asking" />`
  (`pulse-dot` is driven by `element/pulsedriver.tsx`, no CSS animation).

Never `data-chat-pill`: that attribute is the file pill's, and agent-chat step 86 counts those to prove a pick drew no
file pill.

**Step 4: `RefBadge({ kind, id, raw, children })` (for the bubble)**

Resolved → the face wrapped in a `span role="button" tabIndex={0}` with `hover:brightness-125 transition-[filter]`;
`onClick` returns early when `selectingInto(e.currentTarget)` (a drag-select must not open), else
`e.stopPropagation()` and `openOrPeek(model, target, e)` (`jarvis/openref.ts`) with target
`{ kind: "agent", tabId: resolved.id }`, `{ kind: "run", runId: resolved.id }` or
`{ kind: "council", councilId: resolved.id }` (check the `OpenTarget` field names in openref.ts); Enter does the same
(`onKeyDown`, `preventDefault`). Unresolved → the face only, no role, no tabIndex.

**Step 5: Typecheck**

Run: `task check:ts` (allow ~3 minutes). Expected: exit 0.

**Acceptance:** Task 7's scenario steps 1 to 5 read these attributes and clicks.

**Step 6: Commit**

```bash
git commit -m "feat(chat): the ref badge, its sources and context" -- frontend/app/view/agents/chatrefbadge.tsx frontend/app/view/agents/pathlinkcontext.tsx
```

### Task 4: Ref segments in the message box's model

**Depends on:** Task 2 (uses `refSpans` from refbadge.ts)

**Files:** `frontend/app/view/agents/chateditormodel.ts`, `frontend/app/view/agents/chateditormodel.test.ts`, `frontend/app/view/agents/chateditornodes.ts`, `frontend/app/view/agents/chateditornodes.test.ts`

Modify `chateditormodel.ts` (`Segment`, `segmentsOf`, `segmentLength`, `plainOffset`, `locate`) and
`chateditornodes.ts` (`segmentText`, `buildLine`, `adjacentPill`), with tests in the two `.test.ts` files.

**Step 1: Failing tests**

In `chateditormodel.test.ts`:

```ts
it("makes a ref segment for a finished reference, keeping it as written", () => {
    expect(segmentsOf("có gồm agent:7cd99627 không?")).toEqual([
        { kind: "text", text: "có gồm " },
        { kind: "ref", ref: "agent", id: "7cd99627", raw: "agent:7cd99627" },
        { kind: "text", text: " không?" },
    ]);
});
it("keeps a reference still being typed as text", () => {
    expect(segmentsOf("agent:7cd99627", 14)).toEqual([{ kind: "text", text: "agent:7cd99627" }]);
});
it("makes no ref segment with pills off", () => {
    expect(segmentsOf("agent:7cd99627 x", undefined, { pills: false })).toEqual([{ kind: "text", text: "agent:7cd99627 x" }]);
});
it("counts a ref segment as its raw text", () => {
    const segs = segmentsOf("a @run:071a8e3b b");
    expect(segmentLength(segs[1])).toBe("@run:071a8e3b".length);
    expect(plainOffset(segs, 1, 1)).toBe(2 + "@run:071a8e3b".length);
    expect(locate(segs, 5)).toEqual({ index: 1, offset: 1 });
});
```

Match the existing `segmentsOf` signature and the shape its tests already use for `pills: false`; adjust the third
test's call to it.

In `chateditornodes.test.ts`: `linesText([buildLine(segmentsOf(t))])` equals `t` for
`"hỏi @agent:7cd99627, rồi run:071a8e3b"`, and `adjacentPill` finds a ref segment as it finds a pill.

Run: `npx vitest run frontend/app/view/agents/chateditormodel.test.ts frontend/app/view/agents/chateditornodes.test.ts`
Expected: FAIL.

**Step 2: The model**

- `Segment` gains `{ kind: "ref"; ref: RefKind; id: string; raw: string }` (`RefKind` from `refmention.ts`). Add
  `export const isAtom = (s: Segment) => s.kind !== "text";` and use it where the code tests `kind === "pill"` for
  "a thing the caret steps over whole" (`plainOffset`, `locate`, the last-segment line, and in
  `chateditornodes.ts` `buildLine`, `adjacentPill`). `segmentLength`: `ref` → `raw.length`; `segmentText`: `ref` →
  `raw`.
- `segmentsOf`: merge `mentionTokens(text, caret)` (as today) and `refSpans(text, caret)` (`refbadge.ts`) sorted by
  `start`, dropping a ref that overlaps a file mention; emit `{ kind: "ref", ref: s.kind, id: s.id, raw: s.raw }`.
  With `pills: false` nothing changes.

Run the tests — Expected: PASS, and the files' existing tests still pass.

**Step 3: Commit**

```bash
git commit -m "feat(chat): the message box's model knows agent, run and council references" -- frontend/app/view/agents/chateditormodel.ts frontend/app/view/agents/chateditormodel.test.ts frontend/app/view/agents/chateditornodes.ts frontend/app/view/agents/chateditornodes.test.ts
```

### Task 5: Badges in your sent bubble

**Depends on:** Task 3 (uses `RefBadge` and `ChatRefLinks` from chatrefbadge.tsx; its plugin uses Task 2's `refSpans` through it)

**Files:** `frontend/app/view/agents/remarkrefmention.ts`, `frontend/app/view/agents/remarkrefmention.test.ts`, `frontend/app/view/agents/markdownmessage.tsx`, `frontend/app/view/agents/chatpane.tsx`

Create the first two. Modify `markdownmessage.tsx` (`MENTION_COMPONENT` ~line 180, `pluginsFor` ~line 204) and
`chatpane.tsx` (`ChatPane`, ~line 505: wrap its returned tree).

**Step 1: Failing test for the plugin**

Model it on `remarkfilemention.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { splitRefs } from "./remarkrefmention";

describe("splitRefs", () => {
    it("splits text into text and refmention nodes, keeping the token as the node's text", () => {
        const parts = splitRefs("có gồm agent:7cd99627 không?")!;
        expect(parts.map((p) => p.type)).toEqual(["text", "refmention", "text"]);
        expect((parts[1] as any).data.hProperties).toEqual({ kind: "agent", id: "7cd99627", raw: "agent:7cd99627" });
        expect((parts[1] as any).children[0].value).toBe("agent:7cd99627");
    });
    it("is null with no reference", () => {
        expect(splitRefs("no refs here")).toBeNull();
    });
});
```

Add a test that runs the default plugin over a tree (as `remarkfilemention.test.ts` does, if it does) and leaves a
token inside `inlineCode` and `code` as it is.

Run: `npx vitest run frontend/app/view/agents/remarkrefmention.test.ts` — Expected: FAIL.

**Step 2: The plugin**

Copy `remarkfilemention.ts`'s shape: `splitRefs(value)` builds from `refSpans(value)` a list of text and
`{ type: "refmention", children: [text(raw)], data: { hName: "refmention", hProperties: { kind, id, raw } } }`
nodes; the default export walks text nodes, skipping `link`, `linkReference`, `inlineCode`, `code`, `filemention`,
`refmention`. Header comment: what it makes and that refbadge.ts holds the rule.

Run the test — Expected: PASS.

**Step 3: Wire it**

- `markdownmessage.tsx`: in `MENTION_COMPONENT` add
  `refmention: ({ kind, id, raw, children }) => <RefBadge kind={kind} id={id} raw={raw}>{children}</RefBadge>`; in
  `pluginsFor`, after `remarkFileMention`, add `remarkRefMention` under the same `extras.mentions`. Update the
  `MarkdownExtras` comment: `mentions` also draws references as badges.
- `chatpane.tsx` `ChatPane`: the project is `projects[agent.project ?? ""]?.path ?? ""` (`projects` from
  `projectsAtom`, `projectsstore.ts`): the registered project's path, which is what runs and councils are kept
  under; never the agent's `cmd:cwd`, which is a worktree for a run worker. Wrap ChatPane's returned tree in
  `<ChatRefLinks value={{ model, project, selfId: agent.id }}>` (memoize the value), so the conversation, the
  pending bubbles and the composer's Lexical pills (Task 6) all see it.

**Step 4: Test and typecheck**

Run: `npx vitest run frontend/app/view/agents/remarkrefmention.test.ts frontend/app/view/agents/refbadge.test.ts`
Expected: PASS. Then `task check:ts` (allow ~3 minutes): exit 0.

**Acceptance:** Task 7's scenario steps 1 to 5 (the bubble's badges and the click).

**Step 5: Commit**

```bash
git commit -m "feat(chat): agent, run and council references draw as badges in your bubbles" -- frontend/app/view/agents/remarkrefmention.ts frontend/app/view/agents/remarkrefmention.test.ts frontend/app/view/agents/markdownmessage.tsx frontend/app/view/agents/chatpane.tsx
```

### Task 6: Badges in the message box

**Depends on:** Task 3 (uses `RefBadgeFace` and `useResolvedRef` from chatrefbadge.tsx), Task 4 (uses the `ref` segment it adds)

**Files:** `frontend/app/view/agents/chateditorrefpill.tsx`, `frontend/app/view/agents/chateditor.tsx`

Create `chateditorrefpill.tsx`. Modify `chateditor.tsx` (`segmentOfNode` ~156, `$gapAroundPills` ~165,
`$selectionOnPill` ~276, `$rebuild` ~312, `$deletePill` ~358, `initialConfig.nodes` ~759).

**Step 1: The Lexical node (`chateditorrefpill.tsx`)**

A copy of `chateditorpill.tsx`'s node, type `"ref-mention"`, holding `kind`, `id`, `raw`; `getTextContent()` returns
`raw`; `decorate()` renders a small component that calls `useResolvedRef(kind, id)` and draws
`<RefBadgeFace resolved raw selected={selected} />` inside the same click-to-select span as `FileMentionPill`
(`useLexicalNodeSelection`, `$createNodeSelection`). Export `$createRefMentionNode`, `$isRefMentionNode`. With no
`ChatRefLinks` above it, `useResolvedRef` returns the unresolved look (no roster to read: `project` "").

**Step 2: Wire the editor**

In `chateditor.tsx`: `segmentOfNode` maps a `RefMentionNode` to its `ref` segment; `$rebuild` appends
`$createRefMentionNode(...)` for a `ref` segment; `$gapAroundPills`, `$selectionOnPill` and `$deletePill` test
`$isFileMentionNode(n) || $isRefMentionNode(n)` (one local `$isPillNode`); add `RefMentionNode` to
`initialConfig.nodes`. Text typed against a ref badge takes the same gap as a file pill (`gapAfterMention` /
`gapBeforeMention`: a ref ends at the same punctuation). The node forms only where `$rebuild` runs (an outside
value), as file pills do: leave the update listener as it is.

**Step 3: Test and typecheck**

Run: `npx vitest run frontend/app/view/agents/chateditormodel.test.ts frontend/app/view/agents/chateditornodes.test.ts frontend/app/view/agents/refbadge.test.ts`
Expected: PASS. Then `task check:ts` (allow ~3 minutes): exit 0.

**Acceptance:** Task 7's scenario step 6 (a pick from `@` leaves a resolved badge in the box, text unchanged).

**Step 4: Commit**

```bash
git commit -m "feat(chat): agent, run and council references draw as badges in the message box" -- frontend/app/view/agents/chateditorrefpill.tsx frontend/app/view/agents/chateditor.tsx
```

### Task 7: CDP scenario and changelog

**Depends on:** Task 1 (step 3 reads the tint tokens it adds), Task 5 (the bubble's `data-chat-ref` / `data-ref-*` badges it wires), Task 6 (the box's badge after an `@` pick)

**Files:** `scripts/cdp/scenarios.mjs`, `CHANGELOG.md`

A new `chat-ref-badges` scenario after `chat-math` (~line 48568), **registered in the exported scenario list beside
`chatMath` (~line 71801)**, or Final fails on an unknown name; `CHANGELOG.md`'s top section, `Added`.

**Step 1: Arrange**

Model it on `chat-math` (its arrange writes a transcript with `AC.writeTranscript`, reloads, makes a tab with
`acMakeTab`, sets the roster with `AC.setRoster`; teardown restores the grid and chat modes). In addition:

- **A registered project:** `h.rpc("createproject", { name, path: ctx.dir })` with a unique name, then
  `waitForProjectInConfig(h, name)` before the reload (~line 25688). Teardown deletes it and the channel
  `createproject` made, as `diff-log-tab`'s teardown does (~line 6219).
- **Two tabs:** the chat's own agent A (`acMakeTab`) and a second agent B (`acMakeTab` too, so the router has a tab
  to focus). Roster: A with `project: name`, state idle; B in state `asking`, runtime `codex`, its own label.
- **A seeded run and council**, after the reload and before the chat shows, through the app's own store:
  `agentPageFixtures.agentPage(h, ...)` with `mod("app/view/agents/projecthistorystore.ts")` and
  `mod("app/view/agents/councilstore.ts")` (as `jarvisRouteBandTabs` does, ~line 10670) setting
  `projectRunsAtom(ctx.dir)` to `{ runs: [{ oid: RUN_ID, goal: "Close the tree's picked rows\ntogether" }], error: null }`
  and `councilListAtom(ctx.dir)` to `[{ id: COUNCIL_ID, feature: "Chat compact work", ... }]` (the fields
  `Council` requires; fixed uuids for `RUN_ID` / `COUNCIL_ID`). The atoms are then non-null, so `useResolvedRef`
  loads nothing over them. Use the path form the project was registered with, so `projects[...].path` and the
  atoms' key agree.
- **The transcript's user message:**
  `` `Hỏi agent:${B.slice(0, 8)} xem run:${RUN_ID.slice(0, 8)} và council:${COUNCIL_ID.slice(0, 8)}, còn run:deadbeef thì sao.` ``
  (B's tab id is only known after `acMakeTab`, so write the transcript after the tabs, before setting the roster).

**Step 2: Steps, each a `rec(...)`**

1. the bubble's `[data-chat-ref="agent:<B8>"]` is `data-ref-state="resolved"`, `data-ref-mark="runtime"`, its
   `[data-ref-name]` text is B's label, and it holds a `[data-ref-dot="asking"]`;
2. the bubble's `run:<RUN8>` badge is resolved with `data-ref-mark="run"` and name `Close the tree's picked rows`;
   its `council:<COUNCIL8>` badge is resolved with `data-ref-mark="council"` and name `Chat compact work`;
3. the run and the council badges' computed `backgroundColor` and `borderTopColor` are not transparent (the Task 1
   tokens exist), and differ from each other;
4. the bubble's `[data-chat-ref="run:deadbeef"]` is `data-ref-state="unresolved"`, its text `run:deadbeef`, its
   `title` starts "No run deadbeef", and it has no `role`; the resolved badges have `role="button"`;
5. clicking B's badge makes the focused agent B (`globalStore.get(agentsModel().focusIdAtom)`, as
   `jarvisRouteFocusId` reads it, ~line 10668); then focus A again in chat mode, `.focus()` B's badge, press Enter
   (`acKey(h, acKeys.enter)`) and the focused agent is B again; focus A again;
6. in A's box, `acType(h, acBox(A), "đọc @agent", false)`, wait for a `[data-chat-mention^="ref:agent:"]` row, press
   Enter (the pick writes `agent:<B8> `, as agent-chat step 86 does, ~line 47083): the box's value (`acVal`) is
   exactly `đọc agent:<B8> ` and `[data-agent-chat] [contenteditable] [data-chat-ref="agent:<B8>"]` is resolved;
   clear the box;
7. a shot of the bubble and the box for the contact sheet (`cdp-shots/chat-ref-badges.png`).

The box shows no unresolved badge: the `@` picker lists only what resolves, and typed text stays text (Scope). The
unresolved look is the same `RefBadgeFace`, checked in step 4.

**Step 3: Run it**

Run: `ARC_FINAL_OUT=<a temp dir> node scripts/cdp/final-verify.mjs chat-ref-badges` (it starts its own dev app for
this tree and stops it). Expected: PASS on every step.

**Step 4: Changelog**

Under `## Unreleased` → `### Added` (open the section if the top one is dated):

```markdown
- References to agents, runs and councils you write in Chat (`agent:7cd99627`, or picked from `@`) show as badges with
  their name, tinted by kind, with a live agent's state; click one to open it.
```

**Step 5: Commit**

```bash
git commit -m "test(chat): CDP scenario for ref badges; changelog" -- scripts/cdp/scenarios.mjs CHANGELOG.md
```
