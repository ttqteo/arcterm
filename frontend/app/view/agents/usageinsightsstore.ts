// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Store for the Usage surface's By session table and Insights card: the per-session Claude usage
// (GetSessionUsageCommand), the last saved analysis (GetUsageInsightsCommand) and the Analyze run
// (AnalyzeUsageCommand). Modelled on usagestore.ts: the latest load wins, and a failed load keeps the
// last-good value rather than blanking the table. The toggles that must outlive the surface's unmount
// (show all, the table cursor) are atoms here for the same reason as usageWindowAtom.

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { atom, type PrimitiveAtom } from "jotai";

export const sessionUsageAtom = atom<UsageSession[]>([]) as PrimitiveAtom<UsageSession[]>;
export const sessionUsageLoadedAtom = atom<boolean>(false) as PrimitiveAtom<boolean>;
// every session's tokens since each quota window's cutoff, for the By session 5h and Wk columns
export const sessionWindowTokensAtom = atom<{ fiveHour: number; week: number }>({
    fiveHour: 0,
    week: 0,
}) as PrimitiveAtom<{ fiveHour: number; week: number }>;
// what finished subagents cost by type, for the Subagent cost card
export const subagentCostsAtom = atom<SubagentCostData[]>([]) as PrimitiveAtom<SubagentCostData[]>;
export const subagentCostsLoadedAtom = atom<boolean>(false) as PrimitiveAtom<boolean>;

const FIVE_HOUR_S = 5 * 3600;
const WEEK_S = 7 * 24 * 3600;
// the last analysis: the saved one from disk, or the one Analyze just returned. undefined until one exists.
export const savedInsightsAtom = atom<UsageInsights | undefined>(undefined) as PrimitiveAtom<UsageInsights | undefined>;
export const insightsRunningAtom = atom<boolean>(false) as PrimitiveAtom<boolean>;
// the last Analyze failure; the card shows it beside the previous result. Cleared when the next run starts.
export const insightsErrorAtom = atom<string | undefined>(undefined) as PrimitiveAtom<string | undefined>;
// "Show all N" on the By session table, kept across the surface's unmount
export const sessionShowAllAtom = atom<boolean>(false) as PrimitiveAtom<boolean>;
// the By session table's cursor (j / k), a session id
export const usageSessionCursorAtom = atom<string | undefined>(undefined) as PrimitiveAtom<string | undefined>;

// Sets the language the next analysis answers in. English deletes the key (a null value), so the default is unset.
export function setInsightsLang(lang: "en" | "vi"): void {
    const patch = { "usage:insightslang": lang === "en" ? null : lang };
    void RpcApi.SetConfigCommand(TabRpcClient, patch as Parameters<typeof RpcApi.SetConfigCommand>[1]);
}

// How long the Analyze RPC may take: the backend gives Claude 120 s, and the call needs room beyond that.
const ANALYZE_TIMEOUT_MS = 150_000;

// DEV-only fixture seam, like wave:dev-usage-buckets in usagestore.ts and compiled out the same way
// (import.meta.env.DEV is false in a production build). A localStorage JSON object, read each time a
// loader or analyzeUsage runs, so a scenario can change `analyze` and press `a` without a reload:
//   sessions  the By session rows (absent: none)
//   windowfivehourtokens, windowweektokens  every session's tokens in the 5-hour and weekly windows (absent: 0)
//   costs     the Subagent cost rows (absent: none)
//   delayms   how long loadSessionUsage and loadSubagentCosts wait before reading the fixture (absent: 0)
//   saved     the last saved analysis (absent: never analysed)
//   analyze   what the next Analyze does: "ok" resolves `result` after 1.5 s, "error" rejects after 1.5 s,
//             "hang" never settles
//   result    the analysis "ok" returns
//   heldPct   overrides Claude's 5-hour reading, for the held check only (devHeldPct)
//   lastdigest  written, not read: the digest the last Analyze sent, for a scenario to read back
// A malformed or absent fixture falls through to the RPC.
const DEV_INSIGHTS_KEY = "wave:dev-usage-insights";
const DEV_ANALYZE_MS = 1500;
const DEV_ANALYZE_ERROR = "the analysis did not finish: Claude gave no answer within 120 s";

interface DevInsightsFixture {
    sessions?: UsageSession[];
    windowfivehourtokens?: number;
    windowweektokens?: number;
    costs?: SubagentCostData[];
    delayms?: number;
    saved?: UsageInsights;
    analyze?: "ok" | "error" | "hang";
    result?: UsageInsights;
    heldPct?: number;
    lastdigest?: string;
}

function devInsights(): DevInsightsFixture | undefined {
    if (!import.meta.env.DEV || typeof localStorage === "undefined") return undefined;
    try {
        const raw = localStorage.getItem(DEV_INSIGHTS_KEY);
        if (raw == null) return undefined;
        const value = JSON.parse(raw);
        return value != null && typeof value === "object" && !Array.isArray(value) ? value : undefined;
    } catch {
        return undefined;
    }
}

// The fixture's Claude 5-hour reading, when it sets one, for the surface's held check.
export function devHeldPct(): number | undefined {
    const pct = devInsights()?.heldPct;
    return typeof pct === "number" ? pct : undefined;
}

// holds a loader for the fixture's delayms, so a scenario can look at the loading state
async function devDelay(fixture: DevInsightsFixture): Promise<void> {
    if (fixture.delayms != null && fixture.delayms > 0) {
        await new Promise((r) => setTimeout(r, fixture.delayms));
    }
}

// a scenario reads back what the surface sent (usage-insights-levers)
function devRecordDigest(digest: string): void {
    try {
        const raw = localStorage.getItem(DEV_INSIGHTS_KEY);
        const value = raw != null ? JSON.parse(raw) : {};
        localStorage.setItem(DEV_INSIGHTS_KEY, JSON.stringify({ ...value, lastdigest: digest }));
    } catch {
        // a fixture that cannot be rewritten only loses the record
    }
}

function devAnalyze(fixture: DevInsightsFixture, windowDays: number, lang: string): Promise<UsageInsights> {
    const mode = fixture.analyze ?? "ok";
    if (mode === "hang") {
        return new Promise(() => {});
    }
    return new Promise((resolve, reject) => {
        setTimeout(() => {
            if (mode === "error") {
                reject(new Error(DEV_ANALYZE_ERROR));
                return;
            }
            resolve(
                fixture.result ?? {
                    markdown: "## Where it goes\n\nFixture analysis.\n\n## What to change\n\n1. Fixture.",
                    analyzedts: Date.now(),
                    windowdays: windowDays,
                    model: "sonnet",
                    lang,
                }
            );
        }, DEV_ANALYZE_MS);
    });
}

// The latest load wins (the loadSeq pattern of usagestore.ts): a window switch always issues a fresh
// request, and an older response still in flight is ignored when it lands. A scan reads every transcript
// line by line, so the surface calls this on mount and on a window change, not on its 60 s tick.
let sessionSeq = 0;
// the window the held sessions were requested for; undefined until the first load
let heldSessionWindow: number | undefined;

// fiveHourReset / weekReset are the Claude windows' resets (epoch seconds) as Live limits reads them; the rows' 5h and
// Wk tokens count from reset − window, and from the trailing window when a reset is unknown
export async function loadSessionUsage(windowDays: number, fiveHourReset?: number, weekReset?: number): Promise<void> {
    const seq = ++sessionSeq;
    // the skeleton shows while a different window loads; reopening the surface keeps the rows it holds
    if (windowDays !== heldSessionWindow) {
        heldSessionWindow = windowDays;
        globalStore.set(sessionUsageLoadedAtom, false);
    }
    try {
        const fixture = devInsights();
        let sessions: UsageSession[];
        let windows = { fiveHour: 0, week: 0 };
        if (fixture != null) {
            await devDelay(fixture);
            sessions = fixture.sessions ?? [];
            windows = { fiveHour: fixture.windowfivehourtokens ?? 0, week: fixture.windowweektokens ?? 0 };
        } else {
            const rtn = await RpcApi.GetSessionUsageCommand(TabRpcClient, {
                windowdays: windowDays,
                fivehourcutoff: fiveHourReset != null ? fiveHourReset - FIVE_HOUR_S : undefined,
                weekcutoff: weekReset != null ? weekReset - WEEK_S : undefined,
            });
            sessions = rtn.sessions ?? [];
            windows = { fiveHour: rtn.windowfivehourtokens ?? 0, week: rtn.windowweektokens ?? 0 };
        }
        if (seq !== sessionSeq) {
            return; // a newer load superseded this one
        }
        globalStore.set(sessionUsageAtom, sessions);
        globalStore.set(sessionWindowTokensAtom, windows);
    } catch {
        // keep the last-good rows
    } finally {
        if (seq === sessionSeq) {
            globalStore.set(sessionUsageLoadedAtom, true);
        }
    }
}

let costsSeq = 0;

export async function loadSubagentCosts(): Promise<void> {
    const seq = ++costsSeq;
    try {
        const fixture = devInsights();
        let costs: SubagentCostData[];
        if (fixture != null) {
            await devDelay(fixture);
            costs = fixture.costs ?? [];
        } else {
            costs = (await RpcApi.GetSubagentCostsCommand(TabRpcClient)).costs ?? [];
        }
        if (seq === costsSeq) {
            globalStore.set(subagentCostsAtom, costs);
        }
    } catch {
        // keep the last-good rows
    } finally {
        if (seq === costsSeq) {
            globalStore.set(subagentCostsLoadedAtom, true);
        }
    }
}

// Bumped by every load of the saved analysis and by every Analyze result, so a slow disk read cannot land
// over a result Analyze stored after the read began.
let savedSeq = 0;

export async function loadSavedInsights(): Promise<void> {
    const seq = ++savedSeq;
    try {
        const fixture = devInsights();
        const ins = fixture != null ? fixture.saved : await RpcApi.GetUsageInsightsCommand(TabRpcClient);
        if (seq !== savedSeq) {
            return;
        }
        // nothing analysed yet comes back as an empty markdown, never null
        globalStore.set(savedInsightsAtom, ins != null && ins.markdown !== "" ? ins : undefined);
    } catch {
        // keep what the card already shows
    }
}

// Runs the analysis over `digest` (usagedigest.ts), answering in `lang`. A second call while one runs does nothing. On
// failure the saved result is untouched and the message goes to insightsErrorAtom, for the card to show beside it.
export async function analyzeUsage(windowDays: number, digest: string, lang: "en" | "vi"): Promise<void> {
    if (globalStore.get(insightsRunningAtom)) {
        return;
    }
    globalStore.set(insightsRunningAtom, true);
    globalStore.set(insightsErrorAtom, undefined);
    try {
        const fixture = devInsights();
        if (fixture != null) {
            devRecordDigest(digest);
        }
        const ins =
            fixture != null
                ? await devAnalyze(fixture, windowDays, lang)
                : await RpcApi.AnalyzeUsageCommand(
                      TabRpcClient,
                      { windowdays: windowDays, digest, lang },
                      { timeout: ANALYZE_TIMEOUT_MS }
                  );
        savedSeq++;
        globalStore.set(savedInsightsAtom, ins);
    } catch (err) {
        globalStore.set(insightsErrorAtom, err instanceof Error ? err.message : String(err));
    } finally {
        globalStore.set(insightsRunningAtom, false);
    }
}
