import { describe, expect, it } from "vitest";
import type { AgentActionEntry } from "./agentsviewmodel";
import {
    boardCardView,
    boardDrawAnchor,
    boardDrawName,
    boardsDrawn,
    forwardChip,
    wordsOf,
    type BoardDrawAnchor,
} from "./chatboard";
import type { AgentPart } from "./chatmodel";

describe("boardDrawName", () => {
    it("reads the board of a wsh board draw call, bare or quoted", () => {
        expect(boardDrawName('wsh board draw --board wavesrv-startup --context "how it starts"')).toBe(
            "wavesrv-startup"
        );
        expect(boardDrawName('wsh board draw --board "wavesrv startup" --ask "add the auth key"')).toBe(
            "wavesrv startup"
        );
        expect(boardDrawName("wsh board draw --board 'Auth flow' --ask x")).toBe("Auth flow");
        expect(boardDrawName("wsh board draw --board=startup --ask x")).toBe("startup");
        expect(boardDrawName('wsh board draw --board="Auth flow" --ask x')).toBe("Auth flow");
    });

    it("finds the flag wherever it sits among the others", () => {
        expect(boardDrawName('wsh board draw --ask "one more box" --board startup')).toBe("startup");
        expect(boardDrawName('wsh board draw --context "see --board decoy" --board startup')).toBe("startup");
    });

    it("takes wsh through a path, wsh.exe, quotes, and after cd or an assignment", () => {
        expect(boardDrawName("~/.arc/bin/wsh board draw --board a --ask x")).toBe("a");
        expect(boardDrawName("/c/Users/me/.arc/bin/wsh.exe board draw --board a --ask x")).toBe("a");
        expect(boardDrawName("C:\\Users\\me\\.arc\\bin\\wsh.exe board draw --board a --ask x")).toBe("a");
        expect(boardDrawName('"wsh" board draw --board a --ask x')).toBe("a");
        expect(boardDrawName("'/opt/arc bin/wsh' board draw --board a --ask x")).toBe("a");
        expect(boardDrawName("cd /work/app && wsh board draw --board a --ask x")).toBe("a");
        expect(boardDrawName("cd app; wsh board draw --board a --ask x")).toBe("a");
        expect(boardDrawName("ARC_DEBUG=1 wsh board draw --board a --ask x")).toBe("a");
        expect(boardDrawName("echo start && (wsh board draw --board a --ask x)")).toBe("a");
        expect(boardDrawName('out=$(wsh board draw --board a --ask "x")')).toBe("a");
        expect(boardDrawName("wsh board draw --board a --ask x 2>&1 | tail -3")).toBe("a");
    });

    it("keeps an escaped quote of a quoted name", () => {
        expect(boardDrawName('wsh board draw --board "the \\"auth\\" flow" --ask x')).toBe('the "auth" flow');
    });

    it("reads the line a multi-line command puts it on", () => {
        expect(boardDrawName('wsh board draw \\\n  --board "Auth flow" \\\n  --ask "x"')).toBe("Auth flow");
        expect(boardDrawName("echo hi\nwsh board draw --board a --ask x")).toBe("a");
    });

    it("is not another program's words, nor another wsh command", () => {
        expect(boardDrawName("echo wsh board draw --board a")).toBeNull();
        expect(boardDrawName('grep "wsh board draw" notes.md --board a')).toBeNull();
        expect(boardDrawName("git commit -m 'wsh board draw --board a'")).toBeNull();
        expect(boardDrawName("wsh board list --board a")).toBeNull();
        expect(boardDrawName("wsh boards draw --board a")).toBeNull();
        expect(boardDrawName("wsh board drawing --board a")).toBeNull();
        expect(boardDrawName("mywsh board draw --board a")).toBeNull();
        expect(boardDrawName("wsh council start --board a")).toBeNull();
    });

    it("has no board when the call names none or an empty one", () => {
        expect(boardDrawName('wsh board draw --ask "x"')).toBeNull();
        expect(boardDrawName("wsh board draw --board")).toBeNull();
        expect(boardDrawName('wsh board draw --board "" --ask x')).toBeNull();
        expect(boardDrawName("wsh board draw --board --ask x")).toBeNull();
        expect(boardDrawName("")).toBeNull();
    });
});

const bash = (over: Partial<AgentActionEntry> = {}): AgentActionEntry => ({
    kind: "action",
    verb: "ran",
    target: "",
    ...over,
});

describe("boardDrawAnchor", () => {
    it("reads a finished call from the command its result carries", () => {
        const a = bash({
            target: "Draw how wavesrv starts",
            outcome: "ok",
            detail: {
                kind: "bash",
                command: 'wsh board draw --board wavesrv-startup --context "x"',
                output: 'Drawn on board "wavesrv-startup": +9 shapes, 0 changed, 0 removed.',
                exit: 0,
            },
        });
        expect(boardDrawAnchor(a)).toEqual<BoardDrawAnchor>({ board: "wavesrv-startup" });
    });

    it("reads a call still running, which has no result yet, from its command or its target", () => {
        expect(boardDrawAnchor(bash({ target: "wsh board draw --board startup --ask x" }))).toEqual({
            board: "startup",
        });
        // Claude's Bash `description` is the target, and the command rides beside it
        expect(
            boardDrawAnchor(
                bash({ target: "Draw the startup", command: 'wsh board draw --board startup --context "how"' })
            )
        ).toEqual({ board: "startup" });
    });

    it("is none for a call that never ran or is not wsh board draw", () => {
        expect(
            boardDrawAnchor(bash({ verb: "blocked", outcome: "blocked", target: "wsh board draw --board a --ask x" }))
        ).toBeNull();
        expect(boardDrawAnchor(bash({ target: "wsh council start --feature x" }))).toBeNull();
        // another tool's target is its pattern or a path, never a command
        expect(boardDrawAnchor(bash({ verb: "grep", target: "wsh board draw --board a" }))).toBeNull();
        expect(boardDrawAnchor(bash({ verb: "read", target: "wsh board draw --board a" }))).toBeNull();
    });
});

describe("boardsDrawn", () => {
    const draw = (board: string, n: number): AgentPart => ({ kind: "boarddraw", key: `boarddraw:${n}`, board });

    it("lists each board once, in the order the turn first drew on it", () => {
        expect(boardsDrawn([draw("startup", 1), draw("auth", 3), draw("startup", 5)])).toEqual(["startup", "auth"]);
    });

    it("counts a name by the board find-by-name would find, and keeps the first spelling", () => {
        expect(boardsDrawn([draw("Auth Flow", 1), draw(" auth flow ", 2)])).toEqual(["Auth Flow"]);
    });

    it("skips every part that is not a board draw", () => {
        const parts: AgentPart[] = [{ kind: "prose", text: "hi" }, draw("a", 2)];
        expect(boardsDrawn(parts)).toEqual(["a"]);
        expect(boardsDrawn([])).toEqual([]);
    });
});

describe("boardCardView", () => {
    const info = (over: Partial<BoardInfo> = {}): BoardInfo => ({
        id: "b1",
        name: "wavesrv-startup",
        project: "arcterm",
        path: "/x/b1.excalidraw",
        createdts: 1,
        activets: 2,
        shapes: 9,
        ...over,
    });
    const turn = (over: Partial<BoardTurn> = {}): BoardTurn => ({
        id: "t1",
        ts: 1,
        kind: "request",
        state: "answered",
        ...over,
    });
    const talk = (...turns: BoardTurn[]): BoardTalk => ({ project: "arcterm", boardid: "b1", turns });
    const NOW = 1_000_000;

    it("says the board's name and its shape count", () => {
        expect(boardCardView(info(), talk(turn()), NOW)).toEqual({
            name: "wavesrv-startup",
            boardId: "b1",
            project: "arcterm",
            facts: "9 shapes",
            drawing: false,
        });
        expect(boardCardView(info({ shapes: 1 }), null, NOW)?.facts).toBe("1 shape");
    });

    it("reads drawing… while the board's last request is waiting or answering", () => {
        for (const state of ["waiting", "answering"]) {
            const view = boardCardView(info(), talk(turn({ state })), NOW);
            expect(view).toMatchObject({ drawing: true, facts: "9 shapes · drawing…" });
        }
        // a request past the slow mark is still the drawer working
        expect(boardCardView(info(), talk(turn({ state: "answering", startedts: NOW - 60_000 })), NOW)?.drawing).toBe(
            true
        );
    });

    it("reads the last request, not a later ask of yours", () => {
        const view = boardCardView(
            info(),
            talk(turn({ id: "r", state: "answered" }), turn({ id: "a", kind: "ask", state: "answering" })),
            NOW
        );
        expect(view?.drawing).toBe(false);
        const running = boardCardView(
            info(),
            talk(turn({ id: "r", state: "answering" }), turn({ id: "a", kind: "ask", state: "answered" })),
            NOW
        );
        expect(running?.drawing).toBe(true);
    });

    it("is not drawing once the last request failed or was stopped", () => {
        expect(boardCardView(info(), talk(turn({ state: "failed" })), NOW)?.drawing).toBe(false);
        expect(boardCardView(info(), talk(turn({ state: "stopped" })), NOW)?.drawing).toBe(false);
    });

    it("says only drawing… for a board with nothing on it yet", () => {
        expect(boardCardView(info({ shapes: 0 }), talk(turn({ state: "answering" })), NOW)?.facts).toBe("drawing…");
        expect(boardCardView(info({ shapes: undefined }), null, NOW)?.facts).toBe("0 shapes");
    });

    it("has no card for a board the list does not hold", () => {
        expect(boardCardView(undefined, talk(turn()), NOW)).toBeNull();
    });
});

describe("forwardChip", () => {
    it("reads from <board> · on <shapes>", () => {
        expect(forwardChip({ board: "Auth flow", on: "Login box, Token store", turnId: "t1", question: "why?" })).toBe(
            "from Auth flow · on Login box, Token store"
        );
    });

    it("leaves out · on … when nothing was selected", () => {
        expect(forwardChip({ board: "Auth flow", on: "", turnId: "t1", question: "why?" })).toBe("from Auth flow");
    });
});

describe("wordsOf", () => {
    it("is your words without the marker line when the message is a forward", () => {
        expect(wordsOf('[From board "Auth flow" · on Login box · turn t-1]\nwhy two stores?')).toBe("why two stores?");
    });

    it("is the message itself otherwise", () => {
        expect(wordsOf("why two stores?")).toBe("why two stores?");
        expect(wordsOf("")).toBe("");
    });
});
