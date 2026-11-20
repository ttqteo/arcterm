// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { bugReportPrompt, type BugReportForPrompt } from "./bugreportprompt";

const REPO = "D:\\work\\arcterm";
const PROJECT = "arcterm";

const report = (over: Partial<BugReportForPrompt> = {}): BugReportForPrompt => ({
    id: "20261119-153012",
    dir: "C:\\Users\\me\\AppData\\Local\\dev.arc.app\\data\\reports\\20261119-153012",
    text: "the suggested replies did not show after the turn",
    surface: "agent",
    agent: { id: "tab-1", name: "worker" },
    hasscreen: true,
    ...over,
});

const two = [
    report(),
    report({
        id: "20261119-154501",
        dir: "C:\\Users\\me\\AppData\\Local\\dev.arc.app\\data\\reports\\20261119-154501",
        text: "Gửi stays disabled\nafter I typed a line",
        agent: undefined,
        hasscreen: false,
    }),
];

describe("bugReportPrompt", () => {
    it("lists every report's folder and id, and what is in a folder", () => {
        const p = bugReportPrompt({ repoPath: REPO, project: PROJECT, reports: two });
        for (const r of two) {
            expect(p).toContain(r.id);
            // forward slashes: a backslash path in a quoted shell argument is one wrong character from an escape
            expect(p).toContain(r.dir!.replace(/\\/g, "/"));
        }
        expect(p).toContain("report.json");
        expect(p).toContain("screen.png");
        expect(p).toContain("log.txt");
        // the report's text, on one line, tells the reports apart before a folder is opened
        expect(p).toContain('said: "Gửi stays disabled after I typed a line"');
    });

    it("says where a picture is missing instead of naming a file that is not there", () => {
        const p = bugReportPrompt({ repoPath: REPO, project: PROJECT, reports: two });
        expect(p).toContain("files: report.json, screen.png, log.txt");
        expect(p).toContain("files: report.json, (no screen.png: the capture failed), log.txt");
    });

    it("names the region a report framed, and says how to read it", () => {
        const framed = [{ ...two[0], region: { x: 120, y: 40, w: 300, h: 64 } }];
        const p = bugReportPrompt({ repoPath: REPO, project: PROJECT, reports: framed });
        expect(p).toContain("screen.png (the person framed 300x64 px at 120,40)");
        expect(p).toContain("When `report.json` has a `region`, the person framed where it went wrong");
    });

    it("fills the three commands with the repo and the project", () => {
        const p = bugReportPrompt({ repoPath: REPO, project: PROJECT, reports: two });
        expect(p).toContain('wsh runs start --mode orchestrator --project "D:/work/arcterm"');
        expect(p).toContain('wsh effort create "<title>" --project "arcterm" --chunk');
        expect(p).toContain("wsh bugreport done <id> --outcome");
        expect(p).toContain("[--run <run id>] [--effort <initiative oid>]");
        // the repo's own path is told once, with forward slashes
        expect(p).toContain('arcterm\'s own repo: D:/work/arcterm (project "arcterm")');
        expect(p).not.toContain("D:\\work");
    });

    it("tells the three outcomes apart: small is a run, large an initiative, unclear one question back", () => {
        const p = bugReportPrompt({ repoPath: REPO, project: PROJECT, reports: two });
        expect(p).toMatch(/\*\*Small\*\*.*one task of a run can fix/);
        expect(p).toMatch(/\*\*Large\*\*.*design call/);
        expect(p).toMatch(/\*\*Unclear\*\*/);
        expect(p).toContain("ask the person one question");
        expect(p).toContain("`handling`");
        // a large bug starts no run
        expect(p).toContain("start no run");
    });

    it("stops unless the reports are the ones this agent holds", () => {
        const p = bugReportPrompt({ repoPath: REPO, project: PROJECT, reports: two });
        expect(p).toContain("wsh bugreport list --state handling");
        expect(p).toMatch(/If one is not, stop/);
    });

    it("asks for a closing list and for the ids to be marked", () => {
        const p = bugReportPrompt({ repoPath: REPO, project: PROJECT, reports: two });
        expect(p).toContain("Close with a short list");
        expect(p).toContain("20261119-153012, 20261119-154501");
    });

    it("groups several reports of one bug, and has nothing to group for one report", () => {
        const several = bugReportPrompt({ repoPath: REPO, project: PROJECT, reports: two });
        expect(several).toContain("2 reports are yours");
        expect(several).toContain("Group the reports that are the same bug");
        expect(several).toContain("each fix on a line of its own, naming its report id>");
        expect(several).toContain("Read them all in one pass");

        const one = bugReportPrompt({ repoPath: REPO, project: PROJECT, reports: [report()] });
        expect(one).toContain("one report is yours");
        expect(one).not.toContain("Group the reports");
        expect(one).toContain("naming the report id>");
        expect(one).toContain("Read it in one pass");
        // the steps count on: 1 decide, 2 run, 3 mark, 4 close (one more in front for grouping several)
        expect(one).toMatch(/\n1\. Decide how big the bug is/);
        expect(one).toMatch(/\n2\. If it is small, start one run/);
        expect(one).toMatch(/\n3\. Mark each report/);
        expect(one).toMatch(/\n4\. Close with a short list/);
        expect(several).toMatch(/\n3\. Start one run for every small bug together/);
        expect(several).toMatch(/\n4\. Mark each report/);
        expect(several).toMatch(/\n5\. Close with a short list/);
    });

    it("puts every small bug in one run, and holds a later small fix until that run has landed", () => {
        const several = bugReportPrompt({ repoPath: REPO, project: PROJECT, reports: two });
        expect(several).toContain("do not start a run per bug");
        expect(several).toContain("never a run per bug");
        expect(several).toContain("each fix on a line of its own, naming its report id");
        // the command is told once, in the run step, not under each group
        expect(several.split("wsh runs start").length - 1).toBe(1);
        expect(several).toContain("reports in one run share its id");
        expect(several).toContain("does not start a second run while that one is still working");
        const one = bugReportPrompt({ repoPath: REPO, project: PROJECT, reports: [report()] });
        expect(one).toContain("does not start a second run while that one is still working");
    });

    it("cuts a long text to one line and names the surface and the agent in focus", () => {
        const long = "x".repeat(500);
        const p = bugReportPrompt({ repoPath: REPO, project: PROJECT, reports: [report({ text: long })] });
        expect(p).not.toContain(long);
        expect(p).toContain("x".repeat(199) + "…");
        expect(p).toContain("pressed on: surface agent, agent in focus: worker");
        const bare = bugReportPrompt({
            repoPath: REPO,
            project: PROJECT,
            reports: [report({ surface: "", agent: undefined })],
        });
        expect(bare).not.toContain("pressed on:");
    });
});
