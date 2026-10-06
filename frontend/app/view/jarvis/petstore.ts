// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The creature's own state. Module atoms, never component state: the pet lives in window chrome and is
// the one object in the app that survives a surface switch (every surface but Agent unmounts), which is
// the whole point of mounting it in cockpit-root rather than inside a surface.
//
// Two values are remembered across launches — where it sits, and how much it has already said. The
// seed-from-localStorage-at-module-load pattern is ratelimitstore.ts's, so the pet is already in its
// corner on the first frame rather than jumping there after a hydration pass.

import { globalStore } from "@/app/store/jotaiStore";
import { attentionAtom } from "@/app/view/agents/attentionstore";
import { atom, type PrimitiveAtom } from "jotai";
import type { PetActState } from "./petacts";
import type { PetEvent, PetWatermark } from "./petvoice";

const CORNER_KEY = "wave:pet.corner";
const HOME_KEY = "wave:pet.home";
const WATERMARK_KEY = "wave:pet.watermark";

// Corners rather than free x/y: an offset is measured against a viewport that changes size, while a
// corner still means the same place after a resize. Occlusion is the corner dweller's cost, and moving
// between corners is how it is paid (design §9).
//
// The bottom two only. A top pair used to be here and sat on the surface heading band — measured, that
// band runs y=66 to ~144 with the page title starting at x=106, and a top-corner creature spanned
// y=58-102: title text on the left, and because SurfaceHeader is justify-between, the header's action
// buttons on the right. A corner whose whole job is escaping occlusion cannot be the one that occludes
// most, so the escape is left/right along the bottom edge — the axis content is aligned on anyway.
export const PET_CORNERS = ["bottom-right", "bottom-left"] as const;
export type PetCorner = (typeof PET_CORNERS)[number];

const DEFAULT_CORNER: PetCorner = "bottom-right";

// Best-effort reads; any failure (no localStorage, parse error, a value written by an older shape) falls
// back to the default rather than throwing on the boot path.
function readCorner(): PetCorner {
    try {
        const raw = globalThis.localStorage?.getItem(CORNER_KEY);
        return (PET_CORNERS as readonly string[]).includes(raw ?? "") ? (raw as PetCorner) : DEFAULT_CORNER;
    } catch {
        return DEFAULT_CORNER;
    }
}

function readWatermark(): PetWatermark | null {
    try {
        const raw = globalThis.localStorage?.getItem(WATERMARK_KEY);
        if (!raw) {
            return null;
        }
        const parsed = JSON.parse(raw);
        return typeof parsed?.at === "number" && typeof parsed?.id === "string"
            ? { at: parsed.at, id: parsed.id }
            : null;
    } catch {
        return null;
    }
}

export const petCornerAtom = atom<PetCorner>(readCorner()) as PrimitiveAtom<PetCorner>;

export function setPetCorner(corner: PetCorner): void {
    globalStore.set(petCornerAtom, corner);
    try {
        globalThis.localStorage?.setItem(CORNER_KEY, corner);
    } catch {
        // quota/disabled — the in-memory atom still holds it for this session
    }
}

// Home: where on the footer ledge Sprout rests, as a fraction of the ledge's width (0 its left end, 1 its
// right), so a resize keeps it in the same place relative to the ledge (sprout spec §3). A drop sets it.
export const DEFAULT_PET_HOME = 0.9;

// A missing, non-finite or out-of-range value is not clamped but read as the default: it was never a home
// the user chose, so the nearest end of the ledge would be as arbitrary as any other place.
function readHome(): number {
    try {
        const raw = globalThis.localStorage?.getItem(HOME_KEY);
        if (raw == null || raw.trim() === "") {
            return DEFAULT_PET_HOME;
        }
        const home = Number(raw);
        return Number.isFinite(home) && home >= 0 && home <= 1 ? home : DEFAULT_PET_HOME;
    } catch {
        return DEFAULT_PET_HOME;
    }
}

export const petHomeAtom = atom<number>(readHome()) as PrimitiveAtom<number>;

export function setPetHome(fraction: number): void {
    const home = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : DEFAULT_PET_HOME;
    globalStore.set(petHomeAtom, home);
    try {
        globalThis.localStorage?.setItem(HOME_KEY, String(home));
    } catch {
        // as above
    }
}

// Persisted, because "push once per event" has to survive a relaunch: an unpersisted watermark would
// make every launch re-say whatever the last session already said.
export const petWatermarkAtom = atom<PetWatermark | null>(readWatermark()) as PrimitiveAtom<PetWatermark | null>;

export function setPetWatermark(mark: PetWatermark): void {
    globalStore.set(petWatermarkAtom, mark);
    try {
        globalThis.localStorage?.setItem(WATERMARK_KEY, JSON.stringify(mark));
    } catch {
        // as above
    }
}

// Everything the creature could say, newest or oldest in any order — petvoice.ts orders them. This is
// the seam every Voice source writes into: the launch resume narrative, volunteered utterances, notifies
// and asks. A source with nothing to report pushes nothing, so silence is by construction, not a flag.
export const PET_EVENTS_MAX = 50;
export const petEventsAtom = atom<PetEvent[]>([]) as PrimitiveAtom<PetEvent[]>;

export function pushPetEvent(event: PetEvent): void {
    // by id, because a poller re-reporting the same completion must not queue it twice
    const events = globalStore.get(petEventsAtom).filter((e) => e.id !== event.id);
    globalStore.set(petEventsAtom, [event, ...events].slice(0, PET_EVENTS_MAX));
}

// Retract an event (an ask answered or withdrawn). Dedupe-by-id means the same id cannot be re-queued
// afterwards, so the retract is safe even if the raise and the clear arrive in one tick. It reaches what was
// already said too: an answered ask left there comes back as stale news once its queue row clears.
export function removePetEvent(id: string): void {
    globalStore.set(petEventsAtom, globalStore.get(petEventsAtom).filter((e) => e.id !== id));
    globalStore.set(petSaidAtom, globalStore.get(petSaidAtom).filter((e) => e.id !== id));
    if (globalStore.get(petBubbleAtom)?.id === id) {
        globalStore.set(petBubbleAtom, null);
    }
}

// What the bubble is showing, or null. Session-scoped: a bubble is a moment, not a state to restore.
export const petBubbleAtom = atom<PetEvent | null>(null) as PrimitiveAtom<PetEvent | null>;

// The unread marker. Set when a bubble auto-dismisses without being opened, cleared by the peek — the
// creature keeps the KIND of what happened, never a count of it (design §3).
export const petUnreadAtom = atom(false);

// Everything the creature has said this session, newest first. Auto-dismiss loses nothing because the
// peek reads this back. Bounded: it is a recent-history panel, not a log.
export const PET_SAID_MAX = 20;
export const petSaidAtom = atom<PetEvent[]>([]) as PrimitiveAtom<PetEvent[]>;

export function rememberSaid(event: PetEvent): void {
    const said = globalStore.get(petSaidAtom).filter((e) => e.id !== event.id);
    globalStore.set(petSaidAtom, [event, ...said].slice(0, PET_SAID_MAX));
}

// The peek overlay's open state. Global for the same reason graphPeekOpenAtom and autonomyPanelOpenAtom
// are: Escape on a deep surface is bound to "back to Cockpit" (bindings.ts surface:back-home) and the
// dispatcher runs on window CAPTURE, so floating-ui's own Escape handling can never pre-empt it. Without
// the guard there, dismissing the peek also ejects the user to the Cockpit.
export const petPeekOpenAtom = atom(false);

// When Jarvis last said something, as a performance.now() reading, or null if not yet this session.
//
// Session-scoped and deliberately not persisted: it drives the data rings' surge, and a relaunch surging
// about something said an hour ago would be a lie. Held as a timestamp rather than as an animating value
// because the render loop derives the envelope per frame — a 60-per-second atom write would put a React
// render on every frame in a window running live terminals.
export const petSpokeAtAtom = atom<number | null>(null) as PrimitiveAtom<number | null>;

export function markPetSpoke(at: number): void {
    globalStore.set(petSpokeAtAtom, at);
}

// The decision a volunteered utterance pointed at, for decisionlog.tsx to scroll to and flash. A
// decision has no surface of its own — decisionlog renders it inside its parent record's thread — so
// navigation lands on the record and this names the card. Cleared by the consumer once honoured.
export const pendingDecisionAnchorAtom = atom<string | null>(null) as PrimitiveAtom<string | null>;

// What each act is doing right now, keyed by PetAct.id. Module-level because the peek unmounts and
// remounts while the creature does not, so an outcome has to outlive the panel that showed it.
//
// Deliberately NOT persisted, unlike the corner and the watermark above: "3 archived" restored from a
// previous launch would be a claim about this session that nothing verified.
export const petActStateAtom = atom<Record<string, PetActState>>({}) as PrimitiveAtom<Record<string, PetActState>>;

export function setActState(id: string, state: PetActState): void {
    globalStore.set(petActStateAtom, { ...globalStore.get(petActStateAtom), [id]: state });
}


// No pocket atom here on purpose. The Concierge floor's "it holds" (design §6) needs the carry/drop
// gestures and this store together; an atom with a reader and no writer made the peek's Pocket section
// unreachable, which is worse than absent — it cannot be tested and it reads as shipped. Build both
// halves at once. See docs/deferred.md.

export interface PetErrand {
    prompt: string;
    runtime: string;
    text: string;
    status: "streaming" | "done" | "error";
}

// The last errand and its reply. Module-level so a reply still streaming when you close the peek is there
// when you reopen it; session-scoped and unpersisted because the durable copy is the channel message the
// backend posts, which is where a reply worth keeping belongs.
export const petErrandAtom = atom<PetErrand | null>(null) as PrimitiveAtom<PetErrand | null>;

// The channel the peek's composer sends to, as an oid, or null for "no opinion — follow the surface".
//
// The panel owns this rather than reading the Jarvis surface's activeChannelAtom, which nothing sets at
// boot: primeChannels fetches the channel list without selecting, so the composer was dead on every
// surface until the user visited Jarvis and clicked a channel. A creature reachable from everywhere cannot
// depend on a surface the user may never open. resolveDestination turns this into an actual channel.
//
// Session-scoped: persisting an oid would let a deleted channel outlive its own existence, and the ladder
// below it already lands somewhere sensible on every launch.
export const petPeekDestAtom = atom<string | null>(null) as PrimitiveAtom<string | null>;

// cdp drives inputs that are either too expensive to arrange through production (a volunteer judge) or
// must be deterministic (the empty peek). This is compiled out of production builds.
if (import.meta.env.DEV) {
    (globalThis as Record<string, unknown>).__wavePetStore = {
        pushPetEvent,
        resetPeek: () => {
            globalStore.set(petEventsAtom, []);
            globalStore.set(petSaidAtom, []);
            globalStore.set(petBubbleAtom, null);
            globalStore.set(petUnreadAtom, false);
            globalStore.set(petActStateAtom, {});
            globalStore.set(petErrandAtom, null);
        },
        // the peek's PRIMARY state is a populated queue, and attention is server-computed from live runs,
        // gates and pending asks — arranging three real waiting items to photograph the panel would mean
        // starting three runs and parking them. Injecting the polled list is the same trade resetPeek makes.
        // The next poll (10s) overwrites this, which is why a shot must be taken promptly.
        setAttention: (items: AttentionItem[]) => globalStore.set(attentionAtom, items ?? []),
        // plural: setActState (singular, above) is the production one-act setter
        setActStates: (state: Record<string, PetActState>) => globalStore.set(petActStateAtom, state ?? {}),
        // a reply in each status without a live consult behind it
        setErrand: (errand: PetErrand | null) => globalStore.set(petErrandAtom, errand),
    };
}
