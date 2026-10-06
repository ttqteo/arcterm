// Headless proof that arcterm's Claude mod loads from a settings `env` block and reports usage: runs
// `claude -p` with env.CLAUDE_CODE_PLUGIN_DIRS in a --settings file pointing at a copy of claude/arc-mod
// whose wsh path is a stub that logs its argv, then expects session.measure to have run
// `agentstatus --usage --context-pct ...`. this guards the statusLine unwrap: once the wrapper is gone,
// a mod that fails to load from settings env leaves the cockpit with no usage at all.
// exit 0 pass, 1 fail, 3 could not verify (the reason is the last stdout line), as a plan's Final line expects.
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const EXIT_PASS = 0;
const EXIT_FAIL = 1;
const EXIT_UNVERIFIED = 3;
const CLAUDE_TIMEOUT_MS = 3 * 60 * 1000;
const TAIL_CHARS = 2000;
const WSH_PLACEHOLDER = '"__WSH_PATH__"';
const USAGE_PREFIX = "agentstatus --usage --context-pct ";
const FAKE_BLOCK = "arc-mod-check";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const modSrc = join(repoRoot, "claude", "arc-mod");

const tail = (s) => (s ?? "").slice(-TAIL_CHARS);

const outcome = (code, ...lines) => ({ code, lines });

function probe(cmd, args) {
    try {
        execFileSync(cmd, args, { stdio: "pipe" });
        return null;
    } catch (err) {
        return `${cmd} ${args.join(" ")} failed: ${err.message}`;
    }
}

function buildStub(tmp, logPath) {
    const stubDir = join(tmp, "stub");
    mkdirSync(stubDir);
    writeFileSync(join(stubDir, "go.mod"), "module stubwsh\n\ngo 1.21\n");
    // a JSON string is a valid Go string literal, backslashes included
    writeFileSync(
        join(stubDir, "main.go"),
        `package main

import (
	"os"
	"strings"
)

var logPath = ${JSON.stringify(logPath)}

func main() {
	f, err := os.OpenFile(logPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		os.Exit(0)
	}
	defer f.Close()
	f.WriteString(strings.Join(os.Args[1:], " ") + "\\n")
}
`
    );
    const stubExe = join(tmp, process.platform === "win32" ? "wsh-stub.exe" : "wsh-stub");
    execFileSync("go", ["build", "-o", stubExe, "."], { cwd: stubDir, stdio: "pipe" });
    return stubExe;
}

// the same set task sync:claudemod drops: tests and the engine-written types
function copyMod(modDst, stubExe) {
    cpSync(modSrc, modDst, {
        recursive: true,
        filter: (src) => {
            const rel = relative(modSrc, src).split(sep).join("/");
            return !basename(src).endsWith(".test.ts") && !(rel === ".claude-plugin/types" || rel.startsWith(".claude-plugin/types/"));
        },
    });
    const registerPath = join(modDst, "hooks", "register.ts");
    const source = readFileSync(registerPath, "utf8");
    if (!source.includes(WSH_PLACEHOLDER)) {
        return `${WSH_PLACEHOLDER} not found in ${registerPath}`;
    }
    writeFileSync(registerPath, source.replaceAll(WSH_PLACEHOLDER, JSON.stringify(stubExe)));
    return null;
}

function runClaude(tmp, settingsPath) {
    const env = { ...process.env, WAVETERM_BLOCKID: FAKE_BLOCK, WAVETERM_JWT: FAKE_BLOCK };
    // only the settings file may supply the plugin dir
    delete env.CLAUDE_CODE_PLUGIN_DIRS;
    return spawnSync(
        "claude",
        ["-p", "Reply with the single word ok.", "--model", "haiku", "--settings", settingsPath, "--setting-sources", "project"],
        { cwd: tmp, env, encoding: "utf8", timeout: CLAUDE_TIMEOUT_MS }
    );
}

function main() {
    for (const [cmd, args] of [["claude", ["--version"]], ["go", ["version"]]]) {
        const reason = probe(cmd, args);
        if (reason) {
            return outcome(EXIT_UNVERIFIED, `could not verify: ${reason}`);
        }
    }

    const tmp = mkdtempSync(join(tmpdir(), "arc-mod-check-"));
    try {
        const logPath = join(tmp, "wsh-calls.log");
        const stubExe = buildStub(tmp, logPath);
        const modDst = join(tmp, "arc-mod");
        const copyErr = copyMod(modDst, stubExe);
        if (copyErr) {
            return outcome(EXIT_FAIL, `FAIL: ${copyErr}`);
        }
        const settingsPath = join(tmp, "settings.json");
        writeFileSync(settingsPath, JSON.stringify({ env: { CLAUDE_CODE_PLUGIN_DIRS: modDst } }, null, 2));

        const ran = runClaude(tmp, settingsPath);
        if (ran.error || ran.status !== 0) {
            const why = ran.error ? ran.error.message : `exit ${ran.status}`;
            return outcome(EXIT_UNVERIFIED, tail(ran.stderr), `could not verify: claude -p did not complete a turn (${why})`);
        }

        const log = existsSync(logPath) ? readFileSync(logPath, "utf8") : null;
        const hit = log?.split(/\r?\n/).find((line) => line.startsWith(USAGE_PREFIX));
        if (hit) {
            return outcome(EXIT_PASS, `PASS: ${hit}`);
        }
        return outcome(
            EXIT_FAIL,
            `--- claude stdout ---\n${tail(ran.stdout)}`,
            `--- claude stderr ---\n${tail(ran.stderr)}`,
            `--- stub log ---\n${log ?? "no log"}`,
            `FAIL: no "${USAGE_PREFIX.trim()}" call from the mod`
        );
    } finally {
        rmSync(tmp, { recursive: true, force: true });
    }
}

// process.exit inside main would skip its finally, so the temp dir is removed before exiting
const { code, lines } = main();
for (const line of lines) {
    console.log(line);
}
process.exit(code);
