import { describe, expect, it } from "vitest";
import type { Turn } from "./control-core";
import { controlMsg, deliver, endTurn, steerNotice, takeLines } from "./control-core";

const idle = (): Turn => ({ isOpen: false, unread: [] });
const running = (): Turn => ({ isOpen: true, unread: [] });

function recorder(compactError?: Error, steerError?: Error) {
    const calls: string[][] = [];
    return {
        calls,
        session: {
            submit: async (text: string) => void calls.push(["submit", text]),
            steer: async (text: string) => {
                calls.push(["steer", text]);
                if (steerError) {
                    throw steerError;
                }
            },
            command: async (name: string, args: string) => void calls.push(["command", name, args]),
            compact: async (instructions: string) => {
                calls.push(["compact", instructions]);
                if (compactError) {
                    throw compactError;
                }
            },
        },
    };
}

describe("takeLines", () => {
    it("holds a line back until its newline arrives", () => {
        expect(takeLines('{"text":"a"}\n{"te')).toEqual({ lines: ['{"text":"a"}'], rest: '{"te' });
        expect(takeLines('{"te' + 'xt":"b"}\n')).toEqual({ lines: ['{"text":"b"}'], rest: "" });
    });

    it("drops blank lines and a windows line ending", () => {
        expect(takeLines('{"text":"a"}\r\n\n')).toEqual({ lines: ['{"text":"a"}'], rest: "" });
    });
});

describe("controlMsg", () => {
    it("reads a prompt, newlines kept", () => {
        expect(controlMsg('{"text":"wake: task 1 done\\nwsh jarvis dag status"}')).toEqual({
            text: "wake: task 1 done\nwsh jarvis dag status",
        });
    });

    it("reads a compaction with its instructions", () => {
        expect(controlMsg('{"compact":"Keep: the reasons."}')).toEqual({ compact: "Keep: the reasons." });
    });

    it("takes the compaction from a line that also carries its typed text", () => {
        expect(controlMsg('{"text":"/compact Keep: the reasons.","compact":"Keep: the reasons."}')).toEqual({
            compact: "Keep: the reasons.",
        });
    });

    it("reads a prompt that asks to join the running turn", () => {
        expect(controlMsg('{"text":"stop and rebase","midturn":true}')).toEqual({
            text: "stop and rebase",
            midTurn: true,
        });
    });

    it("ignores a line that asks for nothing", () => {
        expect(controlMsg("not json")).toBeNull();
        expect(controlMsg('{"text":""}')).toBeNull();
        expect(controlMsg('{"other":1}')).toBeNull();
        expect(controlMsg("null")).toBeNull();
    });
});

describe("deliver", () => {
    it("submits plain text as a prompt", async () => {
        const { calls, session } = recorder();
        await deliver(session, { text: "wake: task 1 done\nmore" }, idle());
        expect(calls).toEqual([["submit", "wake: task 1 done\nmore"]]);
    });

    it("runs a leading slash as a command with its arguments", async () => {
        const { calls, session } = recorder();
        await deliver(session, { text: "/compact Keep: the reasons. Drop: tool output." }, idle());
        expect(calls).toEqual([["command", "compact", "Keep: the reasons. Drop: tool output."]]);
    });

    it("runs a bare command with no arguments", async () => {
        const { calls, session } = recorder();
        await deliver(session, { text: "/compact" }, idle());
        expect(calls).toEqual([["command", "compact", ""]]);
    });

    it("compacts through the session when asked for a compaction", async () => {
        const { calls, session } = recorder();
        await deliver(session, { compact: "Keep: the reasons." }, idle());
        expect(calls).toEqual([["compact", "Keep: the reasons."]]);
    });

    it("runs the compact command when the session refuses to compact", async () => {
        const { calls, session } = recorder(new Error("not available in a headless session"));
        await deliver(session, { compact: "Keep: the reasons." }, idle());
        expect(calls).toEqual([
            ["compact", "Keep: the reasons."],
            ["command", "compact", "Keep: the reasons."],
        ]);
    });

    it("joins a mid-turn text to the running turn and holds it as unread", async () => {
        const { calls, session } = recorder();
        const turn = running();
        await deliver(session, { text: "stop and rebase", midTurn: true }, turn);
        expect(calls).toEqual([["steer", "stop and rebase"]]);
        expect(turn.unread).toEqual(["stop and rebase"]);
    });

    it("submits a mid-turn text as a prompt when no turn is running", async () => {
        const { calls, session } = recorder();
        await deliver(session, { text: "stop and rebase", midTurn: true }, idle());
        expect(calls).toEqual([["submit", "stop and rebase"]]);
    });

    it("leaves a text that did not ask for the turn to wait for its end", async () => {
        const { calls, session } = recorder();
        await deliver(session, { text: "wake: task 1 done" }, running());
        expect(calls).toEqual([["submit", "wake: task 1 done"]]);
    });

    it("runs a mid-turn slash as a command", async () => {
        const { calls, session } = recorder();
        await deliver(session, { text: "/clear", midTurn: true }, running());
        expect(calls).toEqual([["command", "clear", ""]]);
    });

    it("submits a text the session refused to join, and no longer holds it", async () => {
        const { calls, session } = recorder(undefined, new Error("a run no plugin may shape"));
        const turn = running();
        await deliver(session, { text: "stop and rebase", midTurn: true }, turn);
        expect(calls).toEqual([
            ["steer", "stop and rebase"],
            ["submit", "stop and rebase"],
        ]);
        expect(turn.unread).toEqual([]);
    });
});

describe("steerNotice", () => {
    it("is one line however the text is broken", () => {
        expect(steerNotice("stop and rebase\n  onto main\n")).toBe("read mid-turn: stop and rebase onto main");
    });
});

describe("endTurn", () => {
    it("closes the turn and hands back what no request carried", () => {
        const turn: Turn = { isOpen: true, unread: ["stop and rebase"] };
        expect(endTurn(turn)).toEqual(["stop and rebase"]);
        expect(turn).toEqual({ isOpen: false, unread: [] });
    });
});
