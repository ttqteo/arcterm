// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// A stretch of the agent's tool calls in Chat (the A-floating board): the "Worked for 38s · 5 tools" line, and under it, while
// the stretch is the one running now or was opened by a click, one compact step line per call: an icon, a verb and a chip for
// each thing it touched (chatsteps.ts). A click on a line opens that call's output or diff below it. The lines open and fold on
// the spring (springReveal), so a stretch that ends folds into its one line instead of vanishing. The detail body is
// narrationtimeline.tsx's (ToolDetailBody), shared with the live feed; the rows around it are Chat's own.
// Named chatstepsview, not chatsteps: chatsteps.ts holds the pure model, and `./chatsteps` resolves to the .ts first.

import { FileIcon } from "@/app/element/fileicon";
import { springReveal } from "@/app/element/motiontokens";
import { modalsModel } from "@/app/store/modalmodel";
import { cn } from "@/util/util";
import {
    ArrowUpRight,
    Ban,
    Bot,
    ChevronDown,
    ChevronRight,
    CircleHelp,
    Eye,
    FilePlus,
    FolderSearch,
    Globe,
    Pencil,
    Search,
    Sparkles,
    Terminal,
    Wrench,
    type LucideIcon,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState, type KeyboardEvent } from "react";
import { burstRenderMode, detailExceedsInline, type AgentActionEntry } from "./agentsviewmodel";
import { stepElapsed, stepOf, type StepChip, type StepIcon } from "./chatsteps";
import { inFlight, stretchMs, toolCountLabel, workedFor, workingFor, type WorkItem } from "./compacttimeline";
import { ToolDetailBody, useNow } from "./narrationtimeline";
import { PathLink } from "./pathlinkcontext";
import { formatDuration } from "./tooldetail";

const ICONS: Record<StepIcon, LucideIcon> = {
    read: Eye,
    edit: Pencil,
    write: FilePlus,
    run: Terminal,
    search: Search,
    find: FolderSearch,
    web: Globe,
    spawn: Bot,
    skill: Sparkles,
    ask: CircleHelp,
    blocked: Ban,
    tool: Wrench,
};

function baseName(path: string): string {
    return path.split(/[\\/]/).pop() || path;
}

function FoldCaret({ open }: { open: boolean }) {
    const Icon = open ? ChevronDown : ChevronRight;
    return <Icon size={11} strokeWidth={2.2} aria-hidden className="shrink-0" />;
}

// a call with no result in a working session: a dashed ring that turns, in the colour of a run that is going well
function StepSpinner() {
    return (
        <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray="2 3"
            aria-hidden
            className="animate-spin text-success motion-reduce:animate-none"
        >
            <circle cx="12" cy="12" r="9" />
        </svg>
    );
}

const CHIP = "min-w-0 truncate rounded-[6px] px-2 py-[2px] text-[12px] text-ink-mid";
const CHIP_FRAME = "border border-edge-mid bg-surface";

// a path with a folder in it can be opened beside the agent; a bare name (the target of a call whose transcript gave no full
// path) cannot be told from a file in some other folder, so it is not a link
const hasFolder = (path: string) => /[\\/]/.test(path);

function Chip({ chip }: { chip: StepChip }) {
    if (chip.kind === "command") {
        return (
            <span
                data-chat-step-chip="command"
                title={chip.text}
                className="min-w-0 max-w-[420px] truncate rounded-[6px] bg-surface-code px-2 py-[2px] font-mono text-[11.5px] text-ink-mid"
            >
                {chip.text}
            </span>
        );
    }
    if (chip.kind === "text") {
        return (
            <span data-chat-step-chip="text" title={chip.text} className={cn(CHIP, CHIP_FRAME, "max-w-[260px]")}>
                {chip.text}
            </span>
        );
    }
    const name = baseName(chip.path);
    return (
        <span
            data-chat-step-chip="file"
            title={chip.path}
            className={cn(CHIP, CHIP_FRAME, "inline-flex max-w-[260px] items-center gap-1.5")}
        >
            <FileIcon path={chip.path} size={14} />
            {hasFolder(chip.path) ? (
                <PathLink path={chip.path} className="max-w-full">
                    {name}
                </PathLink>
            ) : (
                <span className="min-w-0 truncate">{name}</span>
            )}
        </span>
    );
}

// the exit code under a command's output, in the panel footer so it never scrolls away with the output
function ExitMark({ exit }: { exit: number | null }) {
    return (
        <span
            className={cn(
                "rounded-[4px] px-[7px] py-px text-[10.5px] font-semibold uppercase tabular-nums tracking-[0.06em]",
                exit == null
                    ? "bg-surface-hover text-muted"
                    : exit
                      ? "bg-error/15 text-error"
                      : "bg-success/15 text-success"
            )}
        >
            {exit == null ? "not run" : `exit ${exit}`}
        </span>
    );
}

function StepDetail({ action }: { action: AgentActionEntry }) {
    const detail = action.detail;
    if (detail == null) {
        return null;
    }
    const long = detailExceedsInline(detail);
    return (
        <motion.div
            data-tool-panel
            variants={springReveal}
            initial="initial"
            animate="animate"
            exit="exit"
            // 28px = the line's 6px padding + the 14px icon + the 8px gap before the verb: the panel sits under the verb
            className="mb-1.5 ml-[28px] mt-1 overflow-hidden rounded-[8px] border border-edge-mid bg-surface-code"
        >
            <div className={cn(long ? "max-h-[320px]" : "max-h-[200px]", "overflow-auto")}>
                <ToolDetailBody detail={detail} variant="inline" />
            </div>
            <div className="flex items-center gap-2 border-t border-edge-faint px-1.5 py-[3px]">
                {detail.kind === "bash" ? <ExitMark exit={detail.exit} /> : null}
                <div className="flex-1" />
                <button
                    type="button"
                    aria-label="Open full view"
                    onClick={() => modalsModel.pushModal("AgentToolDetailModal", { action })}
                    className="inline-flex cursor-pointer items-center gap-1.5 rounded-[5px] px-1.5 py-[3px] text-[10.5px] text-ink-mid hover:bg-lane hover:text-primary"
                >
                    <ArrowUpRight size={12} strokeWidth={2.2} aria-hidden />
                    Open full view
                </button>
            </div>
        </motion.div>
    );
}

// one tool call: `live` is the session working (a call with no result is running); a call a stopped session left without a
// result is neither running nor passed (ToolLine's neutral), `data-tool-settled`
function StepLine({
    action,
    live,
    now,
    open,
    onToggle,
}: {
    action: AgentActionEntry;
    live: boolean;
    now: number;
    open: boolean;
    onToggle: () => void;
}) {
    const step = stepOf(action, live);
    const neutral = !step.running && !live && action.outcome == null;
    const failed = action.outcome === "fail";
    const blocked = action.outcome === "blocked";
    const detail = action.detail;
    const Icon = ICONS[step.icon];
    const toggle = () => {
        // a drag that selected the line's text ends in a click too: it copies, it does not open the line
        const sel = window.getSelection();
        if (detail != null && (sel == null || sel.isCollapsed)) {
            onToggle();
        }
    };
    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        if (detail != null && e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            onToggle();
        }
    };
    return (
        <div>
            <div
                data-chat-step
                data-chat-step-running={step.running ? "" : undefined}
                data-tool-running={step.running ? "" : undefined}
                data-tool-settled={neutral ? "" : undefined}
                data-tool-blocked={blocked ? "" : undefined}
                role={detail != null ? "button" : undefined}
                tabIndex={detail != null ? 0 : undefined}
                aria-expanded={detail != null ? open : undefined}
                onClick={toggle}
                onKeyDown={onKeyDown}
                className={cn(
                    "flex min-w-0 items-center gap-2 rounded-[6px] px-1.5 py-[3px] text-[13px]",
                    detail != null && "cursor-pointer hover:bg-surface-hover"
                )}
            >
                <span
                    className={cn(
                        "flex h-[14px] w-[14px] shrink-0 items-center justify-center",
                        failed ? "text-error" : "text-muted"
                    )}
                >
                    {step.running ? <StepSpinner /> : <Icon size={14} strokeWidth={1.8} aria-hidden />}
                </span>
                <span className={cn("shrink-0", failed ? "text-error" : "text-secondary")}>{step.verb}</span>
                {step.chips.map((chip, i) => (
                    <Chip key={i} chip={chip} />
                ))}
                {step.more > 0 ? (
                    <span data-chat-step-more className="shrink-0 text-[12px] tabular-nums text-muted">
                        +{step.more}
                    </span>
                ) : null}
                {action.summary ? (
                    <span className={cn("shrink-0 text-[12px] tabular-nums", failed ? "text-error" : "text-muted")}>
                        {action.summary}
                    </span>
                ) : null}
                <div className="min-w-[6px] flex-1" />
                {step.running && action.startedAt != null ? (
                    <span className="shrink-0 text-[12px] tabular-nums text-muted">
                        {stepElapsed(now - action.startedAt)}
                    </span>
                ) : action.durationMs && !blocked ? (
                    <span className="shrink-0 text-[10.5px] tabular-nums text-muted">
                        {formatDuration(action.durationMs)}
                    </span>
                ) : null}
                {detail != null ? (
                    <span className="flex shrink-0 text-muted">
                        {open ? (
                            <ChevronDown size={12} strokeWidth={2.2} aria-hidden />
                        ) : (
                            <ChevronRight size={12} strokeWidth={2.2} aria-hidden />
                        )}
                    </span>
                ) : null}
            </div>
            <AnimatePresence initial={false}>
                {detail != null && open ? <StepDetail key="detail" action={action} /> : null}
            </AnimatePresence>
        </div>
    );
}

// the lines of an open stretch. Its own component, so the lines opened are forgotten when the stretch folds, and the lines
// the agent adds while it works open on the spring as they land (the ones there when it opens are drawn at once)
function StepList({ work, live, now }: { work: WorkItem; live: boolean; now: number }) {
    const [opened, setOpened] = useState<Set<number>>(new Set());
    const toggle = (index: number) =>
        setOpened((prev) => {
            const next = new Set(prev);
            if (!next.delete(index)) {
                next.add(index);
            }
            return next;
        });
    return (
        <AnimatePresence initial={false}>
            {work.actions.map((action, k) => {
                const index = work.startIndex + k;
                return (
                    <motion.div
                        key={index}
                        variants={springReveal}
                        initial="initial"
                        animate="animate"
                        className="overflow-hidden"
                    >
                        <StepLine
                            action={action}
                            live={live}
                            now={now}
                            open={opened.has(index)}
                            onToggle={() => toggle(index)}
                        />
                    </motion.div>
                );
            })}
        </AnimatePresence>
    );
}

// "› Worked for 38s · 5 tools": a stretch of tools as one plain line between the agent's paragraphs, opening to its step
// lines. A live session's last stretch is open while the agent works (burstRenderMode), and folds on the spring into this
// line once the agent moves on; a click opens it again.
export function ChatSteps({
    work,
    open,
    closed,
    autoOpen,
    live,
    onToggle,
}: {
    work: WorkItem;
    open: boolean;
    // the user folded it while it was the auto-open one
    closed: boolean;
    autoOpen: boolean;
    // the session is working: a tool with no result is running, and the stretch counts up to now
    live: boolean;
    onToggle: () => void;
}) {
    const shown = burstRenderMode({ userOpened: open, autoOpen, userClosed: closed }) !== "collapsed";
    const running = work.actions.some((a) => inFlight(a, live));
    const now = useNow(running);
    return (
        <div data-chat-work className="flex flex-col">
            <button
                type="button"
                data-fold
                aria-expanded={shown}
                onClick={onToggle}
                className="flex cursor-pointer items-center gap-[6px] self-start py-[2px] text-[12px] text-muted hover:text-secondary"
            >
                <FoldCaret open={shown} />
                <span>
                    {running ? workingFor(stretchMs(work, now, live)) : workedFor(work.durationMs)} ·{" "}
                    {toolCountLabel(work.actions.length)}
                </span>
                {work.failed > 0 ? <span className="tabular-nums text-error">· {work.failed} failed</span> : null}
            </button>
            <AnimatePresence initial={false}>
                {shown ? (
                    <motion.div
                        key="steps"
                        data-chat-tools
                        variants={springReveal}
                        initial="initial"
                        animate="animate"
                        exit="exit"
                        className="overflow-hidden pt-1"
                    >
                        <StepList work={work} live={live} now={now} />
                    </motion.div>
                ) : null}
            </AnimatePresence>
        </div>
    );
}
