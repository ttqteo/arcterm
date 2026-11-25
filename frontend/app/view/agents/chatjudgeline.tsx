// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The judge's line under the agent's message that ends in a choice question (docs/superpowers/specs/2026-11-25-chat-
// choice-judge-design.md, board C-under-reply): one muted line under a hairline rule, no box. The scale icon (a spinner
// while the deep judge reads), the head and the pick's name (the hover target: its tooltip says why), the dim hint, and
// at the line's end the one action the person can take: Judge kỹ, Dừng or Thử lại. Under the conversation's last
// message the reason is written out under the head instead ([data-chat-judge-reason]), with no hover and no hint. What
// the line says is chatjudge.ts's judgeLine; this draws it and ticks the reading seconds. The record is chatJudgeAtom's, and every action goes through
// runLiveJudge, which acts on what the pane offers for its live turn (liveJudgeAtom, written by chatpane.tsx).
// Motion: the line opens under its message on the spring and fades in (chatconversation.tsx says when it arrives, `arrive`),
// and closes the same way when a record leaves it with nothing to show; a state change cross-fades its text on the micro
// ease and a line that grows or shrinks for it rides the spring (CardSlot). Under reduced motion it mounts at its end
// state. Markers for the scenarios: [data-chat-judge-line] with data-state, [data-chat-judge-name],
// [data-chat-judge-tail], [data-chat-judge-icon], [data-chat-judge-body] (what cross-fades), [data-chat-judge-action] and,
// on the tooltip, [data-chat-judge-tip].

import { MOTION } from "@/app/element/motiontokens";
import { formatChordString } from "@/util/keysym";
import { cn } from "@/util/util";
import { Loader2, Scale } from "lucide-react";
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { CardSlot, FOCUS_RING } from "./chatbrainstormparts";
import { judgeLine, type JudgeLine } from "./chatjudge";
import { writesVietnamese } from "./chatsuggest";
import { requestDeepJudge, runLiveJudge, useChatJudge } from "./chatsuggeststore";
import { useChartTip } from "./councilchartparts";

/** how far under its message the line sits, whatever gap the column keeps between its rows */
const UNDER_MESSAGE = 8;

/** the tooltip's chip: the line's own text size, and room for a reason of a sentence or two */
const TIP_CHIP = "max-w-[420px] px-[10px] py-2 text-[12.5px] leading-[1.5] text-primary";

/** the action's label and, where there is one, its tip: the key is Alt+J while the line offers Judge it or Retry */
const ACTION_TEXT = {
    judge: {
        vi: "Judge kỹ",
        en: "Judge it",
        tipVi: "Một phiên sonnet mới đọc code, không thấy agent khuyên gì",
        tipEn: "A fresh sonnet session reads the code and does not see what the agent recommends",
    },
    stop: { vi: "Dừng", en: "Stop" },
    retry: { vi: "Thử lại", en: "Retry", tipVi: "Chạy Judge lại", tipEn: "Run the judge again" },
} as const;

type ShownLine = Exclude<JudgeLine, { state: "none" }>;

/** The judge's line for one turn's record. `live` is the pane's current turn, the only one whose action still helps;
 *  `inline` is the conversation's last message, whose line writes the reason out rather than leaving it to the hover;
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
                        className="border-t border-edge-mid pt-[6px] text-[12.5px] leading-[1.5] text-muted"
                    >
                        <CardSlot swap={shown.state}>
                            <div data-chat-judge-body="" className="relative">
                                <AnimatePresence mode="popLayout" initial={false}>
                                    <JudgeRow
                                        key={shown.state}
                                        line={shown}
                                        agentId={agentId}
                                        vi={vi}
                                        reading={reading}
                                        tip={tip}
                                        reduce={!!reduce}
                                    />
                                </AnimatePresence>
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
 *  it fades out it takes no presses and is hidden from assistive tech: the line's one live row is the new one. */
function JudgeRow({
    line,
    agentId,
    vi,
    reading,
    tip,
    reduce,
}: {
    line: ShownLine;
    agentId: string;
    vi: boolean;
    reading: boolean;
    tip: ReturnType<typeof useChartTip>;
    reduce: boolean;
}) {
    const present = useIsPresent();
    const fade = reduce ? { duration: 0 } : { duration: MOTION.durMicro, ease: MOTION.easeFluid };
    const bare = line.head == null && line.name == null && line.note == null;
    const hasTip = !line.inline && (line.reason != null || line.source != null);
    const action = line.action;
    const text = action != null ? ACTION_TEXT[action] : null;
    const actionTip =
        action === "judge" || action === "retry"
            ? `${vi ? ACTION_TEXT[action].tipVi : ACTION_TEXT[action].tipEn} (${formatChordString("Alt:j")})`
            : undefined;
    const tail = line.tail != null && line.tail !== "" ? line.tail : null;
    return (
        <motion.div
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: 1, transition: fade }}
            exit={{ opacity: 0, transition: fade }}
            aria-hidden={present ? undefined : true}
            className={cn("flex items-start gap-2", !present && "pointer-events-none")}
        >
            {bare ? null : reading ? (
                <Loader2
                    data-chat-judge-icon="spin"
                    size={13}
                    strokeWidth={1.8}
                    aria-hidden
                    className="mt-[3px] flex-none animate-spin motion-reduce:animate-none"
                />
            ) : (
                <Scale
                    data-chat-judge-icon="scale"
                    size={13}
                    strokeWidth={1.8}
                    aria-hidden
                    className="mt-[3px] flex-none"
                />
            )}
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
                {line.inline && line.reason != null ? (
                    <span data-chat-judge-reason="" className="min-w-0 text-secondary [overflow-wrap:anywhere]">
                        {line.reason}
                        {line.source != null ? <span className="text-ink-faint"> · {line.source}</span> : null}
                    </span>
                ) : null}
            </div>
            <span className="min-w-0 flex-1" />
            {line.state === "done" && tail != null ? (
                <span data-chat-judge-tail="" className="flex-none whitespace-nowrap tabular-nums">
                    {tail}
                </span>
            ) : null}
            {action != null && text != null ? (
                <button
                    type="button"
                    data-chat-judge-action={action}
                    title={actionTip}
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
                    {vi ? text.vi : text.en}
                </button>
            ) : null}
        </motion.div>
    );
}
