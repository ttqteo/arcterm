// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// DEV-ONLY radar fixtures for CDP visual verification. setRadarScenario(name) is exposed on window in
// dev (see radarsurface.tsx) so CDP can drive each scan state without a real backend scan. The data is
// the design boards' own (.superpowers/design/radar-sibling-audit), so a screenshot lines up with its board.

import { globalStore } from "@/app/store/jotaiStore";
import { shortSha } from "./radarmodel";
import { radarDevMockAtom, radarScopeAtom, type RadarScope } from "./radarstore";

export const RADAR_SCENARIOS = [
    "never-scanned",
    "live",
    "selecting",
    "scanning",
    "results",
    "partial",
    "carried",
    "failed",
    "clean",
    "no-commits",
    "fatal",
    "cancelled",
    "old-format",
] as const;

export interface ScenarioOpts {
    // points the fixture at a real checkout, so the site link has a file to open
    projectPath?: string;
}

const PROJECT_NAME = "waveterm";
const PROJECT_PATH = "/repos/waveterm";

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const AUDIT_TIMEOUT_ERROR = "Timed out after 10 minutes.";

interface Commit {
    sha: string;
    subject: string;
    rootcause: string;
    // month is 1-based
    date: [month: number, day: number];
}

const COMMITS: Commit[] = [
    {
        sha: "34f60b82",
        subject: "fix(effortstore): show, update and delete take the effort:<oid> form wsh effort list prints",
        rootcause: "An effort id arrives bare or as effort:<oid>, and only the file lookup accepted both.",
        date: [10, 1],
    },
    {
        sha: "f9bae3b9",
        subject: "fix(agents): Token usage says unavailable instead of pulsing its skeleton forever",
        rootcause: "sessionUsageAtom used null for both loading and a failed load.",
        date: [10, 1],
    },
    {
        sha: "90f4b49e",
        subject: "fix(orchestrate): resume a dag run's lead at boot",
        rootcause: "A quit kills every agent with wavesrv, and nothing restarted the lead at the next boot.",
        date: [10, 2],
    },
    {
        sha: "084b21f2",
        subject: "fix(orchestrate): keep the handoff's typed text on its stream message",
        rootcause: "A session holding an older mod reads only the message text.",
        date: [10, 2],
    },
    {
        sha: "4ab685f0",
        subject: "fix(records): a run's only record, once detached, keeps its Restore on the band",
        rootcause: "The band drew the Detached group only inside the expanded panel.",
        date: [10, 3],
    },
    {
        sha: "a663c1af",
        subject: "fix(claude-mod): ask in claude's own dialog when the pane is not placed",
        rootcause: "Below 144 columns the picker fell back to a band that cannot take the keyboard.",
        date: [10, 3],
    },
    {
        sha: "7927fb68",
        subject: "fix(attention): a finished run's dag and a hand-merged run's held land leave Needs you",
        rootcause: "Nothing moved a dag off blocked once its run finished, so its row stayed in Needs you.",
        date: [10, 4],
    },
    {
        sha: "9caee0d3",
        subject: "fix(jarvis): the Gatekeeper leaves an orchestrator lead's asks to the human",
        rootcause:
            "handleAsk skipped only dag children, so the Gatekeeper answered a lead question meant for the human.",
        date: [10, 4],
    },
    {
        sha: "f8db878a",
        subject: "fix(effort): the effort RPC handlers store an oref-form id bare",
        rootcause: "Handlers kept an effort:<oid> id raw after loading it.",
        date: [10, 5],
    },
    {
        sha: "dd3ac18a",
        subject: "fix(keys): Escape closes an open modal instead of going home under it",
        rootcause:
            "surface:back-home listed each overlay that owns Escape by hand, so an overlay missing from the list lost Escape to navigation.",
        date: [10, 1],
    },
    {
        sha: "cc065522",
        subject: "fix(orchestrate): serialize the engine's worktree registry and branch changes",
        rootcause:
            "git does not lock the worktree registry, so an add or list fails when a concurrent remove has half-deleted a tree.",
        date: [9, 30],
    },
    {
        sha: "b0c32c74",
        subject: "fix(orchestrate): check out run trees past MAX_PATH on Windows",
        rootcause:
            "A worktree nests the checkout deeper than the project, so a path that fits under MAX_PATH in the project can pass it in the tree.",
        date: [10, 2],
    },
    {
        sha: "b9b997cb",
        subject: "fix(claude-mod): report idle when a turn ends without an answer",
        rootcause: "Claude runs no Stop hook for a turn that ends without an answer, so the cockpit read working.",
        date: [10, 4],
    },
];

const FIXTURE_YEAR = 2026;
const SHA_LEN = 40;

function commit(sha: string): Commit {
    const c = COMMITS.find((x) => x.sha === sha);
    if (!c) {
        throw new Error(`radar fixture names an unknown commit ${sha}`);
    }
    return c;
}

const fullSha = (sha: string): string => sha.padEnd(SHA_LEN, "0");
const commitTs = (c: Commit): number => new Date(FIXTURE_YEAR, c.date[0] - 1, c.date[1], 12).getTime();
const signalId = (sha: string): string => `git-${sha}`;

function audit(sha: string, status: string, extra: Partial<RadarAudit> = {}): RadarAudit {
    const c = commit(sha);
    return {
        commit: fullSha(sha),
        subject: c.subject,
        committs: commitTs(c),
        files: [],
        status,
        rootcause: status === "ok" ? c.rootcause : undefined,
        ...extra,
    };
}

const failedAudit = (sha: string): RadarAudit => audit(sha, "failed", { error: AUDIT_TIMEOUT_ERROR });

// the audit list of Main.dc.html: eight commits, two with kept hits
const MAIN_AUDITS = ["34f60b82", "f9bae3b9", "90f4b49e", "084b21f2", "4ab685f0", "a663c1af", "7927fb68", "9caee0d3"];
const MAIN_KEPT: Record<string, number> = { "34f60b82": 2, f9bae3b9: 1 };
const PARTIAL_FAILED = new Set(["7927fb68", "9caee0d3"]);

const mainAudit = (sha: string): RadarAudit =>
    audit(sha, "ok", MAIN_KEPT[sha] ? { hitcount: MAIN_KEPT[sha], keptcount: MAIN_KEPT[sha] } : {});

interface FindingSpec {
    id: string;
    group: string;
    severity: string;
    file: string;
    fingerprint: string;
    title: string;
    sha: string;
    sites: RadarSite[];
    rootcause?: string;
    extra?: Partial<RadarFinding>;
}

const site = (line: number, trigger: string, actual: string, expected: string, whynotcovered: string): RadarSite => ({
    line,
    trigger,
    actual,
    expected,
    whynotcovered,
});

// mirrors buildSiblingFinding (pkg/reporadar/hits.go), so the composer shows what a real finding hands it
function mission(c: Commit, rootcause: string, file: string, sites: RadarSite[]): string {
    const lines = sites.map(
        (s) => `- ${file}:${s.line} trigger: ${s.trigger}; actual: ${s.actual}; expected: ${s.expected}\n`
    );
    return `Fix commit ${c.sha} (${c.subject}) fixed a bug; root cause: ${rootcause}\n\nThe same bug may remain at:\n${lines.join("")}`;
}

function finding(spec: FindingSpec): RadarFinding {
    const c = commit(spec.sha);
    const rootcause = spec.rootcause ?? c.rootcause;
    const dir = spec.file.slice(0, spec.file.lastIndexOf("/"));
    return {
        id: spec.id,
        fingerprint: spec.fingerprint,
        group: spec.group,
        riskkind: "sibling-bug",
        subsystem: dir,
        risk: spec.title,
        why: spec.sites[0].whynotcovered,
        severity: spec.severity,
        signalids: [signalId(spec.sha)],
        files: [spec.file],
        mission: mission(c, rootcause, spec.file, spec.sites),
        sourcecommit: fullSha(spec.sha),
        sourcesubject: c.subject,
        rootcause,
        sites: spec.sites,
        ...spec.extra,
    };
}

function gitSignal(sha: string): RadarSignal {
    const c = commit(sha);
    return {
        id: signalId(sha),
        collector: "git",
        sourceref: fullSha(sha),
        observedts: commitTs(c),
        summary: c.subject,
        contenthash: `h-${sha}`,
    };
}

function mainFindings(now: number): RadarFinding[] {
    return [
        finding({
            id: "a",
            group: "new",
            severity: "medium",
            // a real file and line, so the site link has somewhere to land
            file: "pkg/reporadar/scan.go",
            fingerprint: "RAD-9c41e7a2",
            title: "EffortMutateCommand keeps the effort:<oid> id it was handed",
            sha: "34f60b82",
            rootcause:
                "An effort id arrives in two forms, bare and effort:<oid>. The fix made the effortstore file lookup accept both, but nothing makes the id bare where it enters, so every caller that compares or stores it still sees two forms.",
            sites: [
                site(
                    122,
                    "A mutate verb called with effort:<oid>, the form wsh effort list prints.",
                    "The update lands, then linkSessionToEffort writes the tab's session:effort as effort:effort:<oid>.",
                    "session:effort holds effort:<oid>, which the cockpit resolves to the effort.",
                    "The fix strips the prefix inside effortPath, so the lookup works. The handler still passes the raw id to its other callees."
                ),
                site(
                    83,
                    "A link op whose parent is the effort itself, one id bare and the other effort:<oid>.",
                    "The self-link guard compares the two forms as different ids and the link is stored.",
                    "EC-BAD-PARENT: cannot link an effort to itself.",
                    "The guard compares the strings before either one reaches effortstore."
                ),
            ],
        }),
        finding({
            id: "b",
            group: "new",
            severity: "low",
            file: "frontend/app/view/agents/cachestatusstore.ts",
            fingerprint: "RAD-27d0b3f1",
            title: "agentCacheStatusAtom uses null for loading and for a failed load",
            sha: "f9bae3b9",
            rootcause:
                "sessionUsageAtom used null for both loading and no transcript or load failed, so the skeleton pulsed forever and the error was swallowed.",
            sites: [
                site(
                    18,
                    "An agent with no transcript path, or a cache status load that fails.",
                    "The atom stays null, the same value as loading, so the cache chip keeps its skeleton.",
                    "The chip says unavailable, as Token usage does since the fix.",
                    "The fix gave sessionUsageAtom an unavailable value. This atom has the same two meanings for null and was not changed."
                ),
            ],
        }),
        finding({
            id: "c",
            group: "recurring",
            severity: "medium",
            file: "frontend/app/view/agents/radarfindingdetail.tsx",
            fingerprint: "RAD-e80a55c9",
            title: "Escape goes home under the open Dismiss menu",
            sha: "dd3ac18a",
            sites: [
                site(
                    120,
                    "Escape while the Dismiss menu is open on a finding.",
                    "surface:back-home fires and the cockpit goes home with the menu's state still set.",
                    "Escape closes the menu and Radar stays on screen.",
                    "The fix keeps back-home off for any open ModalShell. This menu is a popover with a click catcher, not a ModalShell."
                ),
            ],
            extra: {
                investigation: {
                    runid: "7c1e02aa",
                    channelid: "dev-channel",
                    status: "executing",
                    startedts: now - 12 * MINUTE,
                },
            },
        }),
        finding({
            id: "d",
            group: "recurring",
            severity: "low",
            file: "pkg/orchestrate/verifybisect.go",
            fingerprint: "RAD-51c6f0de",
            title: "The bisect lists worktrees outside the registry lock",
            sha: "cc065522",
            sites: [
                site(
                    88,
                    "A bisect step listing worktrees while another lane removes its tree.",
                    'git reads a half-deleted admin dir and fails with "failed to read commondir".',
                    "The list waits on the registry lock.",
                    "The fix routes add, remove, list and prune through one lock. This call ran git directly."
                ),
            ],
        }),
        finding({
            id: "e",
            group: "dismissed",
            severity: "low",
            file: "pkg/gitinfo/gitinfo.go",
            fingerprint: "RAD-0b7d91aa",
            title: "CreateWorktree adds a tree without core.longpaths",
            sha: "b0c32c74",
            sites: [
                site(
                    529,
                    "A quick-run worktree for a project whose deepest file sits near 260 chars.",
                    'git worktree add fails with "unable to create file".',
                    "The tree checks out, as an engine run tree does since the fix.",
                    "The fix sets core.longpaths in the engine worktree add only. This path calls git on its own."
                ),
                site(
                    533,
                    "The same project, on a branch that does not exist yet.",
                    "git worktree add -b fails the same way.",
                    "The tree checks out.",
                    "Same call, the new-branch arm."
                ),
            ],
            extra: { disposition: { action: "dismiss", reason: "Low priority", ts: now - 2 * 60 * MINUTE } },
        }),
        finding({
            id: "f",
            group: "suppressed",
            severity: "low",
            file: "claude/arc-mod/hooks/status-core.ts",
            fingerprint: "RAD-66f2c804",
            title: "A compacting turn reports no idle",
            sha: "b9b997cb",
            sites: [
                site(
                    14,
                    "A turn that ends in /compact.",
                    "The cockpit reads working until the idle notification.",
                    "Idle is reported when the turn ends.",
                    "The fix covers interrupted, errored and refused turns."
                ),
            ],
            extra: { disposition: { action: "suppress", reason: "Intentional", ts: now - 3 * 60 * MINUTE } },
        }),
    ];
}

// a finding of the retired lens pipeline: no source commit, no sites
const oldFinding = (id: string, group: string): RadarFinding => ({
    id,
    fingerprint: `RAD-${id}`,
    group,
    riskkind: "test-coverage-gap",
    subsystem: "src/coupons",
    risk: `Coupon validation ${id} gained branches with no covering tests`,
    why: "validate.ts changed 7 times in two weeks with no test deltas.",
    severity: "high",
    signalids: [],
    files: ["src/coupons/validate.ts"],
    mission: "Add expiry and usage-limit coverage to tests/coupons.test.ts.",
});

const AUDIT_RUN = 4 * MINUTE + 36 * SECOND;

// a finished report: the audits ran for AUDIT_RUN and ended `ago` before now
function finished(now: number, ago: number, extra: Partial<RadarReport>): Partial<RadarReport> {
    const completedts = now - ago;
    return {
        status: "completed",
        startedts: completedts - AUDIT_RUN - 2 * SECOND,
        clusterstartedts: completedts - AUDIT_RUN,
        completedts,
        ...extra,
    };
}

function report(opts: ScenarioOpts, now: number, extra: Partial<RadarReport>): RadarReport {
    const findings = extra.findings ?? [];
    return {
        oid: "dev-report",
        version: 1,
        meta: {},
        projectname: PROJECT_NAME,
        projectpath: opts.projectPath ?? PROJECT_PATH,
        status: "completed",
        startedts: now - 5 * MINUTE,
        signals: findings.filter((f) => f.sourcecommit).map((f) => gitSignal(shortSha(f.sourcecommit))),
        ...extra,
    } as RadarReport;
}

// buildScenario is the mock value for a scenario: a report, "none" to force "no report", or null for live.
export function buildScenario(name: string, opts: ScenarioOpts = {}): RadarReport | "none" | null {
    const now = Date.now();
    const results = () =>
        finished(now, 4 * MINUTE, { audits: MAIN_AUDITS.map(mainAudit), findings: mainFindings(now) });
    switch (name) {
        case "never-scanned":
            return "none";
        case "live":
            return null;
        case "selecting":
            return report(opts, now, { status: "collecting", phase: "collecting", startedts: now - 4 * SECOND });
        case "scanning":
            return report(opts, now, {
                status: "clustering",
                phase: "clustering",
                startedts: now - 2 * MINUTE,
                clusterstartedts: now - (MINUTE + 52 * SECOND),
                audits: [
                    audit("34f60b82", "ok", { hitcount: 2, keptcount: 2 }),
                    audit("90f4b49e", "ok"),
                    audit("084b21f2", "ok"),
                    audit("f9bae3b9", "running"),
                    audit("4ab685f0", "running"),
                    audit("a663c1af", "running"),
                    audit("7927fb68", "queued"),
                    audit("9caee0d3", "queued"),
                ],
            });
        case "results":
            return report(opts, now, results());
        case "partial":
            return report(opts, now, {
                ...results(),
                status: "partial",
                audits: MAIN_AUDITS.map((sha) => (PARTIAL_FAILED.has(sha) ? failedAudit(sha) : mainAudit(sha))),
            });
        case "carried":
            return report(
                opts,
                now,
                finished(now, 4 * MINUTE, { findings: mainFindings(now).filter((f) => f.group === "recurring") })
            );
        case "failed":
            return report(
                opts,
                now,
                finished(now, 4 * MINUTE, { status: "failed", audits: MAIN_AUDITS.map(failedAudit) })
            );
        case "clean":
            return report(
                opts,
                now,
                finished(now, 2 * MINUTE, {
                    audits: ["f8db878a", "4ab685f0", "084b21f2", "a663c1af", "90f4b49e"].map((sha) => audit(sha, "ok")),
                })
            );
        case "no-commits":
            return report(opts, now, finished(now, 2 * MINUTE, {}));
        case "fatal":
            return report(opts, now, {
                status: "failed",
                completedts: now - 2 * MINUTE,
                fatalerror: "not a readable git repository",
            });
        case "cancelled":
            return report(opts, now, { status: "cancelled", completedts: now - 2 * MINUTE });
        case "old-format":
            return report(
                opts,
                now,
                finished(now, 4 * MINUTE, { findings: [oldFinding("a", "new"), oldFinding("b", "recurring")] })
            );
        default:
            throw new Error(`unknown radar scenario "${name}"; one of: ${RADAR_SCENARIOS.join(", ")}`);
    }
}

// the scope the first scenario replaced, held so "live" can put it back
let replacedScope: { scope: RadarScope | null } | null = null;

// setRadarScenario drives the surface. A fresh dev store has no Radar scope, which blanks the project
// selector and hides Re-scan, so a scenario also scopes Radar to the fixture's project. It writes the atoms
// directly: nothing is loaded or persisted.
export function setRadarScenario(name: string, opts: ScenarioOpts = {}): void {
    const mock = buildScenario(name, opts);
    if (mock == null) {
        if (replacedScope) {
            globalStore.set(radarScopeAtom, replacedScope.scope);
            replacedScope = null;
        }
        globalStore.set(radarDevMockAtom, null);
        return;
    }
    replacedScope ??= { scope: globalStore.get(radarScopeAtom) };
    globalStore.set(radarScopeAtom, { name: PROJECT_NAME, path: opts.projectPath ?? PROJECT_PATH });
    globalStore.set(radarDevMockAtom, mock);
}
