// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The pairing sheet's draft (pairsheet.tsx; board K1 of docs/superpowers/specs/2026-11-25-agent-pair-judge-design.md), pure:
// which of the two picked agents works and which judges, the hold box, the note to the judge and the token cap, and what
// PairStart takes once they are valid. The tree's rule for offering the sheet is pairPickable (agenttreemodel.ts).

/** One side of the sheet: an agent by its tab (the cockpit agent id) and the name the tree shows. */
export interface PairSheetSide {
    id: string;
    name: string;
}

/** The two picked agents, the first picked working: what pairPickable hands the sheet. */
export interface PairSheetPick {
    worker: PairSheetSide;
    judge: PairSheetSide;
}

export interface PairSheetDraft {
    /** the person traded the sides: the second picked works */
    swapped: boolean;
    /** hold the working agent's heavy commands until the judge answers */
    hold: boolean;
    note: string;
    /** the token cap in millions, as typed */
    cap: string;
}

export const DEFAULT_CAP_MILLIONS = 3;
// Below half a million a pair stops at its first turns: each turn of a 200k-context agent counts its whole context again
// (cache reads included). Above a hundred million is a typo, not a decision.
export const CAP_MIN_MILLIONS = 0.5;
export const CAP_MAX_MILLIONS = 100;
const MILLION = 1_000_000;

export function newDraft(): PairSheetDraft {
    return { swapped: false, hold: true, note: "", cap: String(DEFAULT_CAP_MILLIONS) };
}

/** Pure: the sides traded. */
export function swapSides(d: PairSheetDraft): PairSheetDraft {
    return { ...d, swapped: !d.swapped };
}

/** Pure: who works and who judges once the draft's swap is applied to the picked order. */
export function sheetSides(picked: PairSheetPick, d: Pick<PairSheetDraft, "swapped">): PairSheetPick {
    return d.swapped ? { worker: picked.judge, judge: picked.worker } : picked;
}

/** Pure: the cap the person typed, in tokens, or null when it is not a number in the bounds. A plain number only: a
 *  decimal comma counts (a Vietnamese keyboard types one), a sign, an exponent or a unit does not. */
export function capTokens(cap: string): number | null {
    const text = cap.trim();
    if (!/^\d+([.,]\d+)?$/.test(text)) {
        return null;
    }
    const millions = Number(text.replace(",", "."));
    return millions >= CAP_MIN_MILLIONS && millions <= CAP_MAX_MILLIONS ? Math.round(millions * MILLION) : null;
}

/** Pure: what PairStart takes for the sheet as it stands, or null while the cap is not valid. The judge is not launched by
 *  arcterm here (`briefed` false): wavesrv gives a live agent its brief as its first prompt. */
export function startData(picked: PairSheetPick, d: PairSheetDraft): CommandPairStartData | null {
    const tokencap = capTokens(d.cap);
    if (tokencap == null) {
        return null;
    }
    const { worker, judge } = sheetSides(picked, d);
    return {
        workertab: worker.id,
        judgetab: judge.id,
        holdheavy: d.hold,
        tokencap,
        note: d.note.trim(),
        briefed: false,
    };
}
