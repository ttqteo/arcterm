// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The judge's line under the agent's message that ends in a choice question (docs/superpowers/specs/2026-11-25-chat-
// choice-judge-design.md, board C-under-reply): one muted line under a hairline rule, no box. The magnifier icon (a
// spinner while the deep judge reads), the head and the pick's name (the hover target: its tooltip says why), the dim
// hint, and at the line's end the one action the person can take: Đọc code rồi chọn (Read the code and pick), Dừng or
// Thử lại. Under the conversation's last message it is a card instead (data-look="card"): a small head with where the
// pick comes from, the pick's name, the reason written out ([data-chat-judge-reason]) and the action as a button, with
// no hover; the action alone (no pick) stays a line there too. What it says is chatjudge.ts's judgeLine; this draws it
// and ticks the reading seconds. The record is chatJudgeAtom's, and every action goes through runLiveJudge, which acts
// on what the pane offers for its live turn (liveJudgeAtom, written by chatpane.tsx).
// Motion: the line opens under its message on the spring and fades in (chatconversation.tsx says when it arrives, `arrive`),
// and closes the same way when a record leaves it with nothing to show; a state change cross-fades its text on the micro
// ease and a line that grows or shrinks for it rides the spring (CardSlot). The leaving state is popped out of flow
// (AnimatePresence popLayout), which only works on a state that hands the `ref` it is given to its motion element
// (JudgeRow and JudgeCard do): otherwise the old and the new state stack in the body, and the slot springs to the height
// of both. Under reduced motion it mounts at its end state; a line turning into a card or back (the last message
// changed) cross-fades too, its frame's colours easing.
// Markers for the scenarios: [data-chat-judge-line] with data-state and data-look, [data-chat-judge-frame] (the rule or
// the box), [data-chat-judge-head] (a card's), [data-chat-judge-name], [data-chat-judge-tail], [data-chat-judge-icon],
// [data-chat-judge-body] (what cross-fades), [data-chat-judge-action] with [data-chat-judge-action-label] on a card's
// button and, on the tooltip, [data-chat-judge-tip].

import { MOTION } from "@/app/element/motiontokens";
import { formatChordString } from "@/util/keysym";
import { cn } from "@/util/util";
import { Loader2, Search } from "lucide-react";
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useRef, useState, type Ref } from "react";
import { CardSlot, FOCUS_RING } from "./chatbrainstormparts";
import { judgeLine, type JudgeLine } from "./chatjudge";
import { writesVietnamese } from "./chatsuggest";
import { requestDeepJudge, runLiveJudge, useChatJudge } from "./chatsuggeststore";
import { useChartTip } from "./councilchartparts";

/** how far under its message the line sits, whatever gap the column keeps between its rows */
const UNDER_MESSAGE = 8;

/** the tooltip's chip: the line's own text size, and room for a reason of a sentence or two */
const TIP_CHIP = "max-w-[420px] px-[10px] py-2 text-[12.5px] leading-[1.5] text-primary";

/** the action's label and, where there is one, its tip: the key is Alt+J while the line offers Read the code and pick
 *  or Retry */
const ACTION_TEXT = {
    judge: {
        vi: "Đọc code rồi chọn",
        en: "Read the code and pick",
        tipVi: "Một phiên sonnet mới đọc code, không thấy agent khuyên gì",
        tipEn: "A fresh sonnet session reads the code and does not see what the agent recommends",
    },
    stop: { vi: "Dừng", en: "Stop" },
    retry: { vi: "Thử lại", en: "Retry", tipVi: "Chạy Judge lại", tipEn: "Run the judge again" },
} as const;

type ShownLine = Exclude<JudgeLine, { state: "none" }>;

/** The judge's line for one turn's record. `live` is the pane's current turn, the only one whose action still helps;
 *  `inline` is the conversation's last message, whose judge is a card that writes the reason out (no hover);
 *  `cwd` is the agent's project (without it the line shows what was judged and offers nothing); `gap` is the gap of the
 *  column it sits in, which the line takes back to sit close under its message; `arrive` is a line that comes in now,
 *  under a message already drawn, and opens on the spring. Draws nothing when the record has no line to show. */
export function ChatJudgeLine({
    agentId,
    recKey,
    live,
    inline,
    cwd,
    gap,
    arrive,
}: {
    agentId: string;
    recKey: string;
    live: boolean;
    inline: boolean;
    cwd: string | null;
    gap: number;
    arrive: boolean;
}) {
    const rec = useChatJudge(recKey);
    const reduce = useReducedMotion();
    const tip = useChartTip(TIP_CHIP);
    const vi = useMemo(() => writesVietnamese(rec?.recent ?? []), [rec?.recent]);
    // the seconds a reading judge has run tick once a second, and only then
    const reading = rec?.deep?.state === "reading";
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (!reading) {
            return;
        }
        setNow(Date.now());
        const t = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(t);
    }, [reading]);
    // A judge that reads with no call of this window's behind it (another window started it, or this one reloaded) is
    // joined; requestDeepJudge does nothing when a call here is in flight already, which is every judge this line started
    useEffect(() => {
        if (reading && cwd != null) {
            requestDeepJudge(recKey, cwd);
        }
    }, [reading, recKey, cwd]);

    const line = judgeLine(rec, now, vi, live && cwd != null, inline);
    const shown: ShownLine | null = line.state === "none" ? null : line;
    // the last message's judge is a card; the action alone (no pick to show) stays a line either way
    const card = inline && shown != null && !bareLine(shown);
    const look = card ? "card" : "line";
    // a line that was not there (an old turn with nothing to show) and now is opens as an arriving one does
    const wasAbsent = useRef(false);
    if (shown == null) {
        wasAbsent.current = true;
    }
    const closed = { opacity: 0, height: 0, marginTop: -gap };
    const spring = reduce
        ? { duration: 0 }
        : {
              height: MOTION.spring,
              marginTop: MOTION.spring,
              opacity: { duration: MOTION.durMicro, ease: MOTION.easeFluid },
          };

    return (
        <AnimatePresence>
            {shown != null ? (
                <motion.div
                    key="line"
                    initial={arrive || wasAbsent.current ? closed : false}
                    animate={{ opacity: 1, height: "auto", marginTop: UNDER_MESSAGE - gap, transition: spring }}
                    exit={{ ...closed, transition: spring }}
                    // clipped for good: the line is one row under its message, and its focus ring is drawn inside the button
                    className="min-w-0 overflow-hidden"
                >
                    <div
                        data-chat-judge-line={recKey}
                        data-state={shown.state}
                        data-look={look}
                        className="text-[12.5px] leading-[1.5] text-muted"
                    >
                        <CardSlot swap={`${shown.state}:${look}`}>
                            {/* the frame: a hairline rule over a line, the raised box of a card; its colours ease, its
                                size is the slot's spring */}
                            <div
                                data-chat-judge-frame=""
                                className={cn(
                                    "motion-safe:transition-[background-color,border-color] motion-safe:duration-200",
                                    card
                                        ? "rounded-md border border-edge-mid bg-surface-raised px-3 py-[10px]"
                                        : "border-t border-edge-mid pt-[6px]"
                                )}
                            >
                                <div data-chat-judge-body="" className="relative">
                                    <AnimatePresence mode="popLayout" initial={false}>
                                        {card ? (
                                            <JudgeCard
                                                key={`${shown.state}:card`}
                                                line={shown}
                                                agentId={agentId}
                                                vi={vi}
                                                reading={reading}
                                                reduce={!!reduce}
                                            />
                                        ) : (
                                            <JudgeRow
                                                key={`${shown.state}:line`}
                                                line={shown}
                                                agentId={agentId}
                                                vi={vi}
                                                reading={reading}
                                                tip={tip}
                                                reduce={!!reduce}
                                            />
                                        )}
                                    </AnimatePresence>
                                </div>
                            </div>
                        </CardSlot>
                    </div>
                    {tip.node}
                </motion.div>
            ) : null}
        </AnimatePresence>
    );
}

/** One state of the line's text, which cross-fades with the next on the micro ease (at once under reduced motion). While
 *  it fades out it takes no presses and is hidden from assistive tech: the line's one live row is the new one. `ref` is
 *  the element AnimatePresence pops out of flow while the state leaves, so it goes on the motion element. */
function JudgeRow({
    line,
    agentId,
    vi,
    reading,
    tip,
    reduce,
    ref,
}: {
    line: ShownLine;
    agentId: string;
    vi: boolean;
    reading: boolean;
    tip: ReturnType<typeof useChartTip>;
    reduce: boolean;
    ref?: Ref<HTMLDivElement>;
}) {
    const present = useIsPresent();
    const bare = bareLine(line);
    const hasTip = line.reason != null || line.source != null;
    const action = line.action;
    const tail = line.tail != null && line.tail !== "" ? line.tail : null;
    return (
        <motion.div
            ref={ref}
            {...rowFade(reduce)}
            aria-hidden={present ? undefined : true}
            className={cn("flex items-start gap-2", !present && "pointer-events-none")}
        >
            {bare ? null : <JudgeIcon reading={reading} className="mt-[3px]" />}
            <div className="flex min-w-0 flex-col gap-[2px]">
                {/* a long error stops at three lines; the app's tooltip on the note has all of it */}
                <span className={cn("min-w-0 [overflow-wrap:anywhere]", line.state === "failed" && "line-clamp-3")}>
                    {line.head}
                    {line.name != null ? (
                        <>
                            {line.head != null ? " " : null}
                            <span
                                data-chat-judge-name=""
                                {...(hasTip
                                    ? tip.bind(
                                          <div data-chat-judge-tip="" className="flex flex-col gap-1">
                                              {line.reason != null ? <div>{line.reason}</div> : null}
                                              {line.source != null ? (
                                                  <div className="text-muted">{line.source}</div>
                                              ) : null}
                                          </div>
                                      )
                                    : {})}
                                className={cn(
                                    "text-primary",
                                    hasTip && "underline decoration-dotted underline-offset-[3px]"
                                )}
                            >
                                {line.name}
                            </span>
                        </>
                    ) : null}
                    {line.note != null ? (
                        line.state === "done" ? (
                            <> ({line.note})</>
                        ) : (
                            <span title={line.note} className="text-error">
                                {" · "}
                                {line.note}
                            </span>
                        )
                    ) : null}
                    {line.hint != null ? <span className="text-ink-faint"> · {line.hint}</span> : null}
                    {line.state === "reading" && tail != null ? (
                        <>
                            {" · "}
                            <span data-chat-judge-tail="" className="tabular-nums">
                                {tail}
                            </span>
                        </>
                    ) : null}
                </span>
            </div>
            <span className="min-w-0 flex-1" />
            {line.state === "done" && tail != null ? (
                <span data-chat-judge-tail="" className="flex-none whitespace-nowrap tabular-nums">
                    {tail}
                </span>
            ) : null}
            {action != null ? (
                <button
                    type="button"
                    data-chat-judge-action={action}
                    title={actionTip(action, vi)}
                    onClick={() => runLiveJudge(agentId)}
                    className={cn(
                        "flex-none cursor-pointer rounded-[3px] bg-transparent p-0",
                        FOCUS_RING,
                        "focus-visible:ring-inset",
                        action === "judge"
                            ? "text-accent hover:text-accenthover"
                            : "text-muted underline hover:text-secondary"
                    )}
                >
                    {actionLabel(action, vi)}
                </button>
            ) : null}
        </motion.div>
    );
}

/** The last message's judge as a card (one state of it, cross-fading as JudgeRow does): a small head with the icon, what
 *  the judge did and where the pick comes from (the source, or the cost or reading seconds as its tail), the pick's name
 *  in high ink, the reason written out, a failed judge's error, and the one action as a button. No hover. `ref` goes on
 *  the motion element for the same reason as JudgeRow's. */
function JudgeCard({
    line,
    agentId,
    vi,
    reading,
    reduce,
    ref,
}: {
    line: ShownLine;
    agentId: string;
    vi: boolean;
    reading: boolean;
    reduce: boolean;
    ref?: Ref<HTMLDivElement>;
}) {
    const present = useIsPresent();
    const action = line.action;
    const tail = line.tail != null && line.tail !== "" ? line.tail : null;
    const chord = action === "judge" || action === "retry" ? formatChordString("Alt:j") : null;
    return (
        <motion.div
            ref={ref}
            {...rowFade(reduce)}
            aria-hidden={present ? undefined : true}
            className={cn("flex flex-col gap-[6px]", !present && "pointer-events-none")}
        >
            <div data-chat-judge-head="" className="flex items-start gap-[6px] text-[11.5px] leading-[1.45]">
                <JudgeIcon reading={reading} className="mt-[2px]" />
                <span className="min-w-0 [overflow-wrap:anywhere]">
                    {line.head}
                    {tail != null ? (
                        <>
                            {" · "}
                            <span data-chat-judge-tail="" className="tabular-nums">
                                {tail}
                            </span>
                        </>
                    ) : line.source != null ? (
                        <span className="text-ink-faint"> · {line.source}</span>
                    ) : null}
                </span>
            </div>
            {line.name != null ? (
                <div className="min-w-0 [overflow-wrap:anywhere]">
                    <span data-chat-judge-name="" className="text-[13.5px] font-semibold text-primary">
                        {line.name}
                    </span>
                    {line.state === "done" && line.note != null ? <span> ({line.note})</span> : null}
                </div>
            ) : null}
            {line.reason != null ? (
                <div data-chat-judge-reason="" className="min-w-0 text-secondary [overflow-wrap:anywhere]">
                    {line.reason}
                </div>
            ) : null}
            {/* a long error stops at three lines; the app's tooltip on it has all of it */}
            {line.state === "failed" && line.note != null ? (
                <div title={line.note} className="line-clamp-3 min-w-0 text-error [overflow-wrap:anywhere]">
                    {line.note}
                </div>
            ) : null}
            {action != null ? (
                <div className="flex pt-[2px]">
                    <button
                        type="button"
                        data-chat-judge-action={action}
                        title={actionTip(action, vi)}
                        onClick={() => runLiveJudge(agentId)}
                        className={cn(
                            "flex cursor-pointer items-center gap-[6px] rounded-[4px] border border-edge-strong bg-transparent px-[9px] py-[3px] text-[12px] text-primary hover:bg-hover",
                            FOCUS_RING
                        )}
                    >
                        <span data-chat-judge-action-label="">{actionLabel(action, vi)}</span>
                        {chord != null ? (
                            <kbd aria-hidden className="font-mono text-[10.5px] text-muted">
                                {chord}
                            </kbd>
                        ) : null}
                    </button>
                </div>
            ) : null}
        </motion.div>
    );
}

/** a line with no head, name or note: the action alone, which stays a line even under the last message */
function bareLine(line: ShownLine): boolean {
    return line.head == null && line.name == null && line.note == null;
}

/** one state's fade in and out, on the micro ease (at once under reduced motion) */
function rowFade(reduce: boolean) {
    const fade = reduce ? { duration: 0 } : { duration: MOTION.durMicro, ease: MOTION.easeFluid };
    return {
        initial: reduce ? false : { opacity: 0 },
        animate: { opacity: 1, transition: fade },
        exit: { opacity: 0, transition: fade },
    } as const;
}

/** the magnifier, or the spinner while the deep judge reads */
function JudgeIcon({ reading, className }: { reading: boolean; className: string }) {
    return reading ? (
        <Loader2
            data-chat-judge-icon="spin"
            size={13}
            strokeWidth={1.8}
            aria-hidden
            className={cn("flex-none animate-spin motion-reduce:animate-none", className)}
        />
    ) : (
        <Search
            data-chat-judge-icon="search"
            size={13}
            strokeWidth={1.8}
            aria-hidden
            className={cn("flex-none", className)}
        />
    );
}

function actionLabel(action: NonNullable<ShownLine["action"]>, vi: boolean): string {
    return vi ? ACTION_TEXT[action].vi : ACTION_TEXT[action].en;
}

/** the action's tip, with its key: Read the code and pick, and Retry, only */
function actionTip(action: NonNullable<ShownLine["action"]>, vi: boolean): string | undefined {
    if (action !== "judge" && action !== "retry") {
        return undefined;
    }
    const t = ACTION_TEXT[action];
    return `${vi ? t.tipVi : t.tipEn} (${formatChordString("Alt:j")})`;
}
