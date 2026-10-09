# Jarvis tour: implementation plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** A step-by-step tour of the Jarvis surface in four tracks (Brief, Initiatives, Run sheet, Profile): a
spotlight on one real control and a card beside it in Vietnamese or English, opened from a **?** button in the
Jarvis header and offered once on the first visit.

**Architecture:** Frontend only, no Go and no new dependency. A pure model (`jarvistour.ts`: the reducer, what each
step opens and closes, the spotlight geometry, the first-visit flag) and its content (`jarvistourcontent.ts`, every
step in both languages) are unit-tested. A thin view (`jarvistour.tsx`) draws the overlay, the card and the **?**
menu, places the card with `@floating-ui/react`, runs each step's opening through DOM clicks and atoms
(`jarvistouractions.ts`), and takes its keys through the keybinding dispatcher. A CDP scenario shoots each track.

**Tech stack:** React 19 + jotai + Tailwind 4, `@floating-ui/react` (already a dependency), vitest, CDP scenarios
(`scripts/cdp/scenarios.mjs`).

**Spec:** `docs/superpowers/specs/2026-10-09-jarvis-tour-design.md`
**Verify:** `node scripts/verify.mjs`
**Final:** `if [ "$(uname -s)" = Darwin ]; then echo "unverified: jarvis-tour, brief-profile and brief-surface need CDP, which WKWebView on macOS does not answer"; exit 3; fi; node scripts/cdp/final-verify.mjs jarvis-tour brief-profile brief-surface`

## Conventions for every task

- **Repo rules:** read `AGENTS.md` first. In particular:
  - typecheck with `task check:ts`, never `npx tsc`, with a timeout above 2 min;
  - check only the files you touched with `npx eslint <paths>` / `npx prettier --check <paths>`;
  - never run prettier on `scripts/*.mjs`.
- **Colors:** `@theme` tokens only (`DESIGN.md`, `frontend/tailwindsetup.css`). The dim is `bg-black/55`, as
  ModalShell's `bg-black/60`; everything else uses the tokens the Brief header already uses (`text-ink-hi`,
  `text-ink-mid`, `text-muted`, `bg-surface-raised`, `bg-modalbg`, `border-edge-mid`, `border-edge-strong`,
  `shadow-popover`, `bg-accent`, `text-background`, `ring-accent`).
- **Commits:** stage files by pathspec. Other sessions share this index, so never run a bare `git commit` or
  `git add -A`. No `Co-Authored-By` trailer.
- **Running a scenario** needs the dev app (`task dev`). Run only the scenarios a task names:
  `task verify:ui -- <name>`.

---

### Task 1: The tour model and its content (pure)
**Depends on:** none
**Files:** `frontend/app/view/jarvis/jarvistour.ts`, `frontend/app/view/jarvis/jarvistour.test.ts`, `frontend/app/view/jarvis/jarvistourcontent.ts`, `frontend/app/view/jarvis/jarvistourstore.ts`

**Step 1: Write the failing tests** in `frontend/app/view/jarvis/jarvistour.test.ts`:

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    OFFERED_KEY,
    reconcile,
    shouldOffer,
    markOffered,
    spotRect,
    stepView,
    textOf,
    tourBack,
    tourNext,
    tourStart,
    type TourPrepare,
} from "./jarvistour";
import { TOUR_TRACKS, TOUR_UI } from "./jarvistourcontent";

const VIEW = { width: 1600, height: 950 };

describe("the reducer", () => {
    it("starts a track on its first step", () => {
        expect(tourStart("profile")).toEqual({ track: "profile", index: 0 });
    });
    it("steps on, and past the last step ends", () => {
        expect(tourNext({ track: "brief", index: 0 }, 3)).toEqual({ track: "brief", index: 1 });
        expect(tourNext({ track: "brief", index: 2 }, 3)).toBeNull();
    });
    it("steps back, never before the first step", () => {
        expect(tourBack({ track: "brief", index: 2 })).toEqual({ track: "brief", index: 1 });
        expect(tourBack({ track: "brief", index: 0 })).toEqual({ track: "brief", index: 0 });
    });
});

describe("reconcile", () => {
    const cases: { name: string; opened: TourPrepare[]; want?: TourPrepare; close: TourPrepare[]; open: TourPrepare | null }[] = [
        { name: "opens what the step needs", opened: [], want: "profile", close: [], open: "profile" },
        { name: "keeps what is already open", opened: ["profile"], want: "profile", close: [], open: null },
        { name: "closes what the step no longer needs", opened: ["profile"], close: ["profile"], open: null },
        { name: "swaps one for another", opened: ["newestRun"], want: "profile", close: ["newestRun"], open: "profile" },
        { name: "the end closes everything, newest first", opened: ["firstInitiative", "profile"], close: ["profile", "firstInitiative"], open: null },
    ];
    for (const c of cases) {
        it(c.name, () => {
            expect(reconcile(c.opened, c.want)).toEqual({ close: c.close, open: c.open });
        });
    }
});

describe("the spotlight", () => {
    it("pads a rect and keeps it on screen", () => {
        expect(spotRect({ left: 2, top: 100, width: 50, height: 20 }, VIEW)).toEqual({ left: 0, top: 94, width: 58, height: 32 });
    });
    it("lights the union of the rects found", () => {
        const v = stepView([{ left: 100, top: 100, width: 50, height: 20 }, { left: 100, top: 200, width: 80, height: 30 }], VIEW);
        expect(v).toEqual({ kind: "spot", rect: { left: 94, top: 94, width: 92, height: 142 } });
    });
    it("centers the card when nothing was found or what was found has no size", () => {
        expect(stepView([], VIEW)).toEqual({ kind: "center" });
        expect(stepView([{ left: 10, top: 10, width: 0, height: 0 }], VIEW)).toEqual({ kind: "center" });
    });
});

describe("the first-visit offer", () => {
    const store = (v: string | null) => {
        const m = new Map<string, string>(v == null ? [] : [[OFFERED_KEY, v]]);
        return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, x: string) => void m.set(k, x), m };
    };
    it("shows until it has been answered", () => {
        expect(shouldOffer(store(null))).toBe(true);
        expect(shouldOffer(store("true"))).toBe(false);
    });
    it("answering it marks it for good", () => {
        const s = store(null);
        markOffered(s);
        expect(s.m.get(OFFERED_KEY)).toBe("true");
    });
    it("a storage that throws neither offers nor fails", () => {
        const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
        expect(shouldOffer(broken)).toBe(false);
        expect(() => markOffered(broken)).not.toThrow();
    });
});

describe("the content", () => {
    it("has the four tracks in order", () => {
        expect(TOUR_TRACKS.map((t) => t.id)).toEqual(["brief", "initiatives", "runsheet", "profile"]);
    });
    it("gives every step a title and a body in both languages, and a unique id", () => {
        const ids = new Set<string>();
        for (const track of TOUR_TRACKS) {
            expect(track.vi.title && track.en.title).toBeTruthy();
            for (const step of track.steps) {
                expect(ids.has(step.id)).toBe(false);
                ids.add(step.id);
                for (const lang of ["vi", "en"] as const) {
                    expect(textOf(step, lang).title.trim()).not.toBe("");
                    expect(textOf(step, lang).body.trim()).not.toBe("");
                }
                // vitest runs in node here, with no document to parse a selector; the CDP scenario is what proves
                // each one matches
                for (const sel of step.target ?? []) {
                    expect(sel.trim()).not.toBe("");
                }
            }
        }
    });
    it("opens what each track needs", () => {
        const prep = (id: string) => TOUR_TRACKS.find((t) => t.id === id)!.steps.map((s) => s.prepare ?? null);
        expect(prep("runsheet").every((p) => p === "newestRun")).toBe(true);
        expect(prep("profile")[0]).toBeNull();
        expect(prep("profile").slice(1).every((p) => p === "profile")).toBe(true);
        expect(prep("initiatives")).toContain("firstInitiative");
        expect(prep("brief").every((p) => p === null)).toBe(true);
    });
    it("has every UI string in both languages", () => {
        expect(Object.keys(TOUR_UI.vi).sort()).toEqual(Object.keys(TOUR_UI.en).sort());
        for (const v of [...Object.values(TOUR_UI.vi), ...Object.values(TOUR_UI.en)]) {
            expect(v.trim()).not.toBe("");
        }
    });
});
```

Vitest runs in node (`vitest.config.ts` sets no environment); do not add jsdom.

**Step 2: Run it to see it fail**

Run: `npx vitest run frontend/app/view/jarvis/jarvistour.test.ts`
Expected: FAIL, cannot resolve `./jarvistour`.

**Step 3: Write `frontend/app/view/jarvis/jarvistour.ts`**

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Jarvis tour's model: which step of which track is showing, what each step opens before it shows, where the
// spotlight goes, and the first-visit offer's flag. Pure, so the view (jarvistour.tsx) only measures, clicks and
// draws.

export type TourLang = "vi" | "en";
export type TourTrackId = "brief" | "initiatives" | "runsheet" | "profile";

// what a step needs open before its target can be on screen; a word, not a function, so the order is testable
export type TourPrepare = "profile" | "newestRun" | "firstInitiative";

export interface TourText {
    title: string;
    body: string;
}

export interface TourStep {
    id: string;
    // selectors tried in order; the first that matches is lit. With `all`, every match of it is lit as one rect.
    // None: the card shows in the middle.
    target?: string[];
    all?: boolean;
    prepare?: TourPrepare;
    vi: TourText;
    en: TourText;
}

export interface TourTrack {
    id: TourTrackId;
    vi: { title: string };
    en: { title: string };
    steps: TourStep[];
}

export interface TourState {
    track: TourTrackId;
    index: number;
}

export function tourStart(track: TourTrackId): TourState {
    return { track, index: 0 };
}

/** The next step, or null past the last: the track is over. */
export function tourNext(s: TourState, total: number): TourState | null {
    return s.index + 1 >= total ? null : { ...s, index: s.index + 1 };
}

export function tourBack(s: TourState): TourState {
    return { ...s, index: Math.max(0, s.index - 1) };
}

export function textOf(step: TourStep, lang: TourLang): TourText {
    return step[lang];
}

/**
 * What to close and open before a step, given what the tour itself opened: a step owns only its own `prepare`,
 * so going Back from the Profile to the header's Profile button closes the Profile again. `want` undefined is the
 * end of a track. Closing runs newest first.
 */
export function reconcile(opened: TourPrepare[], want?: TourPrepare): { close: TourPrepare[]; open: TourPrepare | null } {
    const close = opened.filter((p) => p !== want).reverse();
    return { close, open: want != null && !opened.includes(want) ? want : null };
}

export interface Rect {
    left: number;
    top: number;
    width: number;
    height: number;
}

export const SPOT_PAD = 6;

/** The lit rect: the target padded, kept inside the viewport. */
export function spotRect(r: Rect, view: { width: number; height: number }): Rect {
    const left = Math.max(0, r.left - SPOT_PAD);
    const top = Math.max(0, r.top - SPOT_PAD);
    const right = Math.min(view.width, r.left + r.width + SPOT_PAD);
    const bottom = Math.min(view.height, r.top + r.height + SPOT_PAD);
    return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

export type StepView = { kind: "spot"; rect: Rect } | { kind: "center" };

/** A spotlight round the union of the rects found, or the card centered when none has a size. */
export function stepView(rects: Rect[], view: { width: number; height: number }): StepView {
    const sized = rects.filter((r) => r.width > 0 && r.height > 0);
    if (sized.length === 0) {
        return { kind: "center" };
    }
    const left = Math.min(...sized.map((r) => r.left));
    const top = Math.min(...sized.map((r) => r.top));
    const right = Math.max(...sized.map((r) => r.left + r.width));
    const bottom = Math.max(...sized.map((r) => r.top + r.height));
    return { kind: "spot", rect: spotRect({ left, top, width: right - left, height: bottom - top }, view) };
}

// The first-visit offer's flag. Read when the Brief mounts rather than held in an atomWithStorage, whose value is
// read once at module load: the CDP harness sets it after load (scripts/cdp/verify.mjs) so the offer stays out of
// every other scenario.
export const OFFERED_KEY = "jarvis.tour.offered";

interface FlagStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
}

/** Whether to offer the tour: not once it was answered, and not when storage cannot be read. */
export function shouldOffer(storage: FlagStorage): boolean {
    try {
        return storage.getItem(OFFERED_KEY) !== "true";
    } catch {
        return false;
    }
}

export function markOffered(storage: FlagStorage): void {
    try {
        storage.setItem(OFFERED_KEY, "true");
    } catch {
        // a blocked storage offers again next launch; nothing else depends on it
    }
}
```

**Step 4: Write `frontend/app/view/jarvis/jarvistourstore.ts`**

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The tour's state. Module atoms because the dispatcher reads tourAtom to stand the Jarvis keys down while a tour
// shows (keybindings/dispatcher.ts), and the language outlives the surface.

import { atom, type PrimitiveAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import type { TourLang, TourState } from "./jarvistour";

export const tourAtom = atom<TourState | null>(null) as PrimitiveAtom<TourState | null>;

export const tourLangAtom = atomWithStorage<TourLang>("jarvis.tour.lang", "vi", undefined, { getOnInit: true });
```

**Step 5: Write `frontend/app/view/jarvis/jarvistourcontent.ts`** with exactly this content. Before you write the
Brief's last step, check each key it names against `buildJarvisBindings` in
`frontend/app/store/keybindings/bindings.ts` and drop any that is not bound there.

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Jarvis tour's words, in Vietnamese and English. The selectors are the surface's own data attributes; a step
// whose target is missing shows its card in the middle, so every body must read right without the spotlight.

import type { TourLang, TourTrack } from "./jarvistour";

export const TOUR_UI: Record<TourLang, Record<"menu" | "button" | "back" | "next" | "done" | "skip" | "offerTitle" | "offerBody" | "offerStart" | "offerLater", string>> = {
    vi: {
        menu: "Hướng dẫn",
        button: "Hướng dẫn Jarvis",
        back: "Trước",
        next: "Tiếp",
        done: "Xong",
        skip: "Bỏ qua",
        offerTitle: "Mới dùng Jarvis?",
        offerBody: "Một tour ngắn chỉ từng phần của Brief. Mở lại bất cứ lúc nào bằng nút ?.",
        offerStart: "Xem tour",
        offerLater: "Để sau",
    },
    en: {
        menu: "Tours",
        button: "Jarvis tours",
        back: "Back",
        next: "Next",
        done: "Done",
        skip: "Skip",
        offerTitle: "New to Jarvis?",
        offerBody: "A short tour points at each part of the Brief. Reopen it any time from the ? button.",
        offerStart: "Take the tour",
        offerLater: "Not now",
    },
};

export const TOUR_TRACKS: TourTrack[] = [
    {
        id: "brief",
        vi: { title: "Brief" },
        en: { title: "Brief" },
        steps: [
            {
                id: "brief:waiting",
                target: ['[data-jarvis-brief-region="waiting"]', '[data-jarvis-brief-band="waiting"]'],
                vi: {
                    title: "Việc đang chờ bạn",
                    body: "Câu hỏi của lead và worker, cổng duyệt, task bị chặn và run cần acknowledge gom về đây. Khi không có gì chờ, chỉ còn chip «all clear» trên header. Huy hiệu Jarvis trên nav rail đếm cùng các mục này.",
                },
                en: {
                    title: "What waits on you",
                    body: "Questions from leads and workers, review gates, blocked tasks and runs to acknowledge gather here. With nothing waiting, only the «all clear» chip in the header shows. The Jarvis badge on the nav rail counts the same items.",
                },
            },
            {
                id: "brief:regions",
                target: ["[data-jarvis-brief-region] button[aria-pressed]"],
                vi: {
                    title: "Các vùng của Brief",
                    body: "Brief là một cột các vùng: Waiting on you, Initiatives, Runs, Behind you. Bấm tiêu đề một vùng để chỉ xem vùng đó; bấm lại để hiện tất cả.",
                },
                en: {
                    title: "The Brief's regions",
                    body: "The Brief is a column of regions: Waiting on you, Initiatives, Runs, Behind you. Click a region's title to show only that region; click it again to show them all.",
                },
            },
            {
                id: "brief:runs",
                target: ['[data-jarvis-brief-region="sessions"]'],
                vi: {
                    title: "Run đang chạy",
                    body: "Các run tự chạy, theo project. Nút lọc phía trên chọn loại run. Bấm một hàng để mở run sheet của nó; tour «Run sheet» giải thích sheet đó.",
                },
                en: {
                    title: "Runs going on",
                    body: "Runs working on their own, by project. The toggle above picks which kind to show. Click a row to open its run sheet; the «Run sheet» tour walks through it.",
                },
            },
            {
                id: "brief:behind",
                target: ['[data-jarvis-brief-region="behind"]'],
                vi: {
                    title: "Từ lần bạn nhìn",
                    body: "Run đã land và việc đã xong kể từ lần cuối bạn xem. «mark seen» đánh dấu đã xem để vùng này gọn lại.",
                },
                en: {
                    title: "Since you looked",
                    body: "Runs that landed and work that finished since you last looked. «mark seen» clears them so the region stays short.",
                },
            },
            {
                id: "brief:filter",
                target: ["[data-jarvis-brief-filter]"],
                vi: { title: "Lọc Brief", body: "Nhấn / để lọc các hàng của Brief theo tên; Esc xóa lọc." },
                en: { title: "Filter the Brief", body: "Press / to filter the Brief's rows by name; Esc clears the filter." },
            },
            {
                id: "brief:keys",
                vi: {
                    title: "Phím tắt của Brief",
                    body: "j / k: lên xuống giữa các hàng · Enter: mở hàng · d: rail ngữ cảnh · e: dải record · Shift+G: graph peek · Shift+N: initiative mới. Shift+? mở danh sách phím đầy đủ.",
                },
                en: {
                    title: "The Brief's keys",
                    body: "j / k: move between rows · Enter: open the row · d: context rail · e: record band · Shift+G: graph peek · Shift+N: new initiative. Shift+? lists every key.",
                },
            },
        ],
    },
    {
        id: "initiatives",
        vi: { title: "Initiatives" },
        en: { title: "Initiatives" },
        steps: [
            {
                id: "initiatives:new",
                target: ["[data-jarvis-new-initiative]"],
                vi: {
                    title: "Initiative mới",
                    body: "Việc lớn hơn một run sống thành initiative: một danh sách chunk, mỗi chunk có trạng thái và ghi chú. Bấm đây (hoặc Shift+N) để tạo. Agent cũng tạo và cập nhật chúng bằng wsh effort.",
                },
                en: {
                    title: "New initiative",
                    body: "Work bigger than one run lives as an initiative: a list of chunks, each with a state and notes. Click here (or Shift+N) to make one. Agents make and update them with wsh effort too.",
                },
            },
            {
                id: "initiatives:card",
                target: ['[data-jarvis-brief-row="initiative"]'],
                vi: {
                    title: "Thẻ initiative",
                    body: "Mỗi initiative là một thẻ. Thanh màu có một đoạn cho mỗi chunk: thấy ngay bao nhiêu đã xong và chunk nào nên làm tiếp.",
                },
                en: {
                    title: "An initiative's card",
                    body: "Each initiative is a card. Its bar has one segment per chunk: how much is done and which chunk comes next, at a glance.",
                },
            },
            {
                id: "initiatives:actions",
                target: ["[data-jarvis-work-on]", "[data-jarvis-initiative-menu]"],
                vi: {
                    title: "Work on và menu",
                    body: "Work on (phím w) mở một agent mới làm initiative, hoặc nhảy tới agent đang làm nó. Menu … bên cạnh có Rename, Edit details, Pause, Archive và Delete.",
                },
                en: {
                    title: "Work on, and the menu",
                    body: "Work on (key w) opens a new agent on the initiative, or jumps to the one already on it. The … menu beside it has Rename, Edit details, Pause, Archive and Delete.",
                },
            },
            {
                id: "initiatives:detail",
                target: ['[data-jarvis-initiative-detail="true"]'],
                prepare: "firstInitiative",
                vi: {
                    title: "Bên trong một initiative",
                    body: "Mở thẻ ra là thấy các stage và chunk. Bấm pill trạng thái để đổi trạng thái chunk, Add chunk để thêm, Alt+↑ / Alt+↓ để đổi thứ tự trong stage. Bấm một chunk để đọc chuỗi ghi chú của nó.",
                },
                en: {
                    title: "Inside an initiative",
                    body: "An open card shows its stages and chunks. Click a status pill to change a chunk's state, Add chunk to add one, Alt+↑ / Alt+↓ to reorder within a stage. Click a chunk to read its notes.",
                },
            },
            {
                id: "initiatives:ideas",
                target: ["[data-jarvis-ideas]"],
                vi: {
                    title: "Ideas",
                    body: "Ý tưởng chưa có chunk nằm ở cột này. «Jot down an idea» ghi nhanh một ý; mở ý tưởng ra, Plan it nhờ một agent chia nó thành chunk.",
                },
                en: {
                    title: "Ideas",
                    body: "Ideas with no chunks yet live in this column. «Jot down an idea» notes one quickly; open an idea and Plan it has an agent split it into chunks.",
                },
            },
            {
                id: "initiatives:archived",
                target: ["[data-jarvis-brief-archived]"],
                vi: {
                    title: "Initiative đã lưu trữ",
                    body: "Initiative đã Archive được giấu đi; bấm đây để hiện lại chúng.",
                },
                en: {
                    title: "Archived initiatives",
                    body: "Archived initiatives are hidden; click here to show them again.",
                },
            },
        ],
    },
    {
        id: "runsheet",
        vi: { title: "Run sheet" },
        en: { title: "Run sheet" },
        steps: [
            {
                id: "runsheet:status",
                target: ["[data-run-sheet-verb]"],
                prepare: "newestRun",
                vi: {
                    title: "Run đang ở đâu",
                    body: "Động từ cho biết trạng thái: Planning, Executing, Waiting on you, Landing, Done… Thanh bên dưới có một đoạn cho mỗi task, kèm các chip thời gian và số task đã land. Chưa có run nào thì các bước này chỉ là lời giải thích.",
                },
                en: {
                    title: "Where the run stands",
                    body: "The verb says where it is: Planning, Executing, Waiting on you, Landing, Done… The bar below has one segment per task, with chips for time and tasks landed. With no run yet, these steps only explain.",
                },
            },
            {
                id: "runsheet:tasks",
                target: ["[data-run-sheet-rows]", "[data-run-sheet-empty]"],
                prepare: "newestRun",
                vi: {
                    title: "Tasks",
                    body: "Mỗi task một hàng với trạng thái và một hành động: Open in Agent cho worker đang sống, View child run cho task đã xong, Open DAG cho task kẹt ở merge. Dòng next: bên dưới nói run đang đợi gì.",
                },
                en: {
                    title: "Tasks",
                    body: "One row per task with its state and an action: Open in Agent for a live worker, View child run for a finished task, Open DAG for one stuck at a merge. The next: line below says what the run waits on.",
                },
            },
            {
                id: "runsheet:timeline",
                target: ["[data-run-sheet-timeline-toggle]", "[data-run-sheet-timeline]"],
                prepare: "newestRun",
                vi: {
                    title: "Timeline",
                    body: "Mọi sự kiện của run, mới nhất trước. Khi run cần bạn mà chưa rõ vì sao, mở timeline ra đọc trước tiên.",
                },
                en: {
                    title: "Timeline",
                    body: "Every event of the run, newest first. When a run needs you and you cannot tell why, read this first.",
                },
            },
            {
                id: "runsheet:final",
                target: ["[data-run-sheet-final-shots]"],
                prepare: "newestRun",
                vi: {
                    title: "Final check",
                    body: "Khi plan có lệnh Final chụp ảnh, đây là ảnh của vòng final gần nhất. Bấm để mở hộp xem: ↑ / ↓ đổi scenario, ← / → đổi ảnh, Esc đóng.",
                },
                en: {
                    title: "Final check",
                    body: "When the plan has a Final that takes screenshots, these are its last round's. Click to open the viewer: ↑ / ↓ change scenario, ← / → change shot, Esc closes.",
                },
            },
            {
                id: "runsheet:config",
                target: ['[data-jarvis-brief-sheet-config="editable"]'],
                prepare: "newestRun",
                vi: {
                    title: "Cấu hình run",
                    body: "engine · lead · parallelism · workers: run này được dựng thế nào. Adjust đổi độ rộng và route cho các lần dispatch sau, không ảnh hưởng task đang chạy.",
                },
                en: {
                    title: "The run's shape",
                    body: "engine · lead · parallelism · workers: how this run is built. Adjust changes the width and routes for later dispatches, not the tasks already running.",
                },
            },
            {
                id: "runsheet:dock",
                target: ['footer[data-jarvis-brief-sheet-face="settings"]'],
                prepare: "newestRun",
                vi: {
                    title: "Dock",
                    body: "Hành động của run: Open DAG xem đồ thị task, Open lead nhảy tới terminal của lead, Land again khi run bị giữ, và Cancel run.",
                },
                en: {
                    title: "The dock",
                    body: "The run's actions: Open DAG shows the task graph, Open lead jumps to the lead's terminal, Land again retries a held land, and Cancel run.",
                },
            },
            {
                id: "runsheet:nav",
                target: ['[aria-label="Next run"]'],
                prepare: "newestRun",
                vi: {
                    title: "Run kế / trước",
                    body: "j / k (hoặc hai mũi tên này) chuyển sang run kế hoặc trước mà không đóng sheet. Khi run đang sống, ô composer ở đáy nhắn thẳng cho lead hay worker.",
                },
                en: {
                    title: "Next and previous run",
                    body: "j / k (or these arrows) move to the next or previous run without closing the sheet. While a run is live, the composer at the bottom messages its lead or worker directly.",
                },
            },
        ],
    },
    {
        id: "profile",
        vi: { title: "Profile" },
        en: { title: "Profile" },
        steps: [
            {
                id: "profile:button",
                target: ["[data-jarvis-brief-profile]"],
                vi: {
                    title: "Profile",
                    body: "Nút này mở Profile: mặc định cho các run mới và nguyên tắc cho lead. Chip Autonomy bên cạnh đặt mức tự quyết của Jarvis.",
                },
                en: {
                    title: "Profile",
                    body: "This opens the Profile: the defaults new runs start from and the principles given to leads. The Autonomy chip beside it sets how much Jarvis decides on its own.",
                },
            },
            {
                id: "profile:scope",
                target: ['[data-jarvis-brief-modal="profile"] [role="group"][aria-label="Scope"]', "[data-jarvis-profile-tab]"],
                prepare: "profile",
                vi: {
                    title: "Global hay Project",
                    body: "Global áp dụng cho mọi project; Project chỉ cho project đang chọn. Trường nào để Same as global thì lấy giá trị toàn cục.",
                },
                en: {
                    title: "Global or Project",
                    body: "Global applies to every project; Project to the one picked. A field left at Same as global takes the global value.",
                },
            },
            {
                id: "profile:shape",
                target: ['[data-jarvis-profile-row="Default shape"], [data-jarvis-profile-row="Parallel workers"]'],
                all: true,
                prepare: "profile",
                vi: {
                    title: "Hình dạng run",
                    body: "Default shape chọn Quick (một agent) hay Orchestrator (lead chia plan thành task cho worker) cho hộp New. Parallel workers là số worker chạy cùng lúc; auto để lead chọn.",
                },
                en: {
                    title: "A run's shape",
                    body: "Default shape picks Quick (one agent) or Orchestrator (a lead splits a plan into tasks for workers) for the New dialog. Parallel workers is how many run at once; auto lets the lead choose.",
                },
            },
            {
                id: "profile:routes",
                target: ['[data-jarvis-profile-row="Lead route"], [data-jarvis-profile-row="Worker route"], [data-jarvis-profile-row="Reviewer route"]'],
                all: true,
                prepare: "profile",
                vi: {
                    title: "Route: ai chạy, model nào",
                    body: "Lead route là harness và model của lead (chỉ ở scope Project). Worker route là nơi worker chạy: Same as lead, một route riêng, hoặc Reviewer picks. Reviewer route chạy review từng task, review plan và final verify.",
                },
                en: {
                    title: "Routes: who runs, on which model",
                    body: "Lead route is the lead's harness and model (Project scope only). Worker route is where workers run: Same as lead, a route of its own, or Reviewer picks. Reviewer route runs task reviews, the plan review and final verify.",
                },
            },
            {
                id: "profile:landing",
                target: ['[data-jarvis-profile-row="Runs land on"]'],
                prepare: "profile",
                vi: {
                    title: "Run land vào đâu",
                    body: "Own branch (mặc định): run làm trên nhánh wave/<runId> rồi merge về khi xong. Project checkout: làm thẳng trong thư mục của bạn. Với Own branch, nếu checkout có thay đổi chưa commit ở file mà run cũng sửa, run bị giữ đến khi bạn commit.",
                },
                en: {
                    title: "Where runs land",
                    body: "Own branch (the default): the run works on wave/<runId> and is merged back when done. Project checkout: it works in your folder directly. With Own branch, uncommitted edits in the checkout to a file the run also changes hold the land until you commit them.",
                },
            },
            {
                id: "profile:principles",
                target: ['[data-jarvis-global-principles="editor"]', '[aria-label="Customized principle text"]', '[aria-label="Project principle text"]'],
                prepare: "profile",
                vi: {
                    title: "Principles",
                    body: "Các nguyên tắc ngắn được đưa vào prompt của lead. Ở scope Project bạn sửa riêng câu chữ (Customized), tắt một nguyên tắc cho project, hoặc thêm nguyên tắc chỉ của project.",
                },
                en: {
                    title: "Principles",
                    body: "Short rules put into the lead's prompt. In Project scope you can reword one for the project (Customized), turn one off there, or add rules of its own.",
                },
            },
            {
                id: "profile:save",
                target: ['[data-jarvis-brief-modal="profile"] footer'],
                prepare: "profile",
                vi: {
                    title: "Lưu",
                    body: "Save profile lưu thay đổi; chỉ run khởi chạy sau đó dùng giá trị mới. Cờ của wsh runs start thắng profile.",
                },
                en: {
                    title: "Save",
                    body: "Save profile keeps your changes; only runs started afterwards use them. Flags given to wsh runs start win over the profile.",
                },
            },
        ],
    },
];

export function trackOf(id: TourTrack["id"]): TourTrack {
    return TOUR_TRACKS.find((t) => t.id === id)!;
}
```

**Step 6: Run the tests**

Run: `npx vitest run frontend/app/view/jarvis/jarvistour.test.ts`
Expected: PASS.

**Step 7: Check and commit**

```bash
npx eslint frontend/app/view/jarvis/jarvistour.ts frontend/app/view/jarvis/jarvistour.test.ts frontend/app/view/jarvis/jarvistourcontent.ts frontend/app/view/jarvis/jarvistourstore.ts
npx prettier --check frontend/app/view/jarvis/jarvistour.ts frontend/app/view/jarvis/jarvistour.test.ts frontend/app/view/jarvis/jarvistourcontent.ts frontend/app/view/jarvis/jarvistourstore.ts
git add -- frontend/app/view/jarvis/jarvistour.ts frontend/app/view/jarvis/jarvistour.test.ts frontend/app/view/jarvis/jarvistourcontent.ts frontend/app/view/jarvis/jarvistourstore.ts
git commit -m "feat(jarvis): the tour's model and its Vietnamese and English content" -- frontend/app/view/jarvis/jarvistour.ts frontend/app/view/jarvis/jarvistour.test.ts frontend/app/view/jarvis/jarvistourcontent.ts frontend/app/view/jarvis/jarvistourstore.ts
```

If prettier reflows the long strings or the test table, run `npx prettier --write` on these four files only.

---

### Task 2: Anchors the tour points at, and the offer kept out of other scenarios
**Depends on:** none
**Files:** `frontend/app/view/jarvis/briefprofileview.tsx`, `frontend/app/view/jarvis/runsheet.tsx`, `scripts/cdp/verify.mjs`

**Step 1: A Profile row names itself.** In `briefprofileview.tsx`, `DefaultRow` (around line 88) renders the row's
grid `div`. Add `data-jarvis-profile-row={label}` to that `div`. Every row (Default shape, Parallel workers, Lead
route, Worker route, Reviewer route, Runs land on) then carries its own label; no call site changes.

**Step 2: The timeline's toggle.** In `runsheet.tsx`, the "timeline · N events" toggle button (around line 498, the
one with `aria-expanded` above `[data-run-sheet-timeline]`) gets `data-run-sheet-timeline-toggle`.

**Step 3: The offer stays out of every other scenario.** In `scripts/cdp/verify.mjs`, right after the
`Emulation.setDeviceMetricsOverride` call (around line 40), add:

```js
// the Jarvis tour's first-visit offer would sit under the header in every Jarvis scenario's shots; the
// jarvis-tour scenario clears this itself to see the offer. The Brief reads it when it mounts (jarvistour.ts).
await h.ev("localStorage.setItem('jarvis.tour.offered', 'true')").catch(() => {});
```

**Step 4: Check that the Profile scenario still passes.** With the dev app running:
`task verify:ui -- brief-profile`. Expected: PASS. Then `npx eslint frontend/app/view/jarvis/briefprofileview.tsx
frontend/app/view/jarvis/runsheet.tsx` and `npx prettier --check` on the same two files (not on `verify.mjs`).

**Step 5: Commit**

```bash
git add -- frontend/app/view/jarvis/briefprofileview.tsx frontend/app/view/jarvis/runsheet.tsx scripts/cdp/verify.mjs
git commit -m "feat(jarvis): Profile rows and the timeline toggle carry anchors; verify skips the tour offer" -- frontend/app/view/jarvis/briefprofileview.tsx frontend/app/view/jarvis/runsheet.tsx scripts/cdp/verify.mjs
```

---

### Task 3: The tour on screen: overlay, card, ? menu, offer, keys, scenario
**Depends on:** Task 1, Task 2
**Files:** `frontend/app/view/jarvis/jarvistour.tsx`, `frontend/app/view/jarvis/jarvistouractions.ts`, `frontend/app/view/jarvis/briefsurface.tsx`, `frontend/app/store/keybindings/bindings.ts`, `frontend/app/store/keybindings/dispatcher.ts`, `scripts/cdp/scenarios.mjs`

Read first: `frontend/app/view/jarvis/finalshotsviewer.tsx` (how an overlay over the run sheet takes the keys:
its own bindings gated on its atom, the atom listed in the dispatcher's `modalOpen`, and `registerModal` so the
ModalShell underneath yields Escape), and `frontend/app/view/jarvis/autonomyladderview.tsx:85-93` (the
`useFloating` recipe).

**Step 1: `frontend/app/view/jarvis/jarvistouractions.ts`**, the DOM side of `prepare`. Each `open*` returns whether
the tour opened it (false when it was already open, so the tour never closes what you had open); each `close*`
undoes only that.

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What a tour step opens before it shows, done the way a person would: the Profile through its atom, a run's sheet
// and an initiative's card by clicking them. Covered by the jarvis-tour CDP scenario, not by unit tests.

import { globalStore } from "@/app/store/jotaiStore";
import type { TourPrepare } from "./jarvistour";
import { briefProfileAtom, briefSheetOpenAtom } from "./jarvisstore";

function click(selector: string): boolean {
    const el = document.querySelector<HTMLElement>(selector);
    el?.click();
    return el != null;
}

export function openPrepare(p: TourPrepare): boolean {
    switch (p) {
        case "profile":
            if (globalStore.get(briefProfileAtom) != null) {
                return false;
            }
            globalStore.set(briefProfileAtom, "");
            return true;
        case "newestRun":
            if (globalStore.get(briefSheetOpenAtom)) {
                return false;
            }
            return click('[data-jarvis-brief-row="session"]') || click('[data-jarvis-brief-row="shipped"]');
        case "firstInitiative":
            if (document.querySelector('[data-jarvis-initiative-card="open"]') != null) {
                return false;
            }
            return click('[data-jarvis-initiative-card="closed"] > [role="button"]');
    }
}

export function closePrepare(p: TourPrepare): void {
    switch (p) {
        case "profile":
            globalStore.set(briefProfileAtom, null);
            return;
        case "newestRun":
            click('[aria-label="Close detail sheet"]');
            return;
        case "firstInitiative":
            click('[data-jarvis-initiative-card="open"] > [role="button"]');
            return;
    }
}

/** The rects of a step's target: the first selector that matches, all of its matches with `all`. */
export function targetRects(target: string[] | undefined, all: boolean | undefined): DOMRect[] {
    for (const sel of target ?? []) {
        const found = all ? [...document.querySelectorAll(sel)] : [document.querySelector(sel)].filter((e) => e != null);
        if (found.length > 0) {
            return found.map((e) => e!.getBoundingClientRect());
        }
    }
    return [];
}
```

**Step 2: The keys.** In `bindings.ts`, next to `buildFinalShotsBindings`, add:

```ts
// The Jarvis tour's keys, registered by the tour while it shows. Gated on its own atom, which the dispatcher counts
// as modalOpen, so the Brief's list keys and the run sheet's Escape stand down under it.
export function buildJarvisTourBindings(handlers: { next(): void; back(): void; close(): void }): Binding[] {
    const open = () => globalStore.get(tourAtom) != null;
    const bind = (id: string, keys: string, label: string, run: () => void): Binding => ({
        id: `jarvis-tour:${id}`,
        keys,
        group: "Jarvis tour",
        label,
        when: open,
        paletteHidden: true,
        run,
    });
    return [
        bind("next", "ArrowRight", "Next step", handlers.next),
        bind("next-enter", "Enter", "Next step", handlers.next),
        bind("back", "ArrowLeft", "Previous step", handlers.back),
        bind("close", "Escape", "End the tour", handlers.close),
    ];
}
```

with `import { tourAtom } from "@/app/view/jarvis/jarvistourstore";` at the top. In `dispatcher.ts`, add to the
`modalOpen` expression, beside `finalShotsViewerOpenAtom`:

```ts
        // the Jarvis tour over the Brief: its arrows, Enter and Escape step the tour, not the list underneath
        globalStore.get(tourAtom) != null ||
```

**Step 3: `frontend/app/view/jarvis/jarvistour.tsx`.** Three exports:

- `JarvisTour()`: renders nothing while `tourAtom` is null. While a tour shows:
  - **Each step change** (an effect on `track` and `index`): compute `reconcile(opened, step.prepare)`, run
    `closePrepare` for each in `close` and `openPrepare` for `open` (remember it in a `useRef<TourPrepare[]>` only
    when it returned true), then poll `targetRects(step.target, step.all)` every 50 ms for up to 1000 ms until it
    finds something. After the prepare, call the previous `registerModal` unregister and `registerModal("jarvis-tour")`
    again, so the tour is the top of the modal stack even over a Profile it just opened.
  - **Measuring:** while a step shows, re-read `targetRects` every 250 ms and on window `resize` and capturing
    `scroll`, and turn it into `stepView(rects, { width: innerWidth, height: innerHeight })`.
  - **Ending** (Skip, Done, Escape, or the component unmounting because the surface changed): run
    `reconcile(opened, undefined)`'s closes, unregister the modal, set `tourAtom` null.
  - **Keys:** `useKeybindings(useMemo(() => buildJarvisTourBindings({...}), []))` through a handlers ref, as
    `finalshotsviewer.tsx` does.
  - **Markup**, portalled to `document.body` (`createPortal`):
    - a `fixed inset-0 z-[80]` layer that takes every pointer event (`onPointerDown`/`onClick` stop there), with
      `data-jarvis-tour-view={view.kind}`;
    - for a spot, four `bg-black/55` rects round the hole and, over the hole, a `pointer-events-none
      rounded-[8px] ring-2 ring-accent` box with `data-jarvis-tour-spot`; for center, one full `bg-black/55`;
    - the card, `data-jarvis-tour-card`, `data-jarvis-tour-step={step.id}`, `data-jarvis-tour-lang={lang}`:
      `w-[340px] rounded-[12px] border border-edge-strong bg-modalbg p-4 shadow-popover`. Placed with
      `useFloating({ strategy: "fixed", placement: "bottom", middleware: [offset(12), flip(), shift({ padding: 12 })],
      whileElementsMounted: autoUpdate })` and `refs.setPositionReference({ getBoundingClientRect: () => new
      DOMRect(rect.left, rect.top, rect.width, rect.height) })` for a spot; centered with `left-1/2 top-1/2
      -translate-x-1/2 -translate-y-1/2` otherwise.
    - Card content, top to bottom: a row with `n / N · <track title>` in `text-[11.5px] text-muted` and on the
      right a two-segment `VI | EN` switch (buttons `data-jarvis-tour-lang-toggle="vi"` / `"en"`, `aria-pressed`,
      the Profile's segment look: `rounded-[6px] px-2 h-[22px] text-[12px]`, pressed `bg-surface-raised
      text-ink-hi`, else `text-ink-mid`), which sets `tourLangAtom`; the title in `text-[14px] font-semibold
      text-ink-hi`; the body in `text-[13px] leading-[1.5] text-ink-mid`; a footer with **Skip**
      (`data-jarvis-tour-skip`, a text button, `text-muted`) on the left and **Back** (`data-jarvis-tour-back`,
      disabled on step 1, the Profile footer's Cancel look) and **Next** / **Done** on the last step
      (`data-jarvis-tour-next`, `bg-accent text-background hover:bg-accenthover`) on the right. Words come from
      `TOUR_UI[lang]`.
- `TourButton()`: the 28×28 header button, the Profile button's exact classes, a `CircleHelp` icon (lucide, 14,
  stroke 1.8), `data-jarvis-tour-button`, `aria-label`/`title` `TOUR_UI[lang].button`, `aria-haspopup="menu"`.
  It opens a small menu (`useFloating` + `useDismiss` as `autonomyladderview.tsx`, placement `bottom-end`,
  `rounded-[10px] border border-edge-strong bg-modalbg p-1 shadow-popover`, `role="menu"`) with a heading
  `TOUR_UI[lang].menu` and one `role="menuitem"` per track (`data-jarvis-tour-track={id}`, the track's title, then
  its step count in `text-muted`). Picking one closes the menu and sets `tourAtom` to `tourStart(id)`.
- `TourOffer()`: shown when `useState(() => shouldOffer(localStorage))` is true and no tour is open. A card in the
  same look as the tour card, `data-jarvis-tour-offer`, absolutely placed under the header at the right
  (`absolute right-4 top-[60px] z-30 w-[300px]`), with the `VI | EN` switch, `offerTitle`, `offerBody`, and two
  buttons: **offerStart** (`data-jarvis-tour-offer-start`, accent) starts the Brief track, **offerLater**
  (`data-jarvis-tour-offer-later`) only hides it. Both call `markOffered(localStorage)`.

**Step 4: Mount it.** In `briefsurface.tsx`:
- after the Profile button and before the divider `<span aria-hidden className="mx-0.5 h-[18px] w-px …" />`
  (around line 1521), render `<TourButton />`;
- inside the surface root `<div data-jarvis-region="brief" …>` (around line 1416), render `<TourOffer />` and
  `<JarvisTour />` once, at the end.

**Step 5: Typecheck and lint**

Run: `task check:ts` (timeout 5 min). Expected: exit 0. Then `npx eslint` and `npx prettier --check` on the five
`.ts`/`.tsx` files of this task.

**Step 6: The CDP scenario.** In `scripts/cdp/scenarios.mjs`, add `jarvisTour` beside `briefProfile` and list it
in `SCENARIOS` after `briefProfile`. Use the file's own `pressKey` helper for keys.

```js
// The Jarvis tour (jarvistour.tsx): the first-visit offer, the Brief track's card and spotlight in Vietnamese,
// switching to English, Escape, and the Profile track opening the Profile itself and closing it again on Skip.
// Run sheet and Initiatives show their first step whether or not the dev store has a run or an initiative: a
// missing target is a centered card, which is the designed fallback, not a failure.
const jarvisTour = {
    name: "jarvis-tour",
    surface: "jarvis",
    async arrange() {
        return {};
    },
    async assert(h) {
        const steps = [];
        const wait = (ms) => h.ev(`new Promise((r) => setTimeout(r, ${ms}))`);
        const CARD = `(() => {
            const c = document.querySelector('[data-jarvis-tour-card]');
            const v = document.querySelector('[data-jarvis-tour-view]');
            return c ? {
                step: c.dataset.jarvisTourStep,
                lang: c.dataset.jarvisTourLang,
                view: v?.dataset.jarvisTourView ?? null,
                spot: !!document.querySelector('[data-jarvis-tour-spot]'),
                text: (c.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 160),
            } : null;
        })()`;

        // a fresh look: forget the offer and the language, then come back to Jarvis so the Brief mounts again
        await h.ev("localStorage.removeItem('jarvis.tour.offered'); localStorage.removeItem('jarvis.tour.lang')");
        await h.goto("cockpit");
        await h.goto("jarvis");
        await wait(800);
        const offer = await h.ev(`!!document.querySelector('[data-jarvis-tour-offer]')`);
        steps.push({ step: "1. the first visit offers the tour", ok: offer === true, detail: String(offer) });
        await h.shot("cdp-shots/jarvis-tour-offer.png");

        await h.ev(`document.querySelector('[data-jarvis-tour-offer-start]')?.click()`);
        await wait(1200);
        const first = await h.ev(CARD);
        const offered = await h.ev(`localStorage.getItem('jarvis.tour.offered')`);
        steps.push({
            step: "2. Take the tour starts the Brief track in Vietnamese, lit, and the offer is gone for good",
            ok:
                first?.step === "brief:waiting" &&
                first.lang === "vi" &&
                first.view === "spot" &&
                first.spot &&
                offered === "true" &&
                !(await h.ev(`!!document.querySelector('[data-jarvis-tour-offer]')`)),
            detail: JSON.stringify({ first, offered }),
        });
        await h.shot("cdp-shots/jarvis-tour-brief.png");

        await pressKey(h, { key: "ArrowRight", code: "ArrowRight", keyCode: 39 });
        const second = await h.ev(CARD);
        steps.push({ step: "3. → steps on", ok: second?.step === "brief:regions", detail: JSON.stringify(second) });

        await h.ev(`document.querySelector('[data-jarvis-tour-lang-toggle="en"]')?.click()`);
        await wait(300);
        const english = await h.ev(CARD);
        steps.push({
            step: "4. EN switches the card to English",
            ok: english?.lang === "en" && english.text.includes("The Brief's regions"),
            detail: JSON.stringify(english),
        });
        await h.shot("cdp-shots/jarvis-tour-english.png");

        await pressKey(h, { key: "Escape", code: "Escape", keyCode: 27 });
        const ended = await h.ev(CARD);
        const surface = await h.activeSurfaceLabel();
        steps.push({
            step: "5. Escape ends the tour and stays on Jarvis",
            ok: ended == null && /jarvis/i.test(surface ?? ""),
            detail: JSON.stringify({ ended, surface }),
        });

        await h.ev(`document.querySelector('[data-jarvis-tour-button]')?.click()`);
        await wait(300);
        const tracks = await h.ev(`[...document.querySelectorAll('[data-jarvis-tour-track]')].map((b) => b.dataset.jarvisTourTrack)`);
        steps.push({
            step: "6. ? lists the four tracks",
            ok: JSON.stringify(tracks) === JSON.stringify(["brief", "initiatives", "runsheet", "profile"]),
            detail: JSON.stringify(tracks),
        });
        await h.shot("cdp-shots/jarvis-tour-menu.png");

        await h.ev(`document.querySelector('[data-jarvis-tour-track="profile"]')?.click()`);
        await wait(600);
        await h.ev(`document.querySelector('[data-jarvis-tour-next]')?.click()`);
        await wait(1200);
        await h.ev(`document.querySelector('[data-jarvis-tour-next]')?.click()`);
        await h.ev(`document.querySelector('[data-jarvis-tour-next]')?.click()`);
        await wait(1200);
        const routes = await h.ev(CARD);
        const profileOpen = await h.ev(`!!document.querySelector('[data-jarvis-brief-modal="profile"]')`);
        steps.push({
            step: "7. the Profile track opens the Profile itself and lights the route rows",
            ok: profileOpen && routes?.step === "profile:routes" && routes.view === "spot",
            detail: JSON.stringify({ routes, profileOpen }),
        });
        await h.shot("cdp-shots/jarvis-tour-profile.png");

        await h.ev(`document.querySelector('[data-jarvis-tour-skip]')?.click()`);
        await wait(800);
        const afterSkip = {
            card: await h.ev(CARD),
            profile: await h.ev(`!!document.querySelector('[data-jarvis-brief-modal="profile"]')`),
        };
        steps.push({
            step: "8. Skip ends the track and closes the Profile it opened",
            ok: afterSkip.card == null && afterSkip.profile === false,
            detail: JSON.stringify(afterSkip),
        });

        for (const [n, track] of [["9", "initiatives"], ["10", "runsheet"]]) {
            await h.ev(`document.querySelector('[data-jarvis-tour-button]')?.click()`);
            await wait(300);
            await h.ev(`document.querySelector('[data-jarvis-tour-track="${track}"]')?.click()`);
            await wait(1500);
            const card = await h.ev(CARD);
            steps.push({
                step: `${n}. the ${track} track shows its first step, lit or centered`,
                ok: card != null && card.step.startsWith(track + ":") && (card.view === "spot" || card.view === "center"),
                detail: JSON.stringify(card),
            });
            await h.shot(`cdp-shots/jarvis-tour-${track}.png`);
            await h.ev(`document.querySelector('[data-jarvis-tour-skip]')?.click()`);
            await wait(800);
        }
        return steps;
    },
    async teardown(h) {
        await h.ev(`document.querySelector('[data-jarvis-tour-skip]')?.click()`).catch(() => {});
        await h.ev("localStorage.setItem('jarvis.tour.offered', 'true')").catch(() => {});
    },
};
```

If `pressKey` sits below this scenario in the file, move the scenario below `pressKey`'s definition or call
`h.cdp("Input.dispatchKeyEvent", …)` inline the same way.

**Step 7: Run it**

With the dev app running: `task verify:ui -- jarvis-tour brief-profile brief-surface`. Expected: all PASS. Open
`cdp-shots/index.html` and look at the shots: the spotlight sits on the named control, the card does not cover it,
the card reads in Vietnamese and then English, and the colors follow the theme.

**Step 8: Commit**

```bash
git add -- frontend/app/view/jarvis/jarvistour.tsx frontend/app/view/jarvis/jarvistouractions.ts frontend/app/view/jarvis/briefsurface.tsx frontend/app/store/keybindings/bindings.ts frontend/app/store/keybindings/dispatcher.ts scripts/cdp/scenarios.mjs
git commit -m "feat(jarvis): a step-by-step tour of the Brief, Initiatives, the run sheet and the Profile" -- frontend/app/view/jarvis/jarvistour.tsx frontend/app/view/jarvis/jarvistouractions.ts frontend/app/view/jarvis/briefsurface.tsx frontend/app/store/keybindings/bindings.ts frontend/app/store/keybindings/dispatcher.ts scripts/cdp/scenarios.mjs
```

---

### Task 4: Docs and changelog
**Depends on:** Task 3
**Files:** `docs/guide/jarvis.md`, `docs/keyboard-shortcuts.md`, `CHANGELOG.md`

**Step 1:** In `docs/guide/jarvis.md`, add a section after the opening paragraph's links (before `## Brief`):

```markdown
## Tour

Nút **?** trên header của Jarvis (cạnh **Profile**) mở bốn tour: **Brief**, **Initiatives**, **Run sheet** và
**Profile**. Mỗi bước làm sáng một chỗ trên màn hình kèm một thẻ giải thích, bằng tiếng Việt hoặc tiếng Anh (công tắc
**VI | EN** trên thẻ, được nhớ lại). `→` hoặc `Enter` sang bước kế, `←` về bước trước, `Esc` kết thúc. Tour tự mở
những gì bước cần (Profile, run sheet của run mới nhất) và đóng lại khi xong; bước nào không có gì để chỉ, như khi
chưa có run nào, hiện thẻ ở giữa màn hình. Lần đầu mở Jarvis, một thẻ nhỏ mời bạn xem tour Brief.
```

**Step 2:** In `docs/keyboard-shortcuts.md`, under `### Jarvis` (around line 240), add rows for the tour in that
table's own format: `→` / `Enter` next step, `←` previous step, `Esc` end the tour, all "while a Jarvis tour shows".

**Step 3:** In `CHANGELOG.md`, under the top section's `### Added`, add:

```markdown
- Jarvis has a tour: the **?** button in its header walks you through the Brief, Initiatives, the run sheet and the
  Profile one control at a time, in Vietnamese or English, and Jarvis offers it once the first time you open it.
```

The top section must still read `## Unreleased`; if it carries a date, open a new `## Unreleased` above it.

**Step 4: Commit.** `CHANGELOG.md` may hold other sessions' uncommitted lines: stage only yours. Build the staged
blob from HEAD plus your line (as `git show HEAD:CHANGELOG.md`, insert, `git hash-object -w`, `git update-index
--cacheinfo 100644,<blob>,CHANGELOG.md`), check `git diff --cached CHANGELOG.md` shows only your line, then:

```bash
git add -- docs/guide/jarvis.md docs/keyboard-shortcuts.md
git diff --cached --name-only   # exactly CHANGELOG.md, docs/guide/jarvis.md, docs/keyboard-shortcuts.md
git commit -m "docs(jarvis): the tour in the Jarvis guide, the shortcuts and the changelog"
```
