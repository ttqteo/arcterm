// the reminder after a commit that changed arcterm's UI while the session tried nothing in the running app. kept
// free of the engine so vitest can run it; register.ts holds the tool.call hooks.

// git, past the options that come before its subcommand
const GIT = String.raw`\bgit(?:\s+-[cC]\s+\S+|\s+--[\w-]+(?:=\S+)?)*\s+`;

// a commit, or the update-ref that ends one built on a private index with commit-tree
const COMMIT = new RegExp(GIT + String.raw`(?:commit(?![\w-])|update-ref\s+HEAD\b)`);

// what AGENTS.md counts as trying a UI change: a CDP scenario, a screenshot, or a Final over the scenarios
const LIVE_CHECK = /\bverify:ui\b|\bcdp-shot\b|scripts[\\/]cdp[\\/]|\bfinal-verify\b/;

// a view's own code or its styles; a test file is no UI
const UI_FILE = /^frontend\/.*\.(?:tsx|css|scss)$/;
const TEST_FILE = /\.test\.tsx?$/;

// the tracker a hand-check line goes into, which a commit carrying its own line touches
export const HAND_CHECK_FILE = "docs/open-issues.md";

export function isCommit(command: string): boolean {
    return COMMIT.test(command);
}

export function isLiveCheck(command: string): boolean {
    return LIVE_CHECK.test(command);
}

// the UI files among a commit's paths, as `git diff --name-only` prints them
export function uiFiles(paths: readonly string[]): string[] {
    return paths.filter((p) => UI_FILE.test(p) && !TEST_FILE.test(p));
}

// what the model reads after the commit, or null when the commit needs nothing: it changed no UI, the session
// tried one in the app since the last UI commit, or the commit adds its hand-check line
export function uiCheckReminder(paths: readonly string[], checked: boolean): string | null {
    const ui = uiFiles(paths);
    if (ui.length === 0 || checked || paths.includes(HAND_CHECK_FILE)) {
        return null;
    }
    const shown = ui.length > 4 ? [...ui.slice(0, 4), `${ui.length - 4} more`] : ui;
    return (
        `[arc ui check] This commit changed UI (${shown.join(", ")}) and this session has not tried a UI change in ` +
        "the running app since its last UI commit. Run its CDP scenario (`task verify:ui -- <name>`) or " +
        "`node scripts/cdp-shot.mjs` on the dev app now if one is running; otherwise add a `- [ ]` line under " +
        `"0 · Waiting on a hand check" in ${HAND_CHECK_FILE}, and say in your report what was not verified.`
    );
}
