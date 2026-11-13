// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Whether a pending message's bubble comes in from the box as it mounts (flying from where its text sat, chatsentflight.ts,
// or rising in on motiontokens.ts sentRise): only when it was sent a moment ago, so the eye follows it from the box to the
// conversation. One drawn again later (back to this agent, Terminal back to Chat, the app reloaded) is already there and
// shows at once.

/** How long after the send a pending bubble mounting still counts as the one just sent: the box clears and the bubble
 *  mounts in the same few frames, so this only has to cover a slow render. */
export const SENT_RISE_WINDOW_MS = 1000;

/** True when the bubble of a message sent at `sentAt` mounts at `now` close enough to the send to rise in. */
export function risesFromBox(sentAt: number, now: number): boolean {
    const age = now - sentAt;
    return age >= 0 && age < SENT_RISE_WINDOW_MS;
}
