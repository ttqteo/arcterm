// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Reads the message wavesrv types into an agent for a forwarded board question: the mirror of
// boardforward.Marker (pkg/boardforward). Chat draws the chip from it and hides the marker line. Pure.

const HEAD = '[From board "';
const ON = " · on ";
const TURN = " · turn ";
const END = "]";

export interface BoardForward {
    board: string;
    on: string; // the selected shapes' labels; "" when none were selected
    turnId: string;
    question: string; // your words, without the marker line
}

// The first line is `[From board "<board>"[ · on <labels>] · turn <id>]`, then your words. Go does not escape the
// board name or the labels, so the id is read from the line's end, and the board name ends at the first `" · on `
// (a board name rarely holds a quote) or, with no selection, at the closing quote.
export function parseBoardForward(text: string): BoardForward | null {
    if (!text.startsWith(HEAD)) {
        return null;
    }
    const nl = text.indexOf("\n");
    const first = nl < 0 ? text : text.slice(0, nl);
    const question = nl < 0 ? "" : text.slice(nl + 1);
    if (!first.endsWith(END)) {
        return null;
    }
    const turnAt = first.lastIndexOf(TURN);
    if (turnAt < HEAD.length) {
        return null;
    }
    const turnId = first.slice(turnAt + TURN.length, first.length - END.length);
    if (turnId === "" || /\s/.test(turnId)) {
        return null;
    }
    const middle = first.slice(HEAD.length, turnAt);
    const onAt = middle.indexOf(`"${ON}`);
    if (onAt >= 0) {
        return { board: middle.slice(0, onAt), on: middle.slice(onAt + 1 + ON.length), turnId, question };
    }
    if (!middle.endsWith('"')) {
        return null;
    }
    return { board: middle.slice(0, -1), on: "", turnId, question };
}
