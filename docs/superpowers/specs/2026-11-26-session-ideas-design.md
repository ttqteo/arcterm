# Session ideas: what was floated in a session and never decided, before its transcript goes

Date: 2026-11-26. Canvas: `.superpowers/design/ideas-vault/` (boards `Brief-Region`, `Jarvis-Ask`, `Nudges`,
`Scan-States`; the Library-tab and sheet versions that were turned down are under `unchosen/`).

## Why

Decided things land in files (specs, plans, `docs/deferred.md`, AGENTS.md council decisions, commits). Ideas that were
floated in a session and left open land nowhere: "đôi khi tôi thấy sẽ có 1 số concept/idea bỏ lỡ, còn những gì decide thì
vào file rồi". Today they survive only inside raw transcripts, which nobody rereads, and which are deleted.

Keeping transcripts longer does not help on its own: a transcript is not where anyone looks. The removed memory subsystem
(`docs/deferred.md`, "The memory subsystem, removed (2026-09-22)") is the warning: note bodies were opened in 5.3% of
sessions, and the Vault surface that showed them went with it. So an idea has to come back where the person already
looks (the Jarvis Brief, Sprout, a brainstorm on its topic), not in a store of its own that has to be visited.

## What runs today

- Claude Code deletes transcripts after `cleanupPeriodDays`; arcterm writes 90 into `~/.claude/settings.json` unless the
  person set one (`cmd/wsh/cmd/wshcmd-installhooks.go:345` mergeClaudeCleanupPeriod). On 2026-11-26 the oldest
  transcript on disk was from 2026-09-22.
- Conversation History search reads one digest per transcript (prompts and text replies) under
  `<data dir>/sessiondigests/`, but only for 30 days (`pkg/agentsessions/digeststore.go:34`, `DigestWindowDays = 30`).
- Settings → Storage's Sessions card moves Claude transcripts to the session trash, by default those 30 days or older
  (`pkg/storage/sessions.go:23`). It does not know whether a session held anything worth keeping.
- `pkg/sessionarchive` moves the transcripts of arcterm's own machinery (engine workers, reviewers, judges, headless
  passes) out of `~/.claude/projects` into `~/.arc/archive/claude-sessions`.
- Initiatives already hold ideas (an initiative with no chunk, the Brief's Ideas column) and proposed chunks
  (`wsh effort chunk add --proposed`, which count in the badge through Waiting on you's `plan` item,
  `pkg/jarvis/attention.go`).
- Ask Jarvis (Sprout's popup, `frontend/app/view/jarvis/peterrand.tsx`) is a one-shot `claude -p` in No folder
  (`pkg/consult`), with the channel's last 20 messages / 4000 chars as context (`MaxContextMessages`,
  `maxContextChars`). Its prompt (`buildRoutePrompt`, `frontend/app/view/jarvis/jarvisroute.ts:72`) lists the projects
  and open agents, and a job is handed on with an `arc-route` block.
- DUM-E (`pkg/dume`, `docs/guide/dume.md`) already decides when a 5-hour window's leftover quota may be spent.

## Design

### The scan

- **Input:** a session's digest (the same file search reads), never the raw transcript. Sessions skipped: those in the
  archive (arcterm's machinery), those not quiet for 2 days (still being written), and the agents this feature opens to
  decide ideas (stamped when opened), so a later scan does not re-propose an idea from the talk about it.
- **One haiku call per session**, through `pkg/consult` with no tools. Its prompt carries, for the session's project:
  the open initiatives and their chunk labels, the existing ideas, spec and plan names, and `docs/deferred.md` headings.
  It answers with JSON: for each idea floated and not decided, a one-line English gist, the initiative it belongs to (or
  none), the quoted lines (verbatim, any language), and why it stayed open. An idea that matches a chunk, an idea, a
  spec, a deferred line or a commit is left out.
- **Each session is scanned once.** A scanned mark (session id, transcript size and mtime) lets a session that grew
  after its scan be read again for the new turns only.
- **Ideas go to their own store** (`<data dir>/sessionideas/`), not straight onto initiatives as proposed chunks. A
  proposed chunk is counted in the badge and drawn on its initiative's row; an idea from a scan is not urgent and should
  not do either until the person keeps it.

### When it scans

- A transcript's deletion day is its last write plus `cleanupPeriodDays`, read from `~/.claude/settings.json` (never
  hard-coded 90). Its scan is due 10 days before that.
- wavesrv checks once a day. A due session is scanned in a leftover 5-hour window, through DUM-E's gate (window near
  reset with quota left, no run of the person's, no memory pressure), nearest deletion first.
- A session 7 days from deletion and still unscanned is scanned at once, outside a leftover window. The Brief says so
  (Scan-States board 4).
- Storage's Sessions card scans the unscanned sessions it is about to move to the trash first, or says how many it would
  move unscanned and lets the person choose.

### Where the person sees it: the Brief's From your sessions region

Board `Brief-Region`. A region of the Jarvis Brief, between Initiatives and the Ideas / For later row, laid out as the
other regions (label, count, "scanned Nov 24 · next by Dec 1", Scan now, Show only). No new surface, tab or sheet.

- Each idea is a row: the gist, the initiative it would go on (or "New idea · <project>"), **What was said** (opens the
  quote, the source session, and the day its transcript is deleted, with Open session), then:
  - **Keep:** a `pending` chunk on that initiative, or a new idea in the Ideas column. The quote and the session id become
    the chunk's first note, so the idea keeps its source after the transcript is gone.
  - **Drop:** removed; the scan does not propose it again.
  - **Discuss:** opens a sonnet agent **in the idea's project**, given the gist, the quote, the initiative and the source
    session id (it reads more with `wsh read <id>`, never `--resume`: resuming a cold session rewrites its whole cache,
    the cost that ruled out resume in `docs/deferred.md`, "Save place and close"). While that agent is open the button
    reads **● Go to agent**.
- **Go through N with an agent** (region header): one sonnet agent **in No folder** walks the ideas with the person one
  at a time and records each decision with `wsh effort` and the ideas store. No folder because the ideas span projects
  and a quick pass needs no project's AGENTS.md, memory or skills. An idea that needs code read is left for Discuss.
- **Sessions scanned** folds at the region's end: a coverage bar of the last 90 days (scanned, not yet, leaving within
  7 days), and each session with what it gave (`3 ideas · above`, `1 idea · kept`, `nothing left open`, `not scanned`).

### Jarvis

Board `Jarvis-Ask`.

- Sprout's popup carries one line under its updates, "N ideas from your sessions to review · Review in Jarvis". It is
  not a queue row, so it does not count in the badge.
- **Fixed chips under that line are the main path.** Each does one thing and none waits on a model to answer:
  - **What's waiting?** opens the ideas in the popup (gist, initiative), read from the ideas store.
  - **Go through N with an agent** opens the No-folder sonnet agent, as the region's header button does.
  - **Discuss: <gist>** opens Discuss for the first idea, the one whose transcript is deleted soonest first.
  - **Which lose their transcript soon?** only while one does; the list filtered to those.
  A chip that already ran shows its agent with **Go to agent**. Each press writes one log line (chip, position), as the
  chatsuggest council asked of Chat's chips (2026-11-19), so a chip nobody presses can be dropped on numbers.
- **Typed questions are the side path.** `buildRoutePrompt` also lists the ideas waiting, beside the projects and open
  agents, so a question the chips do not cover ("ý nào liên quan Sidecar?") is answered, and "duyệt giúp tôi" or
  "bàn ý <x>" route through the existing `arc-route` to the same two agents.

### Hearing about it

Board `Nudges`.

- A toast when a scan ends with something new.
- A Sessions section in Since you looked.
- After 7 days with nothing opened, one `ideas` line in Waiting on you, which the badge counts, with **Next week**.
- Proposed to leave out: a dot on Jarvis in the nav rail (the toast already says it).

## Cost

- The scan is one haiku call per session, on its digest. Real numbers ([N] sessions, tokens per call) are measured on
  the first scan and written here before the daily schedule is turned on.
- Each Discuss or Go through is one ordinary sonnet session, not a fan-out.
- The digest store grows if search goes to 90 days (below): measure its RAM and disk and log it in `docs/open-issues.md`'s
  RAM watch.

## Related, separate changes

- `DigestWindowDays` 30 → 90, so search reaches as far back as transcripts are kept.
- Ideas from earlier sessions as a part of the brainstorm panel (`kind: "note"`, from history), so an idea comes back
  when its topic is brainstormed.

## Decided after the first draft (2026-11-26)

1. **Nothing scans before the person presses Scan my sessions** (Scan-States board 1), the forced scan of a session near
   deletion included: it spends tokens the person has not seen estimated. Until then the region shows the offer and the
   count of sessions leaving soon.
2. **Nudges:** the toast, Since you looked's Sessions section and the 7-day Waiting line. No dot on the nav rail
   (Nudges board 3 is not built).
3. Scan-States boards 2–4 draw the To review strip and sheet that were turned down; the same states (scanning, stopped
   part way, leaving unscanned) are built inside the From your sessions region instead.

## Open questions

1. Deciding in one sentence to Jarvis ("keep 1 and 2, drop 4") needs a new block the frontend applies. Left out until
   the region and the routed agents are in use.

## Out of scope

- pi and other runtimes' sessions (the digest covers pi; the first version scans Claude only).
- A Library tab or a surface for ideas (turned down: it is a place that has to be visited).
- Raising `cleanupPeriodDays` past 90 (about 35 GB a year at 2026-11 rates; only if ideas older than three months are
  wanted).
