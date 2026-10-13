// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Jarvis's pixels: every pose of each creature (Sprout, the Minion and Spider-Man) and every mark as data, and the
// one function that turns them into cells. The grids live here and nowhere else (sprout spec §2, §4). Pure — no React,
// no atoms — so the walker can name a pose without knowing what it looks like, and the renderer can draw one without
// knowing why.
//
// A grid is 16 rows of 16 cell codes, `.` empty. Each code is a theme token rather than a colour, so a
// runtime theme repaints the creature through the same --color-* properties it overrides everywhere else.

export type PetPose =
    | "walk1"
    | "walk2"
    | "stand"
    | "sit"
    | "sleep"
    | "tired"
    | "speak"
    | "dangle"
    // the pastimes a rest is spent in (petwalk.ts PASTIMES), two frames each
    | "read1"
    | "read2"
    | "music1"
    | "music2"
    | "work1"
    | "work2"
    | "ball1"
    | "ball2";

export type PetMark = "gate" | "escalation" | "blocked" | "z" | "drop" | "unread";

// What it wears in Vietnam's colours, chosen in Settings (petoutfit.ts): the flag shirt over a pose, or the flag in
// its hand behind one.
export type PetOutfit = "vn-shirt" | "vn-flag";

// Which creature Jarvis is drawn as, chosen in Settings (petcharacter.ts). Each has every pose, and the marks and
// outfits fit any.
export type PetCharacter = "sprout" | "minion" | "spidey";

export const PET_GRID = 16;
export const PET_CELL_PX = 3;
export const PET_PX = PET_GRID * PET_CELL_PX;

// Cell code → the --color-* property its rect is filled with.
export const PET_TOKENS = {
    b: "--color-accent", // body
    d: "--color-accent-600", // sprout, legs
    l: "--color-accent-200", // highlight, sweat drop
    k: "--color-background", // eyes, mouth, the eye mark's pupil
    w: "--color-primary", // the review-gate eye mark
    m: "--color-muted", // the sleep z
    r: "--color-error", // the escalation !
    y: "--color-asking", // the blocked-worker ?
    R: "--color-flag-red", // the flag shirt
    Y: "--color-flag-star", // the shirt's star
    j: "--color-minion-skin", // the Minion's body
    h: "--color-minion-shine", // its highlight
    o: "--color-minion-denim", // its overalls
    O: "--color-minion-denim-dark", // the bib pocket
    s: "--color-minion-hair", // its hair and shoes
    S: "--color-spidey-red", // Spider-Man's suit
    B: "--color-spidey-blue",
    D: "--color-spidey-seam", // the mask's seam
    e: "--color-spidey-eye", // the mask's eyes, Peter's lenses
    x: "--color-spidey-web", // a strand
    p: "--color-peter-skin", // Peter Parker
    H: "--color-peter-hair",
    g: "--color-peter-glasses",
    v: "--color-peter-shirt",
    c: "--color-city-cornice", // the fold's rooftop
    C: "--color-city-cornice-shade",
    M: "--color-city-brick",
    N: "--color-city-brick-light",
    Q: "--color-city-window",
    L: "--color-city-window-lit",
} as const satisfies Record<string, `--color-${string}`>;

type PetCode = keyof typeof PET_TOKENS;

const E = "................";

// Rows 0-3 are kept clear for the marks; the bottom row is the one that stands on the ledge. The sprout is
// the `t` of arcterm's mark: its crossbar is the leaves.
export const POSES: Record<PetPose, readonly string[]> = {
    walk1: [
        E,
        E,
        E,
        "........d.......",
        "......dddd......",
        ".......d........",
        ".......d........",
        "....llbbbbbb....",
        "...lbbbbbbbbb...",
        "..bbbbbbbbbbbb..",
        "..bbbbkbbbbkbb..",
        "..bbbbkbbbbkbb..",
        "..bbbbbbbbbbbb..",
        "..bbbbbbbbbbbb..",
        "...bbbbbbbbbb...",
        "...dd......dd...",
    ],
    walk2: [
        E,
        E,
        E,
        "......d.........",
        "......dddd......",
        ".......d........",
        ".......d........",
        "....llbbbbbb....",
        "...lbbbbbbbbb...",
        "..bbbbbbbbbbbb..",
        "..bbbbkbbbbkbb..",
        "..bbbbkbbbbkbb..",
        "..bbbbbbbbbbbb..",
        "..bbbbbbbbbbbb..",
        "...bbbbbbbbbb...",
        ".....dd..dd.....",
    ],
    stand: [
        E,
        E,
        E,
        ".......d........",
        "......dddd......",
        ".......d........",
        ".......d........",
        "....llbbbbbb....",
        "...lbbbbbbbbb...",
        "..bbbbbbbbbbbb..",
        "..bbbkbbbbkbbb..",
        "..bbbkbbbbkbbb..",
        "..bbbbbbbbbbbb..",
        "..bbbbbbbbbbbb..",
        "...bbbbbbbbbb...",
        "....dd....dd....",
    ],
    sit: [
        E,
        E,
        E,
        E,
        ".......d........",
        "......dddd......",
        ".......d........",
        ".......d........",
        "....llbbbbbb....",
        "...lbbbbbbbbb...",
        "..bbbbbbbbbbbb..",
        "..bbbkbbbbkbbb..",
        "..bbbkbbbbkbbb..",
        "..bbbbbbbbbbbb..",
        "..bbbbbbbbbbbb..",
        "...bbbbbbbbbbdd.",
    ],
    sleep: [
        E,
        E,
        E,
        E,
        E,
        E,
        ".......d........",
        ".....dd.dd......",
        ".......d........",
        "....llbbbbbb....",
        "..lbbbbbbbbbbb..",
        ".bbbbbbbbbbbbbb.",
        ".bbbkkbbbbkkbbb.",
        ".bbbbbbbbbbbbbb.",
        ".bbbbbbbbbbbbbb.",
        "..bbbbbbbbbbbb..",
    ],
    tired: [
        E,
        E,
        E,
        E,
        ".......d........",
        ".....dd.dd......",
        ".......d........",
        "....llbbbbbb....",
        "...lbbbbbbbbb...",
        "..bbbbbbbbbbbb..",
        "..bbbbbbbbbbbb..",
        "..bbbkbbbbkbbb..",
        "..bbbbbbbbbbbb..",
        "..bbbbbbbbbbbb..",
        "...bbbbbbbbbb...",
        "....dd....dd....",
    ],
    speak: [
        E,
        E,
        E,
        ".......d........",
        "......dddd......",
        ".......d........",
        ".......d........",
        "....llbbbbbb....",
        "...lbbbbbbbbb...",
        "..bbbbbbbbbbbb..",
        "..bbbkbbbbkbbb..",
        "..bbbkbbbbkbbb..",
        "..bbbbbkkbbbbb..",
        "..bbbbbbbbbbbb..",
        "...bbbbbbbbbb...",
        "....dd....dd....",
    ],
    // being dragged: held by the sprout, legs hanging
    dangle: [
        E,
        ".......d........",
        "......dddd......",
        ".......d........",
        ".......d........",
        "....llbbbbbb....",
        "...lbbbbbbbbb...",
        "..bbbbbbbbbbbb..",
        "..bbbkkbbkkbbb..",
        "..bbbkkbbkkbbb..",
        "..bbbbbbbbbbbb..",
        "..bbbbbbbbbbbb..",
        "...bbbbbbbbbb...",
        "....d......d....",
        "....d......d....",
        "....d......d....",
    ],
    // Pastimes. None draws a `k` outside the face, which dressInFlag reads as the eyes, and each keeps the unread
    // mark's cells clear.
    // studying: sat with an open book on its lap, eyes running along the lines
    read1: [
        E,
        E,
        E,
        E,
        ".......d........",
        "......dddd......",
        ".......d........",
        ".......d........",
        "....llbbbbbb....",
        "...lbbbbbbbbb...",
        "..bbbbbbbbbbbb..",
        "..bbbbbbbbbbbb..",
        "..bbbbkbbbbkbb..",
        "..brwwwwrwwwwr..",
        "..brmmwwrmmwwr..",
        "...rrrrrrrrrrdd.",
    ],
    read2: [
        E,
        E,
        E,
        E,
        ".......d........",
        "......dddd......",
        ".......d........",
        ".......d........",
        "....llbbbbbb....",
        "...lbbbbbbbbb...",
        "..bbbbbbbbbbbb..",
        "..bbbbbbbbbbbb..",
        "..bbbkbbbbkbbb..",
        "..brwwwwrwwwwr..",
        "..brwwmmrwwmmr..",
        "...rrrrrrrrrrdd.",
    ],
    // listening to music: headphones on, eyes shut, notes drifting up while the sprout sways
    music1: [
        "............yy..",
        "..yy........y...",
        "..y.........y...",
        ".yy....d...yy...",
        "......dddd......",
        ".......d........",
        "....mmmdmmmm....",
        "...mllbbbbbbm...",
        "..mlbbbbbbbbbm..",
        ".rrbbbbbbbbbbrr.",
        ".rrbbbbbbbbbbrr.",
        ".rrbkkbbbbkkbrr.",
        "..bbbbbbbbbbbb..",
        "..bbbbbbbbbbbb..",
        "...bbbbbbbbbb...",
        "....dd....dd....",
    ],
    music2: [
        "..yy............",
        "..y..........yy.",
        ".yy..........y..",
        "......d......y..",
        "......dddd..yy..",
        ".......d........",
        "....mmmdmmmm....",
        "...mllbbbbbbm...",
        "..mlbbbbbbbbbm..",
        ".rrbbbbbbbbbbrr.",
        ".rrbbbbbbbbbbrr.",
        ".rrbkkbbbbkkbrr.",
        "..bbbbbbbbbbbb..",
        "..bbbbbbbbbbbb..",
        "...bbbbbbbbbb...",
        "....dd....dd....",
    ],
    // working: sat at a laptop seen side-on, its screen lighting the face, a key lit as it types and the code mark
    // blinking over its head
    work1: [
        ".......w...w.w..",
        "......w...w...w.",
        ".......w.w...w..",
        E,
        ".......d........",
        "......dddd......",
        ".......d........",
        ".......d........",
        "....llbbbbbb....",
        "...lbbbbbbbbb.m.",
        "..bbbbbbbbbbblm.",
        "..bbbbkbbbbkblm.",
        "..bbbbkbbbbkblm.",
        "..bbbbbbbbbbblm.",
        "..bbbbbbbmwmmmm.",
        "...bbbbbbbbbbdd.",
    ],
    work2: [
        ".......m...m.m..",
        "......m...m...m.",
        ".......m.m...m..",
        E,
        ".......d........",
        "......dddd......",
        ".......d........",
        ".......d........",
        "....llbbbbbb....",
        "...lbbbbbbbbb.m.",
        "..bbbbbbbbbbbwm.",
        "..bbbbkbbbbkbwm.",
        "..bbbbkbbbbkbwm.",
        "..bbbbbbbbbbbwm.",
        "..bbbbbbbmmmwmm.",
        "...bbbbbbbbbbdd.",
    ],
    // playing sport: dribbling a basketball at its side, high then low
    ball1: [
        E,
        E,
        E,
        ".......d........",
        "......dddd......",
        ".......d........",
        ".......d........",
        "....llbbbbbb....",
        "...lbbbbbbbbb...",
        "..bbbbbbbbbbbyy.",
        "..bbbbkbbbbkyyyy",
        "..bbbbkbbbbkyyyy",
        "..bbbbbbbbbbbyy.",
        "..bbbbbbbbbbbb..",
        "...bbbbbbbbbb...",
        "....dd....dd....",
    ],
    ball2: [
        E,
        E,
        E,
        ".......d........",
        "......dddd......",
        ".......d........",
        ".......d........",
        "....llbbbbbb....",
        "...lbbbbbbbbb...",
        "..bbbbbbbbbbbb..",
        "..bbbbkbbbbkbb..",
        "..bbbbkbbbbkbb..",
        "..bbbbbbbbbbbyy.",
        "..bbbbbbbbbbyyyy",
        "...bbbbbbbbbyyyy",
        "....dd....dd.yy.",
    ],
};

// The Minion: a yellow body, one goggle, overalls. The goggle's rim and the headphones are muted like Sprout's, the eye
// is primary, and the pupil, the goggle strap and the mouth are the background, as Sprout's eyes are. Rows 0-2 stay
// clear for the marks, and every pose keeps the unread mark's cells (x 1-2, y 5-6) clear, so the marks land on it at
// Sprout's cells.
export const MINION_POSES: Record<PetPose, readonly string[]> = {
    walk1: [
        E,
        E,
        E,
        ".....s.s..s.....",
        "....hjjjjjjj....",
        "...hjjmmmmjjj...",
        "...kkmwwwwmkk...",
        "...kkmwwkkmkk...",
        "...jjmwwkkmjj...",
        "...jjjmmmmjjj...",
        "...jjjkjjjjkj...",
        "...jjjjkkkkjj...",
        "...jjooOOoojj...",
        "...oooooooooo...",
        "...oooooooooo...",
        "...ss......ss...",
    ],
    walk2: [
        E,
        E,
        E,
        "....s.s..s......",
        "....hjjjjjjj....",
        "...hjjmmmmjjj...",
        "...kkmwwwwmkk...",
        "...kkmwwkkmkk...",
        "...jjmwwkkmjj...",
        "...jjjmmmmjjj...",
        "...jjjkjjjjkj...",
        "...jjjjkkkkjj...",
        "...jjooOOoojj...",
        "...oooooooooo...",
        "...oooooooooo...",
        ".....ss..ss.....",
    ],
    stand: [
        E,
        E,
        E,
        ".....s.s..s.....",
        "....hjjjjjjj....",
        "...hjjmmmmjjj...",
        "...kkmwwwwmkk...",
        "...kkmwkkwmkk...",
        "...jjmwkkwmjj...",
        "...jjjmmmmjjj...",
        "...jjkjjjjkjj...",
        "...jjjkkkkjjj...",
        "...jjooOOoojj...",
        "...oooooooooo...",
        "...oooooooooo...",
        "....ss....ss....",
    ],
    sit: [
        E,
        E,
        E,
        E,
        ".....s.s..s.....",
        "....hjjjjjjj....",
        "...hjjmmmmjjj...",
        "...kkmwwwwmkk...",
        "...kkmwkkwmkk...",
        "...jjmwkkwmjj...",
        "...jjjmmmmjjj...",
        "...jjkjjjjkjj...",
        "...jjjkkkkjjj...",
        "...jjooOOoojj...",
        "...oooooooooo...",
        "...ooooooooooss.",
    ],
    sleep: [
        E,
        E,
        E,
        E,
        E,
        ".....s.s..s.....",
        "....hjjjjjjj....",
        "...hjjmmmmjjj...",
        "...kkmjjjjmkk...",
        "...kkmjjjjmkk...",
        "...jjmkkkkmjj...",
        "...jjjmmmmjjj...",
        "...jjjjkkjjjj...",
        "...jjooOOoojj...",
        "...oooooooooo...",
        "...ooooooooooss.",
    ],
    tired: [
        E,
        E,
        E,
        E,
        "....ss.s.s......",
        "....hjjjjjjj....",
        "...hjjmmmmjjj...",
        "...kkmjjjjmkk...",
        "...kkmwkkwmkk...",
        "...jjmwwwwmjj...",
        "...jjjmmmmjjj...",
        "...jjjjjjjjjj...",
        "...jjjkkkkjjj...",
        "...jjooOOoojj...",
        "...oooooooooo...",
        "....ss....ss....",
    ],
    speak: [
        E,
        E,
        E,
        ".....s.s..s.....",
        "....hjjjjjjj....",
        "...hjjmmmmjjj...",
        "...kkmwwwwmkk...",
        "...kkmwkkwmkk...",
        "...jjmwkkwmjj...",
        "...jjjmmmmjjj...",
        "...jjjkkkkjjj...",
        "...jjjjkkjjjj...",
        "...jjooOOoojj...",
        "...oooooooooo...",
        "...oooooooooo...",
        "....ss....ss....",
    ],
    // held up by its hair, legs hanging
    dangle: [
        E,
        ".......ss.......",
        "......s..s......",
        ".....s.ss.s.....",
        "....hjjjjjjj....",
        "...hjjmmmmjjj...",
        "...kkmwwwwmkk...",
        "...kkmwkkwmkk...",
        "...jjmwkkwmjj...",
        "...jjjmmmmjjj...",
        "...jjjjkkjjjj...",
        "...jjjjkkjjjj...",
        "...jjooOOoojj...",
        "...oooooooooo...",
        "....o......o....",
        "....s......s....",
    ],
    // Pastimes, as Sprout's. Reading: sat with a book on its lap, which covers the overalls
    read1: [
        E,
        E,
        E,
        E,
        ".....s.s..s.....",
        "....hjjjjjjj....",
        "...hjjmmmmjjj...",
        "...kkmwwwwmkk...",
        "...kkmwwwwmkk...",
        "...jjmkkwwmjj...",
        "...jjjmmmmjjj...",
        "...jjkjjjjkjj...",
        "...jjjkkkkjjj...",
        "..jrwwwwrwwwwrj.",
        "...rmmwwrmmwwr..",
        "...rrrrrrrrrrss.",
    ],
    read2: [
        E,
        E,
        E,
        E,
        ".....s.s..s.....",
        "....hjjjjjjj....",
        "...hjjmmmmjjj...",
        "...kkmwwwwmkk...",
        "...kkmwwwwmkk...",
        "...jjmwwkkmjj...",
        "...jjjmmmmjjj...",
        "...jjkjjjjkjj...",
        "...jjjkkkkjjj...",
        "..jrwwwwrwwwwrj.",
        "...rwwmmrwwmmr..",
        "...rrrrrrrrrrss.",
    ],
    // listening to music: the headphones' band over its hair, the cups over the goggle strap, the eye shut happy
    music1: [
        "............yy..",
        "..yy........y...",
        "..y.........y...",
        ".yy..mmmmmmyy...",
        "....mjjjjjjm....",
        "...hmjmmmmjmj...",
        "...rrmjjjjmrr...",
        "...rrmjkkjmrr...",
        "...rrmkjjkmrr...",
        "...jjjmmmmjjj...",
        "...jjkjjjjkjj...",
        "...jjjkkkkjjj...",
        "...jjooOOoojj...",
        "...oooooooooo...",
        "...oooooooooo...",
        "....ss....ss....",
    ],
    music2: [
        "..yy............",
        "..y..........yy.",
        ".yy..........y..",
        ".....mmmmmm..y..",
        "....mjjjjjjmyy..",
        "...hmjmmmmjmj...",
        "...rrmjjjjmrr...",
        "...rrmjkkjmrr...",
        "...rrmkjjkmrr...",
        "...jjjmmmmjjj...",
        "...jjkjjjjkjj...",
        "...jjjkkkkjjj...",
        "...jjooOOoojj...",
        "...oooooooooo...",
        "...oooooooooo...",
        "....ss....ss....",
    ],
    // working: sat at a laptop seen side-on, its screen lit, a key lit as it types and the code mark over its head
    work1: [
        ".......w...w.w..",
        "......w...w...w.",
        ".......w.w...w..",
        E,
        ".....s.s..s.....",
        "....hjjjjjjj....",
        "...hjjmmmmjjj...",
        "...kkmwwwwmkk.m.",
        "...kkmwwkkmkklm.",
        "...jjmwwkkmjjlm.",
        "...jjjmmmmjjjlm.",
        "...jjjkjjjjkjlm.",
        "...jjjjkkkkjjlm.",
        "...jjooOOoojjlm.",
        "...oooooomwmmmm.",
        "...ooooooooooss.",
    ],
    work2: [
        ".......m...m.m..",
        "......m...m...m.",
        ".......m.m...m..",
        E,
        ".....s.s..s.....",
        "....hjjjjjjj....",
        "...hjjmmmmjjj...",
        "...kkmwwwwmkk.m.",
        "...kkmwwkkmkkwm.",
        "...jjmwwkkmjjwm.",
        "...jjjmmmmjjjwm.",
        "...jjjkjjjjkjwm.",
        "...jjjjkkkkjjwm.",
        "...jjooOOoojjwm.",
        "...oooooommmwmm.",
        "...ooooooooooss.",
    ],
    // playing sport: dribbling a ball at its side, high then low. Coral, not amber: amber beside the yellow body would
    // not read as a ball
    ball1: [
        E,
        E,
        E,
        ".....s.s..s.....",
        "....hjjjjjjj....",
        "...hjjmmmmjjj...",
        "...kkmwwwwmkk...",
        "...kkmwwkkmkk...",
        "...jjmwwkkmjjrr.",
        "...jjjmmmmjjrrrr",
        "...jjjkjjjjkrrrr",
        "...jjjjkkkkjjrr.",
        "...jjooOOoojj...",
        "...oooooooooo...",
        "...oooooooooo...",
        "....ss....ss....",
    ],
    ball2: [
        E,
        E,
        E,
        ".....s.s..s.....",
        "....hjjjjjjj....",
        "...hjjmmmmjjj...",
        "...kkmwwwwmkk...",
        "...kkmwwwwmkk...",
        "...jjmwwkkmjj...",
        "...jjjmmmmjjj...",
        "...jjjkjjjjkj...",
        "...jjjjkkkkjj...",
        "...jjooOOoojjrr.",
        "...ooooooooorrrr",
        "...ooooooooorrrr",
        "....ss....ss.rr.",
    ],
};

// Spider-Man in the Homecoming suit: slim, the head solid red with one seam and the eyes framed at their outer corners,
// a small black spider on the chest. The suit on the job, Peter Parker at rest (SPIDEY_LOOK). The marks' cells are kept
// clear as Sprout's are.
export const SPIDEY_POSES: Record<PetPose, readonly string[]> = {
    // the suit, side-on facing right; the renderer mirrors it to walk left
    walk1: [
        E,
        E,
        E,
        ".......SSSS.....",
        "......SSSSSS....",
        "......SSSkeeS...",
        "......SSSSeeS...",
        "......SSSSSSS...",
        ".......SSSSS....",
        "......BBSDSS....",
        ".....BBBSkSSS...",
        ".....SBBSDSB.S..",
        "......BBBBB.....",
        ".....BB...BB....",
        "....BB.....BB...",
        "...SS.......SSS.",
    ],
    walk2: [
        E,
        E,
        E,
        ".......SSSS.....",
        "......SSSSSS....",
        "......SSSkeeS...",
        "......SSSSeeS...",
        "......SSSSSSS...",
        ".......SSSSS....",
        "......BBSDSS....",
        "......BBSkSS....",
        "......BSSDSS....",
        "......BBBBB.....",
        "......BB.BB.....",
        "......BB.BB.....",
        ".....SSS.SSS....",
    ],
    // the suit, front-on: the small black spider on the chest, the eyes framed at their outer corners
    stand: [
        E,
        E,
        "......SSSSS.....",
        ".....SSSDSSS....",
        ".....keeDeek....",
        ".....SeeDeeS....",
        "......SSDSS.....",
        "....BSSSSSSSB...",
        "....BSSkSkSSB...",
        "....BSSSkSSSB...",
        "....BSSkSkSSB...",
        "....S.BBBBB.S...",
        ".....BB...BB....",
        ".....BB...BB....",
        ".....BB...BB....",
        "....SSS...SSS...",
    ],
    // the hero landing: one fist down, the other arm back
    sit: [
        E,
        E,
        E,
        E,
        E,
        E,
        "......SSSSS.....",
        ".....SSSDSSS....",
        ".....keeDeek....",
        ".....SeeDeeS..BS",
        "......SSDSS.BB..",
        "....BSSSSSSB....",
        "...BSSkSkSSB....",
        "..SBBSSkSSBBB...",
        "..S..BBBBB..BB..",
        "..S.SSS.....SSS.",
    ],
    // Peter Parker at rest: messy hair, glasses, the shirt open on the suit, jeans
    sleep: [
        E,
        E,
        "......H.H.......",
        ".....HHHHHH.....",
        ".....HHHHHHHH...",
        ".....HpppppH....",
        ".....gppgppg....",
        ".....ppppppp....",
        ".....ppppppp....",
        "......ppppp.....",
        "....vvSSkSSvv...",
        "....pvSSSSSvp...",
        ".....vSSSSSv....",
        "....BBBBBBBBB...",
        "....BBBBBBBBB...",
        "....BBBBBBBBBss.",
    ],
    // lids down, hands on the knees
    tired: [
        E,
        E,
        E,
        "......SSSSS.....",
        ".....SSSDSSS....",
        ".....kkkDkkk....",
        ".....SeeDeeS....",
        "......SSDSS.....",
        "....BSSSSSSSB...",
        "....BSSkSkSSB...",
        "....BSSSkSSSB...",
        "....BBBBBBBBB...",
        "....SB.....BS...",
        "....BB.....BB...",
        ".....B.....B....",
        "....SSS...SSS...",
    ],
    // the thwip: side-on, crouched and leaning into the shot, the back hand on the ground
    speak: [
        E,
        E,
        "...............x",
        "..............x.",
        ".......SSSS..x..",
        "......SSkeeSS...",
        "......SSSeeBS...",
        ".......SSSBB....",
        "....BSSSSB......",
        "...BSSkSSB......",
        "..B.SSSkB.......",
        ".S..BBBBB.......",
        "...BB...BB......",
        "..BB.....BB.....",
        ".BB.....BB......",
        ".SS....SSS......",
    ],
    // being dragged: one hand up on the strand (column 12), legs hanging
    dangle: [
        "............S...",
        "............B...",
        "......SSSSS.B...",
        ".....SSSDSSSB...",
        ".....keeDeekB...",
        ".....SeeDeeSB...",
        "......SSDSSB....",
        "....BSSSSSSB....",
        "....BSSkSkSS....",
        "....BSSSkSSS....",
        "....SSSkSkSS....",
        "......BBBBB.....",
        ".....BB..BB.....",
        ".....BB...BB....",
        "....BB....BB....",
        "....SS.....SS...",
    ],
    // Pastimes, as Sprout's. Reading: sat with a book on his lap
    read1: [
        E,
        E,
        "......H.H.......",
        ".....HHHHHH.....",
        ".....HHHHHHHH...",
        ".....HpppppH....",
        ".....gkegkeg....",
        ".....ppppppp....",
        ".....pppkppp....",
        "......ppppp.....",
        "....vvSSkSSvv...",
        "....pvSSSSSvp...",
        ".....vSSSSSv....",
        "..prwwwwrwwwwrp.",
        "...rmmwwrmmwwr..",
        "...rrrrrrrrrrss.",
    ],
    read2: [
        E,
        E,
        "......H.H.......",
        ".....HHHHHH.....",
        ".....HHHHHHHH...",
        ".....HpppppH....",
        ".....gekgekg....",
        ".....ppppppp....",
        ".....pppkppp....",
        "......ppppp.....",
        "....vvSSkSSvv...",
        "....pvSSSSSvp...",
        ".....vSSSSSv....",
        "..prwwwwrwwwwrp.",
        "...rwwmmrwwmmr..",
        "...rrrrrrrrrrss.",
    ],
    // listening to music
    music1: [
        "............yy..",
        "..yy........y...",
        ".yy..mmmmmm.yy..",
        "....mHHHHHHm....",
        "...rrHHHHHHHrr..",
        "...rrHpppppHrr..",
        "...rrgekgekrr...",
        ".....ppppppp....",
        ".....ppkkkpp....",
        "......ppppp.....",
        "....vvSSkSSvv...",
        "....pvSSSSSvp...",
        ".....vSSSSSv....",
        ".....BBBBBBB....",
        ".....BB...BB....",
        "....ss....ss....",
    ],
    music2: [
        "..yy............",
        "..y.........yy..",
        ".yy..mmmmmm.y...",
        "....mHHHHHHm....",
        "...rrHHHHHHHrr..",
        "...rrHpppppHrr..",
        "...rrgekgekrr...",
        ".....ppppppp....",
        ".....ppkkkpp....",
        "......ppppp.....",
        "....vvSSkSSvv...",
        "....pvSSSSSvp...",
        ".....vSSSSSv....",
        ".....BBBBBBB....",
        ".....BB..BB.....",
        "....ss....ss....",
    ],
    // working at a laptop seen side-on, a key lit as it types and the code mark over his head
    work1: [
        ".......w...w.w..",
        "......w...w...w.",
        ".......w.w...w..",
        E,
        "......SSSSS...m.",
        ".....SSSDSSS.lm.",
        ".....keeDeek.lm.",
        ".....SeeDeeS.lm.",
        "......SSDSS..lm.",
        "....BSSSSSSSBlm.",
        "....BSSkSkSSSlm.",
        "....BSSSkSSS.lm.",
        "....BSSkSkSS.lm.",
        "......BBBBB.mwmm",
        ".....BB...BB....",
        "....SSS...SSS...",
    ],
    work2: [
        ".......m...m.m..",
        "......m...m...m.",
        ".......m.m...m..",
        E,
        "......SSSSS...m.",
        ".....SSSDSSS.wm.",
        ".....keeDeek.wm.",
        ".....SeeDeeS.wm.",
        "......SSDSS..wm.",
        "....BSSSSSSSBwm.",
        "....BSSkSkSSSwm.",
        "....BSSSkSSS.wm.",
        "....BSSkSkSS.wm.",
        "......BBBBB.mmwm",
        ".....BB...BB....",
        "....SSS...SSS...",
    ],
    // playing sport: dribbling a ball at his side, high then low
    ball1: [
        E,
        E,
        "......H.H.......",
        ".....HHHHHH.....",
        ".....HHHHHHHH...",
        ".....HpppppH....",
        ".....gekgekg....",
        ".....ppppppp.rr.",
        ".....pppkppprrrr",
        "......ppppp.rrrr",
        "....vvSSkSSvvrr.",
        "....pvSSSSSvp...",
        ".....vSSSSSv....",
        ".....BBBBBBB....",
        ".....BB...BB....",
        "....ss....ss....",
    ],
    ball2: [
        E,
        E,
        "......H.H.......",
        ".....HHHHHH.....",
        ".....HHHHHHHH...",
        ".....HpppppH....",
        ".....gekgekg....",
        ".....ppppppp....",
        ".....pppkppp....",
        "......ppppp.....",
        "....vvSSkSSvv...",
        "....pvSSSSSvp...",
        ".....vSSSSSv.rr.",
        ".....BBBBBBBrrrr",
        ".....BB...BBrrrr",
        "....ss....ss.rr.",
    ],
};

// Upside down already: boots wrapped on the strand (column 8) at the top, knees bent out, hands on the strand, the
// head at the bottom.
export const SPIDEY_HANG: readonly string[] = [
    ".......SxS......",
    ".......SxS......",
    "......B.x.B.....",
    ".....B..x..B....",
    "....B...x...B...",
    ".....B..x..B....",
    "......BSxSB.....",
    "......BBBBB.....",
    ".....BSSSSSB....",
    ".....BSkSkSB....",
    ".....SSSkSSS....",
    ".....SSkSkSS....",
    "......SDSDS.....",
    ".....SeeDeeS....",
    ".....keeDeek....",
    "......SSDSS.....",
];

// Two frames, upside down, belly to the app bar's underside, side-on facing right: one body, boots and gloves on the
// bar, the head with its eye at the front. The frames swap which leg and arm reach ahead. The unread mark's cells stay clear.
export const SPIDEY_CRAWL: readonly (readonly string[])[] = [
    [
        "SS..........SS..",
        ".BB.........B...",
        "..BB.......BB...",
        "..BBSSSSSSBBSSS.",
        "...BSDSSDSSSSSSS",
        "...BBSSSSSSSDeeS",
        "....BBBBBB.SDeeS",
        "...........SSSS.",
        E,
        E,
        E,
        E,
        E,
        E,
        E,
        E,
    ],
    [
        "....SS...SS.....",
        "....BB....B.....",
        "...BB.....BB....",
        "..BBSSSSSSBBSSS.",
        "...BSDSSDSSSSSSS",
        "...BBSSSSSSSDeeS",
        "....BBBBBB.SDeeS",
        "...........SSSS.",
        E,
        E,
        E,
        E,
        E,
        E,
        E,
        E,
    ],
];

// The web-swing's body (petwebswing.ts): slung along the strand, the hand up at column 10, knees tucked.
export const SPIDEY_SWING: readonly string[] = [
    "..........S.....",
    "..........B.....",
    "....SSS..B......",
    "...SSSSSB.......",
    "...SSkeeB.......",
    "...SSSeeSB......",
    "....SSSSSB......",
    "...BSSkSSB......",
    "..BBSSkkSB......",
    ".SB.BSSkSB......",
    "....BBBBBB......",
    "...BB..BB.......",
    "..BB..BB........",
    ".SS..SS.........",
    E,
    E,
];

export type SpideyLook = "suit" | "peter";

export const SPIDEY_LOOK: Record<PetPose, SpideyLook> = {
    walk1: "suit",
    walk2: "suit",
    stand: "suit",
    speak: "suit",
    tired: "suit",
    dangle: "suit",
    work1: "suit",
    work2: "suit",
    sit: "suit",
    sleep: "peter",
    read1: "peter",
    read2: "peter",
    music1: "peter",
    music2: "peter",
    ball1: "peter",
    ball2: "peter",
};

// The fold's rooftop scene, 20x20 cells: he sits front-on on the edge, hands on the ledge, legs over the front.
const FOLD_TOP: readonly string[] = [
    "....................",
    "....................",
    ".......SSSSS........",
    "......SSSDSSS.......",
    "......keeDeek.......",
    "......SeeDeeS.......",
    ".......SSDSS........",
    ".....BSSSSSSSB......",
    ".....BSSkSkSSB......",
    ".....BSSSkSSSB......",
    ".....BSSkSkSSB......",
    ".....S.BBBBB.S......",
];
// the legs over the ledge, two frames of a swing
const FOLD_LEGS: readonly (readonly string[])[] = [
    ["..cccccBBcBBccccccc.", "..CCCCCBBCBBCCCCCCC.", "..MMMNMBBMBBMMMNMMM.", "..MMMMMSSMSSMMMMMMM."],
    ["..cccccBBccBBcccccc.", "..CCCCCBBCCBBCCCCCC.", "..MMMNBBMMMMBBMNMMM.", "..MMMMSSMMMMSSMMMMM."],
];
// the four windows' left columns; each is 2x2, on rows 17 and 18
const FOLD_WINDOWS = [3, 7, 11, 15];
// the brick rows above and below the windows
const FOLD_TOP_WALL = ["..MMMMMMMMMMMMMMMMM.", "..MMMNMMMMMMMNMMMMM."];

/** The rooftop scene: the first min(lit, 4) windows lit, the legs in the swing's first or second frame. */
export function spideyFold(lit: number, swing: boolean): readonly string[] {
    const windows = [..."..MMMMMMMMMMMMMMMMM."];
    FOLD_WINDOWS.forEach((x, i) => {
        windows[x] = windows[x + 1] = i < lit ? "L" : "Q";
    });
    const row = windows.join("");
    return [...FOLD_TOP, ...FOLD_LEGS[swing ? 1 : 0], FOLD_TOP_WALL[0], row, row, FOLD_TOP_WALL[1]];
}

// Spider-sense: amber jags either side of the head and over it, drawn in --color-asking when something waits on you
export const SPIDEY_SENSE: readonly { x: number; y: number }[] = [
    { x: 5, y: 1 },
    { x: 4, y: 2 },
    { x: 5, y: 3 },
    { x: 13, y: 1 },
    { x: 14, y: 2 },
    { x: 13, y: 3 },
    { x: 8, y: 0 },
    { x: 10, y: 0 },
];

// Each mark is a shape stamped at a fixed cell, never a count: the creature does not draw a number (pet spec
// §3), and each pairs its colour with a shape because status is never colour alone (DESIGN.md). Every one
// sits clear of the body of the pose it is stamped on (sprout spec §2), so stamping never hides a pixel.
export const MARKS: Record<PetMark, { x: number; y: number; rows: readonly string[] }> = {
    // review gate, on stand: an eye — "look at this"
    gate: { x: 11, y: 0, rows: [".www.", "wwkww", ".www."] },
    // escalation, on stand: !
    escalation: { x: 13, y: 0, rows: ["rr", "rr", "rr", "..", "rr"] },
    // blocked worker, on stand: ?
    blocked: { x: 13, y: 0, rows: ["yyy", "..y", ".yy", "...", ".y."] },
    // sleep, on sleep
    z: { x: 11, y: 0, rows: ["mmmm", "..m.", ".m..", "mmmm"] },
    // sweat drop, on tired
    drop: { x: 14, y: 4, rows: ["l.", "ll", "ll"] },
    // unread, on any pose
    unread: { x: 1, y: 5, rows: ["bb", "bb"] },
};

const isBody = (code: string | undefined) => code === "b" || code === "l";

// The shirt's star: a point up, the arms across, two legs.
const FLAG_STAR = ["..Y..", "..Y..", "YYYYY", ".YYY.", ".Y.Y."];
// The Minion's overalls are three rows, so its star is the point, the arms and the legs.
const MINION_STAR = ["..Y..", "YYYYY", ".Y.Y."];

// Stamps a star onto the shirt's red cells, its point centred on the shirt's first row.
function stampStar(g: string[][], top: number, star: readonly string[]): void {
    const shirt = g[top].flatMap((code, x) => (code === "R" ? [x] : []));
    const x0 = Math.floor((shirt[0] + shirt[shirt.length - 1]) / 2) - Math.floor(star[0].length / 2);
    star.forEach((row, dy) =>
        [...row].forEach((code, dx) => {
            if (code === "Y" && g[top + dy]?.[x0 + dx] === "R") {
                g[top + dy][x0 + dx] = "Y";
            }
        })
    );
}

// The flag shirt over a pose. Below today's face the body is three rows, too short for a star that reads as one, so
// the face (eyes, and the mouth while speaking) moves up two rows and every body cell below it becomes the shirt,
// with the star's point centred on its first row. Only recolours: the outline and the sprout stay as they are, so
// the marks still sit clear of the body and the creature still stands on the ledge.
function dressInFlag(rows: readonly string[]): string[] {
    const g = rows.map((row) => [...row]);
    const face: [number, number][] = [];
    rows.forEach((row, y) => [...row].forEach((code, x) => code === "k" && face.push([x, y])));
    for (const [x, y] of face) {
        g[y][x] = "b";
    }
    for (const [x, y] of face) {
        if (isBody(g[y - 2]?.[x])) {
            g[y - 2][x] = "k";
        }
    }
    const top = Math.max(...face.map(([, y]) => y - 2)) + 1;
    for (let y = top; y < PET_GRID; y++) {
        for (let x = 0; x < PET_GRID; x++) {
            if (isBody(g[y][x])) {
                g[y][x] = "R";
            }
        }
    }
    stampStar(g, top, FLAG_STAR);
    return g.map((row) => row.join(""));
}

// The flag shirt on the Minion: its overalls are the shirt, so only they turn red and the face stays where it is. A
// pose with no overalls showing (reading, the book on its lap) is left as it is.
function dressMinionInFlag(rows: readonly string[]): readonly string[] {
    const g = rows.map((row) => [...row].map((code) => (code === "o" || code === "O" ? "R" : code)));
    const top = g.findIndex((row) => row.includes("R"));
    if (top < 0) {
        return rows;
    }
    stampStar(g, top, MINION_STAR);
    return g.map((row) => row.join(""));
}

// The flag shirt on Spider-Man: Peter's open shirt turns red, with no star (it has no three-row panel to hold one); a
// suit is a suit, so a pose in it is left as it is.
function dressSpideyInFlag(rows: readonly string[]): readonly string[] {
    return rows.some((row) => row.includes("v")) ? rows.map((row) => row.replace(/v/g, "R")) : rows;
}

const DRESSED = {} as Record<PetPose, readonly string[]>;
const MINION_DRESSED = {} as Record<PetPose, readonly string[]>;
const SPIDEY_DRESSED = {} as Record<PetPose, readonly string[]>;
for (const pose of Object.keys(POSES) as PetPose[]) {
    DRESSED[pose] = dressInFlag(POSES[pose]);
    MINION_DRESSED[pose] = dressMinionInFlag(MINION_POSES[pose]);
    SPIDEY_DRESSED[pose] = dressSpideyInFlag(SPIDEY_POSES[pose]);
}

/** A pose's grid in an outfit: dressed in the shirt, else the pose itself (the flag is held, not worn). */
export function outfitRows(
    pose: PetPose,
    outfit: PetOutfit | null,
    character: PetCharacter = "sprout"
): readonly string[] {
    if (character === "spidey") {
        return outfit === "vn-shirt" ? SPIDEY_DRESSED[pose] : SPIDEY_POSES[pose];
    }
    if (character === "minion") {
        return outfit === "vn-shirt" ? MINION_DRESSED[pose] : MINION_POSES[pose];
    }
    return outfit === "vn-shirt" ? DRESSED[pose] : POSES[pose];
}

// How many rows the flag rises above the sprite's top: its cloth flies over the head, where the grid has no room for
// a star that reads as one. The renderer lets the svg overflow upward to draw it.
export const PET_FLAG_RISE = 4;

// The 9×7 cloth: the full star inside a one-cell red border.
const FLAG_CLOTH = ["RRRRRRRRR", "RRRRYRRRR", "RRRRYRRRR", "RRYYYYYRR", "RRRYYYRRR", "RRRYRYRRR", "RRRRRRRRR"];

// The flag held at its left: the pole in column 0 from the cloth's top down to the ledge, the cloth beside it. Drawn
// behind the body and never mirrored, so it stays on the left whichever way the creature walks, clear of the marks
// stamped at the right; where the body crosses it (the dangling sprout), the body is on top.
const FLAG_CELLS: PetCell[] = [];
for (let y = -PET_FLAG_RISE; y < PET_GRID; y++) {
    FLAG_CELLS.push({ x: 0, y, token: "--color-muted" });
}
FLAG_CLOTH.forEach((row, dy) =>
    [...row].forEach((code, dx) =>
        FLAG_CELLS.push({ x: 1 + dx, y: dy - PET_FLAG_RISE, token: PET_TOKENS[code as PetCode] })
    )
);

export interface PetCell {
    x: number;
    y: number;
    token: string;
}

function stamp(rows: readonly string[], x0: number, y0: number, out: PetCell[]): void {
    rows.forEach((row, dy) => {
        for (let dx = 0; dx < row.length; dx++) {
            const code = row[dx];
            if (code !== ".") {
                out.push({ x: x0 + dx, y: y0 + dy, token: PET_TOKENS[code as PetCode] });
            }
        }
    });
}

/**
 * The drawn cells of a pose and its marks, in grid cells (multiply by PET_CELL_PX for px).
 *
 * The pose's cells and the marks' cells come back apart because the renderer mirrors only the body when the
 * creature walks left: a `?` drawn inside the mirrored group would read backwards. Marks are a set — naming
 * one twice draws it once — so there is no way to stack them into a tally. `back` is drawn under the body and,
 * like the marks, never mirrored: the flag in hand, whose cloth rises above row 0 (PET_FLAG_RISE). `character` picks
 * whose grids the pose is drawn from; the marks and the flag are the same for each.
 */
export function spriteFor(
    pose: PetPose,
    marks: readonly PetMark[],
    outfit: PetOutfit | null = null,
    character: PetCharacter = "sprout"
): PetSprite {
    // drawn first, under the body: the flag in hand
    const back = outfit === "vn-flag" ? [...FLAG_CELLS] : [];
    const body: PetCell[] = [];
    stamp(outfitRows(pose, outfit, character), 0, 0, body);
    const overlay: PetCell[] = [];
    for (const mark of new Set(marks)) {
        const { x, y, rows } = MARKS[mark];
        stamp(rows, x, y, overlay);
    }
    return { back, body, overlay };
}

export interface PetSprite {
    back: PetCell[];
    body: PetCell[];
    overlay: PetCell[];
}

/** A grid that is not a PetPose (Spider-Man's hang, crawl, swing) drawn as spriteFor draws a pose: body and marks. */
export function spriteOfRows(rows: readonly string[], marks: readonly PetMark[]): PetSprite {
    const body: PetCell[] = [];
    stamp(rows, 0, 0, body);
    const overlay: PetCell[] = [];
    for (const mark of new Set(marks)) {
        const { x, y, rows: m } = MARKS[mark];
        stamp(m, x, y, overlay);
    }
    return { back: [], body, overlay };
}
