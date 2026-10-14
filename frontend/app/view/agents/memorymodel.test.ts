// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    changeGroups,
    checkLine,
    closedText,
    fileLabel,
    indexCards,
    kindLabel,
    LIMIT_BYTES,
    LIMIT_LINES,
    projectsToReview,
    railRow,
    splitText,
    statusOf,
    switchGate,
    toolbarStatus,
} from "./memorymodel";

// local-time stamps, so the day names don't depend on the machine's zone
const NOW = new Date(2026, 9, 14, 18, 0).getTime();
const CHECKED = new Date(2026, 9, 14, 9, 12).getTime();
const NEXT = new Date(2026, 9, 21, 9, 12).getTime();

const SHARED_FOLDER = "C:/Users/me/.claude/projects/C--Users-me-src-SIEM/memory";
const SPLIT_PATH = "C:\\Users\\me\\src\\SIEM\\src\\cyber_ai\\cyber_assistant";

function op(over: Partial<MemOp> = {}): MemOp {
    return {
        folder: "",
        memories: [],
        old: "",
        new: "",
        indexremove: [],
        indexadd: "",
        indexfolder: "",
        writename: "",
        writebody: "",
        docpath: "",
        docsection: "",
        docpassage: "",
        tofolder: "",
        settingspath: "",
        settingsvalue: "",
        stripharvester: false,
        ...over,
    };
}

function change(id: string, over: Partial<MemChange> = {}): MemChange {
    return {
        id,
        kind: "trim",
        group: "",
        title: id,
        note: "",
        applylabel: "Apply trim",
        effect: "",
        files: [],
        evidence: [],
        diffs: [],
        indexdelta: { lines: 0, bytes: 0 },
        ownindexdelta: { lines: 0, bytes: 0 },
        op: op(),
        status: "open",
        conflictfile: "",
        decidedat: 0,
        backupuntil: 0,
        applyid: "",
        ...over,
    };
}

function project(over: Partial<MemHygieneProject> = {}): MemHygieneProject {
    return {
        project: "waveterm",
        path: "C:\\Users\\me\\src\\waveterm",
        checkedat: CHECKED,
        nextcheckat: NEXT,
        checking: false,
        lasterror: "",
        memories: 69,
        sessions: 1232,
        folder: "C:/Users/me/.claude/projects/C--Users-me-src-waveterm/memory",
        sharedwith: [],
        ownfolder: "",
        formershared: "",
        switchedat: 0,
        index: { exists: true, lines: 89, bytes: 12561 },
        changes: [],
        ...over,
    };
}

function splitProject(changes: MemChange[], over: Partial<MemHygieneProject> = {}): MemHygieneProject {
    return project({
        project: "cyber_assistant",
        path: SPLIT_PATH,
        memories: 198,
        sessions: 12,
        folder: SHARED_FOLDER,
        sharedwith: ["cyber_anomaly_detector", "MP-Frontend"],
        ownfolder: "C:/Users/me/.claude/projects/C--Users-me-src-SIEM-src-cyber_ai-cyber_assistant/memory",
        index: { exists: true, lines: 134, bytes: 16768 },
        ownindex: { exists: false, lines: 0, bytes: 0 },
        changes,
        ...over,
    });
}

const settings = (status = "open") =>
    change("s1", {
        kind: "settings",
        group: "switch",
        status,
        op: op({ settingspath: `${SPLIT_PATH}\\.claude\\settings.local.json` }),
    });

describe("limits", () => {
    it("mirrors Claude Code's load limits", () => {
        expect(LIMIT_LINES).toBe(200);
        expect(LIMIT_BYTES).toBe(25000);
    });
});

describe("projectsToReview and toolbarStatus", () => {
    it("counts projects with an undecided change, including a conflict", () => {
        const ps = [
            project({ project: "a", changes: [change("1"), change("2")] }),
            project({ project: "b", changes: [change("3", { status: "applied" }), change("4", { status: "kept" })] }),
            project({ project: "c", changes: [change("5", { status: "conflict" })] }),
            splitProject([change("m1", { kind: "move-here", group: "shared" }), settings()]),
            project({ project: "d", checkedat: 0 }),
        ];
        expect(projectsToReview(ps)).toBe(3);
        expect(toolbarStatus(ps)).toEqual({ text: "3 projects to review", tone: "warn" });
    });

    it("says 1 project in the singular", () => {
        expect(toolbarStatus([project({ changes: [change("1")] })])).toEqual({
            text: "1 project to review",
            tone: "warn",
        });
    });

    it("says every project checked when nothing is left to review", () => {
        const ps = [project({ changes: [change("1", { status: "applied" })] }), project({ project: "b" })];
        expect(toolbarStatus(ps)).toEqual({ text: "Every project checked", tone: "ok" });
    });
});

describe("railRow", () => {
    it("meters a project's own index against the larger of the two limits", () => {
        const r = railRow(project({ index: { exists: true, lines: 50, bytes: 20000 }, changes: [change("1")] }));
        expect(r).toEqual({
            name: "waveterm",
            pct: 80,
            meter: "50 lines · 20.0 of 25 KB",
            status: "1 to review",
            tone: "warn",
        });
        expect(railRow(project({ index: { exists: true, lines: 89, bytes: 12561 } })).meter).toBe(
            "89 lines · 12.6 of 25 KB"
        );
    });

    it("names the shared repo while sharing, metered by lines", () => {
        const r = railRow(splitProject([change("m1", { kind: "move-here", group: "shared" }), settings()]));
        expect(r.meter).toBe("Shares SIEM’s memory · 134 lines");
        expect(r.pct).toBe(67);
        expect(r.status).toBe("2 to review");
    });

    it("finds the repo whatever the drive letter's case in the folder name", () => {
        const r = railRow(
            splitProject([settings()], { folder: "C:/Users/me/.claude/projects/c--users-me-src-siem/memory" })
        );
        expect(r.meter).toBe("Shares SIEM’s memory · 134 lines");
    });

    it("falls back to the folder's own name for a folder no ancestor slugs to", () => {
        const r = railRow(splitProject([settings()], { folder: "D:/mem/team-notes" }));
        expect(r.meter).toBe("Shares team-notes’s memory · 134 lines");
    });

    it("meters the own index once the switch-over is applied", () => {
        const r = railRow(splitProject([settings("applied")], { ownindex: { exists: true, lines: 4, bytes: 600 } }));
        expect(r.meter).toBe("4 lines · 0.6 of 25 KB");
    });

    it("reads Kept sharing when the switch-over is kept", () => {
        const r = railRow(splitProject([change("m1", { kind: "move-here", group: "shared" }), settings("kept")]));
        expect(r.status).toBe("Kept sharing");
        expect(r.tone).toBe("none");
    });

    it("reads Not checked yet for a project never checked", () => {
        const r = railRow(project({ checkedat: 0, nextcheckat: 0, index: { exists: false, lines: 0, bytes: 0 } }));
        expect(r).toEqual({
            name: "waveterm",
            pct: 0,
            meter: "",
            status: "Not checked yet",
            tone: "none",
        });
    });

    it("reads Checking… while a check runs, even for a first check", () => {
        expect(railRow(project({ checking: true, changes: [change("1")] })).status).toBe("Checking…");
        const first = railRow(project({ checking: true, checkedat: 0 }));
        expect(first.status).toBe("Checking…");
        expect(first.meter).toBe("");
    });

    it("flags a failed check with nothing to review, and is calm otherwise", () => {
        expect(railRow(project({ lasterror: "model timed out" }))).toMatchObject({
            status: "Last check failed",
            tone: "warn",
        });
        expect(railRow(project())).toMatchObject({ status: "Nothing to review", tone: "ok" });
    });
});

describe("checkLine", () => {
    it("reads the check, its counts and the next check", () => {
        expect(checkLine(project(), NOW)).toBe(
            "Checked today at 09:12 · 69 memories, 1,232 sessions · next check Oct 21"
        );
    });

    it("names yesterday and older days", () => {
        const yesterday = new Date(2026, 9, 13, 8, 5).getTime();
        expect(checkLine(project({ checkedat: yesterday }), NOW)).toMatch(/^Checked yesterday at 08:05 · /);
        const older = new Date(2026, 9, 2, 8, 5).getTime();
        expect(checkLine(project({ checkedat: older }), NOW)).toMatch(/^Checked Oct 2 at 08:05 · /);
    });

    it("uses singulars and leaves out the shared memory count during a split", () => {
        expect(checkLine(project({ memories: 1, sessions: 1, nextcheckat: 0 }), NOW)).toBe(
            "Checked today at 09:12 · 1 memory, 1 session"
        );
        expect(checkLine(splitProject([]), NOW)).toBe("Checked today at 09:12 · 12 sessions · next check Oct 21");
    });

    it("appends a failed check's reason", () => {
        expect(checkLine(project({ lasterror: "judge reply was not JSON" }), NOW)).toBe(
            "Checked today at 09:12 · 69 memories, 1,232 sessions · next check Oct 21 · Last check failed: judge reply was not JSON"
        );
        expect(checkLine(project({ checkedat: 0, lasterror: "boom" }), NOW)).toBe(
            "Not checked yet · Last check failed: boom"
        );
    });

    it("reads Not checked yet and Checking…", () => {
        expect(checkLine(project({ checkedat: 0, nextcheckat: 0 }), NOW)).toBe("Not checked yet");
        expect(checkLine(project({ checking: true, lasterror: "old" }), NOW)).toBe("Checking…");
    });
});

describe("splitText", () => {
    it("explains the split while sharing, and nothing once switched or for an own folder", () => {
        expect(splitText(splitProject([settings()]))).toBe(
            "Claude Code gives a git repo one memory, so cyber_assistant sessions load SIEM’s MEMORY.md, " +
                "which cyber_anomaly_detector and MP-Frontend share. These changes give cyber_assistant its own."
        );
        expect(splitText(splitProject([settings()], { sharedwith: ["other"] }))).toContain("which other shares.");
        expect(splitText(splitProject([settings("applied")]))).toBe("");
        expect(splitText(project())).toBe("");
    });
});

describe("indexCards", () => {
    it("adds only the changes still to review to the after-total", () => {
        const p = project({
            index: { exists: true, lines: 88, bytes: 12426 },
            changes: [
                change("applied", { status: "applied", indexdelta: { lines: -1, bytes: -135 } }),
                change("kept", { status: "kept", indexdelta: { lines: -1, bytes: -100 } }),
                change("open1", { indexdelta: { lines: -1, bytes: -160 } }),
                change("open2", { status: "conflict", indexdelta: { lines: -1, bytes: -174 } }),
                change("body", { indexdelta: { lines: 0, bytes: 0 } }),
            ],
        });
        expect(indexCards(p)).toEqual([
            {
                label: "MEMORY.md",
                role: "Loaded by waveterm",
                lines: "88 of 200",
                kb: "12.4 of 25 KB",
                linesPct: 44,
                kbPct: 50,
                after: "After the changes still to review: 86 lines · 12.1 KB",
            },
        ]);
    });

    it("says nothing is left once no open change moves the index", () => {
        const p = project({
            changes: [change("body"), change("a", { status: "applied", indexdelta: { lines: -1, bytes: -9 } })],
        });
        expect(indexCards(p)[0].after).toBe("Nothing left to review here.");
    });

    it("draws the shared and own index during a split, each with its own delta", () => {
        const p = splitProject([
            change("m1", {
                kind: "move-here",
                group: "shared",
                indexdelta: { lines: -1, bytes: -128 },
                ownindexdelta: { lines: 1, bytes: 128 },
            }),
            change("m4", { kind: "copy-here", group: "shared", ownindexdelta: { lines: 1, bytes: 157 } }),
            settings(),
        ]);
        const [shared, own] = indexCards(p);
        expect(shared).toMatchObject({
            label: "SIEM’s MEMORY.md",
            role: "Loaded by cyber_assistant today",
            lines: "134 of 200",
            after: "After the changes still to review: 133 lines · 16.6 KB",
        });
        expect(own).toMatchObject({
            label: "cyber_assistant’s MEMORY.md",
            role: "Loaded once you switch over",
            lines: "none yet",
            kb: "none yet",
            linesPct: 0,
            after: "After the changes still to review: 2 lines · 0.3 KB",
        });
    });

    it("swaps the roles once the switch-over is applied", () => {
        const [shared, own] = indexCards(splitProject([settings("applied")]));
        expect(shared.role).toBe("No longer loaded here");
        expect(own.role).toBe("Loaded by cyber_assistant");
    });
});

describe("changeGroups", () => {
    it("lists an own folder's changes in one unlabelled group", () => {
        const cs = [change("1"), change("2")];
        expect(changeGroups(project({ changes: cs }))).toEqual([{ key: "", label: "", hint: "", changes: cs }]);
    });

    it("orders a split's groups shared, own, switch whatever the change order, and drops empty ones", () => {
        const s = settings();
        const m = change("m1", { kind: "move-here", group: "shared" });
        const o = change("c1", { kind: "delete", group: "own" });
        const groups = changeGroups(splitProject([s, o, m]));
        expect(groups.map((g) => [g.key, g.label, g.hint, g.changes.map((c) => c.id)])).toEqual([
            ["shared", "From SIEM’s memory", "Memories about cyber_assistant, out of SIEM’s 198", ["m1"]],
            [
                "own",
                "Already in its own folder",
                "Files left by the old memory harvester; no session loads them yet",
                ["c1"],
            ],
            ["switch", "Switch over", "", ["s1"]],
        ]);
        expect(changeGroups(splitProject([s])).map((g) => g.key)).toEqual(["switch"]);
    });
});

describe("switchGate", () => {
    it("holds the switch-over while a shared change is still to review", () => {
        const p = splitProject([
            change("m1", { kind: "move-here", group: "shared" }),
            change("m2", { kind: "move-here", group: "shared", status: "conflict" }),
            change("m3", { kind: "move-here", group: "shared", status: "applied" }),
            settings(),
        ]);
        expect(switchGate(p, p.changes[3])).toEqual({
            blocked: true,
            text: "Review the 2 changes from SIEM’s memory first. Switching now would drop those memories from cyber_assistant sessions.",
        });
    });

    it("says 1 change in the singular", () => {
        const p = splitProject([change("m1", { kind: "move-here", group: "shared" }), settings()]);
        expect(switchGate(p, p.changes[1]).text).toMatch(/^Review the 1 change from SIEM’s memory first\./);
    });

    it("opens once no shared change is left to review", () => {
        const p = splitProject([
            change("m1", { kind: "move-here", group: "shared", status: "applied" }),
            change("m2", { kind: "copy-here", group: "shared", status: "kept" }),
            change("c1", { kind: "delete", group: "own" }),
            settings(),
        ]);
        expect(switchGate(p, p.changes[3])).toEqual({ blocked: false, text: "" });
    });

    it("never blocks a change that isn't the switch-over, or a decided one", () => {
        const p = splitProject([
            change("m1", { kind: "move-here", group: "shared" }),
            change("c1", { kind: "delete", group: "own" }),
        ]);
        expect(switchGate(p, p.changes[0]).blocked).toBe(false);
        expect(switchGate(p, p.changes[1]).blocked).toBe(false);
        expect(switchGate(p, settings("kept")).blocked).toBe(false);
    });
});

describe("closedText", () => {
    const decided = new Date(2026, 9, 14, 17, 42).getTime();
    const until = new Date(2026, 10, 13, 17, 42).getTime();

    it("reads an applied change with its backup's expiry", () => {
        const c = change("1", { status: "applied", decidedat: decided, backupuntil: until });
        expect(closedText(project(), c, NOW)).toBe("Applied at 17:42. Arc kept a copy of the old files until Nov 13.");
    });

    it("names the project for an applied switch-over", () => {
        const c = { ...settings("applied"), decidedat: decided, backupuntil: until };
        expect(closedText(splitProject([c]), c, NOW)).toBe(
            "Applied at 17:42. New cyber_assistant sessions load its own memory. Arc kept a copy of the old settings until Nov 13."
        );
    });

    it("names the day of an apply from an earlier day", () => {
        const c = change("1", { status: "applied", decidedat: new Date(2026, 9, 13, 17, 42).getTime() });
        expect(closedText(project(), c, NOW)).toBe("Applied yesterday at 17:42.");
    });

    it("reads a kept change, and nothing for an undecided one", () => {
        expect(closedText(project(), change("1", { status: "kept" }), NOW)).toBe(
            "Kept as is. The next check skips it unless the memory changes."
        );
        expect(closedText(project(), change("1"), NOW)).toBe("");
        expect(closedText(project(), change("1", { status: "conflict" }), NOW)).toBe("");
    });
});

describe("statusOf", () => {
    it("maps each status to its label and tone", () => {
        expect(statusOf(change("1"))).toEqual({ text: "To review", tone: "warn" });
        expect(statusOf(change("1", { status: "applied" }))).toEqual({ text: "Applied", tone: "ok" });
        expect(statusOf(change("1", { status: "kept" }))).toEqual({ text: "Kept", tone: "none" });
        expect(statusOf(change("1", { status: "conflict" }))).toEqual({ text: "Changed on disk", tone: "warn" });
    });
});

describe("kindLabel and fileLabel", () => {
    it("labels each kind, naming the doc target and the shared repo", () => {
        const p = splitProject([]);
        expect(
            kindLabel(p, change("1", { kind: "move-to-doc", op: op({ docpath: "C:\\src\\waveterm\\CLAUDE.md" }) }))
        ).toBe("Move to CLAUDE.md");
        expect(kindLabel(p, change("1", { kind: "remove-shared" }))).toBe("Remove from SIEM");
        expect(kindLabel(p, change("1", { kind: "add-to-index" }))).toBe("Add to index");
        expect(kindLabel(p, settings())).toBe("Settings");
    });

    it("names the shared repo for a removal after the switch-over moved the folder", () => {
        const p = project({ path: SPLIT_PATH, folder: "D:/own/memory", formershared: SHARED_FOLDER });
        expect(kindLabel(p, change("1", { kind: "remove-shared" }))).toBe("Remove from SIEM");
    });

    it("lists one or two memory files and counts the rest", () => {
        expect(fileLabel(change("1", { op: op({ memories: ["a.md"] }) }))).toBe("a.md");
        expect(fileLabel(change("1", { op: op({ memories: ["a.md", "b.md"] }) }))).toBe("a.md + b.md");
        expect(fileLabel(change("1", { op: op({ memories: ["hub.md", "g1.md", "g2.md", "g3.md"] }) }))).toBe(
            "hub.md + 3 more"
        );
        expect(fileLabel(change("1", { files: [{ path: "C:\\m\\x.md", sha256: "" }] }))).toBe("x.md");
        expect(fileLabel(settings())).toBe(`${SPLIT_PATH}\\.claude\\settings.local.json`);
    });
});
