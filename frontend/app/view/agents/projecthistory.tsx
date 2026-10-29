// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Overview's History column: the project's ended sessions of the last 7 days as one searchable list, the runs and
// councils each session started nested under it, and those no listed session started among them by time. The rows are
// projectoverviewmodel.ts's; what is read, and the query, are projecthistorystore.ts's. The page calls useProjectHistory
// once and hands the result in, so the Activity card's session count and this column read one list.

import { Skeleton, SkeletonLine } from "@/app/element/skeleton";
import { openTarget } from "@/app/view/jarvis/openref";
import { cn, fireAndForget } from "@/util/util";
import { useAtom, useAtomValue } from "jotai";
import { ChevronRight } from "lucide-react";
import { Fragment, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { showHistory, showSession } from "./agentcenter";
import type { AgentsViewModel } from "./agents";
import { formatAgeShort, formatTokens } from "./agentsviewmodel";
import { historyQueryAtom, type ProjectHistory } from "./projecthistorystore";
import { historyRows, projectSessions, type CouncilPeek, type HistoryItem } from "./projectoverviewmodel";
import { runtimeMeta } from "./runtimemeta";

const PANEL = "overflow-hidden rounded-[8px] border border-edge-mid bg-surface-raised";
const ROW =
    "flex w-full cursor-pointer items-center gap-[10px] border-t border-edge-mid px-3 py-[9px] text-left first:border-t-0 hover:bg-surface-hover";
// a child row sits 28px in, its divider starting there too
const NESTED_ROW =
    "relative flex w-full cursor-pointer items-center gap-[10px] py-[9px] pl-10 pr-3 text-left before:absolute before:left-10 before:right-0 before:top-0 before:h-px before:bg-edge-mid hover:bg-surface-hover";
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

// a run's rotated square or a council's dot, beside its kind word
function KindLabel({ kind }: { kind: HistoryItem["kind"] }) {
    return (
        <span className="flex w-[68px] flex-none items-center gap-[6px] text-[11px] font-semibold text-ink-mid">
            <span
                aria-hidden="true"
                className={
                    kind === "run"
                        ? "h-[7px] w-[7px] flex-none rotate-45 bg-mark-run"
                        : "h-[7px] w-[7px] flex-none rounded-full bg-mark-council"
                }
            />
            {kind === "council" ? "Council" : "Run"}
        </span>
    );
}

// A council row unfolded: what it was asked, its answer or its error, its top directions, then Open council, which is
// what takes the person to it (the Agent centre and its tree row). It lines up under the row's title.
function CouncilPeekBody({ peek, nested, onOpen }: { peek: CouncilPeek; nested: boolean; onOpen: () => void }) {
    const empty = peek.question === "" && peek.answer === "" && peek.error === "" && peek.directions.length === 0;
    return (
        <div
            data-history-peek
            className={cn("flex flex-col items-start gap-[10px] pb-3 pr-3", nested ? "pl-[118px]" : "pl-[90px]")}
        >
            {peek.question !== "" ? (
                <p className="whitespace-pre-wrap break-words text-[12.5px] leading-[1.5] text-secondary">
                    {peek.question}
                </p>
            ) : null}
            {peek.answer !== "" ? (
                <p className="break-words text-[12.5px] leading-[1.5] text-primary">
                    <span className="font-semibold">Answer: </span>
                    {peek.answer}
                </p>
            ) : null}
            {peek.error !== "" ? <p className="break-words text-[12px] text-error">{peek.error}</p> : null}
            {peek.directions.length > 0 ? (
                <ol className="flex flex-col gap-[3px] text-[12px] text-secondary">
                    {peek.directions.map((d) => (
                        <li key={d.rank} className="flex gap-2">
                            <span className="w-[14px] flex-none tabular-nums text-muted">{d.rank}.</span>
                            <span className="min-w-0 break-words">{d.title}</span>
                        </li>
                    ))}
                    {peek.more > 0 ? <li className="pl-[22px] text-muted">{`+${peek.more} more`}</li> : null}
                </ol>
            ) : null}
            {empty ? <p className="text-[12px] text-muted">No answer yet.</p> : null}
            <button type="button" data-history-open onClick={onOpen} className={SMALL_BTN}>
                Open council
            </button>
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
    const [q, setQ] = useAtom(historyQueryAtom(path));
    const now = useAtomValue(model.nowAtom);
    // the one council row unfolded: a council opens in two steps, the row's peek, then its Open council
    const [unfolded, setUnfolded] = useState<string | null>(null);
    const rows = useMemo(
        () => historyRows(h.sessions, h.councils, h.runs.runs, path, now, q),
        [h.sessions, h.councils, h.runs.runs, path, now, q]
    );
    // the heading's number is the ended sessions in the window, whatever the search keeps
    const sessionCount = useMemo(() => projectSessions(h.sessions, path, now, "").length, [h.sessions, path, now]);

    const runsError = h.runs.error;
    // the list waits for all its reads, so rows do not jump as children arrive; a read that failed does not hold it: its
    // error line shows, with what was read under it
    const busy =
        (h.sessions == null && !h.sessionsError) || (runsError == null && (h.councils == null || h.runs.runs == null));

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

    const noRows =
        q === "" ? (
            <Note attr="data-history-empty">{`No sessions in ${project} in the last 7 days.`}</Note>
        ) : (
            <Note attr="data-history-nomatch">
                <p>{`Nothing in the last 7 days matches "${q}".`}</p>
                <button type="button" data-history-clear onClick={() => setQ("")} className={SMALL_BTN}>
                    Clear search
                </button>
            </Note>
        );

    const list = busy ? (
        <Loading />
    ) : (
        <div className={PANEL}>
            {h.sessionsError ? <ErrorRow text="Could not read sessions." onRetry={h.retrySessions} /> : null}
            {runsError != null ? <ErrorRow text={`Could not read runs: ${runsError}.`} onRetry={h.retryRuns} /> : null}
            {rows.map((row) => {
                if (row.kind === "session") {
                    const s = row.session;
                    const line = [s.branch, runtimeMeta(s.runtime).label, `${formatTokens(s.tokenstotal)} tokens`]
                        .filter(Boolean)
                        .join(" · ");
                    return (
                        <button
                            key={row.key}
                            type="button"
                            data-history-row={row.key}
                            data-history-kind="session"
                            onClick={() => showSession(model, row.key)}
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
                }
                const isCouncil = row.kind === "council";
                const open = isCouncil && unfolded === row.key;
                const button = (
                    <button
                        type="button"
                        data-history-row={row.key}
                        data-history-kind={row.kind}
                        data-history-parent={row.parent}
                        aria-expanded={isCouncil ? open : undefined}
                        onClick={() => (isCouncil ? setUnfolded(open ? null : row.key) : openItem(row))}
                        className={cn(row.nested ? NESTED_ROW : ROW, open && "hover:bg-transparent")}
                    >
                        <KindLabel kind={row.kind} />
                        <span className="flex min-w-0 flex-1 flex-col gap-[2px]">
                            <span className="truncate text-[13px] text-primary">{marked(row.title, q)}</span>
                            <span className="truncate text-[12px] text-muted">
                                {row.line}
                                {row.warn !== "" ? (
                                    <>
                                        {" · "}
                                        <span data-history-warn className="text-asking">
                                            {row.warn}
                                        </span>
                                    </>
                                ) : null}
                            </span>
                        </span>
                        <span className="flex-none text-[11px] tabular-nums text-ink-faint">
                            {formatAgeShort(now - row.ts)}
                        </span>
                        {isCouncil ? (
                            <ChevronRight
                                size={14}
                                aria-hidden="true"
                                className={cn(
                                    "flex-none text-muted transition-transform duration-[140ms]",
                                    open && "rotate-90"
                                )}
                            />
                        ) : null}
                    </button>
                );
                return (
                    <Fragment key={row.key}>
                        {button}
                        {open ? (
                            <CouncilPeekBody peek={row.peek} nested={row.nested} onOpen={() => openItem(row)} />
                        ) : null}
                    </Fragment>
                );
            })}
            {rows.length === 0 && !h.sessionsError && runsError == null ? noRows : null}
            {older}
        </div>
    );

    return (
        <section data-overview-history aria-label="History" className="flex min-w-0 flex-1 flex-col gap-[10px]">
            <div className="flex items-center gap-3">
                <h2 className="text-[11px] font-semibold text-muted">History</h2>
                {!busy ? (
                    <span data-history-count className="text-[11px] tabular-nums text-muted">
                        {sessionCount} {sessionCount === 1 ? "session" : "sessions"}
                    </span>
                ) : null}
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
            {list}
        </section>
    );
}
