import { describe, expect, it, vi } from "vitest";
import { focusTerm, pasteIntoTerm, readTermLines, registerTermHandle } from "./termpaste";

function handle() {
    return { paste: vi.fn(() => true), focus: vi.fn(), lines: vi.fn((_count: number): string[] => []) };
}

describe("pasteIntoTerm", () => {
    it("pastes through the registered terminal and says it did", () => {
        const h = handle();
        const off = registerTermHandle("pb-1", h);
        expect(pasteIntoTerm("pb-1", "/tmp/a.png ")).toBe(true);
        expect(h.paste).toHaveBeenCalledWith("/tmp/a.png ");
        off();
    });
    it("says so when the block has no mounted terminal", () => {
        expect(pasteIntoTerm("pb-none", "x")).toBe(false);
    });
    it("keeps blocks apart", () => {
        const a = handle();
        const b = handle();
        const offA = registerTermHandle("pb-a", a);
        const offB = registerTermHandle("pb-b", b);
        pasteIntoTerm("pb-b", "x");
        expect(a.paste).not.toHaveBeenCalled();
        expect(b.paste).toHaveBeenCalledOnce();
        offA();
        offB();
    });
    it("says so when the terminal is mounted but not ready for input", () => {
        const h = { paste: vi.fn(() => false), focus: vi.fn(), lines: vi.fn((_count: number): string[] => []) };
        const off = registerTermHandle("pb-5", h);
        expect(pasteIntoTerm("pb-5", "x")).toBe(false);
        expect(h.paste).toHaveBeenCalledWith("x");
        off();
    });
    it("lets a failing paste reach the caller, which has to catch it", () => {
        const h = {
            paste: vi.fn(() => {
                throw new Error("terminal gone");
            }),
            focus: vi.fn(),
            lines: vi.fn((_count: number): string[] => []),
        };
        const off = registerTermHandle("pb-6", h);
        expect(() => pasteIntoTerm("pb-6", "x")).toThrow("terminal gone");
        off();
    });
});

describe("registerTermHandle", () => {
    it("stops reaching the terminal once unregistered", () => {
        const h = handle();
        registerTermHandle("pb-2", h)();
        expect(pasteIntoTerm("pb-2", "x")).toBe(false);
    });
    it("is harmless to unregister twice, even after the block registered again", () => {
        const oldH = handle();
        const newH = handle();
        const offOld = registerTermHandle("pb-7", oldH);
        offOld();
        offOld();
        const offNew = registerTermHandle("pb-7", newH);
        offOld();
        expect(pasteIntoTerm("pb-7", "x")).toBe(true);
        expect(newH.paste).toHaveBeenCalledOnce();
        offNew();
    });
    it("does not let a stale unregister remove the newer terminal of the same block", () => {
        const oldH = handle();
        const newH = handle();
        const offOld = registerTermHandle("pb-3", oldH);
        const offNew = registerTermHandle("pb-3", newH);
        offOld();
        expect(pasteIntoTerm("pb-3", "x")).toBe(true);
        expect(newH.paste).toHaveBeenCalledOnce();
        offNew();
    });
});

describe("focusTerm", () => {
    it("focuses the registered terminal and ignores an unknown block", () => {
        const h = handle();
        const off = registerTermHandle("pb-4", h);
        focusTerm("pb-4");
        focusTerm("pb-unknown");
        expect(h.focus).toHaveBeenCalledOnce();
        off();
    });
});

describe("readTermLines", () => {
    it("reads the bottom rows through the registered terminal", () => {
        const h = { ...handle(), lines: vi.fn((_count: number) => ["❯", "  ⏵⏵ auto mode on"]) };
        const off = registerTermHandle("pl-1", h);
        expect(readTermLines("pl-1", 12)).toEqual(["❯", "  ⏵⏵ auto mode on"]);
        expect(h.lines).toHaveBeenCalledWith(12);
        off();
    });
    it("is null when the block has no mounted terminal", () => {
        expect(readTermLines("pl-none", 12)).toBeNull();
    });
    it("is null while the terminal has not loaded", () => {
        const h = { ...handle(), ready: () => false };
        const off = registerTermHandle("pl-2", h);
        expect(readTermLines("pl-2", 12)).toBeNull();
        expect(h.lines).not.toHaveBeenCalled();
        off();
    });
    it("is null once the terminal unregistered", () => {
        registerTermHandle("pl-3", handle())();
        expect(readTermLines("pl-3", 12)).toBeNull();
    });
});
