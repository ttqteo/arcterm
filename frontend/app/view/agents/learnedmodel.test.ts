// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { isNewLine, learnedGroups, lineMeta, localDate, skillLines } from "./learnedmodel";

describe("isNewLine", () => {
    it("counts the last 7 days, today included", () => {
        expect(isNewLine("2026-10-14", "2026-10-14")).toBe(true);
        expect(isNewLine("2026-10-08", "2026-10-14")).toBe(true);
        expect(isNewLine("2026-10-07", "2026-10-14")).toBe(false);
    });

    it("counts across a month and a year boundary", () => {
        expect(isNewLine("2026-09-30", "2026-10-06")).toBe(true);
        expect(isNewLine("2026-09-29", "2026-10-06")).toBe(false);
        expect(isNewLine("2025-12-31", "2026-01-06")).toBe(true);
    });

    it("is false for a date it cannot read", () => {
        expect(isNewLine("", "2026-10-14")).toBe(false);
        expect(isNewLine("yesterday", "2026-10-14")).toBe(false);
    });
});

describe("lineMeta", () => {
    it("reads day/month and the count", () => {
        expect(lineMeta({ learned: "2026-10-14", count: 3 })).toBe("14/10 · 3×");
        expect(lineMeta({ learned: "2026-01-05", count: 1 })).toBe("05/01 · 1×");
    });

    it("keeps a date it cannot read as it is", () => {
        expect(lineMeta({ learned: "soon", count: 2 })).toBe("soon · 2×");
    });
});

describe("localDate", () => {
    it("is the local YYYY-MM-DD", () => {
        expect(localDate(new Date(2026, 9, 4, 23, 59))).toBe("2026-10-04");
    });
});

function skill(skill: string, key: string, learned: string): LearnedSkillLine {
    return { skill, key, text: `${skill} ${key}`, learned, count: 2 };
}

function memory(cwd: string, key: string, learned: string): LearnedMemoryLine {
    return { cwd, dir: `${cwd}/.claude-memory`, key, text: `${cwd} ${key}`, learned, count: 2 };
}

describe("skillLines", () => {
    it("lists a skill's additions newest first, each addressed by skill and key", () => {
        const lines = skillLines("lint", [
            { key: "old", text: "a", learned: "2026-09-01", count: 2 },
            { key: "new", text: "b", learned: "2026-10-12", count: 3 },
        ]);
        expect(lines.map((l) => l.id)).toEqual(["lint#new", "lint#old"]);
        expect(lines[0]).toMatchObject({ skill: "lint", key: "new", text: "b", learned: "2026-10-12", count: 3 });
    });
});

describe("learnedGroups", () => {
    const accepted = (): CommandLearnAcceptedRtnData => ({
        skills: [
            skill("translate", "a", "2026-10-01"),
            skill("commit", "old", "2026-09-01"),
            skill("commit", "fresh", "2026-10-13"),
        ],
        memories: [
            memory("D:\\work\\zeta", "z", "2026-10-02"),
            memory("D:\\work\\alpha\\", "a2", "2026-10-03"),
            memory("D:\\work\\alpha\\", "a1", "2026-10-09"),
            memory("/home/me/beta", "b", "2026-10-01"),
        ],
    });

    it("lists skill groups by name, then memory groups by project", () => {
        const groups = learnedGroups(accepted());
        expect(groups.map((g) => [g.kind, g.title])).toEqual([
            ["skill", "commit"],
            ["skill", "translate"],
            ["memory", "alpha"],
            ["memory", "beta"],
            ["memory", "zeta"],
        ]);
    });

    it("titles a memory group by its folder and names the full path under it", () => {
        const [alpha, beta] = learnedGroups(accepted()).filter((g) => g.kind === "memory");
        expect(alpha.subtitle).toBe("D:\\work\\alpha\\");
        expect(beta.subtitle).toBe("/home/me/beta");
    });

    it("puts each group's lines newest first", () => {
        const groups = learnedGroups(accepted());
        expect(groups[0].lines.map((l) => l.key)).toEqual(["fresh", "old"]);
        expect(groups[2].lines.map((l) => l.key)).toEqual(["a1", "a2"]);
    });

    it("addresses a skill line by skill and a memory line by its dir", () => {
        const groups = learnedGroups(accepted());
        expect(groups[0].lines[0]).toMatchObject({ id: "commit#fresh", skill: "commit" });
        expect(groups[0].lines[0].dir).toBeUndefined();
        expect(groups[2].lines[0]).toMatchObject({
            id: "D:\\work\\alpha\\#a1",
            dir: "D:\\work\\alpha\\/.claude-memory",
        });
        expect(groups[2].lines[0].skill).toBeUndefined();
    });

    it("is empty when nothing was accepted", () => {
        expect(learnedGroups({ skills: [], memories: [] })).toEqual([]);
        expect(learnedGroups({ skills: null as never, memories: null as never })).toEqual([]);
    });
});
