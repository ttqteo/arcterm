import { globalStore } from "@/app/store/jotaiStore";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { petBubbleAtom, petEventsAtom, petHomeAtom, petSaidAtom, removePetEvent, setPetHome } from "./petstore";
import type { PetEvent } from "./petvoice";

const lsMock = vi.hoisted(() => {
    const store = new Map<string, string>();
    const mock = {
        store,
        getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
        clear: () => store.clear(),
    };
    (globalThis as any).localStorage = mock;
    return mock;
});

const ASK: PetEvent = { id: "ask:a1", at: 2, kind: "ask", text: "which port?", ref: "block:b1" };
const SWEEP: PetEvent = { id: "sweep:1", at: 1, kind: "sweep", text: "Swept the vault." };

describe("removePetEvent — answered means gone", () => {
    beforeEach(() => {
        globalStore.set(petEventsAtom, [ASK, SWEEP]);
        globalStore.set(petSaidAtom, [ASK, SWEEP]);
        globalStore.set(petBubbleAtom, ASK);
    });

    // once the queue row clears, an ask left in what was said leads the quiet peek as stale news
    it("drops the ask from what the creature said, not only from what it may say", () => {
        removePetEvent(ASK.id);
        expect(globalStore.get(petEventsAtom).map((e) => e.id)).toEqual([SWEEP.id]);
        expect(globalStore.get(petSaidAtom).map((e) => e.id)).toEqual([SWEEP.id]);
    });

    it("takes down a bubble that is still showing it", () => {
        removePetEvent(ASK.id);
        expect(globalStore.get(petBubbleAtom)).toBeNull();
    });

    it("leaves a bubble saying something else alone", () => {
        globalStore.set(petBubbleAtom, SWEEP);
        removePetEvent(ASK.id);
        expect(globalStore.get(petBubbleAtom)).toEqual(SWEEP);
    });
});

const HOME_KEY = "wave:pet.home";

// the atom reads storage once, when the module creates it, so each case stores first and imports a fresh copy
async function homeAtStartup(stored?: string): Promise<number> {
    lsMock.clear();
    if (stored != null) {
        lsMock.store.set(HOME_KEY, stored);
    }
    vi.resetModules();
    const { createStore } = await import("jotai");
    const fresh = await import("./petstore");
    return createStore().get(fresh.petHomeAtom);
}

describe("petHomeAtom — where on the ledge it lives", () => {
    beforeEach(() => lsMock.clear());

    it("is 0.9 for a profile that never stored one", async () => {
        expect(await homeAtStartup()).toBe(0.9);
    });

    it("survives a relaunch: what setPetHome stores is what the next launch starts at", async () => {
        setPetHome(0.25);
        expect(globalStore.get(petHomeAtom)).toBe(0.25);
        expect(lsMock.store.get(HOME_KEY)).toBe("0.25");
        expect(await homeAtStartup(lsMock.store.get(HOME_KEY))).toBe(0.25);
    });

    it("keeps both ends of the ledge", async () => {
        expect(await homeAtStartup("0")).toBe(0);
        expect(await homeAtStartup("1")).toBe(1);
    });

    it.each([
        ["a corrupt value", "{not a number"],
        ["an empty value", ""],
        ["a non-finite value", "Infinity"],
        ["a negative value", "-0.2"],
        ["a value above 1", "1.5"],
    ])("reads %s as 0.9", async (_, stored) => {
        expect(await homeAtStartup(stored)).toBe(0.9);
    });

    it("clamps what it is given into [0, 1] before persisting it", () => {
        setPetHome(1.7);
        expect(globalStore.get(petHomeAtom)).toBe(1);
        expect(lsMock.store.get(HOME_KEY)).toBe("1");
        setPetHome(-3);
        expect(globalStore.get(petHomeAtom)).toBe(0);
        expect(lsMock.store.get(HOME_KEY)).toBe("0");
    });

    it("treats a non-finite fraction as the default rather than storing NaN", () => {
        setPetHome(Number.NaN);
        expect(globalStore.get(petHomeAtom)).toBe(0.9);
        expect(lsMock.store.get(HOME_KEY)).toBe("0.9");
    });
});
