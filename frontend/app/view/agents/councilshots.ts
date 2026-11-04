// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Pure: a council's screenshot cites (docs/superpowers/specs/2026-11-04-council-screenshot-regions-design.md). A seat
// cites part of an image as `screenshot:<file>#<name>@x,y,w,h`; Go checks the box and draws the crop
// (pkg/council/regions.go, `CouncilEvidence.region`), so all the cockpit reads here is the name a chip shows and whether
// the cite carries a box at all: one with none marks no place on the image, and a checked claim counts it as no evidence.
// No React, no Wave runtime imports.

/** A screenshot cite taken apart as the chips need it; the box itself is Go's (`region`). */
export interface ShotRef {
    file: string;
    name: string; // "" when the cite names no region
    boxed: boolean; // it carries an `@…` box, whether or not that box holds
}

const SHOT_PREFIX = /^screenshot:/i;

/** Pure: a screenshot cite read as Go reads it (parseShotRef in pkg/council/regions.go); null for any other ref. The box
 *  is what follows the last `@` after `#`; with no `#`, a last `@` counts only when a comma follows it (`shot@2x.png`). */
export function parseShotRef(ref: string): ShotRef | null {
    const s = ref.trim();
    if (!SHOT_PREFIX.test(s)) {
        return null;
    }
    const rest = s.replace(SHOT_PREFIX, "");
    const hash = rest.indexOf("#");
    if (hash >= 0) {
        const frag = rest.slice(hash + 1);
        const at = frag.lastIndexOf("@");
        return {
            file: rest.slice(0, hash).trim(),
            name: (at >= 0 ? frag.slice(0, at) : frag).trim(),
            boxed: at >= 0,
        };
    }
    const at = rest.lastIndexOf("@");
    const boxed = at >= 0 && rest.slice(at + 1).includes(",");
    return { file: (boxed ? rest.slice(0, at) : rest).trim(), name: "", boxed };
}

/** Pure: a screenshot cite as its chip names it, `home.png#save`: the file's name and the region's, no box. Any other
 *  ref comes back as it is. */
export function shotName(ref: string): string {
    const s = parseShotRef(ref);
    if (s == null) {
        return ref;
    }
    const file = s.file.replace(/\\/g, "/").split("/").pop() || s.file;
    return s.name !== "" ? `${file}#${s.name}` : file;
}

/** What a weak chip says of a screenshot region cited with no box. */
export const NO_BOX = "the region has no box, so it shows nothing";

/** Pure: whether a cite of a claim Go checked counts as no evidence for naming a screenshot region with no box. A claim
 *  nothing checks (a plain reply, a Brainstorm's) asked for no evidence, so there it is the plain chip. */
export function isUnboxedShot(e: Pick<CouncilEvidence, "ref" | "weak">, checked: boolean): boolean {
    const s = checked && !e.weak ? parseShotRef(e.ref) : null;
    return s != null && !s.boxed;
}

/** Pure: the weak chip's words for a screenshot region cited with no box. */
export function unboxedWords(ref: string): string {
    return `Weak · ${shotName(ref)}: ${NO_BOX}`;
}
