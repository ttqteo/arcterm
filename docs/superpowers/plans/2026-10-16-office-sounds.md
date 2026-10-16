# Office sounds implementation plan

**Verify:** `node scripts/verify.mjs ./pkg/wconfig`

**Check:** `node --stack-size=4000 node_modules/typescript/lib/tsc.js --noEmit`

**Final:** `node scripts/cdp/final-verify.mjs office-sound surface-smoke`

**Goal:** the Cockpit's Office plays original GBA-style chiptune jingles when a task finishes, a run lands, something
needs the person or a task fails, with optional boss sounds and day/night music, all synthesized with WebAudio from
note data, only while Office is in view and the window has focus.

**Spec:** `docs/superpowers/specs/2026-10-16-office-sounds-design.md`. Read it first; this plan does not repeat its
reasons.

**Architecture:** four new files in `frontend/app/view/agents/`: `officescores.ts` (pure: the note data),
`officesoundcues.ts` (pure: what changed, which cue, whether sound is allowed), `officeaudio.ts` (the WebAudio player
and a DEV log sink), `officesound.tsx` (renders nothing; wires the office's data to the player). The settings live in
`officestore.ts` beside the office's other choices. No Go, no wshrpc, no `task generate`.

**Before you start:** this plan runs after the Office Floors and Office Pet Boss runs, which rewrite much of
`cockpitoffice.tsx`. Find code by the names given here (`stepAll`, `walk`, `release`, `toggleMenu`,
`officeMenuItems`, `CockpitOfficeProps`), never by line number. If a signature named here has grown since, add to it
the same way.

**Tech:** TypeScript, React 19, jotai (`atomWithStorage`, `globalStore`), Web Audio API, vitest, CDP scenarios.

---

### Task 1: The sound settings

**Depends on:** none

**Files:** `frontend/app/view/agents/officestore.ts`, `frontend/app/view/agents/officestore.test.ts`

**Step 1: Write the failing tests** in `officestore.test.ts`, inside the existing `describe("officestore")`:

```ts
it("reads a sound switch back as its default unless it is a boolean", () => {
    expect(soundSwitch(true, false)).toBe(true);
    expect(soundSwitch(false, true)).toBe(false);
    expect(soundSwitch("on", true)).toBe(true);
    expect(soundSwitch(undefined, false)).toBe(false);
});

it("keeps the volume to one of its four steps, else the default", () => {
    expect(soundVolume(0.25)).toBe(0.25);
    expect(soundVolume(1)).toBe(1);
    expect(soundVolume(0.3)).toBe(DEFAULT_SOUND.volume);
    expect(soundVolume("1")).toBe(DEFAULT_SOUND.volume);
    expect(soundVolume(undefined)).toBe(0.5);
});

it("has jingles on and the rest off by default", () => {
    expect(DEFAULT_SOUND).toEqual({ events: true, ui: false, music: false, volume: 0.5, muted: false });
});
```

Add `DEFAULT_SOUND, soundSwitch, soundVolume` to the import.

**Step 2:** Run `npx vitest run frontend/app/view/agents/officestore.test.ts`. Expected: FAIL, the names are not exported.

**Step 3: Implement** in `officestore.ts`, after `officeAnimationAtom`. Add `import { globalStore } from "@/app/store/jotaiStore";`.

```ts
// the office's sound (office sounds spec, "Controls"): jingles on, the boss's sounds and the music off, a shared
// volume, and a mute over all of it that leaves the three switches as they were
export const DEFAULT_SOUND = { events: true, ui: false, music: false, volume: 0.5, muted: false } as const;
export const SOUND_VOLUMES: readonly number[] = [0.25, 0.5, 0.75, 1];

const soundAtom = <T>(key: string, init: T) =>
    atomWithStorage<T>(`cockpit.office.sound.${key}`, init, undefined, { getOnInit: true }) as PrimitiveAtom<T>;
export const officeSoundEventsAtom = soundAtom<boolean>("events", DEFAULT_SOUND.events);
export const officeSoundUiAtom = soundAtom<boolean>("ui", DEFAULT_SOUND.ui);
export const officeSoundMusicAtom = soundAtom<boolean>("music", DEFAULT_SOUND.music);
export const officeSoundVolumeAtom = soundAtom<number>("volume", DEFAULT_SOUND.volume);
export const officeSoundMutedAtom = soundAtom<boolean>("muted", DEFAULT_SOUND.muted);

export function soundSwitch(v: unknown, dflt: boolean): boolean {
    return typeof v === "boolean" ? v : dflt;
}

export function soundVolume(v: unknown): number {
    return typeof v === "number" && SOUND_VOLUMES.includes(v) ? v : DEFAULT_SOUND.volume;
}

// s in the office and the office menu's Mute sound / Sound on
export function toggleOfficeMute(): void {
    globalStore.set(officeSoundMutedAtom, !soundSwitch(globalStore.get(officeSoundMutedAtom), DEFAULT_SOUND.muted));
}
```

**Step 4:** Run the test file again. Expected: PASS.

**Step 5:** Commit: `git commit -m "feat(office): the office's sound settings, jingles on and the rest off" -- frontend/app/view/agents/officestore.ts frontend/app/view/agents/officestore.test.ts`

---

### Task 2: The scores

**Depends on:** none

**Files:** `frontend/app/view/agents/officescores.ts`, `frontend/app/view/agents/officescores.test.ts`

The tunes are original. Do not copy a melody from Pokémon or any other game.

**Step 1: Write the failing tests** in `officescores.test.ts`:

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { CUE_IDS, freqOf, line, SCORES, scoreSeconds, TRACKS, UI_CUES } from "./officescores";

describe("officescores", () => {
    it("turns a note name into its frequency", () => {
        expect(freqOf("A4")).toBe(440);
        expect(freqOf("C4")).toBeCloseTo(261.63, 1);
        expect(freqOf("A#4")).toBeCloseTo(466.16, 1);
        expect(() => freqOf("H4")).toThrow();
    });

    it("reads a line of name/length tokens, rests leaving a gap", () => {
        const notes = line("sq1", "C5/2 r/1 E5/1", { vol: 0.5 });
        expect(notes.map((n) => [n.at, n.len])).toEqual([
            [0, 2],
            [3, 1],
        ]);
        expect(notes[0]).toMatchObject({ ch: "sq1", vol: 0.5, duty: 0.5 });
        expect(line("noise", "N/1")[0].freq).toBe(0);
    });

    it("keeps every jingle short and every note sound", () => {
        for (const id of [...CUE_IDS, ...UI_CUES]) {
            const s = SCORES[id];
            expect(s.loop).toBe(false);
            expect(scoreSeconds(s)).toBeLessThanOrEqual(2.5);
            for (const n of s.notes) {
                expect(n.len).toBeGreaterThan(0);
                expect(n.ch === "noise" ? n.freq === 0 : n.freq > 20).toBe(true);
            }
        }
    });

    it("closes every loop on a whole bar, each channel filling it", () => {
        for (const id of TRACKS) {
            const s = SCORES[id];
            expect(s.loop).toBe(true);
            expect(s.length % 16).toBe(0);
            for (const ch of new Set(s.notes.map((n) => n.ch))) {
                const end = Math.max(...s.notes.filter((n) => n.ch === ch).map((n) => n.at + n.len));
                expect(end).toBe(s.length);
            }
        }
    });
});
```

**Step 2:** Run `npx vitest run frontend/app/view/agents/officescores.test.ts`. Expected: FAIL, the module does not exist.

**Step 3: Implement** `officescores.ts`:

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The office's tunes as note data (office sounds spec, "The cues", "Music"): two pulse channels, a triangle and a
// noise channel, as a GBA plays them. Times are in sixteenth notes; a score's bpm sets how long one is. Original tunes
// written for arcterm. Pure.

export type Channel = "sq1" | "sq2" | "tri" | "noise";
export type Duty = 0.125 | 0.25 | 0.5;
export interface Note {
    ch: Channel;
    at: number;
    len: number;
    // Hz; 0 on the noise channel
    freq: number;
    vol: number;
    duty: Duty;
}
export interface Score {
    bpm: number;
    loop: boolean;
    // in sixteenths: where the last channel ends
    length: number;
    notes: Note[];
}

export const CUE_IDS = ["landed", "taskDone", "needsYou", "setback"] as const;
export const UI_CUES = ["step", "bump", "blip"] as const;
export const TRACKS = ["day", "night"] as const;
export type CueId = (typeof CUE_IDS)[number];
export type UiCue = (typeof UI_CUES)[number];
export type Track = (typeof TRACKS)[number];

const SEMITONE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export function freqOf(name: string): number {
    const m = /^([A-G])(#?)(\d)$/.exec(name);
    if (!m) {
        throw new Error(`not a note: ${name}`);
    }
    const midi = 12 * (Number(m[3]) + 1) + SEMITONE[m[1]] + (m[2] ? 1 : 0);
    return 440 * 2 ** ((midi - 69) / 12);
}

// "C5/2 r/1 N/1": a note, a rest, a noise hit, each with its length in sixteenths
export function line(ch: Channel, text: string, o: { vol?: number; duty?: Duty } = {}): Note[] {
    const notes: Note[] = [];
    let at = 0;
    for (const tok of text.trim().split(/\s+/)) {
        const [name, lenText] = tok.split("/");
        const len = Number(lenText);
        if (name !== "r") {
            notes.push({
                ch,
                at,
                len,
                freq: name === "N" ? 0 : freqOf(name),
                vol: o.vol ?? 0.5,
                duty: o.duty ?? 0.5,
            });
        }
        at += len;
    }
    return notes;
}

function score(bpm: number, loop: boolean, ...lines: Note[][]): Score {
    const notes = lines.flat();
    return { bpm, loop, notes, length: Math.max(...notes.map((n) => n.at + n.len)) };
}

export function sixteenthSec(bpm: number): number {
    return 60 / bpm / 4;
}

export function scoreSeconds(s: Score): number {
    return s.length * sixteenthSec(s.bpm);
}

export const SCORES: Record<CueId | UiCue | Track, Score> = {
    // an item got: three quick Cs, up to G, and home an octave higher
    landed: score(
        140,
        false,
        line("sq1", "C5/2 C5/1 C5/1 G5/4 E5/2 G5/2 C6/8", { vol: 0.5, duty: 0.5 }),
        line("sq2", "E4/2 E4/1 E4/1 B4/4 G4/2 B4/2 E5/8", { vol: 0.3, duty: 0.25 }),
        line("tri", "C3/4 G2/4 C3/4 C3/8", { vol: 0.6 })
    ),
    taskDone: score(150, false, line("sq1", "E6/1 B6/3", { vol: 0.35, duty: 0.25 })),
    // a trainer spots you: a rising "!"
    needsYou: score(160, false, line("sq1", "G5/1 D6/1 G6/4", { vol: 0.45, duty: 0.125 })),
    setback: score(
        120,
        false,
        line("sq1", "E4/3 r/1 C4/6", { vol: 0.3, duty: 0.5 }),
        line("tri", "A2/4 F2/6", { vol: 0.5 })
    ),
    step: score(240, false, line("noise", "N/1", { vol: 0.12 })),
    bump: score(240, false, line("sq1", "C3/2", { vol: 0.3, duty: 0.5 })),
    blip: score(240, false, line("sq1", "A5/1 E6/1", { vol: 0.25, duty: 0.25 })),
    // work hours: C major, four bars, light hats
    day: score(
        112,
        true,
        line("sq1", "E5/2 G5/2 C6/4 B5/2 G5/2 E5/4 F5/2 A5/2 C6/2 A5/2 G5/8 E5/2 G5/2 C6/4 D6/2 C6/2 B5/4 A5/2 B5/2 G5/4 C6/8", {
            vol: 0.25,
            duty: 0.5,
        }),
        line("sq2", "C5/4 E5/4 G5/4 E5/4 C5/4 F5/4 A5/4 F5/4 C5/4 E5/4 B4/4 D5/4 B4/4 D5/4 C5/8", { vol: 0.12, duty: 0.25 }),
        line("tri", "C3/4 G3/4 C3/4 G3/4 F2/4 C3/4 F2/4 C3/4 C3/4 G3/4 G2/4 D3/4 G2/4 B2/4 C3/8", { vol: 0.4 }),
        line("noise", Array(16).fill("r/3 N/1").join(" "), { vol: 0.05 })
    ),
    // after hours: A minor, slower, no drums
    night: score(
        84,
        true,
        line("sq1", "A4/4 C5/4 E5/8 D5/4 C5/4 B4/8 A4/4 C5/4 E5/4 G5/4 F5/4 E5/4 A4/8", { vol: 0.2, duty: 0.5 }),
        line("tri", "A2/16 D3/8 G2/8 A2/8 C3/8 F2/8 A2/8", { vol: 0.35 })
    ),
};
```

**Step 4:** Run the test file. Expected: PASS. If the loop test fails, a line's lengths do not add up to 64: fix the
line, not the test.

**Step 5:** Commit: `git commit -m "feat(office): the office's chiptune scores as note data" -- frontend/app/view/agents/officescores.ts frontend/app/view/agents/officescores.test.ts`

---

### Task 3: Which cue, and whether sound is allowed

**Depends on:** Task 2

**Files:** `frontend/app/view/agents/officesoundcues.ts`, `frontend/app/view/agents/officesoundcues.test.ts`, `frontend/app/view/agents/officeplanmodel.ts`, `frontend/app/view/agents/officeinputs.ts`, `frontend/app/view/agents/officeinputs.test.ts`

**Step 1:** In `officeplanmodel.ts`, add to `PlanRun` after `done`:

```ts
    // landed on its base; done alone also counts a cancelled run (runFinished). Unset in fixtures: not landed
    landed?: boolean;
```

In `officeinputs.ts`, in the run object `officeInputs` pushes, after `done: runFinished(c.run),` add
`landed: c.run.land?.state === "landed",`. In `officeinputs.test.ts`, the expectation of the test "turns a run card
into its tasks…" gains `landed: false,` after `done: false,`.

**Step 2: Write the failing tests** in `officesoundcues.test.ts`:

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { PlanAgent, PlanRun } from "./officeplanmodel";
import { CUE_GAP_MS, cueSnapshot, diffCues, pickCue, soundGate, stepSound, STEP_SOUND_PX } from "./officesoundcues";

const agent = (id: string, state: PlanAgent["state"] = "working"): PlanAgent => ({ id, name: id, state, finished: false });
const run = (id: string, states: string[], o: Partial<PlanRun> = {}): PlanRun => ({
    id,
    title: id,
    done: false,
    leadAsking: false,
    tasks: states.map((state, i) => ({ id: `t${i + 1}`, label: `t${i + 1}`, state, asking: false })),
    ...o,
});
const snap = (agents: PlanAgent[], runs: PlanRun[], board: { key: string; kind: string }[] = []) =>
    cueSnapshot(agents, runs, board);

describe("diffCues", () => {
    it("is silent on the first snapshot", () => {
        expect(diffCues(null, snap([agent("a", "asking")], [run("r", ["done"], { landed: true })]))).toEqual([]);
    });

    it("gives taskDone when a task turns done, setback when one fails", () => {
        const a = snap([], [run("r", ["running", "running"])]);
        expect(diffCues(a, snap([], [run("r", ["done", "running"])]))).toEqual(["taskDone"]);
        expect(diffCues(a, snap([], [run("r", ["running", "review-failed"])]))).toEqual(["setback"]);
    });

    it("gives landed when a known run lands, never for a cancelled run", () => {
        const a = snap([], [run("r", ["done"])]);
        expect(diffCues(a, snap([], [run("r", ["done"], { done: true, landed: true })]))).toEqual(["landed"]);
        expect(diffCues(a, snap([], [run("r", ["done"], { done: true })]))).toEqual([]);
    });

    it("gives needsYou when an agent, a lead or a task starts asking", () => {
        const a = snap([agent("a")], [run("r", ["running"])]);
        expect(diffCues(a, snap([agent("a", "asking")], [run("r", ["running"])]))).toEqual(["needsYou"]);
        expect(diffCues(a, snap([agent("a")], [run("r", ["running"], { leadAsking: true })]))).toEqual(["needsYou"]);
        const asking = run("r", ["running"]);
        asking.tasks[0].asking = true;
        expect(diffCues(a, snap([agent("a")], [asking]))).toEqual(["needsYou"]);
    });

    it("sorts a new Needs you row by its kind", () => {
        const a = snap([], []);
        expect(diffCues(a, snap([], [], [{ key: "k1", kind: "plan-review" }]))).toEqual(["needsYou"]);
        expect(diffCues(a, snap([], [], [{ key: "k2", kind: "run-land-held" }]))).toEqual(["setback"]);
        expect(diffCues(a, snap([], [], [{ key: "k3", kind: "run-unverified" }]))).toEqual(["setback"]);
    });

    it("says nothing for what only came into view", () => {
        const a = snap([], []);
        expect(diffCues(a, snap([agent("a", "asking")], [run("r", ["done"], { landed: true })]))).toEqual([]);
    });
});

describe("pickCue", () => {
    it("plays the highest ranked of a burst, once", () => {
        expect(pickCue(["taskDone", "landed", "setback"], null, 0)).toBe("setback");
        expect(pickCue(["taskDone", "needsYou"], null, 0)).toBe("needsYou");
        expect(pickCue([], null, 0)).toBeNull();
    });

    it("drops a cue inside the gap", () => {
        expect(pickCue(["taskDone"], 1000, 1000 + CUE_GAP_MS - 1)).toBeNull();
        expect(pickCue(["taskDone"], 1000, 1000 + CUE_GAP_MS)).toBe("taskDone");
    });
});

describe("soundGate", () => {
    const s = { events: true, ui: true, music: true, volume: 0.5, muted: false };
    it("lets each kind through by its switch while focused and not muted", () => {
        expect(soundGate(s, true)).toEqual({ events: true, ui: true, music: true, volume: 0.5 });
        expect(soundGate({ ...s, ui: false }, true).ui).toBe(false);
    });
    it("silences everything unfocused or muted", () => {
        expect(soundGate(s, false)).toMatchObject({ events: false, ui: false, music: false });
        expect(soundGate({ ...s, muted: true }, true)).toMatchObject({ events: false, ui: false, music: false });
    });
});

describe("stepSound", () => {
    it("ticks once per STEP_SOUND_PX walked", () => {
        expect(stepSound(0, STEP_SOUND_PX - 3)).toEqual({ acc: STEP_SOUND_PX - 3, play: false });
        expect(stepSound(STEP_SOUND_PX - 3, 6)).toEqual({ acc: 3, play: true });
    });
});
```

**Step 3:** Run `npx vitest run frontend/app/view/agents/officesoundcues.test.ts`. Expected: FAIL, the module does not exist.

**Step 4: Implement** `officesoundcues.ts`:

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What the office's sound says (office sounds spec, "The cues", "Against noise"): cueSnapshot keeps what can sound of
// what the office draws, diffCues turns two snapshots into cues (none from the first, none for what only came into
// view), pickCue plays one of a burst and keeps the gap, soundGate says what may play. Pure.

import type { PlanAgent, PlanRun } from "./officeplanmodel";
import type { CueId } from "./officescores";

export interface BoardCue {
    key: string;
    // the attention kind (StripRow.run.wireKind)
    kind: string;
}

export interface CueSnapshot {
    agents: Set<string>;
    asking: Set<string>;
    runs: Set<string>;
    landed: Set<string>;
    leadAsking: Set<string>;
    // `${run}/${task}` to its state
    tasks: Map<string, string>;
    taskAsking: Set<string>;
    board: Map<string, string>;
}

const FAILED = new Set(["review-failed", "verify-failed", "failed"]);
const SETBACK_KINDS = new Set(["run-land-held", "run-unverified"]);
export const CUE_RANK: readonly CueId[] = ["needsYou", "setback", "landed", "taskDone"];
export const CUE_GAP_MS = 1500;
export const STEP_SOUND_PX = 24;

export function cueSnapshot(agents: readonly PlanAgent[], runs: readonly PlanRun[], board: readonly BoardCue[]): CueSnapshot {
    const s: CueSnapshot = {
        agents: new Set(agents.map((a) => a.id)),
        asking: new Set(agents.filter((a) => a.state === "asking").map((a) => a.id)),
        runs: new Set(runs.map((r) => r.id)),
        landed: new Set(runs.filter((r) => r.landed).map((r) => r.id)),
        leadAsking: new Set(runs.filter((r) => r.leadAsking).map((r) => r.id)),
        tasks: new Map(),
        taskAsking: new Set(),
        board: new Map(board.map((b) => [b.key, b.kind])),
    };
    for (const r of runs) {
        for (const t of r.tasks) {
            const k = `${r.id}/${t.id}`;
            s.tasks.set(k, t.state);
            if (t.asking) {
                s.taskAsking.add(k);
            }
        }
    }
    return s;
}

const fresh = (next: Set<string>, prev: Set<string>, known: (id: string) => boolean) =>
    [...next].some((id) => !prev.has(id) && known(id));

export function diffCues(prev: CueSnapshot | null, next: CueSnapshot): CueId[] {
    if (!prev) {
        return [];
    }
    const out = new Set<CueId>();
    const runOf = (k: string) => k.slice(0, k.lastIndexOf("/"));
    if (
        fresh(next.asking, prev.asking, (id) => prev.agents.has(id)) ||
        fresh(next.leadAsking, prev.leadAsking, (id) => prev.runs.has(id)) ||
        fresh(next.taskAsking, prev.taskAsking, (k) => prev.tasks.has(k) || prev.runs.has(runOf(k)))
    ) {
        out.add("needsYou");
    }
    for (const [key, kind] of next.board) {
        if (!prev.board.has(key)) {
            out.add(SETBACK_KINDS.has(kind) ? "setback" : "needsYou");
        }
    }
    for (const [k, state] of next.tasks) {
        const before = prev.tasks.get(k);
        if (before === undefined || before === state) {
            continue;
        }
        if (state === "done") {
            out.add("taskDone");
        } else if (FAILED.has(state) && !FAILED.has(before)) {
            out.add("setback");
        }
    }
    if (fresh(next.landed, prev.landed, (id) => prev.runs.has(id))) {
        out.add("landed");
    }
    return CUE_RANK.filter((c) => out.has(c));
}

export function pickCue(cues: readonly CueId[], lastAt: number | null, now: number): CueId | null {
    if (cues.length === 0 || (lastAt != null && now - lastAt < CUE_GAP_MS)) {
        return null;
    }
    return CUE_RANK.find((c) => cues.includes(c)) ?? null;
}

export interface SoundSettings {
    events: boolean;
    ui: boolean;
    music: boolean;
    volume: number;
    muted: boolean;
}
export interface SoundGate {
    events: boolean;
    ui: boolean;
    music: boolean;
    volume: number;
}

export function soundGate(s: SoundSettings, focused: boolean): SoundGate {
    const on = focused && !s.muted && s.volume > 0;
    return { events: on && s.events, ui: on && s.ui, music: on && s.music, volume: s.volume };
}

// a step sound every STEP_SOUND_PX the arrows walk the boss
export function stepSound(acc: number, movedPx: number): { acc: number; play: boolean } {
    const total = acc + movedPx;
    return total >= STEP_SOUND_PX ? { acc: total % STEP_SOUND_PX, play: true } : { acc: total, play: false };
}
```

Note `diffCues` returns cues in rank order, so the tests' single-cue expectations hold; a test that expects several
cues lists them in `CUE_RANK` order.

**Step 5:** Run `npx vitest run frontend/app/view/agents/officesoundcues.test.ts frontend/app/view/agents/officeinputs.test.ts frontend/app/view/agents/officeplanmodel.test.ts`. Expected: PASS.

**Step 6:** Commit: `git commit -m "feat(office): which sound a change in the office makes, and when sound may play" -- frontend/app/view/agents/officesoundcues.ts frontend/app/view/agents/officesoundcues.test.ts frontend/app/view/agents/officeplanmodel.ts frontend/app/view/agents/officeinputs.ts frontend/app/view/agents/officeinputs.test.ts`

---

### Task 4: The player

**Depends on:** Task 1, Task 3

**Files:** `frontend/app/view/agents/officeaudio.ts`, `frontend/app/view/agents/officeaudio.test.ts`

**Step 1: Write the failing tests** in `officeaudio.test.ts` (vitest runs without WebAudio, so the tests cover the pure
wave maths and the DEV log sink only; the sound itself is a hand check):

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it } from "vitest";
import { officeSink, officeSoundLog, pulseHarmonics, setOfficeSoundLog } from "./officeaudio";

describe("officeaudio", () => {
    afterEach(() => setOfficeSoundLog(false));

    it("draws a pulse wave's harmonics from its duty", () => {
        const half = pulseHarmonics(0.5, 4);
        expect(half.length).toBe(5);
        expect(half[0]).toBe(0);
        expect(half[1]).toBeCloseTo(2 / Math.PI, 5);
        expect(half[2]).toBeCloseTo(0, 5);
    });

    it("logs what it would play while the DEV log is on", () => {
        setOfficeSoundLog(true);
        officeSink().play("taskDone");
        officeSink().music("day");
        officeSink().music(null);
        expect(officeSoundLog()).toEqual(["taskDone", "music:day", "music:off"]);
        setOfficeSoundLog(false);
        expect(officeSoundLog()).toBeNull();
    });
});
```

**Step 2:** Run `npx vitest run frontend/app/view/agents/officeaudio.test.ts`. Expected: FAIL, the module does not exist.

**Step 3: Implement** `officeaudio.ts`:

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The office's sound player (office sounds spec, "Architecture"): one AudioContext made on the first sound, a short-
// lived oscillator per note (pulse waves from their harmonics, a triangle, a shared noise buffer), a master gain for
// the volume and a music bus that ducks under a jingle. With the office off nothing here exists. The DEV log sink
// stands in for it in the CDP scenarios (cockpitofficedevhooks.ts).

// no import of @/app/store/global here: officeaudio.test.ts loads this module under vitest
import { globalStore } from "@/app/store/jotaiStore";
import { CUE_IDS, SCORES, scoreSeconds, sixteenthSec, type CueId, type Duty, type Score, type Track, type UiCue } from "./officescores";
import { soundGate, type SoundGate } from "./officesoundcues";
import {
    DEFAULT_SOUND,
    officeSoundEventsAtom,
    officeSoundMusicAtom,
    officeSoundMutedAtom,
    officeSoundUiAtom,
    officeSoundVolumeAtom,
    soundSwitch,
    soundVolume,
} from "./officestore";

// volume 1 is this share of full scale: pulse waves are loud
const MASTER = 0.4;
// the music under a jingle
const DUCK = 0.3;
// how early the next loop of the music is scheduled
const LOOKAHEAD_S = 0.25;
// the release at a note's end, so it does not click
const RELEASE_S = 0.03;
const HARMONICS = 32;
const DUCKING: ReadonlySet<string> = new Set<string>(CUE_IDS);

export interface OfficeSink {
    play(id: CueId | UiCue): void;
    music(track: Track | null): void;
    volume(v: number): void;
    close(): void;
}

/** Pure: the cosine terms of a pulse wave of this duty, index 0 the (unused) DC term. */
export function pulseHarmonics(duty: number, n = HARMONICS): Float32Array {
    const real = new Float32Array(n + 1);
    for (let k = 1; k <= n; k++) {
        real[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty);
    }
    return real;
}

class ChipPlayer implements OfficeSink {
    private ctx: AudioContext | null = null;
    private master: GainNode | null = null;
    private musicBus: GainNode | null = null;
    private track: Track | null = null;
    private timer: ReturnType<typeof setTimeout> | null = null;
    private waves = new Map<Duty, PeriodicWave>();
    private noise: AudioBuffer | null = null;
    private vol: number = DEFAULT_SOUND.volume;

    private context(): AudioContext {
        if (!this.ctx) {
            this.ctx = new AudioContext();
            this.master = this.ctx.createGain();
            this.master.gain.value = this.vol * MASTER;
            this.master.connect(this.ctx.destination);
        }
        if (this.ctx.state === "suspended") {
            // a context made before the person's first key or click starts suspended; it resumes on the next sound
            void this.ctx.resume().catch(() => {});
        }
        return this.ctx;
    }

    private wave(ctx: AudioContext, duty: Duty): PeriodicWave {
        let w = this.waves.get(duty);
        if (!w) {
            const real = pulseHarmonics(duty);
            w = ctx.createPeriodicWave(real, new Float32Array(real.length));
            this.waves.set(duty, w);
        }
        return w;
    }

    private noiseBuffer(ctx: AudioContext): AudioBuffer {
        if (!this.noise) {
            this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
            const data = this.noise.getChannelData(0);
            for (let i = 0; i < data.length; i++) {
                data[i] = Math.random() * 2 - 1;
            }
        }
        return this.noise;
    }

    private schedule(ctx: AudioContext, score: Score, t0: number, out: AudioNode): void {
        const s16 = sixteenthSec(score.bpm);
        for (const n of score.notes) {
            const start = t0 + n.at * s16;
            const end = start + n.len * s16;
            const g = ctx.createGain();
            g.gain.setValueAtTime(n.vol, start);
            g.gain.setValueAtTime(n.vol, Math.max(start, end - RELEASE_S));
            g.gain.linearRampToValueAtTime(0, end);
            g.connect(out);
            let src: AudioScheduledSourceNode;
            if (n.ch === "noise") {
                const b = ctx.createBufferSource();
                b.buffer = this.noiseBuffer(ctx);
                b.loop = true;
                src = b;
            } else {
                const o = ctx.createOscillator();
                o.frequency.value = n.freq;
                if (n.ch === "tri") {
                    o.type = "triangle";
                } else {
                    o.setPeriodicWave(this.wave(ctx, n.duty));
                }
                src = o;
            }
            src.connect(g);
            src.onended = () => {
                src.disconnect();
                g.disconnect();
            };
            src.start(start);
            src.stop(end);
        }
    }

    play(id: CueId | UiCue): void {
        const ctx = this.context();
        const score = SCORES[id];
        const t = ctx.currentTime;
        this.schedule(ctx, score, t + 0.02, this.master!);
        if (this.musicBus && DUCKING.has(id)) {
            const g = this.musicBus.gain;
            const back = t + scoreSeconds(score);
            g.cancelScheduledValues(t);
            g.setValueAtTime(g.value, t);
            g.linearRampToValueAtTime(DUCK, t + 0.05);
            g.setValueAtTime(DUCK, back);
            g.linearRampToValueAtTime(1, back + 0.3);
        }
    }

    music(track: Track | null): void {
        if (track === this.track) {
            return;
        }
        this.stopMusic();
        if (!track) {
            return;
        }
        this.track = track;
        const ctx = this.context();
        const bus = ctx.createGain();
        bus.connect(this.master!);
        this.musicBus = bus;
        const score = SCORES[track];
        const len = scoreSeconds(score);
        let t0 = ctx.currentTime + 0.05;
        const loop = () => {
            if (this.musicBus !== bus) {
                return;
            }
            this.schedule(ctx, score, t0, bus);
            t0 += len;
            this.timer = setTimeout(loop, Math.max(0, (t0 - ctx.currentTime - LOOKAHEAD_S) * 1000));
        };
        loop();
    }

    private stopMusic(): void {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        // the notes already scheduled on the bus play on into nothing and end
        this.musicBus?.disconnect();
        this.musicBus = null;
        this.track = null;
    }

    volume(v: number): void {
        this.vol = v;
        if (this.ctx && this.master) {
            this.master.gain.setTargetAtTime(v * MASTER, this.ctx.currentTime, 0.05);
        }
    }

    close(): void {
        this.stopMusic();
        void this.ctx?.close().catch(() => {});
        this.ctx = null;
        this.master = null;
        this.waves.clear();
        this.noise = null;
    }
}

class LogSink implements OfficeSink {
    constructor(readonly log: string[]) {}
    play(id: CueId | UiCue): void {
        this.log.push(id);
    }
    music(track: Track | null): void {
        this.log.push(`music:${track ?? "off"}`);
    }
    volume(): void {}
    close(): void {}
}

let player: ChipPlayer | null = null;
let devLog: LogSink | null = null;

export function officeSink(): OfficeSink {
    if (devLog) {
        return devLog;
    }
    player ??= new ChipPlayer();
    return player;
}

// the office unmounts: its AudioContext closes
export function closeOfficeSink(): void {
    player?.close();
    player = null;
}

// DEV: log what would play instead of playing it (the office-sound scenario); a fresh log each time it turns on
export function setOfficeSoundLog(on: boolean): void {
    devLog = on ? new LogSink([]) : null;
}

export function officeSoundLog(): string[] | null {
    return devLog ? [...devLog.log] : null;
}

// the DEV log counts as focus: the scenario's window is not always the focused one
export function soundLogging(): boolean {
    return devLog != null;
}

// read at the moment of a boss sound; officesound.tsx reads the same through hooks
export function readSoundGate(): SoundGate {
    return soundGate(
        {
            events: soundSwitch(globalStore.get(officeSoundEventsAtom), DEFAULT_SOUND.events),
            ui: soundSwitch(globalStore.get(officeSoundUiAtom), DEFAULT_SOUND.ui),
            music: soundSwitch(globalStore.get(officeSoundMusicAtom), DEFAULT_SOUND.music),
            volume: soundVolume(globalStore.get(officeSoundVolumeAtom)),
            muted: soundSwitch(globalStore.get(officeSoundMutedAtom), DEFAULT_SOUND.muted),
        },
        soundLogging() || (typeof document !== "undefined" && document.hasFocus())
    );
}

// the boss's sounds, called from cockpitoffice.tsx where it moves
export function playOfficeUi(id: UiCue): void {
    if (readSoundGate().ui) {
        officeSink().play(id);
    }
}
```

**Step 4:** Run the test file. Expected: PASS. Then run the Check command (`node --stack-size=4000 node_modules/typescript/lib/tsc.js --noEmit`, ~2 min); it must exit 0.

**Step 5:** Commit: `git commit -m "feat(office): a WebAudio chiptune player for the office, and a DEV log in its place" -- frontend/app/view/agents/officeaudio.ts frontend/app/view/agents/officeaudio.test.ts`

---

### Task 5: Sound in the office

**Depends on:** Task 4

**Files:** `frontend/app/view/agents/officesound.tsx`, `frontend/app/view/agents/cockpitoffice.tsx`, `frontend/app/view/agents/cockpitsurface.tsx`

**Step 1:** Create `officesound.tsx`:

```tsx
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The office's sound (office sounds spec): mounted inside CockpitOffice, it draws nothing. Each change to what the
// office draws becomes at most one jingle (officesoundcues.ts); the music follows its switch and day or night; the
// office unmounting stops it all and closes the AudioContext.

import { atoms } from "@/app/store/global";
import { useAtomValue } from "jotai";
import { useEffect, useRef } from "react";
import { closeOfficeSink, officeSink, soundLogging } from "./officeaudio";
import type { PlanAgent, PlanRun } from "./officeplanmodel";
import { cueSnapshot, diffCues, pickCue, soundGate, type BoardCue, type CueSnapshot, type SoundGate } from "./officesoundcues";
import {
    DEFAULT_SOUND,
    officeSoundEventsAtom,
    officeSoundMusicAtom,
    officeSoundMutedAtom,
    officeSoundUiAtom,
    officeSoundVolumeAtom,
    soundSwitch,
    soundVolume,
} from "./officestore";

function useSoundGate(): SoundGate {
    const events = soundSwitch(useAtomValue(officeSoundEventsAtom), DEFAULT_SOUND.events);
    const ui = soundSwitch(useAtomValue(officeSoundUiAtom), DEFAULT_SOUND.ui);
    const music = soundSwitch(useAtomValue(officeSoundMusicAtom), DEFAULT_SOUND.music);
    const volume = soundVolume(useAtomValue(officeSoundVolumeAtom));
    const muted = soundSwitch(useAtomValue(officeSoundMutedAtom), DEFAULT_SOUND.muted);
    const focused = useAtomValue(atoms.documentHasFocus);
    return soundGate({ events, ui, music, volume, muted }, focused || soundLogging());
}

export function OfficeSound(props: { agents: PlanAgent[]; runs: PlanRun[]; board: BoardCue[]; night: boolean }) {
    const { agents, runs, board, night } = props;
    const gate = useSoundGate();
    const gateRef = useRef(gate);
    gateRef.current = gate;
    const prev = useRef<CueSnapshot | null>(null);
    const lastAt = useRef<number | null>(null);

    // the snapshot moves on even while jingles are off, so turning them on later plays no backlog
    useEffect(() => {
        const next = cueSnapshot(agents, runs, board);
        const cues = diffCues(prev.current, next);
        prev.current = next;
        if (!gateRef.current.events) {
            return;
        }
        const now = Date.now();
        const cue = pickCue(cues, lastAt.current, now);
        if (cue) {
            lastAt.current = now;
            officeSink().play(cue);
        }
    }, [agents, runs, board]);

    useEffect(() => {
        officeSink().volume(gate.volume);
    }, [gate.volume]);

    // unfocused, muted or switched off, the music stops; back on, its loop starts again
    useEffect(() => {
        officeSink().music(gate.music ? (night ? "night" : "day") : null);
    }, [gate.music, night]);

    useEffect(
        () => () => {
            officeSink().music(null);
            closeOfficeSink();
        },
        []
    );
    return null;
}
```

**Step 2: Hand it the Needs you rows.** In `cockpitoffice.tsx`, add to `CockpitOfficeProps`, beside `boardRows`:

```ts
    // the same rows' keys and kinds, for the office's sound (officesound.tsx)
    boardCues: BoardCue[];
```

In `cockpitsurface.tsx`, right after `const ny = useNeedsYou(...)`:

```ts
    const boardCues = useMemo(() => ny.rows.map((r) => ({ key: r.key, kind: r.run.wireKind })), [ny.rows]);
```

and pass `boardCues={boardCues}` to `<CockpitOffice …>` beside `boardRows`.

**Step 3: Mount it.** In `CockpitOffice`'s returned root `<div className="relative flex min-h-0 flex-1 flex-col">`, as
its first child: `<OfficeSound agents={agents} runs={runs} board={props.boardCues} night={night} />`. `agents`, `runs`
and `night` are the component's own (the live ones with the DEV fixture's added, and the clock with the DEV
override), so the scenario's fixture runs sound too.

**Step 4: The boss's sounds.** In `CockpitOffice`, beside `carry`:

```ts
    // the boss's sounds (office sounds spec, "Architecture"): a step every STEP_SOUND_PX the arrows walk it, one bump
    // per arrow held against a wall
    const stepAcc = useRef(0);
    const bumped = useRef(false);
    const bossSound = (from: Point, to: Point) => {
        const moved = Math.abs(to.x - from.x) + Math.abs(to.y - from.y);
        if (moved === 0) {
            if (!bumped.current) {
                bumped.current = true;
                playOfficeUi("bump");
            }
            return;
        }
        bumped.current = false;
        const s = stepSound(stepAcc.current, moved);
        stepAcc.current = s.acc;
        if (s.play) {
            playOfficeUi("step");
        }
    };
```

- In `stepAll`'s `else if (b.holding)` branch, compute the step first and sound it:
  `const to = stepToward(plan, b.at, b.holding, dist); bossSound(b.at, to);` then set `at: to` in the
  `globalStore.set(bossAtom, …)` that follows.
- In `walk`'s `if (!movingRef.current)` branch the same: `const to = stepToward(planRef.current, b.at, dir, ARROW_STEP_PX); bossSound(b.at, to);` and `at: to`.
- In `release`, after the `holding` check: `bumped.current = false;`.
- A click's walk (`walkTo`, the `advance` branch of `stepAll`) stays silent.

Then the blip, as an effect in `CockpitOffice`:

```ts
    // a blip when the dialog box, the full card or the office menu opens
    useEffect(() => {
        let layer = globalStore.get(layerAtom);
        let menu = globalStore.get(officeMenuOpenAtom);
        const offLayer = globalStore.sub(layerAtom, () => {
            const next = globalStore.get(layerAtom);
            if (next !== layer && next !== "walk") {
                playOfficeUi("blip");
            }
            layer = next;
        });
        const offMenu = globalStore.sub(officeMenuOpenAtom, () => {
            const next = globalStore.get(officeMenuOpenAtom);
            if (next && !menu) {
                playOfficeUi("blip");
            }
            menu = next;
        });
        return () => {
            offLayer();
            offMenu();
        };
    }, []);
```

Imports: `OfficeSound` from `./officesound`, `playOfficeUi` from `./officeaudio`, `stepSound` and `type BoardCue` from
`./officesoundcues`; `Point` is already imported for `BossState`.

**Step 5:** Run `npx vitest run frontend/app/view/agents` and the Check command. Both must pass. Then, with
`task dev` running (or a CDP shot if this is an engine worktree), open Cockpit → Office and confirm the office still
draws and walks; the sound itself is the hand check of Task 8.

**Step 6:** Commit: `git commit -m "feat(office): the office plays its jingles, music and the boss's sounds" -- frontend/app/view/agents/officesound.tsx frontend/app/view/agents/cockpitoffice.tsx frontend/app/view/agents/cockpitsurface.tsx`

---

### Task 6: The settings rows

**Depends on:** Task 1

**Files:** `frontend/app/view/agents/settingsmodel.ts`, `frontend/app/view/agents/settingsmodel.test.ts`, `frontend/app/view/agents/settingspages/appearance.tsx`, `frontend/app/view/agents/settingssurface.tsx`

**Step 1: Update the failing test first.** In `settingsmodel.test.ts`, the `cards["appearance/office"]` expectation
becomes:

```ts
expect(cards["appearance/office"]).toEqual([
    "appearance.officeanimation",
    "appearance.officehours",
    "appearance.officesoundevents",
    "appearance.officesoundui",
    "appearance.officesoundmusic",
    "appearance.officesoundvolume",
]);
```

Run `npx vitest run frontend/app/view/agents/settingsmodel.test.ts`. Expected: FAIL.

**Step 2:** In `settingsmodel.ts`, the `office` card's `rows`, after `appearance.officehours`:

```ts
{
    id: "appearance.officesoundevents",
    title: "Office jingles",
    desc: "A short chiptune when a task finishes, a run lands, something needs you or a task fails, while the Office is in view and arcterm has focus. s in the Office mutes all its sound.",
    key: "cockpit.office.sound.events",
    scope: "local",
},
{
    id: "appearance.officesoundui",
    title: "Boss sounds",
    desc: "Footsteps as the arrows walk the boss, a bump at a wall, a blip when a box, a card or the menu opens.",
    key: "cockpit.office.sound.ui",
    scope: "local",
},
{
    id: "appearance.officesoundmusic",
    title: "Office music",
    desc: "A chiptune loop while the Office is in view, one for work hours and one for after. It pauses when arcterm loses focus.",
    key: "cockpit.office.sound.music",
    scope: "local",
},
{
    id: "appearance.officesoundvolume",
    title: "Office volume",
    desc: "How loud the Office's jingles, sounds and music play.",
    key: "cockpit.office.sound.volume",
    scope: "local",
},
```

**Step 3:** In `appearance.tsx`, after `<OfficeHoursRow />`, add `<OfficeSoundRows />`, defined after `OfficeHoursRow`
in the style of `OfficeAnimationRow`:

```tsx
function OfficeSoundSwitch(props: { id: string; label: string; atom: PrimitiveAtom<boolean>; dflt: boolean }) {
    const [raw, set] = useAtom(props.atom);
    const on = soundSwitch(raw, props.dflt);
    return (
        <SettingRow id={props.id}>
            <Toggle on={on} onToggle={() => set(!on)} label={props.label} />
        </SettingRow>
    );
}

function OfficeSoundRows() {
    const [raw, setVolume] = useAtom(officeSoundVolumeAtom);
    const volume = soundVolume(raw);
    const pct = (v: number) => `${Math.round(v * 100)} %`;
    return (
        <>
            <OfficeSoundSwitch id="appearance.officesoundevents" label="Office jingles" atom={officeSoundEventsAtom} dflt={DEFAULT_SOUND.events} />
            <OfficeSoundSwitch id="appearance.officesoundui" label="Boss sounds" atom={officeSoundUiAtom} dflt={DEFAULT_SOUND.ui} />
            <OfficeSoundSwitch id="appearance.officesoundmusic" label="Office music" atom={officeSoundMusicAtom} dflt={DEFAULT_SOUND.music} />
            <SettingRow id="appearance.officesoundvolume">
                <Select
                    value={String(volume)}
                    label={pct(volume)}
                    ariaLabel="Office volume"
                    items={SOUND_VOLUMES.map((v) => ({
                        label: pct(v),
                        type: "radio",
                        checked: v === volume,
                        click: () => setVolume(v),
                    }))}
                />
            </SettingRow>
        </>
    );
}
```

Import the atoms, `DEFAULT_SOUND`, `SOUND_VOLUMES`, `soundSwitch`, `soundVolume` from `../officestore` and
`type PrimitiveAtom` from `jotai`. If `items` needs the `ContextMenuItem[]` type as in `OfficeHoursRow`, annotate it
the same way.

**Step 4:** In `settingssurface.tsx`, beside the `"appearance.officeanimation"` entry of `local`, read the four atoms
the way `officeAnim` is read there and add a `changed`/`revert` entry for each new row id (changed when the read value
differs from `DEFAULT_SOUND.<field>`; revert sets the default).

**Step 5:** Run `npx vitest run frontend/app/view/agents/settingsmodel.test.ts` and the Check command. Both pass.

**Step 6:** Commit: `git commit -m "feat(settings): the Office's jingles, boss sounds, music and volume in Appearance" -- frontend/app/view/agents/settingsmodel.ts frontend/app/view/agents/settingsmodel.test.ts frontend/app/view/agents/settingspages/appearance.tsx frontend/app/view/agents/settingssurface.tsx`

---

### Task 7: `s` and the office menu mute

**Depends on:** Task 5

**Files:** `frontend/app/view/agents/officecontrols.ts`, `frontend/app/view/agents/officecontrols.test.ts`, `frontend/app/view/agents/usecockpitkeyboard.ts`, `frontend/app/view/agents/cockpitoffice.tsx`, `frontend/app/view/agents/cockpitsurface.tsx`, `frontend/app/store/keybindings/bindings.ts`, `docs/keyboard-shortcuts.md`

**Step 1: Write the failing tests** in `officecontrols.test.ts`:

- In the `officeKey` tests add:

```ts
it("mutes on s, except while the menu takes every key", () => {
    expect(officeKey("walk", false, "s")).toEqual({ do: "sound" });
    expect(officeKey("dialog", false, "s")).toEqual({ do: "sound" });
    expect(officeKey("walk", true, "s")).toEqual({ do: "none" });
    expect(officeKey("walk", false, "s", { ctrl: true })).toEqual({ do: "pass" });
});
```

- `officeMenuItems` takes a last argument `muted: boolean`. Pass `false` at each existing call; the label list of the
  first test gains `"Mute sound"` after `"Events"` and the key list gains `"s"` after the Events `undefined`. Add:

```ts
it("names the sound item by what it will do", () => {
    expect(officeMenuItems(0, 0, false, 0, false).find((i) => i.id === "sound")?.label).toBe("Mute sound");
    expect(officeMenuItems(0, 0, false, 0, true).find((i) => i.id === "sound")?.label).toBe("Sound on");
});
```

Run `npx vitest run frontend/app/view/agents/officecontrols.test.ts`. Expected: FAIL.

**Step 2: Implement** in `officecontrols.ts`: `OfficeKeyAction` gains `| { do: "sound" }`; in `officeKey`, after the
`f` check, `if (key === "s") { return { do: "sound" }; }`. `OfficeMenuId` gains `"sound"`; `officeMenuItems` gains
the parameter `muted: boolean` and, after the `events` item, `{ id: "sound", label: muted ? "Sound on" : "Mute sound", key: "s" },`.

**Step 3: Wire it.**
- `usecockpitkeyboard.ts`, in the `switch (act.do)`: `case "sound": e.preventDefault(); toggleOfficeMute(); return;`
  (import `toggleOfficeMute` from `./officestore`).
- `cockpitsurface.tsx`, in `onOfficeMenu`: `case "sound": toggleOfficeMute(); return;`.
- `cockpitoffice.tsx`: `const muted = soundSwitch(useAtomValue(officeSoundMutedAtom), DEFAULT_SOUND.muted);` and pass
  it as the last argument of `officeMenuItems(...)`.
- `bindings.ts`, in `buildCockpitBindings` after `cockpit:office-menu`:
  `doc("cockpit:office-sound", "s", "Office: mute or unmute its sound (jingles, boss sounds, music)"),`.
- `docs/keyboard-shortcuts.md`, after the `m (Office)` row:
  `| \`s\` (Office) | Mute or unmute the Office's sound; what plays is set in Settings → Appearance → Office |`,
  and add "Mute sound" to the `m` row's list of menu items.

**Step 4:** Run `npx vitest run frontend/app/view/agents frontend/app/store/keybindings` and the Check command. Both
pass (a keybindings test that checks for duplicate keys per surface must still pass: `s` is free on the Cockpit).

**Step 5:** Commit: `git commit -m "feat(office): s and the office menu mute the office's sound" -- frontend/app/view/agents/officecontrols.ts frontend/app/view/agents/officecontrols.test.ts frontend/app/view/agents/usecockpitkeyboard.ts frontend/app/view/agents/cockpitoffice.tsx frontend/app/view/agents/cockpitsurface.tsx frontend/app/store/keybindings/bindings.ts docs/keyboard-shortcuts.md`

---

### Task 8: The office-sound scenario, changelog and hand check

**Depends on:** Task 6, Task 7

**Files:** `frontend/app/view/agents/cockpitofficedevhooks.ts`, `scripts/cdp/cockpitofficescenarios.mjs`, `scripts/cdp/scenarios.mjs`, `CHANGELOG.md`, `docs/open-issues.md`, `docs/superpowers/specs/2026-10-16-office-sounds-design.md`

**Step 1: DEV hooks.** In `cockpitofficedevhooks.ts` declare on `Window`
`__cockpitOfficeSound?: (on: boolean) => void;` and `__cockpitOfficeSoundLog?: () => string[] | null;`, and in
`installCockpitOfficeDevHooks`:

```ts
    // the office-sound scenario: what the office would play, logged instead of played
    window.__cockpitOfficeSound = (on) => setOfficeSoundLog(on);
    window.__cockpitOfficeSoundLog = () => officeSoundLog();
```

**Step 2: The scenario** `office-sound` in `cockpitofficescenarios.mjs`, inside `makeCockpitOfficeScenarios`, added
to its returned object as `cockpitOfficeSound` and registered in `scripts/cdp/scenarios.mjs` beside
`cockpitOfficeBench` (both the destructuring and the scenario list). Add `s: 83` to `KEY_CODES`. It needs no real run:
arrange it like `cockpit-office-bench` (write `ROSTERS["office"](Date.now())` to `FIXTURE`, keep `prevFixture` and
`prevView`) but set `VIEW_KEY` to `"office"`, reload, `h.goto("cockpit")`, then `ctx.missing = await waitForOffice(h)`.
Also remove the five `cockpit.office.sound.*` localStorage keys before the reload so the defaults hold, and turn the
animation off (`window.__cockpitOfficeAnimation(false)`) so nothing moves under the shots.

The steps, each with `rec(step, ok, detail)` as the other office scenarios do:

1. `__cockpitOfficeSound(true)`; `dev(h, { runs: soundRuns(["running", "running"]) })` where
   `const soundRuns = (states, o = {}) => devRuns("fx-sound-run", [["Sound run", "arcterm", states]]).map((r) => ({ ...r, ...o }))`;
   wait 500 ms. The log holds no cue (filter out `music:` entries): a run that only came into view is silent.
2. `dev(h, { runs: soundRuns(["done", "running"]) })`, wait 500 ms: the log ends with `taskDone`.
3. Wait 1600 ms; `soundRuns(["done", "review-failed"])`: the log ends with `setback`.
4. Wait 1600 ms; `soundRuns(["done", "done"], { done: true, landed: true })`: the log ends with `landed` (one entry for
   the burst, not `taskDone` too).
5. `focusCockpit(h)`, `key(h, "s")`: `localStorage.getItem("cockpit.office.sound.muted")` is `"true"`. Wait 1600 ms;
   `soundRuns(["running", "running"])` then `soundRuns(["done", "running"])`: the log gained nothing.
6. `key(h, "s")` again (unmuted). `key(h, "m")`: the open office menu's text contains `Mute sound` and `s`;
   `h.shot("cdp-shots/office-sound-menu.png")`; `key(h, "Escape")`.
7. Open Settings → Appearance the way the existing Settings scenarios do (grep `scripts/cdp/scenarios.mjs` for
   `appearance.officeanimation`, or for how they open the Appearance page), scroll the row
   `appearance.officesoundevents` into view, assert the four new row titles are on the page, and
   `h.shot("cdp-shots/office-sound-settings.png")`.

Teardown: `__cockpitOfficeSound(false)`, `__cockpitOffice(null)`, restore the animation, the view and the fixture as
`cockpit-office-bench`'s teardown does, remove the `cockpit.office.sound.*` keys, reload.

**Step 3:** With `task dev` running, `task verify:ui -- office-sound`. Expected: every step PASS. (In an engine
worktree, Final runs it.)

**Step 4: Docs.**
- `CHANGELOG.md`, under `## Unreleased` → `### Added` (open the heading if missing):
  `- Office sounds: chiptune jingles when a task finishes, a run lands or someone needs you, with optional footsteps and day and night music (\`s\` mutes). <!-- try: cockpit:office -->`
- `docs/open-issues.md`, under "0 · Waiting on a hand check", a `- [ ] (arcterm)` line: in the real app, Cockpit →
  Office with real agents and a run: are the jingles pleasant and the default volume right; does the music duck
  under a jingle and stop when arcterm loses focus; do footsteps and the wall bump feel right with Boss sounds on.
  The `office-sound` scenario logged the cues only and played no sound.
- `docs/open-issues.md`, the "(arcterm) RAM watch" section: a line for Office music, "to measure by hand: arcterm's
  WebView2 processes in Task Manager, Office open, music off then on for a minute (spec estimate 1–3 MB)".
- The spec's `**Status:**` becomes `built`.

**Step 5:** Commit: `git commit -m "test(cdp): office-sound scenario; changelog and hand check for the office's sound" -- frontend/app/view/agents/cockpitofficedevhooks.ts scripts/cdp/cockpitofficescenarios.mjs scripts/cdp/scenarios.mjs CHANGELOG.md docs/open-issues.md docs/superpowers/specs/2026-10-16-office-sounds-design.md`
