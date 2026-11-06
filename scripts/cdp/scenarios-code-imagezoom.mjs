// code-image-zoom: STUB. Task 4 of docs/superpowers/plans/2026-11-06-kael-sync-surfaces.md fills it: clicking an image in Code's
// markdown Preview opens a full-window zoom view (fitted, wheel zoom with a percent readout, Esc back to the Preview). Copy
// its seed, `code-markdown` in scenarios.mjs (open the Code surface, pick a project, open README.md through the Ctrl+P finder,
// read the rendered markdown).
//
// kit is scenarios.mjs's CODE_KIT, the helpers and constants `code-markdown` and `code-blame` use (git, the project picker and
// finder helpers, the BLAME_* constants, the key probe, waitForProjectInConfig, polishWaitFor, polishNap, waveService,
// MOD_KEY_JS). Task 4 takes what it needs with `export default function (kit)`. A helper the kit lacks is duplicated here,
// not added to scenarios.mjs. The seed also uses SURFACE_LABEL, which is imported from ./attach.mjs, not in the kit.
//
// Task 4 replaces the one failing step below with its own steps.

export default function () {
    const scenario = {
        name: "code-image-zoom",
        surface: "code",
        async arrange() {
            return {};
        },
        async assert() {
            return [{ step: "not built yet (Task 4)", ok: false, detail: "Task 4 fills this scenario in" }];
        },
        async teardown() {},
    };
    return [scenario];
}
