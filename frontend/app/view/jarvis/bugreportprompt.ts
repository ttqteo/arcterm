// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The prompt the "Báo lỗi arcterm" agent starts on when Xử lý is pressed (bugreportprocess.ts): the folders of the waiting
// bug reports to read, and what to do with them on its own: group, start a run for a small fix, make an initiative for a
// large one, ask one question back for an unclear one, mark each finished report with `wsh bugreport done`
// (docs/superpowers/specs/2026-11-19-bug-report-design.md, "Process"). Pure.

// what the prompt reads off a report (a wshrpc BugReport: Dir and HasScreen are the wire's, never in report.json)
export type BugReportForPrompt = Pick<BugReport, "id" | "dir" | "text" | "surface" | "agent" | "hasscreen">;

export interface BugReportPromptInput {
    repoPath: string; // arcterm's own checkout, where the agent runs
    project: string; // the registered project at repoPath
    reports: readonly BugReportForPrompt[];
}

// one line of what the person wrote, enough to tell the reports apart before any folder is opened
const TEXT_CAP = 200;

// a path as a command or a read names it: forward slashes work on every host, and a backslash in a double-quoted shell
// argument is one wrong character from an escape
function slash(p: string): string {
    return p.replace(/\\/g, "/");
}

function oneLine(text: string): string {
    const flat = text.replace(/\s+/g, " ").trim();
    return flat.length > TEXT_CAP ? flat.slice(0, TEXT_CAP - 1) + "…" : flat;
}

function reportBlock(r: BugReportForPrompt): string {
    const where = [r.surface ? `surface ${r.surface}` : "", r.agent?.name ? `agent in focus: ${r.agent.name}` : ""]
        .filter((s) => s !== "")
        .join(", ");
    const files = ["report.json", r.hasscreen ? "screen.png" : "(no screen.png: the capture failed)", "log.txt"].join(
        ", "
    );
    return [
        `- ${r.id}`,
        `  folder: ${slash(r.dir ?? "")}`,
        `  files: ${files}`,
        ...(where !== "" ? [`  pressed on: ${where}`] : []),
        `  said: "${oneLine(r.text)}"`,
    ].join("\n");
}

export function bugReportPrompt(input: BugReportPromptInput): string {
    const repo = slash(input.repoPath);
    const n = input.reports.length;
    const many = n > 1;
    const ids = input.reports.map((r) => r.id);
    return [
        `You handle the arcterm bug reports waiting for you. The person pressed the bug button in arcterm; ${
            many ? `${n} reports` : "one report"
        } ${many ? "are" : "is"} yours. Read ${many ? "them all" : "it"} in one pass and act on your own: there is no review step after you.`,
        "",
        `You work in arcterm's own repo: ${repo} (project "${input.project}"). Reports are about arcterm itself; a report about an agent behaving badly or about another project is not yours to fix: mark it done and say so in its outcome.`,
        "",
        "Before anything else, check that these reports are yours:",
        "",
        "    wsh bugreport list --state handling",
        "",
        `Every id below must be listed there. If one is not, stop and tell the person: another agent may hold ${many ? "them" : "it"}. Change nothing.`,
        "",
        `## The report${many ? "s" : ""}`,
        "",
        ...input.reports.map(reportBlock),
        "",
        "Each folder holds:",
        "",
        "- `report.json`: what the person typed (`text`), when (`ts`, unix ms), the app `version` and `commit`, the `surface` and the `agent` in focus at the press, and the report's `state`.",
        "- `screen.png`: the window at the moment of the press. Look at it: the Read tool shows images.",
        "- `log.txt`: arcterm's log, the five minutes before the press and what was logged while the person typed. The tail is what explains the press.",
        "",
        "Read the folders, then read the code they point at in the repo. Do not guess at a cause you have not seen.",
        "",
        "## What to do",
        "",
        ...(many
            ? [
                  "1. Group the reports that are the same bug. One group is one piece of work, however many reports it holds.",
                  "2. For each group, decide how big it is:",
              ]
            : ["1. Decide how big the bug is:"]),
        "",
        "   - **Small** is one clear cause in one area of the code, a few files, that one run can fix. Start a run:",
        "",
        `         wsh runs start --mode orchestrator --project "${repo}" --json "<goal: the fix, naming the report id${many ? "s" : ""}>"`,
        "",
        "     The engine's default landing applies: the run lands on its own branch and merges back when it completes, held with a reason when it cannot, as a run the person starts. Note the run id it prints.",
        "   - **Large** is several areas of the code, a design call, or more than one run's work. Make an initiative, with a chunk for each piece, and start no run:",
        "",
        `         wsh effort create "<title>" --project "${input.project}" --chunk "<first piece>" --chunk "<second piece>" --json`,
        "",
        "     Note the initiative's oid it prints.",
        "   - **Unclear** is a report where what went wrong, or where, cannot be told from the text, the picture and the log. Do not guess: ask the person one question, in your reply, and end your turn on it. Leave that report as it is (`handling`, with you); the person answers in this chat and you finish it then.",
        "",
        `${many ? "3" : "2"}. Mark each report you finished, as soon as you finish it, with its outcome in one line:`,
        "",
        '       wsh bugreport done <id> --outcome "<what you did>" [--run <run id>] [--effort <initiative oid>]',
        "",
        `   Use \`--run\` when a run fixes it and \`--effort\` when an initiative holds it. Every id of the report${many ? "s" : ""}: ${ids.join(", ")}.`,
        `${many ? "4" : "3"}. Close with a short list: for each report, its id and what became of it (the run, the initiative, or the question you asked).`,
        "",
        "Reply in the language the reports are written in.",
    ].join("\n");
}
