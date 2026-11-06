// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    applyAllIds,
    askState,
    canApply,
    cardKeyAction,
    changeGroups,
    checkLine,
    checkNowBlocked,
    checkResult,
    closedText,
    defaultMemoryView,
    doneCard,
    fileLabel,
    indexCards,
    isPending,
    judgedByText,
    kindLabel,
    kindTone,
    LIMIT_BYTES,
    LIMIT_LINES,
    memoryCard,
    memoryQueue,
    nextOpenInQueue,
    nextPending,
    pickCard,
    pickChange,
    projectsToReview,
    railOrder,
    railRow,
    resolveSelection,
    selectAfterKeep,
    selectAfterUndo,
    setupRailTitle,
    splitText,
    statusOf,
    stepChange,
    stepQueue,
    switchGate,
    talkItOverTask,
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
        body: "",
        verdict: "",
        doclines: [],
        source: "",
        proposedat: 0,
        fromreview: "",
        supersededby: "",
        askreason: "",
        askedat: 0,
        askedby: "",
        askerror: "",
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
        askwaiting: [],
        judgedby: "",
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

describe("checkResult", () => {
    it("counts the changes still to review, leaving out decided ones", () => {
        const p = project({
            changes: [change("1"), change("2", { status: "conflict" }), change("3", { status: "applied" })],
        });
        expect(checkResult(p)).toEqual({ text: "Checked · 2 to review", tone: "warn" });
    });

    it("says so when the check left nothing to review", () => {
        expect(checkResult(project({ changes: [change("1", { status: "kept" })] }))).toEqual({
            text: "Checked · nothing to review",
            tone: "ok",
        });
    });

    it("reports a failure even over changes kept from the last good check", () => {
        expect(checkResult(project({ lasterror: "model run timed out", changes: [change("1")] }))).toEqual({
            text: "Check failed",
            tone: "warn",
        });
    });
});

describe("projectsToReview, setupRailTitle and toolbarStatus", () => {
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

    it("names what the Setup badge counts in its title, and nothing when there is no badge", () => {
        expect(setupRailTitle(0)).toBe("Setup");
        expect(setupRailTitle(1)).toBe("Setup — memory to review in 1 project");
        expect(setupRailTitle(3)).toBe("Setup — memory to review in 3 projects");
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
            empty: false,
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

    it("ignores empty segments around the shared folder's path", () => {
        const r = railRow(splitProject([settings()], { folder: `${SHARED_FOLDER}/` }));
        expect(r.meter).toBe("Shares SIEM’s memory · 134 lines");
        const doubled = railRow(splitProject([settings()], { folder: SHARED_FOLDER.replace("/memory", "//memory") }));
        expect(doubled.meter).toBe("Shares SIEM’s memory · 134 lines");
    });

    it("names the repo for a project that sits at the repo's root", () => {
        const r = railRow(splitProject([settings()], { path: "C:\\Users\\me\\src\\SIEM" }));
        expect(r.meter).toBe("Shares SIEM’s memory · 134 lines");
    });

    it("strips every trailing separator from the project path before matching", () => {
        const r = railRow(
            splitProject([settings()], {
                path: "C:\\Users\\me\\src\\SIEM\\\\",
                folder: "C:/Users/me/.claude/projects/C--Users-me-src-SIEM-/memory",
            })
        );
        expect(r.meter).toBe("Shares C--Users-me-src-SIEM-’s memory · 134 lines");
    });

    it("names an empty folder's repo as empty rather than undefined", () => {
        const r = railRow(splitProject([settings()], { folder: "" }));
        expect(r.meter).toBe("Shares ’s memory · 134 lines");
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
            empty: false,
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

describe("railRow empty", () => {
    it("draws a checked project with an empty index and nothing to review on one line", () => {
        expect(railRow(project({ index: { exists: false, lines: 0, bytes: 0 } })).empty).toBe(true);
        expect(railRow(project({ index: { exists: true, lines: 0, bytes: 0 } })).empty).toBe(true);
    });

    it("keeps the full row for an index with lines, a change to review, a failed check, a split or no check", () => {
        const none = { exists: false, lines: 0, bytes: 0 };
        expect(railRow(project()).empty).toBe(false);
        expect(railRow(project({ index: none, changes: [change("1")] })).empty).toBe(false);
        expect(railRow(project({ index: none, lasterror: "boom" })).empty).toBe(false);
        expect(railRow(project({ index: none, checkedat: 0 })).empty).toBe(false);
        expect(railRow(project({ index: none, checking: true })).empty).toBe(false);
        expect(railRow(splitProject([], { index: none })).empty).toBe(false);
    });

    it("reads an empty index as 0 KB, not 0.0", () => {
        expect(railRow(project({ index: { exists: true, lines: 0, bytes: 0 }, changes: [change("1")] })).meter).toBe(
            "0 lines · 0 of 25 KB"
        );
        expect(indexCards(project({ index: { exists: true, lines: 0, bytes: 0 } }))[0].kb).toBe("0 of 25 KB");
    });
});

describe("railOrder", () => {
    it("puts projects with a change to review first, each half in the given order", () => {
        const ps = [
            project({ project: "a" }),
            project({ project: "b", changes: [change("1")] }),
            project({ project: "c", changes: [change("2", { status: "applied" })] }),
            project({ project: "d", changes: [change("3", { status: "conflict" })] }),
        ];
        expect(railOrder(ps).map((p) => p.project)).toEqual(["b", "d", "a", "c"]);
    });
});

describe("selection", () => {
    // listed shared, own, switch whatever order the changes come in
    const split = () =>
        splitProject([
            settings(),
            change("o1", { kind: "delete", group: "own" }),
            change("m1", { kind: "move-here", group: "shared", status: "applied" }),
            change("m2", { kind: "move-here", group: "shared" }),
        ]);

    it("picks the chosen change, else the first still to review in table order", () => {
        expect(pickChange(split(), "o1")?.id).toBe("o1");
        expect(pickChange(split(), null)?.id).toBe("m2");
        expect(pickChange(split(), "gone")?.id).toBe("m2");
        expect(pickChange(project(), null)).toBeNull();
    });

    it("opens the rail's first project, one with a change to review, when none is chosen", () => {
        const ps = [project({ project: "a" }), project({ project: "b", changes: [change("1")] })];
        expect(resolveSelection(ps, null, null)).toEqual({ project: ps[1], change: ps[1].changes[0] });
        expect(resolveSelection(ps, "a", null)).toEqual({ project: ps[0], change: null });
        expect(resolveSelection(null, "a", null)).toEqual({ project: null, change: null });
    });

    it("steps through the table order and stops at either end", () => {
        const p = split();
        expect(stepChange(p, "m1", 1)).toBe("m2");
        expect(stepChange(p, "m2", 1)).toBe("o1");
        expect(stepChange(p, "s1", 1)).toBe("s1");
        expect(stepChange(p, "m1", -1)).toBe("m1");
        expect(stepChange(p, null, 1)).toBe("m1");
        expect(stepChange(project(), null, 1)).toBeNull();
    });

    it("moves on to the next change still to review, wrapping to the top, and to none when all are decided", () => {
        const p = split();
        expect(nextPending(p, "m2")).toBe("o1");
        expect(nextPending(p, "s1")).toBe("m2");
        const done = project({ changes: [change("1", { status: "applied" }), change("2", { status: "kept" })] });
        expect(nextPending(done, "1")).toBeNull();
    });
});

describe("canApply", () => {
    it("allows an open change, and holds a decided one, a conflict and a gated switch-over", () => {
        const p = splitProject([change("m1", { kind: "move-here", group: "shared" }), settings()]);
        expect(canApply(p, p.changes[0])).toBe(true);
        expect(canApply(p, p.changes[1])).toBe(false);
        expect(canApply(p, change("c", { status: "conflict" }))).toBe(false);
        expect(canApply(p, change("a", { status: "applied" }))).toBe(false);
    });
});

describe("applyAllIds", () => {
    it("offers a labelled group's open changes when there are at least two, leaving conflicts out", () => {
        const p = splitProject([
            change("m1", { kind: "move-here", group: "shared" }),
            change("m2", { kind: "copy-here", group: "shared" }),
            change("m3", { kind: "move-here", group: "shared", status: "conflict" }),
            change("m4", { kind: "move-here", group: "shared", status: "applied" }),
            change("o1", { kind: "delete", group: "own" }),
            settings(),
        ]);
        const [shared, own, sw] = changeGroups(p);
        expect(applyAllIds(shared)).toEqual(["m1", "m2"]);
        expect(applyAllIds(own)).toEqual([]);
        expect(applyAllIds(sw)).toEqual([]);
    });

    it("never offers it on an own folder's unlabelled list", () => {
        expect(applyAllIds(changeGroups(project({ changes: [change("1"), change("2")] }))[0])).toEqual([]);
    });
});

describe("kindTone", () => {
    it("sets removals apart from additions and edits in place", () => {
        expect(["delete", "remove-shared"].map(kindTone)).toEqual(["remove", "remove"]);
        expect(["move-here", "copy-here", "add-to-index", "move-to-doc"].map(kindTone)).toEqual([
            "add",
            "add",
            "add",
            "add",
        ]);
        expect(["trim", "merge", "settings"].map(kindTone)).toEqual(["edit", "edit", "edit"]);
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

    it("says not checked yet, not nothing left, before any check", () => {
        const p = project({ checkedat: 0, nextcheckat: 0, changes: [] });
        expect(indexCards(p)[0].after).toBe("Not checked yet.");
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

    it("reads a review marked still true, with no backup to mention", () => {
        const c = change("1", { kind: "review", status: "applied", decidedat: decided, backupuntil: until });
        expect(closedText(project(), c, NOW)).toBe(
            "Marked still true at 17:42. It comes back for review if it goes untouched another 30 days."
        );
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
        expect(statusOf(change("1", { status: "superseded" }))).toEqual({ text: "Replaced", tone: "none" });
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
        expect(kindLabel(p, change("1", { kind: "review" }))).toBe("Review");
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

// ---- one card at a time ----

const FOLDER = "C:/Users/me/.claude/projects/C--Users-me-src-waveterm/memory";
const AT = (h: number, m: number) => new Date(2026, 9, 14, h, m).getTime();

function review(id: string, name: string, over: Partial<MemChange> = {}): MemChange {
    return change(id, {
        kind: "review",
        title: `${name} title`,
        applylabel: "Still true",
        effect: "untouched 30 days",
        files: [{ path: `${FOLDER}/${name}`, sha256: "abc" }],
        op: op({ folder: FOLDER, memories: [name] }),
        evidence: [{ tone: "warn", text: "Untouched for 30 days, since ", code: "2026-09-14" }],
        body: `Body of ${name}`,
        ...over,
    });
}

const proposalDiffs: MemDiff[] = [
    {
        path: "C:\\Users\\me\\src\\waveterm\\AGENTS.md",
        note: "Design docs",
        lines: [{ sign: "+", text: "Before `wsh runs start`, tell the person the models." }],
    },
    { path: `${FOLDER}/feedback_confirm.md`, note: "deleted", lines: [{ sign: "-", text: "old rule" }] },
    { path: `${FOLDER}/MEMORY.md`, note: "", lines: [{ sign: "-", text: "- [Confirm](feedback_confirm.md)" }] },
];

// table order: r1, rb, d1, ra, p1, r2, t1, k1, old1, s1
function cardProject(over: Partial<MemHygieneProject> = {}): MemHygieneProject {
    return project({
        folder: FOLDER,
        changes: [
            review("r1", "feedback_confirm-run-models.md"),
            review("rb", "project_old.md", { status: "superseded", supersededby: "d1" }),
            change("d1", {
                kind: "delete",
                applylabel: "Delete",
                status: "applied",
                decidedat: AT(17, 0),
                fromreview: "rb",
                op: op({ folder: FOLDER, memories: ["project_old.md"] }),
            }),
            review("ra", "feedback_confirm.md", { status: "superseded", supersededby: "p1" }),
            change("p1", {
                kind: "move-to-doc",
                title: "The rule is about this repo's engine handoff, which AGENTS.md already describes.",
                note: "Move it where every agent reads it.",
                applylabel: "Move to AGENTS.md",
                source: "agent",
                fromreview: "ra",
                proposedat: AT(12, 58),
                body: "Before wsh runs start, state the models.",
                files: [
                    { path: "C:\\Users\\me\\src\\waveterm\\AGENTS.md", sha256: "a" },
                    { path: `${FOLDER}/feedback_confirm.md`, sha256: "b" },
                    { path: `${FOLDER}/MEMORY.md`, sha256: "c" },
                ],
                op: op({
                    folder: FOLDER,
                    memories: ["feedback_confirm.md"],
                    docpath: "C:\\Users\\me\\src\\waveterm\\AGENTS.md",
                }),
                diffs: proposalDiffs,
            }),
            review("r2", "user_role.md", { effect: "3 findings", evidence: [] }),
            change("t1", { effect: "1 line shorter", op: op({ memories: ["reference_links.md"] }) }),
            change("k1", { status: "kept", decidedat: AT(16, 0) }),
            change("old1", { status: "applied", decidedat: new Date(2026, 9, 13, 10, 0).getTime() }),
            review("s1", "feedback_tests.md", { status: "applied", decidedat: AT(17, 30) }),
        ],
        ...over,
    });
}

describe("a superseded Review is not pending", () => {
    const p = () =>
        project({
            changes: [
                review("ra", "feedback_a.md", { status: "superseded", supersededby: "p1" }),
                change("p1", { status: "applied", fromreview: "ra" }),
            ],
        });

    it("matches Go's Pending: only no status, open and conflict are undecided", () => {
        expect(["", "open", "conflict"].map((s) => isPending(change("1", { status: s })))).toEqual([true, true, true]);
        expect(["applied", "kept", "superseded"].map((s) => isPending(change("1", { status: s })))).toEqual([
            false,
            false,
            false,
        ]);
    });

    it("leaves it out of the check result, the rail row and the Setup badge", () => {
        expect(checkResult(p())).toEqual({ text: "Checked · nothing to review", tone: "ok" });
        expect(railRow(p())).toMatchObject({ status: "Nothing to review", tone: "ok" });
        expect(projectsToReview([p()])).toBe(0);
        expect(railOrder([p(), project({ project: "b", changes: [change("1")] })]).map((x) => x.project)).toEqual([
            "b",
            "waveterm",
        ]);
    });

    it("never applies it, and the table opens an open change over it", () => {
        expect(canApply(p(), p().changes[0])).toBe(false);
        const q = project({ changes: [...p().changes, change("o1")] });
        expect(pickChange(q, null)?.id).toBe("o1");
    });
});

describe("defaultMemoryView", () => {
    it("opens a plain project in cards", () => {
        expect(defaultMemoryView(cardProject())).toBe("cards");
        expect(defaultMemoryView(project())).toBe("cards");
    });

    it("opens a shared folder, or an open split, remove-shared or settings change, in the table", () => {
        expect(defaultMemoryView(splitProject([settings("applied")]))).toBe("table");
        expect(defaultMemoryView(project({ changes: [change("m", { kind: "move-here", group: "shared" })] }))).toBe(
            "table"
        );
        expect(defaultMemoryView(project({ changes: [change("r", { kind: "remove-shared" })] }))).toBe("table");
        expect(defaultMemoryView(project({ changes: [settings()] }))).toBe("table");
    });

    it("goes back to cards once those changes are decided", () => {
        const p = project({
            changes: [change("r", { kind: "remove-shared", status: "applied" }), settings("applied"), change("t")],
        });
        expect(defaultMemoryView(p)).toBe("cards");
    });
});

describe("memoryQueue", () => {
    it("lists open changes first, then those decided since the last check, hiding superseded ones", () => {
        const q = memoryQueue(cardProject(), NOW);
        expect(q.map((r) => [r.id, r.decided])).toEqual([
            ["r1", false],
            ["p1", false],
            ["r2", false],
            ["t1", false],
            ["d1", true],
            ["k1", true],
            ["s1", true],
        ]);
    });

    it("reads each row's status line", () => {
        const rows = Object.fromEntries(memoryQueue(cardProject(), NOW).map((r) => [r.id, [r.status, r.tone]]));
        expect(rows).toEqual({
            r1: ["Untouched 30 days", "warn"],
            p1: ["Agent proposes: move to AGENTS.md", "accent"],
            r2: ["3 findings", "none"],
            t1: ["Trim · 1 line shorter", "none"],
            d1: ["Deleted · Undo", "none"],
            k1: ["Kept", "none"],
            s1: ["Still true", "none"],
        });
    });

    it("names the memory, not the agent's reason, on a proposal's row", () => {
        const row = memoryQueue(cardProject(), NOW).find((r) => r.id === "p1");
        expect(row?.title).toBe("feedback_confirm.md title");
    });

    it("reads an applied change, a conflict, an ask running and an ask waiting", () => {
        const p = cardProject({
            asking: { changeid: "r2", startedat: NOW - 60_000, runtime: "claude" },
            askwaiting: ["r1"],
        });
        p.changes.push(change("a2", { status: "applied", decidedat: AT(17, 45) }));
        p.changes.push(change("c1", { status: "conflict" }));
        const rows = Object.fromEntries(memoryQueue(p, NOW).map((r) => [r.id, r.status]));
        expect(rows.r2).toBe("Asking claude…");
        expect(rows.r1).toBe("Waiting to ask…");
        expect(rows.a2).toBe("Applied · Undo");
        expect(rows.c1).toBe("Changed on disk");
    });

    it("lists every decided change while the project was never checked", () => {
        const p = cardProject({ checkedat: 0 });
        expect(memoryQueue(p, NOW).map((r) => r.id)).toContain("old1");
    });
});

describe("askState and checkNowBlocked", () => {
    it("reads the running ask and the ones waiting behind it", () => {
        const p = cardProject({
            asking: { changeid: "r2", startedat: NOW - 60_000, runtime: "claude" },
            askwaiting: ["r1"],
        });
        expect(askState(p, "r2", NOW)).toBe("asking");
        expect(askState(p, "r1", NOW)).toBe("waiting");
        expect(askState(p, "t1", NOW)).toBe("idle");
        expect(checkNowBlocked(p, NOW)).toBe("Waiting for Ask an agent");
    });

    it("reads a marker older than the check timeout, and the queue behind it, as failed", () => {
        const p = cardProject({
            asking: { changeid: "r2", startedat: NOW - 31 * 60_000, runtime: "claude" },
            askwaiting: ["r1"],
        });
        expect(askState(p, "r2", NOW)).toBe("idle");
        expect(askState(p, "r1", NOW)).toBe("idle");
        expect(checkNowBlocked(p, NOW)).toBeNull();
    });

    it("is idle with no marker, even with a null wait list", () => {
        const p = cardProject({ askwaiting: null as unknown as string[] });
        expect(askState(p, "r1", NOW)).toBe("idle");
        expect(checkNowBlocked(p, NOW)).toBeNull();
    });
});

describe("queue navigation", () => {
    it("steps through the queue and stops at either end", () => {
        const p = cardProject();
        expect(stepQueue(p, "r1", 1)).toBe("p1");
        expect(stepQueue(p, "t1", 1)).toBe("d1");
        expect(stepQueue(p, "s1", 1)).toBe("s1");
        expect(stepQueue(p, "r1", -1)).toBe("r1");
        expect(stepQueue(p, "d1", -1)).toBe("t1");
    });

    it("steps from the shown card when the chosen id left the queue", () => {
        expect(stepQueue(cardProject(), "rb", 1)).toBe("p1");
        expect(stepQueue(cardProject(), null, 1)).toBe("p1");
        expect(stepQueue(project(), null, 1)).toBeNull();
    });

    it("moves on to the next open item, wrapping to the top", () => {
        const p = cardProject();
        expect(nextOpenInQueue(p, "r1")).toBe("p1");
        expect(nextOpenInQueue(p, "t1")).toBe("r1");
        expect(nextOpenInQueue(p, "k1")).toBe("r1");
    });

    it("moves on from a superseded Review's old place after a Delete", () => {
        // rb was deleted: it sits superseded between r1 and p1, so the next open item is p1
        expect(nextOpenInQueue(cardProject(), "rb")).toBe("p1");
        expect(nextOpenInQueue(cardProject(), "gone")).toBe("r1");
    });

    it("moves on to none when nothing is open", () => {
        const p = project({ changes: [change("a", { status: "applied", decidedat: AT(17, 0) })] });
        expect(nextOpenInQueue(p, "a")).toBeNull();
    });
});

describe("selectAfterUndo and selectAfterKeep", () => {
    const deleteChange = cardProject().changes.find((c) => c.id === "d1")!;

    it("shows the Review an undone Delete reopened", () => {
        const after = cardProject();
        after.changes = after.changes
            .filter((c) => c.id !== "d1")
            .map((c) => (c.id === "rb" ? { ...c, status: "open", supersededby: "" } : c));
        expect(selectAfterUndo(after, deleteChange)).toBe("rb");
    });

    it("stays on the delete when a check dropped the Review and the undo left it open", () => {
        const after = cardProject();
        after.changes = after.changes
            .filter((c) => c.id !== "rb")
            .map((c) => (c.id === "d1" ? { ...c, status: "open", decidedat: 0 } : c));
        expect(selectAfterUndo(after, deleteChange)).toBe("d1");
    });

    it("stays on an ordinary undone change", () => {
        const t = change("t9", { status: "applied" });
        expect(selectAfterUndo(cardProject(), t)).toBe("t9");
    });

    it("shows the reopened Review after Back to review", () => {
        const after = cardProject();
        after.changes = after.changes.map((c) =>
            c.id === "p1"
                ? { ...c, status: "kept", decidedat: AT(17, 50) }
                : c.id === "ra"
                  ? { ...c, status: "open", supersededby: "" }
                  : c
        );
        expect(selectAfterKeep(after, "p1")).toBe("ra");
    });

    it("moves on to the next open item after an ordinary Keep", () => {
        const after = cardProject();
        after.changes = after.changes.map((c) => (c.id === "r2" ? { ...c, status: "kept", decidedat: AT(17, 50) } : c));
        expect(selectAfterKeep(after, "r2")).toBe("t1");
    });
});

describe("pickCard and doneCard", () => {
    it("shows the chosen queue item, else the first open one", () => {
        const p = cardProject();
        expect(pickCard(p, "t1")?.id).toBe("t1");
        expect(pickCard(p, "d1")?.id).toBe("d1");
        expect(pickCard(p, "rb")?.id).toBe("r1");
        expect(pickCard(p, "old1")?.id).toBe("r1");
        expect(pickCard(p, null)?.id).toBe("r1");
    });

    it("falls to the done card when nothing is open, unless a decided row is chosen", () => {
        const p = project({ changes: [change("a", { status: "applied", decidedat: AT(17, 0) })] });
        expect(pickCard(p, null)).toBeNull();
        expect(pickCard(p, "a")?.id).toBe("a");
        expect(pickCard(project(), null)).toBeNull();
    });

    it("names the project and the next check on the done card", () => {
        expect(doneCard(project(), NOW)).toEqual({
            title: "Nothing to review in waveterm",
            next: "Next check Oct 21 at 09:12.",
        });
        expect(doneCard(project({ nextcheckat: 0 }), NOW).next).toBe("");
    });
});

describe("memoryCard", () => {
    const shown = (p: MemHygieneProject, id: string) => memoryCard(p, p.changes.find((c) => c.id === id)!, NOW);
    const buttons = (card: ReturnType<typeof memoryCard>) =>
        card.buttons.map((b) => [b.action, b.label, b.key, b.primary, b.danger, b.disabled]);

    it("draws a Review with its text, its buttons and its reason section", () => {
        const p = cardProject();
        const r1 = p.changes[0];
        Object.assign(r1, {
            verdict: "Read in none of 1,149 sessions since Sep 14.",
            doclines: [{ doc: "AGENTS.md", line: 252, text: "`wsh runs start --plan <file>`" }],
            askreason: "still needed, nothing in AGENTS.md covers it",
            askedat: AT(12, 58),
            askedby: "claude",
        });
        const card = shown(p, "r1");
        expect(card).toMatchObject({
            id: "r1",
            kind: "review",
            decided: false,
            chip: "Review",
            chipTone: "edit",
            head: { text: "Untouched 30 days, since Sep 14", tone: "warn" },
            title: "feedback_confirm-run-models.md title",
            fileLine: "feedback_confirm-run-models.md · feedback",
            body: { kind: "text", text: "Body of feedback_confirm-run-models.md" },
            hint: "Ask an agent proposes one change for this memory (move into AGENTS.md, trim, delete or still true) that you Apply with Undo. Delete keeps a copy you can undo.",
            status: null,
            reason: {
                verdict: "Read in none of 1,149 sessions since Sep 14.",
                askLine: "Asked claude at 12:58: still needed, nothing in AGENTS.md covers it",
                doclines: [{ doc: "AGENTS.md", line: 252, text: "`wsh runs start --plan <file>`" }],
                evidence: r1.evidence,
            },
        });
        expect(buttons(card)).toEqual([
            ["apply", "Still true", "a", true, false, false],
            ["ask", "Ask an agent…", "", false, false, false],
            ["delete", "Delete", "d", false, true, false],
            ["keep", "Keep as is", "x", false, false, false],
        ]);
    });

    it("reads a Review with findings and no ask, and treats null doc lines as none", () => {
        const card = shown(cardProject(), "r2");
        expect(card.head).toEqual({ text: "3 findings", tone: "none" });
        expect(card.fileLine).toBe("user_role.md · user");
        expect(card.reason.askLine).toBe("");
        const p = cardProject();
        p.changes[5] = { ...p.changes[5], doclines: null as unknown as MemDocLine[] };
        expect(shown(p, "r2").reason.doclines).toEqual([]);
    });

    it("disables Ask while a check runs, and only Ask while the Review waits to be asked", () => {
        const checking = buttons(shown(cardProject({ checking: true }), "r1"));
        expect(checking.map((b) => [b[0], b[5]])).toEqual([
            ["apply", false],
            ["ask", true],
            ["delete", false],
            ["keep", false],
        ]);
        const waiting = cardProject({
            asking: { changeid: "r2", startedat: NOW - 60_000, runtime: "claude" },
            askwaiting: ["r1"],
        });
        expect(buttons(shown(waiting, "r1")).map((b) => [b[0], b[5]])).toEqual([
            ["apply", false],
            ["ask", true],
            ["delete", false],
            ["keep", false],
        ]);
        expect(shown(waiting, "r1").status).toEqual({ text: "Waiting to ask…", tone: "none" });
    });

    it("disables every button while the Review is being asked, and says so under them", () => {
        const p = cardProject({ asking: { changeid: "r1", startedat: NOW - 60_000, runtime: "claude" } });
        const card = shown(p, "r1");
        expect(card.buttons.every((b) => b.disabled)).toBe(true);
        expect(card.status).toEqual({ text: "Asking claude…", tone: "none" });
        expect(cardKeyAction(card, "a")).toBeNull();
    });

    it("shows a failed ask's error in the warning tone, with Ask available again", () => {
        const p = cardProject();
        p.changes[0] = { ...p.changes[0], askerror: "openrouter: 401 no key" };
        const card = shown(p, "r1");
        expect(card.status).toEqual({ text: "openrouter: 401 no key", tone: "warn" });
        expect(card.buttons.find((b) => b.action === "ask")?.disabled).toBe(false);
    });

    it("holds Still true and Delete on a conflict, but not Keep", () => {
        const p = cardProject();
        p.changes[0] = { ...p.changes[0], status: "conflict" };
        expect(buttons(shown(p, "r1")).map((b) => [b[0], b[5]])).toEqual([
            ["apply", true],
            ["ask", true],
            ["delete", true],
            ["keep", false],
        ]);
    });

    it("draws an agent proposal with the memory's title, the agent's reason and its diffs", () => {
        const card = shown(cardProject(), "p1");
        expect(card).toMatchObject({
            kind: "proposal",
            chip: "Move to AGENTS.md",
            chipTone: "add",
            head: { text: "Proposed by the agent, 12:58", tone: "none" },
            title: "feedback_confirm.md title",
            fileLine: "feedback_confirm.md · feedback",
            body: {
                kind: "proposal",
                reason: "The rule is about this repo's engine handoff, which AGENTS.md already describes.",
                diffs: proposalDiffs,
            },
            hint: "Apply keeps a copy of all three files, with Undo. Talk it over opens a Claude agent with this memory, AGENTS.md and the proposal; it edits the files itself, outside Undo.",
        });
        expect(buttons(card)).toEqual([
            ["apply", "Apply", "a", true, false, false],
            ["talk", "Talk it over with an agent", "", false, false, false],
            ["keep", "Back to review", "x", false, false, false],
        ]);
    });

    it("names an earlier day on a proposal's head", () => {
        const p = cardProject();
        p.changes[4] = { ...p.changes[4], proposedat: new Date(2026, 9, 13, 12, 58).getTime() };
        expect(shown(p, "p1").head.text).toBe("Proposed by the agent, yesterday at 12:58");
    });

    it("draws another kind as its diff with its own apply label and the judge's note as the hint", () => {
        const p = cardProject();
        p.changes[6] = { ...p.changes[6], note: "Judged by the weekly check.", diffs: proposalDiffs.slice(0, 1) };
        const card = shown(p, "t1");
        expect(card).toMatchObject({
            kind: "change",
            chip: "Trim",
            head: { text: "1 line shorter", tone: "none" },
            fileLine: "reference_links.md · reference",
            body: { kind: "diff", diffs: proposalDiffs.slice(0, 1) },
            hint: "Judged by the weekly check.",
        });
        expect(buttons(card)).toEqual([
            ["apply", "Apply trim", "a", true, false, false],
            ["keep", "Keep as is", "x", false, false, false],
        ]);
    });

    it("draws an applied delete with Undo and the applied text", () => {
        const card = shown(cardProject(), "d1");
        expect(card).toMatchObject({
            kind: "change",
            decided: true,
            chip: "Delete",
            chipTone: "remove",
            title: "project_old.md title",
            status: { text: "Applied at 17:00.", tone: "ok" },
        });
        expect(buttons(card)).toEqual([["undo", "Undo", "u", false, false, false]]);
    });

    it("draws a kept change with Review again, and a Review marked still true with Undo", () => {
        const kept = shown(cardProject(), "k1");
        expect(buttons(kept)).toEqual([["reopen", "Review again", "u", false, false, false]]);
        expect(kept.status?.text).toBe("Kept as is. The next check skips it unless the memory changes.");
        const still = shown(cardProject(), "s1");
        expect(still.kind).toBe("review");
        expect(still.body).toEqual({ kind: "text", text: "Body of feedback_tests.md" });
        expect(buttons(still)).toEqual([["undo", "Undo", "u", false, false, false]]);
    });

    it("holds a gated switch-over and says why", () => {
        const p = splitProject([change("m1", { kind: "move-here", group: "shared" }), settings()]);
        const card = memoryCard(p, p.changes[1], NOW);
        expect(card.buttons[0]).toMatchObject({ action: "apply", disabled: true });
        expect(card.status?.tone).toBe("warn");
        expect(card.status?.text).toMatch(/^Review the 1 change from SIEM’s memory first\./);
    });
});

describe("cardKeyAction", () => {
    const card = (p: MemHygieneProject, id: string) => memoryCard(p, p.changes.find((c) => c.id === id)!, NOW);

    it("maps a, d and x on a Review", () => {
        const c = card(cardProject(), "r1");
        expect(["a", "d", "x", "u", "z"].map((k) => cardKeyAction(c, k))).toEqual([
            "apply",
            "delete",
            "keep",
            null,
            null,
        ]);
    });

    it("maps a and x on a proposal, with no d", () => {
        const c = card(cardProject(), "p1");
        expect(["a", "d", "x"].map((k) => cardKeyAction(c, k))).toEqual(["apply", null, "keep"]);
    });

    it("maps u to undo or reopen on a decided card", () => {
        expect(cardKeyAction(card(cardProject(), "d1"), "u")).toBe("undo");
        expect(cardKeyAction(card(cardProject(), "k1"), "u")).toBe("reopen");
        expect(cardKeyAction(card(cardProject(), "d1"), "a")).toBeNull();
    });
});

describe("judgedByText", () => {
    it("names the fallback runtime, and nothing otherwise", () => {
        expect(judgedByText(project({ judgedby: "claude (OpenRouter has no key)" }))).toBe(
            "judged by claude (OpenRouter has no key)"
        );
        expect(judgedByText(project())).toBe("");
    });
});

describe("talkItOverTask", () => {
    it("hands the agent the memory, the doc, the proposal and the rule that it edits files itself", () => {
        const p = cardProject();
        const task = talkItOverTask(p, p.changes[4]);
        expect(task).toContain(`${FOLDER}/feedback_confirm.md`);
        expect(task).toContain("Before wsh runs start, state the models.");
        expect(task).toContain("C:\\Users\\me\\src\\waveterm\\AGENTS.md");
        expect(task).toContain("Move to AGENTS.md");
        expect(task).toContain("The rule is about this repo's engine handoff");
        expect(task).toContain("Move it where every agent reads it.");
        expect(task).toContain(`--- ${FOLDER}/MEMORY.md`);
        expect(task).toContain("+Before `wsh runs start`, tell the person the models.");
        expect(task).toContain("-- [Confirm](feedback_confirm.md)");
        expect(task).toMatch(/edit the files yourself/i);
    });

    it("falls back to the project's AGENTS.md and the Review's text", () => {
        const p = project({ path: "C:\\Users\\me\\src\\waveterm" });
        const r = review("r", "feedback_x.md");
        const trim = change("t", { kind: "trim", source: "agent", fromreview: "r", body: "", diffs: [] });
        p.changes = [r, trim];
        const task = talkItOverTask(p, trim);
        expect(task).toContain("C:\\Users\\me\\src\\waveterm\\AGENTS.md");
        expect(task).toContain("Body of feedback_x.md");
        expect(task).toContain(`${FOLDER}/feedback_x.md`);
    });
});
