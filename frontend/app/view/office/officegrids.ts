// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Grids the office's scenery and its people share, pixel for pixel (cockpit office spec, "Drawing"). The near side's
// chair: the over canvas draws it at every near-side seat, and a near-side person's sprite ends with the same rows,
// so the chair's back covers the person and an empty chair still shows. O outline, R chair, r its shade.

export const NEAR_CHAIR = [
    ".OOOOOOOOOOOO.",
    ".ORRRRRRRRRRO.",
    ".ORRRRRRRRRRO.",
    ".OrrrrrrrrrrO.",
    ".OOOOOOOOOOOO.",
    "..O........O..",
];
