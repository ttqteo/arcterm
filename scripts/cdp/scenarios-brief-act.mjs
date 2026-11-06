// brief-act-blocked: STUB. Task 9 of docs/superpowers/plans/2026-11-06-kael-sync-surfaces.md fills it: the Brief's waiting row
// for a blocked chunk shows what it needs and its age, has Unblock and Done with an undo, and opening it lands on the chunk in
// its plan. Copy its seed, `brief-surface` in scenarios.mjs (initiatives seeded with briefSeedInitiative, one with a blocked
// chunk, then the Brief's rows read and pressed).
//
// kit is scenarios.mjs's JARVIS_KIT as it is: briefNap, briefViewport, briefReload, briefFixture, briefSeedInitiative,
// briefDeleteEfforts, polishWaitFor, ... Task 9 takes what it needs with `export default function (kit)`. What `brief-surface`
// uses that JARVIS_KIT lacks (skipStep, BRIEF_SURFACE_*, briefPress, briefCursorTo, briefCloseSheet) is duplicated here, not
// added to scenarios.mjs.
//
// Task 9 replaces the one failing step below with its own steps.

export default function () {
    const scenario = {
        name: "brief-act-blocked",
        surface: "jarvis",
        async arrange() {
            return {};
        },
        async assert() {
            return [{ step: "not built yet (Task 9)", ok: false, detail: "Task 9 fills this scenario in" }];
        },
        async teardown() {},
    };
    return [scenario];
}
