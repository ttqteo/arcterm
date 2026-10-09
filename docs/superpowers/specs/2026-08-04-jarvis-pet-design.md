# The Jarvis pet — a presence that says what the system already knows

**Date:** 2026-08-04 · **Status:** Design settled. All seven previously-open decisions are closed (§4).
**Type:** Design doc. It settles what the creature *is*, what it may draw on, which decisions were taken,
and the one load-bearing architectural rule. It also records an audit of what data actually exists (§7),
which is what makes the three-stage split in §8 possible. It is not an implementation plan; each stage in
§8 gets its own plan.

> **Partly superseded** by [the avatar design](2026-08-04-jarvis-avatar-design.md), which replaces the form
> and the renderer: §4 decisions 6 and 7, the "Creature form" note under §4, the §5 Modules table, the WebGL
> paragraph in §9, and the slit-eyed-states paragraph in §10. Everything else here still stands — the four
> registers, the capability ladder, the data audit, and the three-stage split.

---

## 1. Why

Jarvis is a room you visit. It is nav entry two of nine (`ITEMS` in
`frontend/app/view/agents/navrail.tsx`), reachable by `Ctrl:2` or the `g` `c` chord, and almost everything
it knows is visible only once you are inside it.

The reflex fix — put Jarvis cards on the other surfaces — is the pattern this codebase spent a whole spec
removing the day before. The ambient rail design
([2026-08-03](2026-08-03-jarvis-ambient-rail-design.md)) traced three separate defects to one root cause,
Jarvis views placed per render branch, and collapsed them into a single derivation selected by subject.
Scattering cards across nine surfaces recreates that cause at triple the scale.

Working the problem from the other end produced a sharper statement of it:

> **The system knows a great deal that it never says.**

Every item below is committed, deterministic state that no part of the interface expresses:

| Already computed | Where | Currently visible |
|---|---|---|
| Stale-note counts, cleanup queue | `pkg/memgarden/decay.go`, hourly sweep — its header states it is pure and deterministic at zero token cost | Memory surface only |
| Five-hour and weekly rate-limit windows, with reset times | `frontend/app/view/agents/ratelimitstore.ts`, persisted under `wave:ratelimits` | Cockpit surface and app bar |
| A reasoned refusal every time proactive recall declines to speak | `pkg/jarvisproactive/proactive.go` persists a hit *or* a `StatusNone` naming the cause — embeddings off, no candidates above the bar, index error, vault error, query error — into the run's metadata | nowhere |
| Notes written into the vault by unattended distillation | `pkg/memdistill/coordinator.go`, batching at 8 sessions or 24h | nowhere |
| A resume narrative at every run rest-transition | `pkg/jarviscontinuity` | one rail section on one surface |
| Semantic recall silently degrading to keyword matching when the embedding index is off or stale | the index is a model-tagged, content-hash-invalidated derived artifact | nowhere |
| Three acting tiers — Concierge, Gatekeeper, Delegator | `pkg/jarvis/resolve.go`: `gatekeeper:enabled`, `delegator:enabled`, `delegator:mode` (report/manage/fanout) | a chip and a popover inside a channel (`frontend/app/view/jarvis/autonomyladderview.tsx`) |
| Kinds of waiting — review gates vs escalations vs blocked workers | `pkg/jarvis/attention.go`, server-computed | one digit on a nav button |

## 2. What the creature is

A single persistent creature in window chrome, and its job is **to be the place where the system stops
hiding things.** Its condition, its speech, and its silences are all reads of state that already exists.

Two properties follow, and both are load-bearing:

- **It never guesses.** Every register in §3 is a read of committed state. The strict noise gate in
  `pkg/jarvisproactive/gate.go` — a high similarity bar plus a capable-model relevance judgement — stays
  exactly as strict as it is today.
- **The four registers in §3 cost approximately nothing in tokens.** No new model calls. The decay
  classifier is deterministic; the continuity narrative is already written on the cheap tier whether
  anything displays it or not; the distillation and sweep events are already logged. This claim covers §3
  only — the capability ladder in §6 does spend tokens once the creature runs errands, because an errand
  *is* a headless agent invocation. **Token cost is not the same as engineering cost**: §7 audits the
  latter, and three of the four registers need new plumbing.

**It is Jarvis with a face, not a separate character** (§4 decision 7). One identity, one vocabulary. The
"I" in "I cannot see as well right now" is Jarvis. This is what makes clicking it into the Jarvis surface
coherent, and it makes §6 literally true rather than metaphorical: the creature's visible capabilities
*are* the acting tiers.

## 3. The four registers

### Condition — things that drift

**One expression at a time, chosen by strict precedence** (§4 decision 4). The order is a constant in the
pure module, so it is a unit test rather than a blend:

| Rank | Signal | Expression | Why it ranks here |
|---|---|---|---|
| 1 | Embedding index off or stale | squinting — "I cannot see as well right now" | Silent degradation is the worst failure mode. If recall is quietly keyword-only, nothing else the creature reports is trustworthy, so it outranks everything. |
| 2 | Rate-limit window depleting and resetting | tired, then recovered | Cyclical, legible within a day, and *not your fault* — it earns the tiredness metaphor with none of the guilt. |
| 3 | Stale notes and cleanup-queue depth | tended → drifting → neglected | The only item here that is a behavioural bet rather than a rendering (§10). Ranks last because it degrades slowly and is never urgent. |

When nothing fires, the creature is at rest — content, idle animation only.

### Voice — things that happen

**Push once per event, then wait** (§4 decision 8). A bubble appears when there is genuinely something new,
auto-dismisses after a few seconds, and collapses into an unread marker on the creature. Everything it has
said is recoverable from the peek overlay, so auto-dismiss loses nothing.

| Trigger | Expression |
|---|---|
| App launch after a run reached a rest state | "Where we were" — the resume narrative `pkg/jarviscontinuity` already writes |
| A distillation batch or gardener sweep completes; a background agent finishes | "While you were out…" — what it *did* |
| Notes routed into the vault by that batch | "Here is what I wrote down about you" — what it now *believes*, and a place to correct it |

### Integrity — things it chose not to do

| Source | Expression |
|---|---|
| The persisted `StatusNone` reasons from proactive recall | "Why have you been quiet?" — auditable silence. Also a diagnostic: *embeddings off* explains a whole class of "why is Jarvis useless" without a bug report. |
| The attention list's kinds, not its count | posture distinguishes a review gate from an escalation from a blocked worker |

**The creature never draws a number** (§4 decision 2). The nav badge owns the count; the creature owns the
kind. That is the de-duplication contract, and it is why keeping both indicators is not redundancy.

### Appetite — the only input

Drag a file, commit, terminal selection or Radar finding onto the creature to file it
(`MemoryLearnCommand` exists and is today called only by the batch pass) or open a thread about it.
Capture is currently automatic-only; there is no gesture for *remember this particular thing*.

### Two rules that cross the registers

**Condition overrules Voice on presence.** A health indicator you cannot see does not work, so adopting any
Condition register makes the creature *continuously* visible. "Where we were" therefore becomes what it says
at launch rather than the only time it exists — worth accepting deliberately, because being mostly absent
was that register's main virtue.

**Report each thing once.** The gardener archiving twelve notes is both an event (Voice) and a condition
change (Condition). The event is the transition, the condition is the level. This mirrors the attention
list, which already counts an escalated blocked worker once rather than twice.

## 4. Decisions taken

All seven decisions left open in the outline are closed, plus one that surfaced during review.

| # | Decision | Taken | Reasoning |
|---|---|---|---|
| 1 | Placement | **Corner dweller** — floats over the active surface, remembered position, faint at rest | The only option with enough size to read as a creature rather than a status glyph, and it needs no new Tauri window. The app bar is 46px, which after padding is roughly a 30px creature. The second always-on-top window is unverified in this app and costs a webview plus cross-window sync plus click-through handling. §8's rule keeps placement swappable, so the desktop window is recorded as a possible later move rather than rejected. |
| 2 | Replace the Jarvis nav entry? | **No — keep entry two, split the roles** | Removing entry two renumbers every entry after it, so `Ctrl:3`–`Ctrl:9` all change meaning and muscle memory breaks across the whole rail. De-duplicate by contract instead: nav badge keeps the count, creature expresses kinds only. |
| 3 | Click behaviour | **Peek overlay, carrying a link into the Jarvis surface** | Keeps you on your current surface. Costs a real component, and brings a keybinding constraint with it (§9). |
| 4 | Which condition channel leads | **Strict precedence over all three**: cannot-see › tired › drifting | Honest about the worst thing currently true, and the order is a testable constant rather than a blend. Blended expressions are both harder to unit-test and harder to read at a glance. |
| 5 | What gates the capability ladder | **The existing channel flags, read-only** | No new settings and no second permission model. Makes §6 literally true. The creature never widens its own permissions. |
| 6 | Renderer | **Inline SVG components + `motion`**, 2D. 3D deferred | Every dependency is already in `package.json`: `vite-plugin-svgr` 4.5, `motion` 12.40, `@floating-ui/react` 0.27, `react-dnd` 16. SVG fills reference `--color-*` custom properties, so the creature themes across all six presets for free and never hardcodes a colour. Pupil-shift gaze and squint both work. |
| 7 | Own name or Jarvis with a face | **Jarvis with a face** | §2. |
| 8 | Does speech push or is it pulled | **Push once per event, auto-dismiss, then unread marker** | A bubble that persists until acknowledged is the thing you come to resent over a live terminal. Pull-only would make the launch narrative something you must go and fetch, which gutted the Voice register. |

**Creature form:** a small eyed blob. Two eyes plus a deformable silhouette cover every register — droop for
tired, narrowed lids for squinting, slump for drifting, lean for posture — with no limbs to rig, and it is
the cheapest thing to replace when the 3D question is revisited. This is the least load-bearing choice in
the document precisely because of §5.

## 5. The one architectural rule

**Keep the creature's state derivation completely separate from whatever draws it.**

Pure modules answer *what is Jarvis's condition, and what does it have to say right now* — aggregating the
rate-limit window, decay counts, index status, events since last seen, the resume narrative, the proactive
refusal reasons, and the attention split. They are deterministic, need no pixels, and are unit-testable,
which matches this codebase's convention: a pure `foo.ts` with `foo.test.ts` beside it, consumed by a thin
`foo.tsx` (there are deliberately no jsdom render tests; "does it render" is covered by CDP scenarios).

Three consequences, and this is why the rule is worth stating before anything else:

1. The renderer is swappable — ship SVG, replace with three.js later, touch nothing else. **This is what
   makes "2D now, 3D later" a renderer swap rather than a rewrite.**
2. Placement is swappable for the same reason, which is what keeps the desktop-window option alive.
3. If the creature turns out to be annoying, the derivation still feeds a boring panel and nothing is lost.

### Modules

| File | Kind | Role |
|---|---|---|
| `frontend/app/view/jarvis/petcondition.ts` | pure | signals in → one expression out; the §3 precedence order lives here and nowhere else |
| `frontend/app/view/jarvis/petcondition.test.ts` | test | each rank fires alone; each rank beats every lower rank; nothing fires → at rest |
| `frontend/app/view/jarvis/petvoice.ts` | pure | events since the last-seen watermark → at most one utterance; applies §3's report-once rule |
| `frontend/app/view/jarvis/petvoice.test.ts` | test | one event yields one utterance; a sweep reported as a condition change is not also spoken; empty → silence |
| `frontend/app/view/jarvis/petmotion.ts` | pure | involuntary motion: pointer → pupil deflection, and the blink cadence. Reads no condition — aliveness is not a fifth register |
| `frontend/app/view/jarvis/petmotion.test.ts` | test | a diagonal gaze stays inside the lid; a droop that has spent the vertical room leaves a sideways glance only; the blink delay is a bounded irregular spread |
| `frontend/app/view/jarvis/petstore.ts` | atoms | unread marker, remembered position, last-seen watermark, peek open state, raw index status |
| `frontend/app/view/jarvis/petview.tsx` | thin | the SVG creature and its `motion` transitions |
| `frontend/app/view/jarvis/petbubble.tsx` | thin | `@floating-ui/react`-anchored speech |
| `frontend/app/view/jarvis/petpeek.tsx` | thin | the overlay (§4 decision 3) |

Mounted in `frontend/app/cockpit/cockpit-root.tsx`, in `CockpitBody`'s tree beside the other global
overlays (`:96`–`:101`) rather than inside any surface — which is the whole point of §6's courier argument.

## 6. The capability ladder, and the tier hole

The backend already defines the ladder; it is simply invisible outside a channel. The creature's capability
growth is the visible form of the three acting tiers.

| Tier (existing) | Creature | Capabilities |
|---|---|---|
| **Concierge** — read + post | **it carries** — no agency; worst case it drops something | **Courier**: pick up a commit on the Diff surface, switch to Code, drop it there. **Pocket**: holds what you fed it but have not filed. **Escort**: "where was this decided?" opens the right surface with the right thing focused (`openORef`). |
| **Gatekeeper** — watches asks, auto-answers routine ones, escalates genuine forks | **it fetches** — bounded agency | **Errand**: hand it a question; it runs a one-shot headless agent via `pkg/consult` (`claude -p`, `codex exec`, `agy -p`) and returns. **Sentry**: post it to one run or gate. **Screen**: answer routine asks itself — which is what Gatekeeper already does, invisibly. |
| **Delegator** — `delegator:mode` = report / manage / fanout | **it operates** — real agency | **Dispatch**: drop a Radar finding, get a Run. **Resolve**: clear a review gate (approve / sendback / triage) without opening it. **Fan out**: one goal becomes managed child runs. |

**The courier is the sleeper.** Surfaces unmount on switch — only the Agent surface stays mounted, so
surface-local state is lost every time you navigate. The creature lives in window chrome, making it the one
object in the app that survives a surface switch. That is an architectural role, not a metaphor.

**Carrying, holding and escorting need no trust model at all.** Errands, watching and operating do things
instead of you, and require the tier to be **legible before it acts** — which is exactly what embodying
Gatekeeper and Delegator buys.

### The tier is per-channel, so a global creature has no tier

`pkg/jarvis/resolve.go:17` states it: "`MetaKey_GatekeeperEnabled` is the per-channel bool flag toggling
Gatekeeper for that channel." There is no client-level or global tier anywhere. A creature in global window
chrome therefore has nothing to embody, and every naive resolution is wrong: taking the highest tier across
channels grants agency the user authorised for one channel only; taking the active channel's tier is
undefined on the Files or Usage surface.

**Resolution: capability is a property of the creature-and-target pair, not of the creature.**

- **At rest the creature is Concierge.** Carry, hold and escort need no trust model at all, as stated
  directly above, so the floor is safe to grant unconditionally and globally.
- **A tier-gated capability unlocks only when the creature acts *on* a channel**, and the tier read is that
  channel's own meta, through the existing `tierFromMeta` (`frontend/app/view/agents/channelmessages.ts:65`).
  Dropping a Radar finding on the creature offers Dispatch only if the target channel is Delegator-enabled.
- **Nothing global, no new flag, read-only** — which is what §4 decision 5 requires.

**Two existing pieces are reused rather than reimplemented.** `frontend/app/view/jarvis/autonomyladder.ts`
already holds the ladder's shape (`LADDER`, `rungState`, `RANK`, `chipParts`) with a header comment stating
the tiers are nested, not alternatives. The creature's capability display reads from it. Writing a second
ladder constant is how the two drift apart.

## 7. What data actually exists

This audit is the load-bearing part of the document, because it is what turns one intractable project into
three shippable ones. **Three of the four registers have no read path today** — not "needs wiring", no
source at all.

### Already live in the frontend, free

| Signal | Source | Note |
|---|---|---|
| Rate-limit windows (5h + weekly, with resets) | `savedRateLimitsAtom` + `mergeRateLimitWindows` (`frontend/app/view/agents/ratelimitstore.ts`) | localStorage-seeded, merged live-over-saved. The app bar already reads exactly this. |
| Attention kinds | `attentionAtom` (`frontend/app/view/agents/attentionstore.ts`), polled every 10s by `AttentionPoller` from `cockpit-root.tsx:90` | Server-computed in `pkg/jarvis/attention.go`; the three kinds are review gates, Gatekeeper escalations, blocked workers. Live on every surface already. |
| Per-channel acting tier | `tierFromMeta` (`channelmessages.ts:65`) over channel meta; shape in `autonomyladder.ts` | Read-only, no new plumbing. |

### Needs frontend work only — a poller, no Go

| Signal | Gap |
|---|---|
| Vault decay / cleanup-queue depth | `memPruneAtom` and `loadPrune()` exist (`frontend/app/view/agents/memstore.ts:238`–`:247`) but `loadPrune()` has exactly one production caller, `memorysurface.tsx:572`. So the queue is empty until you visit Memory. Needs a poller mounted in `cockpit-root.tsx` beside `AttentionPoller`. |

### Needs new Go

| Signal | Gap |
|---|---|
| Embedding index status (off / stale) | `resolveConfig()` in `pkg/jarvisembed/embed.go:31` is unexported and returns `(baseURL, model, enabled)`. No RPC reports index state to anyone. **This is the top-precedence condition, and it has no source** — needs an exported status read plus a wshrpc command. |
| Sweep and distillation completion | The sweep *runs* in production — `cmd/server/main-server.go:591` registers `memgarden.Sweep` through `RegisterSweepHook` (`pkg/memdistill/coordinator.go:184`). What is missing is any announcement of it: neither the gardener nor the distillation coordinator publishes an event, so a completed pass is unobservable to the frontend. Needs a wave event published from both, plus a frontend subscriber. |
| Proactive refusal reasons | `StatusNone` and its cause are persisted into run metadata by `pkg/jarvisproactive`, and no frontend code reads them. `frontend/app/view/agents/proactive.ts` reads the *hit* only. |
| Launch resume narrative, globally | `readResumeCard(run)` (`frontend/app/view/agents/resume.ts:32`) reads `jarvis:resume` off a single `Run` handed to it. There is no global runs-list RPC in `pkg/wshrpc/wshrpctypes_runs.go` and no global runs atom in the frontend, so "the most recent narrative across all runs" cannot be read at launch. Needs a bounded RPC returning the latest rest-transition narrative. |

## 8. Three stages

Each is independently shippable and gets its own implementation plan. The split axis is §7's audit, not
feature grouping, which is what makes stage one genuinely free of backend risk.

**Stage one — presence, on data that already exists.** The corner creature, `petcondition.ts`,
`petvoice.ts`, `petstore.ts`, `petview.tsx`, `petbubble.tsx`, `petpeek.tsx`, and the Escape guard (§9). The
Concierge-floor capabilities (courier, pocket, escort) were cut from this stage during implementation and are
recorded in `docs/deferred.md`: each needs a drag gesture, and the store shape depends on the gesture, so
neither half is worth building alone. Condition runs on the rate-limit body clock; posture
runs on attention kinds. The precedence order is implemented in full with its higher ranks simply never
firing, so stages two and three are a data change and not a logic change. **No Go, no codegen, no
migration.**

**Stage two — vault decay.** A cleanup-queue poller in `cockpit-root.tsx`, wiring rank 3 of the condition
precedence. Frontend only. Small enough that it could fold into stage one if the poller proves trivial, but
it is separated because it is the one behavioural bet in the document (§10) and worth being able to revert
alone.

**Stage three — the registers that need Go.** Index status RPC (unlocking rank 1, the top of the
precedence order), a production sweep hook publishing a wave event, the refusal-reason read, and the bounded
latest-narrative RPC. This is where Voice and Integrity actually become real, and where `task generate` and
possibly a migration enter the picture.

**The capability ladder above Concierge is not staged here.** Errands, Sentry, Screen, Dispatch, Resolve and
Fan out each need their own drop targets, confirmation paths and target-channel tier checks. They are
designed in §6 and deliberately unscheduled — the floor tier is what stage one proves.

### Running the stages in parallel

The stages are sequenced by *data availability*, which is a different axis from *file ownership*. Split by
ownership instead and two tracks run concurrently:

- **Track A — frontend only, no Go.** Stage one with stage two folded in. Owns the `pet*` modules, the
  Escape-binding guard in `frontend/app/store/keybindings/bindings.ts:196`–`:197`, and the mount point in
  `frontend/app/cockpit/cockpit-root.tsx`.
- **Track B — Go only.** All four backend reads from stage three. Touches no `pet*` file. Owns `task
  generate` exclusively, because adding wshrpc commands rewrites `frontend/types/gotypes.d.ts`,
  `frontend/app/store/wshclientapi.ts` and `pkg/wshrpc/wshclient/wshclient.go` (plus
  `frontend/types/waveevent.d.ts` for a new wave event).
- **Join.** Populate two fields of the signals type below, add the wave-event subscriber, verify live.

Do not split stage two into its own track (one poller plus one precedence rank — the coordination costs more
than the concurrency saves), and do not split track B four ways (three of its four items add wshrpc commands,
so they would collide on the RPC type file and on `task generate`).

### The contract both tracks build against

This is what makes the parallelism safe. Track A implements the **full** precedence order immediately, with
the fields it has no source for arriving `undefined` and therefore never firing. Track B makes those fields
*exist* and never opens `petcondition.ts`. The join writes an adapter per RPC into this shape.

```ts
// petcondition.ts — input. Every field optional: an absent field is "no signal", never "signal absent".
export interface PetSignals {
    // rank 1, track B: semantic recall's honesty about itself.
    index?: { state: "ok" | "off" | "stale" };
    // rank 2, track A: highest 5-hour utilisation across providers (0..100) and its reset.
    rateLimit?: { pct: number; resetAt?: number };
    // rank 3, track A (stage two): vault drift.
    decay?: { queueDepth: number; staleNotes: number };
    // posture, track A: kinds only. The creature never renders a count (§3).
    attention?: { reviewGates: number; escalations: number; blockedWorkers: number };
}

// petcondition.ts — output. One expression, chosen by strict precedence.
export type PetExpression =
    | { kind: "cannot-see"; reason: "off" | "stale" }
    | { kind: "tired"; pct: number; resetAt?: number }
    | { kind: "drifting"; queueDepth: number }
    | { kind: "at-rest" };

export type PetPosture = "review-gate" | "escalation" | "blocked-worker" | "none";

// petvoice.ts — input. `reportedAsCondition` carries §3's report-once rule: a sweep already visible in the
// condition level must not also be spoken.
export interface PetEvent {
    id: string; // stable across reloads; the watermark compares against it
    at: number; // epoch ms
    kind: "resume" | "sweep" | "distill-batch" | "notes-written" | "bg-agent-done";
    text: string;
    reportedAsCondition?: boolean;
}
```

Whether the tired band thresholds live in `petcondition.ts` or in the renderer is track A's call; the
expression union above is the seam that must not move.

## 9. Constraints and traps

**The peek overlay must guard the Escape binding.** `frontend/app/store/keybindings/bindings.ts:196`–`:197`
gates the `surface:back-home` action on `!graphPeekOpenAtom && !autonomyPanelOpenAtom`. The dispatcher runs
on window **capture**, so `@floating-ui`'s own Escape handling can never pre-empt it —
`autonomyladder.ts:11`–`:14` documents this exact trap. Without a third guard for the pet's open atom,
pressing Escape to dismiss the peek also throws you out of your current surface to Cockpit. The pet's open
atom must be global for the same reason theirs are.

**Colours must come from `@theme` tokens** in `frontend/tailwindsetup.css`, never raw hex or rgba. Runtime
theming works by overriding those same `--color-*` custom properties on `document.documentElement`, so a
hardcoded fill silently opts the creature out of every theme. This is the single strongest argument for SVG
over a baked asset.

**Occlusion is the corner dweller's cost**, and it is paid with: a remembered position (persisted in
`petstore.ts`), a low rest opacity, and a drag-to-move. A creature that covers the composer or a terminal's
last line and cannot be moved is worse than no creature.

The two *bottom* corners, revised during implementation from four. The top pair was built and measured over
CDP: the surface heading band runs y=66 to about y=144, the page title starts at x=106, and a top-corner
creature spanned y=58–102 — so top-left covered the title's first characters, and because `SurfaceHeader` is
`justify-between`, top-right covered the header's action buttons. A corner that exists to escape occlusion
cannot be the one that occludes most, and no fixed inset clears the band on every surface (measured bottoms
range from 107 on Diff to 144 on Sessions, and the Jarvis Stage and Usage surfaces do not use `SurfaceHeader`
at all). Escape is therefore left/right along the bottom edge. A corner persisted by an older build fails
`PET_CORNERS` validation and falls back to the default, so there is no migration.

Two corners suffice, which is the part that had to be measured rather than argued — the concern above is
specifically a covered composer or terminal, and both live at the bottom. Overlap-tested against every
bottom-region input, terminal, and button on five surfaces: at least one bottom corner is clear on all of
them, and the two surfaces that do collide collide on *opposite* sides. On Agent the terminal fills x≥330 so
bottom-right is blocked and bottom-left is clear; on the Jarvis Stage the thread list fills x 86–331 so
bottom-left is blocked and bottom-right is clear. The horizontal escape is the one that resolves real
collisions; the vertical one was resolving none.

**Reduced motion.** `useReducedMotion` is already used in `frontend/app/element/meter.tsx`; the idle
animation must respect it.

**WebGL is why 3D was deferred, and the reason will not change.** The terminal renders through WebGL —
`frontend/app/view/term/termwrap.ts` attaches `@xterm/addon-webgl` per terminal instance. Chromium caps
concurrent contexts (commonly ~16) and drops the oldest past the cap. A permanent 3D pet holds one for the
life of the app, competing with every live terminal in a cockpit built to run many at once. Whoever revisits
3D must answer this, and `frameloop="demand"` answers only the wasted-frames objection, not the context
count. **Where a model asset would live:** `frontend/tauri/vite.config.ts:14` overrides `publicDir` to the
repo-root `public/` directory.

## 10. Verification

**Unit — the pure modules.** `petcondition.test.ts`: each rank fires in isolation; each rank beats every
lower rank simultaneously present; nothing present yields at-rest. `petvoice.test.ts`: one new event yields
one utterance; a sweep that has already moved the condition level is not also spoken (§3's report-once
rule); an empty event set yields silence; the last-seen watermark suppresses a re-report.
`petmotion.test.ts`: a diagonal gaze stays within the lid rather than reaching its corner (the per-axis-clamp
bug); an expression that has already spent its vertical room on a droop keeps only its sideways glance; a
non-finite pointer reading yields no deflection rather than a NaN transform; the blink delay is bounded,
monotonic in its draw, and clamps an out-of-range one.

**The slit-eyed states cannot show either.** `cannot-see` draws a 1.2-unit lid, which by the geometry in
`eyeRoom` leaves no vertical gaze room and hides the pupil outright, and blink is gated on the same
threshold. So an instance whose embedding index is off — the common dev case — exercises neither live, and
both are covered by unit tests only. Verifying them in the app needs an instance that reaches `at-rest`.

**Live — a CDP scenario**, per the codebase's no-jsdom convention. `scripts/cdp/scenarios.mjs` gains a pet
scenario asserting the creature renders and its peek opens, and the existing `surface-smoke` scenario covers
that a global overlay has not broken any surface. **Pin the viewport** — `scripts/cdp/verify.mjs` clears the
override on exit and the real dev window is around 1000x700, which is small enough to change corner layout.

**The behavioural bet, stated so it can be judged.** Everything in this document is a rendering of existing
state except one thing: that *seeing* the vault drift into neglect will make anyone tend it. That is a claim
about behaviour, not a read of state. Stage two is separable precisely so it can be reverted alone if the
bet loses.

## 11. Rejected, and why

- **Permission to be wrong.** Embodiment makes a wrong guess forgivable, so the noise gate could loosen and
  Jarvis could speak more often. Rejected because it conflicts with vault condition: forgiveness wants
  something low-stakes whose mistakes cost nothing, responsibility wants stakes and a little guilt. Building
  both yields something simultaneously nagging and ignorable. Dropping it also turned out to be free —
  nothing in §3 depends on the proactive suggestion engine, which is what makes the no-guessing property in
  §2 available.
- **The fleet's face rather than Jarvis's.** A creature coloured by live agent state. Rejected: it competes
  with the Cockpit surface, which is already the fleet's room.
- **Noticing patterns about you** ("you always come back to this on Mondays"). Inference, which discards the
  no-guessing property.
- **Time-of-day or session-length nudges.** Backed by no existing computation, and patronising.
- **Inline ambient cards per surface.** Reuses `frontend/app/view/agents/ambientcard.tsx` but re-creates the
  per-render-branch drift the ambient rail spec removed (§1).
- **Promoting the Jarvis context rail to global chrome.** Always-on push, one derivation — but ~300px on
  every surface and the width collapse-order work in `git show a4b5bd4f:docs/jarvis-tab.md` §1, derived around a 640px Stage
  floor, would have to be redone globally. Reasonable as a later step, too expensive as the first.
- **Dropping the Jarvis nav entry to free a chord** (§4 decision 2). The renumbering cost lands on all seven
  entries after it.
- **A separate pet-only capability setting** (§4 decision 5). A second permission model that can disagree
  with the first, when §6's argument is that the ladder is already defined.
- **A sprite sheet or pre-rendered frames** (§4 decision 6). Colours bake into the asset, which breaks the
  theme-token rule hardest — the same objection that rules out Rive.
- **Blended condition expressions** (§4 decision 4). Harder to unit-test and harder to read at a glance than
  a precedence order.

### Exceptions taken later

- **Idle quotes (2026-10-09, the user's call).** Now and then the creature says a well-known line about
  programming (`frontend/app/view/jarvis/petquotes.ts`). It is the one utterance that is not a read of committed
  state, and it is kept from costing §2 anything: it speaks only at rest with nothing waiting, never over another
  bubble or into a window you are not in, leaves no unread marker, is never listed in the peek, and Settings →
  Appearance turns it off.

## 12. Out of scope

- **Git-history capture.** Turning commits and diffs into vault nodes — so Jarvis can answer *why is this
  file like this* — was chosen earlier as the one capture source worth widening to, then displaced by the
  pet work. It is a backend project with no UI and no dependency on anything here, so it belongs in its own
  spec and can proceed in parallel. **Recorded so it is not lost a second time.**
- **The 3D renderer.** Deferred by decision, with the WebGL constraint recorded in §9 so it is not
  rediscovered.
- **The capability ladder above the Concierge floor.** Designed in §6, unscheduled (§8).
- **Jarvis acting on the cockpit unprompted**, beyond the Delegator tier described in §6.
- **A second always-on-top Tauri window.** Kept alive as a placement swap by §5, unverified in this app,
  not built.
- **Product-polish concerns** — first-run empty state, an off switch, accessibility text equivalents,
  onboarding. Explicitly deprioritised by the user: this is a personal-use application.
