// diff-file-keys: STUB. Task 6 of docs/superpowers/plans/2026-11-06-kael-sync-surfaces.md fills it: n / p open the next and
// previous file of the Diff's changed-file list without marking it reviewed. Copy its seed, `diff-review-marks` in
// scenarios.mjs (a temp git repo with changed files in its working tree, registered as a project, picked as the Diff source,
// its Log tab's Uncommitted changes row opened).
//
// kit is scenarios.mjs's FILES_KIT, the helpers and constants `diff-review-marks` uses: git, pickFilesSource, showLogTab,
// reloadApp, REVIEW_STORAGE_KEY, restoreLocalStorage. Task 6 takes what it needs with `export default function (kit)`. A helper
// the kit lacks (polishWaitFor, polishNap, waveService, ...) is duplicated here, not added to scenarios.mjs. The seed also uses
// node:fs, node:os and node:path, which this file imports itself.
//
// Task 6 replaces the one failing step below with its own steps.

export default function () {
    const scenario = {
        name: "diff-file-keys",
        surface: "files",
        async arrange() {
            return {};
        },
        async assert() {
            return [{ step: "not built yet (Task 6)", ok: false, detail: "Task 6 fills this scenario in" }];
        },
        async teardown() {},
    };
    return [scenario];
}
