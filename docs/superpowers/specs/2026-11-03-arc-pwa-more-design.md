# Remote control on the Arc phone app

Extends the phone app from `docs/superpowers/specs/2026-10-27-answer-arc-from-phone-design.md`
(remote mode, `pkg/remotemode`). Read that spec first: everything here builds on its listener, locks,
page and push, and changes only what this document names.

## Intent

The phone app lets the owner answer agents' questions and nothing else. The owner wants something like
Claude Code's `/rc`: hand chosen agents to the phone before leaving, then from the phone read what
they did, send the next prompt, stop a turn and approve a permission prompt. It must work for claude
and pi alike, and go through Arc's own tunnel and locks, not the Claude app.

This reverses one non-goal of the first spec, "Sending a new prompt to an agent that finished its
turn (remote chat)", for agents the owner hands over. The rest of that spec stands.

## Background

- **What the phone app does today.** It shows a waiting list from `pkg/jarvis/attention.go`, answers
  `ask` items, turns remote mode off and stores the push subscription. These are its only four calls,
  served by a separate loopback listener behind Cloudflare Tunnel and Access, and Arc re-checks the
  Access JWT on every request. The page is plain HTML, CSS and JS embedded in wavesrv
  (`pkg/remotemode/web/static`), with no build step.
- **Prior art.** Claude Code Remote Control (`/rc`, `--remote-control`, in the installed 2.1.317)
  shows the conversation and diffs in the Claude app, takes messages and permission approvals, and
  covers claude only. Omnara, Happy, Cursor's web/mobile agents and GitHub Mobile all let you message
  an agent from the phone.
- **What Arc already has.**
  - `StreamAgentTranscriptCommand` (`pkg/wshrpc/wshrpctypes_agents.go`) streams a session's
    transcript tail and pushes new lines.
  - The cockpit projects transcripts per harness (`frontend/app/view/agents/transcriptprojection.ts`,
    `pitranscriptprojection.ts` and others). These projectors import only types and the pure
    `tooldetail.ts`.
  - The cockpit composer types into an agent through `ControllerInputCommand`, and `interruptAgent`
    (`agentactions.ts`) sends Esc.
  - A Claude Code permission prompt sets the agent to waiting (`cmd/wsh/cmd/wshcmd-agenthook.go`), but
    it appears in no transcript line and no attention kind.

## Goals

- **Hand over.** The owner hands chosen agents to the phone. Only handed-over agents appear on the
  phone for remote control.
- **Handing over turns remote mode on** if it is off: the tunnel, the phone listener and keep-awake.
  It is one step, like `/rc`.
- **When it ends.** Turning remote mode off, from the desk, from `wsh` or with the phone's button, ends
  every hand-over. An agent that exits drops off the phone. The owner can take one agent back early,
  from the cockpit or from the phone. Each time the owner leaves starts clean.
- **Where it happens.** The owner hands an agent over on the Agent surface: a **Hand to phone** button
  in the agent header (`frontend/app/view/agents/agentheader.tsx`), placed left of the fullscreen
  button, with a key in `buildAgentBindings` (`frontend/app/store/keybindings/bindings.ts`) mirrored
  in `docs/keyboard-shortcuts.md`. While an agent is handed over, the button reads **On phone · Take
  back** in the accent style. `wsh remote hand <tab>` (and a matching take-back) does the same, so an
  agent or script can do it. There is no slash command inside the session.
- **The chat view**, for claude and pi:
  - The phone listener streams the handed-over agent's transcript to the page over one SSE route.
  - The page draws it with the cockpit's own projectors. A sync step bundles them with esbuild
    (already in `node_modules`) into one committed ES module under `pkg/remotemode/web/static/`, the
    way `tokens.css` is synced and committed, so `go build` still works in a fresh tree with no Vite
    step.
  - Send, Stop (Esc) and Approve/Deny go back through `ControllerInputCommand`, which the listener
    calls in-process. The main wavesrv listener is never exposed.
- **Pushes.** There are no new pushes. The phone buzzes only for what it already pushes: questions and
  the other new waiting items. Turn ends and permission waits show when the owner opens the app.

## The screens

Mockup: `.superpowers/design/arc-pwa-rc/project/`, boards `Main`, `Chat`, `ChatWorking`,
`ChatPermission`, `ChatEnded` and `Cockpit`. The boards are the visual spec. The look follows
`DESIGN.md` and the existing phone page (`phone.css`, `tokens.css`): no text under 10.5 px and touch
targets of at least 44 px.

- **List (`Main`).**
  - A **Handed over** section sits between Questions and Held runs.
  - Each row shows the runtime dot, agent, project and state: working (green), idle (grey) or needs
    approval (amber). Below that is the latest line: the current action, or the first line of the last
    reply. The row opens the chat.
  - The header's count line adds "N agents handed over".
  - The off button's line says that every handed-over agent goes back to the desk.
- **Chat, idle (`Chat`).**
  - A back header shows the agent, project and state, with **Take back**.
  - The owner's messages appear as right-hand bubbles.
  - Tool calls are compact mono lines (verb, target, summary, and +/- counts for edits), in the
    cockpit narration style.
  - Replies appear as full text. Agent's call (builder question 3): plain text with its line breaks
    kept, and fenced code blocks drawn as mono blocks by a small splitter. There is no markdown
    renderer and no HTML: every string goes in as text, as `phone.js` already does, so
    agent-controlled text cannot inject markup into a page that can drive the PC. A test covers the
    splitter, including a reply that contains HTML.
  - One message box and **Send**.
- **Chat, working (`ChatWorking`).** The box reads "Add to this turn", since what it sends joins the
  running turn. A **Stop this turn** button sends Esc.
- **Permission wait (`ChatPermission`).**
  - An amber card shows the tool and its command (the pending tool call), with **Approve** (the
    primary action) and **Deny**.
  - The box becomes "Deny and say what to do instead".
  - A permission menu never appears in a transcript line, so the phone does not reproduce the menu's
    exact options.
  - Agent's call (builder question 1): the card appears only for a real permission prompt. Claude
    Code's waiting state also covers `elicitation_dialog`, `elicitation_url_dialog`,
    `agent_needs_input` and an untyped notification, and those dialogs have other options, so typing
    the permission keys into them could submit something the owner did not mean. For those waits the
    phone shows "Needs input · answer it at the desk", with no Approve or Deny and the message box
    disabled. This means carrying the notification type from `planEmission`
    (`cmd/wsh/cmd/wshcmd-agenthook.go`) through the agent status to wavesrv: a change to the status
    type, then `task generate`, then a hook test.
- **Taken back or exited (`ChatEnded`).** A "Back at the desk" page gives the reason (taken back, or
  exited) and links back to the list.
- **Cockpit (`Cockpit`).** The agent-header button in both states. The app bar's existing **Remote on**
  pill shows while remote mode is on.

## Non-goals (this round)

- Acting on held or blocked runs, and starting a run, from the phone.
- A list of agents that were not handed over.
- Diffs or file contents on the phone. Tool calls stay one-line summaries.
- New pushes: on turn end, on permission waits, or with reply text.
- Android. Turning remote mode on from the phone; handing over happens at the desk.
- Run workers (engine-driven agents) are not offered for hand-over.

Agent's call (builder question 2): one eligibility rule, used by the header button (shown only when
it holds), by `wsh remote hand`, and by the listener on every request. An agent can be handed over
when it is shown on the Agent surface, has a live terminal block for `ControllerInputCommand` to type
into, and is not a run worker. Orchestrator leads are eligible: the owner can type into a lead at the
desk today, and handing over is the owner's explicit choice, so the phone gets the same reach and no
extra guard. A session with no live terminal block is never offered. Live means the agent session itself,
not only its terminal: a claude or pi that exited back to a shell still running in the same block
is no longer eligible, so a phone send never lands in a bare shell. For claude the signal is the arc
mod's control stream, which lives as long as the claude process. For pi it is an ended flag that pi's
shutdown status report sets.

## Constraints

- The first spec's locks stay as written: Cloudflare Access, Arc checking the Access token on every
  request, and the `Origin` and JSON content-type checks on every POST.
- The separate loopback listener runs only while remote mode is on. The main wavesrv listener and its
  per-launch key are never reachable off the machine.
- The new routes are the transcript stream, send, stop, approve/deny, take back, and the handed-over
  list (or the same data added to the existing list call). They sit behind the same checks and act
  only on an agent that is handed over at the moment of the request. Any other block is refused.
- A send must reach the session as the owner's own input. The listener uses `ControllerInputCommand`,
  not `AgentsSendCommand`, which marks a message as sent by an agent.
- Windows-only, like the rest of the Tauri packaging.

## Left to the builder

- The SSE route's shape, and a heartbeat that stays under cloudflared's idle cut.
- The esbuild sync step for the projectors: beside `sync:remoteweb`, run wherever that runs, with its
  output committed and never hand-edited.
- Where hand-overs are kept. In memory in `pkg/remotemode` is enough, since remote mode off ends them.
  Whether they come back after an Arc restart is the builder's call.
- The exact keystrokes Approve and Deny type for claude's permission menu. pi has no permission prompt.
- How the notification type travels from the hook to the phone (see the permission card above).
- The cockpit key: `p` is a guess, so check for clashes in `buildAgentBindings`.
- A `remote:status` event (or its payload) that carries the handed-over set, so the agent header and
  the phone stay current, including when the phone takes an agent back.
- Checking it: extend `cmd/remotepreview` (a fixed handed-over set, a recorded transcript, a recording
  input sink) and the `remote-phone` CDP scenario to cover the `Main`, `Chat`, `ChatWorking`,
  `ChatPermission` and `ChatEnded` boards, plus a scenario step that shows the Hand to phone button in
  both states on the Agent surface.
