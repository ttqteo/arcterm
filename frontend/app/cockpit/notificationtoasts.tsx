// Toast stack for transient cockpit notifications. Thin render over toastsAtom; colors come
// from @theme tokens only.
import { cardVariants, MOTION } from "@/app/element/motiontokens";
import { RuntimeMark } from "@/app/view/agents/runtimemark";
import { toastStackBottom } from "@/app/view/jarvis/hologrammodel";
import { hologramCornerPxAtom } from "@/app/view/jarvis/petstore";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { AnimatePresence, MotionConfig, motion, useReducedMotion } from "motion/react";
import {
    Bell,
    Check,
    CircleCheck,
    GitPullRequestArrow,
    Layers,
    MessageCircleQuestion,
    X,
    type LucideIcon,
} from "lucide-react";
import {
    dismissToast,
    holdToast,
    releaseToast,
    runToastAction,
    toastsAtom,
    type ToastEyebrow,
    type ToastIcon,
    type ToastNotification,
} from "./notificationstore";

const ICON: Record<ToastIcon, LucideIcon> = {
    ask: MessageCircleQuestion,
    done: CircleCheck,
    decision: GitPullRequestArrow,
    message: Bell,
    summary: Layers,
};

// the tile's fill and the eyebrow's ink: amber for something blocked on you, green for a finished turn, the accent
// for a message
const TONE: Record<ToastEyebrow["tone"], { tile: string; text: string }> = {
    asking: { tile: "bg-askingbg text-asking", text: "text-asking" },
    done: { tile: "bg-success/12 text-success", text: "text-success" },
    info: { tile: "bg-accentbg text-accent", text: "text-accent" },
};

// an agent notification: the kind as an icon tile and a word, the project and harness on the right, then what it says
function AgentToastBody({ t, eyebrow }: { t: ToastNotification; eyebrow: ToastEyebrow }) {
    const Icon = ICON[eyebrow.icon];
    const tone = TONE[eyebrow.tone];
    return (
        <div className="flex gap-3">
            <div className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-md", tone.tile)}>
                <Icon size={16} strokeWidth={1.8} aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
                <div className="mb-0.5 flex items-center gap-2 text-xxs">
                    <span className={cn("font-semibold uppercase tracking-[0.06em]", tone.text)}>{eyebrow.label}</span>
                    {eyebrow.meta || eyebrow.runtime ? (
                        <span className="ml-auto flex min-w-0 items-center gap-1 text-muted">
                            {eyebrow.runtime ? (
                                <RuntimeMark runtime={eyebrow.runtime} className="h-3 w-3 flex-none leading-none" />
                            ) : null}
                            {eyebrow.meta ? <span className="truncate">{eyebrow.meta}</span> : null}
                        </span>
                    ) : null}
                </div>
                <div className="line-clamp-2 text-sm font-medium">{t.title}</div>
                {t.message ? <div className="mt-0.5 line-clamp-2 text-xs text-secondary">{t.message}</div> : null}
            </div>
        </div>
    );
}

// where a button was pressed, as a viewport point: the pointer's, or the button's centre for a click with no pointer (a
// key press reads 0, 0)
function pressPoint(e: React.MouseEvent<HTMLElement>): { x: number; y: number } {
    if (e.clientX === 0 && e.clientY === 0) {
        const r = e.currentTarget.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
    return { x: e.clientX, y: e.clientY };
}

// the toast's body: pressing it opens what the toast is about (onOpen) and closes it. `tight` leaves its foot short for the
// row of two actions that follows
function ToastBody({ t, tight = false }: { t: ToastNotification; tight?: boolean }) {
    return (
        <button
            type="button"
            data-notification-toast
            data-notification-open={t.onOpen ? "" : undefined}
            data-notification-tone={t.eyebrow?.tone}
            onClick={() => {
                t.onOpen?.();
                dismissToast(t.id);
            }}
            className={cn("min-w-0 flex-1 py-3 pl-3 text-left", tight && "pb-1.5", t.onOpen && "cursor-pointer")}
        >
            {t.eyebrow ? (
                <AgentToastBody t={t} eyebrow={t.eyebrow} />
            ) : (
                <>
                    <div className="flex items-center gap-2 text-sm font-medium">
                        {t.check ? (
                            <Check size={13} strokeWidth={2} aria-hidden className="shrink-0 text-success" />
                        ) : null}
                        {t.title}
                    </div>
                    {t.message ? <div className="text-xs text-secondary">{t.message}</div> : null}
                </>
            )}
        </button>
    );
}

export function NotificationToasts(): React.JSX.Element {
    const toasts = useAtomValue(toastsAtom);
    // the hologram stays in its corner, so the stack stands above it while it draws there and back in the corner after
    const bottom = toastStackBottom(useAtomValue(hologramCornerPxAtom));
    const reduce = useReducedMotion();
    // the stack stays mounted while empty so the last toast can play its exit; popLayout takes a leaving toast
    // out of flow at once, so the rest slide into its place instead of waiting for it
    return (
        // above the pet (z-60) and its bubble (z-61), below its open peek (z-64): a toast is never covered by a sprite
        // passing under it, and data-pet-avoid sends the pet off the stretch of ledge beneath the stack
        <MotionConfig reducedMotion="user">
            <motion.div
                data-pet-avoid
                role="status"
                aria-live="polite"
                initial={false}
                animate={{ bottom }}
                transition={reduce ? { duration: 0 } : MOTION.spring}
                className="pointer-events-none fixed right-4 z-[62] flex w-80 flex-col gap-2"
            >
                <AnimatePresence mode="popLayout">
                    {toasts.map((t) => (
                        <motion.div
                            key={t.id}
                            layout
                            variants={cardVariants}
                            initial="initial"
                            animate="animate"
                            exit="exit"
                            // reading a toast keeps it: the clock stops while the pointer is on it
                            onPointerEnter={() => holdToast(t.id)}
                            onPointerLeave={() => releaseToast(t.id)}
                            className={cn(
                                "pointer-events-auto flex rounded-lg border frost text-primary shadow-popover-md",
                                t.level === "error"
                                    ? "border-error/40"
                                    : t.level === "warn" || t.eyebrow?.tone === "asking"
                                      ? "border-warning/40"
                                      : "border-border",
                                t.onOpen && "hover:border-accent-700"
                            )}
                        >
                            {/* a toast with two actions draws them in a row under the message, in a column with the
                                body; with one, the button stays at the body's right */}
                            {t.action != null && t.alt != null ? (
                                <div className="flex min-w-0 flex-1 flex-col">
                                    <ToastBody t={t} tight />
                                    <div className="flex gap-1 pb-2 pl-1.5 pr-2">
                                        <button
                                            type="button"
                                            data-notification-action
                                            onClick={(e) => runToastAction(t.id, "action", pressPoint(e))}
                                            className="shrink-0 cursor-pointer rounded px-1.5 py-0.5 text-xs font-medium text-accent-soft hover:bg-surface-hover hover:text-primary"
                                        >
                                            {t.action.label}
                                        </button>
                                        <button
                                            type="button"
                                            data-notification-action-alt
                                            onClick={(e) => runToastAction(t.id, "alt", pressPoint(e))}
                                            className="shrink-0 cursor-pointer rounded px-1.5 py-0.5 text-xs font-medium text-secondary hover:bg-surface-hover hover:text-primary"
                                        >
                                            {t.alt.label}
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <>
                                    <ToastBody t={t} />
                                    {t.action ? (
                                        <button
                                            type="button"
                                            data-notification-action
                                            onClick={(e) => runToastAction(t.id, "action", pressPoint(e))}
                                            className="my-1.5 mr-0.5 shrink-0 cursor-pointer self-center rounded px-2 py-1 text-xs font-medium text-secondary hover:bg-surface-hover hover:text-primary"
                                        >
                                            {t.action.label}
                                        </button>
                                    ) : null}
                                </>
                            )}
                            {/* a sibling, not inside the body: closing must not open what the toast is about */}
                            <button
                                type="button"
                                data-notification-close
                                aria-label="Dismiss notification"
                                title="Dismiss"
                                onClick={() => dismissToast(t.id)}
                                className="m-1.5 flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center self-start rounded text-muted hover:bg-surface-hover hover:text-primary"
                            >
                                <X size={14} strokeWidth={1.8} aria-hidden />
                            </button>
                        </motion.div>
                    ))}
                </AnimatePresence>
            </motion.div>
        </MotionConfig>
    );
}
