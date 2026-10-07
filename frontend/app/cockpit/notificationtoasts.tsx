// Toast stack for transient cockpit notifications. Thin render over toastsAtom; colors come
// from @theme tokens only.
import { RuntimeMark } from "@/app/view/agents/runtimemark";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { Bell, CircleCheck, GitPullRequestArrow, Layers, MessageCircleQuestion, type LucideIcon } from "lucide-react";
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
        <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2">
            {toasts.map((t) => (
                <button
                    key={t.id}
                    type="button"
                    data-notification-toast
                    data-notification-open={t.onOpen ? "" : undefined}
                    data-notification-tone={t.eyebrow?.tone}
                    // reading a toast keeps it: the clock stops while the pointer is on it
                    onPointerEnter={() => holdToast(t.id)}
                    onPointerLeave={() => releaseToast(t.id)}
                    onClick={() => {
                        t.onOpen?.();
                        dismissToast(t.id);
                    }}
                    className={cn(
                        "pointer-events-auto rounded-lg border bg-surface p-3 text-left text-primary shadow-lg",
                        t.level === "error"
                            ? "border-error/40"
                            : t.level === "warn" || t.eyebrow?.tone === "asking"
                              ? "border-warning/40"
                              : "border-border",
                        t.onOpen && "cursor-pointer hover:border-accent-700"
                    )}
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
            ))}
        </div>
    );
}
