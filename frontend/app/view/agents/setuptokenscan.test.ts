// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { setupTokenCommand, TokenScanner } from "./setuptokenscan";

describe("TokenScanner", () => {
    it("finds a token split across chunks and wrapped with ANSI codes", () => {
        const s = new TokenScanner();
        expect(s.push("Your token: sk-ant-oat01-AbC")).toBeNull();
        expect(s.push("\x1b[0m\r\ndEf_gh-12\r\nStore it safely")).toBe("sk-ant-oat01-AbCdEf_gh-12");
    });
    it("ignores text with no token", () => {
        expect(new TokenScanner().push("Opening browser...")).toBeNull();
    });
    it("ends the token at a line break when the next line is not all token characters", () => {
        expect(new TokenScanner().push("Your token: sk-ant-oat01-fixtureSignin0\r\nStore it safely\r\n")).toBe(
            "sk-ant-oat01-fixtureSignin0"
        );
    });
    it("waits while the token is still the last thing printed", () => {
        const s = new TokenScanner();
        expect(s.push("sk-ant-oat01-fixtureSignin0")).toBeNull();
        expect(s.push("\r\n")).toBeNull();
        expect(s.push("Stor")).toBeNull();
        expect(s.push("e it")).toBe("sk-ant-oat01-fixtureSignin0");
    });
    it("does not end the token at an escape sequence cut between chunks", () => {
        const s = new TokenScanner();
        expect(s.push("sk-ant-oat01-AbCdEf\x1b[")).toBeNull();
        expect(s.push("1mGhIj\x1b[0m done")).toBe("sk-ant-oat01-AbCdEfGhIj");
    });
    it("ends the token at a blank line", () => {
        expect(new TokenScanner().push("sk-ant-oat01-fixtureSignin0\r\n\r\nnext")).toBe("sk-ant-oat01-fixtureSignin0");
    });
    it("skips a match too short to be a token", () => {
        expect(new TokenScanner().push("e.g. sk-ant-oat01-abc then more")).toBeNull();
    });
    // the shapes below are ConPTY's output of `claude setup-token`: it moves to the next printed row with a
    // cursor position (CSI row;col H), not a newline, and writes spaces as cursor-forward (CSI 1 C)
    const token = "sk-ant-oat01-" + "Ab1_-".repeat(19) + "AA"; // 108 characters, like a real one
    it("joins a token wrapped at 80 columns when the next row is reached by a cursor move", () => {
        const out =
            "\x1b[33m" +
            token.slice(0, 80) +
            "\r\n" +
            token.slice(80) +
            "\x1b[m\x1b[12;1H\x1b[2mStore\x1b[1Cthis\x1b[1Ctoken\x1b[1Csecurely.\x1b[m\r\n";
        expect(new TokenScanner().push(out)).toBe(token);
    });
    it("ends an unwrapped token at a cursor move to another row", () => {
        const out = "\x1b[10;1H\x1b[33m" + token + "\x1b[m\x1b[12;1H\x1b[2mStore\x1b[1Cthis\x1b[1Ctoken\x1b[m\r\n";
        expect(new TokenScanner().push(out)).toBe(token);
    });
    // setup-token prints the token with a one-column margin, so each wrapped row starts one column in
    it("joins wrapped rows that start after the margin", () => {
        const tail = "\x1b[m\x1b[12;2H\x1b[2mStore\x1b[1Cthis\x1b[1Ctoken.\x1b[m\r\n";
        const rows = [token.slice(0, 78), token.slice(78)];
        for (const sep of ["\r\n ", "\r\n\x1b[1C", "\x1b[9;2H"]) {
            const out = "\x1b[8;2H\x1b[38;2;255;193;7m" + rows[0] + sep + rows[1] + tail;
            expect(new TokenScanner().push(out)).toBe(token);
        }
    });
    it("joins a row that ends in spaces after the token", () => {
        const out = "\x1b[8;2H" + token.slice(0, 78) + "  \r\n " + token.slice(78) + "\x1b[12;2HStore\x1b[1Cit.\r\n";
        expect(new TokenScanner().push(out)).toBe(token);
    });
    it("reports the token once", () => {
        const s = new TokenScanner();
        expect(s.push("sk-ant-oat01-fixtureSignin0 \r\nStore it")).toBe("sk-ant-oat01-fixtureSignin0");
        expect(s.push("again sk-ant-oat01-fixtureSignin0 \r\nStore it")).toBeNull();
    });
    it("waits on a token followed only by spaces: they may be a wrapped row's margin", () => {
        const s = new TokenScanner();
        expect(s.push("sk-ant-oat01-fixtureSignin0  ")).toBeNull();
        expect(s.push("\r\n moreTail\r\nStore it")).toBe("sk-ant-oat01-fixtureSignin0moreTail");
    });
});

describe("setupTokenCommand", () => {
    const real = { cmd: "claude", args: ["setup-token"] };
    const fake = JSON.stringify({ cmd: "node", args: ["-e", "setTimeout(()=>{},60000)"] });
    it("runs claude setup-token in a production build, whatever the override", () => {
        expect(setupTokenCommand(false, fake)).toEqual(real);
    });
    it("takes the dev override in a dev build", () => {
        expect(setupTokenCommand(true, fake)).toEqual({ cmd: "node", args: ["-e", "setTimeout(()=>{},60000)"] });
    });
    it("falls back to claude for a missing or malformed override", () => {
        expect(setupTokenCommand(true, null)).toEqual(real);
        expect(setupTokenCommand(true, "{nope")).toEqual(real);
        expect(setupTokenCommand(true, JSON.stringify({ cmd: 3 }))).toEqual(real);
    });
});
