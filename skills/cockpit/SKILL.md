---
name: cockpit
description: Use when you want to show the user something in the arcterm cockpit (a run, an agent terminal, a record, a memory note, a surface), read what they're looking at, or run a cockpit action for them — via `wsh ui`; or, in a Claude agent, when an explanation of a flow, an architecture or a choice would read better as a picture, when you sum up progress over time, results with their numbers, or a roadmap of what to do and read next, or the person asks you to draw — via `wsh board draw`.
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

What people put on boards, and the tool that fits each (the person's real use, most used first):

| When your reply… | Draw | Not on the board |
|---|---|---|
| sums up progress over time (weeks, phases, "Part 1–4") | a timeline of the dated steps; a flowchart of the parts and what feeds what | |
| reports results with numbers (a research question's scores, a dataset filtered down) | a bar chart of the numbers; a funnel of the counts at each filter; a few insight boxes, each with its number | a chart of numbers alone: a mermaid block in Chat |
| lays out a roadmap (what to learn, do and read next) | a map of the topics and how they connect | the to-do and to-read items: chunks of an initiative (`arc:initiatives`), so they can be ticked off and given a due day |
| explains an architecture, a flow or a choice | the boxes that matter and the direction of the flow | |

When such a summary runs to several dated steps, several numbers or several next items and the person did not ask for
a picture, end the reply by offering it in one line, in their language, that names what you would draw ("Vẽ timeline 1/4–4/4 lên board
không?"), and draw on a yes; one of each stays words, with no offer. When they asked for a picture, draw. Put each
row's drawings on one board named for the topic (`thesis-progress`, `rq4-results`), one request per drawing.

**How.** The board is named by a short topic (`wavesrv-startup`, `auth-flow`).

- First time on a board: `wsh board draw --board <name> --context "<briefing>"`. `--context` briefs the drawer and
  creates the board, tied to you. Without it a board that doesn't exist yet is an error that names `--context`.
- Run it with the Bash tool. A briefing of several lines, or with double quotes, goes in a file instead:
  `--context-file <path>` (`-` reads stdin). Windows PowerShell 5.1 splits such an argument to a native command, and
  its pipe to one drops every non-ASCII letter, so from PowerShell write the file with the Write tool and pass its path;
  never flatten the briefing to one line or strip its accents to get it through.
- Later: one line, `wsh board draw --board <name> --ask "<what to draw>"`.
- A prompt that holds `board:<id>` (the person picked a board in Chat's `@` picker) asks about that board: pass it as
  written, `--board board:<id>`, with `--ask` carrying their request.
- A board an ended agent drew is taken over by the next agent of its project that draws on it: `--ask` on its name
  ties it to you, drawing and turns kept, and it shows beside your Chat. The person can also hand one to you from
  Library → Boards (Open beside Chat…). A board whose agent is still live stays that agent's.
- Keep the briefing short. The drawer reads what you said in the conversation since its last read, so don't restate
  it, and never paste shapes or coordinates. Say what to draw and the angle (the boxes that matter, the direction of
  the flow), not the explanation itself.
- A request becomes one new, short drawing: one idea, a handful of boxes, a few words each. For more, send another
  request, and it becomes another drawing beside the first, never a denser one.
- To fix a drawing already on the board, ask for the fix and name the drawing by its title: `--ask "in Part 1, drop
  the two long arrows and write 'continued in Part 2' under the last box"`. The drawer edits that drawing in place.
  `--ask "delete the drawing Part 2, fixed"` removes a whole drawing. One request changes one drawing, so a fix and a
  delete are two requests. Fix in place rather than drawing a corrected copy beside the old one.
- A board draws bar and line charts to scale, beside the boxes. For one, give the drawer the numbers themselves, with
  their labels and units, in the briefing or the `--ask` line ("add a bar chart of pass rate: baseline 0.42, LLM
  0.61, agent 0.70"); it never invents numbers. A chart of numbers on its own, with no drawing around it, reads better
  in Chat as a mermaid `xychart-beta` block.
- Run it with a Bash timeout of 600000 ms: it waits for the drawing, up to 9 minutes. It prints one line:
  - `Drawn on board "<name>": +A shapes, C changed, R removed.` — done (exit 0).
  - `Still drawing on board "<name>"; its card in Chat shows when it lands.` — the wait ran out; carry on (exit 0).
  - `Couldn't draw on board "<name>": <reason>` — nothing changed (exit 1); an RPC error prints the same way.
- The board never opens by itself: your turn in Chat gets a card for it (name, shape count, **Open**), and the person
  opens it beside Chat when they want to look. A new drawing lands in its own frame, beside the earlier ones; a fix
  lands in the drawing it names.

**Questions about a board come in Chat.** The person asks about a board in a message to you, naming it with `@board`
(the `board:<id>` above). Answer in words, in your reply. If your answer is worth a picture, send the drawer a one-line
`wsh board draw --board board:<id> --ask "<what to draw>"`: it becomes a new drawing beside the others. An older
message headed `[From board "<name>" · on <shapes> · turn <id>]` is a question the person asked on the board itself
before that went away: treat it as their own message, the same way.
