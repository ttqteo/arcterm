// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { MOTION, cardVariants, composerReveal, computeEntrances, easeFluidCss, indicatorSlide, initialEntranceState, microFade, modalBackdrop, modalPanel, paneReveal, popoverReveal, settleClass, sheetPanel, shouldFadeEntry, reflowProps, turnTransition, viewFade } from "./motiontokens";

describe("motiontokens", () => {
    it("uses the Fluid feel: macro ~360ms on the chosen ease curve", () => {
        expect(MOTION.durMacro).toBeCloseTo(0.36);
        expect(MOTION.durExit).toBeLessThan(MOTION.durMacro); // exits leave quicker
        expect(MOTION.easeFluid).toEqual([0.22, 1, 0.36, 1]);
    });

    it("card entrance animates opacity/scale only (never x/y — Reorder owns the transform)", () => {
        expect(cardVariants.initial).not.toHaveProperty("y");
        expect(cardVariants.initial).not.toHaveProperty("x");
        // Variant is a union that includes a resolver function; these presets are plain
        // target objects, so assert the shape we're testing.
        expect((cardVariants.initial as { opacity: number }).opacity).toBe(0);
        expect((cardVariants.animate as { opacity: number }).opacity).toBe(1);
    });

    it("only narrates message/user entries — tool bursts do not fade (burst guard)", () => {
        expect(shouldFadeEntry("message")).toBe(true);
        expect(shouldFadeEntry("user")).toBe(true);
        expect(shouldFadeEntry("action")).toBe(false);
    });

    it("modal backdrop cross-fades: micro in, exit out, fluid ease", () => {
        expect((modalBackdrop.initial as { opacity: number }).opacity).toBe(0);
        expect((modalBackdrop.animate as any).opacity).toBe(1);
        expect((modalBackdrop.animate as any).transition.duration).toBeCloseTo(MOTION.durMicro);
        expect((modalBackdrop.exit as any).transition.duration).toBeCloseTo(MOTION.durExit);
        expect((modalBackdrop.animate as any).transition.ease).toEqual(MOTION.easeFluid);
    });

    it("modal panel reuses the card entrance signature (single source of feel)", () => {
        expect(modalPanel).toBe(cardVariants);
    });

    it("the sheet slides from the edge it is pinned to, and leaves quicker than it arrives", () => {
        expect((sheetPanel.initial as { x: number }).x).toBeGreaterThan(0);
        expect((sheetPanel.animate as { x: number }).x).toBe(0);
        expect((sheetPanel.animate as any).transition.duration).toBeCloseTo(MOTION.durMacro);
        expect((sheetPanel.exit as any).transition.duration).toBeCloseTo(MOTION.durExit);
        expect((sheetPanel.animate as any).transition.ease).toEqual(MOTION.easeFluid);
    });
});

describe("viewFade", () => {
    it("fades opacity only on the macro duration, with no exit so swapped views never stack", () => {
        expect(viewFade.initial).toEqual({ opacity: 0 });
        expect((viewFade.animate as any).opacity).toBe(1);
        expect((viewFade.animate as any).transition.duration).toBeCloseTo(MOTION.durMacro);
        expect((viewFade.animate as any).transition.ease).toEqual(MOTION.easeFluid);
        expect(viewFade).not.toHaveProperty("exit");
    });
});

describe("popoverReveal", () => {
    it("reveals opacity+scale only (never x/y), snappy in and out", () => {
        expect(popoverReveal.initial).not.toHaveProperty("x");
        expect(popoverReveal.initial).not.toHaveProperty("y");
        expect((popoverReveal.initial as { opacity: number }).opacity).toBe(0);
        expect((popoverReveal.initial as { scale: number }).scale).toBeCloseTo(0.96);
        expect((popoverReveal.animate as any).opacity).toBe(1);
        expect((popoverReveal.animate as any).scale).toBe(1);
        expect((popoverReveal.animate as any).transition.duration).toBeCloseTo(MOTION.durMicro);
        expect((popoverReveal.exit as any).transition.duration).toBeCloseTo(MOTION.durMicro);
        expect((popoverReveal.animate as any).transition.ease).toEqual(MOTION.easeFluid);
    });
});

describe("easeFluidCss", () => {
    it("is the css cubic-bezier form of MOTION.easeFluid", () => {
        expect(easeFluidCss).toBe(`cubic-bezier(${MOTION.easeFluid.join(", ")})`);
        expect(easeFluidCss).toBe("cubic-bezier(0.22, 1, 0.36, 1)");
    });
});

describe("computeEntrances", () => {
    it("first mount animates nothing and seeds seen", () => {
        const r = computeEntrances(initialEntranceState(), "k1", ["a", "b"]);
        expect([...r.animate]).toEqual([]);
        expect([...r.state.seen].sort()).toEqual(["a", "b"]);
        expect(r.state.key).toBe("k1");
    });

    it("switching key animates nothing and reseeds", () => {
        const first = computeEntrances(initialEntranceState(), "k1", ["a", "b"]);
        const r = computeEntrances(first.state, "k2", ["x", "y"]);
        expect([...r.animate]).toEqual([]);
        expect([...r.state.seen].sort()).toEqual(["x", "y"]);
        expect(r.state.key).toBe("k2");
    });

    it("same-key append animates only the new ids", () => {
        const first = computeEntrances(initialEntranceState(), "k1", ["a", "b"]);
        const r = computeEntrances(first.state, "k1", ["a", "b", "c"]);
        expect([...r.animate]).toEqual(["c"]);
        expect([...r.state.seen].sort()).toEqual(["a", "b", "c"]);
    });

    it("undefined key (no source) seeds silently", () => {
        const r = computeEntrances(initialEntranceState(), undefined, []);
        expect([...r.animate]).toEqual([]);
        expect(r.state.key).toBeUndefined();
    });

    it("a removed id does not error and stays remembered", () => {
        const first = computeEntrances(initialEntranceState(), "k1", ["a", "b"]);
        const r = computeEntrances(first.state, "k1", ["a"]);
        expect([...r.animate]).toEqual([]);
        expect(r.state.seen.has("b")).toBe(true);
    });
});

describe("reflowProps", () => {
    it("animates chip-driven reflow with the fluid macro transition", () => {
        const rp = reflowProps(true);
        expect(rp.initial).toBe("initial");
        expect(rp.exit).toBe("exit");
        expect(rp.transition).toEqual({ duration: MOTION.durMacro, ease: MOTION.easeFluid });
    });

    it("makes non-chip changes instant (no enter, no exit, zero-duration layout)", () => {
        const rp = reflowProps(false);
        expect(rp.initial).toBe(false);
        expect(rp.exit).toBeUndefined();
        expect(rp.transition).toEqual({ duration: 0 });
    });
});

describe("paneReveal", () => {
    it("reveals height+opacity on the macro duration, unlike the micro composer strip", () => {
        expect(paneReveal.initial).toEqual({ opacity: 0, height: 0 });
        expect(paneReveal.animate).toMatchObject({ opacity: 1, height: "auto" });
        // the whole point of the primitive: a pane-sized box needs the macro duration to read as motion
        expect((paneReveal.animate as any).transition.duration).toBe(MOTION.durMacro);
        expect((composerReveal.animate as any).transition.duration).toBe(MOTION.durMicro);
    });

    it("leaves a touch quicker than it arrives, like every other exit", () => {
        expect((paneReveal.exit as any).transition.duration).toBe(MOTION.durExit);
    });
});

describe("indicatorSlide", () => {
    it("moves a shared-layout indicator on the macro duration and the fluid ease", () => {
        expect(indicatorSlide).toEqual({ duration: MOTION.durMacro, ease: MOTION.easeFluid });
        expect(indicatorSlide.duration).toBeCloseTo(0.36);
    });
});

describe("microFade", () => {
    it("swaps a mark on opacity alone, micro in and out on the fluid ease", () => {
        expect(microFade.initial).toEqual({ opacity: 0 });
        expect(microFade.animate).toMatchObject({ opacity: 1 });
        expect(microFade.exit).toMatchObject({ opacity: 0 });
        expect((microFade.animate as any).transition).toEqual({ duration: MOTION.durMicro, ease: MOTION.easeFluid });
        expect((microFade.exit as any).transition).toEqual({ duration: MOTION.durMicro, ease: MOTION.easeFluid });
    });
});

describe("turnTransition", () => {
    it("times a chevron turn from the tokens and leaves the property to the reducible class", () => {
        expect(turnTransition).toEqual({
            transitionDuration: `${MOTION.durMicro}s`,
            transitionTimingFunction: easeFluidCss,
        });
        expect(turnTransition).not.toHaveProperty("transition");
        expect(turnTransition).not.toHaveProperty("transitionProperty");
    });
});

describe("settleClass", () => {
    it("plays the settle keyframe once and is dropped under reduced motion", () => {
        expect(settleClass).toContain("animate-[settle_");
        expect(settleClass).toContain("motion-reduce:animate-none");
    });
});
