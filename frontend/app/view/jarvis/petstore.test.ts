import { globalStore } from "@/app/store/jotaiStore";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PET_ROAM, type PetStay } from "./petstay";
import {
    clearExpiredPetStay,
    petBubbleAtom,
    petEventsAtom,
    petHomeAtom,
    petSaidAtom,
    petStayAtom,
    removePetEvent,
    setPetHome,
    setPetStay,
} from "./petstore";
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

const STAY_KEY = "wave:pet.stay";
const HOUR = 3_600_000;

// the atom reads storage once, when the module creates it, so each case stores first and imports a fresh copy
async function stayAtStartup(stored?: string): Promise<PetStay> {
    lsMock.clear();
    if (stored != null) {
        lsMock.store.set(STAY_KEY, stored);
    }
    vi.resetModules();
    const { createStore } = await import("jotai");
    const fresh = await import("./petstore");
    return createStore().get(fresh.petStayAtom);
}

describe("petStayAtom — whether it stays at home, and until when", () => {
    beforeEach(() => {
        lsMock.clear();
        globalStore.set(petStayAtom, PET_ROAM);
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(new Date(2026, 10, 2, 12, 0, 0));
    });
    afterEach(() => vi.useRealTimers());

    it("roams for a profile that never stored one", async () => {
        expect(await stayAtStartup()).toEqual(PET_ROAM);
    });

    it("survives a relaunch: what setPetStay stores is what the next launch starts at", async () => {
        const now = Date.now();
        setPetStay("4h");
        expect(globalStore.get(petStayAtom)).toEqual({ choice: "4h", until: now + 4 * HOUR });
        expect(JSON.parse(lsMock.store.get(STAY_KEY)!)).toEqual({ choice: "4h", until: now + 4 * HOUR });
        expect(await stayAtStartup(lsMock.store.get(STAY_KEY))).toEqual({ choice: "4h", until: now + 4 * HOUR });
    });

    it("keeps a timed stay's absolute end across a relaunch that happens before it", async () => {
        const now = Date.now();
        setPetStay("1h");
        const stored = lsMock.store.get(STAY_KEY);
        vi.setSystemTime(now + HOUR - 1000);
        expect(await stayAtStartup(stored)).toEqual({ choice: "1h", until: now + HOUR });
    });

    it("reads a timed stay that ended while the app was closed as roam", async () => {
        const now = Date.now();
        setPetStay("1h");
        const stored = lsMock.store.get(STAY_KEY);
        vi.setSystemTime(now + HOUR + 1000);
        expect(await stayAtStartup(stored)).toEqual(PET_ROAM);
    });

    it("keeps forever across a relaunch, however long it was closed", async () => {
        setPetStay("forever");
        const stored = lsMock.store.get(STAY_KEY);
        vi.setSystemTime(Date.now() + 1000 * HOUR);
        expect(await stayAtStartup(stored)).toEqual({ choice: "forever", until: null });
    });

    it("reads a corrupt value as roam", async () => {
        expect(await stayAtStartup("{not json")).toEqual(PET_ROAM);
    });

    it("setPetStay roam stores roam", () => {
        setPetStay("forever");
        setPetStay("roam");
        expect(globalStore.get(petStayAtom)).toEqual(PET_ROAM);
        expect(JSON.parse(lsMock.store.get(STAY_KEY)!)).toEqual(PET_ROAM);
    });

    it("keeps the choice in memory when storage refuses the write", () => {
        const setItem = lsMock.setItem;
        lsMock.setItem = () => {
            throw new Error("quota");
        };
        try {
            expect(() => setPetStay("forever")).not.toThrow();
            expect(globalStore.get(petStayAtom)).toEqual({ choice: "forever", until: null });
        } finally {
            lsMock.setItem = setItem;
        }
    });
});

describe("clearExpiredPetStay — the expiry timer's store half", () => {
    beforeEach(() => {
        lsMock.clear();
        globalStore.set(petStayAtom, PET_ROAM);
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(new Date(2026, 10, 2, 12, 0, 0));
    });
    afterEach(() => vi.useRealTimers());

    it("sets roam, in memory and in storage, once a timed stay has ended", () => {
        setPetStay("1h");
        const end = Date.now() + HOUR;
        clearExpiredPetStay(end);
        expect(globalStore.get(petStayAtom)).toEqual(PET_ROAM);
        expect(JSON.parse(lsMock.store.get(STAY_KEY)!)).toEqual(PET_ROAM);
    });

    it("clears a stay long past its end", () => {
        setPetStay("4h");
        clearExpiredPetStay(Date.now() + 10 * HOUR);
        expect(globalStore.get(petStayAtom)).toEqual(PET_ROAM);
    });

    it("leaves a timed stay that is still running", () => {
        setPetStay("1h");
        const before = globalStore.get(petStayAtom);
        clearExpiredPetStay(Date.now() + HOUR - 1);
        expect(globalStore.get(petStayAtom)).toBe(before);
        expect(JSON.parse(lsMock.store.get(STAY_KEY)!)).toEqual(before);
    });

    it("leaves forever alone, however late", () => {
        setPetStay("forever");
        const before = globalStore.get(petStayAtom);
        clearExpiredPetStay(Date.now() + 1000 * HOUR);
        expect(globalStore.get(petStayAtom)).toBe(before);
    });

    it("leaves roam alone and writes nothing", () => {
        const before = globalStore.get(petStayAtom);
        clearExpiredPetStay(Date.now() + 1000 * HOUR);
        expect(globalStore.get(petStayAtom)).toBe(before);
        expect(lsMock.store.has(STAY_KEY)).toBe(false);
    });
});
