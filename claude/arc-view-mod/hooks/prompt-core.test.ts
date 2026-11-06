import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { brainstormLine } from "../../../frontend/app/view/agents/brainstormmodel";
import type { Card } from "./prompt-core";
import {
    cardHeader,
    labelWidth,
    parseRunPrompt,
    parseStreamPrompt,
    planTaskTitle,
    pointerPath,
    rowSource,
} from "./prompt-core";
import { parseWake } from "./wake-core";

const TESTDATA = fileURLToPath(new URL("../testdata/", import.meta.url));

// the engine's own texts, written by pkg/orchestrate's TestViewModFixtures from the Go builders
function fixture(name: string): string {
    return readFileSync(`${TESTDATA}${name}.txt`, "utf8");
}

// a row's text as the engine hands it to the hook: a live session cut a 9,120-character prompt at 6,608 and
// marked the cut, so the tests read less than that
const ROW_TEXT_CHARS = 6000;
const CUT_MARK = "\n[truncated for display]";

function rowText(name: string): string {
    const text = fixture(name);
    return text.length <= ROW_TEXT_CHARS ? text : text.slice(0, ROW_TEXT_CHARS) + CUT_MARK;
}

function field(c: Card | null, label: string): string | undefined {
    return c?.fields.find((f) => f.label === label)?.value;
}

const SPEC = "C:/work/app/docs/superpowers/specs/2026-11-04-coach-design.md";
const PLAN = "C:/work/app/docs/superpowers/plans/2026-11-04-coach.md";
const GOAL = "Build Interview practice app. Make a new dir for this project";

// every fixture is read by exactly one of these: a launch prompt, a line the cockpit sends, or a wake
const RUN_FIXTURES = [
    "quick",
    "lead-goal",
    "lead-goal-autonomous",
    "plan-lead",
    "plan-lead-replacement",
    "worker",
    "worker-dag",
    "reviewer",
    "plan-reviewer",
    "plan-reviewer-second",
    "verifier",
    "builder-check",
    "judge",
];
const STREAM_FIXTURES = [
    "agent-message",
    "child-done",
    "child-cancelled",
    "builder-questions",
    "judged",
    "judge-failed",
    "for-later",
    "review-note",
];
const WAKE_FIXTURES = ["wake", "autonomous-on", "autonomous-off"];

describe("the fixtures", () => {
    it("are each read by one reader, and nothing in testdata is left unread", () => {
        const names = readdirSync(TESTDATA)
            .filter((f) => f.endsWith(".txt"))
            .map((f) => f.slice(0, -".txt".length));
        expect([...RUN_FIXTURES, ...STREAM_FIXTURES, ...WAKE_FIXTURES].sort()).toEqual(names.sort());
        for (const name of RUN_FIXTURES) {
            expect(parseRunPrompt(rowText(name)), name).not.toBeNull();
            expect(parseStreamPrompt(fixture(name)), name).toBeNull();
            expect(parseWake(fixture(name)), name).toBeNull();
        }
        for (const name of STREAM_FIXTURES) {
            expect(parseStreamPrompt(fixture(name)), name).not.toBeNull();
            expect(parseRunPrompt(fixture(name)), name).toBeNull();
            expect(parseWake(fixture(name)), name).toBeNull();
        }
        for (const name of WAKE_FIXTURES) {
            expect(parseWake(fixture(name)), name).not.toBeNull();
            expect(parseRunPrompt(fixture(name)), name).toBeNull();
            expect(parseStreamPrompt(fixture(name)), name).toBeNull();
        }
    });
});

describe("parseRunPrompt", () => {
    it("reads a quick run's goal and principles", () => {
        const c = parseRunPrompt(rowText("quick"));
        expect(cardHeader(c!)).toBe("quick run · 2 principles");
        expect(field(c, "goal")).toBe("fix the flaky parser test");
        expect(labelWidth(c!)).toBe("goal".length);
        expect(c?.isAbridged).toBe(true);
    });

    it("reads a lead working a goal, asking or autonomous", () => {
        const asking = parseRunPrompt(rowText("lead-goal"));
        expect(cardHeader(asking!)).toBe("run lead · from the goal · 2 principles");
        expect(field(asking, "goal")).toBe(GOAL);
        expect(field(asking, "next")).toBe("take a path: spike, bounded or architectural");
        expect(labelWidth(asking!)).toBe("goal".length);
        const auto = parseRunPrompt(rowText("lead-goal-autonomous"));
        expect(cardHeader(auto!)).toBe("run lead · from the goal · autonomous · 2 principles");
        expect(field(auto, "goal")).toBe(GOAL);
    });

    it("reads a lead started after its plan from the rules' opening", () => {
        const c = parseRunPrompt(rowText("plan-lead"));
        expect(cardHeader(c!)).toBe("run lead · plan submitted · 2 principles");
        expect(field(c, "run")).toBe("run-1234");
        expect(field(c, "spec")).toBe(SPEC);
        expect(field(c, "plan")).toBe(PLAN);
        expect(field(c, "effort")).toBe("effort:eff-9");
        expect(labelWidth(c!)).toBe("effort".length);
        expect(rowText("plan-lead")).toContain(CUT_MARK);
    });

    it("reads a replacement lead as any lead started after its plan, the part that says so being cut", () => {
        const c = parseRunPrompt(rowText("plan-lead-replacement"));
        expect(cardHeader(c!)).toBe("run lead · plan submitted");
        expect(field(c, "spec")).toBeUndefined();
        expect(field(c, "plan")).toBe(PLAN);
        // the autonomous rules stand past the cut, so only an uncut text tags them
        expect(cardHeader(parseRunPrompt(fixture("plan-lead-replacement"))!)).toBe(
            "run lead · plan submitted · autonomous"
        );
    });

    it("reads a task worker and names its plan task for the title", () => {
        const c = parseRunPrompt(rowText("worker"));
        expect(cardHeader(c!)).toBe("task 3 worker");
        expect(field(c, "plan")).toBe(PLAN);
        expect(field(c, "spec")).toBe(SPEC);
        expect(field(c, "check")).toBe("npm run lint");
        expect(labelWidth(c!)).toBe("check".length);
        expect(c?.planTask).toEqual({ path: PLAN, n: "3" });
    });

    it("tags the notes the lead added after earlier tasks landed", () => {
        const text =
            fixture("worker") + "\n\nThe lead added after earlier tasks landed:\n- keep the empty-bank message";
        expect(cardHeader(parseRunPrompt(text)!)).toBe("task 3 worker · lead notes");
    });

    it("leaves a plan-less worker's title out when the plan header stands before it", () => {
        const c = parseRunPrompt(rowText("worker-dag"));
        expect(cardHeader(c!)).toBe("task t-2 worker");
        expect(field(c, "task")).toBeUndefined();
        expect(c?.planTask).toBeUndefined();
    });

    it("takes a plan-less worker's title from its text when nothing stands before it", () => {
        const header = "The plan's header applies to every task:\nNever edit docs/.\n\nKeep the store in one file.\n\n";
        const text = fixture("worker-dag").replace(header, "");
        expect(text).not.toBe(fixture("worker-dag"));
        const c = parseRunPrompt(text);
        expect(field(c, "task")).toBe("add fmtDate");
        expect(labelWidth(c!)).toBe("task".length);
    });

    it("steps over the note on dirs with no node_modules to reach a plan-less worker's title", () => {
        const header = "The plan's header applies to every task:\nNever edit docs/.\n\nKeep the store in one file.\n\n";
        const note =
            "These dirs of your tree have no `node_modules`, because what they ask for differs from what the main checkout installed; before running a tool in one, install there:\n- web\n\n";
        const text = fixture("worker-dag").replace(header, note);
        expect(field(parseRunPrompt(text), "task")).toBe("add fmtDate");
    });

    it("reads a task reviewer", () => {
        const c = parseRunPrompt(rowText("reviewer"));
        expect(cardHeader(c!)).toBe("task t-3 reviewer");
        expect(field(c, "task")).toBe("Question bank store");
        expect(field(c, "change")).toBe("git diff abc1234..def5678");
        expect(field(c, "plan")).toBe(PLAN);
        expect(field(c, "spec")).toBe(SPEC);
        expect(labelWidth(c!)).toBe("change".length);
    });

    it("tags what a reviewer's worker was told after the plan was written", () => {
        const text =
            fixture("reviewer") +
            "\n\nThe worker was also told these after the plan was written; judge the change against them too:\n- typed to the worker: use a map";
        expect(cardHeader(parseRunPrompt(text)!)).toBe("task t-3 reviewer · worker was told more");
    });

    it("reads both plan reviewers", () => {
        const full = parseRunPrompt(rowText("plan-reviewer"));
        expect(cardHeader(full!)).toBe("plan reviewer");
        expect(field(full, "run")).toBe("run-1234");
        expect(field(full, "spec")).toBe(SPEC);
        expect(field(full, "plan")).toBe(PLAN);
        expect(labelWidth(full!)).toBe("spec".length);
        expect(cardHeader(parseRunPrompt(rowText("plan-reviewer-second"))!)).toBe("plan reviewer · second of two");
    });

    it("tags a follow-up plan reviewer's round and one that picks models", () => {
        const text = fixture("plan-reviewer").replace(
            "\nRead the spec at",
            "\nThis is round 2. Round 1 failed.\nWhatever your verdict, also pick the model for each task the plan gives no Model line:\nRead the spec at"
        );
        expect(text).not.toBe(fixture("plan-reviewer"));
        expect(cardHeader(parseRunPrompt(text)!)).toBe("plan reviewer · round 2 · picks models");
    });

    it("reads a plan reviewer's prototype when the run has no spec", () => {
        const text = fixture("plan-reviewer").replace(
            `Read the spec at ${SPEC}, the plan at ${PLAN}, and the files they name.`,
            `There is no spec file: the design canvas at C:/work/app/.superpowers/design/coach/coach.dc.html is the spec. Read it, the plan at ${PLAN}, and the files they name.`
        );
        const c = parseRunPrompt(text);
        expect(field(c, "prototype")).toBe("C:/work/app/.superpowers/design/coach/coach.dc.html");
        expect(field(c, "spec")).toBeUndefined();
        expect(field(c, "plan")).toBe(PLAN);
    });

    it("reads the final verifier", () => {
        const c = parseRunPrompt(rowText("verifier"));
        expect(cardHeader(c!)).toBe("final verifier");
        expect(field(c, "run")).toBe("run-1234");
        expect(field(c, "tree")).toBe("C:/work/app-final");
        expect(field(c, "change")).toBe("git diff abc1234..0123456789abcdef");
        expect(field(c, "spec")).toBe(SPEC);
        expect(field(c, "plan")).toBe(PLAN);
        expect(labelWidth(c!)).toBe("change".length);
    });

    it("tags a verifier's fix round", () => {
        const text = fixture("verifier").replace(
            "\nThe spec is at",
            "\nThis is fix round 2: the last round failed.\nThe spec is at"
        );
        expect(text).not.toBe(fixture("verifier"));
        expect(cardHeader(parseRunPrompt(text)!)).toBe("final verifier · fix round 2");
    });

    it("reads the brainstorm's builder check and judge", () => {
        const check = parseRunPrompt(rowText("builder-check"));
        expect(cardHeader(check!)).toBe("builder check");
        expect(field(check, "design")).toBe(SPEC);
        const judge = parseRunPrompt(rowText("judge"));
        expect(cardHeader(judge!)).toBe("brainstorm judge · 2 approaches");
        expect(field(judge, "decision")).toBe("Where do the questions come from?");
        expect(labelWidth(judge!)).toBe("decision".length);
    });

    it("leaves text that is no run prompt alone", () => {
        expect(parseRunPrompt("Goal: ship it")).toBeNull();
        expect(parseRunPrompt("fix the parser")).toBeNull();
        expect(parseRunPrompt("Work by these principles:\n- be brief\n\nthen do whatever")).toBeNull();
        expect(parseRunPrompt("You are the worker for the day shift.")).toBeNull();
    });
});

describe("rowSource", () => {
    const arc = { kind: "plugin", name: "arc" };
    const person = { kind: "user" };

    it("reads nothing outside an Arc block, so a person's text that opens like Arc's stays as typed", () => {
        for (const origin of [arc, person, undefined]) {
            expect(rowSource(false, false, origin)).toBeNull();
        }
        // what a person could paste: a launch prompt's opening, and a wake
        expect(parseRunPrompt(rowText("quick"))).not.toBeNull();
        expect(rowSource(false, false, person)).toBeNull();
    });

    it("leaves an expanded row as the model reads it", () => {
        expect(rowSource(true, true, arc)).toBeNull();
        expect(rowSource(true, true, person)).toBeNull();
    });

    it("takes the arc plugin's rows as what the cockpit sent, and any other row as a launch prompt", () => {
        expect(rowSource(true, false, arc)).toBe("sent");
        expect(rowSource(true, false, { kind: "plugin", name: "skim" })).toBe("launch");
        expect(rowSource(true, false, person)).toBe("launch");
        expect(rowSource(true, false, undefined)).toBe("launch");
    });
});

describe("pointerPath", () => {
    it("names the file a long prompt was put in", () => {
        // pkg/jarvis launchPrompt (runexec.go)
        const line =
            "Your instructions are in the file C:\\Users\\me\\AppData\\Local\\dev.arc.app\\data\\jarvis\\prompts\\s-1.md (too long for a command line). Read the whole file now and follow it exactly, as if it were this message.";
        expect(pointerPath(line)).toBe("C:\\Users\\me\\AppData\\Local\\dev.arc.app\\data\\jarvis\\prompts\\s-1.md");
        expect(pointerPath("Your instructions are in the file x.md")).toBeNull();
    });
});

describe("planTaskTitle", () => {
    it("finds the task's heading", () => {
        const plan =
            "# Coach\n\n### Task 2: Store\n\nbody\n\n### Task 3: Question bank store\n\n**Depends on:** none\n";
        expect(planTaskTitle(plan, "3")).toBe("Question bank store");
        expect(planTaskTitle(plan, "4")).toBeUndefined();
        expect(planTaskTitle("## Task 1: One\n", "1")).toBe("One");
    });

    it("takes the task number as text, not as a pattern", () => {
        expect(planTaskTitle("### Task 1: One\n", ".")).toBeUndefined();
    });
});

describe("parseStreamPrompt", () => {
    it("reads another agent's message", () => {
        const c = parseStreamPrompt(fixture("agent-message"));
        expect(cardHeader(c!)).toBe("message · from design lead");
        expect(field(c, "tab")).toBe("tab-1234");
        expect(labelWidth(c!)).toBe("tab".length);
        expect(c?.body).toEqual(["rename the helper", "and rerun the tests"]);
    });

    it("reads a child run's end", () => {
        const done = parseStreamPrompt(fixture("child-done"));
        expect(cardHeader(done!)).toBe("child run · done");
        expect(field(done, "run")).toBe("run-77");
        expect(field(done, "goal")).toBe("split the channel blob into per-run records");
        expect(field(done, "change")).toBe("3 files +40/-2");
        expect(labelWidth(done!)).toBe("change".length);
        const cancelled = parseStreamPrompt(fixture("child-cancelled"));
        expect(cardHeader(cancelled!)).toBe("child run · cancelled");
        expect(field(cancelled, "change")).toBeUndefined();
    });

    it("unescapes a child run's goal, which the engine quoted", () => {
        // pkg/jarvis ParentNotifyLine writes the goal with %q
        const c = parseStreamPrompt(
            '[jarvis] child run-7 "fix the \\"flaky\\" test in C:\\\\work\\nthen ship" -> done'
        );
        expect(field(c, "goal")).toBe('fix the "flaky" test in C:\\work then ship');
    });

    it("reads every brainstorm line the pane and the engine send", () => {
        for (const text of [
            fixture("builder-questions"),
            fixture("judged"),
            fixture("judge-failed"),
            brainstormLine({ kind: "confirm", part: "storage" })!,
        ]) {
            const c = parseStreamPrompt(text);
            expect(c?.role).toBe("brainstorm");
            expect(c?.body).toEqual([text.slice("brainstorm: ".length)]);
            expect(c?.fields).toEqual([]);
        }
    });

    it("reads the notes a passed task leaves for later tasks", () => {
        const later = parseStreamPrompt(fixture("for-later"));
        expect(cardHeader(later!)).toBe("note for your task · from t-3 · For later tasks");
        expect(later?.body).toEqual(["the bank's Load takes a context now"]);
        const note = parseStreamPrompt(fixture("review-note"));
        expect(cardHeader(note!)).toBe("note for your task · from t-3's reviewer");
        expect(note?.body).toEqual(["keep the empty-bank message"]);
    });

    it("leaves the human's own words alone", () => {
        expect(parseStreamPrompt(brainstormLine({ kind: "answer", text: "the second one" })!)).toBeNull();
        expect(parseStreamPrompt("rename the helper")).toBeNull();
    });
});

describe("the autonomous wakes", () => {
    it("read as notes, not alerts", () => {
        const on = parseWake(fixture("autonomous-on"));
        expect(on?.events[0].kind).toBe("note");
        expect(on?.events[0].headline).toBe("approvals for this run are now autonomous and the human is away");
        const off = parseWake(fixture("autonomous-off"));
        expect(off?.events[0].kind).toBe("note");
        expect(off?.events[0].headline).toBe("approvals for this run are back to Ask me");
    });

    it("are wakes only from their first line: a lead's prompt that ends on one is no wake", () => {
        expect(parseWake(fixture("wake"))).not.toBeNull();
        expect(parseWake(fixture("plan-lead"))).toBeNull();
        expect(parseWake("hello\nwake: task t-3 failed. wsh jarvis dag status")).toBeNull();
    });
});
