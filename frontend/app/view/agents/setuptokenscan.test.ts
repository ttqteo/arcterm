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
    it("reports the token once", () => {
        const s = new TokenScanner();
        expect(s.push("sk-ant-oat01-fixtureSignin0 ")).toBe("sk-ant-oat01-fixtureSignin0");
        expect(s.push("again sk-ant-oat01-fixtureSignin0 ")).toBeNull();
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
