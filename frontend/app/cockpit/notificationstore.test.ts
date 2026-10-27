import { globalStore } from "@/app/store/jotaiStore";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { dismissToast, holdToast, pushToast, releaseToast, runToastAction, toastsAtom } from "./notificationstore";

describe("notificationstore", () => {
    beforeEach(() => {
        globalStore.set(toastsAtom, []);
        vi.useFakeTimers();
    });

    it("pushes a toast into the atom", () => {
        pushToast({ title: "hi", message: "there", level: "info" });
        const toasts = globalStore.get(toastsAtom);
        expect(toasts).toHaveLength(1);
        expect(toasts[0].title).toBe("hi");
    });

    it("caps the stack at five and auto-dismisses", () => {
        for (let i = 0; i < 6; i++) pushToast({ title: `t${i}`, message: "", level: "info" });
        expect(globalStore.get(toastsAtom)).toHaveLength(5);
        vi.advanceTimersByTime(7000);
        expect(globalStore.get(toastsAtom)).toHaveLength(0);
    });

    it("dismisses a specific toast", () => {
        pushToast({ title: "a", message: "", level: "info" });
        pushToast({ title: "b", message: "", level: "info" });
        const first = globalStore.get(toastsAtom)[0];
        dismissToast(first.id);
        expect(globalStore.get(toastsAtom).map((t) => t.title)).toEqual(["b"]);
    });

    it("keeps a toast for its own ttl", () => {
        pushToast({ title: "ask", message: "", level: "info", ttlMs: 15000 });
        vi.advanceTimersByTime(14000);
        expect(globalStore.get(toastsAtom)).toHaveLength(1);
        vi.advanceTimersByTime(1500);
        expect(globalStore.get(toastsAtom)).toHaveLength(0);
    });

    it("stops the clock while held and resumes it with the time that was left", () => {
        pushToast({ title: "read me", message: "", level: "info" });
        const id = globalStore.get(toastsAtom)[0].id;
        vi.advanceTimersByTime(4000);
        holdToast(id);
        vi.advanceTimersByTime(60000);
        expect(globalStore.get(toastsAtom)).toHaveLength(1);
        releaseToast(id);
        vi.advanceTimersByTime(1500);
        expect(globalStore.get(toastsAtom)).toHaveLength(1);
        vi.advanceTimersByTime(1000);
        expect(globalStore.get(toastsAtom)).toHaveLength(0);
    });

    it("ignores a hold or release for a toast that is gone", () => {
        holdToast(999);
        releaseToast(999);
        expect(globalStore.get(toastsAtom)).toHaveLength(0);
    });

    it("carries an action the toast offers, such as Undo", () => {
        const run = vi.fn();
        pushToast({
            title: "Link copied",
            message: "",
            level: "info",
            check: true,
            ttlMs: 5000,
            action: { label: "Undo", run },
        });
        const toast = globalStore.get(toastsAtom)[0];
        expect(toast.check).toBe(true);
        expect(toast.action?.label).toBe("Undo");
        toast.action?.run();
        expect(run).toHaveBeenCalledTimes(1);
    });

    it("runs an action and closes its toast", () => {
        const run = vi.fn();
        pushToast({ title: "a", message: "", level: "info", action: { label: "Undo", run } });
        pushToast({ title: "b", message: "", level: "info" });
        const first = globalStore.get(toastsAtom)[0];
        runToastAction(first.id);
        expect(run).toHaveBeenCalledTimes(1);
        expect(globalStore.get(toastsAtom).map((t) => t.title)).toEqual(["b"]);
    });

    it("closes a toast that has no action, or is gone, without running anything", () => {
        pushToast({ title: "plain", message: "", level: "info" });
        const id = globalStore.get(toastsAtom)[0].id;
        runToastAction(id);
        expect(globalStore.get(toastsAtom)).toHaveLength(0);
        expect(() => runToastAction(999)).not.toThrow();
    });
});
