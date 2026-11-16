# Ask Jarvis at No folder Implementation Plan

**Goal:** The pet's Ask box gets a No folder destination (its default): Jarvis answers a question in the popover, or
routes a job to the right project's open agent (or a new one), shows a chooser card when unsure, and marks the receiving
agent with a "Wrong project?" band.

**Architecture:** A routing consult runs in a "No folder" channel through the unchanged `ConsultCommand`; the frontend
builds the routing prompt, strips the trailing `arc-route` verdict block from the streamed text, and a pure model
(`jarvisroute.ts`) decides answer / send / launch / choose. A new `AgentsAssignCommand` hands a job to an agent as the
person's own prompt (no envelope, wakes a sleeper). Every build decision and its reason is in the spec's last section,
"Quyết định khi xây"; follow it, the numbers below (D1…D12) refer to it.

**Tech Stack:** Go (wshrpc, wstore), React 19 + jotai + Tailwind 4, vitest, CDP scenarios.

**Spec:** `docs/superpowers/specs/2026-11-16-jarvis-no-folder-ask-design.md` (sections 1–9 and "Quyết định khi xây" D1–D12)
**Verify:** `node scripts/verify.mjs ./pkg/wshrpc/wshserver`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs jarvis-route jarvis-peek`

Shared rules for every worker: read `AGENTS.md` (generated files, `task generate`, Go tests need
`CGO_ENABLED=1 CC="zig cc -target x86_64-windows-gnu"` on Windows) and, for UI tasks, `DESIGN.md` (colours only from
`@theme` tokens, no raw hex). UI copy is English. Keep logic in pure `.ts` files with a `.test.ts` beside them; `.tsx`
stays thin. Never swallow an error silently: a failure lands on the errand reply or the card row that caused it.

No folder naming (spec D4, D10), used by Tasks 2, 3 and 5: the launcher files No folder tabs under the project name
`HOME_NAME` ("Home") and shows them as `NO_FOLDER_LABEL` ("No folder"), both exported by
`frontend/app/view/agents/launcher.ts`. Reuse those two constants; do not define new ones.

### Task 1: Backend — No folder channel and AgentsAssignCommand
**Depends on:** none
**Files:** `pkg/wshrpc/wshrpctypes_projects.go`, `pkg/wshrpc/wshrpctypes_agents.go`, `pkg/wshrpc/wshserver/wshserver_projects.go`, `pkg/wshrpc/wshserver/wshserver_agentmsg.go`, `pkg/wshrpc/wshserver/wshserver_agentassign_test.go`, `pkg/wshrpc/wshclient/wshclient.go`, `frontend/app/store/wshclientapi.ts`, `frontend/types/gotypes.d.ts`

Design decisions (spec D6, D7):
- `CommandEnsureNoFolderRtnData` gains `ChannelId string \`json:"channelid"\``. `EnsureNoFolderCommand` calls
  `wstore.EnsureChannelAtPath(ctx, "No folder", path)` after `jarvis.EnsureNoFolder()` and returns its OID. A channel
  error is returned, not logged away. The launcher's existing caller (`launchermodal.tsx`) reads only `path` and needs no
  change.
- New `AgentsAssignCommand(ctx, CommandAgentsAssignData{Tab string \`json:"tab"\`; Text string \`json:"text"\`})
  (*CommandAgentsSendRtnData, error)` declared in `wshrpctypes_agents.go` beside `AgentsSendCommand`, with a one-line
  comment ("the person's own job to an agent: no envelope, a sleeping agent is woken"). Implementation in
  `wshserver_agentmsg.go`: `loadAgentRosterFacts` → `buildAgentRoster` → `resolveAgentTab`; refuse a row with
  `RunId != ""` ("agent %q works for run %s; Jarvis never hands work to an engine session") and a row in state
  `asking`; refuse empty text; then `deliverToAgent(ctx, rows, target, text, nil)` with the trimmed text as is. Return
  `TabId`, `SentTs`, `MidTurn` as `AgentsSendCommand` does.
- Run `task generate` (never hand-edit the generated files listed above). Land the declarations and `task generate`
  first in your branch so the generated client is right even if a later step changes.

Acceptance — focused tests in the new `wshserver_agentassign_test.go`, scripting `loadAgentRosterFacts`,
`deliverAgentMessage` and the wake path the way the existing agentmsg tests do:
- `TestAgentsAssignIdleNoEnvelope`: an idle agent receives exactly the typed text (no `agentmsg.Envelope` header).
- `TestAgentsAssignWakesSleeper`: a sleeping agent goes through the wake path with the text.
- `TestAgentsAssignRefusesRunAgent` and `TestAgentsAssignRefusesAsking`: an error, nothing delivered.
- `TestEnsureNoFolderChannel` (required): set the home dir with `t.Setenv("HOME", dir)` and `t.Setenv("USERPROFILE", dir)`
  (the package's `maintest_test.go` already initialises the store; `jarvis.noFolderHome` is unexported, so do not reach
  for it); two calls return the same non-empty channel id whose channel's `ProjectPath` is `<dir>/.arc/no-folder`.
Run: `go test ./pkg/wshrpc/wshserver -run 'TestAgentsAssign|TestEnsureNoFolderChannel'`.

### Task 2: Pure routing model
**Depends on:** none
**Files:** `frontend/app/view/jarvis/jarvisroute.ts`, `frontend/app/view/jarvis/jarvisroute.test.ts`

Pure: no jotai, no RPC, no React. Interface other tasks rely on (names and shapes are fixed; add helpers freely):

```ts
export const NO_FOLDER_PROJECT = "no-folder";      // the verdict's project value for No folder
export type RouteProject = { name: string; path: string };
export type RouteAgent = { id: string; name: string; project: string; state: "working" | "idle"; sleeping: boolean; task: string };
export type RouteVerdict = { project: string; agent: string; ambiguous: boolean; task: string; reason: string; considered: string[] };
export type RouteChoice =
    | { kind: "agent"; agentId: string; project: string; label: string }
    | { kind: "project"; project: string; label: string }
    | { kind: "launch"; project: string; path: string; label: string };
export type RouteAction =
    | { kind: "answer" }
    | { kind: "send"; agentId: string; project: string; task: string; reason: string }
    | { kind: "launch"; project: string; path: string; task: string; reason: string }
    | { kind: "choose"; why: string; task: string; choices: RouteChoice[] };
export type RouteWorld = { projects: RouteProject[]; agents: RouteAgent[]; noFolderPath: string };

export function buildRoutePrompt(request: string, world: RouteWorld): string;
export function splitRouteReply(text: string): { visible: string; verdict: RouteVerdict | null; malformed: boolean };
export function openAgentsForRouting(agents: AgentVM[], councilSeatTabs: ReadonlySet<string>, projects: RouteProject[]): RouteAgent[];
export function allProjectChoices(world: RouteWorld): RouteChoice[];   // every project row + "Open a new agent in No folder"
export function decideRoute(split: { verdict: RouteVerdict | null; malformed: boolean }, request: string, world: RouteWorld): RouteAction;
export function decideForProject(project: string, task: string, reason: string, world: RouteWorld, preferAgent?: string): RouteAction;
export function resolveChoice(choice: RouteChoice, task: string, world: RouteWorld): RouteAction;
export function routeProjectLabel(project: string): string;            // NO_FOLDER_PROJECT → NO_FOLDER_LABEL, else the name
```

Behaviour (spec D1–D5):
- `buildRoutePrompt`: says it is Jarvis routing from No folder; lists every registered project (name, path) and every
  open agent (name, tab id, project, working/idle/asleep, last task); tells the model to answer a question in prose and,
  only for a job, end with one ```` ```arc-route ```` fence holding the D1 JSON; `project` must be a listed name,
  `no-folder` or empty, never a path; `ambiguous: true` when unsure; `reason` one short clause. Contains the request
  verbatim.
- `splitRouteReply`: everything from a line starting with ```` ```arc-route ```` on is cut from `visible` (also a block
  still open mid-stream, also a partial opening line at the very end such as ```` ``` ```` or ```` ```arc ````). No block →
  `{verdict: null, malformed: false}`. Block that fails `JSON.parse`, is not an object, or has no non-empty `task` →
  `malformed: true`. Missing optional fields default (`agent: ""`, `ambiguous: false`, `reason: ""`, `considered: []`).
- `openAgentsForRouting` (D4): keeps `AgentVM`s with `kind` undefined or `"agent"`, no `runId`, id not in
  `councilSeatTabs`, `state !== "asking"`, and `project` equal to a registered project name (→ that name) or to
  `HOME_NAME` (→ `NO_FOLDER_PROJECT`). `sleeping` from `agent.sleeping != null`; `task` from `agent.task`.
- `allProjectChoices`: a `project` row per registered project, then a `launch` row "Open a new agent in No folder" at
  `noFolderPath`. Used by the malformed / unknown-project card and by Task 5's band.
- `decideRoute` / `decideForProject` (D5) exactly as the spec lists; choose rows carry English labels: an agent row is
  its name (+ " · working" / " · asleep"), project rows are the project names, launch rows read
  "Open a new agent in <project>" / "Open a new agent in No folder". The malformed `why` is
  "I could not tell where this goes". The verdict's `agent`, when it is one of the project's open agents, is the first row.
- `resolveChoice`: agent → `send`; launch → `launch`; project → `decideForProject`.

Acceptance — `npx vitest run frontend/app/view/jarvis/jarvisroute.test.ts`, with cases for: no block = answer and full
visible text; a complete block hidden and parsed; a block mid-stream hidden; malformed JSON and missing task →
choose with `allProjectChoices`; ambiguous with `considered` → only those projects (+ No folder);
unknown project → choose all; known project with 0 / 1 (working) / 2 open agents → launch / send / choose with the
named agent first plus "Open a new agent in <project>"; `no-folder` with no agent → launch at `noFolderPath`; an agent
filed under `HOME_NAME` counts for `no-folder`; `openAgentsForRouting` drops run agents, council seats, asking agents,
terminals and background agents, keeps sleepers; the prompt contains every project, every open agent and the request,
and no path is offered as a project value.

### Task 3: Routed errand store, dispatch and the shared choice list
**Depends on:** Task 1 (uses `AgentsAssignCommand` and `EnsureNoFolderCommand`'s `channelid` from the regenerated `wshclientapi.ts`), Task 2 (uses `decideRoute`, `splitRouteReply`, `resolveChoice`, `openAgentsForRouting`, `allProjectChoices`)
**Files:** `frontend/app/view/jarvis/jarvisroutestore.ts`, `frontend/app/view/jarvis/jarvisroutestore.test.ts`, `frontend/app/view/jarvis/jarvisroutechoices.tsx`, `frontend/app/view/jarvis/petactrun.ts`, `frontend/app/view/jarvis/petactrun.test.ts`, `frontend/app/view/jarvis/petstore.ts`

Design decisions (spec D2, D3, D4, D8–D12):
- `petstore.ts`: add `NO_FOLDER_DEST = "no-folder"` (the dest sentinel; `petPeekDestAtom` null also means No folder,
  update its comment and the stale `resolveDestination` comment), `petRouteCardAtom: PrimitiveAtom<{ why: string; task:
  string; choices: RouteChoice[] } | null>`, and clear the card in the DEV `resetPeek`.
- `petactrun.ts`: factor the post-and-stream body of `sendErrand` into one exported helper (e.g.
  `streamConsult(channelId, runtime, shownPrompt, consultPrompt, onText)`) that posts `shownPrompt` as the channel's
  `consult` message and streams `ConsultCommand` with `consultPrompt`; `sendErrand` keeps its signature and behaviour on
  top of it. Existing `petactrun.test.ts` `sendErrand` cases must still pass; add one for the helper sending a different
  consult prompt than the posted text.
- `jarvisroutestore.ts` exports:
  - `jarvisRouteBandAtom: PrimitiveAtom<Record<string, RouteBand>>`, `type RouteBand = { project: string; reason: string; task: string; fresh: boolean }` (session-only), `dismissRouteBand(tabId)`.
  - `setRouteModel(model: AgentsViewModel)`: the store keeps the cockpit model for the DEV hook and the band; Task 4
    calls it from `PetPeek`. The DEV hook's `finish` throws "route model not set: open the pet peek first" without it.
  - `routeWorld(model, excludeTab?): Promise<RouteWorld>`: projects from `projectsAtom` (entries with a path), No folder
    path and channel id from `EnsureNoFolderCommand` (cached for the session), open agents via `openAgentsForRouting`
    over `model.agentsAtom` minus `excludeTab`, with council seat tab ids from `councilListAtom("")` read **after**
    `await loadCouncils("")` (`councilstore.ts`; the atom is null until loaded; every seat's `agent`).
  - `routeRuntime(project, noFolderPath): Runtime` (spec D10): the launcher's remembered `launcherRuntimeAtom` when it
    is an offered agent row other than `terminal`, else `resolveDefaultRuntime(pref, harnesses)`; never `terminal`; for
    No folder it must pass `homeOffered("agent", runtime, noFolderPath)`, else `claude` if installed; nothing usable →
    throw "No agent harness to start" (lands on the errand).
  - `sendRoutedErrand(model, runtime, request)`: sets `petErrandAtom` streaming, streams via the helper with
    `buildRoutePrompt`, shows only `splitRouteReply(acc).visible`, then `decideRoute` → `applyRouteAction`. `answer` just
    settles the reply as done.
  - `applyRouteAction(model, action)`: `send` → `AgentsAssignCommand({tab, text: task})` then
    `openTarget(model, {kind: "agent", tabId})`; `launch` → `launchAgent` with `routeRuntime`, startup command composed
    as `initiativeworkaction.ts` does, `projectPath` = path, `projectName` = project name (`HOME_NAME` for No folder), no
    branch; `choose` → `petRouteCardAtom`. After a send/launch: `closePeek()`, clear the card, set the band for the
    receiving tab (`fresh` = it was a launch). Any failure → `petErrandAtom` status `error` with the message; peek stays.
  - `pickRouteChoice(model, choice, task)`: `resolveChoice` then `applyRouteAction` (a project row may yield a further
    `choose`, which replaces the card).
  - `rerouteAgent(model, tabId, project)` (D11): band `fresh` → close that tab (`closeTabLogged`) then apply
    `decideForProject(project, band.task, "you picked it", await routeWorld(model, tabId))`; not fresh → the same
    without closing (still excluding `tabId`). The new band's reason is "you picked it"; the old band is dismissed. A
    failure lands on the band (returned as an error the band shows), not silently.
  - DEV only (`import.meta.env.DEV`, like petstore's hook): `globalThis.__waveJarvisRoute = { finish(request, replyText), setDryRun(on), lastAction() }` —
    `finish` runs the post-stream path on a canned reply (visible text into `petErrandAtom`, then decide and apply);
    dry run skips `AgentsAssignCommand`, `launchAgent` and `closeTabLogged` but still escorts, closes the peek and sets
    the band (a dry `launch` sets no band since no tab exists). With dry run off, a send to a fixture agent reaches the
    real `AgentsAssignCommand`, whose refusal is the error state Task 6 photographs.
- `jarvisroutechoices.tsx`: `RouteChoiceList({ choices, onPick })`, one keyboard-reachable button row per choice,
  `data-route-choice` and `data-route-choice-kind` on each row, a pending/error state per row; used by Task 4's card and
  Task 5's band.

Acceptance — `npx vitest run frontend/app/view/jarvis/jarvisroutestore.test.ts frontend/app/view/jarvis/petactrun.test.ts`
(in `jarvisroutestore.test.ts` mock `RpcApi`, `launchAgent`, `closeTabLogged`, `openTarget` and `loadCouncils` with
`vi.mock`, as `petactrun.test.ts` mocks `RpcApi`): a canned reply with a clear verdict and one open agent calls
`AgentsAssignCommand` with the raw task, escorts and sets a non-fresh band; zero agents calls `launchAgent` with the
project path, no branch and the remembered runtime, and sets a fresh band; a remembered `terminal` falls back to the
harness preference, and No folder with a non-claude preference launches `claude` with `projectName` `HOME_NAME`; an
agent sitting in a council seat is not sent to (`loadCouncils` awaited first); an ambiguous verdict fills
`petRouteCardAtom` and calls nothing; an RPC rejection leaves the errand in `error` with its message and the peek
open; `rerouteAgent` on a fresh band closes the tab before launching and never sends to the closed tab; the visible
reply never contains `arc-route`.

### Task 4: Ask box — No folder destination and the chooser card
**Depends on:** Task 3 (uses `sendRoutedErrand`, `setRouteModel`, `petRouteCardAtom`, `NO_FOLDER_DEST`, `pickRouteChoice`, `RouteChoiceList`)
**Files:** `frontend/app/view/jarvis/peterrand.tsx`, `frontend/app/view/jarvis/peterrandmodel.ts`, `frontend/app/view/jarvis/peterrandmodel.test.ts`, `frontend/app/view/jarvis/petpeek.tsx`, `frontend/app/view/jarvis/jarvisroutecard.tsx`

Design decisions (spec section 5, D8):
- `PetPeek` calls `setRouteModel(model)` (an effect on mount / model change), so the route store and its DEV hook
  have the cockpit model.
- `resolveDestination` becomes `({picked, channels}) => PetDest` with
  `type PetDest = { kind: "no-folder" } | { kind: "channel"; channel: Channel }`: picked null, `NO_FOLDER_DEST` or an
  oid that no longer resolves → No folder. The `active` and newest-channel rungs go; drop petpeek's now-unused
  active-channel read if nothing else uses it.
- `petErrandState`'s `channel` input goes (a destination always exists); the "no channel active" reason and the
  "No project to send to yet" placeholder go.
- The destination select always renders: "No folder" first (label `NO_FOLDER_LABEL`, value `NO_FOLDER_DEST`, title
  "Jarvis picks the project"), then the project channels as today. Ask on No folder calls
  `sendRoutedErrand(model, runtime, prompt)`; on a channel, `sendErrand` as today. `PetErrand` gets the `model` prop from
  `PetPeek`.
- `jarvisroutecard.tsx`: when `petRouteCardAtom` is set, a card above the reply (`data-pet-route-card`): Jarvis's one
  `why` line, then `RouteChoiceList`; a dismiss × (`data-pet-route-card-dismiss`) that clears the card. Bounded and
  inside the popover like `ErrandReply` (no growth of the popover past its scroll region). Motion as the reply's
  (`usePartMotion(springReveal)`).

Acceptance: `npx vitest run frontend/app/view/jarvis/peterrandmodel.test.ts` (updated cases: null / sentinel / stale oid
→ No folder, a live oid → that channel; the state never disables the field for want of a channel). Scenario steps (Task
6's `jarvis-route`): "dest select shows No folder first and selected", "a reply with no block shows the prose and no
card", "ambiguous card lists the open agents and the launch rows", "card × closes the card", "malformed card lists every
project and No folder", "a failed send shows the error and keeps the peek open".

### Task 5: "Wrong project?" band on the Agent surface
**Depends on:** Task 3 (uses `jarvisRouteBandAtom`, `dismissRouteBand`, `rerouteAgent`, `routeWorld`, `RouteChoiceList`)
**Files:** `frontend/app/view/agents/jarvisrouteband.tsx`, `frontend/app/view/agents/jarvisroutebandmodel.ts`, `frontend/app/view/agents/jarvisroutebandmodel.test.ts`, `frontend/app/view/agents/agentsurface.tsx`

Design decisions (spec 2b, D11):
- `jarvisroutebandmodel.ts` (pure): `routeBandLine(band)` → "Jarvis chose <project> because <reason>" (no "because"
  clause when reason is empty; `routeProjectLabel` for the name), and `typedIntoAgent(e: {key, ctrlKey, metaKey,
  altKey})` → false for a bare modifier key (Shift, Control, Alt, Meta, CapsLock) and for Escape, true otherwise.
- `jarvisrouteband.tsx` (`data-jarvis-route-band`): one line under the subject agent's `HeldAskBar` in
  `agentsurface.tsx` (the header area, so it shows in Terminal and Chat views alike), with a "Wrong project?" button
  (`data-route-band-wrong`) that expands, in place, `RouteChoiceList` of `allProjectChoices(await routeWorld(model))`,
  and a × (`data-route-band-dismiss`). Picking a row calls `rerouteAgent(model, agent.id, row.project)`; its error shows
  on the band. Renders nothing when the agent has no band. Tokens only, per DESIGN.md.
- Dismiss on typing: an `onKeyDownCapture` on the subject agent's existing cell wrapper (no new parent element around a
  pane, no conditional render of the stack — AGENTS.md's terminal-stack rule) that calls `dismissRouteBand(agent.id)`
  when `typedIntoAgent(e)` and the agent has a band. Do not swallow the event.

Acceptance: `npx vitest run frontend/app/view/agents/jarvisroutebandmodel.test.ts`. Scenario steps (Task 6's
`jarvis-route`): "picking an agent row lands on the Agent surface with the band", "Wrong project? lists the projects",
"picking a project in Wrong project? reroutes and the band reads you picked it", "typing in the agent's cell removes the
band", "× removes the band".

### Task 6: CDP scenario, CHANGELOG and hand-check
**Depends on:** Task 4 (uses the No folder option and the route card it draws), Task 5 (uses the band it draws)
**Files:** `scripts/cdp/scenarios.mjs`, `CHANGELOG.md`, `docs/hand-checks.md`

- New scenario `jarvis-route` (surface `agent`), following `jarvis-peek`'s `arrangeJarvisPeekDest` / teardown and
  `jarvis-pet`'s fixture roster: register two temp projects, `verify-jarvis-route` and `verify-jarvis-route-b`, write a
  fixture roster with two idle agents in the first and one idle agent in the second (project names set, no runId),
  reload, open the pet peek. Steps, each with a screenshot and a `shots.json` step entry:
  1. "dest select shows No folder first and selected" — the first `[data-pet-errand-dest]` option is "No folder" and
     is selected; the input is enabled.
  2. "a reply with no block shows the prose and no card" — `__waveJarvisRoute.setDryRun(true)`, `finish` with prose
     only → the reply shows it, no `[data-pet-route-card]`, the peek stays open.
  3. "ambiguous card lists the open agents and the launch rows" — `finish` with a reply whose block names
     `verify-jarvis-route` → `[data-pet-route-card]` shows two `agent` rows and an "Open a new agent in
     verify-jarvis-route" launch row; the visible reply has no `arc-route`.
  4. "card × closes the card" — click `[data-pet-route-card-dismiss]` → the card is gone.
  5. "malformed card lists every project and No folder" — `finish` with a broken block → project rows for every
     registered project and "Open a new agent in No folder".
  6. "a failed send shows the error and keeps the peek open" — dry run off, `finish` with a clear verdict for
     `verify-jarvis-route-b` (one fixture agent, which has no live session) → the real `AgentsAssignCommand` refuses,
     the errand shows the failed state with the message, the peek is still open. Dry run back on.
  7. "picking an agent row lands on the Agent surface with the band" — re-run step 3's reply, click the first agent row
     → the peek is closed, the surface is `agent`, the focused id is that fixture agent, `[data-jarvis-route-band]`
     reads "Jarvis chose verify-jarvis-route".
  8. "Wrong project? lists the projects" — click `[data-route-band-wrong]` → project rows show.
  9. "picking a project in Wrong project? reroutes and the band reads you picked it" — click the
     `verify-jarvis-route-b` row → focus moves to that project's fixture agent, its band reads "because you picked it",
     the first agent has no band.
  10. "typing in the agent's cell removes the band" — dispatch a bubbling `keydown` (`key: "a"`) on an element inside
      the focused agent's cell → the band is gone.
  11. "× removes the band" — re-run steps 3 and 7 to get a band again, click `[data-route-band-dismiss]` → gone.
  Teardown restores the fixture file, dry run off, deletes both projects and their channels, reloads.
- `jarvis-peek`: its step 1 collects `destLabel` but never asserts it. Add the assertion `destLabel === "No folder"`
  (the default destination now); the existing `inputDisabled === !destPresent` check still holds and stays.
- `CHANGELOG.md`: one `Added` line under the top `Unreleased` section (open one if the top section is dated), for the
  person: Ask Jarvis now starts at No folder and Jarvis hands a job to the right project's agent, or asks you when unsure.
- `docs/hand-checks.md`: `- [ ] (arcterm) Ask Jarvis at No folder with a real consult (claude): a question is answered
  in the popover; a job naming a project reaches its open agent as your own prompt (no "Not typed by the user"
  header), a sleeping one wakes; a job for a project with no agent opens one with the launcher's harness.`

Acceptance: `node scripts/cdp/final-verify.mjs jarvis-route jarvis-peek` passes with ARC_FINAL_OUT set (the Final line).
