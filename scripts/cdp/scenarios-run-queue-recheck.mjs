// The queue's re-check when an entry's turn comes: an entry whose files a later live run also edits waits for that run
// too (docs/superpowers/specs/2026-11-16-run-start-choice-design.md, "Re-check when an entry's turn comes"; plan
// docs/superpowers/plans/2026-11-16-run-start-choice.md).
//
// Empty on purpose: Task 1 lands the module and its kit, Task 4 adds the scenario here:
//   Task 4 — run-queue-recheck: an entry gains a run created after it in its After, and its queue sheet in Brief names
//            the run and the reason ("Waiting for … too: both edit …").
//
// `kit` is scenarios.mjs's RUN_START_KIT (see scenarios-run-start-choice.mjs for what it holds). A scenario that lacks a
// small helper copies it here rather than editing scenarios.mjs.
export default function (kit) {
    return [];
}
