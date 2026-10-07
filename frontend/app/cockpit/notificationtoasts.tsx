// Toast stack for transient cockpit notifications. Thin render over toastsAtom; colors come
// from @theme tokens only.
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { Check } from "lucide-react";
import { dismissToast, toastsAtom, type ToastEyebrow } from "./notificationstore";

const TONE_TEXT: Record<ToastEyebrow["tone"], string> = {
    asking: "text-asking",
    done: "text-success",
    info: "text-muted",
};

// what kind of notification it is, ahead of the title: a finished turn gets a check, anything else a dot
function Eyebrow({ eyebrow }: { eyebrow: ToastEyebrow }) {
    return (
        <div className="mb-1 flex items-center gap-1.5 text-xxs font-semibold uppercase tracking-[0.06em]">
            <span className={cn("flex items-center gap-1.5", TONE_TEXT[eyebrow.tone])}>
                {eyebrow.tone === "done" ? (
                    <Check size={11} strokeWidth={2.5} />
                ) : (
                    <span
                        className={cn("h-1.5 w-1.5 rounded-full", eyebrow.tone === "asking" ? "bg-asking" : "bg-muted")}
                    />
                )}
                {eyebrow.label}
            </span>
            {eyebrow.meta ? (
                <span className="ml-auto min-w-0 truncate font-normal normal-case tracking-normal text-muted">
                    {eyebrow.meta}
                </span>
            ) : null}
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
                    {t.eyebrow ? <Eyebrow eyebrow={t.eyebrow} /> : null}
                    <div className="line-clamp-2 text-sm font-medium">{t.title}</div>
                    {t.message ? <div className="mt-0.5 line-clamp-2 text-xs text-secondary">{t.message}</div> : null}
                </button>
            ))}
        </div>
    );
}
