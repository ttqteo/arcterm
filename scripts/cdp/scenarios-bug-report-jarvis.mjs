// Jarvis's bug-report row: one row in Waiting on you while reports wait, in its three forms (Xử lý, Mở agent,
// Chọn thư mục…) (docs/superpowers/specs/2026-11-19-bug-report-design.md, "The Jarvis row"; plan
// docs/superpowers/plans/2026-11-19-bug-report.md).
//
//   Task 5 — bug-report-jarvis: the row shows for waiting reports, Xử lý launches the agent (through the DEV-only
//            __bugReportLaunchFake, never a real Claude agent) and the row turns into Mở agent; with no repo it asks for
//            Chọn thư mục….
//
// This file lands empty with the wire (Task 1) so Task 5 adds its scenario here and never edits scenarios.mjs.
// `kit` is scenarios.mjs's RUN_START_KIT (see scenarios-run-start-choice.mjs for what it holds).
export default function (kit) {
    return [];
}
