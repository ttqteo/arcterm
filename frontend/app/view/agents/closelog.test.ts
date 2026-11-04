// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { closeLogLine } from "./closelog";

const TAB = "4eeebfe1-1853-4864-aa01-af6d18fa8a39";

describe("closeLogLine", () => {
    it("names the dialog a close opened and where it came from", () => {
        expect(closeLogLine({ kind: "ask", tabId: TAB, name: "Trang chủ", from: "Mod+Shift+W" })).toBe(
            '[close] ask tab=4eeebfe1 name="Trang chủ" from=Mod+Shift+W'
        );
    });

    it("says how the confirm was given and how soon, rounded", () => {
        expect(
            closeLogLine({
                kind: "confirm",
                tabId: TAB,
                name: "web",
                from: "header",
                how: { via: "enter", afterMs: 87.6 },
            })
        ).toBe('[close] confirm tab=4eeebfe1 name="web" from=header via=enter after=88ms');
    });

    it("leaves out how when the dialog did not report it", () => {
        expect(closeLogLine({ kind: "confirm", tabId: TAB, name: "web", from: "" })).toBe(
            '[close] confirm tab=4eeebfe1 name="web" from=?'
        );
    });

    it("quotes a name with spaces and quotes so the line stays one field", () => {
        expect(closeLogLine({ kind: "ask", tabId: TAB, name: 'say "hi"', from: "tree" })).toBe(
            '[close] ask tab=4eeebfe1 name="say \\"hi\\"" from=tree'
        );
    });

    it("logs every close with its route", () => {
        expect(closeLogLine({ kind: "close", tabId: TAB, why: "worktree gone" })).toBe(
            "[close] close tab=4eeebfe1 why=worktree gone"
        );
    });
});
