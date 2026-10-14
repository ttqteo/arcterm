# Brainstorm ideas — design

While the user brainstorms with an agent, the ideas, decisions and open questions it produces are distilled into a
list on the Agent details rail, written by the agent as it goes and by the user by hand, so the user can catch up
after looking away and no idea is lost in the scrollback.

Canvas: `.superpowers/design/brainstorm-ideas/project/` (gitignored; `Main.dc.html` first).

## Problem

- A brainstorm runs dozens of turns in a live TUI. What was decided, what was only floated and what is still open
  sits in the scrollback; catching up means rereading it.
- Ideas the user had mid-conversation, or a line the agent said in passing, are easy to lose.

## Scope

- In: Claude sessions on the Agent surface (any harness that runs `wsh` can write ideas: pi too); one list per
  session; the agent writing ideas; the user adding, editing, merging, dropping them; an unread marker.
- Out: a separate model that reads the transcript (decided against: token cost per turn, duplicates); a project-wide
  list; jumping from an idea to its turn in the live terminal (a TUI's scrollback has no stable anchor; revisit with
  the ended-transcript view); pushing an idea to a note or effort chunk.

## Decisions

### 1. The agent writes ideas; arcterm stores them

The agent in the session records each item with `wsh idea add "<text>" --kind decision|idea|question`. No extra
model reads the transcript. `wsh idea list` lets the agent check what it already recorded so it does not repeat one.

Three kinds, because catching up asks three questions: what is settled (Decided), what was floated (Ideas), what is
still open (Open).

### 2. One list per session

The list belongs to the agent session and follows it: a resumed session still has it, and an ended session opened
from Conversation History shows it. `wsh` sends `WAVETERM_BLOCKID`; wavesrv resolves the session from the block's
`agent:transcriptpath` (`<sessionid>.jsonl`). A block with no transcript path yet (the session has not reported in)
gets an error the agent can read: `no agent session in this terminal yet`.

### 3. Storage: one JSON file per session

`<data dir>/ideas/<sessionid>.json`, written only by wavesrv under an in-process lock (the `pkg/notestore` pattern), in
a new `pkg/ideastore`:

```json
{
  "seenat": 1792000000000,
  "ideas": [
    { "id": "i7", "text": "…", "kind": "idea", "by": "agent", "turn": 4, "ts": 1792000000000, "dropped": false }
  ]
}
```

- `by` is `agent` or `you` (rail input, selection, `/idea`).
- `turn` is the count of user prompts in the session when the idea was added (the Claude mod's hook already sees each
  `UserPromptSubmit`); absent when not known.
- Not a waveobj (no SQL migration) and not in the vault: it is one session's working notes, not memory to sync.
- An idea is "new" when its `ts` is after `seenat`.

### 4. RPC and events

- Every command targets `{blockid | sessionid}` (a session id wins; a block resolves through its transcript path).
- `IdeaAddCommand {target, text, kind, by}` → the idea; `IdeaListCommand {target}` → the file;
  `IdeaUpdateCommand {target, op: edit | kind | drop | restore | merge | seen, ids, text?, kind?}`;
  `IdeaTickCommand {target}` → the nudge text or empty: the Claude mod calls it on each `UserPromptSubmit`, and it
  counts the prompt and applies the 3-prompt rule (decision 7).
- Merge joins the selected ideas' texts (oldest first) into the oldest, keeps the oldest's kind, and drops the rest.
- Every change publishes `ideas:changed` with the session id; the frontend keeps a per-session atom and refetches.

### 5. On the rail: a count, not a tab

The details rail's strip is two tabs then the agent's counts, each count shown only while its list has something.
Ideas is one more count, not a third tab (a tab among counts would blur which is which, in a 300px strip):

- Lightbulb icon and the number of ideas not dropped; first among the counts. Absent at 0.
- A small dot on the icon while any idea is new.
- A click opens the **Ideas** section in Overview, after Needs you, or closes it (`railStatClick`, like the others).

The section (`Main.dc.html`):

- Header: Ideas, its count, `N new` and **Mark read** when any are new. Leaving the section (closing it, another tab,
  another agent) also marks them read.
- Grouped Decided / Ideas / Open, newest first in each, each row: the text, `turn N · agent|you`, and a `New` pill.
  Hover shows Edit, Mark as decided, Drop.
- Rows check for merge (`Ideas-EditMerge.dc.html`): a bar `N selected · Merge · Drop`. Edit is inline, with the kind
  as a three-way choice.
- Dropped folds at the end, each with Restore.
- **Add an idea** input at the section's end: Enter adds it as an `idea` by `you`.

### 6. Capturing a selection

Selecting in the terminal still copies (`term:copyonselect`, unchanged). While text is selected, a chip
**Add as idea** with its shortcut shows beside the selection's end (`Capture-Selection.dc.html`); it takes no focus,
so typing still reaches the agent, and it goes when the selection clears or a key is typed.

- Click it or press the shortcut: the selection is added as an `idea` by `you`, and a toast **Added to Ideas · Undo**
  shows.
- The shortcut with nothing selected opens the Ideas section and focuses its input.
- Shortcut: `Mod:Shift:i` (free in `bindings.ts`). Check it is not eaten by WebView2's DevTools accelerator in the dev
  build; if it is, pick another before shipping.

### 7. Getting the agent to write

- A shipped skill `skills/ideas/SKILL.md`: use when brainstorming, designing or weighing options with the user; record
  each decision, idea and open question as it comes up, one line each, in the conversation's language; check
  `wsh idea list` first; turn a question into a decision (`wsh idea update`) when the user settles it.
- A nudge, only in sessions that already have an idea: on `UserPromptSubmit` the Claude mod adds one line of context
  when 3 or more prompts have passed since the last idea (`3 turns since the last idea was recorded`). Not a Stop hook:
  blocking a stop makes the agent run another turn.
- `/idea` in `claude/arc-mod`: the agent sums up the idea just discussed in one line and records it with `--by you`.

## Testing

- `pkg/ideastore`: add, list, update ops, merge, seen, concurrent adds.
- wshserver: block → session resolution, the no-session error.
- Frontend pure models beside their `.tsx`: grouping and `new` (`ideasmodel.ts`), the count and dot in
  `planRailStats`, the selection-chip visibility rules.
- `pkg/ideastore` `Tick`: the nudge fires at 3 prompts, never in a session with no ideas. Claude mod
  `hooks/ideas-core.ts`: the nudge row's text, and the tick-then-append wiring with its failures logged, not thrown.
- CDP scenario `ideas-rail`: fixture session with ideas → the count and dot, the open section, Mark read clears the
  dot.
