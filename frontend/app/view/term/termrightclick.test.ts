import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DOUBLE_RIGHT_CLICK_MS, makeRightClickGate, singleRightClickAction } from "./termrightclick";

describe("singleRightClickAction", () => {
    it("copies a selection and pastes with none", () => {
        expect(singleRightClickAction(true)).toBe("copy");
        expect(singleRightClickAction(false)).toBe("paste");
    });
});

describe("makeRightClickGate", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    function gate() {
        const onSingle = vi.fn();
        const onDouble = vi.fn();
        return { onSingle, onDouble, g: makeRightClickGate<string>({ onSingle, onDouble }) };
    }

    it("runs the single action once the double-click window passes", () => {
        const { onSingle, onDouble, g } = gate();
        g.click("a");
        expect(onSingle).not.toHaveBeenCalled();
        vi.advanceTimersByTime(DOUBLE_RIGHT_CLICK_MS);
        expect(onSingle).toHaveBeenCalledOnce();
        expect(onDouble).not.toHaveBeenCalled();
    });

    it("opens the menu on a second click inside the window, and never runs the single action", () => {
        const { onSingle, onDouble, g } = gate();
        g.click("a");
        vi.advanceTimersByTime(DOUBLE_RIGHT_CLICK_MS - 1);
        g.click("b");
        vi.advanceTimersByTime(DOUBLE_RIGHT_CLICK_MS * 2);
        expect(onDouble).toHaveBeenCalledExactlyOnceWith("b");
        expect(onSingle).not.toHaveBeenCalled();
    });

    it("treats two clicks further apart than the window as two singles", () => {
        const { onSingle, onDouble, g } = gate();
        g.click("a");
        vi.advanceTimersByTime(DOUBLE_RIGHT_CLICK_MS);
        g.click("b");
        vi.advanceTimersByTime(DOUBLE_RIGHT_CLICK_MS);
        expect(onSingle).toHaveBeenCalledTimes(2);
        expect(onDouble).not.toHaveBeenCalled();
    });

    it("starts fresh after a double click", () => {
        const { onSingle, onDouble, g } = gate();
        g.click("a");
        g.click("b");
        g.click("c");
        vi.advanceTimersByTime(DOUBLE_RIGHT_CLICK_MS);
        expect(onDouble).toHaveBeenCalledOnce();
        expect(onSingle).toHaveBeenCalledOnce();
    });

    it("drops a pending single action on dispose", () => {
        const { onSingle, g } = gate();
        g.click("a");
        g.dispose();
        vi.advanceTimersByTime(DOUBLE_RIGHT_CLICK_MS);
        expect(onSingle).not.toHaveBeenCalled();
    });
});
