// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Office's game boxes (canvas .superpowers/design/office-controls): the pixel frame they share, the ▶ list, the
// dialog box of the desk at the boss with its words for an agent, a run's lead and a task's worker, the office menu
// (m) and the HUD bar. The rules are officecontrols.ts and officedialogmodel.ts; cockpitoffice.tsx places the boxes and
// cockpitsurface.tsx builds each desk's dialog.

import { TONE_TEXT } from "@/app/view/jarvis/briefstyle";
import { cn } from "@/util/util";
import { useAtomValue, type Atom } from "jotai";
import { Check, Workflow } from "lucide-react";
import { Fragment, type HTMLAttributes, type ReactNode } from "react";
import { entriesToShow } from "./agentrowmodel";
import { displayAgeMs, formatAgeShort, recentActions, type AgentVM } from "./agentsviewmodel";
import { cleanLabel } from "./answerbar";
import { diffStatsByIdAtom } from "./cardgitstore";
import { LeadBar, TONE_DOT } from "./leadcard";
import { LEAD_MARK_CLASS, leadMark, type LeadCardVM, type TaskRowVM } from "./leadcardmodel";
import { liveTokensAtom } from "./livetokensstore";
import { entriesAtomFor } from "./livetranscriptatoms";
import { NarrationTimeline } from "./narrationtimeline";
import { stripAge, type StripRow } from "./needsyoustripmodel";
import type { BoardWords } from "./officeboardmodel";
import type { OfficeMenuItem } from "./officecontrols";
import {
    agentMeta,
    dialogWords,
    runTaskList,
    type DeskKind,
    type DialogItem,
    type DialogItemId,
    type QuestionTabs,
} from "./officedialogmodel";
import type { RunInfo } from "./runlineage";
import { SubLabel } from "./sectionlabel";
import { ActivityLine, StatusLine } from "./statusline";

/** What cockpitsurface.tsx hands the office for a desk: who talks, the box's plate and words, and its ▶ menu. */
export interface OfficeDialogVM {
    kind: DeskKind;
    label: string;
    plate: ReactNode;
    body: ReactNode;
    items: DialogItem[];
    // a several-part ask: ◀ the question its answers belong to ▶, over the ▶ menu
    tabs?: QuestionTabs;
    run: (id: DialogItemId) => void;
}

/** The double line of a Game Boy box: a 2 px outer border, a 2 px dark gap, a faint inner line. */
export function PixelFrame({
    className,
    innerClassName,
    children,
    ...rest
}: HTMLAttributes<HTMLDivElement> & { innerClassName?: string }) {
    return (
        <div
            {...rest}
            className={cn("rounded-[3px] border-2 border-edge-strong bg-background p-[2px] shadow-popover", className)}
        >
            <div className={cn("h-full rounded-[1px] border border-edge-mid", innerClassName)}>{children}</div>
        </div>
    );
}

/** The ▶ (or ◀), on a 4 x 7 grid at 2 px a cell, so it stays crisp at any zoom. */
export function PixelArrow({ dir = "right", className }: { dir?: "left" | "right"; className?: string }) {
    const d = dir === "right" ? "M0 0H1V1H2V2H3V3H4V4H3V5H2V6H1V7H0Z" : "M4 0H3V1H2V2H1V3H0V4H1V5H2V6H3V7H4Z";
    return (
        <svg width="8" height="14" viewBox="0 0 4 7" shapeRendering="crispEdges" aria-hidden className={className}>
            <path d={d} fill="currentColor" />
        </svg>
    );
}

export interface PickRow {
    label: string;
    key?: string;
    dim?: boolean;
    checked?: boolean;
    rule?: boolean;
    count?: ReactNode;
}

/** A ▶ list: the item under the ▶ is bright; keys show on that item only, or on every item for the office menu. */
export function PickList({
    rows,
    sel,
    onPick,
    label,
    keys,
}: {
    rows: PickRow[];
    sel: number;
    onPick: (i: number) => void;
    label: string;
    keys: "selected" | "all";
}) {
    return (
        <div role="menu" aria-label={label} className="flex flex-col gap-px">
            {rows.map((r, i) => (
                <Fragment key={i}>
                    {r.rule ? <span className="mx-1.5 my-1 h-px shrink-0 bg-edge-mid" /> : null}
                    <button
                        type="button"
                        role="menuitem"
                        data-office-pick={i}
                        aria-current={i === sel || undefined}
                        aria-disabled={r.dim || undefined}
                        onClick={(e) => {
                            e.stopPropagation();
                            if (!r.dim) {
                                onPick(i);
                            }
                        }}
                        className={cn(
                            "flex h-7 shrink-0 items-center gap-2 rounded-[4px] border-0 bg-transparent px-1.5 text-left text-[13.5px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                            i === sel
                                ? "cursor-pointer font-semibold text-primary"
                                : r.dim
                                  ? "cursor-default font-medium text-ink-faint"
                                  : "cursor-pointer font-medium text-secondary hover:text-primary"
                        )}
                    >
                        <span className="flex w-2.5 shrink-0 justify-center text-primary">
                            {i === sel ? <PixelArrow /> : null}
                        </span>
                        {r.checked ? (
                            <span className="flex size-3 shrink-0 items-center justify-center rounded-[3px] bg-accent text-background">
                                <Check size={9} strokeWidth={4} aria-hidden />
                            </span>
                        ) : null}
                        <span className="min-w-0 truncate">{r.label}</span>
                        {r.count}
                        {r.key && (keys === "all" || i === sel) ? (
                            <kbd className="ml-auto shrink-0 font-mono text-[10.5px] font-normal text-ink-faint">
                                {r.key}
                            </kbd>
                        ) : null}
                    </button>
                </Fragment>
            ))}
        </div>
    );
}

/** The dialog box: the plate on its top edge, the words and numbers on the left, the ▶ menu in its own frame. */
export function OfficeDialogBox({ vm, sel, onPick }: { vm: OfficeDialogVM; sel: number; onPick: (i: number) => void }) {
    const runBoard = vm.kind === "lead" || vm.kind === "leadless";
    return (
        <PixelFrame
            role="dialog"
            aria-label={vm.label}
            data-office-dialog={vm.kind}
            className="pointer-events-auto relative"
            innerClassName="flex max-h-[262px] min-h-[150px] gap-[22px] pb-4 pl-6 pr-4 pt-[26px]"
        >
            <div className="absolute -top-[15px] left-[18px] flex max-w-[70%] items-center gap-2 rounded-[3px] border-2 border-edge-strong bg-surface-raised px-2.5 py-1">
                {vm.plate}
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-2 overflow-hidden">{vm.body}</div>
            <PixelFrame
                className={cn("shrink-0 self-start shadow-none", runBoard ? "w-[220px]" : "w-[268px]")}
                innerClassName="px-3 py-2.5"
            >
                {vm.tabs ? <QuestionTabsHead tabs={vm.tabs} /> : null}
                <PickList
                    label={vm.label}
                    keys="selected"
                    sel={sel}
                    onPick={onPick}
                    rows={vm.items.map((it) => ({
                        ...it,
                        label: it.id.startsWith("opt:") ? cleanLabel(it.label) : it.label,
                    }))}
                />
            </PixelFrame>
        </PixelFrame>
    );
}

/** Over a several-part ask's answers (States): ◀ the question ▶ and which of how many; an arrow fades at its end. */
function QuestionTabsHead({ tabs }: { tabs: QuestionTabs }) {
    return (
        <div data-office-question-tabs="" className="flex items-center gap-1.5 px-1 pb-1 text-[12px] text-muted">
            <PixelArrow dir="left" className={tabs.at > 0 ? "text-muted" : "text-ink-faint"} />
            <span className="min-w-0 truncate font-semibold text-primary">{tabs.head}</span>
            <PixelArrow className={tabs.at < tabs.of - 1 ? "text-muted" : "text-ink-faint"} />
            <span className="ml-auto shrink-0 tabular-nums">
                {tabs.at + 1} of {tabs.of}
            </span>
        </div>
    );
}

/** An agent's plate: its status line (dot, runtime, name, project), its task, and Needs you while it asks. */
export function AgentPlate({ agent, nowAtom }: { agent: AgentVM; nowAtom: Atom<number> }) {
    const now = useAtomValue(nowAtom);
    const age = agent.state === "asking" ? displayAgeMs(agent, now) : undefined;
    return (
        <>
            <StatusLine agent={agent} nowAtom={nowAtom} className="min-w-0 shrink" />
            {agent.task ? <span className="min-w-0 truncate text-[12px] text-muted">{agent.task}</span> : null}
            {agent.state === "asking" ? (
                <span className="shrink-0 text-[11.5px] font-semibold tabular-nums text-warning">
                    Needs you{age != null ? ` · ${formatAgeShort(age)}` : ""}
                </span>
            ) : null}
        </>
    );
}

/** An agent's words: its live activity, what it said last, its question, its last steps and changes, then its model,
 *  context and age. */
export function AgentDialogBody({
    agent,
    nowAtom,
    activeQuestion,
}: {
    agent: AgentVM;
    nowAtom: Atom<number>;
    activeQuestion: number;
}) {
    const live = useAtomValue(entriesAtomFor(agent.id));
    const entries = entriesToShow(live, agent.previousInfo);
    const now = useAtomValue(nowAtom);
    const diff = useAtomValue(diffStatsByIdAtom)[agent.id];
    const tokens = useAtomValue(liveTokensAtom).get(agent.id);
    const words = dialogWords(agent, entries, activeQuestion);
    const steps = recentActions(entries, 3);
    return (
        <>
            {agent.state === "working" ? <ActivityLine agent={agent} nowAtom={nowAtom} /> : null}
            {words.said ? (
                <p className="m-0 line-clamp-2 text-[14.5px] leading-[22px] text-secondary">{words.said}</p>
            ) : null}
            {words.main ? (
                <p className="m-0 line-clamp-2 text-[17px] font-semibold leading-6 text-primary">{words.main}</p>
            ) : null}
            {steps.length > 0 || diff ? (
                <div className="mt-1 flex min-h-0 flex-col gap-1 overflow-hidden rounded-md bg-surface-code px-3 py-2">
                    {steps.length > 0 ? <NarrationTimeline entries={steps} active={agent.state !== "idle"} /> : null}
                    {diff ? (
                        <span className="text-[12px] tabular-nums text-muted">
                            <span className="text-diff-added">+{diff.adds}</span>{" "}
                            <span className="text-diff-removed">−{diff.dels}</span> in {diff.files}{" "}
                            {diff.files === 1 ? "file" : "files"}
                        </span>
                    ) : null}
                </div>
            ) : null}
            <div className="mt-auto truncate text-[11.5px] tabular-nums text-muted">
                {agentMeta(agent, now, tokens)}
            </div>
        </>
    );
}

/** A run's plate (Run board): the run's mark in its lead's tone, its title, its project, and who leads it. */
export function RunPlate({ run, lead }: { run: RunInfo; lead?: AgentVM }) {
    const mark = leadMark(run, lead);
    return (
        <>
            <Workflow size={13} aria-hidden className={cn("shrink-0", LEAD_MARK_CLASS[mark.tone])} />
            <b className="min-w-0 truncate text-[13.5px] font-semibold text-primary">{run.title}</b>
            {run.project ? (
                <span className="shrink-0 rounded-[4px] bg-surface px-1.5 text-[11.5px] text-secondary">
                    {run.project}
                </span>
            ) : null}
            <span className="shrink-0 text-[12px] text-muted">{lead ? "lead" : "no lead"}</span>
        </>
    );
}

function TaskLine({ row }: { row: TaskRowVM }) {
    return (
        <div
            data-office-task={row.taskId}
            className="flex h-7 shrink-0 items-center gap-2.5 px-1 text-[13px] text-secondary"
        >
            <span className={cn("size-[7px] shrink-0 rounded-full", TONE_DOT[row.tone])} />
            <span className="min-w-0 flex-1 truncate">{row.label}</span>
            <span className={cn("shrink-0 text-[11.5px] tabular-nums", row.needsYou ? "text-warning" : "text-muted")}>
                {row.tag ?? row.age ?? ""}
            </span>
        </div>
    );
}

/** A run's words: the lead's last line (and its question when it asks), the task bar and counts, the run's settings,
 *  and a column of its tasks. */
export function RunDialogBody({
    vm,
    lead,
    activeQuestion,
}: {
    vm: LeadCardVM;
    lead?: AgentVM;
    activeQuestion: number;
}) {
    const live = useAtomValue(entriesAtomFor(lead?.id ?? ""));
    const words = lead ? dialogWords(lead, entriesToShow(live, lead.previousInfo), activeQuestion) : {};
    const said = words.said ?? lead?.activity;
    const tasks = runTaskList(vm.rows, vm.waiting, vm.done, 4);
    return (
        <div className="flex min-h-0 flex-1 gap-[22px]">
            <div className="flex w-[330px] shrink-0 flex-col gap-2.5">
                {said ? <p className="m-0 line-clamp-3 text-[15px] leading-[22px] text-primary">{said}</p> : null}
                {words.main ? (
                    <p className="m-0 line-clamp-2 text-[15px] font-semibold leading-[22px] text-primary">
                        {words.main}
                    </p>
                ) : null}
                {vm.bar ? <LeadBar strip={vm.bar.strip} label={vm.bar.label} /> : null}
                <div className="flex items-center gap-2 text-[12px] text-muted">
                    <span
                        className={cn(
                            "min-w-0 flex-1 truncate first-letter:uppercase",
                            vm.complete ? "text-success" : "text-accent-soft"
                        )}
                    >
                        {vm.activity}
                    </span>
                    <span className="shrink-0 tabular-nums">
                        {[vm.progress.total > 0 ? `${vm.progress.done}/${vm.progress.total}` : "", vm.elapsed, vm.cost]
                            .filter(Boolean)
                            .join(" · ")}
                    </span>
                </div>
                <div title={vm.settingsTitle} className="mt-auto truncate text-[11.5px] tabular-nums text-muted">
                    {vm.settings}
                </div>
            </div>
            {tasks.shown.length > 0 ? (
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <SubLabel className="px-1 pb-1">{tasks.heading}</SubLabel>
                    {tasks.shown.map((r) => (
                        <TaskLine key={r.key} row={r} />
                    ))}
                    {tasks.more > 0 ? (
                        <span className="pl-[21px] pt-0.5 text-[11.5px] text-ink-faint">
                            {tasks.more} more in the full card
                        </span>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}

/** A task's seat: the task row's line and note, then its worker's words when it has one. */
export function WorkerDialogBody({
    row,
    worker,
    nowAtom,
    activeQuestion,
}: {
    row: TaskRowVM;
    worker?: AgentVM;
    nowAtom: Atom<number>;
    activeQuestion: number;
}) {
    return (
        <>
            <TaskLine row={row} />
            {row.sub ? <p className="m-0 line-clamp-2 px-1 text-[12.5px] text-muted">{row.sub}</p> : null}
            {worker ? <AgentDialogBody agent={worker} nowAtom={nowAtom} activeQuestion={activeQuestion} /> : null}
        </>
    );
}

/** The notice board's plate: the asking dot, its name and how many rows wait on the person. */
export function BoardPlate({ count }: { count: number }) {
    return (
        <>
            <span aria-hidden className="size-[7px] shrink-0 rounded-full bg-asking" />
            <b className="min-w-0 truncate text-[13.5px] font-semibold text-primary">Notice board</b>
            <span className="shrink-0 text-[11.5px] font-semibold tabular-nums text-warning">Needs you · {count}</span>
        </>
    );
}

/** One page of the notice board: the row's title line in its tone, its text at the agent box's main size, its why, the
 *  words that raised a learned rule once Why is open, and how long it has waited. */
export function BoardDialogBody({ words, row, now }: { words: BoardWords; row: StripRow; now: number }) {
    const age = stripAge(row.waitingSince, now);
    return (
        <>
            <span
                data-office-board-title=""
                className={cn("truncate text-[12px] font-semibold tracking-[.02em]", TONE_TEXT[row.tone])}
            >
                {words.title}
            </span>
            <p className="m-0 line-clamp-2 text-[17px] font-semibold leading-6 text-primary">{words.text}</p>
            {words.why ? (
                <p className="m-0 line-clamp-2 text-[14.5px] leading-[22px] text-secondary">{words.why}</p>
            ) : null}
            {words.quote ? (
                <div
                    data-office-board-quote=""
                    className="line-clamp-2 rounded-md bg-surface-code px-3 py-2 text-[13px] leading-5 text-secondary"
                >
                    <span className="text-muted">Your words: </span>
                    {words.quote}
                </div>
            ) : null}
            {age ? (
                <div className="mt-auto text-[11.5px] tabular-nums text-muted">
                    Waiting <span className={cn("font-semibold", TONE_TEXT[row.tone])}>{age}</span>
                </div>
            ) : null}
        </>
    );
}

/** The office menu (m): START's list, every item with its key. */
export function OfficeMenuBox({
    items,
    sel,
    onPick,
}: {
    items: OfficeMenuItem[];
    sel: number;
    onPick: (i: number) => void;
}) {
    return (
        <PixelFrame data-office-menu="" className="pointer-events-auto w-[268px]" innerClassName="px-3.5 py-3">
            <PickList
                label="Office"
                keys="all"
                sel={sel}
                onPick={onPick}
                rows={items.map((it) => ({
                    label: it.label,
                    key: it.key,
                    rule: it.rule,
                    count: it.count ? (
                        <span
                            className={cn(
                                "shrink-0 text-[11.5px] tabular-nums",
                                it.ask ? "font-semibold text-warning" : "font-normal text-muted"
                            )}
                        >
                            {it.count}
                        </span>
                    ) : undefined,
                }))}
            />
        </PixelFrame>
    );
}

/** The HUD bar inside the office's view: the office's clock and energy, then the Cockpit's filters and switches. */
export function OfficeHudBar({ children }: { children: ReactNode }) {
    return (
        <PixelFrame
            data-office-hud=""
            className="pointer-events-auto shadow-popover-sm"
            innerClassName="flex h-[42px] min-w-0 items-center gap-3.5 pl-4 pr-2.5 text-[12px] text-muted"
        >
            {children}
        </PixelFrame>
    );
}
