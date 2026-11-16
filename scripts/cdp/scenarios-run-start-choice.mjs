// The run launcher's When row (Run now / After run… / Queue, with Jarvis's suggestion) and the brainstorm card that
// waits on a queued run: docs/superpowers/specs/2026-11-16-run-start-choice-design.md, plan
// docs/superpowers/plans/2026-11-16-run-start-choice.md.
//
// Empty on purpose: Task 1 lands the module and its kit, the later tasks add the scenarios here (and only here):
//   Task 5 — run-start-choice: the steps that hold whichever answer the suggestion RPC gives.
//   Task 6 — run-start-choice-live and run-start-choice-brainstorm: the steps that need the real RPC and the
//            brainstorm notice.
//
// `kit` is scenarios.mjs's RUN_START_KIT: the brainstorm helpers (BS_KIT), the Kael kits (kit.rt, kit.code, kit.files,
// kit.jarvis), the run-seeding helpers (kit.run), the launcher's (openLauncherStart, OPEN_NEW_RUN, NEW_BUTTON) and
// fixture-run arrangers (arrangeFixtureRun, arrangeSheetDagRun), and the Brief's queue-sheet helpers (bqOpenQueued,
// bqCloseSheet, bqSheetFacts, bqClickExpr, bqPoll, bqWaitList, rqList). A scenario that lacks a small helper copies it
// here rather than editing scenarios.mjs.
export default function (kit) {
    return [];
}
