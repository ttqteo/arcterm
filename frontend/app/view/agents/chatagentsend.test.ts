// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { agentAnswerOf, agentsCall, agentSendOf, answerFileOf, readText, samePath, shellWords } from "./chatagentsend";

const SENT = "sent to 12e2f9e1: it started a turn\nread the answer with: wsh agents read 12e2f9e1\n";
const BG =
    "Command running in background with ID: bqdnhdjlc. Output is being written to: C:\\Users\\me\\AppData\\Local\\Temp\\claude\\x\\tasks\\bqdnhdjlc.output";

describe("shellWords", () => {
    it("takes quotes and escapes off and stops at the end of the command", () => {
        expect(shellWords(`a 'b c' "d \\"e\\" $f" g\\ h && rm x`)).toEqual(["a", "b c", 'd "e" $f', "g h"]);
    });
    it("reads a $(cat <<'EOF' …) heredoc, quoted or not, as its body", () => {
        const cmd = `wsh agents send 12e2 "$(cat <<'EOF'\nline one\n\n- \`code\` here\nEOF\n)" --wait`;
        expect(shellWords(cmd, "wsh agents send".length)).toEqual(["12e2", "line one\n\n- `code` here", "--wait"]);
        expect(shellWords(`x $(cat <<EOF\nhi\nEOF\n)`)).toEqual(["x", "hi"]);
    });
});

describe("agentsCall", () => {
    it("reads a send, the binary spelled any way, its text or its file, and --wait", () => {
        expect(agentsCall(`~/.arc/bin/wsh agents send 12e2f9e1 "go on"`)).toEqual({
            verb: "send",
            tab: "12e2f9e1",
            text: "go on",
            wait: false,
        });
        expect(agentsCall(`"C:/Users/me/.arc/bin/wsh.exe" agents send --wait 12e2 --file=msg.md`)).toEqual({
            verb: "send",
            tab: "12e2",
            file: "msg.md",
            wait: true,
        });
        expect(agentsCall(`cd /x && wsh agents send 12e2 --timeout 20m --file /tmp/m.md --wait`)).toMatchObject({
            tab: "12e2",
            file: "/tmp/m.md",
            wait: true,
        });
    });
    it("reads a read, and is null for other agents commands or none", () => {
        expect(agentsCall(`wsh agents wait 12e2 && wsh agents read 12e2`)).toEqual({
            verb: "read",
            tab: "12e2",
            wait: false,
        });
        expect(agentsCall(`wsh agents list`)).toBeNull();
        expect(agentsCall(`echo wshagents send`)).toBeNull();
        expect(agentsCall(`wsh agents send`)).toBeNull();
    });
});

describe("agentSendOf", () => {
    it("is the message and what the send did", () => {
        expect(agentSendOf(`wsh agents send 12e2f9e1 "go on"`, SENT, 0)).toEqual({
            tab: "12e2f9e1",
            text: "go on",
            how: "started",
        });
        expect(
            agentSendOf(
                `wsh agents send 12e2 --file m.md`,
                "sent to 12e2f9e1: it joined the turn the agent is running\n",
                0
            )
        ).toEqual({
            tab: "12e2",
            file: "m.md",
            how: "joined",
        });
    });
    it("says why a send failed, and nothing yet of one running in the background", () => {
        expect(
            agentSendOf(`wsh agents send zz "x"`, `Exit code 1\nError: tab "zz" is not a live agent session`, 1)
        ).toEqual({
            tab: "zz",
            text: "x",
            failed: `tab "zz" is not a live agent session`,
        });
        expect(agentSendOf(`wsh agents send 12e2 "x" --wait`, BG, 0)).toEqual({ tab: "12e2", text: "x" });
    });
    it("is null for a refused call or another command", () => {
        expect(agentSendOf(`wsh agents send 12e2 "x"`, "", null)).toBeNull();
        expect(agentSendOf(`wsh agents read 12e2`, "hi", 0)).toBeNull();
    });
});

describe("agentAnswerOf", () => {
    it("is what a --wait printed after the send's lines", () => {
        expect(agentAnswerOf(`wsh agents send 12e2 "x" --wait`, `${SENT}Done.\n\n- one\n- two\n`)).toEqual({
            tab: "12e2",
            text: "Done.\n\n- one\n- two",
        });
    });
    it("is what a read printed, past the line a wait before it printed", () => {
        const out = "12e2f9e1 (Patch replay) stopped working: it is idle\nAll six are error_before.\n";
        expect(agentAnswerOf(`wsh agents wait 12e2 && wsh agents read 12e2`, out)).toEqual({
            tab: "12e2",
            text: "All six are error_before.",
        });
    });
    it("keeps the line saying the agent waits on its user as what came back", () => {
        const line = "12e2f9e1 is waiting on the user: it has a question or a permission prompt open. Once…";
        expect(agentAnswerOf(`wsh agents send 12e2 "x" --wait`, `${SENT}${line}`)).toEqual({ tab: "12e2", text: line });
    });
    it("is null with no answer: a plain send, none yet, a call in the background", () => {
        expect(agentAnswerOf(`wsh agents send 12e2 "x"`, SENT)).toBeNull();
        expect(agentAnswerOf(`wsh agents read 12e2`, "12e2f9e1 has not answered yet (state: working)\n")).toBeNull();
        expect(agentAnswerOf(`wsh agents read 12e2`, BG)).toBeNull();
    });
});

describe("answerFileOf", () => {
    it("is the output file of a --wait or a read run in the background", () => {
        const file = "C:\\Users\\me\\AppData\\Local\\Temp\\claude\\x\\tasks\\bqdnhdjlc.output";
        expect(answerFileOf(`wsh agents send 12e2 "x" --wait`, BG)).toBe(file);
        expect(answerFileOf(`wsh agents wait 12e2; wsh agents read 12e2`, BG)).toBe(file);
        expect(answerFileOf(`wsh agents send 12e2 "x"`, BG)).toBeNull();
        expect(answerFileOf(`sleep 5`, BG)).toBeNull();
    });
});

describe("readText and samePath", () => {
    it("takes the Read's line numbers off", () => {
        expect(readText("     1\tsent to x\n     2→hello\n")).toBe("sent to x\nhello");
    });
    it("matches a path across Windows and Git Bash spellings, and a relative one", () => {
        expect(samePath("/c/Users/me/a.output", "C:\\Users\\me\\a.output")).toBe(true);
        expect(samePath("msg.md", "C:\\tmp\\scratch\\msg.md")).toBe(true);
        expect(samePath("./msg.md", "C:/tmp/msg.md")).toBe(true);
        expect(samePath("other.md", "C:/tmp/msg.md")).toBe(false);
    });
});
