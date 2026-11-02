# Pet stay put — design

Date: 2026-11-02. Source: the brainstorm at `.superpowers/brainstorm/pet-stay-put/brainstorm.json`.

## Intent

The Jarvis pet (Sprout, `frontend/app/view/jarvis/petview.tsx`) wanders along the hints footer: every 5–15 s
it walks 80–400 px to a random spot (`petwalk.ts` `pickTarget`). The person wants to pin it to one spot, either
for a few hours or until they turn it off.

## What runs today

- `petwalk.ts` is a pure state machine: `rest` (5–15 s, with a pastime: read / music / work / ball), then `walk`
  to a random target, `sleep` after 10 minutes with no activity. Spider-Man sometimes goes up a strand to the app
  bar, crawls along it, hangs, and rappels down where the crawl left him (`startHang`, `hangX`).
- It avoids every terminal and toast that touches the ledge (`WalkerInput.avoid`, `clearSpot`).
- A drag persists the drop as home (`petstore.ts` `petHomeAtom`, `setPetHome`, localStorage).
- Reduced motion already places it at home and never walks it (`stepWalker`'s `input.reduce` branch).
- Pet settings live in Settings → Jarvis (`settingspages/jarvis.tsx`: character, outfit, Jarvis quotes;
  rows declared in `settingsmodel.ts`, reverts in `settingssurface.tsx`).
- The pet has no context menu; a left click opens the peek (`petpeek.tsx`), whose header holds the title,
  Full view (or Terminal in folded Sprout's peek) and a close button.

## Decisions

### 1. What staying means

While staying, the pet never walks to a new spot on its own. It still rests with its pastimes (read, music,
work, ball) and still sleeps. When a toast or a terminal covers its spot, it steps aside to the nearest clear
spot. Whenever it is away from home and home is clear (the toast went, or staying was just turned on while it
was elsewhere), it walks home at once, not when its current rest ends; asleep, it goes home when it wakes.

### 2. Where it is switched, and for how long

Two places, no context menu:

- **Settings → Jarvis**: a row "Pet roams" (a `Segmented`, like Outfit): Roam / Stay 1h / Stay 4h / Stay.
  Choosing 1h or 4h shows "until 15:30" (the local end time) on the row; when the time passes the pet roams
  again and the row is back on Roam.
- **The peek**: a pin button in the header, before Full view (and before Terminal in folded Sprout's peek).
  Clicking it opens a small menu: Stay 1 hour / Stay 4 hours / Stay until I turn it off / Roam again, with the
  current choice checked. The pin button is lit while the pet is staying.

The state is kept in localStorage like the other pet settings, so a restart keeps it staying, a timed stay
included (its end time is absolute).

### 3. The remaining cases

- The spot is the existing home (`petHomeAtom`): a drag while staying still moves it, and it stays at the new
  spot.
- At boot it stands at home instead of walking off (`initialWalker`).
- Ten minutes with no activity still puts it to sleep where it is.
- Spider-Man still goes up his strand to the app bar, but only hangs at the spot: no crawl along the bar, so he
  comes down where he went up.
- After stepping aside for a toast or terminal, it walks home and rests there.
- Turning staying on while it is away from home: it walks home and stays there.

### 4. A calmer roam

When roaming (not staying), the pace is slower for everyone, with no new setting: a rest (and its pastime)
lasts 1–3 minutes instead of 5–15 s (still doubled when tired), and a walk goes 80–200 px instead of
80–400 px (`petwalk.ts` `REST_MIN_MS`/`REST_MAX_MS`, `TARGET_MAX_PX`). The pet started out fun to watch
change, but at today's pace it is a distraction.

## Left to the builder

- Keep "stay until" in `petstore.ts` (localStorage; roam, an end time, or until turned off), and pass a
  `staying` flag in `WalkerInput`. When staying, `petwalk.ts` takes home (via `clearSpot`) as the target
  where it would call `pickTarget`, and a hang skips its crawl. One more walker rule: while staying, resting or
  walking anywhere but home with home clear retargets home at once (its own tests).
- `petview.tsx` steps the walker when a stay starts or ends (a step on toast removal already happens: the
  `toastCount` effect calls `run`).
- Expiry: `petview.tsx` sets a timer to the end time so the walker is stepped (and the store cleared) when a
  timed stay ends.
- Unit tests for the walker's staying behaviour and for the expiry logic (pure `.ts` beside its `.test.ts`).
- One `CHANGELOG.md` line under `Added`.
- A CDP scenario in `scripts/cdp/scenarios.mjs` that opens the peek's pin menu.
