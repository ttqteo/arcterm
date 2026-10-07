// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { ContextMenuModel } from "@/app/store/contextmenu";
import { modalsModel } from "@/app/store/modalmodel";
import { FAINT_TEXT } from "@/app/view/jarvis/briefstyle";
import { cn } from "@/util/util";
import { ArrowUpRight, Ban, Check, ChevronDown, ChevronRight, ChevronUp, Copy, Layers, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { MOTION, composerReveal, shouldFadeEntry } from "@/app/element/motiontokens";
import { Fragment, useMemo, useRef, useState } from "react";
import {
    burstRenderMode,
    conversationText,
    detailExceedsInline,
    formatTokens,
    groupTimeline,
    summarizeActions,
    type ActionDetail,
    type AgentActionEntry,
    type AgentEntry,
    type EditFile,
} from "./agentsviewmodel";
import { MarkdownMessage } from "./markdownmessage";
import { PathLink } from "./pathlinkcontext";
import { PinnedPromptBar, usePinnedPrompt } from "./pinnedpromptbar";
import { highlightLine } from "./highlight";
import { formatDuration } from "./tooldetail";

// Handoff lane feed (Wave-cockpit-live.dc.html:211-247). message -> narration row
// (accent avatar + prose); user -> right-aligned bubble; action -> tool line
// (outcome chip + tool + summary + note). Bursts of >= CollapseRunThreshold
// consecutive actions fold into one summary line (groupTimeline) that expands on
// click; while `active`, the trailing run stays expanded. tool_result content is
// never present. Per-tool timestamps are omitted (not in AgentEntry).

// inline panels wrap long lines so a narrow card never scrolls sideways; the modal has room, so it keeps them unwrapped
function lineWrap(variant: "inline" | "modal"): string {
    return variant === "inline" ? "whitespace-pre-wrap [overflow-wrap:anywhere]" : "whitespace-pre";
}

function ExitChip({ exit }: { exit: number }) {
    return (
        <span
            className={cn(
                "rounded-[4px] px-[7px] py-px text-[10.5px] font-semibold uppercase tabular-nums tracking-[0.06em]",
                exit ? "bg-error/15 text-error" : "bg-success/15 text-success"
            )}
        >
            exit {exit}
        </span>
    );
}

function StatusSquare({ ok }: { ok: boolean }) {
    return (
        <span
            className={cn(
                "flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px]",
                ok ? "bg-success/15 text-success" : "bg-error/15 text-error"
            )}
        >
            {ok ? <Check size={10} strokeWidth={3} aria-hidden /> : <X size={10} strokeWidth={3} aria-hidden />}
        </span>
    );
}

function Affordance({ toModal, open }: { toModal: boolean; open: boolean }) {
    const Icon = toModal ? ArrowUpRight : open ? ChevronDown : ChevronRight;
    return (
        <span className="flex shrink-0 text-muted">
            <Icon size={12} strokeWidth={2.2} aria-hidden />
        </span>
    );
}

const TOOL_ROW = "flex items-center gap-2 rounded-[6px] px-1.5 py-[3px]";
const VERB = "min-w-[50px] shrink-0 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted";
const TARGET = "min-w-0 truncate text-[11.5px] text-ink-mid";
// 30px = the row's 6px padding + the 16px status square + the 8px gap, so the panel sits under the target
const DETAIL_PANEL = "mb-1.5 ml-[30px] mt-1 overflow-hidden rounded-[8px] border border-edge-mid bg-surface-code";

// Shared per-kind detail renderer. Used inline (capped by max-height) and by the modal (uncapped).
// Tokens only — no raw hex. See Wave-transcript-feed.dc.html.
export function ToolDetailBody({ detail, variant }: { detail: ActionDetail; variant: "inline" | "modal" }) {
    const modal = variant === "modal";
    const pad = modal ? "px-4 py-3" : "px-[11px] py-[9px]";
    const wrap = lineWrap(variant);
    if (detail.kind === "grep") {
        return (
            <div className={pad}>
                {detail.matches.map((g, i) => (
                    <div key={i} className="flex gap-2.5 whitespace-pre font-mono text-[11.5px] leading-[1.65]">
                        <span className="shrink-0 text-muted">{g.loc}</span>
                        <span className="min-w-0 flex-1 truncate text-secondary">{g.code}</span>
                    </div>
                ))}
                {detail.more ? <div className={cn("pt-1.5", FAINT_TEXT)}>{detail.more}</div> : null}
            </div>
        );
    }
    if (detail.kind === "read") {
        // syntax-highlight the file body with the feed's lightweight tokenizer (same one CodeBlock uses).
        // Kept off shiki deliberately — the feed is on the cockpit boot path.
        return (
            <div className={cn(pad, modal && "overflow-x-auto")}>
                <div className={cn("font-mono text-[11.5px] leading-[1.7]", modal && "min-w-min")}>
                    {detail.snippet.split("\n").map((ln, i) => (
                        <div key={i} className={wrap}>
                            {highlightLine(ln).map((tk, k) => (
                                <span key={k} className={tk.cls}>
                                    {tk.t}
                                </span>
                            ))}
                        </div>
                    ))}
                </div>
            </div>
        );
    }
    if (detail.kind === "bash") {
        return (
            <div>
                {detail.command ? (
                    <div
                        className={cn(
                            "flex gap-2 whitespace-pre-wrap font-mono text-[11.5px] leading-[1.6] text-secondary [overflow-wrap:anywhere]",
                            pad
                        )}
                    >
                        <span className="shrink-0 select-none text-accent">$</span>
                        <span>{detail.command}</span>
                    </div>
                ) : null}
                {detail.output ? (
                    <pre
                        className={cn(
                            "m-0 font-mono text-[11.5px] leading-[1.7]",
                            wrap,
                            modal && "overflow-x-auto",
                            detail.command && "border-t border-edge-faint",
                            pad,
                            detail.exit ? "text-error" : "text-ink-mid"
                        )}
                    >
                        {detail.output}
                    </pre>
                ) : null}
                {/* inline, the exit chip sits in the panel footer (ToolLine) so it never scrolls away */}
                {modal ? (
                    <div className="flex items-center gap-2 px-[13px] pb-[9px]">
                        <ExitChip exit={detail.exit} />
                    </div>
                ) : null}
            </div>
        );
    }
    if (detail.kind === "skill") {
        return (
            <div className={pad}>
                <div className="flex items-center gap-2 text-[11.5px]">
                    <span className="text-syntax-keyword">skill</span>
                    <span className="text-primary">{detail.name}</span>
                </div>
                {detail.args ? (
                    <pre className="mt-1.5 overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11.5px] leading-[1.6] text-secondary">
                        {detail.args}
                    </pre>
                ) : null}
            </div>
        );
    }
    // edit
    return (
        <div className="flex flex-col">
            {detail.files.map((f, i) => (
                <div key={i} className="border-b border-lane last:border-b-0">
                    <div className="flex items-center gap-2.5 bg-surface px-[11px] py-[7px]">
                        <span
                            className={cn(
                                "flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] text-[10.5px] font-bold",
                                f.badge === "A" ? "bg-success/15 text-success" : "bg-warning/15 text-warning"
                            )}
                        >
                            {f.badge}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink-hi">{f.path}</span>
                        <span className="text-[10.5px] font-bold tabular-nums text-diff-added">+{f.adds}</span>
                        <span className="text-[10.5px] font-bold tabular-nums text-diff-removed">−{f.dels}</span>
                    </div>
                    <div className={cn("bg-surface-code py-1", modal && "overflow-x-auto")}>
                        <div className={modal ? "min-w-min" : undefined}>
                            {f.lines.map((l, k) => (
                                <div
                                    key={k}
                                    className={cn(
                                        "flex font-mono text-[11.5px] leading-[1.7]",
                                        wrap,
                                        l.sign === "+"
                                            ? "bg-diff-added/[0.09]"
                                            : l.sign === "-"
                                              ? "bg-diff-removed/[0.09]"
                                              : ""
                                    )}
                                >
                                    {/* the sign column stays put, so a wrapped line hangs under its own text */}
                                    <span
                                        className={cn(
                                            "w-[13px] shrink-0 text-center",
                                            l.sign === "+"
                                                ? "text-diff-added"
                                                : l.sign === "-"
                                                  ? "text-diff-removed"
                                                  : "text-ink-faint"
                                        )}
                                    >
                                        {l.sign}
                                    </span>
                                    <span
                                        className={cn(
                                            "min-w-0 pr-3.5",
                                            l.sign === "+"
                                                ? "text-diff-added"
                                                : l.sign === "-"
                                                  ? "text-diff-removed"
                                                  : "text-secondary"
                                        )}
                                    >
                                        {l.text}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
}

// A single tool action row. Clickable when it carries detail: short detail expands inline, detail
// past the per-kind budget opens the viewport modal. The bare-line look is preserved when detail
// is absent (e.g. Codex actions, or Claude tools with no captured body).
export function ToolLine({ action }: { action: AgentActionEntry }) {
    const [open, setOpen] = useState(false);
    const ok = action.outcome !== "fail";
    const detail = action.detail;
    const toModal = detail ? detailExceedsInline(detail) : false;
    const onClick = () => {
        if (!detail) {
            return;
        }
        if (toModal) {
            modalsModel.pushModal("AgentToolDetailModal", { action });
        } else {
            setOpen((v) => !v);
        }
    };
    return (
        <div>
            <div onClick={onClick} className={cn(TOOL_ROW, detail && "cursor-pointer hover:bg-surface-hover")}>
                <StatusSquare ok={ok} />
                <span className={VERB}>{action.verb}</span>
                {action.path != null ? (
                    <PathLink path={action.path} className={TARGET}>
                        {action.target}
                    </PathLink>
                ) : (
                    <span className={cn(TARGET, detail?.kind === "bash" && "font-mono")}>{action.target}</span>
                )}
                {action.summary ? (
                    <span className={cn("shrink-0 text-[10.5px] tabular-nums", ok ? "text-muted" : "text-error")}>
                        {action.summary}
                    </span>
                ) : null}
                <div className="min-w-[6px] flex-1" />
                {action.durationMs ? (
                    <span className={cn("shrink-0", FAINT_TEXT)}>{formatDuration(action.durationMs)}</span>
                ) : null}
                {detail ? <Affordance toModal={toModal} open={open} /> : null}
            </div>
            <AnimatePresence initial={false}>
                {detail && open && !toModal ? (
                    <motion.div
                        key="detail"
                        data-tool-panel
                        variants={composerReveal}
                        initial="initial"
                        animate="animate"
                        exit="exit"
                        className={DETAIL_PANEL}
                    >
                        <div className="max-h-[200px] overflow-auto">
                            <ToolDetailBody detail={detail} variant="inline" />
                        </div>
                        <div className="flex items-center gap-2 border-t border-edge-faint px-1.5 py-[3px]">
                            {detail.kind === "bash" ? <ExitChip exit={detail.exit} /> : null}
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
                ) : null}
            </AnimatePresence>
        </div>
    );
}

// A folded run of consecutive edits (Wave-transcript-feed.dc.html burst). Summary row: "N files
// +adds −dels"; expands inline when the combined diff fits the edit budget, else opens the modal.
export function CommandChip({ name, args, isSkill }: { name: string; args?: string; isSkill?: boolean }) {
    return (
        <div className="mt-2 flex justify-end">
            <span
                className={cn(
                    "inline-flex max-w-[88%] flex-wrap items-baseline rounded-lg border px-[11px] py-[5px]",
                    isSkill ? "border-skill/35 bg-skill/[0.08]" : "border-accent/35 bg-accent/[0.07]"
                )}
            >
                {isSkill ? <span className="mr-[7px] self-center text-[11px] text-skill">✦</span> : null}
                <span className={cn("text-[12px] font-semibold", isSkill ? "text-skill-soft" : "text-accent-soft")}>{name}</span>
                {args ? (
                    <span className={cn("ml-2 border-l pl-2 text-[12px] text-feed-summary", isSkill ? "border-skill/25" : "border-accent/25")}>
                        {args}
                    </span>
                ) : null}
            </span>
        </div>
    );
}

export function CompactionDivider({
    trigger,
    preTokens,
    postTokens,
    summary,
}: {
    trigger?: string;
    preTokens?: number;
    postTokens?: number;
    summary?: string;
}) {
    const [open, setOpen] = useState(false);
    const stat = preTokens != null && postTokens != null ? `${formatTokens(preTokens)} → ${formatTokens(postTokens)} tokens` : null;
    const canExpand = !!summary;
    return (
        <div className="mt-3.5">
            <button type="button" disabled={!canExpand} onClick={() => setOpen((v) => !v)} className={cn("flex w-full items-center gap-2.5", canExpand ? "cursor-pointer" : "cursor-default")}>
                <span className="h-px flex-1 bg-edge-mid" />
                <span className="inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-accent/30 bg-accent/[0.07] px-2.5 py-0.5 text-[10.5px] tabular-nums leading-[1.6]">
                    <span className="font-semibold uppercase tracking-[0.1em] text-accent-soft">Compacted</span>
                    {stat ? (
                        <>
                            <span className="text-ink-faint">·</span>
                            <span className="text-ink-mid">{stat}</span>
                        </>
                    ) : null}
                    {trigger ? (
                        <>
                            <span className="text-ink-faint">·</span>
                            <span className="text-muted">{trigger}</span>
                        </>
                    ) : null}
                    {canExpand ? (
                        <span className="flex text-muted">
                            {open ? (
                                <ChevronUp size={10} strokeWidth={2.4} aria-hidden />
                            ) : (
                                <ChevronDown size={10} strokeWidth={2.4} aria-hidden />
                            )}
                        </span>
                    ) : null}
                </span>
                <span className="h-px flex-1 bg-edge-mid" />
            </button>
            <AnimatePresence initial={false}>
                {open && summary ? (
                    <motion.div
                        key="sum"
                        variants={composerReveal}
                        initial="initial"
                        animate="animate"
                        exit="exit"
                        className="my-2 overflow-hidden rounded-[8px] border border-edge-mid bg-surface-code px-3.5 py-3"
                    >
                        <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted">
                            Summary — kept context
                        </div>
                        <MarkdownMessage text={summary} />
                    </motion.div>
                ) : null}
            </AnimatePresence>
        </div>
    );
}
function EditBurstRow({ files, adds, dels }: { files: EditFile[]; adds: number; dels: number }) {
    const [open, setOpen] = useState(false);
    const detail = { kind: "edit" as const, files };
    const toModal = detailExceedsInline(detail);
    const action = {
        kind: "action" as const,
        verb: "edited",
        target: `${files.length} file${files.length === 1 ? "" : "s"}`,
        detail,
    };
    const onClick = () => (toModal ? modalsModel.pushModal("AgentToolDetailModal", { action }) : setOpen((v) => !v));
    return (
        <div>
            <div onClick={onClick} className={cn(TOOL_ROW, "cursor-pointer hover:bg-surface-hover")}>
                <StatusSquare ok />
                <span className={VERB}>edited</span>
                <span className={TARGET}>{action.target}</span>
                <span className="shrink-0 text-[10.5px] tabular-nums text-diff-added">+{adds}</span>
                <span className="shrink-0 text-[10.5px] tabular-nums text-diff-removed">−{dels}</span>
                <div className="min-w-[6px] flex-1" />
                <Affordance toModal={toModal} open={open} />
            </div>
            <AnimatePresence initial={false}>
                {open && !toModal ? (
                    <motion.div
                        key="detail"
                        data-tool-panel
                        variants={composerReveal}
                        initial="initial"
                        animate="animate"
                        exit="exit"
                        className={DETAIL_PANEL}
                    >
                        <ToolDetailBody detail={detail} variant="inline" />
                    </motion.div>
                ) : null}
            </AnimatePresence>
        </div>
    );
}

// The human interrupted the agent mid-turn. A thin centered marker, not a You bubble.
export function InterruptedDivider() {
    return (
        <div className="mt-3 flex items-center gap-2.5">
            <span className="h-px flex-1 bg-edge-mid" />
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-edge-strong bg-surface px-2.5 py-0.5 text-[10.5px] font-semibold uppercase leading-[1.6] tracking-[0.1em] text-ink-mid">
                <Ban size={10} strokeWidth={2.4} aria-hidden />
                Interrupted
            </span>
            <span className="h-px flex-1 bg-edge-mid" />
        </div>
    );
}

// A finished background Task/subagent (<task-notification>). Collapsed: a "Task" chip + summary +
// status pill; expands to the child's full result via MarkdownMessage (result can be large).
export function TaskNotificationRow({ summary, status, result }: { summary: string; status?: string; result?: string }) {
    const [open, setOpen] = useState(false);
    const canExpand = !!result;
    const ok = status == null || status === "completed";
    return (
        <div className="mt-2 flex gap-2.5">
            <span
                className={cn(
                    "mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] border text-[12px]",
                    ok ? "border-success/30 bg-success/[0.12] text-success" : "border-warning/30 bg-warning/[0.12] text-warning"
                )}
            >
                ⑃
            </span>
            <div className="min-w-0 flex-1">
                <button
                    type="button"
                    disabled={!canExpand}
                    onClick={() => setOpen((v) => !v)}
                    className={cn(
                        "flex w-full items-center gap-2 rounded-[8px] border border-edge-mid bg-surface px-2.5 py-1.5 text-left",
                        canExpand ? "cursor-pointer hover:border-edge-strong" : "cursor-default"
                    )}
                >
                    <span className="shrink-0 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-ink-mid">
                        Task
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-secondary">{summary || "Subagent finished"}</span>
                    {status ? (
                        <span
                            className={cn(
                                "shrink-0 rounded-[4px] px-1.5 py-px text-[10.5px] font-semibold uppercase tracking-[0.06em]",
                                ok ? "bg-success/15 text-success" : "bg-warning/15 text-warning"
                            )}
                        >
                            {status}
                        </span>
                    ) : null}
                    {canExpand ? (
                        <span className="flex shrink-0 text-muted">
                            {open ? (
                                <ChevronDown size={12} strokeWidth={2.2} aria-hidden />
                            ) : (
                                <ChevronRight size={12} strokeWidth={2.2} aria-hidden />
                            )}
                        </span>
                    ) : null}
                </button>
                <AnimatePresence initial={false}>
                    {open && result ? (
                        <motion.div
                            key="res"
                            variants={composerReveal}
                            initial="initial"
                            animate="animate"
                            exit="exit"
                            className="mt-1.5 overflow-hidden rounded-[8px] border border-edge-mid bg-surface-code px-3.5 py-3"
                        >
                            <MarkdownMessage text={result} />
                        </motion.div>
                    ) : null}
                </AnimatePresence>
            </div>
        </div>
    );
}

// grouped items kept in the DOM; card is stick-to-bottom so off-screen history is safe to drop
const TIMELINE_RENDER_CAP = 200;

export function NarrationTimeline({
    entries,
    accentLatest,
    active,
    pinBg,
    className,
}: {
    entries: AgentEntry[];
    accentLatest?: boolean;
    active?: boolean;
    // the scroller's background: given, your prompt pins to the top once it scrolls away (pinnedpromptbar.tsx)
    pinBg?: string;
    className?: string;
}) {
    const [expanded, setExpanded] = useState<Set<number>>(new Set());
    const items = useMemo(() => groupTimeline(entries), [entries]);
    const visibleItems = items.length > TIMELINE_RENDER_CAP ? items.slice(items.length - TIMELINE_RENDER_CAP) : items;
    const rootRef = useRef<HTMLDivElement>(null);
    const pinned = usePinnedPrompt(rootRef);
    const prompts = visibleItems.flatMap((item) => (item.kind === "user" ? [item.text] : []));
    const copyMenu = (text: string) => (e: React.MouseEvent) =>
        ContextMenuModel.getInstance().showContextMenu(
            [
                { label: "Copy text", icon: <Copy size={15} />, click: () => void navigator.clipboard.writeText(text) },
                { label: "Copy conversation", icon: <Copy size={15} />, click: () => void navigator.clipboard.writeText(conversationText(entries)) },
            ],
            e
        );

    let lastMessageIdx = -1;
    if (accentLatest) {
        for (let i = entries.length - 1; i >= 0; i--) {
            if (entries[i].kind === "message") {
                lastMessageIdx = i;
                break;
            }
        }
    }

    const expand = (startIndex: number) => setExpanded((prev) => new Set(prev).add(startIndex));

    return (
        <div ref={rootRef} className={cn("leading-relaxed", className)}>
            {pinBg ? <PinnedPromptBar rootRef={rootRef} index={pinned} text={prompts[pinned]} bg={pinBg} /> : null}
            <AnimatePresence initial={false}>
            {visibleItems.map((item, idx) => {
                if (item.kind === "message") {
                    return (
                        <motion.div
                            key={item.index}
                            className="mt-2 flex gap-2.5"
                            onContextMenu={copyMenu(item.text)}
                            initial={shouldFadeEntry("message") ? { opacity: 0 } : false}
                            animate={{ opacity: 1 }}
                            transition={{ duration: MOTION.durMicro, ease: MOTION.easeFluid }}
                        >
                            <span className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border border-accent/30 bg-accent/[0.13]">
                                <span className="h-[7px] w-[7px] rounded-full bg-accent-soft" />
                            </span>
                            <div
                                className={cn(
                                    "min-w-0 flex-1 text-[13px] leading-[1.55]",
                                    item.index === lastMessageIdx ? "text-primary" : "text-secondary"
                                )}
                            >
                                <MarkdownMessage text={item.text} />
                            </div>
                        </motion.div>
                    );
                }
                if (item.kind === "user") {
                    return (
                        <motion.div
                            key={item.index}
                            data-user-prompt
                            className="mt-2 flex justify-end pl-[30px]"
                            onContextMenu={copyMenu(item.text)}
                            initial={shouldFadeEntry("user") ? { opacity: 0 } : false}
                            animate={{ opacity: 1 }}
                            transition={{ duration: MOTION.durMicro, ease: MOTION.easeFluid }}
                        >
                            <div className="max-w-[90%] rounded-[11px_11px_4px_11px] border border-accent/25 bg-accent/10 px-2.5 py-1.5">
                                <div className="mb-0.5 text-[10.5px] font-bold uppercase tracking-[0.1em] text-accent-soft">
                                    You
                                </div>
                                <p className="text-[13px] leading-[1.5] text-primary">{item.text}</p>
                            </div>
                        </motion.div>
                    );
                }
                if (item.kind === "command") {
                    return (
                        <motion.div
                            key={item.index}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ duration: MOTION.durMicro, ease: MOTION.easeFluid }}
                        >
                            <CommandChip name={item.name} args={item.args} isSkill={item.isSkill} />
                        </motion.div>
                    );
                }
                if (item.kind === "compaction") {
                    return (
                        <motion.div
                            key={item.index}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ duration: MOTION.durMicro, ease: MOTION.easeFluid }}
                        >
                            <CompactionDivider trigger={item.trigger} preTokens={item.preTokens} postTokens={item.postTokens} summary={item.summary} />
                        </motion.div>
                    );
                }
                if (item.kind === "notification") {
                    return (
                        <motion.div
                            key={item.index}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ duration: MOTION.durMicro, ease: MOTION.easeFluid }}
                        >
                            <TaskNotificationRow summary={item.summary} status={item.status} result={item.result} />
                        </motion.div>
                    );
                }
                if (item.kind === "interrupted") {
                    return (
                        <motion.div
                            key={item.index}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ duration: MOTION.durMicro, ease: MOTION.easeFluid }}
                        >
                            <InterruptedDivider />
                        </motion.div>
                    );
                }
                if (item.kind === "action") {
                    return <ToolLine key={item.index} action={item.action} />;
                }
                if (item.kind === "edit-burst") {
                    return <EditBurstRow key={"eb" + item.startIndex} files={item.files} adds={item.adds} dels={item.dels} />;
                }
                const isTrailing = idx === visibleItems.length - 1;
                const mode = burstRenderMode({ userOpened: expanded.has(item.startIndex), autoOpen: !!active && isTrailing });
                if (mode !== "collapsed") {
                    const lines = item.actions.map((action, k) => (
                        <ToolLine key={item.startIndex + k} action={action} />
                    ));
                    // "reveal" (user expanded a historical burst) grows open; "open" (auto-open trailing
                    // burst during streaming) renders plain so the live run never strobes.
                    return mode === "reveal" ? (
                        <motion.div
                            key={"g" + item.startIndex}
                            variants={composerReveal}
                            initial="initial"
                            animate="animate"
                            className="overflow-hidden"
                        >
                            {lines}
                        </motion.div>
                    ) : (
                        <Fragment key={"g" + item.startIndex}>{lines}</Fragment>
                    );
                }
                const summary = summarizeActions(item.actions);
                return (
                    <button
                        key={"g" + item.startIndex}
                        type="button"
                        data-fold
                        onClick={() => expand(item.startIndex)}
                        className="my-1 flex w-full cursor-pointer items-center gap-2 rounded-[6px] border border-edge-mid px-[5px] py-[3px] text-left tabular-nums hover:bg-surface-hover"
                    >
                        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] bg-accent/[0.12] text-accent-soft">
                            <Layers size={11} strokeWidth={2.2} aria-hidden />
                        </span>
                        <span className="shrink-0 text-[11.5px] font-semibold text-secondary">{summary.total} tools</span>
                        <span className="min-w-0 truncate text-[10.5px] text-ink-mid">
                            {summary.byVerb.map((v) => `${v.count} ${v.verb}`).join(" · ")}
                        </span>
                        <div className="min-w-[6px] flex-1" />
                        {/* the word carries the outcome, so colour is never the only signal */}
                        {summary.failed > 0 ? (
                            <span className="inline-flex shrink-0 items-center gap-1 text-[10.5px] text-error">
                                <X size={10} strokeWidth={3} aria-hidden />
                                {summary.failed} failed
                            </span>
                        ) : (
                            <span className="inline-flex shrink-0 items-center gap-1 text-[10.5px] text-muted">
                                <Check size={10} strokeWidth={3} aria-hidden />
                                all ok
                            </span>
                        )}
                        <span className="flex shrink-0 text-muted">
                            <ChevronRight size={12} strokeWidth={2.2} aria-hidden />
                        </span>
                    </button>
                );
            })}
            </AnimatePresence>
        </div>
    );
}

