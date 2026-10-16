// claude/skim-mod is the source of the skim mod, which is also published on its own as ttqteo/claude-skim.
// This copies it, minus its tests, into that repo's plugins/skim folder; the README and the marketplace file
// there are the repo's own and are left alone. It never commits or pushes: review the diff there and commit by hand.
//
//   node scripts/publish-skim.mjs              copy into ../claude-skim
//   node scripts/publish-skim.mjs <repo dir>   copy into another checkout
import { cpSync, existsSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "claude", "skim-mod");
const repo = resolve(process.argv[2] ?? join(root, "..", "claude-skim"));

if (!existsSync(join(repo, ".git"))) {
    console.error(`${repo} is not a git checkout of claude-skim`);
    process.exit(1);
}

const dst = join(repo, "plugins", "skim");
rmSync(dst, { recursive: true, force: true });
cpSync(src, dst, {
    recursive: true,
    // claude writes its generated types into .claude-plugin/types; tests stay in arcterm, where vitest runs them
    filter: (p) => !p.endsWith(".test.ts") && p !== join(src, ".claude-plugin", "types"),
});
console.log(`copied ${src} -> ${dst}`);
