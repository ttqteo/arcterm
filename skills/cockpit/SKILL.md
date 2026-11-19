---
name: cockpit
description: Use when you want to show the user something in the arcterm cockpit (a run, an agent terminal, a record, a memory note, a surface), read what they're looking at, or run a cockpit action for them — via `wsh ui`; or, in a Claude agent, when an explanation of a flow, an architecture or a choice would read better as a picture, or the person asks you to draw — via `wsh board draw`.
---

# Driving the arcterm cockpit

You run inside arcterm. `wsh ui` lets you see and steer the cockpit the user is looking at.

- `wsh ui state` — JSON: current surface, `busy`, `selection` (addresses), and the `actions` available now.
- `wsh ui reveal <address>` — take the user to an entity. Addresses: `run:<id>`, `channel:<id>`,
  `dag:<oid>[#<taskId>]` (a run's task graph, on one task when named), `agent:<tabId>`, `task:<id>`, `memnote:<id>`, `effort:<id>`,
  `surface:<cockpit|jarvis|agent|code|files|usage|setup|settings|history>` (`history` is Conversation History, a mode of the Agent surface).
  Your own terminal is `agent:$WAVETERM_TABID`. Files: use `wsh view <path>` instead.
  A `memnote:` has no surface: it shows in the avatar popup and leaves the user where they are.
  `session:<id>` (a session id or a unique prefix) reopens a past conversation in a tab, as its Resume does: asleep
  when it can sleep. It prints `agent:<tabId>`; `wsh agents send <tabId> "<text>"` wakes it with that message.
- `wsh ui actions` — the actions available right now (they depend on the surface and selection).
- `wsh ui do <action-id>` — run one, exactly as if the user pressed its key.

Rules:
- Read `state` before `do`: actions act on the current selection, so `reveal` the target first.
- Prefer `reveal` to show the user something; only `do` what they asked for.
- "the user is busy" means they are typing or in a dialog — wait and retry; never loop tightly.
- "waiting on the user's confirmation" means they must approve it; check `state` later, don't re-issue.
- Closing sessions and answering asks are not available here (use `wsh ask` for your own questions).
- Every successful call shows the user a toast naming you, so keep calls purposeful.

# Drawing on a board

A board is an Excalidraw drawing per topic, kept per project and shown beside your Chat. A separate, cheap drawer draws
it; you only brief it. **Claude agents only:** `wsh board draw` from a pi or other agent is refused ("boards are for
Claude agents"), and so is one from a folder that is no registered project.

**When to draw.** An explanation of a flow, an architecture or a choice often reads better as a picture than as
paragraphs, and the person may ask you to draw. Draw then, and still explain in words in your reply: the drawer draws
and never answers in words. Don't draw a one-line answer.

**How.** The board is named by a short topic (`wavesrv-startup`, `auth-flow`).

- First time on a board: `wsh board draw --board <name> --context "<briefing>"`. `--context` briefs the drawer and
  creates the board, tied to you. Without it a board that doesn't exist yet is an error that names `--context`.
- Later: one line, `wsh board draw --board <name> --ask "<what to change or add>"`.
- Keep the briefing short. The drawer reads what you said in the conversation since its last read, so don't restate
  it, and never paste shapes or coordinates. Say what to draw and the angle (the boxes that matter, the direction of
  the flow), not the explanation itself.
- Run it with a Bash timeout of 600000 ms: it waits for the drawing, up to 9 minutes. It prints one line:
  - `Drawn on board "<name>": +A shapes, C changed, R removed.` — done (exit 0).
  - `Still drawing on board "<name>"; its card in Chat shows when it lands.` — the wait ran out; carry on (exit 0).
  - `Couldn't draw on board "<name>": <reason>` — nothing changed (exit 1); an RPC error prints the same way.
- The board never opens by itself: your turn in Chat gets a card for it (name, shape count, **Open**), and the person
  opens it beside Chat when they want to look. The drawer may move, restyle or remove any shape on it, hand-drawn ones
  included, so don't rely on a shape staying where it was.

**Questions asked on the board reach you.** The person can select shapes and ask about them on the board. When the
drawer can't answer that by drawing, it forwards the question to you as a message headed
`[From board "<name>" · on <shapes> · turn <id>]`, then their words. Treat it as the person's own message: answer in
words, in your reply. If your answer changes the picture, send the drawer a one-line
`wsh board draw --board <name> --ask "<the change>"`.
