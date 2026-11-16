// Typecheck the Claude Code mods under claude/ (run by `task check:ts`, after the frontend).
//
//   node scripts/check-mods.mjs
//
// A mod imports its API from the module 'claude-code', whose declarations no package ships: Claude Code
// writes them beside a mod each time it loads one, into <mod>/.claude-plugin/types/ (the API, its built-in
// tools, a tsconfig.json with its compiler options). The checkout's copy has them only when a session loaded
// it with --plugin-dir; the installed copy under ~/.arc (wsh install-agent-hooks, the folder list in
// cmd/wsh/cmd/wshcmd-installhooks.go) has them once any claude launch in arcterm has run. Each mod's
// tsconfig here extends that one, so the options stay Claude Code's (strict, noUncheckedIndexedAccess), and
// points it at the checkout's hooks and contract. Tests are left out: vitest compiles them, they never ship,
// and arc-view-mod's import the frontend, which is not strict.
//
// A mod with no types anywhere is reported and skipped, not failed: start claude once in arcterm.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(fileURLToPath(new URL("..", import.meta.url)));
const tsc = join(repo, "node_modules", "typescript", "lib", "tsc.js");

// [folder under claude/, folder under ~/.arc]
const MODS = [
    ["arc-mod", "claude-mod"],
    ["arc-view-mod", "claude-view-mod"],
    ["skim-mod", "claude-skim-mod"],
];

function typesDir(mod, installed) {
    const candidates = [
        join(repo, "claude", mod, ".claude-plugin", "types"),
        join(homedir(), ".arc", installed, ".claude-plugin", "types"),
    ];
    return candidates.find((dir) => existsSync(join(dir, "tsconfig.json")) && existsSync(join(dir, "claude-code", "index.d.ts")));
}

const out = join(tmpdir(), "arc-check-mods");
mkdirSync(out, { recursive: true });

let failed = 0;
for (const [mod, installed] of MODS) {
    const types = typesDir(mod, installed);
    if (!types) {
        console.log(`check:mods: ${mod} skipped: no Claude Code types (start claude once in arcterm to write them under ~/.arc/${installed})`);
        continue;
    }
    const dir = join(repo, "claude", mod);
    const config = join(out, `${mod}.tsconfig.json`);
    const include = [join(dir, "hooks"), join(dir, "types")].filter(existsSync);
    // exclude globs resolve against this config's folder, so they are absolute too
    const exclude = [join(dir, "**", "*.test.ts"), join(dir, "**", "*.test.tsx")];
    writeFileSync(config, JSON.stringify({ extends: join(types, "tsconfig.json"), include, exclude }, null, 4));
    const run = spawnSync(process.execPath, [tsc, "-p", config], { cwd: repo, stdio: "inherit" });
    if (run.status !== 0) {
        failed++;
        console.log(`check:mods: ${mod} FAILED (types from ${types})`);
    } else {
        console.log(`check:mods: ${mod} ok`);
    }
}
process.exit(failed > 0 ? 1 : 0);
