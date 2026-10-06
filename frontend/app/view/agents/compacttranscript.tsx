// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// An old transcript read compactly, the way Antigravity shows a past conversation: your message in a box, the agent's
// prose as plain text, one "Worked for 24s" line for everything it did between two pieces of prose, and an
// "N files changed +a −d" bar for what that stretch edited. The grouping is compacttimeline.ts; the pieces that
// are the same as the live feed's (a tool line, a command chip, a compaction marker) are narrationtimeline.tsx's.

import { ContextMenuModel } from "@/app/store/contextmenu";
import { composerReveal } from "@/app/element/motiontokens";
import { cn } from "@/util/util";
import { ChevronDown, ChevronRight, Copy } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { Fragment, useMemo, useState } from "react";
import { burstRenderMode, conversationText, type AgentEntry, type EditFile } from "./agentsviewmodel";
import {
    filesChangedLabel,
    groupCompact,
    toolCountLabel,
    userNeedsClamp,
    workedFor,
    type WorkItem,
} from "./compacttimeline";
import { MarkdownMessage } from "./markdownmessage";
import {
    CommandChip,
    CompactionDivider,
    InterruptedDivider,
    TaskNotificationRow,
    ToolDetailBody,
    ToolLine,
} from "./narrationtimeline";

// items kept in the DOM; an older transcript past this drops its oldest items, as the live feed does
const RENDER_CAP = 200;

function Caret({ open }: { open: boolean }) {
    const Icon = open ? ChevronDown : ChevronRight;
    return <Icon size={12} strokeWidth={2.2} aria-hidden className="shrink-0" />;
}

// your message: a box, no label, long ones clamped
function UserMessage({ text, onContextMenu }: { text: string; onContextMenu: (e: React.MouseEvent) => void }) {
    const clamp = userNeedsClamp(text);
    const [open, setOpen] = useState(false);
    return (
        <div
            data-compact-user
            onContextMenu={onContextMenu}
            className="mt-4 rounded-[8px] border border-edge-faint bg-surface-raised px-3 py-2"
        >
            <p
                className={cn(
                    "whitespace-pre-wrap text-[13px] leading-[1.55] text-primary [overflow-wrap:anywhere]",
                    // six lines, as USER_CLAMP_LINES in compacttimeline.ts says (Tailwind needs the literal class)
                    clamp && !open && "line-clamp-6"
                )}
            >
                {text}
            </p>
            {clamp ? (
                <button
                    type="button"
                    onClick={() => setOpen((v) => !v)}
                    className="mt-1 cursor-pointer text-[11.5px] text-muted hover:text-secondary"
                >
                    {open ? "Show less" : "Show more"}
                </button>
            ) : null}
        </div>
    );
}

// "Worked for 24s ›": everything the agent did between two pieces of prose, folded; opens to its tool lines
function WorkLine({
    work,
    open,
    autoOpen,
    onToggle,
}: {
    work: WorkItem;
    open: boolean;
    autoOpen: boolean;
    onToggle: () => void;
}) {
    const mode = burstRenderMode({ userOpened: open, autoOpen });
    const shown = mode !== "collapsed";
    const lines = work.actions.map((action, k) => <ToolLine key={work.startIndex + k} action={action} />);
    return (
        <div className="mt-2">
            <button
                type="button"
                data-fold
                aria-expanded={shown}
                onClick={onToggle}
                className="flex cursor-pointer items-center gap-1 rounded-[6px] px-1 py-[3px] text-[12.5px] text-muted hover:text-secondary"
            >
                {workedFor(work.durationMs)}
                <Caret open={shown} />
                <span className="ml-1 text-[11px] tabular-nums text-ink-faint">{toolCountLabel(work.actions.length)}</span>
                {work.failed > 0 ? (
                    <span className="ml-1 text-[11px] tabular-nums text-error">{work.failed} failed</span>
                ) : null}
            </button>
            {/* "reveal" (opened by hand) grows in; "open" (the trailing run of a live session) renders plain so it never strobes */}
            {mode === "reveal" ? (
                <motion.div variants={composerReveal} initial="initial" animate="animate" className="overflow-hidden">
                    {lines}
                </motion.div>
            ) : mode === "open" ? (
                <Fragment>{lines}</Fragment>
            ) : null}
        </div>
    );
}

// "1 file changed +647 −6 ›": what a stretch of work edited, opening to the diff
function FilesChangedBar({ files, adds, dels }: { files: EditFile[]; adds: number; dels: number }) {
    const [open, setOpen] = useState(false);
    return (
        <div data-compact-files className="mt-2 overflow-hidden rounded-[8px] border border-edge-mid bg-surface">
            <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpen((v) => !v)}
                className="flex w-full cursor-pointer items-center gap-2 px-3 py-[7px] text-left text-[12.5px] hover:bg-surface-hover"
            >
                <span className="text-secondary">{filesChangedLabel(files.length)}</span>
                <span className="font-semibold tabular-nums text-diff-added">+{adds}</span>
                <span className="font-semibold tabular-nums text-diff-removed">−{dels}</span>
                <span className="ml-auto flex text-muted">
                    <Caret open={open} />
                </span>
            </button>
            <AnimatePresence initial={false}>
                {open ? (
                    <motion.div
                        key="diff"
                        variants={composerReveal}
                        initial="initial"
                        animate="animate"
                        exit="exit"
                        className="overflow-hidden border-t border-edge-faint bg-surface-code"
                    >
                        <div className="max-h-[360px] overflow-auto">
                            <ToolDetailBody detail={{ kind: "edit", files }} variant="inline" />
                        </div>
                    </motion.div>
                ) : null}
            </AnimatePresence>
        </div>
    );
}

export function CompactTranscript({
    entries,
    active,
    className,
}: {
    entries: AgentEntry[];
    active?: boolean;
    className?: string;
}) {
    const [opened, setOpened] = useState<Set<number>>(new Set());
    const items = useMemo(() => groupCompact(entries), [entries]);
    const visible = items.length > RENDER_CAP ? items.slice(items.length - RENDER_CAP) : items;
    const copyMenu = (text: string) => (e: React.MouseEvent) =>
        ContextMenuModel.getInstance().showContextMenu(
            [
                { label: "Copy text", icon: <Copy size={15} />, click: () => void navigator.clipboard.writeText(text) },
                {
                    label: "Copy conversation",
                    icon: <Copy size={15} />,
                    click: () => void navigator.clipboard.writeText(conversationText(entries)),
                },
            ],
            e
        );
    const toggle = (startIndex: number) =>
        setOpened((prev) => {
            const next = new Set(prev);
            if (!next.delete(startIndex)) {
                next.add(startIndex);
            }
            return next;
        });

    return (
        <div data-compact-transcript className={cn("mx-auto w-full max-w-[760px] pb-2 leading-relaxed", className)}>
            {visible.map((item, idx) => {
                switch (item.kind) {
                    case "user":
                        return <UserMessage key={item.index} text={item.text} onContextMenu={copyMenu(item.text)} />;
                    case "message":
                        return (
                            <div
                                key={item.index}
                                onContextMenu={copyMenu(item.text)}
                                className="mt-3 text-[13px] leading-[1.6] text-secondary"
                            >
                                <MarkdownMessage text={item.text} />
                            </div>
                        );
                    case "work":
                        return (
                            <Fragment key={"w" + item.startIndex}>
                                <WorkLine
                                    work={item}
                                    open={opened.has(item.startIndex)}
                                    autoOpen={!!active && idx === visible.length - 1}
                                    onToggle={() => toggle(item.startIndex)}
                                />
                                {item.files.length > 0 ? (
                                    <FilesChangedBar files={item.files} adds={item.adds} dels={item.dels} />
                                ) : null}
                            </Fragment>
                        );
                    case "command":
                        return <CommandChip key={item.index} name={item.name} args={item.args} isSkill={item.isSkill} />;
                    case "compaction":
                        return (
                            <CompactionDivider
                                key={item.index}
                                trigger={item.trigger}
                                preTokens={item.preTokens}
                                postTokens={item.postTokens}
                                summary={item.summary}
                            />
                        );
                    case "notification":
                        return (
                            <TaskNotificationRow
                                key={item.index}
                                summary={item.summary}
                                status={item.status}
                                result={item.result}
                            />
                        );
                    case "interrupted":
                        return <InterruptedDivider key={item.index} />;
                }
            })}
        </div>
    );
}
