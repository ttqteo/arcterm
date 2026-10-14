# Learned additions — design

Skills and memory that grow from the user's repeated corrections, with the user's lines kept apart from what
arcterm ships and highlighted wherever they show.

## Problem

- arcterm's shipped skills (`skills/`) are mirrored over the vault on every agent launch
  (`seedShippedSkills`, `pkg/agentsync/skills.go:308`). Only a skill's `.arc/` delta directory survives, and it holds
  frontmatter overrides and sidecar files only, so a line an agent adds to a skill's body is lost at the next launch.
- Agents already write memory when corrected, but nothing notices that the same correction keeps coming back, and
  nothing marks a memory as one the user taught.
- The user cannot see, in a skill, which lines are arcterm's and which are their own.

## Scope

- In: skills in the vault (arcterm's shipped skills and the user's own managed skills), and Claude project memory.
- Out: plugin skills (superpowers, anthropic-skills…), which live in a plugin cache arcterm does not own; transcript
  scanning; automatic detection of contradicting rules (the user sees every accepted line side by side in the Learned
  tab).

## Decisions

### 1. Agents note a learning; wavesrv counts

A new shipped skill, `skills/learn`, tells an agent when to note: the user corrects it, repeats an instruction, or
says "from now on…". The agent first runs `wsh learn list --skill <name>` (or `--memory`) to reuse a key for the same
idea, then:

```
wsh learn note --key <kebab-slug> (--skill <name> | --memory) "<the rule, ≤200 chars>" --quote "<the user's words>"
```

`--memory` takes the session's cwd to pick the project. Grouping is by the agent-chosen `--key`, not by embeddings:
deterministic, cheap, testable.

wavesrv is the only writer. Each note is one line in `<wave data dir>/learn/notes.jsonl` (key, target, text, quote,
session, time), so there is no new waveobj and no migration, and a dev app or a CDP run keeps its own. wsh has no
agent session id, so a note's session is its tab and day: `WAVETERM_BLOCKID` + the local date (`cli` when there is no
block). A key becomes a **proposal** when it has notes from **two distinct sessions within 30 days**; two notes in one
session are one correction in progress, not a repeat.

### 2. Proposals wait in Needs you; nothing is written without a yes

A proposal card shows the target, the one proposed line, and the quotes as evidence (folded by default). Actions:

- **Accept** writes it to the target.
- **Edit** opens an inline input on the card (no modal), then accepts.
- **Dismiss** mutes the key; it is never proposed again.

Proposals do not expire.

### 3. Skill additions live in `.arc/additions.md`, rendered last

Accepting a skill proposal writes an entry to `<vault>/skills/<name>/.arc/additions.md` (key, text, accepted date,
count). A second accept of the same key replaces its line in place and adds to the count. A skill holds at most 20
additions; at the cap the card says to remove one first.

`renderSkill` appends the additions to SKILL.md for every runtime:

```
## Your additions
<!-- arc:user -->
These are the user's own rules; where they conflict with the text above, they win.

- Always write notes in Vietnamese. (learned 2026-10-14, 3×)
```

`.arc/` already survives the seed, so the additions survive every launch and every arcterm upgrade, and never
conflict with an upstream change to the skill body.

### 4. Memory additions are marked `source: learned`

Accepting a memory proposal writes a `feedback` memory file to the project's Claude memory dir and its line in
`MEMORY.md`, with `metadata.source: learned` and the learned date. Memories without that field are untouched.

### 5. The user's lines are highlighted wherever they show

- **Setup → Skills rail.** The rail previews the vault's SKILL.md, which never holds the additions (they are added
  at render), so the skills RPC carries each skill's additions and the rail renders them below the preview. The
  shipped part renders as today, read-only. The additions render in their own block with a left accent border (an
  `@theme` token, never hex); each line shows `14/10 · 3×` with **Edit** and **Remove**. A line accepted in the last
  7 days also gets a faint accent background: that is the "new" highlight.
- **Skill list.** A `+N` chip beside a skill that has additions.
- **Setup → Learned tab.** A third Setup tab lists every accepted line in one place: skill additions grouped by
  skill, learned memories grouped by project, each with the same date, count, "new" highlight, **Edit** and
  **Remove**. Claude's own memory dir appears nowhere else in the cockpit (the Jarvis peek reads only the vault's
  memory), so this tab is where learned memories are seen.
- Removing a skill addition rewrites `additions.md`, re-runs the reconcile so every harness gets it at once, and mutes
  the key. Removing a memory deletes its file and its `MEMORY.md` line, and mutes the key.

## Edge cases and errors

- `--skill` naming a skill not in the vault (including a plugin skill): `wsh learn note` fails, lists the vault's
  skills, and suggests `--memory`.
- A skill deleted from the vault while a proposal waits: the card says so and offers memory instead, or dismiss.
- arcterm stops shipping a skill: the seed never deletes vault directories, so its additions remain.
- wavesrv not running: `wsh learn note` fails with one line; the `learn` skill tells the agent not to retry and to
  mention it once.
- A malformed line in `notes.jsonl` is skipped and logged.

## Testing

- **Go, `pkg/learn`:** note append; the two-session threshold (two notes in one session make no proposal); the
  30-day window; mute; accept writes `additions.md`; a second accept replaces the line; the 20-line cap.
- **Go, `pkg/agentsync`:** `renderSkill` appends additions under the marker for every runtime; `seedShippedSkills`
  keeps `additions.md`.
- **vitest:** the 7-day "new" rule, the Learned tab grouping, the proposal row model.
- **CDP scenarios:** `setup-skill-additions` (the highlighted block and the `+N` chip), `setup-learned` (the Learned
  tab) and `needs-you-learn-card`, from fixtures.

## Cost

No extra tokens beyond the `wsh learn` calls an agent makes; no job reads transcripts.
