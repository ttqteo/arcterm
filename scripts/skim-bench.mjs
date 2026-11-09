// The skim TL;DR bench (docs/superpowers/specs/2026-11-09-skim-tldr-bench-design.md): how well the fold skim draws for
// a long reply keeps its point. Layer 1 (rules and must-keep) also runs in `npm test` (claude/skim-bench/bench.test.ts);
// this script runs it by hand, saves the baseline, runs the model layers, drafts history cases and serves the review page.
//
//   node scripts/skim-bench.mjs                    layer 1 per case, against the baseline
//   node scripts/skim-bench.mjs --baseline [--llm] save the baseline: each case's fold and score (and layers 2-3)
//   node scripts/skim-bench.mjs --llm [--only a,b] layers 2 and 3 through `claude -p`; writes claude/skim-bench/results/
//   node scripts/skim-bench.mjs --draft [--limit 40] [--scan 400] [--all-projects] [--dry]
//                                                  draft history cases from ~/.claude/projects into the drafts folder
//   node scripts/skim-bench.mjs --review [--port 5199]
//                                                  the review page: scrub and approve drafts, edit must-keep and
//                                                  questions, grade A (the baseline's fold) against B (the working tree's)
//
// History drafts live outside the repo, in ~/.arc/skim-bench/drafts (SKIM_BENCH_DRAFTS overrides it), so an unscrubbed
// reply can never be committed; approving one on the review page moves it into claude/skim-bench/cases.
// --jobs N runs N `claude -p` at once (default 4). A model call is cached by the hash of what it reads, in
// claude/skim-bench/cache (gitignored), so a rerun with unchanged folds costs no tokens.
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir, userInfo } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const benchDir = join(root, "claude", "skim-bench");
const casesDir = join(benchDir, "cases");
const baselinePath = join(benchDir, "baseline.json");
const resultsDir = join(benchDir, "results");
const cacheDir = join(benchDir, "cache");
const draftsDir = process.env.SKIM_BENCH_DRAFTS ?? join(homedir(), ".arc", "skim-bench", "drafts");

const ANSWER_MODEL = "haiku";
const GRADE_MODEL = "sonnet";
const DRAFT_MODEL = "sonnet";
// bumped when a prompt changes, so the cache does not serve answers to the old one
const PROMPT_VERSION = 1;

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name, fallback) => {
    const at = args.indexOf(`--${name}`);
    return at >= 0 && args[at + 1] !== undefined ? args[at + 1] : fallback;
};

// bench-core.ts and the fold it scores, bundled for node
async function loadBench() {
    const out = join(tmpdir(), `skim-bench-${process.pid}.mjs`);
    await build({
        entryPoints: [join(benchDir, "bench-core.ts")],
        bundle: true,
        platform: "node",
        format: "esm",
        outfile: out,
        logLevel: "error",
    });
    try {
        return await import(pathToFileURL(out).href);
    } finally {
        rmSync(out, { force: true });
    }
}

function readCases(dir) {
    if (!existsSync(dir)) {
        return {};
    }
    return Object.fromEntries(
        readdirSync(dir)
            .filter((name) => name.endsWith(".json"))
            .map((name) => [name.replace(/\.json$/, ""), readJson(join(dir, name))])
    );
}

function readJson(path) {
    try {
        return JSON.parse(readFileSync(path, "utf8"));
    } catch (err) {
        throw new Error(`${path}: ${err.message}`);
    }
}

function writeJson(path, value) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(value, null, 4)}\n`);
}

function readBaseline() {
    return existsSync(baselinePath) ? readJson(baselinePath) : null;
}

// the commit the fold is at, -dirty when skim-mod has uncommitted edits
function commit() {
    const git = (...a) => execFileSync("git", a, { cwd: root, encoding: "utf8" }).trim();
    const sha = git("rev-parse", "--short", "HEAD");
    return git("status", "--porcelain", "--", "claude/skim-mod") === "" ? sha : `${sha}-dirty`;
}

function today() {
    return new Date().toISOString().slice(0, 10);
}

// layer 1: each case's failures, the summary, and what fell below the baseline
function layer1() {
    const cases = readCases(casesDir);
    let isOk = true;
    for (const [id, c] of Object.entries(cases)) {
        const problems = bench.problems(c);
        if (problems.length > 0) {
            console.log(`${id}: cannot be scored: ${problems.join("; ")}`);
            isOk = false;
        }
    }
    const scored = bench.scoreAll(cases);
    for (const [id, { score }] of Object.entries(scored)) {
        const fails = bench.CRITERIA.filter((c) => !score.criteria[c]);
        console.log(`${fails.length === 0 ? "pass" : "FAIL"} ${id} ${bench.pct(score.ratio)}`);
        score.why.forEach((why) => console.log(`       ${why}`));
    }
    const scores = Object.fromEntries(Object.entries(scored).map(([id, { score }]) => [id, score]));
    console.log(`\n${bench.report(bench.summarize(Object.values(scores)))}`);
    const baseline = readBaseline();
    if (baseline === null) {
        console.log("  no baseline saved: node scripts/skim-bench.mjs --baseline");
        return isOk;
    }
    const regressions = bench.regressions(scores, baseline);
    console.log(`  baseline ${baseline.commit} (${baseline.saved})`);
    regressions.forEach((line) => console.log(`  below the baseline: ${line}`));
    return isOk && regressions.length === 0;
}

async function saveBaseline() {
    const cases = readCases(casesDir);
    const scored = bench.scoreAll(cases);
    const baseline = {
        commit: commit(),
        saved: today(),
        cases: Object.fromEntries(
            Object.entries(scored).map(([id, { shown, score }]) => [
                id,
                { fold: shown.text, criteria: score.criteria, ratio: score.ratio },
            ])
        ),
    };
    if (flag("llm")) {
        const run = await llmRun(cases);
        if (run.errors.length > 0) {
            throw new Error(`the baseline is not saved: ${run.errors.length} case(s) failed in the model layers`);
        }
        baseline.llm = Object.fromEntries(
            Object.entries(run.cases).map(([id, r]) => [id, { answered: r.answered, grades: gradeScores(r.grades) }])
        );
    }
    writeJson(baselinePath, baseline);
    const summary = bench.summarize(Object.values(scored).map(({ score }) => score));
    console.log(bench.report(summary));
    console.log(`saved the baseline at ${baseline.commit} for ${Object.keys(cases).length} cases`);
}

function gradeScores(grades) {
    return Object.fromEntries(Object.entries(grades).map(([c, g]) => [c, g.score]));
}

// ---- layers 2 and 3

const ANSWER_SYSTEM = "You answer questions about a text using only that text. You reply with JSON only.";
const GRADE_SYSTEM = "You grade summaries of long replies strictly and fairly. You reply with JSON only.";
const DRAFT_SYSTEM = "You write test data for a benchmark of reply summaries. You reply with JSON only.";

function answerPrompt(fold, questions) {
    return [
        "Here is a short summary of a longer reply. Answer each question using ONLY this summary.",
        'When the summary does not say, answer exactly "not in the summary".',
        "",
        "<summary>",
        fold,
        "</summary>",
        "",
        "Questions:",
        ...questions.map((q, i) => `${i + 1}. ${q.q}`),
        "",
        'Reply with JSON only, the answers in the questions\' order: {"answers": ["...", "..."]}',
    ].join("\n");
}

function gradePrompt(c, fold, answers) {
    return [
        "A long reply from a coding assistant was folded into a short summary, its TL;DR, which the person reads instead",
        "of the reply. Grade the summary against the reply.",
        "",
        "<reply>",
        c.reply,
        "</reply>",
        "",
        "<summary>",
        fold,
        "</summary>",
        "",
        "Score each criterion from 1 (fails badly) to 5 (fully met), each with a one-sentence reason:",
        "1. Every reason has content: each point the summary keeps says what it says, never only its bold label.",
        "2. Warnings and what waits on the person stay: warning sections, open problems, and anything the person must",
        "   do or decide reach the summary.",
        '3. A mark keeps its context: a sentence ending in ":" is followed by what it points at (the options, the',
        "   command); a heading shows only with content under it.",
        "4. Long enough to grasp the whole reply: every section of the reply has at least one line in the summary; a",
        '   section that is only a table or only code may be one stub line such as "(table · 12 rows)".',
        "",
        "Then judge each answer below, which a reader gave from the summary alone, against the expected answer: true",
        'when it states the same fact (wording may differ), false when it is wrong, missing or "not in the summary".',
        ...c.questions.map((q, i) => `${i + 1}. Q: ${q.q}\n   Expected: ${q.a}\n   Given: ${answers[i] ?? ""}`),
        "",
        "Reply with JSON only:",
        '{"criteria": {"1": {"score": 1, "reason": "..."}, "2": {...}, "3": {...}, "4": {...}}, "answers": [true, false]}',
    ].join("\n");
}

// `claude -p` with no tools, no MCP, no settings and a short system prompt: a model call, not an agent session. the
// mods this session loads are left out, so no hook or skill instruction reaches the answer
function claude(model, system, prompt) {
    const env = { ...process.env };
    delete env.CLAUDE_CODE_PLUGIN_DIRS;
    const argv = ["-p", "--model", model, "--system-prompt", system, "--tools", "", "--strict-mcp-config"];
    argv.push("--no-session-persistence", "--setting-sources", "", "--output-format", "json");
    return new Promise((done, fail) => {
        const child = spawn("claude", argv, { env, stdio: ["pipe", "pipe", "pipe"] });
        let out = "";
        let err = "";
        child.stdout.on("data", (d) => (out += d));
        child.stderr.on("data", (d) => (err += d));
        child.on("error", fail);
        child.on("close", (code) => {
            if (code !== 0) {
                fail(new Error(`claude -p exited ${code}: ${(err || out).slice(-400)}`));
                return;
            }
            try {
                const res = JSON.parse(out);
                if (res.is_error) {
                    throw new Error(String(res.result).slice(0, 400));
                }
                done(String(res.result));
            } catch (e) {
                fail(new Error(`claude -p gave no result: ${e.message}`));
            }
        });
        child.stdin.end(prompt);
    });
}

// the JSON object a model's reply holds, fences and stray marks around it ignored
function jsonOf(text) {
    const from = text.indexOf("{");
    const to = text.lastIndexOf("}");
    if (from < 0 || to < from) {
        throw new Error(`no JSON in the model's reply: ${text.slice(0, 200)}`);
    }
    return JSON.parse(text.slice(from, to + 1).replace(/==/g, ""));
}

// a model call cached by the hash of everything it reads
async function cached(kind, model, system, prompt, check) {
    const key = createHash("sha256").update(JSON.stringify([PROMPT_VERSION, kind, model, system, prompt])).digest("hex");
    const path = join(cacheDir, `${key.slice(0, 32)}.json`);
    if (existsSync(path)) {
        return readJson(path);
    }
    const value = jsonOf(await claude(model, system, prompt));
    check(value);
    writeJson(path, value);
    return value;
}

async function pool(items, jobs, work) {
    const queue = [...items];
    const runners = Array.from({ length: Math.min(jobs, queue.length) }, async () => {
        for (let item = queue.shift(); item !== undefined; item = queue.shift()) {
            await work(item);
        }
    });
    await Promise.all(runners);
}

// layers 2 and 3 on each case; a reply drawn in full scores full marks without a call, as layer 1 passes it
async function llmRun(cases) {
    const only = option("only", "")
        .split(",")
        .filter((id) => id !== "");
    const ids = Object.keys(cases).filter((id) => only.length === 0 || only.includes(id));
    const scored = bench.scoreAll(cases);
    const out = {};
    const errors = [];
    await pool(ids, Number(option("jobs", "4")), async (id) => {
        const c = cases[id];
        const shown = scored[id].shown;
        try {
            if (shown.isFull) {
                const full = { score: 5, reason: "the reply draws in full" };
                out[id] = { fold: shown.text, isFull: true, answered: 1, answers: [], grades: { 1: full, 2: full, 3: full, 4: full } };
                return;
            }
            const { answers } = await cached("answer", ANSWER_MODEL, ANSWER_SYSTEM, answerPrompt(shown.text, c.questions), (v) => {
                if (!Array.isArray(v.answers) || v.answers.length !== c.questions.length) {
                    throw new Error(`expected ${c.questions.length} answers, got ${JSON.stringify(v).slice(0, 200)}`);
                }
            });
            const graded = await cached("grade", GRADE_MODEL, GRADE_SYSTEM, gradePrompt(c, shown.text, answers), (v) => {
                const isScore = (g) => Number.isInteger(g?.score) && g.score >= 1 && g.score <= 5;
                if (!bench.CRITERIA.every((n) => isScore(v.criteria?.[n])) || !Array.isArray(v.answers)) {
                    throw new Error(`malformed grade: ${JSON.stringify(v).slice(0, 200)}`);
                }
            });
            const right = graded.answers.filter((a) => a === true).length;
            out[id] = {
                fold: shown.text,
                isFull: false,
                answered: c.questions.length === 0 ? 1 : right / c.questions.length,
                answers: answers.map((given, i) => ({ q: c.questions[i].q, given, isRight: graded.answers[i] === true })),
                grades: graded.criteria,
            };
            console.log(`${id}: answered ${bench.pct(out[id].answered)}, grades ${bench.CRITERIA.map((n) => graded.criteria[n].score).join(" ")}`);
        } catch (err) {
            errors.push(id);
            console.error(`${id}: ${err.message}`);
        }
    });
    return { cases: out, errors };
}

function llmSummary(cases) {
    const list = Object.values(cases);
    const mean = (values) => (values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length);
    return {
        cases: list.length,
        answered: mean(list.map((r) => r.answered)),
        // a run holds {score, reason} per criterion, the baseline the score alone
        grades: Object.fromEntries(
            bench.CRITERIA.map((n) => [n, mean(list.map(({ grades }) => (typeof grades[n] === "number" ? grades[n] : grades[n].score)))])
        ),
    };
}

async function runLlm() {
    const cases = readCases(casesDir);
    const run = await llmRun(cases);
    const at = new Date().toISOString();
    const result = {
        commit: commit(),
        at,
        models: { answer: ANSWER_MODEL, grade: GRADE_MODEL },
        summary: llmSummary(run.cases),
        errors: run.errors,
        cases: run.cases,
    };
    const name = `${at.slice(0, 16).replace(/[:T]/g, "-")}-${result.commit}.json`;
    writeJson(join(resultsDir, name), result);
    const s = result.summary;
    console.log(`\nskim bench, layers 2-3: ${s.cases} cases`);
    console.log(`  answered from the fold alone   ${bench.pct(s.answered)}`);
    bench.CRITERIA.forEach((n) => console.log(`  grade, criterion ${n}            ${s.grades[n].toFixed(2)}`));
    console.log(`  wrote claude/skim-bench/results/${name}`);
    const isOk = run.errors.length === 0;
    if (run.errors.length > 0) {
        console.log(`  ${run.errors.length} case(s) failed: ${run.errors.join(", ")}`);
    }
    const baseline = readBaseline();
    if (!baseline?.llm) {
        console.log("  no model-layer baseline: node scripts/skim-bench.mjs --baseline --llm");
        return isOk;
    }
    const both = Object.fromEntries(Object.entries(run.cases).filter(([id]) => baseline.llm[id] !== undefined));
    const now = llmSummary(both);
    const was = llmSummary(Object.fromEntries(Object.keys(both).map((id) => [id, baseline.llm[id]])));
    const below = [];
    if (now.answered < was.answered - 1e-9) {
        below.push(`answered ${bench.pct(now.answered)}, the baseline ${bench.pct(was.answered)}`);
    }
    for (const n of bench.CRITERIA) {
        if (now.grades[n] < was.grades[n] - 1e-9) {
            below.push(`criterion ${n} grade ${now.grades[n].toFixed(2)}, the baseline ${was.grades[n].toFixed(2)}`);
        }
    }
    console.log(`  baseline ${baseline.commit}, on the ${Object.keys(both).length} cases both hold`);
    below.forEach((line) => console.log(`  below the baseline: ${line}`));
    return isOk && below.length === 0;
}

// ---- drafting history cases

function draftPrompt(reply, marks) {
    return [
        "Below is a coding assistant's reply to a developer, and the sentences it highlighted as must-read, if any.",
        "",
        "Write two things for it:",
        "- mustKeep: the units any summary of this reply must keep. Include only (criterion 2) warnings, open problems,",
        "  risks, and anything waiting on the person (a decision, a command to run, something to check); and",
        '  (criterion 3) the options or items that a sentence ending in ":" points at. Each unit is ONE sentence copied',
        "  exactly, character for character, from the reply: the first sentence of that item or paragraph. Do not list",
        "  a highlighted sentence only because it is highlighted. An empty list is right when the reply has none.",
        "- questions: 2 to 4 short questions that a person who read only a good summary should be able to answer: the",
        "  reply's point, its key facts, what waits on them. Each with a short answer taken from the reply.",
        "",
        "<reply>",
        reply,
        "</reply>",
        "",
        "<highlighted>",
        ...marks,
        "</highlighted>",
        "",
        "Reply with JSON only:",
        '{"mustKeep": [{"text": "...", "criterion": 2}], "questions": [{"q": "...", "a": "..."}]}',
    ].join("\n");
}

// skim's marks by the hash of the stored reply
function skimMarks() {
    const store = join(homedir(), ".claude", "plugins", "store");
    const byHash = new Map();
    if (!existsSync(store)) {
        return byHash;
    }
    for (const name of readdirSync(store).filter((n) => n.startsWith("skim_inline") && n.endsWith(".json"))) {
        for (const [hash, marks] of readJson(join(store, name)).highlightMarks ?? []) {
            byHash.set(hash, marks);
        }
    }
    return byHash;
}

// the foldable prose replies of the newest transcripts, newest first, with the failure kinds today's fold shows
function candidates(scan, isAllProjects) {
    const projects = join(homedir(), ".claude", "projects");
    const files = readdirSync(projects)
        .filter((dir) => isAllProjects || /arcterm|arc-wt/i.test(dir))
        .flatMap((dir) =>
            readdirSync(join(projects, dir))
                .filter((name) => name.endsWith(".jsonl"))
                .map((name) => join(projects, dir, name))
        )
        .map((path) => ({ path, at: statSync(path).mtimeMs }))
        .sort((a, b) => b.at - a.at)
        .slice(0, scan);
    const byHash = skimMarks();
    const seen = new Set();
    const found = [];
    for (const { path } of files) {
        const replies = [];
        for (const line of readFileSync(path, "utf8").split("\n")) {
            if (!line.includes('"assistant"')) {
                continue;
            }
            let entry;
            try {
                entry = JSON.parse(line);
            } catch {
                continue; // a line cut by a crash mid-write
            }
            if (entry.type !== "assistant" || !Array.isArray(entry.message?.content)) {
                continue;
            }
            for (const block of entry.message.content) {
                if (block.type === "text" && typeof block.text === "string") {
                    replies.push(block.text);
                }
            }
        }
        for (const text of replies.reverse()) {
            const hash = bench.hashText(text);
            if (seen.has(hash) || isJson(text) || text.split("\n").length > 150) {
                continue;
            }
            seen.add(hash);
            const marks = bench.shownMarks(byHash.get(hash) ?? []);
            if (!bench.isFoldable(text, marks)) {
                continue;
            }
            const score = bench.score({ reply: text, marks, mustKeep: [] }, bench.drawn(text, marks));
            found.push({ hash, file: path, reply: text, marks, kinds: bench.failureKinds(score, marks.length > 0) });
        }
    }
    return found;
}

// a headless run's JSON reply, not prose
function isJson(text) {
    const t = text.trim();
    if (/^```json/.test(t)) {
        return true;
    }
    if (!/^[[{]/.test(t)) {
        return false;
    }
    try {
        JSON.parse(t);
        return true;
    } catch {
        return false;
    }
}

// ~limit cases covering the four failure kinds, marked and unmarked, a few today's fold passes, at most two a transcript
function pick(found, limit) {
    const picked = [];
    const perFile = new Map();
    const take = (c) => {
        if (picked.length >= limit || picked.includes(c) || (perFile.get(c.file) ?? 0) >= 2) {
            return false;
        }
        picked.push(c);
        perFile.set(c.file, (perFile.get(c.file) ?? 0) + 1);
        return true;
    };
    const quota = Math.floor(limit / 5);
    for (const kind of [1, 2, 3, 4]) {
        let n = picked.filter((c) => c.kinds.includes(kind)).length;
        for (const c of found) {
            if (n >= quota) {
                break;
            }
            if (c.kinds.includes(kind) && take(c)) {
                n++;
            }
        }
    }
    found.filter((c) => c.kinds.length === 0).slice(0, Math.floor(limit / 10)).forEach(take);
    found.filter((c) => c.marks.length > 0).forEach(take);
    found.forEach(take);
    return picked;
}

async function draft() {
    const limit = Number(option("limit", "40"));
    const found = candidates(Number(option("scan", "400")), flag("all-projects"));
    const marked = found.filter((c) => c.marks.length > 0).length;
    console.log(`${found.length} foldable replies (${marked} marked)`);
    for (const kind of [1, 2, 3, 4]) {
        console.log(`  failure kind ${kind}: ${found.filter((c) => c.kinds.includes(kind)).length}`);
    }
    const picked = pick(found, limit);
    const who = { home: homedir(), user: userInfo().username };
    const existing = new Set([...Object.keys(readCases(casesDir)), ...Object.keys(readCases(draftsDir))]);
    const todo = picked.filter((c) => !existing.has(`h-${c.hash}`));
    console.log(`picked ${picked.length}; ${picked.length - todo.length} already drafted or approved; drafting ${todo.length} into ${draftsDir}`);
    if (flag("dry")) {
        todo.forEach((c) => console.log(`  h-${c.hash}: kinds [${c.kinds.join(",")}], ${c.marks.length} marks, ${c.reply.split("\n").length} lines`));
        return;
    }
    let failed = 0;
    await pool(todo, Number(option("jobs", "4")), async (c) => {
        const id = `h-${c.hash}`;
        const reply = bench.scrub(c.reply, who);
        const marks = c.marks.map((m) => bench.scrub(m, who)).filter((m) => {
            const isIn = reply.includes(m);
            if (!isIn) console.log(`${id}: dropped a mark the scrub changed: "${m.slice(0, 60)}"`);
            return isIn;
        });
        try {
            const drafted = await cached("draft", DRAFT_MODEL, DRAFT_SYSTEM, draftPrompt(reply, marks), (v) => {
                if (!Array.isArray(v.mustKeep) || !Array.isArray(v.questions)) {
                    throw new Error(`malformed draft: ${JSON.stringify(v).slice(0, 200)}`);
                }
            });
            const mustKeep = drafted.mustKeep.filter((unit) => {
                const isOk = (unit.criterion === 2 || unit.criterion === 3) && bench.isKept(String(unit.text), reply);
                if (!isOk) console.log(`${id}: dropped a must-keep the reply does not hold: "${String(unit.text).slice(0, 80)}"`);
                return isOk;
            });
            const questions = drafted.questions.filter((q) => typeof q.q === "string" && typeof q.a === "string");
            writeJson(join(draftsDir, `${id}.json`), { reply, marks, source: "history", mustKeep, questions, labels: {} });
            console.log(`${id}: kinds [${c.kinds.join(",")}], ${marks.length} marks, ${mustKeep.length} must-keep, ${questions.length} questions`);
        } catch (err) {
            failed++;
            console.error(`${id}: ${err.message}`);
        }
    });
    if (failed > 0) {
        process.exitCode = 1;
    }
}

// ---- the review page

const ID = /^[a-z0-9-]+$/;

function reviewItems() {
    const baseline = readBaseline();
    const items = [];
    for (const [where, dir] of [["draft", draftsDir], ["case", casesDir]]) {
        const cases = readCases(dir);
        for (const [id, c] of Object.entries(cases)) {
            items.push(reviewItem(id, where, c, baseline));
        }
    }
    return { baseline: baseline && { commit: baseline.commit, saved: baseline.saved }, items };
}

function reviewItem(id, where, c, baseline) {
    const problems = bench.problems(c);
    const shown = problems.some((p) => p.startsWith("the reply does not fold")) ? null : bench.drawn(c.reply, c.marks);
    return {
        id,
        where,
        case: c,
        problems,
        a: baseline?.cases[id]?.fold ?? null,
        b: shown?.text ?? null,
        score: shown && bench.score(c, shown),
    };
}

function body(req) {
    return new Promise((done, fail) => {
        let text = "";
        req.on("data", (d) => (text += d));
        req.on("end", () => {
            try {
                done(JSON.parse(text));
            } catch (err) {
                fail(err);
            }
        });
        req.on("error", fail);
    });
}

async function review(port) {
    const page = readFileSync(join(root, "scripts", "skim-bench-review.html"), "utf8");
    const server = createServer(async (req, res) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        const id = url.searchParams.get("id") ?? "";
        const send = (status, value) => {
            res.writeHead(status, { "content-type": "application/json" });
            res.end(JSON.stringify(value));
        };
        try {
            if (req.method === "GET" && url.pathname === "/") {
                res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
                res.end(page);
                return;
            }
            if (req.method === "GET" && url.pathname === "/api/cases") {
                send(200, reviewItems());
                return;
            }
            if (!ID.test(id)) {
                send(400, { error: `bad case id ${id}` });
                return;
            }
            const draftPath = join(draftsDir, `${id}.json`);
            const casePath = join(casesDir, `${id}.json`);
            if (req.method === "PUT" && url.pathname === "/api/case") {
                const where = url.searchParams.get("where") === "draft" ? "draft" : "case";
                const path = where === "draft" ? draftPath : casePath;
                if (!existsSync(path)) {
                    send(404, { error: `no ${where} ${id}` });
                    return;
                }
                const c = await body(req);
                writeJson(path, c);
                send(200, reviewItem(id, where, c, readBaseline()));
                return;
            }
            if (req.method === "POST" && url.pathname === "/api/approve") {
                const c = readJson(draftPath);
                const problems = bench.problems(c);
                if (problems.length > 0) {
                    send(400, { error: problems.join("; ") });
                    return;
                }
                c.labels = { ...c.labels, reviewed: today() };
                writeJson(casePath, c);
                rmSync(draftPath);
                send(200, reviewItem(id, "case", c, readBaseline()));
                return;
            }
            if (req.method === "DELETE" && url.pathname === "/api/draft") {
                rmSync(draftPath);
                send(200, { id });
                return;
            }
            send(404, { error: "not found" });
        } catch (err) {
            console.error(`${req.method} ${req.url}: ${err.message}`);
            send(500, { error: err.message });
        }
    });
    server.listen(port, "127.0.0.1", () => {
        console.log(`skim bench review page: http://localhost:${port}/`);
        console.log(`  cases ${casesDir}`);
        console.log(`  drafts ${draftsDir}`);
    });
}

// ---- run

// bench is read by the functions above, which run only from here on
const bench = await loadBench();

if (flag("review")) {
    await review(Number(option("port", "5199")));
} else if (flag("draft")) {
    await draft();
} else if (flag("baseline")) {
    await saveBaseline();
} else if (flag("llm")) {
    process.exitCode = (await runLlm()) ? 0 : 1;
} else {
    process.exitCode = layer1() ? 0 : 1;
}
