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
        line(
            "sq1",
            "E5/2 G5/2 C6/4 B5/2 G5/2 E5/4 F5/2 A5/2 C6/2 A5/2 G5/8 E5/2 G5/2 C6/4 D6/2 C6/2 B5/4 A5/2 B5/2 G5/4 C6/8",
            { vol: 0.25, duty: 0.5 }
        ),
        line("sq2", "C5/4 E5/4 G5/4 E5/4 C5/4 F5/4 A5/4 F5/4 C5/4 E5/4 B4/4 D5/4 B4/4 D5/4 C5/8", {
            vol: 0.12,
            duty: 0.25,
        }),
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
