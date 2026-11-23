// arcterm's Claude Code mod. `wsh install-agent-hooks` writes it to ~/.arc/claude-mod with the wsh path
// substituted and lists that folder in CLAUDE_CODE_PLUGIN_DIRS, so every claude launch loads it.
// outside an arcterm block every hook passes straight through, but the memory lint.
import type { EngineInterface, Register, Timer } from "claude-code";
import { atom, read, update } from "claude-code";
import type { AskQuestion } from "./ask-core";
import { askPayload, cardAnswer, cardCanAsk, parseAskReply, settleAsk } from "./ask-core";
import { btwNotice, btwPrompt, forkFailure, type BtwReply } from "./btw-core";
import { drawCacheMiss } from "./cache-band";
import { cacheMissNotice, transcriptEntries } from "./cache-core";
import { MATH_SECTION, MATH_SECTION_ID, mathContext } from "./chatmath-core";
import { claudeConfigDir, memoryDir, transcriptFile } from "./claudepaths-core";
import { claudecmdsArgs, commandsPayload } from "./commands-core";
import type { Turn } from "./control-core";
import { controlMsg, deliver, endTurn, steerNotice, takeLines } from "./control-core";
import { absolutePath, editTarget, foreignReason, needsAsk, parentDirs, repoKey, repoRoot } from "./foreignrepo-core";
import { drawGoal } from "./goal-band";
import { goalState, type GoalEntry, type GoalState } from "./goal-core";
import type { GoalpostFinding } from "./goalpost-core";
import { ALL_CATEGORIES, applyEdit, goalpostNote, goalpostRole, inspectChange, inspectCommand } from "./goalpost-core";
import { denial, isEngineTree } from "./guard-core";
import { heavyArgs, heldInBackground, heldOriginal, jobslotArgs, jobslotLine } from "./jobslot-core";
import { liveFile, LiveGather, serialWriter } from "./live-core";
import { lintContext, lintMemory, parseMemory, referencedPaths, shouldReport, taskNames } from "./memlint-core";
import type { Ran } from "./mention-core";
import { leadingMention, mentionRefusal, sendArgs, sendOutcome } from "./mention-core";
import { refsContext } from "./refs-core";
import { idleArgs, TurnStatus } from "./status-core";
import {
    beginArgs,
    beginPayload,
    endArgs,
    parseBegin,
    recentPrompts,
    SUGGEST_EFFORT,
    SUGGEST_MAX_TOKENS,
    SUGGEST_MODEL,
    SUGGEST_TIMEOUT_MS,
    wantsSuggest,
} from "./suggest-core";
import type { Group, SpawnVerdict } from "./tokengate-core";
import { createSpawnGate, endsTurnSay, RUN_VERDICT, tokengateArgs, tokengateLine } from "./tokengate-core";
import { isCommit, isLiveCheck, uiCheckReminder, uiFiles } from "./uicheck-core";
import { usageArgs } from "./usage-core";
import { gateVerdict, mergeTarget, parseGate, verifyGateArgs } from "./verifygate-core";

const WSH = "__WSH_PATH__";

// set at session.start; a reload runs register and session.start again, so it never goes stale
let active = false;

// Chat's formulas (chatmath-core.ts): whether the system prompt holds the section, and whether a prompt carried it.
// prompt.submit runs before the first prompt is composed, so session.start composes one to learn it early
let isInteractive = true;
let isMathComposed = false;
let hasToldMath = false;

// the session's transcript, worked out at its latest prompt; a status report carries it so a cockpit that
// replays the report still follows the file. null after a reload until the next prompt
let transcriptPath: string | null = null;

// the directory the session started in, which names its project folder; set at session.start
let sessionCwd: string | null = null;

// the line under claude's dialog while the card asks beside it
const ALSO_ON_CARD = "Also answerable in arcterm's ask card";

// the calls the card races claude's dialog for. one predicate for both hooks below, so the settings
// hooks are skipped exactly where the mod has a card up
function racesCard(questions: readonly AskQuestion[]): boolean {
    return active && cardCanAsk(questions);
}

// the tool_use_ids of the calls the card is racing right now, so the PostToolUse hook below knows them
const racing = new Set<string>();

// set when a question goes up in claude's dialog this turn. a question dismissed there runs no PostToolUse and
// no Stop hook, so the turn's end reports idle, or the cockpit reads asking until the next prompt
let isAskInDialog = false;

// the mod's own idle and working reports, in order (status-core.ts TurnStatus)
const turnStatus = new TurnStatus();

// one `wsh agentstatus` report; a failure is logged and never holds the turn
async function reportStatus($: EngineInterface, args: string[]): Promise<void> {
    try {
        const ran = await $.process.run([WSH, ...args]);
        if (ran.exitCode !== 0) {
            $.ui.log(`arc: wsh ${args.slice(0, 3).join(" ")} exited ${ran.exitCode}: ${ran.stderr.trim()}`, {
                to: "debug",
            });
        }
    } catch (err) {
        // an idle missed here is still corrected by the idle notification, later
        $.ui.log(`arc: wsh ${args.slice(0, 3).join(" ")} failed: ${String(err)}`, { to: "debug" });
    }
}

// the last turn's cache miss, shown above the prompt until the next turn starts; null when none is
const cacheMiss = atom({ plugin: "arc", key: "cacheMiss" } as const, null);

// the session's /goal (goal-core.ts), read from its transcript; null when it has none
const goal = atom({ plugin: "arc", key: "goal" } as const, null);
// the band's clock: now, moved on each second while a goal is active, so its elapsed time runs
const goalNow = atom({ plugin: "arc", key: "goalNow" } as const, 0);
let goalTick: Timer | null = null;

// the session's transcript, its last 3 MiB, through wsh: the hook events that carry its path never reach this mod, and
// the mod's own file read rejects a file over 4 MiB. null when it cannot be read (a session can end a turn before its
// transcript is first written)
async function readTranscript($: EngineInterface): Promise<ReturnType<typeof transcriptEntries> | null> {
    const tail = await $.process.run([WSH, "transcript-tail", await $.session.id()]);
    if (tail.exitCode !== 0) {
        $.ui.log(`arc: wsh transcript-tail exited ${tail.exitCode}: ${tail.stderr.trim()}`, { to: "debug" });
        return null;
    }
    return transcriptEntries(tail.stdout);
}

// puts the goal the transcript holds in the band, and runs the band's clock while one is active
async function showGoal($: EngineInterface, entries: GoalEntry[]): Promise<void> {
    const next = goalState(entries);
    await update($, goal, () => next);
    await update($, goalNow, () => Date.now());
    const ticking = next?.phase === "active";
    if (ticking && goalTick == null) {
        goalTick = $.clock.every(1000, () => void update($, goalNow, () => Date.now()));
    } else if (!ticking && goalTick != null) {
        goalTick.cancel();
        goalTick = null;
    }
}

async function refreshGoal($: EngineInterface): Promise<void> {
    try {
        const entries = await readTranscript($);
        if (entries) {
            await showGoal($, entries as GoalEntry[]);
        }
    } catch (err) {
        $.ui.log(`arc: reading the goal failed: ${String(err)}`, { to: "debug" });
    }
}

// tells the person, and inside arcterm the cockpit, what the turn that just ended re-billed for a missed
// prompt cache; the same read puts the session's goal in the band
async function reportCacheMiss($: EngineInterface) {
    try {
        const entries = await readTranscript($);
        if (!entries) {
            return;
        }
        await showGoal($, entries as GoalEntry[]);
        const notice = cacheMissNotice(entries);
        if (!notice) {
            return;
        }
        await update($, cacheMiss, () => notice);
        if (!active) {
            return;
        }
        const ran = await $.process.run([WSH, "notify", notice, "--level", "warn", "--transient"]);
        if (ran.exitCode !== 0) {
            $.ui.log(`arc: wsh notify exited ${ran.exitCode}: ${ran.stderr.trim()}`, { to: "debug" });
        }
    } catch (err) {
        $.ui.log(`arc: reporting a cache miss failed: ${String(err)}`, { to: "debug" });
    }
}

// the JSON of the slash-command list wavesrv last took, "" before the first. Chat's `/` menu reads that list, so a
// publish sends only when the list differs from this
let lastCommands = "";

// the pending second publish after session.start, so a /clear (session.start again) does not stack timers
let commandsTimer: Timer | null = null;

// tells wavesrv the commands Claude Code's own typeahead shows now: the bundled skills, a mod's commands and MCP
// prompts, which `~/.claude` does not hold. only inside arcterm. a failed call is logged and not retried on its own:
// lastCommands stays as it was, so the next publish sends the list again
async function publishCommands($: EngineInterface): Promise<void> {
    if (!active) {
        return;
    }
    try {
        const payload = commandsPayload(await $.command.list());
        if (payload === lastCommands) {
            return;
        }
        const ran = await $.process.run([WSH, ...claudecmdsArgs()], { stdin: payload, timeoutMs: 10_000 });
        if (ran.exitCode === 0) {
            lastCommands = payload;
        } else {
            $.ui.log(`arc: wsh claudecmds set exited ${ran.exitCode}: ${ran.stderr.trim()}`, { to: "debug" });
        }
    } catch (err) {
        $.ui.log(`arc: publishing the slash commands failed: ${String(err)}`, { to: "debug" });
    }
}

// the publishes session.start owes: one now, and one once the MCP servers have connected (they do after the session
// starts). the second is a $.clock.after, not a detached sleep: a sleep's wait is the hook's own time and would bill
// to its budget. a /clear or a reload runs session.start again, so the list is sent again even when it is the same
function publishCommandsAtStart($: EngineInterface): void {
    lastCommands = "";
    void publishCommands($);
    try {
        commandsTimer?.cancel();
        commandsTimer = $.clock.after(10_000, () => void publishCommands($));
    } catch (err) {
        $.ui.log(`arc: scheduling the slash commands' second publish failed: ${String(err)}`, { to: "debug" });
    }
}

// ponytail: turn.start does not say whose turn it is, so a background subagent starting one while the
// session is idle reads as open, and a mid-turn text sent then waits for the next turn. track turn ids
// against turn.step's agentId if that ever loses a tell
const turn: Turn = { isOpen: false, unread: [] };

// true while the cockpit's prompt stream is held, so a second session.start (a /clear) opens no second one
let listening = false;

// holds `wsh agentctl` for the session's life and runs each prompt the cockpit sends, so the engine need
// not type into the terminal. when the stream ends the engine goes back to typing
async function listenToCockpit($: EngineInterface) {
    if (listening) {
        return;
    }
    listening = true;
    const session = {
        // asUser: the model reads the engine's or the person's words bare, not as a note from a plugin
        submit: (text: string) => $.prompt.submit({ text, asUser: true }),
        steer: (text: string) => steerTurn($, text),
        command: (name: string, args: string) => $.command.run({ command: name, args }),
        compact: (instructions: string) => $.session.compact({ instructions }),
        btw: (question: string) => answerBtw($, question),
    };
    let buffered = "";
    try {
        for await (const chunk of $.process.spawn({ argv: [WSH, "agentctl"] })) {
            if (chunk.stream !== "stdout") {
                continue;
            }
            const taken = takeLines(buffered + chunk.text);
            buffered = taken.rest;
            for (const line of taken.lines) {
                const msg = controlMsg(line);
                if (msg === null) {
                    continue;
                }
                // not awaited: a prompt resolves only when its turn starts, and the next line may be due first
                void deliver(session, msg, turn).catch((err) =>
                    $.ui.log(`arc: running the cockpit's prompt failed: ${String(err)}`, { to: "debug" })
                );
            }
        }
    } catch (err) {
        $.ui.log(`arc: wsh agentctl failed: ${String(err)}`, { to: "debug" });
    } finally {
        listening = false;
    }
}

// answers Chat's /btw as Claude Code's own /btw does: one tool-less fork of the session's own conversation, which reads
// it from the cache, and the main turn runs on unaware. the answer, or why there is none, is written as a notice the
// model never reads, which the TUI draws as a dim line and Chat as a card under your /btw (btw-core.ts)
async function answerBtw($: EngineInterface, question: string) {
    let reply: BtwReply;
    try {
        const r = await $.model.fork({ prompt: btwPrompt(question) });
        reply = r.isAnswered ? { answer: r.text } : { failure: forkFailure(r) };
    } catch (err) {
        reply = { failure: String(err) };
    }
    const kept = await $.session.append({
        message: { type: "system", content: [{ type: "text", text: btwNotice(question, reply) }] },
    });
    if (kept.deny !== undefined) {
        throw new Error(kept.deny);
    }
}

// works out Chat's suggested replies for the turn that ended on `answer` (suggest-core.ts): wavesrv hands back the
// completion, it runs here on haiku, and the answer goes back for Chat. never throws, and nothing waits on it: anything
// that goes wrong leaves wavesrv to run its own call
async function suggestReplies($: EngineInterface, answer: string) {
    try {
        const recent = recentPrompts(await $.session.messages());
        const begun = await $.process.run([WSH, ...beginArgs()], {
            stdin: beginPayload(answer, recent),
            timeoutMs: 25_000,
        });
        if (begun.exitCode !== 0) {
            $.ui.log(`arc: wsh chatsuggest begin exited ${begun.exitCode}: ${begun.stderr.trim()}`, { to: "debug" });
            return;
        }
        const call = parseBegin(begun.stdout);
        if (call == null) {
            return;
        }
        // a completion that throws still ends the turn, as failed, so Chat's ask runs its own call at once instead of
        // waiting out wavesrv's 10 s for an end that never comes
        let text: string | null = null;
        try {
            const r = await $.model.complete({
                model: SUGGEST_MODEL,
                system: call.system,
                prompt: call.prompt,
                effort: SUGGEST_EFFORT,
                maxTokens: SUGGEST_MAX_TOKENS,
                timeoutMs: SUGGEST_TIMEOUT_MS,
            });
            text = r.isAnswered ? r.text : null;
        } catch (err) {
            $.ui.log(`arc: the suggest completion failed: ${String(err)}`, { to: "debug" });
        }
        const ended = await $.process.run([WSH, ...endArgs(call.key, text == null)], {
            stdin: text ?? "",
            timeoutMs: 10_000,
        });
        if (ended.exitCode !== 0) {
            $.ui.log(`arc: wsh chatsuggest end exited ${ended.exitCode}: ${ended.stderr.trim()}`, { to: "debug" });
        }
    } catch (err) {
        $.ui.log(`arc: suggesting replies failed: ${String(err)}`, { to: "debug" });
    }
}

// appends text to the running turn as a row the model reads at its next request. that row draws nothing,
// so a log line the model never reads shows the person what arrived
async function steerTurn($: EngineInterface, text: string) {
    const kept = await $.session.append({ message: { type: "user", content: [{ type: "text", text }] } });
    if (kept.deny !== undefined) {
        throw new Error(kept.deny);
    }
    $.ui.log(steerNotice(text));
}

// why this session may not run the shell command; null when it may, and always outside arcterm
async function refusal($: EngineInterface, command: string, background?: boolean): Promise<string | null> {
    return active ? denial(command, await $.session.cwd(), background === true) : null;
}

// a gating hook that fails is skipped and the event goes on as if it were absent. that is what most of arc's hooks
// want: arcterm's own trouble (wsh gone, a slow read) must not hold the person's work. written out on each such hook
// so the choice is visible, and a gate added later shows in `claude plugin validate` until someone makes it
function passOn<E, R>(_$: EngineInterface, e: E, next: (e: E) => R): R {
    return next(e);
}

// the shell guard threw before the command went on, so nothing decided whether it may run
function guardFailed(message: string | undefined): string {
    const why = message ? ` (${message})` : "";
    return `Refused by arcterm: its command check failed${why}, so the command did not run. Run it again; if it fails again, tell the person.`;
}

// the shell hooks' .catch. a throw before the command went on means the guard never decided, so it does not run; a
// timeout is a long wait (the job queue) after the check, and a hook that had called next keeps the tool's result
function shellGuardFailed<E, R>(
    _$: EngineInterface,
    e: E,
    next: ((e: E) => R) & { called: boolean; error: { kind: string; message?: string } }
): R | { deny: string } {
    return next.called || next.error.kind === "timeout" ? next(e) : { deny: guardFailed(next.error.message) };
}

// the foreign-repo check failed, so whether the file sits in another repo is unknown: the person decides
const FOREIGN_CHECK_FAILED =
    "arcterm could not check whether this file is in another repo than the session's own, so it asks before the edit.";

// a repo as git names it: its key, and the folder the person knows it by
type Repo = { key: string; root: string };

// the repo each directory sits in, null outside one; asked of git once per directory
const repoOfDir = new Map<string, Repo | null>();

// the other repos the person said yes to editing this session. module state on purpose: a reload of the mod
// forgets them, and the next edit there asks again
const allowedRepos = new Set<string>();

async function repoOf($: EngineInterface, dir: string): Promise<Repo | null> {
    if (repoOfDir.has(dir)) {
        return repoOfDir.get(dir) ?? null;
    }
    const ran = await $.process.run(["git", "-C", dir, "rev-parse", "--path-format=absolute", "--git-common-dir"]);
    const key = ran.exitCode === 0 ? repoKey(ran.stdout) : null;
    const repo = key === null ? null : { key, root: repoRoot(ran.stdout) };
    repoOfDir.set(dir, repo);
    return repo;
}

// the file a file tool is about to write and the repos on either side, when that repo is another one the person
// has not allowed; null when the edit needs no yes
async function foreignEdit(
    $: EngineInterface,
    input: unknown
): Promise<{ file: string; target: Repo; own: Repo } | null> {
    const path = editTarget(input);
    const cwd = sessionCwd ?? (await $.session.cwd());
    if (path === null) {
        return null;
    }
    const own = await repoOf($, absolutePath(cwd, cwd));
    const file = absolutePath(path, cwd);
    for (const dir of parentDirs(file)) {
        if (await $.fs.exists(dir)) {
            const target = await repoOf($, dir);
            return own && target && needsAsk(own.key, target.key, allowedRepos) ? { file, target, own } : null;
        }
    }
    return null;
}

// runs a file tool; one that ran in another repo had the person's yes at tool.check, so that repo stays allowed
async function allowingRepo<R extends { deny?: string; isError?: true }>(
    $: EngineInterface,
    input: unknown,
    run: () => Promise<R>
): Promise<R> {
    const foreign = await foreignEdit($, input).catch(() => null);
    const ran = await run();
    if (foreign && ran.deny === undefined && !ran.isError) {
        allowedRepos.add(foreign.target.key);
    }
    return ran;
}

// set by a shell command that tried a UI change in the running app; a commit that changed UI clears it, so each
// UI commit needs a try of its own
let liveChecked = false;

// set once wsh answered `not a task worker`: the session's role does not change, so later findings skip the call
let isKnownNonWorker = false;

// what a change lowers the bar on; none outside Arc, and none when a detector throws, so the tool call goes on
async function goalposts($: EngineInterface, detect: () => GoalpostFinding[] | Promise<GoalpostFinding[]>) {
    if (!active) {
        return [];
    }
    try {
        return await detect();
    } catch (err) {
        $.ui.log(`arc: goalpost detection failed: ${String(err)}`, { to: "debug" });
        return [];
    }
}

// the file's text before the call; null when it is not there yet
async function currentText($: EngineInterface, path: string): Promise<string | null> {
    return (await $.fs.exists(path)) ? $.fs.read(path) : null;
}

// stores the findings on the task when this session is a run's task worker, and answers wsh's verdict;
// null when the report failed or was skipped
async function reportGoalposts($: EngineInterface, findings: GoalpostFinding[]): Promise<string | null> {
    if (isKnownNonWorker) {
        return null;
    }
    try {
        const wire = findings.map(({ rule, file, title, before, after }) => ({ rule, file, title, before, after }));
        const ran = await $.process.run([WSH, "jarvis", "dag", "goalpost", JSON.stringify(wire)]);
        if (ran.exitCode !== 0) {
            $.ui.log(`arc: wsh jarvis dag goalpost exited ${ran.exitCode}: ${ran.stderr.trim()}`, { to: "debug" });
            return null;
        }
        isKnownNonWorker = ran.stdout.trim() === "not a task worker";
        return ran.stdout;
    } catch (err) {
        $.ui.log(`arc: wsh jarvis dag goalpost failed: ${String(err)}`, { to: "debug" });
        return null;
    }
}

// runs the tool, then tells Claude what it lowered and whom to answer to. never denies and never asks:
// the task reviewer, the final report or the user judges it
async function withGoalposts<E, R extends { deny?: string; isError?: true; context?: readonly string[] }>(
    $: EngineInterface,
    findings: GoalpostFinding[],
    e: E,
    next: (e: E) => Promise<R>
): Promise<R> {
    const ran = await next(e);
    if (findings.length === 0 || ran.deny !== undefined || ran.isError) {
        return ran;
    }
    const isRunAgent = Boolean(await $.env.get("ARC_RUN_AGENT"));
    const answer = isRunAgent ? await reportGoalposts($, findings) : null;
    const note = goalpostNote(findings, goalpostRole(isRunAgent, answer));
    return { ...ran, context: [...(ran.context ?? []), note] };
}

// the HEAD a commit starts from, or null where the UI check does not apply: outside arcterm's repo, or in an
// engine tree, whose Final runs the plan's scenarios
async function uiCheckBase($: EngineInterface): Promise<string | null> {
    if (isEngineTree(await $.session.cwd()) || !(await $.fs.exists("scripts/cdp/scenarios.mjs"))) {
        return null;
    }
    const head = await $.process.run(["git", "rev-parse", "HEAD"]);
    return head.exitCode === 0 ? head.stdout.trim() : null;
}

// the reminder for what the session committed since base, or null when it needs none
async function uiCheckNote($: EngineInterface, base: string): Promise<string | null> {
    const head = await $.process.run(["git", "rev-parse", "HEAD"]);
    const tip = head.stdout.trim();
    if (head.exitCode !== 0 || tip === base) {
        return null;
    }
    const diff = await $.process.run(["git", "diff", "--name-only", base, tip]);
    if (diff.exitCode !== 0) {
        return null;
    }
    const paths = diff.stdout
        .split("\n")
        .map((p) => p.trim())
        .filter(Boolean);
    const note = uiCheckReminder(paths, liveChecked);
    if (uiFiles(paths).length > 0) {
        liveChecked = false;
    }
    return note;
}

// a shell command's result, with a reminder for the model after a commit that changed UI no one tried in the
// app. a rule in AGENTS.md alone did not hold: the 2026-10-14..16 insights report found UI fixes committed unseen
async function withUiCheck<R extends { deny?: string; isError?: true; context?: readonly string[] }>(
    $: EngineInterface,
    command: string,
    run: () => Promise<R>
): Promise<R> {
    if (isLiveCheck(command)) {
        const result = await run();
        liveChecked ||= result.deny === undefined;
        return result;
    }
    if (!isCommit(command)) {
        return run();
    }
    const base = await uiCheckBase($).catch(() => null);
    const result = await run();
    if (base === null || result.deny !== undefined || result.isError) {
        return result;
    }
    const note = await uiCheckNote($, base).catch((err) => {
        $.ui.log(`arc: the ui check failed: ${String(err)}`, { to: "debug" });
        return null;
    });
    return note === null ? result : { ...result, context: [...(result.context ?? []), note] };
}

// the ask a shell command earns from the agent's Verify tile: a `git merge` while a scenario's result is red or
// amber (verifygate-core.ts). wavesrv holds the results and decides, so `wsh verify gate` answers for the
// merge's directory and the command as written; null when the command merges nothing or the gate lets it go.
// only inside arcterm, where the block's runs are. canAsk is whether a person can be asked (`e.approver`).
// a gate that fails (wsh gone, wavesrv slow) says nothing against the merge: Verify is the person's signal, not a
// guard, so the merge goes on, and the debug log keeps the trouble
async function verifyGateAsk(
    $: EngineInterface,
    input: unknown,
    canAsk: boolean
): Promise<{ decision: "ask"; reason: string } | null> {
    const raw = (input as { command?: unknown } | null)?.command;
    if (!active || typeof raw !== "string") {
        return null;
    }
    // a background command heldInBackground wrapped is judged as the model wrote it, as the permission check does
    const command = heldOriginal(WSH, raw) ?? raw;
    // a command without the word merges nothing, and most shell commands have none: they read no directory
    if (!/\bmerge\b/.test(command)) {
        return null;
    }
    try {
        const target = mergeTarget(command, await $.session.cwd());
        if (target === null) {
            return null;
        }
        const ran = await $.process.run([WSH, ...verifyGateArgs(target, command)], { timeoutMs: 10_000 });
        if (ran.exitCode !== 0) {
            $.ui.log(`arc: wsh verify gate exited ${ran.exitCode}: ${ran.stderr.trim()}`, { to: "debug" });
            return null;
        }
        return gateVerdict(parseGate(ran.stdout), canAsk);
    } catch (err) {
        $.ui.log(`arc: the verify gate failed: ${String(err)}`, { to: "debug" });
        return null;
    }
}

// a heavy command (a build, the typecheck, a whole test suite) waits for its turn in arcterm's job queue, and
// holds the slot while it runs: `wsh jobslot` stays alive until this ends its stream, which kills it and
// frees the slot. the stream's loop is the child's life, so this holds the iterator open across run(). its
// queued lines show here meanwhile, and a refusal (the person skipped it on the card) denies the command.
// any failure of wsh's lets the command run. spawn, not run: run gives up after ten minutes, and a queue
// can wait longer. an interrupt (Esc) while it waits ends the wait and never runs the command: the engine kills wsh
// on signal's abort, which frees its place, but the stream ending would otherwise read as "run it"
async function withJobSlot<T>(
    $: EngineInterface,
    command: string,
    signal: AbortSignal | undefined,
    run: () => Promise<T>
): Promise<T | { deny: string }> {
    if (!active) {
        return run();
    }
    const stream = $.process.spawn({ argv: [WSH, ...jobslotArgs(command)] });
    const interrupted = new Promise<"interrupted">((resolve) => {
        if (signal?.aborted) {
            resolve("interrupted");
        }
        signal?.addEventListener("abort", () => resolve("interrupted"), { once: true });
    });
    let buffered = "";
    let denied: string | null = null;
    try {
        wait: for (;;) {
            const step = await Promise.race([stream.next(), interrupted]);
            if (step === "interrupted" || step.done) {
                break;
            }
            if (step.value.stream !== "stdout") {
                continue;
            }
            const taken = takeLines(buffered + step.value.text);
            buffered = taken.rest;
            for (const line of taken.lines) {
                const read = jobslotLine(line);
                if (read && "hold" in read) {
                    $.ui.log(`arc: ${read.hold}`);
                } else if (read) {
                    denied = read.refusal;
                    break wait;
                }
            }
        }
    } catch (err) {
        $.ui.log(`arc: wsh jobslot failed: ${String(err)}`, { to: "debug" });
    }
    try {
        if (signal?.aborted) {
            return { deny: "Interrupted while waiting in arcterm's job queue; not run." };
        }
        return denied !== null ? { deny: denied } : await run();
    } finally {
        // ending the stream kills wsh, and the server's waiter cancel frees the slot. a no-op once wsh has exited
        await stream.return(undefined as never).catch(() => undefined);
    }
}

// whether a command waits for a slot, by wsh's own table (`jobslot --heavy`, no connection). false where wsh
// cannot say, which leaves the call to withJobSlot
async function takesSlot($: EngineInterface, command: string): Promise<boolean> {
    if (!active) {
        return false;
    }
    try {
        return (await $.process.run([WSH, ...heavyArgs(command)])).exitCode === 0;
    } catch {
        return false;
    }
}

// the last context reading, for the Token burn card
let lastContext: { tokens: number; window: number } | null = null;

// gathers parallel spawns onto one card and keeps the person's say; session.start clears it. a mod has no setTimeout:
// the hook that opens a group gathers on its own $.clock.sleep, passed to each check
const spawnGate = createSpawnGate(null);

// `wsh tokengate` for one group. never rejects: a failure of wsh's lets the spawn run, so only a verdict line
// changes the default, not wsh's exit or an empty stdout
async function askTokengate(
    $: EngineInterface,
    group: Group,
    earlier: number,
    held: () => void
): Promise<SpawnVerdict> {
    let verdict = RUN_VERDICT;
    let buffered = "";
    try {
        for await (const chunk of $.process.spawn({
            argv: [WSH, ...tokengateArgs(group, lastContext, transcriptPath, earlier)],
        })) {
            if (chunk.stream !== "stdout") {
                continue;
            }
            const taken = takeLines(buffered + chunk.text);
            buffered = taken.rest;
            for (const line of taken.lines) {
                const read = tokengateLine(line);
                if (read && "hold" in read) {
                    held();
                    $.ui.log(`arc: ${read.hold}`);
                } else if (read) {
                    verdict = read.verdict;
                }
            }
        }
    } catch (err) {
        $.ui.log(`arc: wsh tokengate failed: ${String(err)}`, { to: "debug" });
        return RUN_VERDICT;
    }
    if (verdict.note) {
        $.ui.log(`arc: ${verdict.note}`);
    }
    return verdict;
}

// waits for until with a call of this hook's own in flight, `wsh tokengate hold`, ended once until settles: Claude Code
// bills a hook's own time to its 10 s budget and stops the clock only then, so a spawn that joined another's card and
// awaited it bare was skipped and ran ungated. a hold that ends first (an older wsh without it) leaves the bare wait
async function waitInFlight($: EngineInterface, until: Promise<unknown>): Promise<void> {
    const hold = $.process.spawn({ argv: [WSH, "tokengate", "hold"] });
    const held = (async () => {
        try {
            for await (const _ of hold) {
                // the hold prints nothing
            }
        } catch (err) {
            $.ui.log(`arc: wsh tokengate hold failed: ${String(err)}`, { to: "debug" });
        }
    })();
    try {
        await Promise.race([until, held]);
    } finally {
        // ending the stream kills wsh. a no-op once it has exited
        void hold.return(undefined as never).catch(() => undefined);
    }
    await until;
}

// the session's live reply file (live-core.ts), null when there is no home to put it under
async function liveFileOf($: EngineInterface): Promise<string | null> {
    try {
        const home = (await $.env.get("USERPROFILE")) || (await $.env.get("HOME"));
        return liveFile(home, await $.session.id());
    } catch (err) {
        $.ui.log(`arc: working out the live reply file failed: ${String(err)}`, { to: "debug" });
        return null;
    }
}

async function configDirOf($: EngineInterface): Promise<string | null> {
    return claudeConfigDir({
        configDir: await $.env.get("CLAUDE_CONFIG_DIR"),
        home: (await $.env.get("USERPROFILE")) || (await $.env.get("HOME")),
    });
}

// a prompt goes in: the spawn gate forgets a turn's say when the prompt is the person's (not a subagent's
// hand-back or a task's report), and the transcript path is worked out afresh (a /clear or a resume changes the
// session's id). claude's UserPromptSubmit hook carried the path, but an org that manages Claude Code (Team,
// Enterprise) passes classic hooks over for a plugin a person installs
async function promptStarted($: EngineInterface, originKind: string) {
    if (endsTurnSay(originKind)) {
        spawnGate.promptSubmitted();
    }
    try {
        const configDir = await configDirOf($);
        transcriptPath = configDir && sessionCwd ? transcriptFile(configDir, sessionCwd, await $.session.id()) : null;
    } catch (err) {
        $.ui.log(`arc: working out the transcript path failed: ${String(err)}`, { to: "debug" });
    }
}

// lints the project's Claude memory dir at session start, so a memory gone stale on any machine is named there;
// the person gets a toast, the model the list as a row it reads before the first prompt. silent when the dir
// is none or holds QUIET_MAX issues or fewer. claude's SessionStart additionalContext or a prompt.compose section would be the
// natural door, but a managed install's security plugin bypasses both for a user-tier plugin. a reload of the
// mod (session.start again) appends the row again
async function lintMemoryDir($: EngineInterface, cwd: string): Promise<void> {
    const configDir = await configDirOf($);
    if (!configDir) {
        return;
    }
    const dir = memoryDir(configDir, cwd);
    if (!(await $.fs.exists(`${dir}/MEMORY.md`))) {
        return;
    }
    const entries = await $.fs.list(dir);
    const files = entries.filter((f) => f.kind === "file" && f.name.endsWith(".md") && f.name !== "MEMORY.md");
    const memories = await Promise.all(
        files.map(async (f) =>
            parseMemory({ name: f.name, text: await $.fs.read(`${dir}/${f.name}`) })
        )
    );
    const missingPaths = new Set<string>();
    for (const p of new Set(memories.flatMap((m) => referencedPaths(m.body)))) {
        if (!(await $.fs.exists(p))) {
            missingPaths.add(p);
        }
    }
    const tasks = (await $.fs.exists("Taskfile.yml")) ? taskNames(await $.fs.read("Taskfile.yml")) : null;
    const index = await $.fs.read(`${dir}/MEMORY.md`);
    const problems = lintMemory({ index, memories, missingPaths, tasks });
    if (!shouldReport(problems)) {
        return;
    }
    const kept = await $.session.append({
        message: { type: "user", content: [{ type: "text", text: lintContext(dir, problems) }] },
    });
    if (kept.deny !== undefined) {
        throw new Error(kept.deny);
    }
    $.ui.toast(`arc: memory lint found ${problems.length} issue(s); Claude will list them`);
}

export const register: Register = (on) => {
    on("session.start", async ($, e, next) => {
        active = Boolean((await $.env.get("WAVETERM_BLOCKID")) && (await $.env.get("WAVETERM_JWT")));
        isInteractive = e.isInteractive;
        if (active && isInteractive) {
            try {
                const { sections } = await $.prompt.compose();
                isMathComposed ||= sections.some((section) => section.id === MATH_SECTION_ID);
            } catch {
                // left to the prompt.compose hook below
            }
        }
        spawnGate.sessionStarted();
        sessionCwd = e.cwd;
        isKnownNonWorker = false;
        const started = await next(e);
        // inside arcterm or not: a memory goes stale wherever claude runs
        await lintMemoryDir($, e.cwd).catch((err) =>
            $.ui.log(`arc: memory lint failed: ${String(err)}`, { to: "debug" })
        );
        // only the block's own session: a `claude -p` it runs inherits WAVETERM_BLOCKID, and its stream would
        // replace the session's, so a lead's tell went to the nested run (run 0ea46b22)
        if (active && isInteractive) {
            void listenToCockpit($);
        }
        publishCommandsAtStart($);
        // a resumed session's goal, in the band from the start (not awaited: reading a long transcript)
        void refreshGoal($);
        return started;
    });

    on("session.measure", async ($, e, next) => {
        // only the block's own session, as for listenToCockpit: a `claude -p` an agent runs from Bash inherits
        // WAVETERM_BLOCKID and ARC_CLAUDE_ACCOUNT but not the token (Claude Code keeps it from its children), so it
        // runs on /login and would file /login's windows under the agent's account, and its context over the agent's
        const args = active && isInteractive ? usageArgs(e) : null;
        if (args) {
            try {
                const ran = await $.process.run([WSH, ...args]);
                if (ran.exitCode !== 0) {
                    $.ui.log(`arc: wsh agentstatus --usage exited ${ran.exitCode}: ${ran.stderr.trim()}`, {
                        to: "debug",
                    });
                }
            } catch (err) {
                // a dropped measurement self-heals on the next one, as a dropped statusLine publish did
                $.ui.log(`arc: wsh agentstatus --usage failed: ${String(err)}`, { to: "debug" });
            }
        }
        if (e.context.percent != null) {
            lastContext = { tokens: (e.context.percent / 100) * e.context.window, window: e.context.window };
        }
        return next(e);
    });

    // inside arcterm, the section telling claude Chat draws LaTeX; a headless run draws nothing, so it is not told
    on("prompt.compose", async ($, e, next) => {
        const composed = await next(e);
        if (!active || e.traits.includes("print") || e.traits.includes("bare")) {
            return composed;
        }
        isMathComposed = true;
        return {
            sections: [...composed.sections, { id: MATH_SECTION_ID, text: MATH_SECTION, scope: "session" as const }],
        };
    });

    // "@<tab id> text" typed at this prompt goes to that agent's session and never reaches this one's model.
    // only the person's own Enter: the cockpit's prompts and a peer's arrive with another origin
    on("prompt.submit", async ($, e, next) => {
        const m = active && e.origin.kind === "composer" ? leadingMention(e.text) : null;
        if (m === null) {
            await promptStarted($, e.origin.kind);
            // a skill or an MCP server added since the last prompt shows on the next `/`; not awaited
            void publishCommands($);
            // where the system prompt never took Chat's math section, the first prompt carries it
            const math = mathContext({
                isActive: active,
                isInteractive,
                isCommand: !!e.command,
                isComposed: isMathComposed,
                hasTold: hasToldMath,
            });
            if (math !== null) {
                hasToldMath = true;
            }
            // an id the person names ("đọc agent 5065bd8c", council:<id>) is read with wsh read; not the ids in a
            // subagent's hand-back, a peer's message or a background task's report
            const refs = active && !e.command && endsTurnSay(e.origin.kind) ? refsContext(e.text) : null;
            const added = [math, refs].filter((c): c is string => c !== null);
            if (added.length > 0) {
                return next({ ...e, context: [...(e.context ?? []), ...added] });
            }
            return next(e);
        }
        const putBack = () =>
            void $.prompt
                .fill({ text: e.text })
                .catch((err) => $.ui.log(`arc: putting the @mention back failed: ${String(err)}`, { to: "debug" }));
        const refused = mentionRefusal(m, (e.attachments?.length ?? 0) > 0);
        if (refused !== null) {
            putBack();
            return { drop: refused };
        }
        let ran: Ran;
        try {
            ran = await $.process.run([WSH, ...sendArgs(m)]);
        } catch (err) {
            ran = { exitCode: -1, stdout: "", stderr: String(err) };
        }
        const out = sendOutcome(m.id, ran);
        if (out.refill) {
            putBack();
        }
        return { drop: out.notice };
    }).catch(($, e, next) => {
        // an @mention that failed on its way to the other agent must not reach this one's model instead
        const m = !next.called && active && e.origin.kind === "composer" ? leadingMention(e.text) : null;
        if (m === null) {
            return next(e);
        }
        void $.prompt.fill({ text: e.text }).catch(() => undefined);
        return { drop: `arc: not sent to @${m.id}: ${next.error.message ?? next.error.kind}` };
    });

    on("turn.start", async ($, e, next) => {
        turn.isOpen = true;
        await update($, cacheMiss, () => null);
        return next(e);
    });

    // the reply as it streams, for Chat (live-core.ts): every chunk passes on as it came, and the text is written beside
    // the session as it grows. the main loop only, and only inside arcterm; a failed write stops the writes, never the
    // stream
    on("turn.step", async function* ($, e, next) {
        if (active) {
            // a turn that started as the last one's idle went out reads working again (status-core.ts TurnStatus)
            void turnStatus.stepped(e.agentId, transcriptPath, (args) => reportStatus($, args));
        }
        const file = active && e.agentId === undefined ? await liveFileOf($) : null;
        if (file === null) {
            return yield* next(e);
        }
        const live = new LiveGather(e.turnId, e.index);
        const out = serialWriter(
            (text) => $.fs.write(file, text),
            (err) => $.ui.log(`arc: writing the live reply failed: ${String(err)}`, { to: "debug" })
        );
        // the trailing write of text that landed inside the write window (LiveGather.flushIn)
        let trailing: Timer | null = null;
        const flush = () => {
            trailing = null;
            if (live.flushIn(Date.now()) !== null) {
                out.write(live.payload(false, Date.now()));
            }
        };
        try {
            for await (const chunk of next(e)) {
                if (chunk.kind === "text" || chunk.kind === "thinking") {
                    live.add(chunk.kind, chunk.index, chunk.text);
                    const now = Date.now();
                    if (live.due(now)) {
                        out.write(live.payload(false, now));
                    } else if (trailing === null) {
                        const wait = live.flushIn(now);
                        if (wait !== null) {
                            trailing = $.clock.after(wait, flush);
                        }
                    }
                }
                yield chunk;
            }
        } finally {
            trailing?.cancel();
            if (live.hasText()) {
                out.write(live.payload(true, Date.now()));
            }
        }
    });

    // the goal's row, then a cache miss, in the one band; a met or stopped goal goes once you send a prompt after it
    on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
        const notice = await read($, cacheMiss);
        const g = await read($, goal);
        const shown = g != null && !g.settledBeforePrompt ? g : null;
        if (e.props.hasSurvey || (!notice && !shown)) {
            return next(e);
        }
        const els = $.ui.resolve(e);
        return shown
            ? drawGoal(els, shown, (await read($, goalNow)) || Date.now(), notice)
            : drawCacheMiss(els, notice!);
    });

    // an evaluator's verdict lands mid-turn (the goal not met yet sends Claude on): read the goal again then
    on("session.append", { door: "attachment" }, async ($, e, next) => {
        const kept = await next(e);
        if (!e.agentId && e.message.name === "goal_status") {
            void refreshGoal($);
        }
        return kept;
    }).catch(passOn);

    // a goal the model proposes shows while the person answers its dialog, and its answer is read back after. the band
    // is a nicety: a failed write of it never holds the call. ProposeGoal is in the typed tool list only when the claude
    // launch that wrote the types offered it, so the matcher is cast as Task's is and e read as a plain record
    on("tool.call", { tool: "ProposeGoal" as "Agent" }, async ($, e, next) => {
        const condition = (e as unknown as Record<string, unknown>).condition;
        if (!e.agentId && typeof condition === "string") {
            const proposed: GoalState = {
                phase: "proposed",
                condition,
                setAt: Date.now(),
                checks: [],
                settledBeforePrompt: false,
            };
            await update($, goal, (g) => (g?.phase === "active" ? g : proposed)).catch((err) =>
                $.ui.log(`arc: showing a proposed goal failed: ${String(err)}`, { to: "debug" })
            );
        }
        const result = await next(e);
        void refreshGoal($);
        return result;
    }).catch(passOn);

    // a tool's result means another request follows, and it carries every row joined so far.
    // ponytail: a text joined between the last result and a final answer's request is read and then
    // submitted again at the turn's end; twice beats never
    on("session.append", { door: "tool-result" }, ($, e, next) => {
        if (!e.agentId) {
            turn.unread = [];
        }
        return next(e);
    }).catch(passOn);

    on("turn.complete", async ($, e, next) => {
        const wasAskInDialog = isAskInDialog && !e.agentId;
        if (wasAskInDialog) {
            isAskInDialog = false;
        }
        // Chat's replies for this turn, worked out here. not awaited: the completion takes seconds and must not hold the
        // turn's end; its begin can reach wavesrv after Chat's ask, which waits a moment for it (pkg/chatsuggest Hooks)
        if (active && !e.agentId && wantsSuggest(e, active, isEngineTree(await $.session.cwd()))) {
            void suggestReplies($, e.answer);
        }
        for (const text of e.agentId ? [] : endTurn(turn)) {
            void $.prompt
                .submit({ text, asUser: true })
                .catch((err) =>
                    $.ui.log(`arc: submitting an unread mid-turn text failed: ${String(err)}`, { to: "debug" })
                );
        }
        await turnStatus.ended(active ? idleArgs(e, transcriptPath, wasAskInDialog) : null, (args) =>
            reportStatus($, args)
        );
        // in every session, Arc's or not: the band shows the person the miss either way
        if (!e.agentId) {
            // not awaited: reading a long transcript must not hold the turn's end
            void reportCacheMiss($);
        }
        return next(e);
    });

    // refused in code: a prompt's rule is one the model can talk itself out of
    on("tool.call", { tool: "Bash" }, async ($, e, next) => {
        // the wrapped form, copied back by the model: auto mode refuses a background call this hook wrapped and
        // prints the wrapped command, which the model then runs as its own. Its `wsh jobslot --hold-parent` already
        // holds the slot for the shell's life, so it is judged as the command inside, never queued a second time
        // (a foreground call held a slot around it and the wrapper then waited behind that slot, its own) nor
        // wrapped twice, and runs as written: an input changed here would draw auto mode's refusal again
        const original = heldOriginal(WSH, e.command);
        const command = original ?? e.command;
        const why = await refusal($, command, e.run_in_background);
        if (why !== null) {
            return { deny: why };
        }
        const findings = await goalposts($, () => inspectCommand(command, ALL_CATEGORIES));
        if (original !== null) {
            return withUiCheck($, command, () => withGoalposts($, findings, e, next));
        }
        if (e.run_in_background === true && (await takesSlot($, e.command))) {
            // the call returns once the command starts, so a slot held around it would free at once: the command
            // waits for its turn in its own shell, which keeps the slot until it exits
            const held = { ...e, command: heldInBackground(WSH, e.command) };
            return withUiCheck($, e.command, () => withGoalposts($, findings, held, next));
        }
        return withJobSlot($, e.command, next.signal, () =>
            withUiCheck($, e.command, () => withGoalposts($, findings, e, next))
        );
    }).catch(shellGuardFailed);

    // a background command heldInBackground wrapped is decided as the model wrote it: the rules and the mode judge
    // the command, not the wsh call in front of it
    // and a merge while the agent's Verify is red or amber goes to the person, whatever the mode: the rail's tile is
    // only a signal until a merge lands on it. where nobody can be asked the engine turns the ask into a deny, and
    // the reason tells the model to ask the person. one tool.check per tool, so the gate is part of this one
    on("tool.check", { tool: "Bash" }, async ($, e, next) => {
        const input = e.input as { command?: unknown } | null;
        const original = typeof input?.command === "string" ? heldOriginal(WSH, input.command) : null;
        const verdict = await (original === null ? next(e) : next({ ...e, input: { ...input, command: original } }));
        if (verdict.decision === "deny") {
            return verdict;
        }
        return (await verifyGateAsk($, e.input, e.approver !== undefined)) ?? verdict;
    }).catch(passOn);

    on("tool.check", { tool: "PowerShell" }, async ($, e, next) => {
        const verdict = await next(e);
        if (verdict.decision === "deny") {
            return verdict;
        }
        return (await verifyGateAsk($, e.input, e.approver !== undefined)) ?? verdict;
    }).catch(passOn);

    // Windows' Claude Code has a PowerShell tool whose input is a Bash's (command, run_in_background); the types
    // of other platforms do not name it, so it is typed as Bash here, which compiles against both
    const powerShell = "PowerShell" as string as "Bash";
    on("tool.call", { tool: powerShell }, async ($, e, next) => {
        const why = await refusal($, e.command, e.run_in_background);
        if (why !== null) {
            return { deny: why };
        }
        const findings = await goalposts($, () => inspectCommand(e.command, ALL_CATEGORIES));
        return withJobSlot($, e.command, next.signal, () =>
            withUiCheck($, e.command, () => withGoalposts($, findings, e, next))
        );
    }).catch(shellGuardFailed);

    on("tool.call", { tool: "Edit" }, async ($, e, next) => {
        const findings = await goalposts($, async () => {
            const before = await currentText($, e.file_path);
            const after = before === null ? null : applyEdit(before, e.old_string, e.new_string, e.replace_all);
            return after === null ? [] : inspectChange({ path: e.file_path, before, after }, ALL_CATEGORIES);
        });
        return allowingRepo($, e, () => withGoalposts($, findings, e, next));
    }).catch(passOn);

    on("tool.call", { tool: "Write" }, async ($, e, next) => {
        const findings = await goalposts($, async () =>
            inspectChange(
                { path: e.file_path, before: await currentText($, e.file_path), after: e.content },
                ALL_CATEGORIES
            )
        );
        return allowingRepo($, e, () => withGoalposts($, findings, e, next));
    }).catch(passOn);

    // the edit hooks above and this one only note a repo the person allowed and the goalposts: the asking is tool.check's
    on("tool.call", { tool: "NotebookEdit" }, ($, e, next) => allowingRepo($, e, () => next(e))).catch(passOn);

    // an edit in a repo other than the session's own goes to the person, whatever the mode: a session once
    // edited another project's checkout unasked. in every session, Arc's or not. where nobody can be asked the
    // engine turns the ask into a deny, and the reason tells the model to ask
    for (const tool of ["Edit", "Write", "NotebookEdit"] as const) {
        on("tool.check", { tool }, async ($, e, next) => {
            const verdict = await next(e);
            if (verdict.decision === "deny") {
                return verdict;
            }
            const foreign = await foreignEdit($, e.input);
            if (foreign === null) {
                return verdict;
            }
            const reason = foreignReason(foreign.file, foreign.target.root, foreign.own.root, e.approver !== undefined);
            return { decision: "ask", reason };
        }).catch(async ($, e, next) => {
            // nothing has run yet, so a failed check asks rather than let the edit through unseen
            const verdict = await next(e);
            return verdict.decision === "deny" ? verdict : { decision: "ask" as const, reason: FOREIGN_CHECK_FAILED };
        });
    }

    // a costly spawn waits on the person's card; refused in code, as the shell is. always runs outside arcterm
    // Task is the Agent tool's old name, gone from the typed tool list but still matched by an Agent call; the matcher
    // is typed per tool, so the cast names one, and the hook reads e as a plain record. a gate that fails lets the
    // spawn go: the card is the person's say over cost, not a safety guard
    for (const tool of ["Agent", "Task", "Workflow"] as const) {
        on("tool.call", { tool: tool as "Agent" }, async ($, e, next) => {
            const why = active
                ? await spawnGate.check(
                      tool,
                      e as unknown as Record<string, unknown>,
                      (g, earlier, held) => askTokengate($, g, earlier, held),
                      (until) => waitInFlight($, until),
                      (ms) => $.clock.sleep(ms)
                  )
                : null;
            return why === null ? next(e) : { deny: why };
        }).catch(passOn);
    }

    // claude's own dialog asks in the terminal while the cockpit card asks beside it, and the first answer
    // wins. a hook that settles before next(e) takes the dialog down (probed on 2.1.291), so the terminal
    // is always claude's current dialog, previews and all, and the mod draws no picker of its own. a failed race
    // leaves that dialog, which still asks
    on("tool.call", { tool: "AskUserQuestion" }, async ($, e, next) => {
        if (!racesCard(e.questions)) {
            return next(e);
        }
        if (e.tool_use_id) {
            $.ui.notice(e.tool_use_id, ALSO_ON_CARD);
            racing.add(e.tool_use_id);
            isAskInDialog = true;
        }
        // spawn, not run: run gives up after ten minutes, and a question can wait longer
        const wait = $.process.spawn({ argv: [WSH, "ask", "--wait"], input: askPayload(e.questions) });
        const fromCard = (async () => {
            let out = "";
            try {
                for await (const chunk of wait) {
                    if (chunk.stream === "stdout") {
                        out += chunk.text;
                    }
                }
            } catch (err) {
                $.ui.log(`arc: wsh ask --wait failed: ${String(err)}`, { to: "debug" });
            }
            return parseAskReply(out);
        })();
        const fromDialog = next(e);
        try {
            const settled = await settleAsk(
                fromDialog,
                fromCard.then((reply) => cardAnswer(e.questions, reply)),
                (answer) => "deny" in answer,
                (ms) => $.clock.sleep(ms)
            );
            if (settled && "dialog" in settled) {
                return settled.dialog;
            }
            if (settled) {
                return settled.card;
            }
        } finally {
            if (e.tool_use_id) {
                racing.delete(e.tool_use_id);
            }
            // answered or dismissed in the terminal: ending the stream kills wsh, and the server's waiter
            // cancel takes the card down. a no-op once wsh has exited
            void wait.return(undefined as never).catch(() => undefined);
        }
        // wsh failed or hit its 30-minute ceiling: take the card down, and the dialog still up answers alone
        try {
            await $.process.run([WSH, "ask", "--clear"]);
        } catch (err) {
            $.ui.log(`arc: wsh ask --clear failed: ${String(err)}`, { to: "debug" });
        }
        return fromDialog;
    }).catch(passOn);

    // the settings hooks arcterm installs for AskUserQuestion project a keystroke-answered card of their own
    // (`wsh ask`), which would stand over the one the call above is waiting on. answering here without
    // next(e) skips every settings PreToolUse hook beneath, so the call goes on to its dialog
    // an org that manages Claude Code (Team, Enterprise) passes this and the PostToolUse hook below over, so the
    // server keeps a waited ask when the settings hook projects the same questions, and settleAsk lets the
    // dialog's answer win over the cancel the settings hooks then send
    on("classic.PreToolUse", { tool: "AskUserQuestion" }, ($, e, next) =>
        racesCard(e.questions) ? {} : next(e)
    ).catch(passOn);

    // an answer in claude's dialog runs the PostToolUse hooks inside the tool.call's next(e), before it
    // resolves, and both settings hooks there cancel the card's waiter: `wsh ask --clear` directly, and
    // agent-hook's working report through the server's retire-on-resume. the card then won the race with a
    // cancel, and a pick in the terminal came back as "The user dismissed the question." skipping them for a
    // raced call leaves the dialog's answer to win; tool.call's own teardown takes the card down
    on("classic.PostToolUse", { tool_name: "AskUserQuestion" }, ($, e, next) =>
        racing.has(e.tool_use_id) ? {} : next(e)
    ).catch(passOn);
};
