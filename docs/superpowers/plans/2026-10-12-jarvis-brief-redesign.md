# Jarvis Brief redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the Jarvis Brief show what needs you first and fit on one screen, as specified in
`docs/superpowers/specs/2026-10-12-jarvis-brief-redesign-design.md` (the spec; read it before any task).

**Architecture:** One pure run-stage derivation (`frontend/app/view/agents/runstage.ts`) replaces the four ways the
Agent tree, the Brief and the run sheet each named a run's stage. Other pure logic changes land in the existing pure `.ts` files beside their `.test.ts` (briefrows,
briefautonomy, attentionact, attentionrun, initiativework, sidebarnotes, runsheetmodel, briefingmodel). The views
(`briefsurface.tsx`, `briefrowviews.tsx`, `inlinetrackerview.tsx`, `chunksidebar.tsx`, `runsheet.tsx`) are rearranged
around them. One Go string changes (`pkg/jarvis/attention.go`). CDP scenarios in `scripts/cdp/scenarios.mjs` show
every view.

**Tech Stack:** React 19, Tailwind 4 (`@theme` tokens only, never raw hex), jotai, motion/react, vitest, Go, CDP.

The mockup is a gitignored canvas that a worktree does not have; read it at its absolute path:
`.superpowers/design/jarvis-overview/project/` (boards `Proposed-Brief.dc.html`,
`Proposed-ChunkPanel.dc.html`, `Proposed-ChunkPanel-States.dc.html`, `Proposed-RunSheet.dc.html`, `Proposed-RunStates.dc.html`,
`Proposed-AllClear.dc.html`). Its inline hex values are the `@theme` tokens: map them back to token utilities
(`#262624` → `bg-surface`, `#30302e` → `bg-surface-raised`, `#383734` → `border-edge-mid`, `#2e2d2b` →
`border-border`, `#282725` → `border-edge-faint`, `#4a4945` → `border-edge-strong`, `#a2a2a2` → `text-ink-mid`,
`#a3a198` → `text-muted`, `#c2c0b6` → `text-secondary`, `#e3e3e3` → `text-ink-hi`, `#d97757` → `accent`, `#e4a089`
→ `accent-soft`, `#ffc107` → `asking`, `#4eba65` → `success`, `#ff6b80` → `error`).

Rules for every task: follow `DESIGN.md`; no raw hex or rgba in `className` or `style`; check only the files you
touched with `npx prettier --check <files>` and `npx eslint <files>` (never `--write` the tree; never prettier on
`scripts/*.mjs`); typecheck with `task check:ts` (about 2 minutes; the baseline is clean). Commit with a pathspec
(`git commit -m "…" -- <files>`), never a bare `git commit`.

**Verify:** `node scripts/verify.mjs ./pkg/jarvis`

**Final:** `if [ "$(uname -s)" = Darwin ]; then echo "unverified: brief-surface brief-layout brief-chunk-panel brief-run-sheet-order need CDP, which WKWebView on macOS does not answer"; exit 3; fi; node scripts/cdp/final-verify.mjs brief-surface brief-layout brief-chunk-panel brief-run-sheet-order`

---

### Task 1: One run stage for every surface, and the strip's three-pip tail

**Depends on:** none

Spec section "Run states". Mockup board `Proposed-RunStates.dc.html`.

**Files:**
- Create: `frontend/app/view/agents/runstage.ts`
- Test: `frontend/app/view/agents/runstage.test.ts`
- Modify: `frontend/app/view/agents/runmodel.ts` (`finishedRunLabel`, `dagProgressLabel`, `runComplete`,
  `runStatusView`)
- Test: `frontend/app/view/agents/runmodel.test.ts` (the four `describe`s at lines 54-180)
- Modify: `frontend/app/view/agents/runstrip.ts` (add `PIP_FILL`)
- Modify: `frontend/app/view/agents/agenttree.tsx` (`TaskStripBar`, `RunCompleteLabel`, `RunSubline`, about lines
  352-445)
- Modify: `frontend/app/view/jarvis/runsheet.tsx` (`SheetBarView`, about line 442; its caller passes the run)
- Modify: `frontend/app/view/jarvis/runsheetmodel.ts` (verbs: `doneStatus` about 139, `undaggedStatus` /
  `daggedStatus` at the `Executing`, `Landing` and `Verifying` returns, about 288-400)
- Test: `frontend/app/view/jarvis/runsheetmodel.test.ts` (verb expectations at 182, 205, 223, 241, 271, 293, 366, 412,
  445)
- Modify: `frontend/app/view/jarvis/briefrows.ts` (`runRowFace`) and `frontend/app/view/jarvis/briefstyle.ts`
  (`Tone`, `TONE_TEXT`)
- Test: `frontend/app/view/jarvis/briefrows.test.ts` (`describe("runRowFace")`, about line 446)
- Modify: `frontend/app/view/jarvis/briefsurface.tsx` (`BriefRunRow` only, about lines 507-557)
- Test (expectations only): `frontend/app/view/agents/leadcardmodel.test.ts` (it reads `finishedRunLabel`)

**Step 1: Write the failing test** `frontend/app/view/agents/runstage.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { RunInfo } from "./runlineage";
import { runStage } from "./runstage";

type R = Pick<RunInfo, "status" | "land" | "dag">;
const dag = (status: string, final?: Partial<FinalStage>): TaskGroup =>
    ({ status, tasks: [], final: final ? { round: 1, ...final } : undefined }) as unknown as TaskGroup;
const pips = (r: R, asking = false) => runStage(r, asking).tail.map((p) => p.state);

describe("runStage", () => {
    it("names each stage once, in the one vocabulary", () => {
        const cases: [R, string][] = [
            [{ status: "planning" }, "Planning"],
            [{ status: "awaiting-review" }, "Plan review"],
            [{ status: "executing", dag: dag("plan-review") }, "Plan review"],
            [{ status: "executing", dag: dag("running") }, "Working"],
            [{ status: "executing" }, "Working"],
            [{ status: "executing", dag: dag("finalizing", { state: "checking", step: "final" }) }, "Final check"],
            [{ status: "executing", dag: dag("done", { state: "passed" }) }, "Wrapping up"],
            [{ status: "done", land: { state: "pending" }, dag: dag("done", { state: "passed" }) }, "Landing"],
            [{ status: "done", land: { state: "held", reason: "staged changes" }, dag: dag("done") }, "Land held"],
            [{ status: "done", land: { state: "landed" }, dag: dag("done", { state: "passed" }) }, "Landed"],
            [{ status: "done", dag: dag("done") }, "Complete"],
            [{ status: "executing", dag: dag("cancelled") }, "Cancelled"],
            [{ status: "cancelled" }, "Cancelled"],
        ];
        for (const [r, want] of cases) {
            expect(runStage(r).label, JSON.stringify(r)).toBe(want);
        }
    });

    it("is complete only once nothing is left: landed, or done with nothing to land", () => {
        expect(runStage({ status: "done", land: { state: "landed" }, dag: dag("done") }).complete).toBe(true);
        expect(runStage({ status: "done", dag: dag("done") }).complete).toBe(true);
        expect(runStage({ status: "done", land: { state: "pending" }, dag: dag("done") }).complete).toBe(false);
        expect(runStage({ status: "done", land: { state: "held" }, dag: dag("done") }).complete).toBe(false);
        expect(runStage({ status: "executing", dag: dag("done") }).complete).toBe(false);
        expect(runStage({ status: "executing", dag: dag("finalizing") }).complete).toBe(false);
    });

    it("says when the run needs you, apart from where it is", () => {
        expect(runStage({ status: "executing", dag: dag("running") }, true).needsYou).toBe(true);
        expect(runStage({ status: "executing", dag: dag("blocked") }).needsYou).toBe(true);
        expect(runStage({ status: "awaiting-review" }).needsYou).toBe(true);
        expect(runStage({ status: "done", land: { state: "held" }, dag: dag("done") }).needsYou).toBe(true);
        expect(runStage({ status: "done", land: { state: "held", dismissed: true }, dag: dag("done") }).needsYou).toBe(
            false
        );
        expect(runStage({ status: "executing", dag: dag("finalizing") }).needsYou).toBe(false);
    });

    it("draws the tail: Final check, Wrap-up, Land", () => {
        expect(pips({ status: "executing", dag: dag("running") })).toEqual(["pending", "pending", "pending"]);
        expect(pips({ status: "executing", dag: dag("finalizing", { state: "final" }) })).toEqual([
            "active",
            "pending",
            "pending",
        ]);
        expect(pips({ status: "executing", dag: dag("running", { state: "failed" }) })).toEqual([
            "failed",
            "pending",
            "pending",
        ]);
        expect(pips({ status: "executing", dag: dag("done", { state: "passed" }) })).toEqual([
            "done",
            "active",
            "pending",
        ]);
        expect(pips({ status: "done", land: { state: "pending" }, dag: dag("done", { state: "passed" }) })).toEqual([
            "done",
            "done",
            "active",
        ]);
        expect(pips({ status: "done", land: { state: "held" }, dag: dag("done", { state: "passed" }) })).toEqual([
            "done",
            "done",
            "held",
        ]);
        expect(
            pips({ status: "done", land: { state: "landed" }, dag: dag("done", { state: "unverified" }) })
        ).toEqual(["held", "done", "done"]);
        expect(pips({ status: "done", dag: dag("done", { state: "passed" }) })).toEqual(["done", "done", "skipped"]);
        expect(pips({ status: "cancelled", dag: dag("cancelled") })).toEqual(["skipped", "skipped", "skipped"]);
    });

    it("gives a run with no dag the Land pip alone", () => {
        expect(runStage({ status: "executing" }).tail).toEqual([{ name: "Land", state: "pending" }]);
        expect(runStage({ status: "done", land: { state: "landed" } }).tail).toEqual([{ name: "Land", state: "done" }]);
    });

    it("carries the final outcome and tones by it", () => {
        const landed = (state: string) =>
            runStage({ status: "done", land: { state: "landed" }, dag: dag("done", { state }) });
        expect(landed("passed")).toMatchObject({ outcome: "passed", tone: "done" });
        expect(landed("unverified")).toMatchObject({ outcome: "unverified", tone: "asking" });
        expect(runStage({ status: "executing", dag: dag("finalizing", { state: "failed" }) }).tone).toBe("error");
        expect(runStage({ status: "cancelled" }).tone).toBe("muted");
        expect(runStage({ status: "executing", dag: dag("running") }).tone).toBe("working");
        expect(runStage({ status: "executing", dag: dag("finalizing") }).tone).toBe("running");
    });
});
```

**Step 2: Run it and see it fail**

Run: `npx vitest run frontend/app/view/agents/runstage.test.ts`
Expected: FAIL (`./runstage` does not exist).

**Step 3: Implement** `frontend/app/view/agents/runstage.ts`:

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// A run's stage, said one way everywhere. A run carries four state machines (run.status, dag.status,
// dag.final.state, run.land.state), and the Agent tree, the Brief and the run sheet each used to combine a
// different subset, so one stage read four ways. This is the one combination: where the run is, whether it
// needs you, how it came out, and the strip's tail. Pure: no React, no Wave runtime imports.

import type { RunInfo } from "./runlineage";

export type RunStageKey =
    | "planning"
    | "plan-review"
    | "working"
    | "final-check"
    | "wrapping-up"
    | "landing"
    | "land-held"
    | "landed"
    | "complete"
    | "cancelled";
export type PipState = "pending" | "active" | "done" | "held" | "failed" | "skipped";
// working is a task at work (green, like an agent); running is the engine moving the run on (blue)
export type StageTone = "working" | "running" | "asking" | "done" | "error" | "muted";
export type TailPip = { name: "Final check" | "Wrap-up" | "Land"; state: PipState };

export interface RunStageView {
    key: RunStageKey;
    label: string;
    tone: StageTone;
    needsYou: boolean;
    outcome: "" | "passed" | "unverified" | "failed";
    complete: boolean;
    tail: TailPip[];
}

const LABEL: Record<RunStageKey, string> = {
    planning: "Planning",
    "plan-review": "Plan review",
    working: "Working",
    "final-check": "Final check",
    "wrapping-up": "Wrapping up",
    landing: "Landing",
    "land-held": "Land held",
    landed: "Landed",
    complete: "Complete",
    cancelled: "Cancelled",
};

// lifecycle order, for "is the run past this stage"; land-held sits with landing
const ORDER: RunStageKey[] = [
    "planning",
    "plan-review",
    "working",
    "final-check",
    "wrapping-up",
    "landing",
    "land-held",
    "landed",
    "complete",
];

function stageKey(run: Pick<RunInfo, "status" | "land" | "dag">): RunStageKey {
    const status = run.status ?? "";
    const dagStatus = run.dag?.status ?? "";
    if (status === "cancelled" || dagStatus === "cancelled") {
        return "cancelled";
    }
    if (status === "done") {
        // a done run on its own branch is not in its base until the branch lands; with no land, nothing to land
        const land = run.land?.state;
        return land == null ? "complete" : land === "landed" ? "landed" : land === "held" ? "land-held" : "landing";
    }
    if (dagStatus === "done") {
        return "wrapping-up";
    }
    if (dagStatus === "finalizing") {
        return "final-check";
    }
    if (dagStatus === "plan-review" || status === "awaiting-review" || status === "plan-review") {
        return "plan-review";
    }
    if (run.dag != null || status === "executing" || status === "blocked") {
        return "working";
    }
    return "planning";
}

export function runStage(run: Pick<RunInfo, "status" | "land" | "dag">, asking = false): RunStageView {
    const key = stageKey(run);
    const status = run.status ?? "";
    const dagStatus = run.dag?.status ?? "";
    const finalState = run.dag?.final?.state ?? "";
    const outcome =
        finalState === "passed" || finalState === "unverified" || finalState === "failed" ? finalState : "";
    const past = (k: RunStageKey) => key !== "cancelled" && ORDER.indexOf(key) > ORDER.indexOf(k);
    const needsYou =
        key !== "cancelled" &&
        (asking ||
            status === "awaiting-review" ||
            status === "blocked" ||
            dagStatus === "blocked" ||
            dagStatus === "awaiting-review" ||
            (key === "land-held" && run.land?.dismissed !== true));
    const complete = key === "landed" || key === "complete";
    const tone: StageTone =
        key === "cancelled"
            ? "muted"
            : needsYou
              ? "asking"
              : finalState === "failed" && !complete
                ? "error"
                : complete
                  ? outcome === "unverified"
                      ? "asking"
                      : "done"
                  : key === "working"
                    ? "working"
                    : "running";

    const landPip: PipState =
        key === "cancelled" || key === "complete"
            ? "skipped"
            : key === "landed"
              ? "done"
              : key === "land-held"
                ? "held"
                : key === "landing"
                  ? "active"
                  : "pending";
    let tail: TailPip[];
    if (run.dag == null) {
        tail = [{ name: "Land", state: landPip }];
    } else {
        const finalPip: PipState =
            key === "cancelled"
                ? "skipped"
                : finalState === "failed"
                  ? "failed"
                  : key === "final-check"
                    ? "active"
                    : past("final-check")
                      ? outcome === "unverified"
                          ? "held"
                          : "done"
                      : "pending";
        const wrapPip: PipState =
            key === "cancelled" ? "skipped" : key === "wrapping-up" ? "active" : past("wrapping-up") ? "done" : "pending";
        tail = [
            { name: "Final check", state: finalPip },
            { name: "Wrap-up", state: wrapPip },
            { name: "Land", state: landPip },
        ];
    }
    return { key, label: LABEL[key], tone, needsYou, outcome, complete, tail };
}
```

**Step 4: Run it and see it pass.** Same command. Expected: PASS. If a case fails, fix the code, not the table: the
table is the spec's precedence.

**Step 5: The Agent tree's labels** (`runmodel.ts`). Rebuild the three helpers on `runStage`, keeping their
signatures so the callers do not change:

```ts
/** Pure: what a run whose plan finished is still doing, in the one stage vocabulary (runstage.ts). */
export function finishedRunLabel(run: Pick<RunInfo, "dag" | "status" | "land">): string {
    const s = runStage(run);
    return s.key === "wrapping-up" ? "Wrapping up · lead" : s.label;
}

/** Pure: a dag run's line in the Agents tree, the stage first so a cut line keeps it. Every task done is not the
 *  run done: the final stage, the lead's wrap-up and the land still follow. */
export function dagProgressLabel(
    run: Pick<RunInfo, "dag" | "status" | "land" | "leadStarted">,
    leadless: boolean
): string {
    const { done, total } = runProgress(run.dag);
    const s = runStage(run);
    if (s.key === "final-check") {
        return `Final check · ${finalStageActivity(run.dag?.final) ?? "verifying the merged result"}`;
    }
    if (s.key !== "working" && s.key !== "plan-review" && s.key !== "planning") {
        return finishedRunLabel(run);
    }
    const base = `${s.label} · ${done}/${total}`;
    if (leadless) {
        // a plan-path run gets its lead only at its first judgment event, so no lead yet is the normal case
        return `${base} · ${run.leadStarted ? "lead closed" : "lead starts if needed"}`;
    }
    return base;
}

export function runComplete(run: Pick<RunInfo, "dag" | "status" | "land">): boolean {
    return runStage(run).complete;
}
```

- Delete `COMPLETE_LABELS`. Delete `landView` if nothing else uses it.
- In `runStatusView`, change three labels: `executing` reads `"working"`, `finalizing` reads `"final check"`, and
  a done run with no land reads `"complete"`. Tones stay.
- Import `runStage` from `./runstage`. Check that `runstage.ts` imports only types from `runlineage.ts`, so the two
  files do not form a value import cycle.

Update `runmodel.test.ts` to the new words:
- `"lead wrapping up"` → `"Wrapping up · lead"`.
- `"run complete"` → `"Complete"`.
- `"landing"` / `"land held"` / `"landed"` → `"Landing"` / `"Land held"` / `"Landed"`.
- `"run cancelled"` → `"Cancelled"`.
- `"2/3 done"` → `"Working · 2/3"`.
- `"2/2 · verifying the merged result"` → `"Final check · verifying the merged result"`.
- Each `"2/2 · final: <step>"` → `"Final check · <step>"`.
- The leadless pair → `"Working · 2/3 · lead starts if needed"` / `"Working · 2/3 · lead closed"`.
- `runStatusView("finalizing")` → `{ label: "final check", tone: "running" }`.
- `runStatusView("done")` → `{ label: "complete", tone: "done" }`.

Then run `npx vitest run frontend/app/view/agents` and update every other expectation that pinned an old stage
word (`leadcardmodel.test.ts:448` and any others) to the same new words, and nothing else.

**Step 6: The strip's tail.** In `runstrip.ts`:

```ts
// the tail after a run's tasks: Final check, Wrap-up, Land (runstage.ts). Pending is the strip's own grey, so a
// tail with nothing started reads as more of the same road
export const PIP_FILL: Record<PipState, string> = {
    pending: "bg-edge-strong",
    active: "bg-running",
    done: "bg-success",
    held: "bg-warning",
    failed: "bg-error",
    skipped: "bg-muted/40",
};
```

In `agenttree.tsx`, `TaskStripBar` draws the tail after the segments (or the bar):

```tsx
const tail = runStage(run).tail;
return (
    <div
        role="img"
        aria-label={`${taskStripLabel(run.dag, run.digest)}; ${tail.map((p) => `${p.name} ${p.state}`).join(", ")}`}
        className="mt-[6px] flex h-[3px] gap-[5px]"
    >
        <span className="flex min-w-0 flex-1 gap-[2px]">{/* the existing segments or bar, unchanged */}</span>
        <span data-run-strip-tail className="flex flex-none gap-[2px] border-l border-edge-strong pl-[5px]">
            {tail.map((p) => (
                <span
                    key={p.name}
                    data-pip={p.state}
                    title={`${p.name}: ${p.state}`}
                    className={cn("w-3 rounded-[1.5px]", PIP_FILL[p.state])}
                />
            ))}
        </span>
    </div>
);
```

- **`RunCompleteLabel`:** keep the `Check` icon and the success colour. Append ` · unverified` when
  `runStage(run).outcome === "unverified"`, and colour the label `text-warning` in that case.
- **`RunSubline`, no-dag branch:** draw the `runStatusView` label as today. It now reads `working` / `complete`.
- **`RunSubline`, dag branch:** colour `progress` by `runStage(run).tone`: asking → `text-warning`, error →
  `text-error`, running → `text-running`, working, muted and done → `text-muted`.
- If the tree draws a run with no dag (a quick run) with no strip today, leave it without one.

**Step 7: The run sheet's strip.** `SheetBarView` takes the run, and its caller in `Reading` passes `run`. After the
segments, draw the same tail from `runStage({ status: run.status, land: run.land, dag: dag?.group ?? undefined })`,
with `PIP_FILL`, `data-run-strip-tail` and the same `title`s, at the sheet's `h-1` height and with a `w-4` pip width.

**Step 8: The run sheet's verbs** (`runsheetmodel.ts`). One vocabulary:
- Every `verb: "Executing"` becomes `verb: "Working"`.
- `verb: "Verifying"` (the finalizing branch) becomes `verb: "Final check"`.
- The `digest.next.kind === "terminal" && terminalstatus === "done"` branch becomes `verb: "Wrapping up"`, with
  `sub: \`all ${plural(total, "task")} done · the lead is writing the report\``.
- **`doneStatus`:** before it builds the Done face, read the land:

  ```ts
  if (run.land?.state === "pending") {
      return { verb: "Landing", sub: `merging wave/${run.id} into ${run.basebranch || "its base"}`, tone: "running", pulse: true, meter: STRIP, meta: [], next: null, retry: false };
  }
  if (run.land?.state === "held" && run.land.dismissed !== true) {
      return { verb: "Waiting on you", sub: `Not merged back: ${run.land.reason || "the engine gave no reason"}`, tone: "warning", pulse: true, meter: STRIP, meta: [], next: "Land again once the reason is cleared", retry: false };
  }
  ```

  Match the real `SheetStatus` fields and the tone names `doneStatus` already uses. Check `TONE_BG` in
  `runsheet.tsx` for the names that exist. The dock keeps its own held line and Land again button.

The attention chip in `daggedStatus` (`` `attention ${digest.counts.attention}` ``, about line 353) reads
`` `${n} ${n === 1 ? "needs" : "need"} you` ``, so it says what it means (`runsheetmodel.test.ts:295` expects `"2 need you"`).

Update `runsheetmodel.test.ts`: `"Executing"` → `"Working"`, `"Verifying"` → `"Final check"`, and the two
`"Landing"` expectations at 205 and 241: read each case. The one for a done dag with the lead still finishing becomes
`"Wrapping up"`. Add one case each for a done run with `land: { state: "pending" }` (`"Landing"`) and with
`land: { state: "held", reason: "staged changes" }` (`"Waiting on you"`, sub containing "staged changes").

**Step 9: The Brief's Runs rows** (`briefrows.ts`, `briefstyle.ts`, `BriefRunRow`).
- **`briefstyle.ts`:** add `"running"` to `Tone`, with `running: "text-running"` in `TONE_TEXT`.
- **`runRowFace`:** gains an optional `dag?: TaskGroup` input. For a run that is present, replace the hand-built
  status ternary with the stage:

  ```ts
  const s = runStage({ status: run.status, land: run.land, dag: i.dag }, i.asking);
  const toneOf: Record<StageTone, LineTone> = { working: "ok", running: "running", asking: "asking", done: "ok", error: "error", muted: "faint" };
  // state: s.key === "working" ? "working" : s.label.toLowerCase()
  // stateTone: toneOf[s.tone]
  // dot: s.needsYou ? "asking" : s.complete ? "done" : s.key === "cancelled" ? "idle" : "live"
  // canStop stays !terminal; stopped stays status === "cancelled"
  ```

- **The run-less branch** (a direct agent, or a run not loaded yet) takes its tone from the line, so `blocked` is
  never green:

  ```ts
  if (run == null) {
      const asking = i.asking || line.state === "asking";
      // a direct agent (or a run not loaded yet) has no Run to read, so its line's own tone is the truth
      const tone: LineTone = asking ? "asking" : line.stateTone;
      return {
          type: "agent",
          meta: line.meta,
          elapsed: line.age,
          state: asking ? "asking" : line.state === "working" ? "running" : line.state,
          stateTone: tone,
          dot: tone === "asking" ? "asking" : tone === "ok" ? "live" : "idle",
          asking,
          canStop: false,
          stopped: false,
          chunkLabel: "",
          effortOref: "",
          chunk: "",
      };
  }
  ```

- **Tests** (`briefrows.test.ts`, `describe("runRowFace")`):
  - The existing orchestrator case now expects `state: "working"`, `stateTone: "ok"`.
  - Add a run-less case:

    ```ts
    it("takes a run-less row's tone from its own state, so blocked is never green", () => {
        const blocked = { ...line, state: "blocked", stateTone: "asking", meta: "waveterm" } as BriefLine;
        expect(runRowFace({ line: blocked, asking: false, project: "waveterm" })).toMatchObject({
            type: "agent",
            state: "blocked",
            stateTone: "asking",
            dot: "asking",
        });
    });
    ```

  - Add a case with `dag: { status: "finalizing", tasks: [] }` expecting `state: "final check"` and
    `stateTone: "running"`.
  - Add a done run with `land: { state: "held" }` expecting `state: "land held"`, `stateTone: "asking"`,
    `dot: "asking"`.
- **`BriefRunRow`** (`briefsurface.tsx`): read the lineage and pass the dag.

  ```tsx
  const lineage = useAtomValue(model.lineageAtom);
  // the lineage holds a lead run's dag; a run outside it reads by its own status alone
  const dag = run != null ? lineage.runs[run.id]?.dag : undefined;
  ```

  Then pass `dag` to `runRowFace`. Touch nothing else in `briefsurface.tsx`: Task 5 rearranges its layout.

**Step 10: Typecheck, lint, test, commit**

Run: `npx vitest run frontend/app/view/agents frontend/app/view/jarvis` (expected PASS), `task check:ts` (exit 0),
`npx eslint` on the touched files.

```bash
git commit -m "feat(runs): one stage vocabulary for the Agent tree, the Brief and the run sheet, and a tail on the strip so only Landed reads finished" -- frontend/app/view/agents/runstage.ts frontend/app/view/agents/runstage.test.ts frontend/app/view/agents/runmodel.ts frontend/app/view/agents/runmodel.test.ts frontend/app/view/agents/runstrip.ts frontend/app/view/agents/agenttree.tsx frontend/app/view/agents/leadcardmodel.test.ts frontend/app/view/jarvis/runsheet.tsx frontend/app/view/jarvis/runsheetmodel.ts frontend/app/view/jarvis/runsheetmodel.test.ts frontend/app/view/jarvis/briefrows.ts frontend/app/view/jarvis/briefrows.test.ts frontend/app/view/jarvis/briefstyle.ts frontend/app/view/jarvis/briefsurface.tsx
```

(Add any other test file Step 5 changed to the pathspec.)

The CDP steps that show these: `brief-run-sheet-order` steps 4 and 5, and `brief-layout` step 7 (Task 9).

### Task 2: Small bug fixes (the composer key, the tour offer, stale comments)

**Depends on:** none

**Files:**
- Modify: `frontend/app/view/jarvis/briefcomposer.tsx` (the root `div`, around line 128)
- Modify: `frontend/app/view/jarvis/jarvistourview.tsx` (`TourOffer`, the `className` at about line 434)
- Modify: `frontend/app/store/keybindings/bindings.ts` (the comment above `buildJarvisBindings`, about lines 594-601)
- Modify: `frontend/app/view/jarvis/newinitiativecontrol.tsx` (header comment, lines 4-12)

**Step 1: The composer key.** `bindings.ts`'s `jarvis:focus-composer` and `jarvis:blur-composer` query
`[data-jarvis-composer]`, which no element carries. Add the attribute to the composer's root in
`briefcomposer.tsx`:

```tsx
<div
    data-jarvis-composer=""
    data-jarvis-brief-band="composer"
    className="flex flex-col gap-1.5 border-t border-edge-faint px-4 pb-3 pt-2.5"
>
```

`blur-composer` runs in the dispatcher's capture phase, ahead of the textarea's own `onKeyDown`. Once the attribute
exists, the first `Esc` in the composer blurs it and a second `Esc` closes the sheet, which is what the docs promise.

**Step 2: The tour offer.** In `TourOffer`, change `"absolute right-4 top-[60px] z-30 w-[300px]"` to
`"absolute bottom-4 right-4 z-30 w-[300px]"`. The top-right placement covered the first region's tools (the Waiting
summary's Review button). The Brief's toast sits at `bottom-6` centred, so the two do not meet.

**Step 3: Stale comments.**
- The comment block above `buildJarvisBindings` in `bindings.ts` lists "the context rail" and "+ Channel". Neither
  exists since B5. Rewrite the two bullets as "state the registry owns outright (the graph peek, the run switcher)"
  and "a click on a control the surface already draws (New initiative, Work on, the record band's expand)".
- In `newinitiativecontrol.tsx`, change "This is the mount, next to + Channel, because those are the two things the
  Brief can begin. The ⇧N binding presses it by data attribute (buildJarvisBindings), the same way `c` presses +
  Channel." to "This is the mount in the Brief's header. The ⇧N binding presses it by data attribute
  (buildJarvisBindings)."

**Step 4: Typecheck, lint, commit**

Run: `task check:ts` (expected exit 0), `npx eslint frontend/app/view/jarvis/briefcomposer.tsx frontend/app/view/jarvis/jarvistourview.tsx`.

```bash
git commit -m "fix(jarvis): i reaches the run sheet composer, the tour offer stops covering Review" -- frontend/app/view/jarvis/briefcomposer.tsx frontend/app/view/jarvis/jarvistourview.tsx frontend/app/store/keybindings/bindings.ts frontend/app/view/jarvis/newinitiativecontrol.tsx
```

The CDP step that shows these: `brief-layout` step 6, and `brief-run-sheet-order` step 3 (Task 9).

### Task 3: Copy: Accept, the autonomy chip, short dates

**Depends on:** none

**Files:**
- Modify: `pkg/jarvis/attention.go:573` and `:577` (the `run-unverified` item's `Action` and `Why`)
- Test: `pkg/jarvis/attention_test.go:478`
- Modify: `frontend/app/view/jarvis/attentionact.ts` (the label union and the `ack-run` label)
- Test: `frontend/app/view/jarvis/attentionact.test.ts:27`
- Modify: `frontend/app/view/jarvis/attentionrun.ts:39`
- Test: `frontend/app/view/jarvis/attentionrun.test.ts:46,51,90`
- Test (fixture strings only): `frontend/app/view/jarvis/briefingmodel.test.ts:814,819`, `petactrun.test.ts:117`, `petacts.test.ts:84`, `petpeekmodel.test.ts:209,213`
- Modify: `frontend/app/view/jarvis/briefautonomy.ts` (`autonomySummary`)
- Test: `frontend/app/view/jarvis/briefautonomy.test.ts` (`describe("autonomySummary")`)
- Modify: `frontend/app/view/jarvis/initiativework.ts` (add `shortDate`, use it in `initiativeResume`)
- Test: `frontend/app/view/jarvis/initiativework.test.ts`

**Step 1: Update the tests first.**
- `attentionact.test.ts:27`: expect `{ label: "Accept", kind: "ack-run" }`.
- `attentionrun.test.ts`: `"Acknowledged · …"` becomes `"Accepted · …"` (three places).
- `briefingmodel.test.ts:814`: `label: "Accept"`. Rename the `it` at 819 to "accepts all only the rows whose own
  button is Accept".
- The pet tests (`petactrun.test.ts:117`, `petacts.test.ts:84`, `petpeekmodel.test.ts:209,213`): change the fixture
  `action` / `label` strings `"Acknowledge"` to `"Accept"`. Those labels come from the server's `Action`.
- `attention_test.go:478`: `got[0].Action != "Accept"`.
- `briefautonomy.test.ts`: the labels become `"Routine asks: auto"` (all gatekeeper), `"All asks: to you"` (all
  concierge), `"Mixed · 1 of 3 auto"` and `"Mixed · 2 of 3 auto"`.
- `initiativework.test.ts`: add

```ts
describe("shortDate", () => {
    it("reads a day as month and day, so 10-09 is never read as the 10th of September", () => {
        expect(shortDate(new Date(2026, 9, 9, 23, 26).getTime())).toBe("Oct 9");
        expect(shortDate(new Date(2026, 0, 5, 9, 3).getTime())).toBe("Jan 5");
    });
});
```

  and change the `initiativeResume` case at about line 90 to expect `when: shortDate(ts)` in place of the
  `noteStamp` value. Import `shortDate`.

**Step 2: Run them and see them fail**

Run: `npx vitest run frontend/app/view/jarvis/attentionact.test.ts frontend/app/view/jarvis/attentionrun.test.ts frontend/app/view/jarvis/briefautonomy.test.ts frontend/app/view/jarvis/initiativework.test.ts frontend/app/view/jarvis/briefingmodel.test.ts`
and `go test ./pkg/jarvis -run '^TestAttention'`.
Expected: FAIL on the changed strings.

**Step 3: Implement.**
- **`attentionact.ts`:** in the label union replace `"Acknowledge"` with `"Accept"`; the `run-unverified` branch
  returns `{ label: "Accept", kind: "ack-run" }`.
- **`attentionrun.ts:39`:** `` return `Accepted · ${what}`; ``.
- **`attention.go`:** `Action: "Accept",`. In `Why`: `"Not verified: %s. Once read, accept it with `+"`wsh runs ack %s`"+`."`
  (the command keeps its name).
- **`briefautonomy.ts`:** the chip names the consequence, not the tier.

  ```ts
  // the chip names what the tier does to your queue; the popover keeps the rung names that explain it
  const CHIP: Record<JarvisTier, string> = {
      concierge: "All asks: to you",
      gatekeeper: "Routine asks: auto",
  };
  ```

  In `autonomySummary` the unanimous label is `CHIP[top]`, and the mixed label is
  `` `Mixed · ${atTop} of ${rows.length} auto` `` (with two tiers, a mixed top is always gatekeeper). Delete
  `CONSEQUENCE`, and `tierLabel` if nothing else uses it. In `autonomyladderview.tsx`, if the chip's `title` uses
  the old label, make it `` `${summary.label} — ${LADDER.find((r) => r.tier === summary.tier)?.blurb ?? ""}` ``.

- **`initiativework.ts`:**

  ```ts
  // "Oct 9": a day for a person to read; noteStamp stays for prompts, which must match `wsh effort show`
  export function shortDate(ts: number): string {
      return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
  ```

  In `initiativeResume`'s last return use `when: shortDate(lastNote.ts)`. `workOnPrompt` keeps `noteStamp`.

**Step 4: Run the tests and see them pass** (the same two commands). Expected: PASS.

**Step 5: Typecheck, lint, commit**

```bash
git commit -m "feat(jarvis): Accept an unverified run, the autonomy chip says what it does, dates read Oct 9" -- pkg/jarvis/attention.go pkg/jarvis/attention_test.go frontend/app/view/jarvis/attentionact.ts frontend/app/view/jarvis/attentionact.test.ts frontend/app/view/jarvis/attentionrun.ts frontend/app/view/jarvis/attentionrun.test.ts frontend/app/view/jarvis/briefingmodel.test.ts frontend/app/view/jarvis/petactrun.test.ts frontend/app/view/jarvis/petacts.test.ts frontend/app/view/jarvis/petpeekmodel.test.ts frontend/app/view/jarvis/briefautonomy.ts frontend/app/view/jarvis/briefautonomy.test.ts frontend/app/view/jarvis/autonomyladderview.tsx frontend/app/view/jarvis/initiativework.ts frontend/app/view/jarvis/initiativework.test.ts
```

The CDP steps that show these: `brief-layout` step 2 (the autonomy chip) and `brief-surface` step 4 (Accept).

### Task 4: The chunk panel itself, and Work on this chunk

**Depends on:** Task 3

**Files:**
- Modify: `frontend/app/view/jarvis/sidebarnotes.ts` (add `noteRunFace`)
- Test: `frontend/app/view/jarvis/sidebarnotes.test.ts`
- Modify: `frontend/app/view/jarvis/initiativework.ts` (add `chunkPrompt`)
- Test: `frontend/app/view/jarvis/initiativework.test.ts`
- Modify: `frontend/app/view/jarvis/initiativeworkaction.ts` (`workOnInitiative`'s `ask` gains `{ chunk: string }`)
- Modify: `frontend/app/view/jarvis/chunksidebar.tsx`

**Step 1: Write the failing tests.**

`sidebarnotes.test.ts`:

```ts
describe("noteRunFace", () => {
    it("draws the skeleton only while the run is being read", () => {
        expect(noteRunFace({ run: undefined, loading: true, error: false })).toBe("loading");
    });
    it("says a run is gone once the read settles empty or fails, instead of a skeleton that never resolves", () => {
        expect(noteRunFace({ run: undefined, loading: false, error: false })).toBe("gone");
        expect(noteRunFace({ run: undefined, loading: false, error: true })).toBe("gone");
    });
    it("shows a run that loaded", () => {
        expect(noteRunFace({ run: { oid: "r1" } as Run, loading: false, error: false })).toBe("ready");
    });
});
```

`initiativework.test.ts`:

```ts
describe("chunkPrompt", () => {
    it("names the chunk and closes the loop on it", () => {
        const p = chunkPrompt("Diff redesign", "e1", "Commit tab");
        expect(p).toContain('the chunk "Commit tab"');
        expect(p).toContain("(effort:e1)");
        expect(p).toContain("add the result as a chunk note");
        expect(p).toContain("mark it done");
    });
});
```

**Step 2: Run them and see them fail**

Run: `npx vitest run frontend/app/view/jarvis/sidebarnotes.test.ts frontend/app/view/jarvis/initiativework.test.ts`
Expected: FAIL (not exported).

**Step 3: Implement the pure parts.**

`sidebarnotes.ts`:

```ts
// a note's run read: WOS settles a missing object as no value and no error, so "not loading" is what says gone
export function noteRunFace(r: { run: Run | undefined; loading: boolean; error: boolean }): "loading" | "gone" | "ready" {
    if (r.run != null) {
        return "ready";
    }
    return r.loading && !r.error ? "loading" : "gone";
}
```

`initiativework.ts`, after `dueChunkPrompt`:

```ts
// Work on one chunk from the chunk panel: the agent does that chunk only and closes the loop on it
export function chunkPrompt(title: string, effortOid: string, chunk: string): string {
    return `work on the chunk "${chunk}" of the initiative ${title} (effort:${effortOid}): read its notes, do it, add the result as a chunk note, then mark it done with \`wsh effort chunk status\``;
}
```

`initiativeworkaction.ts`: widen `ask` to `"work" | "plan" | { due: string } | { chunk: string }`. In the `task:`
expression, handle it before the due case:

```ts
task:
    ask === "plan"
        ? planIdeaPrompt(e.title, oid)
        : ask === "work"
          ? workOnPrompt(e.title, oid, e.lastnote)
          : "chunk" in ask
            ? chunkPrompt(e.title, oid, ask.chunk)
            : dueChunkPrompt(e.title, oid, ask.due),
```

**Step 4: Run the tests and see them pass.** Same command. Expected: PASS.

**Step 5: The panel** (`chunksidebar.tsx`; mockup boards `Proposed-ChunkPanel` and `Proposed-ChunkPanel-States`).
- **`NoteRun`:** read the loading and error atoms beside the value:

  ```tsx
  const NO_FLAG = atom(false);
  // in NoteRun:
  const oref = WOS.makeORef("run", runOid);
  const loading = useAtomValue(runOid ? WOS.getWaveObjectLoadingAtom(oref) : NO_FLAG);
  const error = useAtomValue(runOid ? WOS.getWaveObjectErrorAtom(oref) : NO_FLAG);
  const face = noteRunFace({ run, loading, error });
  ```

  The skeleton draws only for `"loading"`. For `"gone"` render
  `<p className="m-0 text-[11.5px] text-muted">The run's report is no longer available.</p>`.
  Import `WOS` from `@/app/store/wos`.
- **New optional prop** `work?: { label: string; onWork: () => void }`. The label is "Work on this chunk", or "Go to
  agent" when an agent is open on the initiative.
- **Header (h-[42px]):** `Chunk`, `n / total`, ↑ ↓, then `ml-auto`. After it: the work button when `work` is set
  (the Work on recipe: `border-accent/45 bg-accentbg text-accent-soft`, 24px tall, `title="Work on this chunk"`), then
  **Copy wsh command** (`SHEET_BTN`, `title={handle}`, the same `navigator.clipboard.writeText(handle)`), then an
  icon-only ✕ (`aria-label="Close"`, `title="Close (Esc)"`, lucide `X` 14px). Delete the `j / k` mono hint; the
  arrows' titles carry it.
- **Body top:**
  - The crumb becomes sentence case: drop `uppercase tracking-[.06em]`, keep `text-[10.5px] text-ink-mid`.
  - The title goes from `text-[16px] leading-[1.35]` to `text-[14.5px] leading-[1.45]`.
  - Replace the handle row with a meta line in `text-[11px] text-muted`:
    `{cards.length} {cards.length === 1 ? "note" : "notes"}`; when there are notes, then
    ` · last ${shortDate(Math.max(...cards.map((c) => c.entry.ts)))}`; then the existing activity button, now reading
    `Activity` with its `ArrowUpRight`.
- **The status radiogroup:** one row. Each radio becomes `h-[26px] flex-row gap-1 py-0`, with the glyph and the word
  side by side.
- **Note cards:** `open agent session` / `open run` become `Open agent session` / `Open run`; `edit` / `delete`
  become `Edit` / `Delete`.
- **Composer:** placeholder `"Add a note…"`; the hint becomes `"Ctrl+Enter adds · Esc clears"`.
- **Notes empty state:** unchanged.

The panel's place in the grid, and passing `work`, come with Task 6.

**Step 6: Typecheck, lint, commit**

```bash
git commit -m "feat(jarvis): the chunk panel reads at a glance, says when a note's run is gone, and can start work on its chunk" -- frontend/app/view/jarvis/sidebarnotes.ts frontend/app/view/jarvis/sidebarnotes.test.ts frontend/app/view/jarvis/initiativework.ts frontend/app/view/jarvis/initiativework.test.ts frontend/app/view/jarvis/initiativeworkaction.ts frontend/app/view/jarvis/chunksidebar.tsx
```

The CDP steps that show these: `brief-chunk-panel` steps 3 to 6 (Task 9).

### Task 5: The Brief layout: header, two columns, region order, Waiting window, Since you looked

**Depends on:** Task 1

**Files:**
- Modify: `frontend/app/view/jarvis/briefingmodel.ts` (add `WAITING_CAP = 3` beside `EFFORT_CAP`, line ~17)
- Test: `frontend/app/view/jarvis/briefingmodel.test.ts`
- Modify: `frontend/app/view/jarvis/briefrows.ts` (`SHIPPED_LABEL`, add `sinceEmptyLine`)
- Test: `frontend/app/view/jarvis/briefrows.test.ts`
- Modify: `frontend/app/view/jarvis/briefsurface.tsx` (`REGIONS`, `RegionHead`, `Region`, the render from the
  `<header>` to the end of the regions, about lines 189-330 and 1423-2034; the ack-all handler at about 1292-1303)

**Step 1: Write the failing tests.**

`briefingmodel.test.ts`:

```ts
describe("the Waiting window", () => {
    it("shows the first three items and folds the rest", () => {
        const q = ["a", "b", "c", "d", "e"];
        expect(WAITING_CAP).toBe(3);
        expect(capRegion(q, WAITING_CAP, false)).toEqual({ rows: ["a", "b", "c"], more: 2 });
        expect(capRegion(q, WAITING_CAP, true)).toEqual({ rows: q, more: 0 });
    });
});
```

(Check `capRegion`'s real return shape in `briefingmodel.ts` first and match it. If it differs, assert its real
fields.)

`briefrows.test.ts`:

```ts
describe("sinceEmptyLine", () => {
    it("never says 'since you last looked' on a first visit, where there was no last look", () => {
        expect(sinceEmptyLine(true)).toBe("Runs that land show up here.");
        expect(sinceEmptyLine(false)).toBe("Nothing new since you last looked.");
    });
});
```

**Step 2: Run them and see them fail**

Run: `npx vitest run frontend/app/view/jarvis/briefingmodel.test.ts frontend/app/view/jarvis/briefrows.test.ts`
Expected: FAIL (not exported).

**Step 3: Implement the pure parts.**
- `briefingmodel.ts`: `export const WAITING_CAP = 3;` with the comment
  `// Waiting shows its most urgent three; a longer queue folds behind Show all (spec 2026-10-12 decision 1)`.
- `briefrows.ts`:
  - `export const SHIPPED_LABEL = "Shipped";` (the side column's head shows `7 days` as its meta).
  - Add:

    ```ts
    export function sinceEmptyLine(firstVisit: boolean): string {
        return firstVisit ? "Runs that land show up here." : "Nothing new since you last looked.";
    }
    ```

  - Grep for `SHIPPED_LABEL` users (`briefsurface.tsx` filters groups by it) and keep them comparing against the
    constant.

**Step 4: Run the tests and see them pass.** Expected: PASS.

**Step 5: The header** (board `Proposed-Brief`).
- Keep everything up to the filter.
- Shrink the filter label from `w-[220px]` to `w-[200px]`.
- After the filter, wrap `<AutonomyLadder />`, the Profile button and `<TourButton />` in
  `<div className="flex flex-none items-center gap-1">`.
- After the divider, `<NewInitiativeControl />`, then a new primary button:

  ```tsx
  <button
      type="button"
      data-jarvis-new-run
      title="New run (r)"
      onClick={() => openLauncher(model, "run")}
      className="flex h-[28px] flex-none cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-[8px] bg-accent px-[11px] text-[12px] font-bold text-background shadow-inset-highlight hover:bg-accenthover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
  >
      New run
      <kbd className="font-mono text-[10px] font-normal text-accent-900">r</kbd>
  </button>
  ```

  Import `openLauncher` from `@/app/view/agents/launcherstore`.

**Step 6: Region heads (spec decision 11).**
- `RegionHead` becomes a `div` (`flex w-full items-center gap-[9px]`) holding the same dot, label, count, rule and
  meta.
- After the meta, an icon-only toggle:

  ```tsx
  <button
      type="button"
      aria-pressed={only}
      aria-label={only ? "Show every region" : `Show only ${label}`}
      title={only ? "Show every region" : "Show only this region"}
      onClick={onOnly}
      className="flex h-5 w-5 flex-none cursor-pointer items-center justify-center rounded-[5px] border border-border text-muted hover:border-edge-strong hover:text-ink-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
  >
      {only ? <Minimize2 size={11} aria-hidden /> : <Maximize2 size={11} aria-hidden />}
  </button>
  ```

- The meta no longer says `showing only this · press to show all`. Show only the meta, plus `· only this region`
  while `only`.
- `Region` drops its "a control cannot nest inside the head" wrapper comment. The head and the tools now sit in one
  `flex items-center gap-2.5` row.

**Step 7: `REGIONS`.**

```ts
const REGIONS = {
    waiting: { label: "Waiting on you", absent: "Nothing is waiting on you. The next gate or ask arrives here.", ok: true },
    sessions: { label: "Runs", absent: "Nothing is running. A run takes a goal or a plan file and lands its work on its own branch.", ok: false },
    initiatives: { label: "Initiatives", absent: "No initiative yet. Work bigger than one run lives here as a list of chunks that agents tick off.", ok: false },
    behind: { label: "Since you looked", absent: "Nothing new since you last looked.", ok: false },
} as const;
```

The skeleton (`firstLoad`) maps over `["waiting", "sessions", "initiatives"]` only.

**Step 8: The body grid.**
- Inside the `key="regions"` motion div, replace `className="flex flex-col gap-[26px]"` with
  `className="grid grid-cols-1 items-start gap-7 @min-[1100px]:grid-cols-[minmax(0,1fr)_340px]"`.
- Under it, two children:
  - `<div className="flex min-w-0 flex-col gap-6">`: the **main column**. Waiting, then Runs (the `sessions`
    Region), then Initiatives, in that order.
  - `<aside data-jarvis-brief-side className="flex min-w-0 flex-col gap-[22px]">`: the **side column**. Since you
    looked, then Shipped, then Ideas.
- The outer scroller keeps `@container` and the padding. Drop its own `gap-[26px]` if the load-error card and the
  grid then sit too far apart.
- `view.visible`, which drives `j`/`k` and the tracker splice, must follow render order: waiting, sessions,
  initiative trackers, behind lines, shipped lines, ideas. Today `lines.initiatives` holds trackers and ideas
  together:
  - Split it into `lines.trackers` (`!l.idea`) and `lines.ideas` (`l.idea`).
  - Build
    `visible = [...waitingShownRows, ...sessionLines, ...lines.trackers, ...behindLines, ...shippedLines, ...lines.ideas]`,
    each guarded by `shows(...)` as today. Ideas and shipped are shown when `only == null`.

**Step 9: Waiting.**
- Keep the region head and the `QueueSummaryView` box, but remove its Review / Hide button. Pass `onToggle` only
  when `lines.waiting.length > WAITING_CAP`.
- Under the summary always render the rows of `capRegion(lines.waiting, WAITING_CAP, waitingOpen || filtering)`.
  They are what `view.visible` uses for waiting.
- After the rows, when more are hidden or the region is expanded, a `MoreControl`-style button with
  `data-jarvis-brief-attention-summary` and `aria-expanded={waitingOpen}` that toggles `toggleRegion("waiting")`. It
  reads `Show all N` collapsed and `Show fewer` expanded. The attribute keeps the existing scenario hooks.
- The ack-all tools button reads `Accept {ackable.length} unverified`, and its notify reads
  `` `Accepted ${results.length} unverified runs` ``.

**Step 10: Since you looked and Shipped (side column).**
- The `behind` section becomes two sections:
  - `<section data-jarvis-brief-region="behind">`: the head is the `REGION_LABEL` "Since you looked", a rule,
    `sinceLabel(...)` and **Mark seen** (capitalized) when `deltaRowsN > 0`. Then the delta groups and their
    `MoreControl` as today. When `deltaRowsN === 0`, render `sinceEmptyLine(visitCursor == null)`.
  - `<section data-jarvis-brief-region="shipped">`: the head is `SHIPPED_LABEL` with its count and `7 days` as
    meta, then the shipped rows and the `+N more` control as today.
- Drop the `px-[11px]` group label row's `uppercase tracking-[.09em]` sub-heads only if they now duplicate the
  section head. Keep the day group labels ("Today", "Earlier").

**Step 11: Ideas move to the side column**, unchanged for now (Task 6 makes the jot inline):
- Move the whole `data-jarvis-ideas` block out of the Initiatives region into the aside, under Shipped.
- Its head becomes a `REGION_LABEL` row like the other side sections: label, count, rule, `not planned yet`.
- In the Initiatives region, the `flex flex-wrap` two-column wrapper goes away and the cards' box takes the full
  width.

**Step 12: Empty states (board `Proposed-AllClear`).** In `Region`'s `empty` box, when `id` is `sessions` or
`initiatives`, add the starting control at the right:
- **New run** (the secondary button recipe, `r` keycap) calls `openLauncher(model, "run")`.
- **New initiative** sets `model.newInitiativeOpenAtom` true.

`Region` needs an optional `act?: ReactNode` prop for this.

**Step 13: Check it in the dev app.** If `task dev` is not running, start it. Open Jarvis, then click the `normal`,
`attention` and `empty` fixtures on the dev fixture bar. Run
`node scripts/cdp-shot.mjs cdp-shots/brief-layout.png` and compare with the `Proposed-Brief` and `Proposed-AllClear`
boards. Then a narrow check: set the window to 1280 wide, or use `Emulation.setDeviceMetricsOverride` at 1000 wide;
the side column must drop under the main column.

**Step 14: Typecheck, lint, commit**

```bash
git commit -m "feat(jarvis): the Brief puts Waiting, Runs and Initiatives first, with Since you looked, Shipped and Ideas beside them" -- frontend/app/view/jarvis/briefingmodel.ts frontend/app/view/jarvis/briefingmodel.test.ts frontend/app/view/jarvis/briefrows.ts frontend/app/view/jarvis/briefrows.test.ts frontend/app/view/jarvis/briefsurface.tsx
```

The CDP steps that show these: `brief-layout` steps 1 to 5, `brief-surface` steps 2, 3 and 6 (Task 9).

### Task 6: Initiatives as rows, in place expansion, the chunk panel in the side column, inline ideas

**Depends on:** Task 4, Task 5

**Files:**
- Modify: `frontend/app/view/jarvis/initiativework.ts` (add `orderInitiatives`)
- Test: `frontend/app/view/jarvis/initiativework.test.ts`
- Modify: `frontend/app/view/jarvis/briefrowviews.tsx` (`InitiativeCard` becomes `InitiativeRow`;
  `WorkOnButton`'s "Go to it")
- Modify: `frontend/app/view/jarvis/inlinetrackerview.tsx` (the chunk row, about lines 320-394)
- Modify: `frontend/app/view/jarvis/effortstore.ts` (add `createIdea`)
- Modify: `frontend/app/view/jarvis/briefsurface.tsx` (the Initiatives region, the ideas jot, the `ChunkSidebar`
  mount)

**Step 1: Write the failing test** in `initiativework.test.ts` (reuse the file's `agent(...)` helper):

```ts
describe("orderInitiatives", () => {
    const card = (oref: string, o: Partial<{ status: string; blockedChunks: string[]; updatedts: number }> = {}) => ({
        oref,
        status: o.status ?? "active",
        blockedChunks: o.blockedChunks ?? [],
        updatedts: o.updatedts ?? 0,
    });
    it("puts blocked first, then those with an agent open, then the freshest, and paused last", () => {
        const cards = [
            card("effort:old", { updatedts: 1 }),
            card("effort:paused", { status: "paused", updatedts: 9 }),
            card("effort:new", { updatedts: 5 }),
            card("effort:open", { updatedts: 2 }),
            card("effort:blocked", { blockedChunks: ["Phase 5"], updatedts: 0 }),
        ];
        const agents = [agent({ id: "a1", effortId: "open", state: "working" })];
        expect(orderInitiatives(cards, agents).map((c) => c.oref)).toEqual([
            "effort:blocked",
            "effort:open",
            "effort:new",
            "effort:old",
            "effort:paused",
        ]);
    });
});
```

**Step 2: Run it and see it fail.** `npx vitest run frontend/app/view/jarvis/initiativework.test.ts`.
Expected: FAIL.

**Step 3: Implement** in `initiativework.ts`:

```ts
type Orderable = { oref: string; status: string; blockedChunks: string[]; updatedts: number };

// where the next hour goes: what is stuck, then what an agent is already on, then the freshest; paused last
export function orderInitiatives<T extends Orderable>(cards: T[], agents: AgentVM[]): T[] {
    const rank = (c: T) =>
        c.status === "paused"
            ? 3
            : c.blockedChunks.length > 0
              ? 0
              : openAgentFor(c.oref.replace(/^effort:/, ""), agents) != null
                ? 1
                : 2;
    return [...cards].sort((a, b) => rank(a) - rank(b) || b.updatedts - a.updatedts);
}
```

**Step 4: Run it and see it pass.** Expected: PASS.

**Step 5: Order and cap.** In `briefsurface.tsx`, `effortWindow` becomes
`capRegion(orderInitiatives(effortGroups.trackers, agents), EFFORT_CAP, initiativesOpen)`. Set `EFFORT_CAP` in
`briefingmodel.ts` to 8. `briefingmodel.test.ts:283-284` pins the old cap with 7 efforts (`more: 1`): seed 9
there so it still overflows by one.

**Step 6: `InitiativeRow`** in `briefrowviews.tsx` (board `Proposed-Brief`, the Initiatives box). Rename
`InitiativeCard` to `InitiativeRow` and keep its props.
- **The outer element:** a `div` with the same `data-jarvis-brief-row="initiative"`,
  `data-jarvis-initiative-card={expanded ? "open" : "closed"}` and `cursorAttrs`. Its class:
  `group flex min-w-0 flex-col rounded-[8px]`, plus `bg-surface-raised border border-edge-strong` when expanded,
  `CURSOR_RING` when focused, `fresh-mark` when fresh.
- **The toggle:** the existing `role="button"` div, now a grid row
  `grid grid-cols-[minmax(0,1.1fr)_150px_minmax(0,1.4fr)_74px_auto] items-center gap-3.5 px-2.5 py-[7px]`, with
  `opacity-60` when resting. Its cells:
  1. Title (`text-[13px] font-semibold text-ink-hi truncate`, or `titleSlot`) over the meta
     (`text-[10.5px] text-muted`).
  2. `<SegmentBar>` plus `done/total` (`text-[11px] font-semibold text-secondary`, `w-[34px] text-right`).
  3. The `noteLabel` and `note` on one truncated line.
  4. The status cell: `● blocked` (`text-asking`) when there are blocked chunks; `● agent open` (`text-success`) when
     `resume.kind === "go"`; else `resume.when` (`text-ink-mid`). The `line.state` pill (paused, archived) goes here
     in place of the date.
  5. `WorkOnButton` (keep `always`), then `MenuButton`.
- **Expanded:** the children render under the toggle with a top border, as today.
- **`WorkOnButton`:** "Go to it" becomes "Go to agent", and its width goes from `w-[84px]` to `w-[92px]`.
- **The Initiatives region in `briefsurface.tsx`:**
  - Replace the `grid grid-cols-2 gap-3` card grid with
    `<div className="flex flex-col rounded-[10px] border border-edge-mid bg-surface p-1">`.
  - Render `InitiativeRow`s inside it with `layout="position"` motion as today.
  - Delete the `col-span-full` class logic. An opened row expands where it is.
  - `MoreControl` and **Show N archived** sit inside the box at the bottom.

**Step 7: Chunk rows** in `inlinetrackerview.tsx`'s chunk branch (board `Proposed-ChunkPanel`, the expanded box):
- **The label span:** replace `truncate` with `line-clamp-2`. Keep the weights.
- **The status `button`** stays (it opens the status menu) but loses its chrome. Its class becomes
  `flex flex-none cursor-pointer items-center gap-1 rounded-[5px] px-1.5 py-0.5 text-[10.5px] font-semibold hover:bg-surface-hover`,
  plus `TONE_FG[...]` and `FOCUS`. The `ChevronDown` gets
  `className="text-muted opacity-0 group-hover/chunk:opacity-100"`, and the row div gets `group/chunk`. The fixed
  `w-[86px]` goes.
- **The row's container:** `items-center` becomes `items-start`, so a two-line label keeps the glyph and the status
  on its first line.

**Step 8: The chunk panel in the side column (spec "Chunk panel").**
- In the regions grid, when `selectedChunk != null && openInitiative != null`, add `@min-[1281px]:hidden` to the
  aside.
- Replace the scroller's `@min-[1281px]:pr-[480px]` with `@min-[1281px]:pr-[482px]`.
- At `@max-[1280px]` the panel keeps floating, unchanged.
- Pass `work` to `ChunkSidebar`:

  ```tsx
  work={(() => {
      const c = openCard;
      if (c == null) return undefined;
      const go = initiativeResume(c.oref.replace(/^effort:/, ""), c.lastnote, agents, Date.now()).kind === "go";
      return {
          label: go ? "Go to agent" : "Work on this chunk",
          onWork: () => void workOnInitiative(model, c, { chunk: selectedChunk.row.label }),
      };
  })()}
  ```

  (`workOnInitiative` already goes to an open agent first.)

**Step 9: Inline ideas.**
- `effortstore.ts`:

  ```ts
  // an idea is a title written down to come back to: no project, no chunks, no form
  export async function createIdea(title: string): Promise<void> {
      await RpcApi.EffortCreateCommand(TabRpcClient, { title, chunks: [] }, { timeout: stateRpcTimeoutMs });
      void loadBriefingAsync();
  }
  ```

  Import what the form imports for these; check `effortcreateform.tsx` for the timeout constant and
  `loadBriefingAsync`.
- In the side column's Ideas section, replace the `data-jarvis-jot-idea` button with a label holding an input:

  ```tsx
  <label data-jarvis-jot-idea className="flex h-8 items-center gap-2 rounded-[8px] border border-dashed border-edge-strong px-2.5 focus-within:border-accent/60">
      <Plus size={12} aria-hidden className="flex-none text-muted" />
      <input
          aria-label="Jot down an idea"
          placeholder="Jot down an idea — Enter saves"
          value={jot}
          onChange={(e) => setJot(e.target.value)}
          onKeyDown={(e) => {
              if (e.key === "Enter" && jot.trim() !== "") {
                  const t = jot.trim();
                  setJot("");
                  runMutation(() => createIdea(t));
                  briefUndo.notify(`Jotted “${t}”`);
              } else if (e.key === "Escape") {
                  e.stopPropagation();
                  setJot("");
                  e.currentTarget.blur();
              }
          }}
          className="min-w-0 flex-1 bg-transparent text-[12px] text-ink-hi outline-none placeholder:text-muted"
      />
  </label>
  ```

  with `const [jot, setJot] = useState("")`.

**Step 10: Check it in the dev app.** In live data, open an initiative; it must expand where it is. Open a chunk; at
1600 wide the panel sits where the side column was. Compare with `Proposed-ChunkPanel`.

**Step 11: Typecheck, lint, test, commit**

Run: `npx vitest run frontend/app/view/jarvis` (expected PASS), then `task check:ts`.

```bash
git commit -m "feat(jarvis): initiatives are one-line rows that open in place, the chunk panel takes the side column, ideas jot inline" -- frontend/app/view/jarvis/initiativework.ts frontend/app/view/jarvis/initiativework.test.ts frontend/app/view/jarvis/briefrowviews.tsx frontend/app/view/jarvis/inlinetrackerview.tsx frontend/app/view/jarvis/effortstore.ts frontend/app/view/jarvis/briefsurface.tsx frontend/app/view/jarvis/briefingmodel.ts frontend/app/view/jarvis/briefingmodel.test.ts
```

The CDP steps that show these: `brief-surface` step 7, `brief-chunk-panel` steps 1, 2 and 7 (Task 9).

### Task 7: The run sheet: the question first, one accent in the dock, the composer's key

**Depends on:** Task 1, Task 2, Task 3

**Files:**
- Modify: `frontend/app/view/jarvis/runsheet.tsx` (`RunSheetFrame` about 194-235, `Dock` about 1027-1121)
- Modify: `frontend/app/view/jarvis/briefcomposer.tsx` (the label row, about 132-142)

**Step 1: Order.** In `RunSheetFrame`'s scroller, move the blocks into this order:
1. `CancelSurvivorsCard`
2. `AskCard`
3. `ChildAskCard`
4. Report, Evidence or Tasks (the existing `body` ternary)
5. `RunTimingSection`
6. `FinalCheckRow`

Each keeps its own guard. Give `RunTimingSection` the `mt-3.5` wrapper that `ChildAskCard` had, if spacing needs it.

**Step 2: One accent in the dock.** In `Dock`, compute which button takes the accent:

```ts
// one accent per dock: the first action that moves the run on, the rest read as secondary
const accent: "land" | "resume" | "dag" | null = held ? "land" : resumable ? "resume" : run.dagoref ? "dag" : null;
```

- Land again uses `accent === "land" ? DOCK_ACCENT : DOCK_BTN`, Resume uses `accent === "resume"`, Open DAG uses
  `accent === "dag"`. The Final check dock button never takes `DOCK_ACCENT` (keep its `dockAccent` border tint).
- Wrap **Open lead ↗** and **Open in Agent ↗** in
  `<div role="group" aria-label="Open" className="flex overflow-hidden rounded-[7px] border border-edge-mid">`. Each
  button inside drops its own border and radius; the second gets `border-l border-edge-mid`. Render the group only
  when at least one of them shows.

**Step 3: The composer's label row** (`briefcomposer.tsx`). After the `labels.scope` span, add an `i` keycap so the
key is seen where it works:

```tsx
<kbd className="rounded-[4px] border border-edge-strong px-1 font-mono text-[10px] leading-4 text-ink-mid">i</kbd>
```

Keep `labels.alt` at the right.

**Step 4: Check it in the dev app.** Open a run with a question (any live orchestrator run that asks; or
`node scripts/inject-live-agents.mjs mixed`). The question card must sit above Tasks, and `i` must focus the composer.

**Step 5: Typecheck, lint, commit**

```bash
git commit -m "feat(jarvis): the run sheet leads with its question, keeps one accent in the dock, and shows i on its composer" -- frontend/app/view/jarvis/runsheet.tsx frontend/app/view/jarvis/briefcomposer.tsx
```

The CDP steps that show these: `brief-run-sheet-order` steps 1 to 3 (Task 9).

### Task 8: Footer keys, the tour, docs and changelog

**Depends on:** Task 1, Task 5, Task 6, Task 7

**Files:**
- Modify: `frontend/app/cockpit/footerhints.ts` (`SURFACE_HINTS`)
- Test: `frontend/app/cockpit/footerhints.test.ts` (it asserts every referenced id exists; run it)
- Modify: `frontend/app/view/jarvis/jarvistourcontent.ts`
- Modify: `docs/keyboard-shortcuts.md` (the `### Jarvis` table, line ~258)
- Modify: `docs/guide/jarvis.md`
- Modify: `docs/guide/orchestrator.md` (the run sheet verbs, about line 217; the Agent tree paragraph, about 244; "Land về base", about 412)
- Modify: `CHANGELOG.md` (top section)

**Step 1: The footer.** Add to `SURFACE_HINTS`:

```ts
jarvis: [
    { ids: ["list:next-j", "list:prev-k", "list:next", "list:prev"], glyph: "j k", label: "move" },
    { ids: ["list:activate"], glyph: "⏎", label: "open" },
    { ids: ["jarvis:new-run"], glyph: "r", label: "new run" },
    { ids: ["jarvis:work-on"], glyph: "w", label: "work on" },
    { ids: ["jarvis:filter"], glyph: "/", label: "filter" },
    { ids: ["jarvis:graph-peek"], keys: "Shift:g", label: "graph" },
],
```

Peek and help already come from `GLOBAL_HINTS`. Run `npx vitest run frontend/app/cockpit/footerhints.test.ts` and
expect PASS. If a `when` hides `list:*` on jarvis, check `footer-visible.ts` and keep the ids that are active there.

**Step 2: The tour** (`jarvistourcontent.ts`), both VI and EN bodies:
- **The Waiting step (~59):** "the first three show here, Show all opens the rest" / "ba việc gấp nhất hiện sẵn,
  Show all mở phần còn lại".
- **The Show only step (~71):** the icon button at the end of each region head, not a click on the heading.
- **The Runs step (~83):** Runs now come before Initiatives.
- **The step at ~96:** title "Since you looked"; mention Shipped beside it and Mark seen.
- **The keys step (~120/124):** drop "i: vào ô composer" / "i: into the composer". Add "r: run mới" / "r: new run".
- **Initiatives tour (~148):** rows, not cards. Mention the order (blocked first, then ones with an agent open).
- **Add one step** after the initiative detail step: target `["[data-jarvis-chunk-sidebar]"]`. It is about the chunk
  panel and Work on this chunk. Copy the shape of the neighbouring steps, including both languages.
- Run `npx vitest run frontend/app/view/jarvis/jarvistour.test.ts`. Expected: PASS (it checks step shape).

**Step 3: `docs/keyboard-shortcuts.md`, Jarvis table.**
- Remove the `d` and `c` rows.
- Add `r` (New run) and `Shift`+`N` (New initiative).
- Change the `i` row to "With a live run sheet open: focus its composer". `Esc` becomes "Leave the composer (a
  second `Esc` closes the sheet)".

**Step 4: `docs/guide/jarvis.md`.**
- **The Brief section:** the main column holds Waiting on you (three items, then Show all), Runs and Initiatives;
  the side column holds Since you looked, Shipped · 7 days and Ideas (jot inline, Enter saves). Drop "`c` tạo channel
  mới", "`d` bật rail ngữ cảnh", and the paragraph about a composer at the top of the Brief. The heading menu becomes
  the Show only icon button. Add **New run** (`r`) in the header.
- **Initiatives:** rows that open in place, the order, the chunk panel, **Work on this chunk**.
- **Run sheet:** remove **Ask Jarvis** from the Dock line; the question comes first. The composer at the bottom
  messages the lead or worker (`i`).
- **Unverified runs:** "Accept" replaces "acknowledge" wherever the guide names the button.
- **Run states, in both guides:** the run sheet's verb list in `docs/guide/jarvis.md` (Run sheet) and in
  `docs/guide/orchestrator.md` (about line 217) becomes Planning, Plan review, Working, Final check, Wrapping up,
  Landing, Waiting on you, Blocked, Done, Cancelled. In `orchestrator.md`'s Agent paragraph (about line 244), say that
  the run's strip ends in three pips (Final check · Wrap-up · Land), and that only **✓ Landed** (or **✓ Complete**,
  with nothing to land) means the run is finished. In "Land về base", say that a held land reads **Land held · needs
  you** in the tree and **Waiting on you** on the sheet.

**Step 5: `CHANGELOG.md`.** Under the top section (`## Unreleased`; open one above a dated section), add:
- Changed: "Jarvis: Waiting on you shows its first three items, Runs come before Initiatives, and Since you looked,
  Shipped and Ideas sit in a column beside them."
- Changed: "Jarvis: initiatives are one-line rows, blocked ones first, that open in place."
- Added: "Jarvis: a New run button in the header, Work on this chunk in the chunk panel, and ideas you jot down
  inline."
- Changed: "An unverified run is accepted with Accept (was Acknowledge)."
- Changed: "Runs read one way everywhere (Working, Final check, Wrapping up, Landing, Landed), and a run's strip ends in three pips for Final check, Wrap-up and Land, so all tasks green no longer reads as finished."
- Fixed: "Jarvis: `i` focuses the run sheet's composer; a blocked run no longer reads green; the tour's first card no
  longer covers the Waiting controls; a chunk note whose run is gone says so instead of loading forever."

**Step 6: Commit**

```bash
git commit -m "docs(jarvis): the Brief's new layout and the one run vocabulary in the tour, the guides, the shortcuts and the changelog; Jarvis keys in the footer" -- frontend/app/cockpit/footerhints.ts frontend/app/view/jarvis/jarvistourcontent.ts docs/keyboard-shortcuts.md docs/guide/jarvis.md docs/guide/orchestrator.md CHANGELOG.md
```

The CDP step that shows these: `brief-layout` step 5 (footer hints).

### Task 9: CDP scenarios for every changed view

**Depends on:** Task 8

**Files:**
- Modify: `scripts/cdp/scenarios.mjs` (`briefSurface` about 436-610; new `briefLayout`, `briefChunkPanel`,
  `briefRunSheetOrder`; register all three in `SCENARIOS` near `briefSurface`, about line 29397)

Hand-format: 4-space indent, no prettier on this file. Copy helpers and shapes from the scenarios around it:
`h.goto`, `h.ev`, the fixture-bar clicks, `press(key)`, and `steps.push({ step, ok, detail })`. For an arrange that
creates an effort, `peekItemViews` (about line 1331) shows `h.rpc("effortcreate")`, `"effortmutate"` and the teardown
`"effortdelete"`.

**Step 1: `brief-surface`.**
- **Step 2:** the regions are now `["waiting", "sessions", "initiatives", "behind", "shipped"]`.
- **Step 3** becomes "3. Waiting shows its first three rows under the summary while the other seeded regions stay
  visible". Use the `attention` fixture (5 items): `queueRows === 3`, the summary present, the toggle
  `[data-jarvis-brief-attention-summary]` reads `Show all 5` with `aria-expanded="false"`, and the other row kinds
  (`initiative`, `session`, `delta`, `shipped`) are all present. Normalize first: click the toggle if
  `aria-expanded="true"`.
- **Step 4** clicks the toggle and expects 5 queue rows, each with one `[data-jarvis-queue-act]`. The one for the
  unverified item reads `Accept`.
- **Step 6:** the cursor still starts on a queue row (`trail[0].row === "queue"`).
- **Step 7:** "an initiative row expands in place and opens no sheet". Assert that the opened row's
  `data-jarvis-initiative-card === "open"`, that no `[data-jarvis-brief-sheet]` exists, and that the expanded detail
  `[data-jarvis-initiative-detail]` is inside the clicked row. Drop the "nests no control" check: a row now carries
  Work on and its menu.

**Step 2: New `brief-layout`** (surface `jarvis`, arrange `{}`, the `normal` and `attention` fixtures; at 1600×1000 via
`h.cdp("Emulation.setDeviceMetricsOverride", …)`, cleared in teardown):
1. The header has `[data-jarvis-new-run]` reading `New run`, and it is the only `bg-accent` button in the header.
2. The autonomy chip's text matches `/^(All asks: to you|Routine asks: auto|Mixed · \d+ of \d+ auto)/` (skip the
   step when the chip is absent: no projects).
3. `[data-jarvis-brief-side]` exists and holds the `behind`, `shipped` regions and `[data-jarvis-ideas]`, in that
   order. Its left is greater than the main column's right.
4. In the main column, `sessions` comes before `initiatives` (compare `getBoundingClientRect().top`).
5. The footer shows chips reading `new run` and `work on` while on Jarvis.
6. With the tour offer showing (clear `localStorage` key the offer uses, see `jarvistourstore.ts`, then reload),
   `document.elementFromPoint` at the centre of `[data-jarvis-brief-attention-summary]` is that element or inside
   it. Restore the key afterwards.
7. With the `attention` fixture, a session row whose state reads `blocked` has `text-asking` on its state cell.
   Skip with a note when the fixture has no blocked row.

Shoot after steps 1, 3 and 6.

**Step 3: New `brief-chunk-panel`** (arrange: an effort `verify-chunk-panel` with chunks `One`, `Two`, `Three`;
`One` done with the note "Fixture note."; a second note on `One` written as the agent with a `runoid` that does not
exist, if `effortmutate` takes a run on a note (check `pkg/wshrpc` for `EffortOp`; skip that part if not); reload;
teardown deletes the effort):
1. Click the initiative's row; `[data-jarvis-initiative-card="open"]` is the same element that was clicked (the
   expansion did not move it to another row).
2. At 1600 wide, click chunk `One`. `[data-jarvis-chunk-sidebar]` shows, and `[data-jarvis-brief-side]` is hidden
   (`offsetParent === null`).
3. The panel header holds a button reading `Work on this chunk` (or `Go to agent`), and a button reading
   `Copy wsh command` whose `title` starts with `wsh effort note`.
4. The panel title's computed `font-size` is `14.5px`.
5. The note box placeholder is `Add a note…`.
6. If the gone-run note was seeded: after 3 s, the panel contains "The run's report is no longer available." and no
   `[aria-hidden="true"]` skeleton inside that note.
7. At 1280×800 the panel floats (the side column shows under it or is covered; assert only that the panel is
   visible and the Brief still renders).

Shoot after steps 2 and 7.

**Step 4: New `brief-run-sheet-order`.** Arrange a fixture run with a lead question using the existing helper the
`peek-item-views` scenario uses (`arrangeFixtureRun`). Read how it seeds a lead and whether it can seed an ask. If no
helper can make an ask, assert the order only on what renders.
1. In the open run sheet, any `[data-run-sheet-timing]` (or the Timing section's root; add a
   `data-run-sheet-timing` attribute in `runsheet.tsx` if none exists, and commit it with this task) sits below
   `[data-run-sheet-rows]` or `[data-run-sheet-empty]`.
2. The dock has at most one button with the accent class (`bg-accent`).
3. When a composer shows, pressing `i` (dispatch a keydown on `document`) focuses
   `[data-jarvis-brief-composer="input"]`.
4. The sheet's verb (`[data-run-sheet-verb]`) is one of Planning, Plan review, Working, Final check, Wrapping up,
   Landing, Waiting on you, Blocked, Done, Cancelled. The sheet's strip holds `[data-run-strip-tail]` with 3
   children whose `title`s start `Final check:`, `Wrap-up:`, `Land:`.
5. `h.goto("agent")`: the fixture run's row in the tree holds a `[data-run-strip-tail]` with the same three
   `data-pip` children, and its second line does not start with a bare count (`/^\d+\/\d+/` must not match).

Shoot the sheet.

**Step 5: Run them.**

Run: `node --check scripts/cdp/scenarios.mjs` (a syntax check). Then, with the dev app up:
`task verify:ui -- brief-surface brief-layout brief-chunk-panel brief-run-sheet-order`.
Expected: all PASS. A step that cannot be arranged prints SKIP with its reason, not FAIL.

**Step 6: Commit**

```bash
git commit -m "test(cdp): brief-layout, brief-chunk-panel and brief-run-sheet-order; brief-surface follows the new Brief" -- scripts/cdp/scenarios.mjs frontend/app/view/jarvis/runsheet.tsx
```
