// the prompts arcterm puts into a session, read back into the card its transcript row draws: a run's launch prompt
// (any origin, since it goes in as claude's command-line argument) and what the cockpit sends over the arc mod's
// stream. the model still reads each text as sent; this only shapes the row. prompt-row.tsx does the drawing.
// each opening below is the engine's or the cockpit's own text, pinned by the fixtures in ../testdata, which
// pkg/orchestrate's TestViewModFixtures writes from the Go builders. the hook sees only a row's first ~6,600
// characters, so a card reads what a prompt says near its top; a tag drawn from further down is best effort.
// a kind of prompt this tree has no builder for (a design session, a design-approved lead, the workflow scan's picks,
// a council seat) has no parser here: add it with its fixture when its builder lands.

export type Field = { label: string; value: string; isPath?: boolean };

export type Card = {
    role: string;
    tags: string[];
    fields: Field[];
    // lines drawn as they are: a message's own text
    body: string[];
    // the plan task whose heading names the task; register.ts reads it from the plan file
    planTask?: { path: string; n: string };
    // whether the row leaves out text a person may want, so it points at ctrl+o
    isAbridged: boolean;
};

function card(role: string, parts: Partial<Card> = {}): Card {
    return { role, tags: [], fields: [], body: [], isAbridged: false, ...parts };
}

// a field for each value present, in order
function fields(...pairs: [string, string | undefined, boolean?][]): Field[] {
    return pairs
        .filter(([, v]) => v != null && v !== "")
        .map(([label, value, isPath]) => ({ label, value: value!, isPath }));
}

const path = (label: string, value: string | undefined): [string, string | undefined, boolean] => [label, value, true];

function match(text: string, re: RegExp): string | undefined {
    return re.exec(text)?.[1];
}

function count(n: number, noun: string, plural = noun + "s"): string {
    return `${n} ${n === 1 ? noun : plural}`;
}

// --- which rows may be read -------------------------------------------------------------------------------------

export type Origin = { kind?: string; name?: string } | null | undefined;

// how a transcript row may be read. outside an Arc block no row is: any session can be handed a prompt that opens like
// one of Arc's, and a person's own text must stay as typed. an expanded row shows the text the model reads. a row the
// arc plugin raised holds what the cockpit sent (a wake, a message, a line), or a run's launch prompt; any other
// row can only be a launch prompt, which is claude's command-line argument and has no plugin origin.
export function rowSource(inArc: boolean, isExpanded: boolean, origin: Origin): "sent" | "launch" | null {
    if (!inArc || isExpanded) {
        return null;
    }
    return origin?.kind === "plugin" && origin.name === "arc" ? "sent" : "launch";
}

// --- run prompts ---------------------------------------------------------------------------------------------

const PRINCIPLES = /^Work by these principles(?:, and propagate them into every subagent you dispatch)?:\n/;
const AUTONOMOUS_RULES = "Approvals for this run are autonomous: nobody is at the cockpit.";
const GOAL = /^Goal: (.*)$/m;
const POINTER =
    /^Your instructions are in the file (.+) \(too long for a command line\)\. Read the whole file now and follow it exactly, as if it were this message\.$/;

// the file a prompt too long for a command line was put in; null for any other text
export function pointerPath(text: string): string | null {
    return POINTER.exec(text.trim())?.[1] ?? null;
}

// the principles block a run prompt opens with, apart from the rest
function splitPrinciples(text: string): { principles: number; rest: string } {
    if (!PRINCIPLES.test(text)) {
        return { principles: 0, rest: text };
    }
    const end = text.indexOf("\n\n");
    const block = end < 0 ? text : text.slice(0, end);
    const items = block.split("\n").filter((l) => l.startsWith("- ")).length;
    // a legacy profile renders its principles as one text with no list
    return { principles: Math.max(items, 1), rest: end < 0 ? "" : text.slice(end + 2) };
}

function quickRun(rest: string): Card | null {
    if (!rest.startsWith("You are running headless with no human at your terminal.")) {
        return null;
    }
    return card("quick run", { fields: fields(["goal", match(rest, GOAL)]) });
}

// the lead of a goal run: it works the goal itself, asking the human or on its own
function goalLead(rest: string): Card | null {
    if (!rest.startsWith("Goal: ") || !rest.includes("\nWork this goal")) {
        return null;
    }
    return card("run lead", {
        tags: ["from the goal"],
        fields: fields(["goal", match(rest, GOAL)], ["next", "take a path: spike, bounded or architectural"]),
    });
}

const PLAN_LEAD = /^You are the lead for run (\S+)\. /;
const LEAD_SPEC = /^[^\n]*? Spec: (.+?)\. (?=Plan: |Effort: |The engine )/;
const LEAD_PLAN = /^[^\n]*? Plan: (.+?)\. (?=Effort: |The engine )/;
const LEAD_EFFORT = /^[^\n]*? Effort: (effort:\S+?)\. The engine /;

// ponytail: the wake this lead was started for, and whether it replaces a lead, come last, after the rules. the
// engine hands a row's hook only the text's first ~6,600 characters, and the rules alone run past that, so the card
// cannot show them; ctrl+o does
function planLead(rest: string): Card | null {
    const run = match(rest, PLAN_LEAD);
    if (run == null) {
        return null;
    }
    return card("run lead", {
        tags: ["plan submitted"],
        fields: fields(["run", run], path("spec", match(rest, LEAD_SPEC)), path("plan", match(rest, LEAD_PLAN)), [
            "effort",
            match(rest, LEAD_EFFORT),
        ]),
    });
}

const WORKER = /^You are the worker for task (\S+) of (?:the plan at (.+?)(?: \(spec: (.+)\))?|this run's dag)\.$/m;
const WORKER_CHECK = /Run the tests your task names, and `([^`]+)`,/;
// the contract's last words, the subagent cap, then the compaction line a plan worker's carries; a blank line follows
const CONTRACT_END =
    /rather than handing each step of it to a subagent\.\n(?:If your context was compacted, re-read your task from the plan\.\n)?\n/;
const NOT_LINKED = "These dirs of your tree have no `node_modules`";
const PLAN_HEADER = "The plan's header applies to every task:\n";

// the task's own text names it when nothing whose length is unknown stands between it and the contract
function taskTitleInPrompt(rest: string): string | undefined {
    const end = CONTRACT_END.exec(rest);
    if (end == null) {
        return undefined;
    }
    let after = rest.slice(end.index + end[0].length);
    if (after.startsWith(NOT_LINKED)) {
        const next = after.indexOf("\n\n");
        after = next < 0 ? "" : after.slice(next + 2);
    }
    return after.startsWith(PLAN_HEADER) ? undefined : after.split("\n")[0] || undefined;
}

function worker(rest: string): Card | null {
    const m = WORKER.exec(rest);
    if (m == null) {
        return null;
    }
    const [, task, plan, spec] = m;
    const tags = rest.includes("\n\nThe lead added after earlier tasks landed:") ? ["lead notes"] : [];
    return card(`task ${task} worker`, {
        tags,
        fields: fields(
            ["task", plan == null ? taskTitleInPrompt(rest) : undefined],
            path("plan", plan),
            path("spec", spec),
            ["check", match(rest, WORKER_CHECK)]
        ),
        planTask: plan == null || task == null ? undefined : { path: plan, n: task },
    });
}

const REVIEWER =
    /^You are the reviewer for task (\S+)(?: of the plan at (.+?))?(?: \(spec: (.+?)\))?\. A worker finished it;/;
const REVIEW_TASK = /\nThe task:\n(.+)/;
const REVIEW_CHANGE = /^The change: `(git diff [^`]+)`/m;

function reviewer(rest: string): Card | null {
    const m = REVIEWER.exec(rest);
    if (m == null) {
        return null;
    }
    const [, task, plan, spec] = m;
    return card(`task ${task} reviewer`, {
        tags: rest.includes("\nThe worker was also told these after the plan was written")
            ? ["worker was told more"]
            : [],
        fields: fields(
            ["task", match(rest, REVIEW_TASK)],
            ["change", match(rest, REVIEW_CHANGE)],
            path("plan", plan),
            path("spec", spec)
        ),
    });
}

const PLAN_REVIEWER = /^You are the plan reviewer for run (\S+)\./;

function planReviewer(rest: string): Card | null {
    const run = match(rest, PLAN_REVIEWER);
    if (run == null) {
        return null;
    }
    const round = match(rest, /^This is round (\d+)\./m);
    const tags = [
        rest.includes("You are one of two plan reviewers") ? "second of two" : "",
        round ? `round ${round}` : "",
        rest.includes("also pick the model for each task") ? "picks models" : "",
    ].filter(Boolean);
    return card("plan reviewer", {
        tags,
        fields: fields(
            ["run", run],
            path("spec", match(rest, /^Read the spec at (.+?), the plan at /m)),
            path("prototype", match(rest, /the design canvas at (.+?) is the spec\./)),
            path("plan", match(rest, /the plan at (.+?), and the files they name\./))
        ),
    });
}

const VERIFIER =
    /^You are the final verifier for run (\S+)\. Every task has landed; judge the combined result in this tree, (.+), before the run is done\.$/m;

function verifier(rest: string): Card | null {
    const m = VERIFIER.exec(rest);
    if (m == null) {
        return null;
    }
    const round = match(rest, /^This is fix round (\d+):/m);
    return card("final verifier", {
        tags: round ? [`fix round ${round}`] : [],
        fields: fields(
            ["run", m[1]],
            ["change", match(rest, /^The run's change is `(git diff [^`]+)`\.$/m)],
            path("tree", m[2]),
            path("spec", match(rest, /^The spec is at (.+)\.$/m)),
            path("plan", match(rest, /^The plan is at (.+)\.$/m))
        ),
    });
}

function builderCheck(rest: string): Card | null {
    if (!rest.startsWith("You are a talented software engineer. You've been handed a design document")) {
        return null;
    }
    return card("builder check", {
        fields: fields(path("design", match(rest, /^Read (.+?), and whatever it references/m))),
    });
}

function judge(rest: string): Card | null {
    if (!rest.startsWith("You are the independent judge of one decision in a design brainstorm.")) {
        return null;
    }
    const approaches = rest.split("\nThe approaches, in random order:\n")[1] ?? "";
    const n = approaches.split("\n").filter((l) => /^\d+\. /.test(l)).length;
    return card("brainstorm judge", {
        tags: n > 0 ? [count(n, "approach", "approaches")] : [],
        fields: fields(["decision", match(rest, /\nThe decision to put to the user:\n\n(.+)\n/)]),
    });
}

const RUN_PROMPTS = [quickRun, goalLead, planLead, worker, reviewer, planReviewer, verifier, builderCheck, judge];

// the card for a run's launch prompt; null for any other text
export function parseRunPrompt(text: string): Card | null {
    const { principles, rest } = splitPrinciples(text);
    for (const parse of RUN_PROMPTS) {
        const c = parse(rest);
        if (c != null) {
            if (rest.includes(AUTONOMOUS_RULES)) {
                c.tags.push("autonomous");
            }
            if (principles > 0) {
                c.tags.push(count(principles, "principle"));
            }
            c.isAbridged = true;
            return c;
        }
    }
    return null;
}

// --- what the cockpit sends over the stream --------------------------------------------------------------------

const MESSAGE = /^\[Message from agent "(.*)" \(tab (\S+)\), sent with wsh agents send\.[^\n]*\]\n([\s\S]*)$/;
const CHILD = /^\[jarvis\] child (\S+) "(.*)" -> (done|cancelled)(?: \((.+)\))?$/;
const BRAINSTORM = /^brainstorm: (.+)$/;
const FOR_LATER = /^(\S+) passed review; its worker's (.+?): ([\s\S]*)$/;
const REVIEW_NOTE = /^(\S+) passed review with a note for your task: ([\s\S]*)$/;

function lines(text: string): string[] {
    return text.split("\n").filter((l) => l.trim() !== "");
}

function message(text: string): Card | null {
    const m = MESSAGE.exec(text);
    return m && card("message", { tags: [`from ${m[1]}`], fields: fields(["tab", m[2]]), body: lines(m[3] ?? "") });
}

// the goal in a child line was written with Go's %q: a quote or backslash in it is escaped, a newline is \n
function unquote(goal: string | undefined): string | undefined {
    return goal?.replace(/\\([\\"nt])/g, (_, c: string) => (c === "n" || c === "t" ? " " : c));
}

function childRun(text: string): Card | null {
    const m = CHILD.exec(text);
    return (
        m &&
        card("child run", {
            tags: [m[3] ?? ""],
            fields: fields(["run", m[1]], ["goal", unquote(m[2])], ["change", m[4]]),
        })
    );
}

function brainstorm(text: string): Card | null {
    const m = BRAINSTORM.exec(text);
    return m && card("brainstorm", { body: [m[1] ?? ""] });
}

function laterNote(text: string): Card | null {
    const later = FOR_LATER.exec(text);
    if (later != null) {
        return card("note for your task", { tags: [`from ${later[1]}`, later[2] ?? ""], body: lines(later[3] ?? "") });
    }
    const note = REVIEW_NOTE.exec(text);
    return note && card("note for your task", { tags: [`from ${note[1]}'s reviewer`], body: lines(note[2] ?? "") });
}

const STREAM_PROMPTS = [message, childRun, brainstorm, laterNote];

// the card for a prompt the cockpit sent over the stream that is not a wake; null for any other text
export function parseStreamPrompt(text: string): Card | null {
    for (const parse of STREAM_PROMPTS) {
        const c = parse(text);
        if (c != null) {
            return c;
        }
    }
    return null;
}

// the task's name from its heading in the plan; undefined when the plan has no such task
export function planTaskTitle(plan: string, n: string): string | undefined {
    const heading = new RegExp(`^#{2,3} Task ${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\\s*(.*?)\\s*$`, "m");
    return match(plan, heading) || undefined;
}

// the row's header: the role and its tags
export function cardHeader(c: Card): string {
    return [c.role, ...c.tags].join(" · ");
}

// how wide the card's label column is: its longest label
export function labelWidth(c: Card): number {
    return Math.max(0, ...c.fields.map((f) => f.label.length));
}
