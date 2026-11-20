// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The rail's Verify tile and the header's Verify chip (spec 2026-11-20-rail-verify-design.md). Every sentence, order and
// tone is verifymodel.ts's; this draws them, and does the two things a row asks: send the agent its rerun line (a prompt,
// or the wake of a sleeping agent, with no Chat record: Chat draws the message like any the person sent) and Skip / Undo.
//
// The tile is drawn like the session block (a raised tile, its own heading), not as a folded section: it cannot scroll out
// of sight under the lists. It is open while anything is red or amber; when every row passed it folds to one line
// (`Verify · 3 passed`) that opens it. What the person opened lives in a per-agent atom, because the Overview tab unmounts
// when another tab shows, and a tile that forgot its open rows on every tab switch would be a tile to fight.
//
// Test hooks: [data-verify-tile] (the section; data-verify-folded on its head while it is folded), [data-verify-head],
// [data-verify-warning] (data-verify-kind outofdate|notrun), [data-verify-row=<scenario>][data-verify-state=<state>] with
// [data-verify-open] (aria-expanded), [data-verify-note], [data-verify-shots], and the buttons [data-verify-rerun],
// [data-verify-skip], [data-verify-undo], valued with the scenario (`notrun` on the warning line), [data-verify-error],
// and the header's [data-verify-chip].

import { microFade, springReveal } from "@/app/element/motiontokens";
import { usePartMotion } from "@/app/element/springbatch";
import { globalStore } from "@/app/store/jotaiStore";
import { joinRepoPath } from "@/util/paths";
import { cn, fireAndForget } from "@/util/util";
import { atom, useAtom, useAtomValue, type PrimitiveAtom } from "jotai";
import { atomFamily } from "jotai/utils";
import {
    ChevronDown,
    ChevronRight,
    ExternalLink,
    Monitor,
    MonitorCheck,
    MonitorX,
    TriangleAlert,
    X,
    type LucideIcon,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { Fragment, useEffect, useRef, useState } from "react";
import type { RailVerifyStrip } from "./agentrailsections";
import { openFileInPanel } from "./agentrailstore";
import type { AgentsViewModel } from "./agents";
import type { AgentVM } from "./agentsviewmodel";
import { sendAgentLine } from "./chatverdictsend";
import { openRailSection } from "./railsection";
import { railCwdsAtom } from "./railstore";
import { rerunLine, verifyTile, type VerifyRowVM, type VerifyTileVM, type VerifyTone } from "./verifymodel";
import { skipVerify, useVerify } from "./verifystore";

const TONE_TEXT: Record<VerifyTone, string> = {
    red: "text-error",
    amber: "text-warning",
    green: "text-success",
    muted: "text-muted",
};

const TONE_DOT: Record<VerifyTone, string> = {
    red: "bg-error",
    amber: "bg-warning",
    green: "bg-success",
    muted: "bg-muted",
};

const FOCUS = "outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent";

// the secondary button (DESIGN.md), and the text button beside it
const BTN = cn(
    "h-[24px] flex-none cursor-pointer rounded-[6px] border border-edge-mid bg-surface-raised px-[9px] text-[11px] text-secondary hover:border-edge-strong hover:bg-surface-hover disabled:cursor-default disabled:opacity-60",
    FOCUS
);
const TEXT_BTN = cn(
    "h-[24px] flex-none cursor-pointer rounded-[6px] px-[9px] text-[11px] text-muted hover:bg-surface-hover hover:text-secondary",
    FOCUS
);

// ---- the agent's state, read for the tile, the strip and the chip -------------------------------------------------------

/** The agent's Verify state against its checkout. The rail's own cwd for the agent, or its roster cwd while the rail has not
 *  resolved one: the tile, the chip and the strip all read through this, so they share one block's atom and one read. */
export function useAgentVerify(agent: AgentVM, enabled: boolean): { st: VerifyStateData | null; cwd: string } {
    const cwd = useAtomValue(railCwdsAtom)[agent.id] ?? agent.cwd ?? "";
    const st = useVerify(enabled ? agent.blockId : undefined, cwd === "" ? undefined : cwd);
    return { st, cwd };
}

// ---- what the person opened ---------------------------------------------------------------------------------------------

interface VerifyUi {
    opened: boolean; // a folded tile the person opened
    rows: Record<string, boolean>; // a row the person opened or closed, against its default (a failed row starts open)
}

const verifyUiAtom = atomFamily(
    (_blockId: string) => atom<VerifyUi>({ opened: false, rows: {} }) as PrimitiveAtom<VerifyUi>
);

// the agents whose tile has been drawn once: the reveal plays for the first, not for a remount
const appeared = new Set<string>();

/** Opens a folded tile (the strip count and the chip bring the tile into view, and a folded one would show nothing). */
export function openVerifyTile(blockId: string): void {
    globalStore.set(verifyUiAtom(blockId), (u) => (u.opened ? u : { ...u, opened: true }));
}

// ---- glyphs ----------------------------------------------------------------------------------------------------------------

/** The strip's monitor: struck for a failure, checked once everything passed, plain otherwise. */
export function verifyStripIcon(s: RailVerifyStrip): LucideIcon {
    if (s.struck) {
        return MonitorX;
    }
    return s.tone === "muted" && s.label !== "" ? MonitorCheck : Monitor;
}

/** The strip count's tone as classes on top of the strip's muted default: red and amber only, as green is only a pulse. */
export function verifyStripTone(s: RailVerifyStrip): string {
    return s.tone === "red"
        ? "text-error hover:text-error"
        : s.tone === "amber"
          ? "text-warning hover:text-warning"
          : "";
}

// ---- the tile ----------------------------------------------------------------------------------------------------------------

export function VerifyTile({
    model,
    agent,
    tile,
    st,
    cwd,
}: {
    model: AgentsViewModel;
    agent: AgentVM;
    tile: VerifyTileVM;
    st: VerifyStateData;
    cwd: string;
}) {
    const blockId = agent.blockId ?? "";
    const [ui, setUi] = useAtom(verifyUiAtom(blockId));
    const part = usePartMotion(springReveal);
    // the tile reveals the first time this agent has one, not each time the Overview tab mounts it again
    const first = useRef(!appeared.has(blockId)).current;
    useEffect(() => {
        appeared.add(blockId);
    }, [blockId]);
    // one send at a time (`busy` is the key it is for); a send that failed says so under its buttons; a send that went
    // reads "Sent" for a moment, which the Chat it lands in may not be showing
    const [busy, setBusy] = useState<string | null>(null);
    const [sent, setSent] = useState<string | null>(null);
    const [errors, setErrors] = useState<Record<string, string>>({});
    const sentTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    useEffect(() => () => clearTimeout(sentTimer.current), []);
    // once something is red or amber the tile is open of itself; the person's opening is for a folded one, and it is
    // forgotten then, so the tile folds again when the next run passes
    useEffect(() => {
        if (!tile.folded && ui.opened) {
            setUi((u) => ({ ...u, opened: false }));
        }
    }, [tile.folded, ui.opened, setUi]);

    if (!tile.shown) {
        return null;
    }
    const expanded = !tile.folded || ui.opened;
    const rowOpen = (row: VerifyRowVM): boolean => ui.rows[row.key] ?? row.startsOpen;
    const toggleRow = (row: VerifyRowVM) =>
        setUi((u) => ({ ...u, rows: { ...u.rows, [row.key]: !(u.rows[row.key] ?? row.startsOpen) } }));

    const rerun = (key: string, line: string) => {
        if (busy != null) {
            return;
        }
        setBusy(key);
        setErrors(({ [key]: _gone, ...rest }) => rest);
        sendAgentLine(agent, line).then(
            () => {
                setBusy(null);
                setSent(key);
                clearTimeout(sentTimer.current);
                sentTimer.current = setTimeout(() => setSent(null), 2200);
            },
            (e: unknown) => {
                setBusy(null);
                setErrors((prev) => ({ ...prev, [key]: e instanceof Error ? e.message : String(e) }));
            }
        );
    };
    const skip = (scenario: string, undo: boolean) => fireAndForget(() => skipVerify(blockId, cwd, scenario, undo));
    // the contact sheet the run wrote beside its screenshots, opened in the rail's File tab like any file the agent made
    const openShots = (dir: string) =>
        openFileInPanel(model, agent.id, { abs: joinRepoPath(dir, "index.html"), root: null, reread: Date.now() });

    const rerunButton = (key: string, line: string) => (
        <button
            type="button"
            data-verify-rerun={key}
            disabled={busy != null}
            aria-busy={busy === key}
            onClick={() => rerun(key, line)}
            className={BTN}
        >
            {sent === key ? "Sent" : "Ask the agent to rerun"}
        </button>
    );
    const errorLine = (key: string) =>
        errors[key] != null ? (
            <div data-verify-error role="alert" className="text-[11px] leading-[1.45] text-error">
                {errors[key]}
            </div>
        ) : null;

    const Glyph = tile.strip ? verifyStripIcon(tile.strip) : Monitor;
    const headBody = (
        <>
            <span aria-hidden className={cn("flex flex-none", tile.strip ? TONE_TEXT[tile.strip.tone] : "text-muted")}>
                <Glyph size={13} strokeWidth={1.8} />
            </span>
            <span className="font-medium text-primary">Verify</span>
            {!expanded ? <span className="text-muted">·</span> : null}
            {tile.head.parts.map((p, i) => (
                <Fragment key={i}>
                    {i > 0 ? <span className="text-muted">·</span> : null}
                    <span data-verify-verdict className={TONE_TEXT[p.tone]}>
                        {p.text}
                    </span>
                </Fragment>
            ))}
            {expanded && tile.head.count !== "" ? (
                <span className="ml-auto flex-none pl-[6px] text-[11px] tabular-nums text-muted">
                    {tile.head.count}
                </span>
            ) : null}
        </>
    );

    const warning = tile.warning;
    return (
        <motion.section
            data-rail-section="verify"
            data-verify-tile
            aria-label="Verify"
            variants={part.variants}
            initial={first ? part.initial : false}
            animate="animate"
            className="-mx-[8px] mb-[10px] overflow-hidden rounded-lg bg-surface-raised"
        >
            {/* the padding is on the inner box: a section revealing from height 0 cannot be shorter than its padding */}
            <div className="flex flex-col px-[12px] pb-[9px] pt-[9px]">
                {tile.folded ? (
                    // folded or opened by the person: the head is the control, to open it and to fold it again
                    <button
                        type="button"
                        data-verify-head
                        data-verify-folded={expanded ? undefined : ""}
                        aria-expanded={expanded}
                        onClick={() => setUi((u) => ({ ...u, opened: !u.opened }))}
                        className={cn(
                            "-mx-[6px] -my-[3px] flex w-[calc(100%+12px)] cursor-pointer items-center gap-[7px] rounded-[7px] px-[6px] py-[3px] text-left text-[12px] hover:bg-surface-hover",
                            FOCUS
                        )}
                    >
                        {headBody}
                        {expanded ? (
                            <ChevronDown size={12} aria-hidden className="flex-none text-muted" />
                        ) : (
                            <ChevronRight size={12} aria-hidden className="flex-none text-muted" />
                        )}
                    </button>
                ) : (
                    <div data-verify-head className="flex items-center gap-[7px] text-[12px]">
                        {headBody}
                    </div>
                )}
                <AnimatePresence initial={false}>
                    {expanded ? (
                        <motion.div key="body" {...part} className="overflow-hidden">
                            {/* the padding is on the inner box: a box folded to height 0 cannot be shorter than its padding */}
                            <div className="flex flex-col gap-[7px] pt-[7px]">
                                {warning != null ? (
                                    <div
                                        data-verify-warning
                                        data-verify-kind={warning.kind}
                                        className={cn(
                                            "flex flex-col gap-[6px] rounded-[8px] px-[10px] py-[7px] text-[11.5px] leading-[1.45]",
                                            warning.skipped ? "bg-surface text-muted" : "bg-askingbg text-warning-soft"
                                        )}
                                    >
                                        <div className="flex items-start gap-[8px]">
                                            <TriangleAlert
                                                size={12}
                                                strokeWidth={2.2}
                                                aria-hidden
                                                className={cn(
                                                    "mt-[2px] flex-none",
                                                    warning.skipped ? "text-muted" : "text-warning"
                                                )}
                                            />
                                            <span className="min-w-0">{warning.text}</span>
                                        </div>
                                        {warning.kind === "notrun" ? (
                                            <div className="flex flex-wrap items-center gap-[6px] pl-[20px]">
                                                {warning.skipped ? (
                                                    <>
                                                        <span className="text-[11px] text-muted">Skipped</span>
                                                        <button
                                                            type="button"
                                                            data-verify-undo="notrun"
                                                            onClick={() => skip("", true)}
                                                            className={TEXT_BTN}
                                                        >
                                                            Undo
                                                        </button>
                                                    </>
                                                ) : warning.skippable ? (
                                                    <>
                                                        {rerunButton("notrun", rerunLine("notrun", st))}
                                                        <button
                                                            type="button"
                                                            data-verify-skip="notrun"
                                                            onClick={() => skip("", false)}
                                                            className={TEXT_BTN}
                                                        >
                                                            Skip
                                                        </button>
                                                    </>
                                                ) : null}
                                            </div>
                                        ) : null}
                                        {warning.kind === "notrun" && errors.notrun != null ? (
                                            <div className="pl-[20px]">{errorLine("notrun")}</div>
                                        ) : null}
                                    </div>
                                ) : null}
                                {tile.rows.map((row) =>
                                    row.skipped ? (
                                        <div
                                            key={row.key}
                                            data-verify-row={row.key}
                                            data-verify-state={row.state}
                                            className="flex items-center gap-[9px] rounded-[8px] bg-surface py-[5px] pl-[11px] pr-[6px]"
                                        >
                                            <span
                                                className={cn("h-[6px] w-[6px] flex-none rounded-full", TONE_DOT.muted)}
                                            />
                                            <span className="min-w-0 flex-1 truncate text-[11.5px] text-muted">
                                                {row.name}
                                            </span>
                                            <span className="flex-none text-[11px] text-muted">Skipped</span>
                                            <button
                                                type="button"
                                                data-verify-undo={row.key}
                                                onClick={() => skip(row.key, true)}
                                                className={TEXT_BTN}
                                            >
                                                Undo
                                            </button>
                                        </div>
                                    ) : (
                                        <div
                                            key={row.key}
                                            data-verify-row={row.key}
                                            data-verify-state={row.state}
                                            className="rounded-[8px] bg-surface"
                                        >
                                            <button
                                                type="button"
                                                data-verify-open
                                                aria-expanded={rowOpen(row)}
                                                onClick={() => toggleRow(row)}
                                                className={cn(
                                                    "flex w-full cursor-pointer items-center gap-[9px] rounded-[8px] px-[11px] py-[8px] text-left text-secondary",
                                                    FOCUS
                                                )}
                                            >
                                                {rowOpen(row) ? (
                                                    <ChevronDown
                                                        size={12}
                                                        aria-hidden
                                                        className="flex-none text-muted"
                                                    />
                                                ) : (
                                                    <ChevronRight
                                                        size={12}
                                                        aria-hidden
                                                        className="flex-none text-muted"
                                                    />
                                                )}
                                                <span
                                                    data-verify-dot
                                                    className={cn(
                                                        "h-[6px] w-[6px] flex-none rounded-full",
                                                        row.pulsing ? "bg-working pulse-dot-slow" : TONE_DOT[row.tone]
                                                    )}
                                                />
                                                <span className="min-w-0 flex-1 truncate text-[11.5px]">
                                                    {row.name}
                                                </span>
                                                <span
                                                    data-verify-result
                                                    className={cn(
                                                        "flex-none text-[11px] tabular-nums",
                                                        TONE_TEXT[row.resultTone]
                                                    )}
                                                >
                                                    {row.result}
                                                </span>
                                                {row.age !== "" ? (
                                                    <span className="flex-none text-[10.5px] tabular-nums text-muted">
                                                        {row.age}
                                                    </span>
                                                ) : null}
                                            </button>
                                            <AnimatePresence initial={false}>
                                                {rowOpen(row) ? (
                                                    <motion.div key="open" {...part} className="overflow-hidden">
                                                        <div className="flex flex-col gap-[6px] pb-[10px] pl-[32px] pr-[11px] text-[11px] leading-[1.45]">
                                                            {row.note != null ? (
                                                                <div
                                                                    data-verify-note
                                                                    className={
                                                                        row.state === "noresult"
                                                                            ? "text-warning-soft"
                                                                            : "text-muted"
                                                                    }
                                                                >
                                                                    {row.note}
                                                                </div>
                                                            ) : null}
                                                            {row.failed.map((step, i) => (
                                                                <div
                                                                    key={i}
                                                                    data-verify-step
                                                                    className="flex gap-[6px] text-secondary"
                                                                >
                                                                    <X
                                                                        size={10}
                                                                        strokeWidth={3}
                                                                        aria-label="failed"
                                                                        className="mt-[3px] flex-none text-error"
                                                                    />
                                                                    <span className="min-w-0">{step}</span>
                                                                </div>
                                                            ))}
                                                            {row.passedMore > 0 ? (
                                                                <div className="text-muted">
                                                                    + {row.passedMore} passed
                                                                </div>
                                                            ) : null}
                                                            <div className="break-all font-mono text-[10.5px] text-muted">
                                                                <span className="text-ink-faint">$ </span>
                                                                {row.command}
                                                            </div>
                                                            {row.shots != null ? (
                                                                <button
                                                                    type="button"
                                                                    data-verify-shots
                                                                    onClick={() => openShots(row.shotsDir)}
                                                                    className={cn(
                                                                        "inline-flex w-fit cursor-pointer items-center gap-[4px] rounded-[4px] text-[10.5px] text-accent-soft hover:underline",
                                                                        FOCUS
                                                                    )}
                                                                >
                                                                    <ExternalLink
                                                                        size={10}
                                                                        aria-hidden
                                                                        className="flex-none"
                                                                    />
                                                                    {row.shots}
                                                                </button>
                                                            ) : null}
                                                            {row.canRerun || row.canSkip ? (
                                                                <div className="mt-[2px] flex flex-wrap items-center gap-[6px]">
                                                                    {row.canRerun
                                                                        ? rerunButton(row.key, rerunLine(row, st))
                                                                        : null}
                                                                    {row.canSkip ? (
                                                                        <button
                                                                            type="button"
                                                                            data-verify-skip={row.key}
                                                                            onClick={() => skip(row.key, false)}
                                                                            className={TEXT_BTN}
                                                                        >
                                                                            Skip
                                                                        </button>
                                                                    ) : null}
                                                                </div>
                                                            ) : null}
                                                            {errorLine(row.key)}
                                                        </div>
                                                    </motion.div>
                                                ) : null}
                                            </AnimatePresence>
                                        </div>
                                    )
                                )}
                            </div>
                        </motion.div>
                    ) : null}
                </AnimatePresence>
            </div>
        </motion.section>
    );
}

// ---- the header's chip ---------------------------------------------------------------------------------------------------

/** "Verify: 1 failed" in the agent's header, after its state word, only while Verify is red or amber. Its title names what
 *  is wrong; a click opens the rail on Overview with the tile in view. It fades in on the micro ease. */
export function VerifyChip({ agent }: { agent: AgentVM }) {
    const { st } = useAgentVerify(agent, true);
    const part = usePartMotion(microFade);
    // the chip reads no age, so the clock it is built against does not matter
    const chip = verifyTile(st, Date.now()).chip;
    return (
        <AnimatePresence initial={false}>
            {chip != null ? (
                <motion.button
                    key="chip"
                    {...part}
                    type="button"
                    data-verify-chip
                    data-verify-tone={chip.tone}
                    title={chip.title}
                    onClick={() => openRailSection(agent.id, "verify")}
                    className={cn(
                        "inline-flex h-[20px] flex-none cursor-pointer items-center gap-[5px] self-center rounded-[6px] px-[7px] text-[11px]",
                        chip.tone === "red"
                            ? "bg-error/15 text-error-soft hover:bg-error/25"
                            : "bg-askingbg text-warning-soft hover:bg-warning/20",
                        FOCUS
                    )}
                >
                    {chip.tone === "red" ? (
                        <X size={11} strokeWidth={2.4} aria-hidden className="flex-none" />
                    ) : (
                        <TriangleAlert size={11} strokeWidth={2.2} aria-hidden className="flex-none" />
                    )}
                    {chip.text}
                </motion.button>
            ) : null}
        </AnimatePresence>
    );
}
