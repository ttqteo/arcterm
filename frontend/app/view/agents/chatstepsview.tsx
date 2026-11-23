// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// A stretch of the agent's tool calls in Chat, as Claude Desktop draws it: the "Edited server.js, ran 2 commands +5 −2 ·
// 38s ›" line (chatstepsummary.ts), and under it, once a click opened it (running or not), one
// bordered box with a row per call (chatsteps.ts): a muted verb, what it touched in bright plain text, a muted meta and
// its +N, then a chevron. A command row is its description alone (or its command's first line, in mono) and opens to
// `$ command` and its output; any other row opens to its output or diff (ToolDetailBody, shared with the live feed); a file
// name opens the file beside the agent. A run of calls with the same verb on the same file is one row that opens to its
// calls, indented, in the same box. The rows open and fold on the spring (springReveal). Design:
// .superpowers/design/chat-compact-work/project (Main, States, Calm).
// Named chatstepsview, not chatsteps: chatsteps.ts holds the pure model, and `./chatsteps` resolves to the .ts first.

import { ImageZoom } from "@/app/element/imagezoom";
import { springReveal } from "@/app/element/motiontokens";
import { modalsModel } from "@/app/store/modalmodel";
import { useLocalImage } from "@/app/view/jarvis/localimage";
import { cn } from "@/util/util";
import { ArrowUpRight, ChevronDown, ChevronRight, ChevronUp, ImageOff } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { detailExceedsInline, type AgentActionEntry } from "./agentsviewmodel";
import { editCounts, foldOf, pictureOf, stepOf, stepRows, stretchPictures, type StepChip } from "./chatsteps";
import { stepSummary, stretchTime } from "./chatstepsummary";
import { CommandOutput, outputAsCode, ShellCommand } from "./commandtext";
import { stretchMs, type WorkItem } from "./compacttimeline";
import { PromptImages, ToolDetailBody, useNow } from "./narrationtimeline";
import { PathLink } from "./pathlinkcontext";
import { PINNED_PROMPT_HEIGHT_VAR } from "./pinnedpromptbar";

function baseName(path: string): string {
    return path.split(/[\\/]/).pop() || path;
}

// `›` folded, `˅` open, after the line or the row it opens
function Chevron({ open, size }: { open: boolean; size: number }) {
    const Icon = open ? ChevronDown : ChevronRight;
    return <Icon size={size} strokeWidth={2} aria-hidden className="shrink-0" />;
}

// a call with no result in a working session, in the colour around it: a dashed ring whose dashes run round it. The ring
// stays still and only the dash offset moves (tailwindsetup.css dashRun): spinning the svg itself wobbled off its centre at
// fractional display scaling. pathLength 60 makes the 2 + 3 dash pattern close exactly, 12 dashes with no short one where
// the ring's ends meet.
function Spinner({ size }: { size: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden className="shrink-0">
            <circle
                cx="12"
                cy="12"
                r="9"
                pathLength={60}
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeDasharray="2 3"
                className="animate-[dashRun_1s_linear_infinite] motion-reduce:animate-none"
            />
        </svg>
    );
}

// a path with a folder in it can be opened beside the agent; a bare name (the target of a call whose transcript gave no full
// path) cannot be told from a file in some other folder, so it is not a link
const hasFolder = (path: string) => /[\\/]/.test(path);

// what a row names, as plain text: a file's name (a link to it, bright, underlined on hover), a command's description, a
// command's first line in mono, or any other target
function Target({ chip }: { chip: StepChip }) {
    if (chip.kind === "description") {
        return (
            // the tooltip is the description, never the command: a long script made a native tooltip a screen tall over
            // the conversation; the row opens to `$ command`
            <span data-chat-step-chip="description" title={chip.text} className="min-w-0 truncate text-secondary">
                {chip.text}
            </span>
        );
    }
    if (chip.kind === "command") {
        return (
            <span
                data-chat-step-chip="command"
                title={chip.text}
                className="min-w-0 truncate font-mono text-[12px] text-secondary"
            >
                {chip.text}
            </span>
        );
    }
    if (chip.kind === "text") {
        return (
            <span data-chat-step-chip="text" title={chip.text} className="min-w-0 truncate text-primary">
                {chip.text}
            </span>
        );
    }
    const name = baseName(chip.path);
    return (
        <span data-chat-step-chip="file" title={chip.path} className="flex min-w-0 text-primary">
            {hasFolder(chip.path) ? (
                <PathLink path={chip.path} className="max-w-full hover:text-primary">
                    {name}
                </PathLink>
            ) : (
                <span className="min-w-0 truncate">{name}</span>
            )}
        </span>
    );
}

// the lines an edit added and removed: +N in the add colour, −N only when something was removed
function Counts({ edits, ...data }: { edits: { adds: number; dels: number } | null | undefined }) {
    if (edits == null) {
        return null;
    }
    return (
        <span {...data} className="inline-flex shrink-0 gap-1 tabular-nums">
            <span className="text-success">+{edits.adds}</span>
            {edits.dels > 0 ? <span className="text-error">−{edits.dels}</span> : null}
        </span>
    );
}

function Meta({ text }: { text: string | undefined }) {
    return text ? (
        <span title={text} className="min-w-0 truncate text-muted">
            · {text}
        </span>
    ) : null;
}

// a command's exit code at its row's end, when it did not pass: a command row has no verb to turn red
function ExitMark({ exit }: { exit: number | null }) {
    return (
        <span
            data-chat-step-exit
            className={cn(
                "shrink-0 rounded-[4px] px-[7px] py-px text-[10.5px] font-semibold uppercase tabular-nums tracking-[0.06em]",
                exit == null ? "bg-surface-hover text-muted" : "bg-error/15 text-error"
            )}
        >
            {exit == null ? "not run" : `exit ${exit}`}
        </span>
    );
}

// an opened row's foot: Open full view, and Collapse, which folds the row from its end, so a tall output needs no scroll
// back up to its header to close it
function OpenedFoot({ action, onCollapse }: { action: AgentActionEntry; onCollapse: () => void }) {
    const btn = "inline-flex cursor-pointer items-center gap-1 text-[11px] text-muted hover:text-secondary";
    return (
        <div className="flex items-center gap-3">
            <button
                type="button"
                aria-label="Open full view"
                onClick={() => modalsModel.pushModal("AgentToolDetailModal", { action })}
                className={btn}
            >
                <ArrowUpRight size={12} strokeWidth={2.2} aria-hidden />
                Open full view
            </button>
            <button type="button" data-chat-step-collapse onClick={onCollapse} className={btn}>
                <ChevronUp size={12} strokeWidth={2.2} aria-hidden />
                Collapse
            </button>
        </div>
    );
}

// what an opened row shows under it, inside the box
function Opened({ children }: { children: ReactNode }) {
    return (
        <motion.div
            data-tool-panel
            variants={springReveal}
            initial="initial"
            animate="animate"
            exit="exit"
            className="overflow-hidden"
        >
            <div className="flex flex-col gap-2 px-3 pb-3">{children}</div>
        </motion.div>
    );
}

// an opened command: `$ command` in a code block, then its output in a box that scrolls, both in colour (commandtext.tsx)
function CommandDetail({
    action,
    command,
    onCollapse,
}: {
    action: AgentActionEntry;
    command: string;
    onCollapse: () => void;
}) {
    const output = action.detail?.kind === "bash" ? action.detail.output : "";
    return (
        <Opened>
            <div
                data-chat-step-command
                className="max-h-[240px] overflow-auto whitespace-pre-wrap rounded-[6px] bg-surface-code px-3 py-2 font-mono text-[12px] text-primary [overflow-wrap:anywhere]"
            >
                <span className="select-none text-muted">$ </span>
                <ShellCommand command={command} />
            </div>
            {output !== "" ? (
                <pre
                    data-chat-step-output
                    data-chat-step-output-code={outputAsCode(command, output) || undefined}
                    className="m-0 max-h-[320px] overflow-auto whitespace-pre-wrap px-3 py-1 font-mono text-[12px] leading-[1.6] text-secondary [overflow-wrap:anywhere]"
                >
                    <CommandOutput command={command} output={output} />
                </pre>
            ) : null}
            <OpenedFoot action={action} onCollapse={onCollapse} />
        </Opened>
    );
}

// an opened read, edit, search…: its output or diff in a code panel
function StepDetail({
    action,
    detail,
    onCollapse,
}: {
    action: AgentActionEntry;
    detail: NonNullable<AgentActionEntry["detail"]>;
    onCollapse: () => void;
}) {
    return (
        <Opened>
            <div
                className={cn(
                    detailExceedsInline(detail) ? "max-h-[320px]" : "max-h-[200px]",
                    "overflow-auto rounded-[6px] bg-surface-code"
                )}
            >
                <ToolDetailBody detail={detail} variant="inline" />
            </div>
            <OpenedFoot action={action} onCollapse={onCollapse} />
        </Opened>
    );
}

// a folded line shows at most this many of the pictures its stretch read
const MAX_LINE_PICTURES = 3;

// a picture the agent read, as a small framed thumbnail at the end of its row or its stretch's folded line (as Claude
// Desktop draws one); an empty frame while it loads, a crossed-out picture once the file is gone. A click on a loaded one
// opens the picture full size over Chat at once (ImageZoom), without opening the line or the row it sits on.
function PictureThumb({ path }: { path: string }) {
    const img = useLocalImage(path);
    const [zoomed, setZoomed] = useState(false);
    const frame = "h-[22px] w-[34px] shrink-0 overflow-hidden rounded-[4px] border border-edge-mid bg-surface";
    if (img.url != null) {
        return (
            <>
                <button
                    type="button"
                    data-chat-step-thumb-open
                    aria-label={`Open ${baseName(path)}`}
                    title={path}
                    onClick={(e) => {
                        e.stopPropagation();
                        setZoomed(true);
                    }}
                    onKeyDown={(e) => e.stopPropagation()}
                    className="flex shrink-0 cursor-zoom-in rounded-[4px]"
                >
                    <img data-chat-step-thumb src={img.url} alt="" className={cn(frame, "object-cover")} />
                </button>
                <ImageZoom
                    image={zoomed ? { src: img.url, alt: baseName(path) } : null}
                    onClose={() => setZoomed(false)}
                />
            </>
        );
    }
    return (
        <span
            data-chat-step-thumb={img.status === "loading" ? "loading" : "gone"}
            title={img.status === "loading" ? path : `${path} · no longer on disk`}
            className={cn(frame, "flex items-center justify-center text-muted")}
        >
            {img.status === "loading" ? null : <ImageOff size={11} aria-hidden />}
        </span>
    );
}

// an opened picture read: the picture itself, a click zooming it to its full width (PromptImages, as your bubble's)
function PictureDetail({ path }: { path: string }) {
    return (
        <Opened>
            <div data-chat-step-picture>
                <PromptImages paths={[path]} />
            </div>
        </Opened>
    );
}

const ROW = "flex min-w-0 items-center gap-2 px-3 py-[9px] text-[13px]";

// a click on a row opens it, a drag that selected its text does not (it ends in a click too: it copies); Enter and Space
// open it from the keyboard
function rowHandlers(enabled: boolean, onToggle: () => void) {
    return {
        onClick: () => {
            const sel = window.getSelection();
            if (enabled && (sel == null || sel.isCollapsed)) {
                onToggle();
            }
        },
        onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => {
            if (enabled && e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
                e.preventDefault();
                onToggle();
            }
        },
    };
}

// one tool call: `live` is the session working (a call with no result is running); a call a stopped session left without a
// result is neither running nor passed, `data-tool-settled`
function StepRow({
    action,
    live,
    open,
    onToggle,
    bare,
}: {
    action: AgentActionEntry;
    live: boolean;
    open: boolean;
    onToggle: () => void;
    // a call under a folded row, which already names its file: indented, no target
    bare?: boolean;
}) {
    const step = stepOf(action, live);
    const detail = action.detail;
    const neutral = !step.running && !live && action.outcome == null;
    const blocked = action.outcome === "blocked";
    const exit = detail?.kind === "bash" ? detail.exit : 0;
    // the command line an opened command row shows: the detail's once the result lands, else what its row was built from
    const head = step.chips[0];
    const command = head?.kind === "description" ? head.command : head?.kind === "command" ? head.text : undefined;
    // a picture it read opens to the picture: its result holds no text, so it has no detail to open
    const picture = step.running ? null : pictureOf(action);
    const opens = detail != null || picture != null;
    const rowRef = useRef<HTMLDivElement>(null);
    // a row folded while its header is stuck (from the header or the foot's Collapse) has its own place above the screen:
    // the reader is brought back to it, under the pinned prompt (scroll-margin-top), instead of to what came after it
    const toggle = () => {
        const row = rowRef.current;
        const box = row?.parentElement;
        const stuck =
            open && row != null && box != null && row.getBoundingClientRect().top - box.getBoundingClientRect().top > 1;
        onToggle();
        if (stuck) {
            requestAnimationFrame(() => rowRef.current?.scrollIntoView({ block: "start" }));
        }
    };
    return (
        <div>
            <div
                ref={rowRef}
                data-chat-step
                data-chat-step-running={step.running ? "" : undefined}
                data-tool-running={step.running ? "" : undefined}
                data-tool-settled={neutral ? "" : undefined}
                data-tool-blocked={blocked ? "" : undefined}
                role={opens ? "button" : undefined}
                tabIndex={opens ? 0 : undefined}
                aria-expanded={opens ? open : undefined}
                {...rowHandlers(opens, toggle)}
                className={cn(
                    ROW,
                    bare && "pl-9",
                    opens && "cursor-pointer hover:bg-surface",
                    // opened, the row sticks to the top of Chat while its output scrolls past, so a click folds it from
                    // anywhere in it; below the pinned prompt as a code block's head does (codeblock.tsx), which is why
                    // every box around it clips with overflow-clip, never -hidden (that would make it the scroller)
                    open && "sticky z-[5] bg-background"
                )}
                style={{
                    top: open ? `var(${PINNED_PROMPT_HEIGHT_VAR}, 0px)` : undefined,
                    scrollMarginTop: `var(${PINNED_PROMPT_HEIGHT_VAR}, 0px)`,
                }}
            >
                {step.verb !== "" ? (
                    <span data-chat-step-verb className={cn("shrink-0", step.failed ? "text-error" : "text-muted")}>
                        {step.verb}
                    </span>
                ) : null}
                {bare ? null : step.chips.map((chip, i) => <Target key={i} chip={chip} />)}
                {!bare && step.more > 0 ? (
                    <span data-chat-step-more className="shrink-0 tabular-nums text-muted">
                        +{step.more}
                    </span>
                ) : null}
                <Meta text={step.meta} />
                {step.failed ? null : <Counts edits={editCounts(action)} data-chat-step-diff="" />}
                {step.command && (blocked || exit !== 0) ? <ExitMark exit={exit} /> : null}
                {step.running ? (
                    <span className="flex text-muted">
                        <Spinner size={12} />
                    </span>
                ) : opens ? (
                    <span className="flex text-muted">
                        <Chevron open={open} size={12} />
                    </span>
                ) : null}
                {picture != null ? (
                    <span className="ml-auto flex pl-2">
                        <PictureThumb path={picture} />
                    </span>
                ) : null}
            </div>
            <AnimatePresence initial={false}>
                {picture != null && open ? (
                    <PictureDetail key="picture" path={picture} />
                ) : detail != null && open ? (
                    step.command && command != null ? (
                        <CommandDetail
                            key="detail"
                            action={action}
                            command={(detail.kind === "bash" ? detail.command : undefined) ?? command}
                            onCollapse={toggle}
                        />
                    ) : (
                        <StepDetail key="detail" action={action} detail={detail} onCollapse={toggle} />
                    )
                ) : null}
            </AnimatePresence>
        </div>
    );
}

// a run of calls with the same verb on the same file as one row, "Edited rail.tsx ×4 +1 −24" (chatsteps.ts stepRows); a
// click opens its calls under it, indented, in the same box, each still opening its own output. Running while its last
// call is.
function FoldRow({
    actions,
    start,
    live,
    open,
    onToggle,
    opened,
    onToggleCall,
}: {
    actions: AgentActionEntry[];
    start: number; // the entry index of the run's first call
    live: boolean;
    open: boolean;
    onToggle: () => void;
    opened: Set<number>;
    onToggleCall: (index: number) => void;
}) {
    const fold = foldOf(actions, live);
    const step = fold.step;
    const neutral = !step.running && !live && actions.every((a) => a.outcome == null);
    return (
        <div>
            <div
                data-chat-step
                data-chat-step-fold={fold.count}
                data-chat-step-running={step.running ? "" : undefined}
                data-tool-running={step.running ? "" : undefined}
                data-tool-settled={neutral ? "" : undefined}
                role="button"
                tabIndex={0}
                aria-expanded={open}
                {...rowHandlers(true, onToggle)}
                className={cn(ROW, "cursor-pointer hover:bg-surface")}
            >
                <span data-chat-step-verb className="shrink-0 text-muted">
                    {step.verb}
                </span>
                {step.chips.map((chip, i) => (
                    <Target key={i} chip={chip} />
                ))}
                <span data-chat-step-count className="shrink-0 tabular-nums text-muted">
                    ×{fold.count}
                </span>
                <Meta text={fold.summary} />
                <Counts edits={fold.edits} data-chat-step-diff="" />
                <span className="flex text-muted">
                    {step.running ? <Spinner size={12} /> : <Chevron open={open} size={12} />}
                </span>
            </div>
            <AnimatePresence initial={false}>
                {open ? (
                    <motion.div
                        key="calls"
                        data-chat-step-calls
                        variants={springReveal}
                        initial="initial"
                        animate="animate"
                        exit="exit"
                        className="overflow-clip"
                    >
                        {actions.map((action, k) => (
                            <div key={start + k} className="border-t border-border">
                                <StepRow
                                    action={action}
                                    live={live}
                                    open={opened.has(start + k)}
                                    onToggle={() => onToggleCall(start + k)}
                                    bare
                                />
                            </div>
                        ))}
                    </motion.div>
                ) : null}
            </AnimatePresence>
        </div>
    );
}

function toggled(prev: Set<number>, index: number): Set<number> {
    const next = new Set(prev);
    if (!next.delete(index)) {
        next.add(index);
    }
    return next;
}

// the rows of an open stretch, divided by hairlines. Its own component, so the rows opened are forgotten when the stretch
// folds, and the rows the agent adds while it works open on the spring as they land (the ones there when it opens are drawn
// at once). A run of calls on one file is one FoldRow, keyed by its first call, so a call joining the run grows its count
// in place.
function StepList({ work, live }: { work: WorkItem; live: boolean }) {
    const [opened, setOpened] = useState<Set<number>>(new Set());
    const [folds, setFolds] = useState<Set<number>>(new Set());
    const toggle = (index: number) => setOpened((prev) => toggled(prev, index));
    return (
        <AnimatePresence initial={false}>
            {stepRows(work.actions).map((row, i) => {
                const index = work.startIndex + row.start;
                return (
                    <motion.div
                        key={index}
                        variants={springReveal}
                        initial="initial"
                        animate="animate"
                        className={cn("overflow-clip", i > 0 && "border-t border-border")}
                    >
                        {row.actions.length === 1 ? (
                            <StepRow
                                action={row.actions[0]}
                                live={live}
                                open={opened.has(index)}
                                onToggle={() => toggle(index)}
                            />
                        ) : (
                            <FoldRow
                                actions={row.actions}
                                start={index}
                                live={live}
                                open={folds.has(index)}
                                onToggle={() => setFolds((prev) => toggled(prev, index))}
                                opened={opened}
                                onToggleCall={toggle}
                            />
                        )}
                    </motion.div>
                );
            })}
        </AnimatePresence>
    );
}

// "Edited server.js, ran 2 commands +5 −2 · 38s ›": a stretch of tools as one muted line between the agent's paragraphs,
// opening to its box of rows on a click; "◌ Run the told tests +2 · 12s ›" while a call in it is in flight. A running
// stretch stays folded too (Calm.dc.html): its line already names what runs, and a box growing under the paragraphs read
// as noise. A finished stretch's line shows its time from 10 s up (stretchTime).
// A stretch of one call that can no longer grow is its box alone, the row already open: its line said what the row says
// ("Check shared registration files…" over "Check shared registration files… ›"). The stretch still growing keeps its
// line, so a second call landing does not turn a box back into a line.
export function ChatSteps({
    work,
    open,
    live,
    growing,
    onToggle,
}: {
    work: WorkItem;
    // the person opened it
    open: boolean;
    // the session is working: a tool with no result is running, and the stretch counts up to now
    live: boolean;
    // the last part of the turn being written: another call may still join it
    growing: boolean;
    onToggle: () => void;
}) {
    const shown = open;
    const summary = stepSummary(work.actions, live);
    const running = summary.running;
    const now = useNow(running);
    if (work.actions.length === 1 && !growing) {
        return (
            <div data-chat-work data-chat-work-single className="flex flex-col">
                <div data-chat-tools className="overflow-clip rounded-[10px] border border-edge-mid">
                    <StepList work={work} live={live} />
                </div>
            </div>
        );
    }
    const time = stretchTime(running ? stretchMs(work, now, live) : work.durationMs, running);
    // the pictures it read, on its folded line: opened, each sits on its own row instead
    const pictures = shown ? [] : stretchPictures(work.actions, MAX_LINE_PICTURES);
    return (
        <div data-chat-work className="flex flex-col">
            {/* the thumbnails sit beside the line's button, not in it: each is a button of its own that opens its picture */}
            <div className="flex min-w-0 max-w-full items-center self-start">
                <button
                    type="button"
                    data-fold
                    aria-expanded={shown}
                    onClick={onToggle}
                    data-fold-state={running ? "running" : "done"}
                    className={cn(
                        "flex min-w-0 max-w-full cursor-pointer items-center gap-1.5 py-[2px] text-[13.5px] hover:text-secondary",
                        running ? "text-secondary" : "text-muted"
                    )}
                >
                    {running ? <Spinner size={13} /> : null}
                    {/* only the sentence truncates: the counts and the time stay in view. No failed call is in the sentence
                    and no red is on this line: a tool that fails mid-turn is mostly the agent's own probe (a grep with no
                    hit, a missing tool) that it gets past. A failed call keeps its red on its own row, once opened. */}
                    <span data-fold-sentence className="min-w-0 truncate">
                        {summary.text}
                    </span>
                    {running && summary.more > 0 ? (
                        <span data-fold-more className="shrink-0 tabular-nums text-muted">
                            +{summary.more}
                        </span>
                    ) : null}
                    {running ? null : <Counts edits={summary.edits} data-fold-counts="" />}
                    {time !== "" ? (
                        <span data-fold-time className="shrink-0 text-[12px] tabular-nums text-muted">
                            · {time}
                        </span>
                    ) : null}
                    <span className="flex text-muted">
                        <Chevron open={shown} size={13} />
                    </span>
                </button>
                {pictures.length > 0 ? (
                    <span data-fold-thumbs className="ml-3 flex shrink-0 gap-1">
                        {pictures.map((path) => (
                            <PictureThumb key={path} path={path} />
                        ))}
                    </span>
                ) : null}
            </div>
            <AnimatePresence initial={false}>
                {shown ? (
                    <motion.div
                        key="steps"
                        data-chat-tools
                        variants={springReveal}
                        initial="initial"
                        animate="animate"
                        exit="exit"
                        className="overflow-clip"
                    >
                        <div className="mt-2 overflow-clip rounded-[10px] border border-edge-mid">
                            <StepList work={work} live={live} />
                        </div>
                    </motion.div>
                ) : null}
            </AnimatePresence>
        </div>
    );
}
