// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Whether a transcript view follows new turns. A running session's transcript grows while it is read; the view stays
// at the end as it grows only while the reader is there, so scrolling up to read an earlier turn is never yanked back.

// how far above the very end still counts as at the end (a line or two of text)
export const FOLLOW_SLACK_PX = 80;

/** Pure: is a scroll container at (or within the slack of) its end? */
export function atBottom(el: { scrollHeight: number; scrollTop: number; clientHeight: number }): boolean {
    return el.scrollHeight - el.scrollTop - el.clientHeight <= FOLLOW_SLACK_PX;
}
