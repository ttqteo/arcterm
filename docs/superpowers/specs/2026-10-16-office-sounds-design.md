# Office sounds — design

**Date:** 2026-10-16
**Status:** design agreed, not built
**Changes:** nothing in `2026-10-15-cockpit-office-design.md` or `2026-10-16-office-floors-design.md`; it adds sound to
the office they draw. It stands apart from the office's four parts and does not wait on part 2 (coins): that part
adds a `coin` cue to the table below and nothing else.

## Problem

The office looks like a GBA game and is silent. The person asked for game music, Pokémon style. A tune looping all day
in a work tool turns into noise within the hour, plays over the person's own music and calls, and would bury the one
sound that matters today, the OS toast's sound for something blocked on you (`src-tauri/src/notify.rs`). So the sound
that ships by default is short jingles on events; music is there to turn on, off by default.

## Where it plays

Only while the Cockpit shows **Office** and the arcterm window has focus. Cards, every other surface, and a window in
the background stay silent; in the background the OS toast speaks as it does today, so nothing sounds twice. When the
office unmounts every sound stops and its `AudioContext` closes.

All tunes are original, written for arcterm in the style of a GBA soundtrack (two square channels, a triangle, a noise
channel). None is taken from Pokémon or any other game.

## The cues

| Cue | When | Sound |
|---|---|---|
| `landed` | a run lands on its base | a fanfare of about 2 s, an "item get" |
| `taskDone` | a task of a run turns `done` | a two-note ting |
| `needsYou` | an agent starts asking, a lead or a task asks, a new Needs you row appears | a "!" like a trainer spotting you |
| `setback` | a task turns `review-failed`, `verify-failed` or `failed`; a Needs you row of kind `run-land-held` or `run-unverified` appears | two low notes going down, soft |
| `step`, `bump`, `blip` | the boss takes a step, walks into a wall, opens a card or the office menu | a short noise or square tick |

**Against noise:**

- The first snapshot after the office mounts is a baseline: opening Office makes no sound, only what changes after.
- A burst gives one cue: several events at once (five tasks done in a second) play the one ranked highest,
  `needsYou` > `setback` > `landed` > `taskDone`.
- Event jingles keep at least 1.5 s apart; a cue that falls inside the gap is dropped, not queued. The boss's sounds
  are not held to it; steps follow the walk's pace.

## Music

Two loops: one for work hours, one for after hours and weekends, chosen by `officeHoursAtom` as the office's day and
night are. While a jingle plays the music ducks and comes back after. Losing focus pauses the music; focus resumes it.

## Controls

| Setting | Key | Default |
|---|---|---|
| Event jingles | `cockpit.office.sound.events` | on |
| Boss sounds (steps, bump, blip) | `cockpit.office.sound.ui` | off: steps all day wear thin |
| Music | `cockpit.office.sound.music` | off |
| Volume, 0–1, shared | `cockpit.office.sound.volume` | 0.5 |

All four are in Settings → Appearance → Office; the volume is a pick of 25, 50, 75 or 100 %. In the office, `s`
mutes and unmutes all of it at once (Cockpit binding `cockpit:office-sound`, documented in
`docs/keyboard-shortcuts.md`), and so does the office menu's (`m`) item **Mute sound** / **Sound on**, which names
`s`. The mute is a fifth stored choice, `cockpit.office.sound.muted`, off by default, so the three switches keep
their values under it.

## Architecture

Pure logic with a test beside it, consumed by thin wiring, as everywhere in `frontend/app/view/agents/`.

- **`officesoundcues.ts`** (pure). `cueSnapshot(agents, runs, boardRows)` reduces what the office draws to what can
  sound: each agent's state, each run's `landed` and `leadAsking`, each task's state and `asking`, and the Needs you
  row keys with their kinds. `diffCues(prev, next)` turns two snapshots into cues by the table above; with no `prev`
  it returns none. `pickCue(cues, lastAt, now)` applies the ranking and the 1.5 s gap.
- **`PlanRun.landed`** (new field, `officeplanmodel.ts`), set in `officeinputs.ts` from the run's
  `land.state === "landed"`. `done` cannot stand in for it: `runFinished` counts a cancelled run as done.
- **`officescores.ts`** (pure). Each cue and each loop as note data:
  `{ ch: "sq1" | "sq2" | "tri" | "noise", note, start, dur, vol, duty? }`, times in beats with a tempo per score.
- **`officeaudio.ts`**, the player. One `AudioContext`, made on the first sound the person's own action allows
  (browsers block audio before a gesture); a short-lived `OscillatorNode` per note; one shared 1 s noise
  `AudioBuffer`; a master `GainNode` for the volume and a music `GainNode` for the duck; `close()` on unmount.
- **`officesound.tsx`**, renders nothing, mounted inside `CockpitOffice`. It keeps the previous snapshot, plays what
  `pickCue` returns, follows the window's focus, and switches the loop with `officeHoursAtom`.
- **Boss sounds** are called where the boss moves in `cockpitoffice.tsx`: a `step` every 24 px the arrows walk it (a
  click's jump across the floor is silent), one `bump` when an arrow's step goes nowhere (`stepToward` returns where
  the boss stands) until it moves or the arrow is let go, and a `blip` when the dialog box, the full card or the
  office menu opens.
- **Stored choices** in `officestore.ts`, `atomWithStorage` with a reader that turns anything unexpected into the
  default, as the existing office choices do.

## Cost

With Office off nothing of this exists: no `AudioContext`, no node. Jingles make a handful of nodes that end with
their notes. Music playing is expected at 1–3 MB and next to no CPU; the measured figure goes into the RAM watch of
`docs/open-issues.md` and into the office's line of the RAM panel.

## Testing

- **vitest:** `officesoundcues.test.ts` (the first snapshot is silent; each transition gives its cue; a cancelled run
  gives no `landed`; five tasks done at once give one cue; `needsYou` beats `setback`; the gap holds);
  `officescores.test.ts` (notes valid, every jingle at most 2.5 s, each loop closes on a whole bar);
  `officestore.test.ts` (defaults and garbage for the five new keys).
- **CDP:** a scenario `office-sound` in `scripts/cdp/cockpitofficescenarios.mjs`, beside `cockpit-office-controls`.
  It swaps the player for a log through `cockpitofficedevhooks.ts` (no real sound), injects a fixture, turns a task
  done and asserts `taskDone` in the log, presses `s` and asserts nothing more is logged, then shoots the office menu
  with its Sound item and Settings → Office with the four new rows.
- **RAM:** WebAudio's buffers live outside the JS heap the bench reads, so the figure is taken by hand: arcterm's
  WebView2 processes in Task Manager with Office open, music off and then on for a minute.
- **Hand check** (`docs/open-issues.md`, "0 · Waiting on a hand check"): listen in the real app. Are the jingles
  pleasant, is the default volume right, does the music duck under a jingle, does losing focus silence it.

## Changelog

Under `Added`: "Office sounds: chiptune jingles when a task finishes, a run lands or someone needs you, with optional
footsteps and day and night music (`s` mutes)." ending with `<!-- try: cockpit:office -->`.

## Out of scope

- Sound on Cards or any other surface, and sound while the window is in the background.
- The coin sound: part 2 adds it.
- Choosing or importing tracks.
