# Chat ref badges, part 2: session: and effort: Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** `session:<id>` (a past conversation) and `effort:<id>` (an initiative) draw as badges in Chat's box and
bubbles, like part 1's agent, run and council badges, and the `@` picker offers them.

**Architecture:** Part 1 (plan `docs/superpowers/plans/2026-11-17-chat-ref-badges.md`, merged before this starts)
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

**Files:** `frontend/app/view/agents/refbadge.ts`, `frontend/app/view/agents/refbadge.test.ts`, `frontend/app/view/agents/chateditormodel.test.ts`

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
    expect(resolveRef("session", "9f31d0b4", src2)).toMatchObject({ status: "resolved", name: "Fix CDP fails", meta: "3d" });
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

In `chateditormodel.test.ts`: `segmentsOf("đọc session:9f31d0b4 ")` makes a `ref` segment with `ref: "session"`.

Run: `npx vitest run frontend/app/view/agents/refbadge.test.ts frontend/app/view/agents/chateditormodel.test.ts`
Expected: FAIL.

**Step 2: Implement**

- `BadgeKind` gains `"session" | "effort"`; `REF_RE`'s kind group gains `session|effort`.
- `RefSources` gains `sessions: readonly Pick<SessionActivity, "id" | "runtime" | "task" | "projectname" | "lastactivets">[]`,
  `efforts: readonly Pick<EffortSummary, "oref" | "title" | "done" | "total">[]` and `now: number` (the caller passes
  `Date.now()`; tests pass a fixed one). Part 1's callers pass `sessions: []`, `efforts: []`, `now: Date.now()` until
  Task 2 fills them.
- The resolved shape gains optional `meta?: string`, `metaDone?: boolean`, and for a session `runtime` and `project`.
- `resolveRef`: `session` and `effort` are looked up before the "no project" check (they do not depend on one). A
  session: `pick(src.sessions, (s) => s.id, id)`, name = first line of `task`, else `projectname`, else the id;
  `meta = formatAge(now - lastactivets)` (`agentsviewmodel.ts`). An initiative: compare against the oid,
  `oref.replace(/^effort:/, "")`; `id` is that oid; `meta = \`${done}/${total}\``, `metaDone = total > 0 && done === total`.
  Reasons as the tests say; the many-hits reason names "conversations" / "initiatives".
- `badgeLook`: `session` → `{ frame: NEUTRAL_FRAME, mark: "session", dot: null }`, `effort` likewise with `"effort"`.
- `refTitle`: the two lines the tests give (`formatAgo` for "3d ago").

Run the tests — Expected: PASS. Then `npx vitest run frontend/app/view/agents/` for the neighbours part 1 touched.

**Step 3: Commit**

```bash
git commit -m "feat(chat): ref badges resolve session: and effort:" -- frontend/app/view/agents/refbadge.ts frontend/app/view/agents/refbadge.test.ts frontend/app/view/agents/chateditormodel.test.ts
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
`sessions`, `efforts`, `now: Date.now()` to `resolveRef`.

**Step 3: The face.** Mark `session`: lucide `History`, `effort`: lucide `Flag`, both `size={12}
className="shrink-0 text-muted"`. When `meta` is set, after the name:
`<span data-ref-meta className={cn("shrink-0 text-[11.5px] tabular-nums", metaDone ? "text-success" : "text-muted")}>{meta}</span>`.
Raise the face's `max-w-[240px]` to `max-w-[260px]` only for a badge with meta, so the name keeps room; the meta
never truncates (`shrink-0`).

**Step 4: The open target.** In `RefBadge`'s click: `session` → `{ kind: "session", sessionId: resolved.id }`,
`effort` → `{ kind: "effort", effortId: resolved.id }`, through the same `openOrPeek`.

**Step 5: Typecheck and commit**

Run: `npx vitest run frontend/app/view/agents/refbadge.test.ts` — PASS.

```bash
git commit -m "feat(chat): conversation and initiative badges draw and open" -- frontend/app/view/agents/chatrefbadge.tsx frontend/app/view/agents/refmentionstore.ts
```

### Task 3: The @ picker offers conversations and initiatives

**Depends on:** Task 2 (`useRefItems` reads the `refEffortsAtom` and loader it adds)

**Files:** `frontend/app/view/agents/refmention.ts`, `frontend/app/view/agents/refmention.test.ts`, `frontend/app/view/agents/refmentionstore.ts`, `frontend/app/view/agents/filemention.tsx`

**Step 1: Failing tests** (`refmention.test.ts`)

- `sessionRefs(sessions, projectPath)`: newest 20 by `lastactivets`, the chat's project (`projectpath` equal to
  `projectPath`) first; `label` = first line of `task` or `projectname`; `detail` = `[projectname, runtime,
  formatAgo(now - lastactivets)].join(" · ")`; `kind: "session"`; `ts = lastactivets`.
- `effortRefs(efforts, projectName)`: those with `status !== "archived"`, the chat's project first, `label` = `title`,
  `detail` = `` `${done}/${total} chunks` `` plus the status, `id` = the oid (oref without `effort:`).
- `queryKind("sess")` → `"session"`, `queryKind("conv")` → `"session"`, `queryKind("hội")` → `"session"`,
  `queryKind("init")` → `"effort"`, `queryKind("eff")` → `"effort"`.
- `refMatches("session:9f31", items)` lists the sessions whose id starts with it; `refToken` gives `session:9f31d0b4`.
- Agents, runs and councils still lead in that order; sessions then initiatives after them.

Run: `npx vitest run frontend/app/view/agents/refmention.test.ts` — Expected: FAIL.

**Step 2: Implement.** `RefKind` gains `"session" | "effort"`; `KIND_WORDS` gains
`session: ["session", "sessions", "conversation", "conversations", "hội thoại"]` and
`effort: ["effort", "efforts", "initiative", "initiatives"]`; `ADDRESS_QUERY` takes `session|effort`; `kindOrder`
puts them 3 and 4. `useRefItems` adds `sessionRefs` and `effortRefs` (loading the archive and `loadRefEfforts()` while
`want`), with the project path and the project name it already has. In `filemention.tsx`, the picker row's icon for
the two new kinds is `History` / `Flag` (find how it picks the agent / run / council icon and add two cases).

Run the tests — PASS.

**Step 3: Commit**

```bash
git commit -m "feat(chat): the @ picker offers past conversations and initiatives" -- frontend/app/view/agents/refmention.ts frontend/app/view/agents/refmention.test.ts frontend/app/view/agents/refmentionstore.ts frontend/app/view/agents/filemention.tsx
```

### Task 4: Scenario, changelog, hand check

**Depends on:** Task 3 (the scenario's picker step lists the conversation and initiative rows it adds)

**Files:** `scripts/cdp/scenarios.mjs`, `CHANGELOG.md`, `docs/hand-checks.md`

**Step 1: Scenario.** Extend part 1's `chat-ref-badges` scenario: its user message gains
`… đọc session:77aa01fe và effort:deadbeef.` Add steps:

- `[data-chat-ref="session:77aa01fe"]` and `[data-chat-ref="effort:deadbeef"]` are `data-ref-state="unresolved"`, their
  titles start "No conversation 77aa01fe" / "No initiative deadbeef";
- typing `@init` into the box lists an initiative group (or, with none in the dev store, no error and the files list
  still shown), and typing `@conv` lists the conversation rows (the fixture's own transcript is a conversation of
  the archive once it has loaded; if the dev store's archive is empty, record the row count instead of failing).

Run: `CDP_PORT=9222 task verify:ui -- chat-ref-badges` — PASS.

**Step 2: Changelog.** Widen part 1's `Added` line (same `## Unreleased`): "References to agents, runs, councils,
past conversations and initiatives you write in Chat …".

**Step 3: Hand check.** Add to `docs/hand-checks.md`:
`- [ ] (arcterm) Chat ref badges: a session: of a recent conversation shows its title and age and reopens it; an effort: shows its done/total and opens the initiative`

**Step 4: Commit**

```bash
git commit -m "test(chat): session and effort badges in the ref badges scenario; changelog and hand check" -- scripts/cdp/scenarios.mjs CHANGELOG.md docs/hand-checks.md
```
