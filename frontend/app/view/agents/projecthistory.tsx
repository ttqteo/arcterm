// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Overview's History column: the project's ended sessions, and its councils and runs, of the last 7 days, one tab
// each, searchable. The rows are projectoverviewmodel.ts's; what is read, and the tab and the query, are
// projecthistorystore.ts's. The page calls useProjectHistory once and hands the result in, so the header's counts and
// this column read one list.

import { Skeleton, SkeletonLine } from "@/app/element/skeleton";
import { openTarget } from "@/app/view/jarvis/openref";
import { fireAndForget } from "@/util/util";
import { useAtom, useAtomValue } from "jotai";
import { useMemo, type KeyboardEvent, type ReactNode } from "react";
import { showHistory, showSession } from "./agentcenter";
import type { AgentsViewModel } from "./agents";
import { formatAgeShort, formatTokens } from "./agentsviewmodel";
import { historyQueryAtom, historyTabAtom, type ProjectHistory } from "./projecthistorystore";
import { historyItems, projectSessions, type HistoryItem, type HistoryTab } from "./projectoverviewmodel";
import { runtimeMeta } from "./runtimemeta";
import { sessionKey } from "./sessionsruns";

const PANEL = "overflow-hidden rounded-[8px] border border-edge-mid bg-surface-raised";
const ROW =
    "flex w-full cursor-pointer items-center gap-[10px] border-t border-edge-mid px-3 py-[9px] text-left first:border-t-0 hover:bg-surface-hover";
const SMALL_BTN =
    "h-[26px] flex-none cursor-pointer rounded-[6px] border border-edge-mid bg-surface px-[10px] text-[12px] text-secondary hover:border-edge-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

// the first match of the query in a title, marked; the model matched case-insensitively
function marked(text: string, q: string): ReactNode {
    const at = q === "" ? -1 : text.toLowerCase().indexOf(q.toLowerCase());
    if (at < 0) {
        return text;
    }
    return (
        <>
            {text.slice(0, at)}
            <mark className="rounded-[3px] bg-highlightbg px-[2px] text-inherit">{text.slice(at, at + q.length)}</mark>
            {text.slice(at + q.length)}
        </>
    );
}

function Loading() {
    return (
        <div data-history-loading aria-busy="true" className={PANEL}>
            {[0, 1, 2].map((i) => (
                <div
                    key={i}
                    className="flex flex-col gap-[7px] border-t border-edge-mid px-3 py-[11px] first:border-t-0"
                >
                    <SkeletonLine className="w-[62%]" />
                    <Skeleton className="h-[10px] w-[38%]" />
                </div>
            ))}
        </div>
    );
}

function ErrorRow({ text, onRetry }: { text: string; onRetry: () => void }) {
    return (
        <div
            data-history-error
            className="flex items-center gap-2 border-t border-edge-mid px-3 py-[9px] first:border-t-0"
        >
            <span aria-hidden="true" className="h-[7px] w-[7px] flex-none rounded-full bg-error" />
            <span className="min-w-0 flex-1 break-words text-[12px] text-secondary">{text}</span>
            <button type="button" data-history-retry onClick={onRetry} className={SMALL_BTN}>
                Retry
            </button>
        </div>
    );
}

function Note({ attr, children }: { attr: "data-history-empty" | "data-history-nomatch"; children: ReactNode }) {
    const marker = { [attr]: true };
    return (
        <div
            {...marker}
            className="flex flex-col items-start gap-2 border-t border-edge-mid px-3 py-4 text-[13px] text-muted first:border-t-0"
        >
            {children}
        </div>
    );
}

export function HistoryColumn({
    model,
    path,
    project,
    history,
}: {
    model: AgentsViewModel;
    path: string;
    project: string;
    history: ProjectHistory;
}) {
    const h = history;
    const [tab, setTab] = useAtom(historyTabAtom(path));
    const [q, setQ] = useAtom(historyQueryAtom(path));
    const now = useAtomValue(model.nowAtom);
    const sessions = useMemo(() => projectSessions(h.sessions, path, now, q), [h.sessions, path, now, q]);
    const items = useMemo(() => historyItems(h.councils, h.runs.runs, now, q), [h.councils, h.runs.runs, now, q]);

    const runsError = h.runs.error;
    const sessionsLoading = h.sessions == null && !h.sessionsError;
    // loading, unless the runs failed to read: the error line shows then, with the councils under it
    const itemsBusy = runsError == null && (h.councils == null || h.runs.runs == null);

    const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key !== "Escape") {
            return;
        }
        // the first Escape empties the box, the next gives the keys back to the page; neither leaves the Overview
        e.preventDefault();
        if (q !== "") {
            setQ("");
        } else {
            e.currentTarget.blur();
        }
    };
    const openItem = (item: HistoryItem) =>
        fireAndForget(() =>
            openTarget(
                model,
                item.kind === "council"
                    ? { kind: "council", councilId: item.councilId }
                    : item.channelId !== ""
                      ? { kind: "channel", channelId: item.channelId, runId: item.runId }
                      : { kind: "run", runId: item.runId }
            )
        );

    // the Older row ends every list that is drawn: the window is 7 days, and Conversation History keeps the rest
    const older = (
        <button
            type="button"
            data-history-older
            onClick={() => showHistory(model)}
            className={`${ROW} text-[12px] text-muted`}
        >
            Older: Conversation History
        </button>
    );

    // what a tab with no row says: its own words when only it is empty, the project's when everything in the window is
    const emptyText = (own: string) =>
        projectSessions(h.sessions, path, now, "").length + historyItems(h.councils, h.runs.runs, now, "").length === 0
            ? `No sessions, runs or councils in ${project} in the last 7 days.`
            : own;
    const noRows = (own: string) =>
        q === "" ? (
            <Note attr="data-history-empty">{emptyText(own)}</Note>
        ) : (
            <Note attr="data-history-nomatch">
                <p>{`Nothing in the last 7 days matches "${q}".`}</p>
                <button type="button" data-history-clear onClick={() => setQ("")} className={SMALL_BTN}>
                    Clear search
                </button>
            </Note>
        );

    const sessionsList = sessionsLoading ? (
        <Loading />
    ) : (
        <div className={PANEL}>
            {h.sessionsError ? <ErrorRow text="Could not read sessions." onRetry={h.retrySessions} /> : null}
            {sessions.map((s) => {
                const key = sessionKey(s);
                const line = [s.branch, runtimeMeta(s.runtime).label, `${formatTokens(s.tokenstotal)} tokens`]
                    .filter(Boolean)
                    .join(" · ");
                return (
                    <button
                        key={key}
                        type="button"
                        data-history-row={key}
                        data-history-kind="session"
                        onClick={() => showSession(model, key)}
                        className={`${ROW} flex-col items-stretch gap-[2px]`}
                    >
                        <span className="flex items-baseline gap-2">
                            <span className="min-w-0 flex-1 truncate text-[13px] text-primary">
                                {marked(s.task || "(untitled session)", q)}
                            </span>
                            <span className="flex-none text-[11px] tabular-nums text-ink-faint">
                                {formatAgeShort(now - s.lastactivets)}
                            </span>
                        </span>
                        <span className="truncate text-[12px] text-muted">{line}</span>
                    </button>
                );
            })}
            {sessions.length === 0 && !h.sessionsError ? noRows(`No sessions in ${project} in the last 7 days.`) : null}
            {older}
        </div>
    );

    // a failed read keeps what was read before it: the councils (and any runs) list under the error line
    const itemsList = itemsBusy ? (
        <Loading />
    ) : (
        <div className={PANEL}>
            {runsError != null ? <ErrorRow text={`Could not read runs: ${runsError}.`} onRetry={h.retryRuns} /> : null}
            {h.councils == null ? (
                <div data-history-loading aria-busy="true" className="px-3 py-[11px]">
                    <SkeletonLine className="w-[62%]" />
                </div>
            ) : null}
            {items.map((item) => (
                <button
                    key={item.key}
                    type="button"
                    data-history-row={item.key}
                    data-history-kind={item.kind}
                    onClick={() => openItem(item)}
                    className={ROW}
                >
                    <span className="w-[52px] flex-none text-[11px] font-semibold text-ink-mid">
                        {item.kind === "council" ? "Council" : "Run"}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-[2px]">
                        <span className="truncate text-[13px] text-primary">{marked(item.title, q)}</span>
                        <span className="truncate text-[12px] text-muted">
                            {item.line}
                            {item.warn !== "" ? (
                                <>
                                    {" · "}
                                    <span data-history-warn className="text-asking">
                                        {item.warn}
                                    </span>
                                </>
                            ) : null}
                        </span>
                    </span>
                    <span className="flex-none text-[11px] tabular-nums text-ink-faint">
                        {formatAgeShort(now - item.ts)}
                    </span>
                </button>
            ))}
            {items.length === 0 && runsError == null
                ? noRows(`No councils or runs in ${project} in the last 7 days.`)
                : null}
            {older}
        </div>
    );

    const tabs: { key: HistoryTab; label: string; count: number | null }[] = [
        { key: "sessions", label: "Sessions", count: sessionsLoading ? null : sessions.length },
        { key: "councils", label: "Councils & runs", count: itemsBusy ? null : items.length },
    ];

    return (
        <section data-overview-history aria-label="History" className="flex min-w-0 flex-1 flex-col gap-[10px]">
            <div className="flex items-center gap-3">
                <h2 className="text-[11px] font-semibold text-muted">History</h2>
                <span className="flex-1" />
                <input
                    data-history-search
                    type="text"
                    aria-label="Search this project's history"
                    placeholder="Search this project's history"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    onKeyDown={onSearchKey}
                    className="h-[28px] w-[240px] min-w-0 rounded-[6px] border border-edge-mid bg-surface px-[10px] text-[12px] text-primary outline-none placeholder:text-muted focus-visible:border-accent"
                />
            </div>
            <div role="tablist" aria-label="History" className="flex gap-4 border-b border-edge-mid">
                {tabs.map((t) => (
                    <button
                        key={t.key}
                        type="button"
                        role="tab"
                        aria-selected={tab === t.key}
                        data-history-tab={t.key}
                        onClick={() => setTab(t.key)}
                        className={`-mb-px h-[30px] cursor-pointer border-b-2 text-[12px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                            tab === t.key
                                ? "border-primary text-primary"
                                : "border-transparent text-muted hover:text-secondary"
                        }`}
                    >
                        {t.label}
                        {t.count != null ? (
                            <>
                                {" "}
                                <span data-history-tab-count className="font-normal tabular-nums text-muted">
                                    {t.count}
                                </span>
                            </>
                        ) : null}
                    </button>
                ))}
            </div>
            <div role="tabpanel">{tab === "sessions" ? sessionsList : itemsList}</div>
        </section>
    );
}
