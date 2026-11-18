// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The surface's shared horizontal metrics. The surface was assembled by merging three destinations
// (Channels, Graph and Tasks) into one Jarvis surface, and every region arrived carrying the padding,
// header height and divider tone it had when it was its own screen. Measured over CDP at a 1500px window,
// the four bands the Stage stacks started their content at four different x: the header at 366 (px-4), the
// record band at 366 (px-4), the thread at 382 (max-w-[900px] px-8) and the composer at 370 (px-5) — and
// the record subject kind added two more (max-w-[720px] px-8, then px-5).
//
// A gutter, not a centred column. Every band starts at the same x because they all carry the same
// horizontal padding, not because each is centred inside a box of the same width. Centring was the first
// fix here and it cost two things:
//
//   - Dead space. A 900px column in a 1250px Stage leaves ~175px empty on each side, and the record's
//     title wrapped to three lines with 350px unused beside it. On a maximised window the gutters are
//     ~360px a side and the evidence table, the file list and the activity rows are all squeezed for it.
//   - A left edge that moved. A centred box lands half a scrollbar left of an identical box in a band that
//     does not scroll, so the record's activity list measured 498 against 503 for the record's own fields
//     directly above it. Padding cannot drift that way: 24 is 24 in every band.
//
// So the Stage fills its width and content decides how much of it to use.
export const STAGE_GUTTER = "w-full px-6";

// Body prose caps itself, because filling is wrong for exactly one kind of content: a paragraph read line by
// line runs past the length an eye can track back to the next line (~90 characters). A table, a file list, a
// field card or an activity row does not, and fills.
//
// Headings are NOT prose for this purpose and are deliberately left uncapped — they are scanned, not read,
// so the measure buys nothing and costs a wrap: capping the record's objective broke a title that fitted on
// one line into two with half the Stage empty beside it. Applies to the record title, both run goals and the
// band labels. In `ch` rather than px so the cap is a character count at whatever size the text is set.
//
// The thread's turns carry their own caps already (jarvisturn.tsx: 560px for a user bubble, 720px for an
// answer), so they need nothing from here.
export const STAGE_PROSE = "max-w-[72ch]";

// The right edge still needs the scrollbar reserved, for the same reason the left edge used to: it takes
// its 8px off the scroller's content box, so a full-width table in a scrolling band would otherwise end
// 8px short of one in a band without a scrollbar. Every band reserves the same 8px — the scrollers by
// having a scrollbar there, the rest by padding. `scroll` rather than `auto` so the reservation does not
// come and go as content grows past one screen; the global track is transparent (tailwindsetup.css), so an
// unused one is invisible.
//
// 8px is not a guess about the platform: ::-webkit-scrollbar is set to exactly that in tailwindsetup.css.
export const STAGE_SCROLLER = "overflow-y-scroll";
export const STAGE_BAND_INSET = "pr-[8px]";

// One header band for all three columns: same height, same rule, same tone. Bands own their own padding —
// the Stage's header pairs this with STAGE_GUTTER, the Subjects column with its own px. Borders stay
// full-bleed (outside the gutter) so a rule still spans its whole column.
export const STAGE_HEADER_BAND = "flex h-11 flex-none items-center border-b border-border bg-surface";
