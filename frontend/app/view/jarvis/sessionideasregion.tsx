// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Brief's From your sessions region (docs/superpowers/specs/2026-11-26-session-ideas-design.md, board Brief-Region):
// what a scan found in past sessions and nobody decided, a row per idea with what was said, Discuss, Keep and Drop, under a
// header that says when it last scanned and starts the next. Before the first scan the region is not drawn: the offer card
// (Scan-States board 1) sits under the Ideas column instead, since nothing scans before the person asks. A scan that runs, one
// that stopped part way and sessions about to be deleted unscanned are told inside the region, and the sessions a scan has read
// fold at its end.
//
// The words and states are briefrows.ts's, the rows' order and the coverage sessionideasmodel.ts's, the data and the actions
// sessionideasstore.ts's; this draws them. Every change of shape rides springReveal (rowReveal: it clips only while it moves).

import { MOTION, springFoldWidth } from "@/app/element/motiontokens";
import { usePartMotion } from "@/app/element/springbatch";
import type { AgentsViewModel } from "@/app/view/agents/agents";
import { showLibrarySession } from "@/app/view/library/librarystore";
import { cn } from "@/util/util";
import { atom, useAtom, useAtomValue } from "jotai";
import { ChevronRight, CircleAlert, Lightbulb, LoaderCircle, TriangleAlert } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import {
    ideaKeepTip,
    ideaKeepToast,
    ideaMeta,
    ideaSource,
    leavingLine,
    offerProjects,
    offerShown,
    quoteWho,
    scannedRows,
    scanOffer,
    scanProgress,
    scanRunning,
    scanStopLine,
    scopeNames,
    SESSION_IDEAS_EMPTY,
    sessionIdeasPhase,
    sessionScanMeta,
    type BriefLine,
    type ScannedTone,
} from "./briefrows";
import { RevealRows, rowReveal } from "./briefrowviews";
import { CURSOR_RING, cursorAttrs, FAINT_TEXT, REGION_LABEL, ROW_BORDER, SMALL_BTN } from "./briefstyle";
import { briefUndo } from "./briefundo";
import { FilterMenu } from "./filtermenu";
import { discussIdea, goThroughIdeas, ideaLaunchesAtom, launchedFor, openTabIds } from "./sessionideaslaunch";
import { coverage, reviewRows } from "./sessionideasmodel";
import {
    dropIdea,
    keepIdea,
    markSeen,
    scanNow,
    scanOffered,
    sessionIdeasAtom,
    sessionIdeasFocusAtom,
    stopScan,
} from "./sessionideasstore";

// the header's buttons: the small button's recipe at the height of the Show only button beside them
const HEAD_BTN = cn(SMALL_BTN, "flex h-5 flex-none items-center gap-[5px] whitespace-nowrap py-0");

// "Not now" on the first-scan offer: for this session of the app, the card is out of the way until the next start
const offerDismissedAtom = atom(false);

// the project the offer's next scan reads (its Claude Code folder), null for every project: for this session of the app
const offerProjectAtom = atom<string | null>(null);

// A request to land on the region (openref.ts sets the flag before the surface switches, so a Brief that mounts later still
// finds it): scroll to the element, clear the request, and count the ideas as looked at (the Waiting line's seven days start
// over). `ready` is whether this is the element the person should land on; an offer the person has put away is one, and its
// request is cleared without a scroll.
function useFocusRequest(ref: RefObject<HTMLElement | null>, ready: boolean): void {
    const [focus, setFocus] = useAtom(sessionIdeasFocusAtom);
    useEffect(() => {
        if (!focus || !ready) {
            return;
        }
        ref.current?.scrollIntoView({ block: "start" });
        setFocus(false);
        void markSeen();
    }, [focus, ready, ref, setFocus]);
}

// A panel that opens and folds inside the region on the spring: the scan's progress, a stop's error, the warning, the offer.
function Panel({ show, children }: { show: boolean; children: ReactNode }) {
    const part = usePartMotion(rowReveal);
    return (
        <AnimatePresence initial={false}>
            {show ? (
                <motion.div key="panel" {...part}>
                    {children}
                </motion.div>
            ) : null}
        </AnimatePresence>
    );
}

// True while a button's call is out: the press that started a scan is not pressed twice before the store shows it. Once
// the store shows the scan running (`running`), the scan's own state takes over and the press is settled, so the button
// is pressable again after that scan ends (the region and the offer both outlive a scan).
function useStarting(running: boolean): [boolean, (call: () => Promise<boolean>) => void] {
    const [starting, setStarting] = useState(false);
    useEffect(() => {
        if (running) {
            setStarting(false);
        }
    }, [running]);
    return [
        starting,
        (call) => {
            setStarting(true);
            void call().then((ok) => {
                if (!ok) {
                    setStarting(false);
                }
            });
        },
    ];
}

export function SessionIdeasRegion({ model, only }: { model: AgentsViewModel; only: ReactNode }) {
    const data = useAtomValue(sessionIdeasAtom);
    const shown = data != null && sessionIdeasPhase(data) === "region";
    const ref = useRef<HTMLElement>(null);
    useFocusRequest(ref, shown);
    const part = usePartMotion(rowReveal);
    return (
        <AnimatePresence initial={false}>
            {shown ? (
                <motion.section
                    key="region"
                    ref={ref}
                    {...part}
                    data-jarvis-brief-region="sessions"
                    className="flex min-w-0 flex-col gap-[9px]"
                >
                    <RegionBody model={model} data={data} only={only} />
                </motion.section>
            ) : null}
        </AnimatePresence>
    );
}

function RegionBody({ model, data, only }: { model: AgentsViewModel; data: SessionIdeasData; only: ReactNode }) {
    const rows = reviewRows(data);
    const running = scanRunning(data.scan);
    const stop = running ? null : scanStopLine(data.scan);
    const leaving = leavingLine(data, Date.now());
    const progress = running && data.scan != null ? scanProgress(data.scan) : null;
    const launches = useAtomValue(ideaLaunchesAtom);
    const open = openTabIds(useAtomValue(model.agentsAtom), useAtomValue(model.pendingLaunchesAtom));
    const items = rows.map((idea) => ({ idea, tab: launchedFor(idea.id, launches, open) }));
    // one agent has every idea here (a Go through, or a Discuss on the only one left): the header goes to it
    const goTab = items.length > 0 && items.every((i) => i.tab === items[0].tab) ? items[0].tab : undefined;
    const [starting, start] = useStarting(running);
    // until every project is scanned, Scan now and Retry read only the projects scanned one by one
    const scope = scopeNames(data);
    return (
        <>
            <div className="flex items-center gap-[9px]">
                <span className={cn(REGION_LABEL, "text-ink-mid")}>From your sessions</span>
                <span
                    data-jarvis-sessionideas-count
                    className="flex-none text-[10.5px] font-medium tabular-nums text-ink-mid"
                >
                    {rows.length}
                </span>
                <span className="h-px min-w-3 flex-1 bg-edge-faint" />
                <span data-jarvis-sessionideas-meta className={cn("truncate", FAINT_TEXT)}>
                    {sessionScanMeta(data)}
                </span>
                {!running ? (
                    <button
                        type="button"
                        data-jarvis-sessionideas-scan
                        title={
                            scope.length > 0
                                ? `Read the sessions not scanned yet in ${scope.join(", ")} for ideas nobody decided`
                                : "Read the sessions not scanned yet for ideas nobody decided"
                        }
                        disabled={starting}
                        onClick={() => start(() => scanNow())}
                        className={cn(HEAD_BTN, "disabled:cursor-default disabled:opacity-60")}
                    >
                        Scan now
                    </button>
                ) : null}
                {rows.length > 0 ? (
                    goTab !== undefined ? (
                        <button
                            type="button"
                            data-jarvis-sessionideas-gothrough="open"
                            title="Go to the agent going through these"
                            onClick={() => model.openTerminal(goTab)}
                            className={HEAD_BTN}
                        >
                            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-success" />
                            Go to agent
                        </button>
                    ) : (
                        <button
                            type="button"
                            data-jarvis-sessionideas-gothrough="start"
                            title="One sonnet agent goes through every idea here with you, one at a time"
                            onClick={() => void goThroughIdeas(model, rows)}
                            className={HEAD_BTN}
                        >
                            Go through {rows.length} with an agent
                        </button>
                    )
                ) : null}
                {only}
            </div>
            <div className="flex flex-col rounded-[10px] border border-border bg-surface p-1">
                <Panel show={progress != null}>
                    {progress != null ? (
                        <div
                            data-jarvis-sessionideas-scanning
                            className="relative mb-1 flex items-center gap-2 border-b border-edge-faint px-2.5 py-2"
                        >
                            <LoaderCircle
                                size={13}
                                aria-hidden
                                className="flex-none animate-spin text-success motion-reduce:animate-none"
                            />
                            <span className="flex-1 text-[11.5px] tabular-nums text-secondary">{progress.text}</span>
                            <button
                                type="button"
                                data-jarvis-sessionideas-stop
                                onClick={() => void stopScan()}
                                className={SMALL_BTN}
                            >
                                Stop
                            </button>
                            <div
                                role="progressbar"
                                aria-label="Scan progress"
                                aria-valuemin={0}
                                aria-valuemax={100}
                                aria-valuenow={progress.pct}
                                className="absolute inset-x-0 bottom-0 h-0.5 bg-surface-selected"
                            >
                                <motion.div
                                    className="h-full bg-accent"
                                    initial={false}
                                    animate={{ width: `${progress.pct}%` }}
                                    transition={MOTION.spring}
                                />
                            </div>
                        </div>
                    ) : null}
                </Panel>
                <Panel show={stop != null}>
                    {stop != null ? (
                        <div
                            data-jarvis-sessionideas-stopped
                            className="mb-1 flex items-start gap-2.5 rounded-[8px] border border-error/30 bg-errorbg px-3 py-2.5"
                        >
                            <CircleAlert size={15} aria-hidden className="mt-px flex-none text-error" />
                            <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
                                <span className="text-[12.5px] text-error">{stop.text}</span>
                                <span className="text-[11.5px] text-secondary">{stop.hint}</span>
                            </div>
                            <button
                                type="button"
                                data-jarvis-sessionideas-retry
                                disabled={starting}
                                onClick={() => start(() => scanNow())}
                                className={cn(SMALL_BTN, "flex-none disabled:cursor-default disabled:opacity-60")}
                            >
                                Retry
                            </button>
                        </div>
                    ) : null}
                </Panel>
                <Panel show={leaving != null}>
                    {leaving != null ? (
                        <div
                            data-jarvis-sessionideas-leaving
                            className="mb-1 flex items-start gap-2.5 rounded-[8px] border border-warning/30 bg-askingbg px-3 py-2.5"
                        >
                            <TriangleAlert size={15} aria-hidden className="mt-px flex-none text-warning" />
                            <span className="text-[12.5px] text-warning-soft">{leaving}</span>
                        </div>
                    ) : null}
                </Panel>
                {rows.length === 0 && !running ? (
                    <p data-jarvis-brief-empty="sessions" className="m-0 px-2.5 py-2.5 text-[12px] text-muted">
                        {SESSION_IDEAS_EMPTY}
                    </p>
                ) : null}
                <RevealRows
                    rows={items}
                    rowKey={(i) => i.idea.id}
                    render={(i) => <IdeaRow model={model} idea={i.idea} tab={i.tab} />}
                />
                <ScannedFold data={data} />
            </div>
        </>
    );
}

const ROW_BTN = "disabled:cursor-default disabled:opacity-60";

function IdeaRow({ model, idea, tab }: { model: AgentsViewModel; idea: SessionIdea; tab: string | undefined }) {
    const [said, setSaid] = useState(false);
    const [busy, setBusy] = useState(false);
    const part = usePartMotion(rowReveal);
    // a decision the server refused puts the buttons back; one it took ends in the row leaving on the next read
    const decide = (call: () => Promise<boolean>, done?: () => void) => {
        setBusy(true);
        void call().then((ok) => {
            if (ok) {
                done?.();
            } else {
                setBusy(false);
            }
        });
    };
    return (
        <div
            data-jarvis-sessionidea={idea.id}
            data-jarvis-sessionidea-agent={tab !== undefined ? "open" : "none"}
            className="flex items-start gap-2.5 border-b border-edge-faint py-[9px] pl-2.5 pr-2"
        >
            <Lightbulb size={13} aria-hidden className="mt-[3px] flex-none text-muted" />
            <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
                <span data-jarvis-sessionidea-gist className="text-[12.5px] leading-[17px] text-primary">
                    {idea.gist}
                </span>
                <span className="flex items-center gap-2 whitespace-nowrap text-[11px] text-muted">
                    <span data-jarvis-sessionidea-meta className="truncate">
                        {ideaMeta(idea)}
                    </span>
                    <button
                        type="button"
                        data-jarvis-sessionidea-said-toggle
                        aria-expanded={said}
                        onClick={() => setSaid(!said)}
                        className="flex flex-none cursor-pointer items-center gap-[3px] text-[11px] font-semibold text-accent-soft hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                        <ChevronRight
                            size={9}
                            aria-hidden
                            className={cn(
                                "transition-transform duration-[140ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
                                said && "rotate-90"
                            )}
                        />
                        What was said
                    </button>
                </span>
                <AnimatePresence initial={false}>
                    {said ? (
                        <motion.div key="said" {...part}>
                            <div
                                data-jarvis-sessionidea-said
                                className="mt-1.5 flex flex-col gap-2 rounded-[8px] border border-edge-mid bg-surface-raised px-3 py-2.5"
                            >
                                {idea.quotes.map((q, n) => (
                                    <div key={n} className="flex flex-col gap-0.5">
                                        <span className="text-[10.5px] font-semibold text-muted">
                                            {quoteWho(q.who)}
                                        </span>
                                        <span className="text-[12.5px] leading-[1.5] text-ink-hi">{q.text}</span>
                                    </div>
                                ))}
                                <span className={FAINT_TEXT}>
                                    {ideaSource(idea)} ·{" "}
                                    <button
                                        type="button"
                                        data-jarvis-sessionidea-open-session
                                        onClick={() => showLibrarySession(model, `claude:${idea.sessionid}`)}
                                        className="cursor-pointer text-accent-soft hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                                    >
                                        Open session
                                    </button>
                                </span>
                            </div>
                        </motion.div>
                    ) : null}
                </AnimatePresence>
            </div>
            <div className="flex flex-none gap-1">
                {tab !== undefined ? (
                    <button
                        type="button"
                        data-jarvis-sessionidea-discuss="open"
                        title="Go to the agent deciding this"
                        onClick={() => model.openTerminal(tab)}
                        className={cn(SMALL_BTN, "flex items-center gap-[5px]")}
                    >
                        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-success" />
                        Go to agent
                    </button>
                ) : (
                    <button
                        type="button"
                        data-jarvis-sessionidea-discuss="start"
                        title="Open a sonnet agent on this idea, with what was said"
                        onClick={() => void discussIdea(model, idea)}
                        className={SMALL_BTN}
                    >
                        Discuss
                    </button>
                )}
                <button
                    type="button"
                    data-jarvis-sessionidea-keep
                    title={ideaKeepTip(idea)}
                    disabled={busy}
                    onClick={() =>
                        decide(
                            () => keepIdea(idea.id),
                            () => briefUndo.notify(ideaKeepToast(idea))
                        )
                    }
                    className={cn(SMALL_BTN, ROW_BTN)}
                >
                    Keep
                </button>
                <button
                    type="button"
                    data-jarvis-sessionidea-drop
                    title="Drop it: the scan does not propose it again"
                    disabled={busy}
                    onClick={() => decide(() => dropIdea(idea.id))}
                    className={cn(SMALL_BTN, ROW_BTN)}
                >
                    Drop
                </button>
            </div>
        </div>
    );
}

// what each session's result says, in its colour and, apart from the colour, in its words
const RESULT_TONE: Record<ScannedTone, string> = {
    ideas: "font-semibold text-accent-soft",
    kept: "text-secondary",
    nothing: "text-muted",
    none: "font-semibold text-warning",
    wait: "text-muted",
};

// Sessions scanned: how much of what is still on disk a scan has read, then each session with what it gave. Folded; the bar
// and its legend say each part in words with its count, so the colours are only a second telling.
function ScannedFold({ data }: { data: SessionIdeasData }) {
    const [open, setOpen] = useState(false);
    const part = usePartMotion(rowReveal);
    const cov = coverage(data);
    const rows = useMemo(() => scannedRows(data), [data]);
    if (cov.total === 0 && rows.length === 0) {
        return null;
    }
    const legend = [
        { key: "scanned", n: cov.scanned, label: "scanned", fill: "bg-success/45", text: "text-muted" },
        { key: "notyet", n: cov.notYet, label: "not yet", fill: "bg-surface-selected", text: "text-muted" },
        { key: "leaving", n: cov.leavingSoon, label: "leave within 7 days", fill: "bg-warning", text: "text-warning" },
    ];
    return (
        <>
            <button
                type="button"
                data-jarvis-sessionideas-fold={open ? "open" : "closed"}
                aria-expanded={open}
                onClick={() => setOpen(!open)}
                className="flex cursor-pointer items-center gap-2.5 rounded-[8px] px-2.5 py-[9px] text-left hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
                <ChevronRight
                    size={10}
                    aria-hidden
                    className={cn(
                        "flex-none text-muted transition-transform duration-[140ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
                        open && "rotate-90"
                    )}
                />
                <span className="text-[12px] font-semibold text-secondary">Sessions scanned</span>
                <CoverageBar parts={legend} />
                <span className="text-[11px] tabular-nums text-muted">
                    {cov.scanned} of {cov.total} sessions
                </span>
                {cov.leavingSoon > 0 ? (
                    <span className="flex items-center gap-[5px] text-[11px] text-warning">
                        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-warning" />
                        {cov.leavingSoon} leave within 7 days unscanned
                    </span>
                ) : null}
            </button>
            <AnimatePresence initial={false}>
                {open ? (
                    <motion.div key="fold" {...part}>
                        <div data-jarvis-sessionideas-scanned className="flex flex-col pb-1.5 pl-[30px] pr-1.5">
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pb-2">
                                {legend.map((l) => (
                                    <span
                                        key={l.key}
                                        data-jarvis-sessionideas-legend={l.key}
                                        className={cn("flex items-center gap-[5px] text-[11px] tabular-nums", l.text)}
                                    >
                                        <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", l.fill)} />
                                        {l.n} {l.label}
                                    </span>
                                ))}
                            </div>
                            <div className="flex max-h-[320px] flex-col overflow-y-auto">
                                {rows.map((s) => (
                                    <div
                                        key={s.id}
                                        data-jarvis-sessionideas-session={s.id}
                                        className="flex h-8 flex-none items-center gap-3 border-t border-edge-faint"
                                    >
                                        <span
                                            title={s.title}
                                            className="min-w-0 flex-1 truncate text-[12px] text-ink-hi"
                                        >
                                            {s.title}
                                        </span>
                                        <span title={s.meta} className={cn("w-[170px] flex-none truncate", FAINT_TEXT)}>
                                            {s.meta}
                                        </span>
                                        <span
                                            data-jarvis-sessionideas-result={s.tone}
                                            className={cn(
                                                "w-[130px] flex-none text-right text-[11px]",
                                                RESULT_TONE[s.tone]
                                            )}
                                        >
                                            {s.result}
                                        </span>
                                    </div>
                                ))}
                            </div>
                            <span className={cn("pb-0.5 pt-2", FAINT_TEXT)}>
                                Engine workers and judges are skipped. A session is read once it has been quiet 2 days.
                            </span>
                        </div>
                    </motion.div>
                ) : null}
            </AnimatePresence>
        </>
    );
}

// The bar of the three parts, in proportion; a part with nothing in it takes no room. Its label says all three, as the
// legend does when the fold is open.
function CoverageBar({ parts }: { parts: { key: string; n: number; label: string; fill: string }[] }) {
    return (
        <span
            role="img"
            aria-label={parts.map((p) => `${p.n} ${p.label}`).join(", ")}
            className="flex h-1.5 w-[120px] flex-none gap-0.5 overflow-hidden rounded-full"
        >
            {parts
                .filter((p) => p.n > 0)
                .map((p) => (
                    <span key={p.key} style={{ flexGrow: p.n }} className={cn("basis-0", p.fill)} />
                ))}
        </span>
    );
}

// Before every project is scanned: the card under the Ideas column that says what a scan reads and what it costs, and starts
// it, of one project or of all. Not the region: nothing is scanned until the person presses its button, and the schedule
// covers only what they scanned. It stays while a project scanned one by one leaves others unread.
export function SessionIdeasOffer() {
    const data = useAtomValue(sessionIdeasAtom);
    const [dismissed, setDismissed] = useAtom(offerDismissedAtom);
    const [pickedDir, setPickedDir] = useAtom(offerProjectAtom);
    const offered = offerShown(data);
    const ref = useRef<HTMLDivElement>(null);
    // a request to land on the ideas goes to the region once there is one
    useFocusRequest(ref, offered && sessionIdeasPhase(data) === "offer");
    // the offer stays up through a scan of one project: its button waits for that scan to end
    const running = scanRunning(data?.scan);
    const [starting, start] = useStarting(running);
    const pickFold = usePartMotion(springFoldWidth);
    const part = usePartMotion(rowReveal);
    const projects = useMemo(() => (offered ? offerProjects(data) : []), [offered, data]);
    // a project scanned since it was picked has left the list: the choice goes back to every project
    const picked = projects.find((p) => p.dir === pickedDir) ?? null;
    const offer = offered ? scanOffer(data, picked?.dir ?? null) : null;
    const leaving = offered ? leavingLine(data, Date.now()) : null;
    const scope = offered ? scopeNames(data) : [];
    return (
        <AnimatePresence initial={false}>
            {offered && !dismissed && offer != null ? (
                <motion.div key="offer" ref={ref} {...part} data-jarvis-sessionideas-offer>
                    <div className="flex flex-col gap-2 rounded-[10px] border border-edge-mid bg-surface-raised px-4 py-3.5">
                        <span className="text-[14px] font-semibold text-primary">Ideas you floated and left</span>
                        <span className="text-[12.5px] leading-[1.55] text-muted">
                            {scope.length > 0
                                ? `Scanned so far: ${scope.join(", ")}. Pick another project, or all of them. Each one you scan is then read on its own before its transcripts are deleted.`
                                : "Read your sessions still on disk and propose, on the initiative each belongs to, what was suggested but never reached a chunk, a spec, deferred.md or a commit. Start with one project or all of them; what you scan is then read on its own before a transcript is deleted."}
                        </span>
                        {leaving != null ? (
                            <span
                                data-jarvis-sessionideas-leaving
                                className="flex items-start gap-1.5 text-[11.5px] text-warning-soft"
                            >
                                <TriangleAlert size={12} aria-hidden className="mt-px flex-none text-warning" />
                                {leaving} Nothing is scanned before you start a scan.
                            </span>
                        ) : null}
                        <div className="flex items-center gap-2.5 pt-0.5">
                            {/* the menu folds in and out on the spring when a scan leaves one project, or two, to
                            read; the wrapper's negative margin takes the row's gap with it at width 0 */}
                            <AnimatePresence initial={false}>
                                {projects.length > 1 ? (
                                    <motion.div key="project" {...pickFold} className="-mr-2.5 flex flex-none">
                                        <span className="flex pr-2.5">
                                            <FilterMenu<string | null>
                                                label="Scan the sessions of"
                                                noun="project"
                                                tag="data-jarvis-sessionideas-offer-project"
                                                options={[
                                                    {
                                                        value: null,
                                                        label: "all",
                                                        count: scanOffer(data, null).sessions,
                                                    },
                                                    ...projects.map((p) => ({
                                                        value: p.dir,
                                                        label: p.label,
                                                        count: p.sessions,
                                                        search: p.path,
                                                    })),
                                                ]}
                                                value={picked?.dir ?? null}
                                                onChange={setPickedDir}
                                            />
                                        </span>
                                    </motion.div>
                                ) : null}
                            </AnimatePresence>
                            <button
                                type="button"
                                data-jarvis-sessionideas-offer-scan
                                disabled={starting || running}
                                title={picked != null ? `Scan ${picked.label}` : undefined}
                                onClick={() => start(() => scanOffered(picked?.dir ?? null))}
                                className="h-[26px] max-w-[24ch] flex-none cursor-pointer truncate rounded-[7px] border border-edge-mid bg-surface-raised px-2.5 text-[11.5px] font-semibold text-ink-hi hover:border-edge-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default disabled:opacity-60"
                            >
                                {picked != null ? `Scan ${picked.label}` : "Scan my sessions"}
                            </button>
                            <span
                                data-jarvis-sessionideas-offer-cost
                                className="min-w-0 truncate text-[11px] text-muted"
                            >
                                {offer.text}
                            </span>
                            <span className="flex-1" />
                            <button
                                type="button"
                                data-jarvis-sessionideas-offer-later
                                onClick={() => setDismissed(true)}
                                className="flex-none cursor-pointer text-[11px] text-muted hover:text-ink-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                            >
                                Not now
                            </button>
                        </div>
                    </div>
                </motion.div>
            ) : null}
        </AnimatePresence>
    );
}

// Since you looked's Sessions row: what a scan found since the last look, and Review, which lands on the region.
export function SessionIdeasSinceRow({
    line,
    focused,
    onReview,
}: {
    line: BriefLine;
    focused: boolean;
    onReview: () => void;
}) {
    return (
        <div
            data-jarvis-brief-row="since-sessions"
            {...cursorAttrs(focused)}
            className={cn("flex items-center gap-2.5 py-1.5", ROW_BORDER, focused && CURSOR_RING)}
        >
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span data-jarvis-delta-title title={line.title} className="truncate text-[13px] text-ink-hi">
                    {line.title}
                </span>
                {line.detail ? <span className={cn("truncate", FAINT_TEXT)}>{line.detail}</span> : null}
            </div>
            <span className="flex-none text-[11px] tabular-nums text-ink-mid">{line.state}</span>
            <button type="button" data-jarvis-since-sessions-review onClick={onReview} className={SMALL_BTN}>
                Review
            </button>
        </div>
    );
}
