import { describe, expect, it } from "vitest";
import { denial } from "./guard-core";

const CHECKOUT = "C:\\Users\\k\\proj";
const TASK_TREE = "C:\\Users\\k\\proj\\.waveterm\\worktrees\\b74faed0-t-1";
const POSIX_TASK_TREE = "/home/k/proj/.waveterm/worktrees/b74faed0-t-1/pkg";
const CACHE_TASK_TREE = "C:\\Users\\k\\AppData\\Local\\arc-wt\\b74faed0-t-1\\pkg";
const POSIX_CACHE_TASK_TREE = "/home/k/.cache/arc-wt/b74faed0-t-1";

describe("denial: stopping arcterm by image name", () => {
    it.each([
        "taskkill /F /IM wave-tauri.exe",
        "taskkill //IM wavesrv.x64.exe //F",
        "Stop-Process -Name wavesrv.x64 -Force",
        "Get-Process wave-tauri | Stop-Process",
        "kill -Name wave-tauri",
        "pkill -f wavesrv",
        "killall wavesrv.x64",
    ])("refuses %s", (command) => {
        expect(denial(command, CHECKOUT)).toMatch(/image name/);
    });

    it.each([
        "Get-Process wave-tauri,wavesrv.x64 | Select Id,Path",
        "Stop-Process -Id 4242",
        "Get-Process wavesrv.x64 | Select Id,Path; Stop-Process -Id 4242 -Force",
        "taskkill /PID 4242 /F",
        "taskkill /IM node.exe /F",
        "go build ./cmd/wavesrv",
    ])("lets %s through", (command) => {
        expect(denial(command, CHECKOUT)).toBeNull();
    });
});

describe("denial: a run's worktree", () => {
    it.each([
        ["git push", /pushed/],
        ["git -C . push origin HEAD", /pushed/],
        ["git add -A && git commit -m x && git push -u origin wave/x", /pushed/],
        ["git worktree remove ../b74faed0-t-2 --force", /worktrees/],
        ["git worktree prune", /worktrees/],
        ["git switch main", /stay on it/],
        ["git checkout -b scratch", /stay on it/],
    ])("refuses %s", (command, why) => {
        expect(denial(command, TASK_TREE)).toMatch(why);
        expect(denial(command, POSIX_TASK_TREE)).toMatch(why);
    });

    it.each([
        ["git push", /pushed/],
        ["git worktree add ../scratch", /worktrees/],
        ["git switch main", /stay on it/],
    ])("refuses %s under the user cache dir's arc-wt", (command, why) => {
        expect(denial(command, CACHE_TASK_TREE)).toMatch(why);
        expect(denial(command, POSIX_CACHE_TASK_TREE)).toMatch(why);
    });

    it("holds none of this against a directory that only contains arc-wt in its name", () => {
        const lookalike = "C:\\Users\\k\\my-arc-wtx\\repo";
        expect(denial("git push", lookalike)).toBeNull();
        expect(denial("git worktree add ../scratch", lookalike)).toBeNull();
        expect(denial("git switch main", lookalike)).toBeNull();
    });

    it.each([
        "git commit -m 'add done.txt'",
        "git checkout -- pkg/a.go",
        "git checkout HEAD~1 -- pkg/a.go",
        "git worktree list",
        "git log --oneline -5",
        "git rev-parse HEAD",
        "git stash push -m wip",
    ])("lets %s through", (command) => {
        expect(denial(command, TASK_TREE)).toBeNull();
    });

    it("holds none of this against a session in the project's own checkout", () => {
        expect(denial("git push", CHECKOUT)).toBeNull();
        expect(denial("git switch main", CHECKOUT)).toBeNull();
        expect(denial("git worktree remove x", CHECKOUT)).toBeNull();
    });
});
