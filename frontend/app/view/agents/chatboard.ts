// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The pure half of what Chat shows of a board (docs/superpowers/specs/2026-11-19-kael-boards-design.md): which
// `wsh board draw` call drew on which board, the card each board gets at the end of the turn, and the chip a question
// forwarded from a board wears over your words. The card draws in chatboardcard.tsx; the stores it reads are the boards'
// own (view/boards/boardstore.ts), and the chip's marker is boardforwardmarker.ts's.

import { parseBoardForward, type BoardForward } from "../boards/boardforwardmarker";
import { KIND_REQUEST, turnView } from "../boards/boardtalkmodel";
import type { AgentActionEntry } from "./agentsviewmodel";
import type { AgentPart } from "./chatmodel";

/** What a `wsh board draw` call names: the board it draws on, as the command spells it. */
export interface BoardDrawAnchor {
    board: string;
}

// ---- finding the call ----

const OPERATORS = new Set([";", "&", "|", "(", ")", "`", "\n"]);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const WSH_PROGRAM = /(?:^|[\\/])wsh(?:\.exe)?$/i;

// A command line as the shell reads it, cut into simple commands (at ; & | ( ) a backtick and a newline) of words with
// their quotes off: `cd x && wsh board draw --board "A b"` is [["cd", "x"], ["wsh", "board", "draw", "--board", "A b"]].
// Not a shell: no expansion, and a backslash only escapes a quote, a space or a newline, so a Windows path stays whole.
function simpleCommands(line: string): string[][] {
    const commands: string[][] = [];
    let words: string[] = [];
    let word = "";
    let inWord = false; // an empty pair of quotes is a word too
    const endWord = () => {
        if (inWord) {
            words.push(word);
        }
        word = "";
        inWord = false;
    };
    const endCommand = () => {
        endWord();
        if (words.length > 0) {
            commands.push(words);
        }
        words = [];
    };
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === "'") {
            inWord = true;
            const end = line.indexOf("'", i + 1);
            word += line.slice(i + 1, end < 0 ? line.length : end);
            i = end < 0 ? line.length : end;
        } else if (c === '"') {
            inWord = true;
            for (i++; i < line.length && line[i] !== '"'; i++) {
                const next = line[i + 1];
                if (line[i] === "\\" && (next === '"' || next === "\\" || next === "$" || next === "`")) {
                    word += next;
                    i++;
                } else {
                    word += line[i];
                }
            }
        } else if (c === "\\" && (line[i + 1] === "\n" || (line[i + 1] === "\r" && line[i + 2] === "\n"))) {
            // a line continuation joins the lines
            endWord();
            i += line[i + 1] === "\r" ? 2 : 1;
        } else if (c === "\\" && (line[i + 1] === " " || line[i + 1] === '"' || line[i + 1] === "'")) {
            inWord = true;
            word += line[++i];
        } else if (OPERATORS.has(c)) {
            endCommand();
        } else if (c === " " || c === "\t" || c === "\r") {
            endWord();
        } else {
            inWord = true;
            word += c;
        }
    }
    endCommand();
    return commands;
}

// the value of `--board` among the words after `wsh board draw`, as cobra reads it: the next word, or after an `=`
function boardFlag(words: readonly string[]): string | null {
    for (let i = 0; i < words.length; i++) {
        const w = words[i];
        if (w === "--") {
            return null;
        }
        const value =
            w === "--board" ? words[i + 1] : w.startsWith("--board=") ? w.slice("--board=".length) : undefined;
        if (value !== undefined) {
            // `--board --ask x` names no board: the next flag is not its value
            return value.trim() === "" || value.startsWith("--") ? null : value.trim();
        }
    }
    return null;
}

/** Pure: the board a `wsh board draw` command draws on, as `--board` spells it (quoted or bare, `--board=x` too), or null
 *  for any other command: `wsh` must be the program itself (through a path, as `wsh.exe`, quoted, after `cd x &&`, an
 *  assignment or a `$(` ), not a word of another program's line (`echo wsh board draw`), and the call must name a board. */
export function boardDrawName(command: string): string | null {
    // the check every Bash call of a long transcript pays: most are nothing like it
    if (!command.includes("wsh") || !command.includes("board")) {
        return null;
    }
    for (const all of simpleCommands(command)) {
        const program = all.findIndex((w) => !ASSIGNMENT.test(w));
        const words = program < 0 ? [] : all.slice(program);
        if (words.length < 3 || !WSH_PROGRAM.test(words[0]) || words[1] !== "board" || words[2] !== "draw") {
            continue;
        }
        const board = boardFlag(words.slice(3));
        if (board != null) {
            return board;
        }
    }
    return null;
}

/** Pure: the board a Bash call draws on, or null when the call is something else or never ran. A finished call carries its
 *  command in its result; one still running (a draw waits for the drawer, up to nine minutes) has only `command` (when
 *  Claude gave the call a description) or `target`, which is then the command itself. Only a `ran` call counts: another
 *  tool's target is a pattern or a path. */
export function boardDrawAnchor(action: AgentActionEntry): BoardDrawAnchor | null {
    const detail = action.detail;
    let command: string | undefined;
    if (detail?.kind === "bash") {
        // a refused call has no exit: it never ran
        command = detail.exit === null ? undefined : (detail.command ?? action.command ?? action.target);
    } else if (action.verb === "ran") {
        command = action.command ?? action.target;
    }
    const board = command != null ? boardDrawName(command) : null;
    return board != null ? { board } : null;
}

// ---- the card ----

// how a board is told apart when a name is looked up (findBoardByName): trimmed, any case
const nameKey = (name: string): string => name.trim().toLowerCase();

/** Pure: the boards a turn drew on, each once, in the order its first call drew on it, as the first call spelled it. One
 *  card per board per turn. */
export function boardsDrawn(parts: readonly AgentPart[]): string[] {
    const seen = new Set<string>();
    const boards: string[] = [];
    for (const part of parts) {
        if (part.kind === "boarddraw" && !seen.has(nameKey(part.board))) {
            seen.add(nameKey(part.board));
            boards.push(part.board);
        }
    }
    return boards;
}

/** What the card says of a board. `facts` is the shape count, then `drawing…` while the drawer works on the agent's last
 *  request (only `drawing…` for a board nothing is on yet). */
export interface BoardCardView {
    name: string;
    boardId: string;
    project: string;
    facts: string;
    drawing: boolean;
}

// whether the board's last request is still the drawer's: waiting its turn, answering, or answering past the slow mark
function drawingNow(talk: BoardTalk | null | undefined, now: number): boolean {
    const turns = talk?.turns ?? [];
    for (let i = turns.length - 1; i >= 0; i--) {
        if (turns[i].kind === KIND_REQUEST) {
            const state = turnView(turns[i], now).state;
            return state === "waiting" || state === "answering" || state === "slow";
        }
    }
    return false;
}

/** Pure: the card of a board the list holds (null for a board it does not, which has nothing to open), with `talk` the
 *  board's talk once it is read. It is your own asks that do not count as drawing: only the agent's request does. */
export function boardCardView(
    info: BoardInfo | undefined,
    talk: BoardTalk | null | undefined,
    now: number
): BoardCardView | null {
    if (info == null) {
        return null;
    }
    const shapes = info.shapes ?? 0;
    const drawing = drawingNow(talk, now);
    const facts = [
        ...(shapes > 0 || !drawing ? [`${shapes} shape${shapes === 1 ? "" : "s"}`] : []),
        ...(drawing ? ["drawing…"] : []),
    ];
    return { name: info.name, boardId: info.id, project: info.project, facts: facts.join(" · "), drawing };
}

// ---- the chip ----

/** Pure: the chip over a question forwarded from a board: `from Auth flow · on Login box, Token store`, with no
 *  `· on …` when nothing was selected. */
export function forwardChip(forward: BoardForward): string {
    return forward.on === "" ? `from ${forward.board}` : `from ${forward.board} · on ${forward.on}`;
}

/** Pure: your words in a message that may be a question forwarded from a board: the message without its marker line.
 *  Any other message is its own words. */
export function wordsOf(text: string): string {
    return parseBoardForward(text)?.question ?? text;
}
