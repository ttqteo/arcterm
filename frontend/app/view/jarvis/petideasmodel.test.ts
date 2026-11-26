// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { ideaChipTab, ideaLeavesLabel, ideasLine, ideaWhere, startedLine } from "./petideasmodel";
import type { IdeaChip } from "./sessionideasmodel";

const DAY = 86_400_000;
// local noon, so a day's name does not depend on the zone the test runs in
const NOW = new Date(2026, 10, 26, 12).getTime();

function idea(over: Partial<SessionIdea> & { id: string }): SessionIdea {
    return {
        gist: `gist of ${over.id}`,
        project: "arcterm",
        projectpath: "D:/work/arcterm",
        efforttitle: "",
        deletests: 0,
        ...over,
    } as SessionIdea;
}

describe("ideasLine", () => {
    it("counts the ideas in review, singular for one", () => {
        expect(ideasLine(1)).toBe("1 idea from your sessions to review");
        expect(ideasLine(4)).toBe("4 ideas from your sessions to review");
    });
});

describe("ideaWhere", () => {
    it("names the initiative, or says it is a new idea in its project", () => {
        expect(ideaWhere(idea({ id: "a", efforttitle: "Session search" }))).toBe("Session search");
        expect(ideaWhere(idea({ id: "b", efforttitle: "" }))).toBe("New idea · arcterm");
    });
});

describe("ideaLeavesLabel", () => {
    it("says nothing for an idea with no deletion day or one a long way off", () => {
        expect(ideaLeavesLabel(idea({ id: "a", deletests: 0 }), NOW)).toBeNull();
        expect(ideaLeavesLabel(idea({ id: "b", deletests: NOW + 30 * DAY }), NOW)).toBeNull();
    });

    it("names the day when the transcript is deleted within 7 days", () => {
        expect(ideaLeavesLabel(idea({ id: "a", deletests: NOW + 3 * DAY }), NOW)).toBe("transcript deleted Nov 29");
        expect(ideaLeavesLabel(idea({ id: "b", deletests: NOW + 7 * DAY }), NOW)).toBe("transcript deleted Dec 3");
    });

    it("warns that a transcript already past its day may be gone", () => {
        expect(ideaLeavesLabel(idea({ id: "a", deletests: NOW - DAY }), NOW)).toBe("transcript may already be gone");
    });
});

describe("ideaChipTab", () => {
    const rows = [idea({ id: "a" }), idea({ id: "b" }), idea({ id: "c" })];
    const tabs = (map: Record<string, string>) => (id: string) => map[id];
    const go: IdeaChip = { kind: "go-through", text: "Go through 3 with an agent" };
    const discuss: IdeaChip = { kind: "discuss", text: "Discuss: gist of a", ideaId: "a" };

    it("finds the Discuss agent of the idea the chip names", () => {
        expect(ideaChipTab(discuss, rows, tabs({ a: "t1" }))).toBe("t1");
        expect(ideaChipTab(discuss, rows, tabs({ b: "t1" }))).toBeUndefined();
    });

    it("finds the Go through agent only while it holds every idea waiting", () => {
        expect(ideaChipTab(go, rows, tabs({ a: "t9", b: "t9", c: "t9" }))).toBe("t9");
        // an idea that arrived after the agent opened is not in it: the chip is ready again
        expect(ideaChipTab(go, rows, tabs({ a: "t9", b: "t9" }))).toBeUndefined();
        // a Discuss opened on one of them since took that idea's tab
        expect(ideaChipTab(go, rows, tabs({ a: "t9", b: "t2", c: "t9" }))).toBeUndefined();
        expect(ideaChipTab(go, [], tabs({}))).toBeUndefined();
    });

    it("has no agent for the chips that open a list", () => {
        expect(ideaChipTab({ kind: "waiting", text: "What's waiting?" }, rows, tabs({ a: "t1" }))).toBeUndefined();
        expect(ideaChipTab({ kind: "leaving", text: "x" }, rows, tabs({ a: "t1" }))).toBeUndefined();
    });
});

describe("startedLine", () => {
    it("says the Go through agent is in No folder on sonnet", () => {
        expect(startedLine({ kind: "go-through", text: "Go through 2 with an agent" }, [idea({ id: "a" })])).toEqual({
            title: "Session ideas",
            detail: "No folder · sonnet · started",
        });
    });

    it("names the discussed idea and its project", () => {
        const rows = [idea({ id: "a", gist: "Search back 90 days", project: "arcterm" })];
        expect(startedLine({ kind: "discuss", text: "Discuss: Search back 90 days", ideaId: "a" }, rows)).toEqual({
            title: "Discuss: Search back 90 days",
            detail: "arcterm · sonnet · started",
        });
    });

    it("says No folder for an idea that carries no project path, where its agent opened", () => {
        const rows = [idea({ id: "a", projectpath: "" })];
        expect(startedLine({ kind: "discuss", text: "Discuss: gist of a", ideaId: "a" }, rows).detail).toBe(
            "No folder · sonnet · started"
        );
    });
});
