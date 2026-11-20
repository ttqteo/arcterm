import { describe, expect, it } from "vitest";
import { gateVerdict, mergeTarget, parseGate, verifyGateArgs } from "./verifygate-core";

const WIN = "D:/work/proj";
const POSIX = "/home/k/proj";

describe("mergeTarget", () => {
    it("finds a plain merge, in the session's own directory", () => {
        expect(mergeTarget("git merge --no-ff feat/x", WIN)).toEqual({ cwd: WIN });
        expect(mergeTarget("git merge x", "C:\\Users\\k\\proj")).toEqual({ cwd: "C:\\Users\\k\\proj" });
    });

    it("follows a preceding cd, relative to the session's directory", () => {
        expect(mergeTarget("cd /d/repo && git merge x", WIN)).toEqual({ cwd: "D:/repo" });
        expect(mergeTarget("cd /d/repo && git merge x", POSIX)).toEqual({ cwd: "/d/repo" });
        expect(mergeTarget("cd sub && git merge x", WIN)).toEqual({ cwd: "D:/work/proj/sub" });
        expect(mergeTarget("cd ../main && git merge x", POSIX)).toEqual({ cwd: "/home/k/main" });
        expect(mergeTarget("cd D:\\other\\repo && git merge x", WIN)).toEqual({ cwd: "D:/other/repo" });
        expect(mergeTarget('cd "D:\\my repo" && git merge x', WIN)).toEqual({ cwd: "D:/my repo" });
    });

    it("keeps a cd's move across later cds and for a git -C after it", () => {
        expect(mergeTarget("cd a && cd b && git merge x", POSIX)).toEqual({ cwd: "/home/k/proj/a/b" });
        expect(mergeTarget("cd a && git -C ../c merge x", POSIX)).toEqual({ cwd: "/home/k/proj/c" });
    });

    it("follows git -C, which a later -C resolves against the earlier", () => {
        expect(mergeTarget("git -C ../main merge x", WIN)).toEqual({ cwd: "D:/work/main" });
        expect(mergeTarget("git -C /srv/repo merge x", POSIX)).toEqual({ cwd: "/srv/repo" });
        expect(mergeTarget("git -C a -C b merge x", POSIX)).toEqual({ cwd: "/home/k/proj/a/b" });
        expect(mergeTarget('git -C "D:/my repo" merge x', WIN)).toEqual({ cwd: "D:/my repo" });
    });

    it("skips git's other options before the subcommand", () => {
        expect(mergeTarget("git -c user.name=k merge x", WIN)).toEqual({ cwd: WIN });
        expect(mergeTarget("git --no-pager merge x", WIN)).toEqual({ cwd: WIN });
        expect(mergeTarget("git -c core.editor=true -C ../main --no-pager merge x", WIN)).toEqual({
            cwd: "D:/work/main",
        });
    });

    it("finds a merge anywhere in a joined command", () => {
        expect(mergeTarget("git fetch && git merge FETCH_HEAD", WIN)).toEqual({ cwd: WIN });
        expect(mergeTarget("git checkout main; git merge x", WIN)).toEqual({ cwd: WIN });
        expect(mergeTarget("git fetch || git merge x", WIN)).toEqual({ cwd: WIN });
        expect(mergeTarget("git merge x | tee out.txt", WIN)).toEqual({ cwd: WIN });
        expect(mergeTarget("git status\ngit merge x", WIN)).toEqual({ cwd: WIN });
        expect(mergeTarget("(cd sub && git merge x)", WIN)).toEqual({ cwd: "D:/work/proj/sub" });
    });

    it("reads PowerShell's ; and its location cmdlets", () => {
        expect(mergeTarget("Set-Location D:\\repo; git merge x", WIN)).toEqual({ cwd: "D:/repo" });
        expect(mergeTarget("Set-Location -Path 'D:\\my repo'; git merge x", WIN)).toEqual({ cwd: "D:/my repo" });
        expect(mergeTarget("cd ..\\main; git merge x", "D:\\work\\proj")).toEqual({ cwd: "D:/work/main" });
        expect(mergeTarget("cd /d D:\\repo && git merge x", WIN)).toEqual({ cwd: "D:/repo" });
    });

    it("sees a merge behind a variable assignment or sudo", () => {
        expect(mergeTarget("GIT_EDITOR=true git merge x", WIN)).toEqual({ cwd: WIN });
        expect(mergeTarget("sudo git merge x", WIN)).toEqual({ cwd: WIN });
    });

    it("leaves a cd it cannot place where it was", () => {
        expect(mergeTarget("cd && git merge x", WIN)).toEqual({ cwd: WIN });
        expect(mergeTarget("cd - && git merge x", WIN)).toEqual({ cwd: WIN });
        expect(mergeTarget("cd ~/repo && git merge x", WIN)).toEqual({ cwd: WIN });
        expect(mergeTarget("cd $REPO && git merge x", WIN)).toEqual({ cwd: WIN });
    });

    it("does not count a cd that is one side of a pipe", () => {
        expect(mergeTarget("cd sub | git merge x", POSIX)).toEqual({ cwd: POSIX });
    });

    it.each(["--abort", "--continue", "--quit", "--skip"])("is not a merge with %s", (flag) => {
        expect(mergeTarget(`git merge ${flag}`, WIN)).toBeNull();
        expect(mergeTarget(`cd /d/repo && git merge ${flag}`, WIN)).toBeNull();
    });

    it.each([
        "git log --merges",
        "git merge-base main feat/x",
        "git mergetool",
        "git merge-file a b c",
        "git status",
        "git commit -m 'git merge x'",
        'git commit -m "Merge: git merge x"',
        'echo "git merge x"',
        "echo 'git merge'",
        "echo git merge",
        "grep -r merge src",
        "ls",
        "",
    ])("is not a merge: %s", (command) => {
        expect(mergeTarget(command, WIN)).toBeNull();
    });

    it("is not fooled by a heredoc body that says git merge", () => {
        expect(mergeTarget("cat <<'EOF'\ngit merge x\nEOF", WIN)).toBeNull();
    });
});

describe("gateVerdict", () => {
    const asking = { ask: true, reason: "Verify: rail-verify failed steps 7, 8. Merge anyway?" };

    it("is null when there is no gate or the gate does not ask", () => {
        expect(gateVerdict(null, true)).toBeNull();
        expect(gateVerdict(null, false)).toBeNull();
        expect(gateVerdict({ ask: false, reason: "" }, true)).toBeNull();
        expect(gateVerdict({ ask: false, reason: "Verify: passed." }, false)).toBeNull();
    });

    it("asks with the gate's own line where the person can be asked", () => {
        expect(gateVerdict(asking, true)).toEqual({ decision: "ask", reason: asking.reason });
    });

    it("keeps the gate's line and tells the model to ask the person where nobody can be asked", () => {
        const verdict = gateVerdict(asking, false);
        expect(verdict?.decision).toBe("ask");
        expect(verdict?.reason.startsWith(asking.reason)).toBe(true);
        expect(verdict?.reason).toMatch(/ask the person before merging/i);
        expect(verdict?.reason).not.toBe(asking.reason);
    });

    it("still says what it asks when the gate gave no line", () => {
        const verdict = gateVerdict({ ask: true, reason: "  " }, true);
        expect(verdict?.decision).toBe("ask");
        expect(verdict?.reason).toMatch(/Verify/);
    });
});

describe("parseGate", () => {
    it("reads wsh verify gate's JSON", () => {
        expect(parseGate('{"ask":true,"reason":"Verify: x failed. Merge anyway?"}\n')).toEqual({
            ask: true,
            reason: "Verify: x failed. Merge anyway?",
        });
        expect(parseGate('{"ask":false,"reason":""}')).toEqual({ ask: false, reason: "" });
    });

    it("reads a missing reason as an empty one, so an ask is never dropped for it", () => {
        expect(parseGate('{"ask":true}')).toEqual({ ask: true, reason: "" });
        expect(parseGate('{"ask":false}')).toEqual({ ask: false, reason: "" });
    });

    it.each(["", "not json", "null", "[]", '{"ask":"yes","reason":"r"}', '{"reason":"r"}', '{"ask":true,"reason":3}'])(
        "has no gate in %j",
        (text) => {
            expect(parseGate(text)).toBeNull();
        }
    );
});

describe("verifyGateArgs", () => {
    it("is the wsh verify gate call with the target and the command", () => {
        expect(verifyGateArgs({ cwd: "D:/repo" }, "cd /d/repo && git merge x")).toEqual([
            "verify",
            "gate",
            "--cwd",
            "D:/repo",
            "--command",
            "cd /d/repo && git merge x",
        ]);
    });
});
