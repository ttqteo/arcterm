// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    buildLaunchMeta,
    composeStartupCommand,
    deriveBranch,
    isRuntimeOffered,
    resumeArgsForAgy,
    resumeArgsForClaude,
    resumeArgsForOpencode,
    resumeArgsForPi,
    RUNTIME_FLAGS,
    runtimeLaunchLabel,
    runtimeCreatesAgentPanel,
    runtimeShowsTask,
    runtimeStartupCommand,
    runtimeSupportsWorktree,
    sessionIdFromTranscript,
    worktreeOutcome,
} from "./launch";

describe("runtime helpers", () => {
    it("derives the startup command", () => {
        expect(runtimeStartupCommand("claude")).toBe("claude");
        expect(runtimeStartupCommand("codex")).toBe("codex");
        expect(runtimeStartupCommand("opencode")).toBe("opencode");
        expect(runtimeStartupCommand("pi")).toBe("pi");
        expect(runtimeStartupCommand("agy")).toBe("agy");
        expect(runtimeStartupCommand("terminal")).toBe("");
    });
    it("catalogs pi with no launch flags", () => {
        expect(RUNTIME_FLAGS.pi).toEqual([]);
        expect(composeStartupCommand("pi", "pi", { auto: true })).toBe("pi");
    });
    it("catalogs agy's launch flags", () => {
        expect(RUNTIME_FLAGS.agy).toEqual([
            expect.objectContaining({ id: "skip-permissions", flag: "--dangerously-skip-permissions" }),
            expect.objectContaining({ id: "continue", flag: "--continue" }),
            expect.objectContaining({ id: "sandbox", flag: "--sandbox" }),
        ]);
        expect(composeStartupCommand("agy", "agy", { sandbox: true, continue: true })).toBe("agy --continue --sandbox");
    });
    it("catalogs opencode's boolean launch flags", () => {
        expect(RUNTIME_FLAGS.opencode.map((f) => f.flag)).toEqual(["--auto", "--pure", "-c"]);
        expect(composeStartupCommand("opencode", "opencode", { auto: true })).toBe("opencode --auto");
    });
    it("labels the launch button", () => {
        expect(runtimeLaunchLabel("claude")).toBe("Launch agent");
        expect(runtimeLaunchLabel("terminal")).toBe("Open terminal");
    });
    it("hides the task field for terminal", () => {
        expect(runtimeShowsTask("claude")).toBe(true);
        expect(runtimeShowsTask("terminal")).toBe(false);
    });
    it("creates pending agent panels for agent runtimes only", () => {
        expect(runtimeCreatesAgentPanel("claude")).toBe(true);
        expect(runtimeCreatesAgentPanel("codex")).toBe(true);
        expect(runtimeCreatesAgentPanel("terminal")).toBe(false);
    });
    it("supports worktrees for every runtime except terminal", () => {
        expect(runtimeSupportsWorktree("claude")).toBe(true);
        expect(runtimeSupportsWorktree("codex")).toBe(true);
        expect(runtimeSupportsWorktree("terminal")).toBe(false);
    });
});

describe("deriveBranch", () => {
    it("appends -agent when there is no collision", () => {
        expect(deriveBranch("main", [])).toBe("main-agent");
        expect(deriveBranch("main", ["main"])).toBe("main-agent");
    });
    it("bumps a numeric suffix on collision", () => {
        expect(deriveBranch("main", ["main", "main-agent"])).toBe("main-agent-2");
        expect(deriveBranch("main", ["main", "main-agent", "main-agent-2"])).toBe("main-agent-3");
    });
});

describe("worktreeOutcome", () => {
    it("prompts when the branch is empty", () => {
        expect(worktreeOutcome({ branch: "", currentBranch: "main", branchNames: ["main"] })).toBe(
            "Enter a branch name"
        );
    });
    it("derives a fresh branch off the current (checked-out) branch", () => {
        expect(worktreeOutcome({ branch: "main", currentBranch: "main", branchNames: ["main"] })).toBe(
            "Creates new branch main-agent off main"
        );
    });
    it("checks out an existing non-current branch", () => {
        expect(
            worktreeOutcome({ branch: "feat/x", currentBranch: "main", branchNames: ["main", "feat/x"] })
        ).toBe("Checks out existing branch feat/x in a worktree");
    });
    it("creates a new branch for an unknown name", () => {
        expect(worktreeOutcome({ branch: "feat/new", currentBranch: "main", branchNames: ["main"] })).toBe(
            "Creates new branch feat/new off current HEAD"
        );
    });
});

describe("composeStartupCommand", () => {
    it("returns the base untouched when no flags are enabled", () => {
        expect(composeStartupCommand("claude", "claude", {})).toBe("claude");
    });
    it("appends enabled flags in catalog order", () => {
        expect(composeStartupCommand("claude", "claude", { verbose: true, "skip-permissions": true })).toBe(
            "claude --dangerously-skip-permissions --verbose"
        );
    });
    it("maps a shared flag id to the runtime's own flag string", () => {
        expect(composeStartupCommand("codex", "codex", { "skip-permissions": true })).toBe(
            "codex --dangerously-bypass-approvals"
        );
    });
    it("does not duplicate a flag already typed into the base", () => {
        expect(composeStartupCommand("claude --verbose", "claude", { verbose: true })).toBe("claude --verbose");
    });
    it("ignores flags outside the runtime's catalog", () => {
        expect(composeStartupCommand("codex", "codex", { verbose: true })).toBe("codex");
    });
    it("terminal has no flags", () => {
        expect(RUNTIME_FLAGS.terminal).toEqual([]);
        expect(composeStartupCommand("", "terminal", { verbose: true })).toBe("");
    });
});

describe("buildLaunchMeta", () => {
    it("passes the task as a positional arg with cwd", () => {
        const m = buildLaunchMeta({ runtime: "claude", startupCommand: "claude", task: "fix the bug", cwd: "/code/x" });
        expect(m).toMatchObject({
            view: "term",
            controller: "cmd",
            cmd: "claude",
            "cmd:args": ["fix the bug"],
            "cmd:shell": false,
            "cmd:cwd": "/code/x",
        });
    });
    it("tokenizes a custom startup command with flags", () => {
        const m = buildLaunchMeta({ runtime: "claude", startupCommand: "claude --model opus", task: "go", cwd: "/x" });
        expect(m["cmd:args"]).toEqual(["--model", "opus", "go"]);
    });
    it("omits args when there is no task", () => {
        const m = buildLaunchMeta({ runtime: "claude", startupCommand: "claude", task: "  ", cwd: "/x" });
        expect(m["cmd:args"]).toEqual([]);
    });
    it("terminal is a shell block with no task", () => {
        const m = buildLaunchMeta({ runtime: "terminal", startupCommand: "", task: "", cwd: "/x" });
        expect(m).toEqual({ view: "term", controller: "shell", "cmd:cwd": "/x" });
    });
    it("passes the opencode task positionally with cwd", () => {
        const m = buildLaunchMeta({ runtime: "opencode", startupCommand: "opencode", task: "refactor auth", cwd: "/x" });
        expect(m).toMatchObject({ cmd: "opencode", "cmd:args": ["refactor auth"], "cmd:shell": false, "cmd:cwd": "/x" });
        expect(m["agent:baseargs"]).toEqual([]);
    });
    it("passes the agy task after -i as two args, a task with spaces and quotes staying one arg", () => {
        const task = `fix "the" bug  in it's file`;
        const m = buildLaunchMeta({ runtime: "agy", startupCommand: "agy --sandbox", task, cwd: "/x" });
        expect(m).toMatchObject({
            cmd: "agy",
            "cmd:args": ["--sandbox", "-i", task],
            "cmd:shell": false,
            "cmd:cwd": "/x",
        });
        expect(m["agent:baseargs"]).toEqual(["--sandbox"]);
    });
    it("omits -i when an agy launch has no task", () => {
        const m = buildLaunchMeta({ runtime: "agy", startupCommand: "agy", task: " ", cwd: "/x" });
        expect(m["cmd:args"]).toEqual([]);
    });
    it("keeps claude's task positional (only agy takes -i)", () => {
        const m = buildLaunchMeta({ runtime: "claude", startupCommand: "claude", task: "go", cwd: "/x" });
        expect(m["cmd:args"]).toEqual(["go"]);
    });
    it("passes the pi task positionally like claude/codex", () => {
        const m = buildLaunchMeta({ runtime: "pi", startupCommand: "pi", task: "audit auth", cwd: "C:\\repo" });
        expect(m).toMatchObject({ cmd: "pi", "cmd:args": ["audit auth"], "cmd:shell": false, "cmd:cwd": "C:\\repo" });
        expect(m["agent:baseargs"]).toEqual([]);
    });
    it("stores agent:baseargs (launch flags before the task) for resume-on-reopen", () => {
        const m = buildLaunchMeta({ runtime: "claude", startupCommand: "claude --model opus", task: "go", cwd: "/x" });
        expect(m["agent:baseargs"]).toEqual(["--model", "opus"]);
        expect(m["cmd:args"]).toEqual(["--model", "opus", "go"]);
    });
    it("stores empty agent:baseargs for a bare launch", () => {
        const m = buildLaunchMeta({ runtime: "claude", startupCommand: "claude", task: "go", cwd: "/x" });
        expect(m["agent:baseargs"]).toEqual([]);
    });
    it("passes startupArgs verbatim (pi session resume — a path, never re-tokenized)", () => {
        expect(
            buildLaunchMeta({
                runtime: "pi",
                startupCommand: "pi",
                startupArgs: ["--session", "C:\\Users\\Jane Doe\\.pi\\agent\\sessions\\s.jsonl"],
                task: "",
                cwd: "C:\\repo",
            })["cmd:args"]
        ).toEqual(["--session", "C:\\Users\\Jane Doe\\.pi\\agent\\sessions\\s.jsonl"]);
    });
    it("carries startupArgs through agent:baseargs so resume-on-reopen can recompose them", () => {
        const m = buildLaunchMeta({
            runtime: "pi",
            startupCommand: "pi",
            startupArgs: ["--session", "C:\\old\\s.jsonl", "--model", "x"],
            task: "",
            cwd: "C:\\repo",
        });
        expect(m["cmd:args"]).toEqual(["--session", "C:\\old\\s.jsonl", "--model", "x"]);
        expect(m["agent:baseargs"]).toEqual(["--session", "C:\\old\\s.jsonl", "--model", "x"]);
    });
    it("puts extraArgs after the task and keeps them out of agent:baseargs", () => {
        const meta = buildLaunchMeta({
            runtime: "codex",
            startupCommand: "codex --full-auto",
            task: "fix it",
            extraArgs: ["--image", "a.png"],
            cwd: "/p",
        });
        expect(meta["cmd:args"]).toEqual(["--full-auto", "fix it", "--image", "a.png"]);
        expect(meta["agent:baseargs"]).toEqual(["--full-auto"]);
    });
});

describe("sessionIdFromTranscript", () => {
    it("takes the .jsonl stem as the resume id (posix + windows paths)", () => {
        expect(sessionIdFromTranscript("/home/u/.claude/projects/x/abc-123.jsonl")).toBe("abc-123");
        expect(sessionIdFromTranscript("C:\\Users\\u\\.claude\\projects\\x\\def456.jsonl")).toBe("def456");
    });
    it("returns undefined for empty/absent input", () => {
        expect(sessionIdFromTranscript(undefined)).toBeUndefined();
        expect(sessionIdFromTranscript("")).toBeUndefined();
    });
});

describe("resumeArgsForClaude", () => {
    it("prepends --resume <id> and keeps launch flags", () => {
        expect(resumeArgsForClaude("s1", ["--dangerously-skip-permissions"])).toEqual([
            "--resume",
            "s1",
            "--dangerously-skip-permissions",
        ]);
    });
    it("preserves value-taking options (does not mistake the value for a prompt)", () => {
        expect(resumeArgsForClaude("s1", ["--model", "opus"])).toEqual(["--resume", "s1", "--model", "opus"]);
    });
    it("drops a prior --resume <id> so resuming twice never stacks", () => {
        expect(resumeArgsForClaude("s2", ["--resume", "s1", "--verbose"])).toEqual(["--resume", "s2", "--verbose"]);
    });
    it("drops --continue to avoid a conflicting double-resume", () => {
        expect(resumeArgsForClaude("s1", ["--continue"])).toEqual(["--resume", "s1"]);
    });
    it("handles empty base args", () => {
        expect(resumeArgsForClaude("s1", [])).toEqual(["--resume", "s1"]);
    });
});

describe("resumeArgsForOpencode", () => {
    it("prepends -s <id> and keeps launch flags", () => {
        expect(resumeArgsForOpencode("s1", ["--auto"])).toEqual(["-s", "s1", "--auto"]);
    });
    it("preserves value-taking options (does not mistake the value for a prompt)", () => {
        expect(resumeArgsForOpencode("s1", ["--model", "openai/gpt-5"])).toEqual(["-s", "s1", "--model", "openai/gpt-5"]);
    });
    it("drops a prior -s <id> so resuming twice never stacks", () => {
        expect(resumeArgsForOpencode("s2", ["-s", "s1", "--auto"])).toEqual(["-s", "s2", "--auto"]);
        expect(resumeArgsForOpencode("s2", ["--session", "s1"])).toEqual(["-s", "s2"]);
    });
    it("drops -c/--continue to avoid a conflicting double-resume", () => {
        expect(resumeArgsForOpencode("s1", ["-c"])).toEqual(["-s", "s1"]);
        expect(resumeArgsForOpencode("s1", ["--continue"])).toEqual(["-s", "s1"]);
    });
    it("handles empty base args", () => {
        expect(resumeArgsForOpencode("s1", [])).toEqual(["-s", "s1"]);
    });
});

describe("resumeArgsForPi", () => {
    it("prepends --session <full path> and keeps launch flags", () => {
        expect(resumeArgsForPi("C:\\new path\\s.jsonl", ["--model", "x"])).toEqual([
            "--session",
            "C:\\new path\\s.jsonl",
            "--model",
            "x",
        ]);
    });
    it("replaces a prior --session <path> with the new path (never stacks two resume directives)", () => {
        expect(resumeArgsForPi("C:\\new path\\s.jsonl", ["--session", "C:\\old path\\s.jsonl", "--model", "x"])).toEqual([
            "--session",
            "C:\\new path\\s.jsonl",
            "--model",
            "x",
        ]);
    });
    it("keeps the path with spaces as one argv element", () => {
        const args = resumeArgsForPi("C:\\Users\\Jane Doe\\.pi\\agent\\sessions\\s.jsonl");
        expect(args).toEqual(["--session", "C:\\Users\\Jane Doe\\.pi\\agent\\sessions\\s.jsonl"]);
        expect(args.filter((a) => a.includes(" "))).toHaveLength(1);
    });
});

describe("isRuntimeOffered", () => {
    const harnesses = [
        { runtime: "claude", installed: true },
        { runtime: "codex", installed: false },
    ];
    it("offers installed runtimes and hides uninstalled or unknown ones", () => {
        expect(isRuntimeOffered("claude", harnesses)).toBe(true);
        expect(isRuntimeOffered("codex", harnesses)).toBe(false);
        expect(isRuntimeOffered("pi", harnesses)).toBe(false);
    });
    it("always offers the terminal", () => {
        expect(isRuntimeOffered("terminal", harnesses)).toBe(true);
    });
    it("offers everything while the catalog is empty", () => {
        expect(isRuntimeOffered("codex", [])).toBe(true);
    });
});

describe("resumeArgsForAgy", () => {
    it("puts --conversation first and drops a prior --continue", () => {
        expect(resumeArgsForAgy("c1", ["--continue", "--dangerously-skip-permissions"])).toEqual([
            "--conversation",
            "c1",
            "--dangerously-skip-permissions",
        ]);
    });
    it("drops a prior --conversation <id> and -c so a repeated resume cannot stack directives", () => {
        expect(resumeArgsForAgy("c2", ["--conversation", "c1", "-c", "--sandbox"])).toEqual([
            "--conversation",
            "c2",
            "--sandbox",
        ]);
    });
    it("resumes a bare launch", () => {
        expect(resumeArgsForAgy("c1", [])).toEqual(["--conversation", "c1"]);
    });
});
