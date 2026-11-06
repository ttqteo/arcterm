// code-blame-draft: STUB. Task 5 of docs/superpowers/plans/2026-11-06-kael-sync-surfaces.md fills it: blame follows unsaved
// edits (two lines inserted at the top of an open file without saving: the blame entries stay beside their own lines and the
// new lines read unsaved). Copy its seed, `code-blame` in scenarios.mjs (a deferred orchestrator run gives a real landing
// tree, the project is that tree, the file opens in the editor and the blame toggle fills the column).
//
// kit is scenarios.mjs's CODE_KIT, the helpers and constants `code-markdown` and `code-blame` use (git, the project picker and
// finder helpers, the BLAME_* constants and blameLines / blameRow, the key probe, waitForProjectInConfig, polishWaitFor,
// polishNap, waveService, MOD_KEY_JS). Task 5 takes what it needs with `export default function (kit)`. A helper the kit lacks
// is duplicated here, not added to scenarios.mjs. The seed also uses SURFACE_LABEL (imported from ./attach.mjs, not in the kit)
// and node:fs, node:os and node:path, which this file imports itself.
//
// Task 5 replaces the one failing step below with its own steps.

export default function () {
    const scenario = {
        name: "code-blame-draft",
        surface: "code",
        async arrange() {
            return {};
        },
        async assert() {
            return [{ step: "not built yet (Task 5)", ok: false, detail: "Task 5 fills this scenario in" }];
        },
        async teardown() {},
    };
    return [scenario];
}
