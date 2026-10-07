// Toast stack for transient cockpit notifications. Thin render over toastsAtom; colors come
// from @theme tokens only.
import { RuntimeMark } from "@/app/view/agents/runtimemark";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import {
    Bell,
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

export function NotificationToasts(): React.JSX.Element {
    const toasts = useAtomValue(toastsAtom);
    if (toasts.length === 0) return <></>;
    return (
        // above the pet (z-60) and its bubble (z-61), below its open peek (z-64): a toast is never covered by a sprite
        // passing under it, and data-pet-avoid sends the pet off the stretch of ledge beneath the stack
        <div data-pet-avoid className="pointer-events-none fixed bottom-4 right-4 z-[62] flex w-80 flex-col gap-2">
            {toasts.map((t) => (
                <div
                    key={t.id}
                    // reading a toast keeps it: the clock stops while the pointer is on it
                    onPointerEnter={() => holdToast(t.id)}
                    onPointerLeave={() => releaseToast(t.id)}
                    className={cn(
                        "pointer-events-auto flex rounded-lg border bg-surface text-primary shadow-lg",
                        t.level === "error"
                            ? "border-error/40"
                            : t.level === "warn" || t.eyebrow?.tone === "asking"
                              ? "border-warning/40"
                              : "border-border",
                        t.onOpen && "hover:border-accent-700"
                    )}
                >
                    <button
                        type="button"
                        data-notification-toast
                        data-notification-open={t.onOpen ? "" : undefined}
                        data-notification-tone={t.eyebrow?.tone}
                        onClick={() => {
                            t.onOpen?.();
                            dismissToast(t.id);
                        }}
                        className={cn("min-w-0 flex-1 py-3 pl-3 text-left", t.onOpen && "cursor-pointer")}
                    >
                        {t.eyebrow ? (
                            <AgentToastBody t={t} eyebrow={t.eyebrow} />
                        ) : (
                            <>
                                <div className="text-sm font-medium">{t.title}</div>
                                {t.message ? <div className="text-xs text-secondary">{t.message}</div> : null}
                            </>
                        )}
                    </button>
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
                </div>
            ))}
        </div>
    );
}
