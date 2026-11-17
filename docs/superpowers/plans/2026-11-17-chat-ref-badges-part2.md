# Chat ref badges, part 2: session: and effort: Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** `session:<id>` (a past conversation) and `effort:<id>` (an initiative) draw as badges in Chat's box and
bubbles, like part 1's agent, run and council badges, and the `@` picker offers them. In the box, a reference or an
`@path` typed or pasted becomes a badge or a file pill once finished, and deleting one leaves a single space.

**Architecture:** Part 1 (run efdd9375, landed; its plan was deleted on shipping, git history keeps it)
built `refbadge.ts` (find, resolve, look), `remarkrefmention.ts`, `chatrefbadge.tsx` (`RefBadgeFace`, `RefBadge`,
`useResolvedRef`, `ChatRefLinks`), the `ref` segment in `chateditormodel.ts` and `chateditorrefpill.tsx`. This plan
widens the kind set in those modules and adds two sources; read them first, and follow their names where they
differ from this plan's.

**Tech Stack:** React 19, jotai, Tailwind 4, Lexical, remark, vitest, CDP scenarios.

Spec: `docs/superpowers/specs/2026-11-17-chat-ref-badges-design.md`, section "Part 2". Mockup: board
`Session-effort.dc.html` of `.superpowers/design/chat-ref-mentions/project/` (its sent bubble also shows part 1's
agent and run badges).

**Verify:** `node scripts/verify.mjs`

**Check:** `task check:ts`

**Final:** `node scripts/cdp/final-verify.mjs chat-ref-badges`

---

### Task 1: The model takes session: and effort:

**Depends on:** none

**Files:** `frontend/app/view/agents/refbadge.ts`, `frontend/app/view/agents/refbadge.test.ts`, `frontend/app/view/agents/refmention.ts`, `frontend/app/view/agents/filemention.tsx`, `frontend/app/view/agents/chateditormodel.test.ts`, `frontend/app/view/agents/remarkrefmention.test.ts`

The kind type is `RefKind` in `refmention.ts` (`refbadge.ts`, the `ref` segment in `chateditormodel.ts` and
`RefMentionNode` all take it). Widening it breaks the three `Record`s keyed by it, so this task fills them too, or
`task check:ts` fails at its merge.

**Step 1: Failing tests** (in `refbadge.test.ts`; extend part 1's `src` fixture)

```ts
const now = Date.parse("2026-11-17T12:00:00Z");
const src2: RefSources = {
    ...src,
    sessions: [
        { id: "9f31d0b4-6666-4a4a-8b8b-000000000006", runtime: "claude", task: "Fix CDP fails\nand more", projectname: "arcterm", lastactivets: now - 3 * 86_400_000 },
    ],
    efforts: [
        { oref: "effort:e9b20f17-7777-4a4a-8b8b-000000000007", title: "Chat polish", done: 4, total: 9 },
        { oref: "effort:4c0aa7d3-8888-4a4a-8b8b-000000000008", title: "RAM watch", done: 6, total: 6 },
    ],
    now,
};

it("finds session: and effort: tokens", () => {
    expect(refSpans("đọc session:9f31d0b4 rồi effort:e9b20f17.").map((s) => s.kind)).toEqual(["session", "effort"]);
});
it("resolves a conversation by id prefix, with its age, and an initiative by its oid, with its chunks", () => {
    expect(resolveRef("session", "9f31d0b4", src2)).toMatchObject({ status: "resolved", name: "Fix CDP fails", meta: "3d", ageMs: 3 * 86_400_000 });
    expect(resolveRef("effort", "e9b20f17", src2)).toMatchObject({ status: "resolved", id: "e9b20f17-7777-4a4a-8b8b-000000000007", name: "Chat polish", meta: "4/9", metaDone: false });
    expect(resolveRef("effort", "4c0aa7d3", src2)).toMatchObject({ meta: "6/6", metaDone: true });
});
it("resolves both without a project", () => {
    expect(resolveRef("session", "9f31d0b4", { ...src2, project: "" }).status).toBe("resolved");
});
it("says why it cannot resolve them", () => {
    expect(resolveRef("session", "77aa01fe", src2)).toEqual({ status: "unresolved", reason: "No conversation 77aa01fe in the loaded history" });
    expect(resolveRef("effort", "deadbeef", src2)).toEqual({ status: "unresolved", reason: "No initiative deadbeef" });
});
it("draws both neutral, told apart by mark", () => {
    expect(badgeLook(resolveRef("session", "9f31d0b4", src2))).toEqual({ frame: "border-edge-mid bg-surface", mark: "session", dot: null });
    expect(badgeLook(resolveRef("effort", "e9b20f17", src2)).mark).toBe("effort");
});
it("titles them", () => {
    expect(refTitle(resolveRef("session", "9f31d0b4", src2))).toBe("Fix CDP fails · conversation 9f31d0b4 · claude · arcterm · 3d ago (click to open)");
    expect(refTitle(resolveRef("effort", "e9b20f17", src2))).toBe("Chat polish · initiative e9b20f17 · 4 of 9 chunks done (click to open)");
});
```

Part 1's tests that say `session:` and `effort:` stay text change with it:

- `refbadge.test.ts` "leaves glued, too short, non-hex and other kinds as text" (~line 28): drop `session:9f31d0b4
  effort:e9b20f17` from that input (they are kinds now); the rest stays `[]`.
- `chateditormodel.test.ts` "makes nothing of a word that only looks like one" (~line 135): replace `session:7cd99627`
  with `xsession:7cd99627` (glued, still text). Add: `segmentsOf("đọc session:9f31d0b4 ")` makes a `ref` segment with
  `ref: "session"`, `id: "9f31d0b4"`.
- `remarkrefmention.test.ts` "turns agent:, run: and council: tokens into refmention nodes" (~line 80): the
  `session:7cd99627 effort:7cd99627` in its input are now refmention nodes: expect kinds
  `["agent", "run", "council", "session", "effort"]` and the flat text with all five in braces; rename the test to say
  all five kinds.

Run: `npx vitest run frontend/app/view/agents/refbadge.test.ts frontend/app/view/agents/chateditormodel.test.ts frontend/app/view/agents/remarkrefmention.test.ts`
Expected: FAIL.

**Step 2: Implement**

- `refmention.ts`: `RefKind` gains `"session" | "effort"`. `KIND_WORDS` gains
  `session: ["session", "sessions", "conversation", "conversations", "hội thoại"]` and
  `effort: ["effort", "efforts", "initiative", "initiatives"]`; `kindOrder` gives them 3 and 4. (Task 3 adds the
  picker's behaviour and tests; this only keeps the `Record`s whole.)
- `filemention.tsx`: `REF_ICONS` gains `session: History, effort: Flag` (lucide).
- `refbadge.ts`: `REF_RE`'s kind group gains `session|effort`; update the header comment ("session: and effort: stay
  text for now" goes).
- `RefSources` gains **optional** `sessions?: readonly Pick<SessionActivity, "id" | "runtime" | "task" | "projectname" | "lastactivets">[]`,
  `efforts?: readonly Pick<EffortSummary, "oref" | "title" | "done" | "total">[]` and `now?: number` (missing →
  `[]`, `[]`, `Date.now()`), so part 1's one caller (`chatrefbadge.tsx` `useResolvedRef`) compiles untouched until
  Task 2 passes them.
- The resolved shape gains optional `meta?: string`, `metaDone?: boolean`, `ageMs?: number` (a session's
  `now - lastactivets`, for the tooltip), and a session's `runtime` and `project` (its `projectname`).
- `resolveRef`: `session` and `effort` are looked up before the "no project" check (they do not depend on one). A
  session: `pick(sessions, (s) => s.id, id)`, name = first line of `task`, else `projectname`, else the id;
  `ageMs = now - lastactivets`, `meta = formatAge(ageMs)` (`agentsviewmodel.ts`). An initiative: compare against the
  oid, `oref.replace(/^effort:/, "")`; `id` is that oid; `meta = \`${done}/${total}\``,
  `metaDone = total > 0 && done === total`. Reasons as the tests say; the many-hits reason names "conversations" /
  "initiatives" (not `${kind}s`).
- `badgeLook`: add `const NEUTRAL_FRAME = "border-edge-mid bg-surface"`; `BadgeLook.mark` widens to
  `"runtime" | "run" | "council" | "session" | "effort" | null`; `session` → `{ frame: NEUTRAL_FRAME, mark: "session",
  dot: null }`, `effort` likewise with `"effort"`.
- `refTitle`: the two lines the tests give: a session `${name} · conversation ${id8} · ${runtime} · ${project} ·
  ${formatAgo(ageMs)}`, an initiative `${name} · initiative ${id8} · ${done} of ${total} chunks done` (read the two
  numbers from `meta`, or keep them on the resolved shape — your choice), each ending in the `opens` suffix as part 1's.

Run the tests — Expected: PASS. Then `npx vitest run frontend/app/view/agents/` for the neighbours part 1 touched.

**Step 3: Commit**

```bash
git commit -m "feat(chat): ref badges resolve session: and effort:" -- frontend/app/view/agents/refbadge.ts frontend/app/view/agents/refbadge.test.ts frontend/app/view/agents/refmention.ts frontend/app/view/agents/filemention.tsx frontend/app/view/agents/chateditormodel.test.ts frontend/app/view/agents/remarkrefmention.test.ts
```

### Task 2: Their sources, face and open target

**Depends on:** Task 1 (uses the widened `RefSources`, `meta`, and the `session` / `effort` marks)

**Files:** `frontend/app/view/agents/chatrefbadge.tsx`, `frontend/app/view/agents/refmentionstore.ts`

**Step 1: Sources** (`refmentionstore.ts`)

Add `refEffortsAtom` (`EffortSummary[] | null`) and `loadRefEfforts()`: `RpcApi.EffortListCommand(TabRpcClient,
{ includearchived: true })`, guarded so concurrent calls make one request (as `loadPaletteEfforts` in
`cockpit/palette-entities.ts` does). Sessions come from `sessionsArchiveAtom`; when it is `null`, call
`loadSessionsArchive()` (`sessionsarchivestore.ts`) once.

**Step 2: `useResolvedRef`** (`chatrefbadge.tsx`) reads `sessionsArchiveAtom` and `refEffortsAtom`, loads them on the
first `session` / `effort` token (the same once-per-kind guard part 1 uses for runs and councils), and passes
`sessions`, `efforts`, `now: Date.now()` to `resolveRef`. Part 1's effect returns early when `project === ""`: the
session and effort loads go before that return (or in their own effect), since neither depends on a project.

**Step 3: The face.** Mark `session`: lucide `History`, `effort`: lucide `Flag`, both `size={12}
className="shrink-0 text-muted"`. When `meta` is set, after the name:
`<span data-ref-meta className={cn("shrink-0 text-[11.5px] tabular-nums", metaDone ? "text-success" : "text-muted")}>{meta}</span>`.
Raise the face's `max-w-[240px]` to `max-w-[260px]` only for a badge with meta, so the name keeps room; the meta
never truncates (`shrink-0`).

**Step 4: The open target.** In `RefBadge`'s click: `session` → `{ kind: "session", sessionId: resolved.id }`,
`effort` → `{ kind: "effort", effortId: resolved.id }`, through the same `openOrPeek`.

**Step 5: Check and commit**

Run: `npx vitest run frontend/app/view/agents/` — PASS (no unit of this task's own: it is wiring and markup). What
shows it is Task 5's scenario steps "resolved conversation badge" and "resolved initiative badge" (History / Flag
mark, the meta text, the tooltip, a click on the initiative opening it); the run's Check typechecks it.

```bash
git commit -m "feat(chat): conversation and initiative badges draw and open" -- frontend/app/view/agents/chatrefbadge.tsx frontend/app/view/agents/refmentionstore.ts
```

### Task 3: The @ picker offers conversations and initiatives

**Depends on:** Task 2 (`useRefItems` reads the `refEffortsAtom` and loader it adds)

**Files:** `frontend/app/view/agents/refmention.ts`, `frontend/app/view/agents/refmention.test.ts`, `frontend/app/view/agents/refmentionstore.ts`, `frontend/app/view/agents/chatcomposer.tsx`

Task 1 already widened `RefKind`, `KIND_WORDS`, `kindOrder` and the picker icons; this task adds the behaviour.

The chat's project **name** is `agent.project` in `chatcomposer.tsx` (the registered project's name, the key of the
projects registry `chatFilesRoot` reads). An initiative's `EffortSummary.project` holds that same name (`wsh effort
create` stores `p.name`, `cmd/wsh/cmd/wshcmd-effort.go` `effortCreateProject`), and a conversation's
`SessionActivity.projectname` is a name too. So both groups are ordered by the name, not by `filesRoot` (which is the
cwd or the project's path).

**Step 1: Failing tests** (`refmention.test.ts`)

- `sessionRefs(sessions, projectName, now)`: the newest 20 by `lastactivets`, the chat's project
  (`projectname === projectName`) first, each group newest first; `label` = first line of `task` or `projectname`;
  `detail` = `[projectname, runtime, formatAgo(now - lastactivets)].filter(Boolean).join(" · ")`; `kind: "session"`;
  `ts = -i` over that order (as `agentRefs` does), so `refMatches`' ts sort keeps the project-first order.
- `effortRefs(efforts, projectName)`: those with `status !== "archived"`, the chat's project
  (`project === projectName`) first, each group by `updatedts` newest first; `label` = `title`; `detail` =
  `` `${done}/${total} chunks · ${status}` ``; `id` = the oid (oref without `effort:`); `ts = -i` over that order.
- `queryKind("sess")` → `"session"`, `queryKind("conv")` → `"session"`, `queryKind("hội th")` → `"session"` (a bare
  `"hội"` still hits council's "hội đồng" first, which is fine), `queryKind("init")` → `"effort"`,
  `queryKind("eff")` → `"effort"`.
- `refMatches("session:9f31", items)` lists the sessions whose id starts with it, `refMatches("effort:e9b2", items)`
  the initiatives; `refToken` gives `session:9f31d0b4` / `effort:e9b20f17`.
- With every kind present and a query that hits them all, agents, runs and councils still lead in that order;
  sessions then initiatives after them.

Run: `npx vitest run frontend/app/view/agents/refmention.test.ts` — Expected: FAIL.

**Step 2: Implement.** `ADDRESS_QUERY` takes `session|effort`; update the file's header comment and `refMatches`' doc
comment for the two kinds. `sessionRefs` and `effortRefs` as tested. `useRefItems(project, projectName, selfId, want)`
gains the name parameter; while `want` it calls `loadSessionsArchive()` when `sessionsArchiveAtom` is `null` and
`loadRefEfforts()` when `refEffortsAtom` is `null` (neither gated on `project === ""`), and appends
`sessionRefs(sessions ?? [], projectName, Date.now())` and `effortRefs(efforts ?? [], projectName)` after the
councils. In `chatcomposer.tsx` the call becomes `useRefItems(filesRoot, agent.project ?? "", agent.id, ...)`.

Run the tests — PASS.

**Step 3: Commit**

```bash
git commit -m "feat(chat): the @ picker offers past conversations and initiatives" -- frontend/app/view/agents/refmention.ts frontend/app/view/agents/refmention.test.ts frontend/app/view/agents/refmentionstore.ts frontend/app/view/agents/chatcomposer.tsx
```

### Task 4: The box makes a badge or a file pill of a typed or pasted token, and a deleted pill takes one space

**Depends on:** Task 1 (both edit `chateditormodel.test.ts`; the transform badges the session: and effort: kinds Task 1 adds)

**Files:** `frontend/app/view/agents/chateditor.tsx`, `frontend/app/view/agents/chateditormodel.ts`, `frontend/app/view/agents/chateditormodel.test.ts`

Two gaps part 1 left (spec "In the box"):

- Today a reference or an `@path` becomes a badge or a file pill in the box only when the box's value is set from
  outside (a pick from `@`, a draft brought back): `chateditor.tsx` rebuilds its nodes only there
  (`$rebuild(segmentsOf(...))` under the `external` tag). A token the person types or pastes stays text until it is
  sent; the person hit it with a typed `@../arcterm/cdp-shots` (a folder).
- Backspace on a selected pill (`$deletePill`, the `$isNodeSelection` branch) removes the node and leaves the gap
  spaces on both sides, so `đọc agent:7cd99627 ` reads `đọc  ` (two spaces). The same happens to an `@path` pill.

**Step 1: Failing tests** (in `chateditormodel.test.ts`), for two new pure helpers in `chateditormodel.ts`. The runs
carry their segment, so match with `toMatchObject` (or give the full shape):

```ts
describe("atomRunsIn", () => {
    it("finds a finished reference, not one still being typed", () => {
        expect(atomRunsIn("đọc agent:7cd99627 ", 19)).toMatchObject([
            { start: 4, end: 18, seg: { kind: "ref", ref: "agent", id: "7cd99627", raw: "agent:7cd99627" } },
        ]);
        expect(atomRunsIn("đọc agent:7cd99627", 18)).toEqual([]); // caret at its end: still typing
        expect(atomRunsIn("đọc agent:7cd99627, ok", 22)).toMatchObject([{ start: 4, end: 18 }]);
    });
    it("takes a pasted run of several", () => {
        expect(atomRunsIn("run:071a8e3b council:c41d9e02 ", 30).map((r) => r.seg)).toMatchObject([
            { kind: "ref", raw: "run:071a8e3b" },
            { kind: "ref", raw: "council:c41d9e02" },
        ]);
    });
    it("finds a finished @path, a folder too, as a file pill", () => {
        expect(atomRunsIn("xem @../arcterm/cdp-shots ", 26)).toMatchObject([
            { start: 4, end: 25, seg: { kind: "pill", path: "../arcterm/cdp-shots" } },
        ]);
        expect(atomRunsIn("@src/agent:7cd9.ts ", 19)).toMatchObject([{ seg: { kind: "pill", path: "src/agent:7cd9.ts" } }]);
    });
    it("leaves an @path still being typed", () => {
        expect(atomRunsIn("xem @../arcterm/cdp-sh", 22)).toEqual([]);
    });
});

describe("gapToDrop", () => {
    it("drops the space after a pill that has a space on both sides", () => {
        expect(gapToDrop("đọc ", " ")).toBe("after");
        expect(gapToDrop("đọc ", " tiếp")).toBe("after");
    });
    it("drops the space before a pill at the end of the line", () => {
        expect(gapToDrop("đọc ", "")).toBe("before");
    });
    it("drops the space after a pill at the start of the line", () => {
        expect(gapToDrop("", " tiếp")).toBe("after");
    });
    it("keeps a single space and punctuation", () => {
        expect(gapToDrop("đọc", " tiếp")).toBeNull();
        expect(gapToDrop("đọc ", ", tiếp")).toBeNull();
    });
});
```

Check the offsets against `segmentsOf` / `mentionTokens` as they are (a test's numbers are the plan's reading; the
helpers' rule is what counts: a token finished by a space or punctuation, the caret rule of `mentionTokens` and
`refSpans`).

Run: `npx vitest run frontend/app/view/agents/chateditormodel.test.ts` — FAIL.

**Step 2: Implement the helpers.** `atomRunsIn(text, caret?)` returns `{ start, end, seg }` for each atom segment
(`pill` and `ref`) of `segmentsOf(text, caret)`, with its offsets (walk the segments summing `segmentLength`).
`gapToDrop(before, after)` says which of the two gap spaces a removed pill leaves behind goes: `"after"` when `after`
starts with a space and `before` is empty or ends in a space, `"before"` when `after` is empty and `before` ends in a
space, else `null`. Run the tests — PASS.

**Step 3: Pill while typing.** In the `TextNode` transform `chateditor.tsx` registers for `$gapAroundPills` (not while
composing, not in bash mode: `props.current.bash` draws no pills), before the gap rule: take the caret's offset in the
node when the selection's focus is in it, run `atomRunsIn(node text, that offset)`, and for each run (from the last to
the first) split the text node at its ends (`splitText`) and replace the middle with
`$createRefMentionNode(seg.ref, seg.id, seg.raw)` for a `ref`, `$createFileMentionNode(seg.path)` for a `pill`; put the
caret back where it was in the text (after the node when it was in the text after it). The box's value stays the same
string (a badge's text is its `raw`, a file pill's is `mentionText(path)`, which `segmentsOf` only makes a pill of when
it equals the text), so the update listener sends no change and no `external` rebuild follows. A paste goes through the
same transform: a pasted token followed by a space or punctuation becomes a node, one at the very end waits for the
next character, as a typed one does.

**Step 4: One space after a delete.** In `$deletePill`'s node-selection branch, for each removed pill read the text
just before it and just after it in its line (the sibling text nodes, or "" at a line edge or beside another pill),
remove the pill, then drop one space as `gapToDrop` says (the first character of the text after, or the last of the
text before), and place the caret where the pill was. This applies to `@path` pills too.

**Step 5: Check.** `npx vitest run frontend/app/view/agents/chateditormodel.test.ts` — PASS. The scenario steps that
show both are Task 5's ("typed badge", "typed file pill", "one space after delete").

**Step 6: Commit**

```bash
git commit -m "feat(chat): a reference or @path typed or pasted in the box becomes a badge or pill; deleting a pill leaves one space" -- frontend/app/view/agents/chateditor.tsx frontend/app/view/agents/chateditormodel.ts frontend/app/view/agents/chateditormodel.test.ts
```

### Task 5: Scenario, changelog, hand check

**Depends on:** Task 3 (the scenario's picker step lists the conversation and initiative rows it adds), Task 4 (the scenario's typing and delete steps show the pill-while-typing and one-space delete it adds)

**Files:** `scripts/cdp/scenarios.mjs`, `CHANGELOG.md`, `docs/hand-checks.md`

**Step 1: Scenario.** Extend part 1's `chat-ref-badges` scenario (`scripts/cdp/scenarios.mjs`, `crbSeed`,
`crbBoxText`, `crbReadBadge`). New fixtures:

- **An initiative, real:** in `arrange`, create one in the page with
  `RpcApi.EffortCreateCommand(TabRpcClient, { title: "Ref badges initiative", project: ctx.project, chunks: [two
  chunks] })` and keep its oid (the oref without `effort:`) in `ctx`; `teardown` deletes it with
  `EffortDeleteCommand` (log a failure as the teardown does today, never throw). Real, so a click can open it.
- **A conversation, seeded:** `crbSeed` also puts one conversation in `sessionsArchiveAtom`
  (`sessionsarchivestore.ts`), prepended to what is there:
  `{ id: CRB_SESSION_ID, runtime: "claude", task: "Ref badges conversation\nmore", projectname: ctx.project,
  projectpath: <path>, lastactivets: Date.now() - 2 * 3_600_000, … }` (the other required `SessionActivity` fields
  empty), and sets `refEffortsAtom` (`refmentionstore.ts`) to null so the next read lists the real initiative.
  `crbSeed` takes the extra ids it needs from `ctx`.

A's user message gains `… đọc session:<CRB_SESSION_ID 8> và effort:<the initiative's 8>, rồi session:77aa01fe và
effort:deadbeef.` Add steps (each new visual state gets its own shot, named `cdp-shots/chat-ref-badges-<state>.png`):

- **resolved conversation badge:** `data-ref-state="resolved"`, `data-ref-mark="session"`, name "Ref badges
  conversation", `[data-ref-meta]` text `2h`, a title starting "Ref badges conversation · conversation" and ending
  "(click to open)", wrapped in a `role="button"`. Do not click it: opening a conversation reopens it as a live agent.
- **resolved initiative badge:** `data-ref-mark="effort"`, name "Ref badges initiative", meta `0/2`, title "Ref badges
  initiative · initiative <8> · 0 of 2 chunks done (click to open)"; a click on it opens the initiative (read the
  surface and the selected effort from the page's atoms, as part 1's agent click reads the focus), then return to the
  Agent surface and A's chat for the next steps.
- **unresolved:** `[data-chat-ref="session:77aa01fe"]` and `[data-chat-ref="effort:deadbeef"]` are
  `data-ref-state="unresolved"`, their titles "No conversation 77aa01fe in the loaded history" / "No initiative
  deadbeef".
- **picker:** typing `@init` into the box lists a row naming "Ref badges initiative"; typing `@conv` lists a row naming
  "Ref badges conversation" (re-run `crbSeed` first if a load replaced the seed). Clear the box after each.
- **typed badge:** re-run `crbSeed` (typing `@` above re-read the runs over the seed), then type with key events (not a
  value set from outside) `xem run:<CRB_RUN_ID 8> ` into an empty box: the box holds a `[data-chat-ref]` badge whose
  name is `CRB_RUN_NAME`, and `crbBoxText` is exactly `xem run:<8> `; then typing `agent:<A's 8>` with no character
  after it adds no badge (it is still text).
- **typed file pill:** in an empty box, type `xem @../arcterm/cdp-shots ` with key events: the box holds one
  `[data-chat-pill]` (the file pill) and `crbBoxText` is exactly `xem @../arcterm/cdp-shots `.
- **one space after delete:** part 1's delete step (Backspace twice beside a badge) now reads the box's text with a
  single space where the badge was (`đọc ` where it read `đọc  `).

Check the file with `node --check scripts/cdp/scenarios.mjs`; the run's Final runs the scenario (no dev app runs in a
worker).

**Step 2: Changelog.** Widen part 1's `Added` line (same `## Unreleased`): "References to agents, runs, councils,
past conversations and initiatives you write in Chat …"; add under `Changed`: "A reference or an `@path` you type or paste into Chat's box becomes a badge or a file pill as
soon as a space or punctuation follows it, and deleting one leaves a single space."

**Step 3: Hand check.** In `docs/hand-checks.md`, in the line "Chat ref badges with real data", replace "A token typed
or pasted into the box stays text (badges only in the bubble)." with "A token or an @path typed or pasted into the box
becomes a badge or a file pill once a space or punctuation follows it; deleting one leaves one space." Then add:
`- [ ] (arcterm) Chat ref badges: a session: of a recent conversation shows its title and age and a click reopens it as an agent; an effort: whose chunks are all done shows its done/total in green`

**Step 4: Commit**

```bash
git commit -m "test(chat): session and effort badges and typed pills in the ref badges scenario; changelog and hand check" -- scripts/cdp/scenarios.mjs CHANGELOG.md docs/hand-checks.md
```
