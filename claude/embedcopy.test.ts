// The Claude mods wsh embeds are copies of claude/<mod> (Taskfile sync:claudemod), committed so a plain `go build`
// embeds them. A source commit without its copy leaves every build rewriting the copy: the checkout and each run's
// landing tree show it as an uncommitted change, and the run's land held on it (runs 72c9a57d and d39cfe1a,
// commit 4b5c0bc94). This fails the source commit instead.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");
const MODS = [
    { src: "claude/arc-mod", dst: "cmd/wsh/cmd/claude-mod" },
    { src: "claude/arc-view-mod", dst: "cmd/wsh/cmd/claude-view-mod" },
    { src: "claude/skim-mod", dst: "cmd/wsh/cmd/claude-skim-mod" },
];

// what sync:claudemod leaves out of the copy: the engine-written types, the hook tests, and the test fixtures (testdata/)
function synced(rel: string): boolean {
    return (
        !rel.startsWith(".claude-plugin/types/") &&
        !/^hooks\/[^/]*\.test\.ts$/.test(rel) &&
        !rel.startsWith("testdata/")
    );
}

function files(dir: string): Map<string, string> {
    const out = new Map<string, string>();
    const walk = (d: string) => {
        for (const e of readdirSync(d, { withFileTypes: true })) {
            const full = join(d, e.name);
            if (e.isDirectory()) {
                if (e.name !== "node_modules") walk(full);
                continue;
            }
            const rel = relative(dir, full).split(sep).join("/");
            if (synced(rel)) out.set(rel, readFileSync(full, "utf8").replace(/\r\n/g, "\n"));
        }
    };
    walk(dir);
    return out;
}

describe("the embedded Claude mod copies", () => {
    for (const { src, dst } of MODS) {
        it(`${dst} matches ${src} (run \`task sync:claudemod\` and commit the copy)`, () => {
            const want = files(join(ROOT, src));
            const got = files(join(ROOT, dst));
            const stale = [...want.keys()].filter((p) => got.get(p) !== want.get(p));
            const extra = [...got.keys()].filter((p) => !want.has(p));
            expect({ stale, extra }).toEqual({ stale: [], extra: [] });
        });
    }
});
