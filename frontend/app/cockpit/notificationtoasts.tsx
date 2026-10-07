// Toast stack for transient cockpit notifications. Thin render over toastsAtom; colors come
// from @theme tokens only.
import { useAtomValue } from "jotai";
import { dismissToast, toastsAtom } from "./notificationstore";

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
                    onClick={() => {
                        t.onOpen?.();
                        dismissToast(t.id);
                    }}
                    className={`pointer-events-auto rounded-lg border p-3 text-left shadow-lg ${
                        t.level === "error"
                            ? "border-error/40 bg-surface text-primary"
                            : t.level === "warn"
                              ? "border-warning/40 bg-surface text-primary"
                              : "border-border bg-surface text-primary"
                    }${t.onOpen ? " cursor-pointer hover:border-accent-700" : ""}`}
                >
                    <div className="text-sm font-medium">{t.title}</div>
                    {t.message ? <div className="text-xs text-secondary">{t.message}</div> : null}
                </button>
            ))}
        </div>
    );
}
