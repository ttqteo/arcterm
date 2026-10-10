# Float minimized to Sprout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** While floating, minimize folds the window into a free-floating Sprout on top of every app; a click on
Sprout opens the Jarvis chat, and **Terminal** or a double-click gives the float window back.

**Architecture:** Mini is a state of float mode in the same Tauri window (`floatMiniAtom`). Entering it hides the
cockpit shell with `display: none` (so the terminal never refits), then shrinks the now see-through window to a box
around Sprout, always on top, with a cursor poll that makes the transparent margin click-through. The chat is the
existing pet peek (`PetPeek`) anchored to Sprout. Two macOS-only Rust commands hide the traffic lights and send the
yellow button to Sprout.

**Tech Stack:** Tauri 2.11 (`@tauri-apps/api` window API, `objc2` 0.6 / `objc2-app-kit` 0.3 on macOS), React 19,
jotai, Tailwind 4, vitest.

**Spec:** `docs/superpowers/specs/2026-10-10-float-mini-sprout-design.md`

**Verify:** `npx vitest run frontend/app/view/agents/floatwindow.test.ts frontend/app/view/agents/minihit.test.ts frontend/app/view/jarvis/petmini.test.ts`

**Final:** `if [ "$(uname -s)" = Darwin ]; then echo "unverified: float-mini needs CDP, which WKWebView on macOS does not answer"; exit 3; fi; node scripts/cdp/final-verify.mjs float-mini`

## Global Constraints

- One window, one webview: no second Tauri window for Sprout.
- The terminal never sees the small window: hide the shell (and wait two frames) **before** shrinking; give the
  window its float frame back **before** showing the shell.
- Colors only through `@theme` token utilities (`bg-surface-raised`, `text-muted`, `bg-warning`, …); no raw hex or
  rgba in `className`/`style` (DESIGN.md).
- Copy: the float bar button reads **Minimize** with title "Minimize to Sprout"; the restore buttons read
  **Terminal** with title "Restore the float window"; the chat's collapse button is titled "Collapse into Sprout
  (Esc)".
- Native code is macOS-only behind `#[cfg(target_os = "macos")]`; on Windows the two commands are no-ops.
- Outside float mode, minimize behaves exactly as today.
- Pure logic in `.ts` with a `.test.ts` beside it; no jsdom render tests.
- Typecheck with `NODE_OPTIONS=--max-old-space-size=4096 task check:ts` (8 GB Mac), timeout ≥ 5 min.
- Prettier/eslint only on touched files; never prettier `scripts/*.mjs`.
- Commits carry no co-author or attribution trailer.

## Review Focus

- A Sprout last dropped on a monitor that is no longer plugged in must float on the window's own monitor, on screen
  (Task 2 test "a Sprout left on a monitor that is gone floats on the window's own").
- Sprout dragged near a screen edge on a small screen: the chat gets shorter or narrower rather than pushing Sprout
  or opening off screen (Task 2 test "shortens the chat to the room there is").
- A reply that fails while folded must still be told: Sprout speaks and the bubble says "failed" (Task 3 test
  "marks a failed reply too"; Task 5 bubble).
- A reload while folded must not leave a tiny, frameless, click-through window: the full frame, shadow, traffic
  lights and cursor come back (Task 4 `giveFrameBack` and its manual check 6).
- Leaving float (`Shift+F`, a surface switch) while folded gives the float frame back first, then leaves float
  (Task 4 `exitFloat` and its manual check 5).

## Files

| File | Task |
|---|---|
| `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, `src-tauri/tauri.macos.conf.json`, `src-tauri/capabilities/default.json` | 1 |
| `src-tauri/src/macwindow.rs` *new*, `src-tauri/src/main.rs` | 1 |
| `frontend/app/view/agents/macwindow.ts` *new*, `frontend/app/view/agents/miniprobe.ts` *new (removed in 6)* | 1 |
| `frontend/app/view/agents/floatwindow.ts`, `floatwindow.test.ts` | 2 |
| `frontend/app/view/jarvis/petmini.ts` *new*, `petmini.test.ts` *new*, `frontend/app/view/agents/minihit.ts` *new*, `minihit.test.ts` *new* | 3 |
| `frontend/app/view/agents/floatstore.ts`, `miniclickthrough.ts` *new*, `frontend/app/view/jarvis/sproutsvg.tsx` *new*, `petfloatmark.tsx`, `frontend/app/cockpit/sprout-mini.tsx` *new*, `cockpit-root.tsx`, `float-bar.tsx`, `app-bar.tsx`, `frontend/tailwindsetup.css` | 4 |
| `frontend/app/view/jarvis/petpeek.tsx`, `peterrand.tsx`, `frontend/app/cockpit/sprout-mini.tsx` | 5 |
| `scripts/cdp/scenarios.mjs`, `docs/guide/agent.md`, `docs/guide/cockpit.md`, `CHANGELOG.md`, `docs/reference/architecture.md`, `AGENTS.md`, `frontend/app/cockpit/cockpit-root.tsx` (probe import out) | 6 |

## Spike results

Filled in at the end of Task 1, before Task 4 starts. Each line: macOS / Windows, pass or fail, and what it means for
Tasks 4–5.

1. Transparent window, full layout and float look as before: _
2. Click-through on the transparent margin: _
3. Traffic lights hide; yellow button reaches Sprout; `⌘M` follows the button: _
4. Growing around a fixed point, the square does not jump: _
5. No `[termwrap] resize` across shrink and restore: _
6. Memory and CPU while shrunk vs floating: _

A fail in 1 or 2 on a platform: make `MINI_TILE` in `sprout-mini.tsx` (Tasks 4–5) true on that platform, so Sprout
sits on a tile there.
A fail in 3: drop `redirectMinimize` from `enterFloat` (Task 4); the float bar's **Minimize** stays the trigger.

---

### Task 1: Platform layer and the spike

**Depends on:** none
**Files:** `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, `src-tauri/tauri.macos.conf.json`, `src-tauri/capabilities/default.json`, `src-tauri/src/macwindow.rs`, `src-tauri/src/main.rs`, `frontend/app/view/agents/macwindow.ts`, `frontend/app/view/agents/miniprobe.ts`, `frontend/app/cockpit/cockpit-root.tsx`

**Interfaces:**
- Produces: Tauri commands `set_traffic_lights_hidden { hidden: bool }`, `redirect_minimize { on: bool }`; event
  `"float-minimize"`. TS: `setTrafficLightsHidden(hidden: boolean): Promise<void>`,
  `redirectMinimize(on: boolean): Promise<void>`, `FLOAT_MINIMIZE_EVENT = "float-minimize"` in
  `frontend/app/view/agents/macwindow.ts`. The main window is created transparent.

- [ ] **Step 1: Make the window transparent and allow the new window calls**

`src-tauri/tauri.conf.json`: in `app`, add `"macOSPrivateApi": true` (tauri-build fails when the crate feature and
this flag disagree, so it is set in the base file for every platform); in the `main` window object add
`"transparent": true`.

```json
  "app": {
    "macOSPrivateApi": true,
    "windows": [
      {
        "label": "main",
        "title": "arcterm",
        "width": 1440,
        "height": 900,
        "minWidth": 1280,
        "minHeight": 680,
        "center": true,
        "maximized": true,
        "decorations": false,
        "transparent": true,
        "dragDropEnabled": false
      }
    ],
```

`src-tauri/tauri.macos.conf.json`: the `windows` array replaces the base one whole, so add `"transparent": true` to
its `main` window too (after `"maximized": true`).

`src-tauri/Cargo.toml`: `tauri = { version = "2", features = ["macos-private-api"] }`, and under the existing
`[target.'cfg(target_os = "macos")'.dependencies]`:

```toml
# the float's traffic lights and yellow button (macwindow.rs), which Tauri cannot hide or redirect. Pinned to the
# versions already in the tree via tao.
objc2 = "=0.6.4"
objc2-app-kit = { version = "=0.3.2", default-features = false, features = ["std", "NSButton", "NSControl", "NSResponder", "NSView", "NSWindow"] }
```

`src-tauri/capabilities/default.json`: add to `permissions`, after `"core:window:allow-set-position"`:

```json
    "core:window:allow-set-ignore-cursor-events",
    "core:window:allow-set-shadow",
    "core:window:allow-cursor-position",
```

- [ ] **Step 2: Write `src-tauri/src/macwindow.rs`**

```rust
// The float's macOS window chrome (floatstore.ts): hide the traffic lights while the float is folded into Sprout,
// and send the yellow button to Sprout instead of the Dock while floating. Tauri can do neither, so this talks to
// AppKit. Commands that are not async run on the main thread, which AppKit requires; the marker check turns a
// mistake there into an error instead of undefined behaviour. Both are no-ops on other platforms.

use tauri::WebviewWindow;

#[cfg(target_os = "macos")]
mod imp {
    use std::cell::RefCell;
    use std::sync::OnceLock;

    use objc2::rc::Retained;
    use objc2::runtime::{AnyObject, NSObject, Sel};
    use objc2::{define_class, msg_send, sel, MainThreadMarker, MainThreadOnly};
    use objc2_app_kit::{NSWindow, NSWindowButton};
    use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

    static APP: OnceLock<AppHandle> = OnceLock::new();

    define_class!(
        // SAFETY: NSObject has no subclassing requirements, and this class does not implement Drop.
        #[unsafe(super(NSObject))]
        #[thread_kind = MainThreadOnly]
        #[name = "ArcFloatMinimizeTarget"]
        struct MinimizeTarget;

        impl MinimizeTarget {
            #[unsafe(method(minimizeToSprout:))]
            fn minimize_to_sprout(&self, _sender: Option<&AnyObject>) {
                if let Some(app) = APP.get() {
                    let _ = app.emit("float-minimize", ());
                }
            }
        }
    );

    impl MinimizeTarget {
        fn new(mtm: MainThreadMarker) -> Retained<Self> {
            unsafe { msg_send![Self::alloc(mtm), init] }
        }
    }

    // A button holds its target weakly, so the redirect keeps it alive here, with the target and action the button
    // gets back when float ends.
    struct Redirect {
        _target: Retained<MinimizeTarget>,
        original_target: Option<Retained<AnyObject>>,
        original_action: Option<Sel>,
    }

    thread_local! {
        static REDIRECT: RefCell<Option<Redirect>> = const { RefCell::new(None) };
    }

    fn ns_window<'a>(window: &'a WebviewWindow, _mtm: MainThreadMarker) -> Result<&'a NSWindow, String> {
        let ptr = window.ns_window().map_err(|e| e.to_string())?;
        // SAFETY: Tauri hands back this window's live NSWindow*, which outlives the call, and we are on the main thread
        Ok(unsafe { &*(ptr as *const NSWindow) })
    }

    pub fn set_traffic_lights_hidden(window: &WebviewWindow, hidden: bool) -> Result<(), String> {
        let mtm = MainThreadMarker::new().ok_or("not on the main thread")?;
        let ns = ns_window(window, mtm)?;
        for kind in [NSWindowButton::CloseButton, NSWindowButton::MiniaturizeButton, NSWindowButton::ZoomButton] {
            if let Some(button) = ns.standardWindowButton(kind) {
                button.setHidden(hidden);
            }
        }
        Ok(())
    }

    pub fn redirect_minimize(window: &WebviewWindow, on: bool) -> Result<(), String> {
        let mtm = MainThreadMarker::new().ok_or("not on the main thread")?;
        let _ = APP.set(window.app_handle().clone());
        let ns = ns_window(window, mtm)?;
        let Some(button) = ns.standardWindowButton(NSWindowButton::MiniaturizeButton) else {
            return Ok(());
        };
        REDIRECT.with(|cell| {
            let mut slot = cell.borrow_mut();
            if on && slot.is_none() {
                let target = MinimizeTarget::new(mtm);
                let original_target = button.target();
                let original_action = button.action();
                let as_object: &AnyObject = &target;
                // SAFETY: the target is kept alive in REDIRECT for as long as the button points at it
                unsafe {
                    button.setTarget(Some(as_object));
                    button.setAction(Some(sel!(minimizeToSprout:)));
                }
                *slot = Some(Redirect { _target: target, original_target, original_action });
            } else if !on {
                if let Some(r) = slot.take() {
                    // SAFETY: these are the button's own target and action from before the redirect
                    unsafe {
                        button.setTarget(r.original_target.as_deref());
                        button.setAction(r.original_action);
                    }
                }
            }
        });
        Ok(())
    }
}

#[tauri::command]
pub fn set_traffic_lights_hidden(window: WebviewWindow, hidden: bool) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    return imp::set_traffic_lights_hidden(&window, hidden);
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (window, hidden);
        Ok(())
    }
}

#[tauri::command]
pub fn redirect_minimize(window: WebviewWindow, on: bool) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    return imp::redirect_minimize(&window, on);
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (window, on);
        Ok(())
    }
}
```

- [ ] **Step 3: Register the module and commands in `src-tauri/src/main.rs`**

Add `mod macwindow;` after `mod init;` (keep the list's order as it is otherwise), and the two commands to
`generate_handler!`:

```rust
        .invoke_handler(tauri::generate_handler![
            init::get_init,
            init::fe_log,
            commands::set_window_init_status,
            commands::open_external,
            canvas::capture_webview,
            notify::notify_os,
            macwindow::set_traffic_lights_hidden,
            macwindow::redirect_minimize
        ])
```

- [ ] **Step 4: Build and test the host**

Run (a Mac needs `PATH="/opt/homebrew/opt/rustup/bin:$PATH"` first): `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: compiles with no errors; existing tests PASS. If `define_class!` or a method name does not compile, read
`~/.cargo/registry/src/*/objc2-0.6.4/src/macros/define_class.rs` and
`~/.cargo/registry/src/*/objc2-app-kit-0.3.2/src/generated/NSControl.rs`; the shapes above follow them.

- [ ] **Step 5: Write `frontend/app/view/agents/macwindow.ts`**

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The float's macOS window chrome, from src-tauri/src/macwindow.rs: hide the traffic lights while folded into Sprout,
// and send the yellow button to Sprout while floating (it emits FLOAT_MINIMIZE_EVENT). No-ops elsewhere.

import { isMacOS } from "@/util/platformutil";
import { invoke } from "@tauri-apps/api/core";

export const FLOAT_MINIMIZE_EVENT = "float-minimize";

export async function setTrafficLightsHidden(hidden: boolean): Promise<void> {
    if (isMacOS()) {
        await invoke("set_traffic_lights_hidden", { hidden });
    }
}

export async function redirectMinimize(on: boolean): Promise<void> {
    if (isMacOS()) {
        await invoke("redirect_minimize", { on });
    }
}
```

- [ ] **Step 6: Write the dev-only probe `frontend/app/view/agents/miniprobe.ts`**

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Dev-only spike for float mini (docs/superpowers/specs/2026-10-10-float-mini-sprout-design.md, "Spike first"), run
// from the devtools console while floating:
//   await __arcMiniProbe.shrink()          hide the page; a see-through 200px window on top, a stand-in Sprout
//                                          square that alone takes clicks ("[miniprobe] hit")
//   await __arcMiniProbe.grow()            grow to 380x620 around the square's corner
//   await __arcMiniProbe.restore()         give the frame back
//   await __arcMiniProbe.listenMinimize()  redirect the yellow button; a click logs "[miniprobe] float-minimize"
//   await __arcMiniProbe.unredirect()
// Removed by the plan's last task.

import { listen } from "@tauri-apps/api/event";
import {
    cursorPosition,
    getCurrentWindow,
    LogicalSize,
    PhysicalPosition,
    PhysicalSize,
} from "@tauri-apps/api/window";
import { FLOAT_MIN_SIZE } from "./floatwindow";
import { FLOAT_MINIMIZE_EVENT, redirectMinimize, setTrafficLightsHidden } from "./macwindow";

if (import.meta.env.DEV) {
    const win = getCurrentWindow();
    let saved: { x: number; y: number; width: number; height: number } | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    let square: HTMLDivElement | null = null;

    const shrink = async () => {
        const [pos, size] = await Promise.all([win.outerPosition(), win.outerSize()]);
        saved = { x: pos.x, y: pos.y, width: size.width, height: size.height };
        const main = document.getElementById("main");
        if (main != null) {
            main.style.display = "none";
        }
        document.documentElement.style.background = "transparent";
        document.body.style.background = "transparent";
        square = document.createElement("div");
        Object.assign(square.style, {
            position: "fixed",
            right: "8px",
            bottom: "8px",
            width: "64px",
            height: "64px",
            borderRadius: "8px",
            background: "var(--color-accent)",
        });
        square.onclick = () => console.log("[miniprobe] hit");
        document.body.appendChild(square);
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        await setTrafficLightsHidden(true);
        await win.setShadow(false);
        await win.setMinSize(null);
        await win.setSize(new LogicalSize(200, 200));
        await win.setAlwaysOnTop(true);
        let ignoring: boolean | null = null;
        poll = setInterval(async () => {
            if (square == null) {
                return;
            }
            const [c, inner, scale] = await Promise.all([cursorPosition(), win.innerPosition(), win.scaleFactor()]);
            const r = square.getBoundingClientRect();
            const x = (c.x - inner.x) / scale;
            const y = (c.y - inner.y) / scale;
            const hit = x >= r.left && x < r.right && y >= r.top && y < r.bottom;
            if (ignoring !== !hit) {
                ignoring = !hit;
                await win.setIgnoreCursorEvents(!hit);
            }
        }, 1000 / 15);
    };

    const grow = async () => {
        const [pos, size, scale] = await Promise.all([win.outerPosition(), win.outerSize(), win.scaleFactor()]);
        const w = Math.round(380 * scale);
        const h = Math.round(620 * scale);
        await win.setSize(new PhysicalSize(w, h));
        await win.setPosition(new PhysicalPosition(pos.x + size.width - w, pos.y + size.height - h));
    };

    const restore = async () => {
        if (poll != null) {
            clearInterval(poll);
            poll = null;
        }
        await win.setIgnoreCursorEvents(false);
        await win.setShadow(true);
        await setTrafficLightsHidden(false);
        if (saved != null) {
            await win.setSize(new PhysicalSize(saved.width, saved.height));
            await win.setPosition(new PhysicalPosition(saved.x, saved.y));
        }
        await win.setMinSize(new LogicalSize(FLOAT_MIN_SIZE.width, FLOAT_MIN_SIZE.height));
        await win.setAlwaysOnTop(false);
        square?.remove();
        square = null;
        document.documentElement.style.background = "";
        document.body.style.background = "#1a1a1a";
        const main = document.getElementById("main");
        if (main != null) {
            main.style.display = "";
        }
    };

    const listenMinimize = async () => {
        await redirectMinimize(true);
        await listen(FLOAT_MINIMIZE_EVENT, () => console.log("[miniprobe] float-minimize"));
    };

    (globalThis as Record<string, unknown>).__arcMiniProbe = {
        shrink,
        grow,
        restore,
        listenMinimize,
        unredirect: () => redirectMinimize(false),
    };
}
```

In `frontend/app/cockpit/cockpit-root.tsx`, add after the last `@/app/view/agents/...` import:

```ts
// dev-only spike hook for float mini; removed by the plan's last task
import "@/app/view/agents/miniprobe";
```

- [ ] **Step 7: Typecheck and lint the touched frontend files**

Run: `NODE_OPTIONS=--max-old-space-size=4096 task check:ts` (timeout 5 min)
Expected: exit 0.
Run: `npx eslint frontend/app/view/agents/macwindow.ts frontend/app/view/agents/miniprobe.ts && npx prettier --check frontend/app/view/agents/macwindow.ts frontend/app/view/agents/miniprobe.ts`
Expected: clean.

- [ ] **Step 8: Run the spike with the person (they look; an agent cannot)**

Ask the person to run `task dev` on the Mac, open Safari → Develop → this Mac → arcterm (dev) for the console, and go
through:

1. The full layout and float (`Shift+F`) look exactly as before: no see-through gaps, corners and shadow as before.
2. While floating: `await __arcMiniProbe.shrink()`. Only a blue square shows, no frame, no traffic lights. Clicks
   beside the square, inside the old 200px box, reach the app behind; a click on the square logs `[miniprobe] hit`.
3. `await __arcMiniProbe.restore()`, then `await __arcMiniProbe.listenMinimize()`: the yellow light logs
   `[miniprobe] float-minimize` and the window stays; then `⌘M`: does it log, or go to the Dock? Then
   `await __arcMiniProbe.unredirect()` and check the yellow light minimizes to the Dock again.
4. `shrink()`, then `grow()`: does the square jump visibly? Then `restore()`.
5. The console shows no `[termwrap] resize` line between `shrink()` and `restore()`.
6. Activity Monitor: arcterm's processes summed (memory) while floating vs while shrunk; CPU of its WebContent
   process while shrunk and idle (expected under 1%).

If a Windows machine is at hand, the same steps through `node scripts/cdp/attach.mjs`-driven console or F12 devtools;
otherwise record Windows as "unverified until the CDP scenario in Task 6".

Write each result into **Spike results** above.

- [ ] **Step 9: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json src-tauri/tauri.macos.conf.json src-tauri/capabilities/default.json src-tauri/src/macwindow.rs src-tauri/src/main.rs frontend/app/view/agents/macwindow.ts frontend/app/view/agents/miniprobe.ts frontend/app/cockpit/cockpit-root.tsx docs/superpowers/plans/2026-10-10-float-mini-sprout.md
git commit -m "feat(float): a transparent window and macOS traffic-light commands for folding the float into Sprout"
```

---

### Task 2: Mini window geometry

**Depends on:** none
**Files:** `frontend/app/view/agents/floatwindow.ts`, `frontend/app/view/agents/floatwindow.test.ts`

**Interfaces:**
- Produces (in `floatwindow.ts`): `MINI_SPROUT_BOX = 80`, `MINI_REST_SIZE = { width: 340, height: 112 }`,
  `MINI_CHAT_SIZE = { width: 380, height: 620 }`, `interface MiniSides { h: "left" | "right"; v: "up" | "down" }`,
  `interface MiniRestore { rect: WinRect; pinned: boolean }`,
  `miniSides(sprout: WinRect, work: WinRect): MiniSides`,
  `miniSproutRect(last: WinRect | null, work: WinRect, scale: number): WinRect`,
  `miniWindowRect(sprout: WinRect, size: { width: number; height: number }, sides: MiniSides, work: WinRect, scale: number): WinRect`,
  `sproutFromWindow(win: WinRect, sides: MiniSides, scale: number): WinRect`,
  `parseMiniRestore(raw: unknown): MiniRestore | null`. All rects physical px; sizes logical.

- [ ] **Step 1: Write the failing tests**

Append to `frontend/app/view/agents/floatwindow.test.ts` (the file's `laptop` and `side` screens are reused), and
extend its import:

```ts
import {
    FLOAT_DEFAULT_SIZE,
    FLOAT_MIN_SIZE,
    floatRect,
    MINI_CHAT_SIZE,
    MINI_REST_SIZE,
    miniSides,
    miniSproutRect,
    miniWindowRect,
    parseMiniRestore,
    parseRect,
    parseRestore,
    screenFor,
    sproutFromWindow,
    type MiniSides,
} from "./floatwindow";
```

```ts
describe("miniSproutRect", () => {
    it("puts a first Sprout in the bottom-right corner of the work area, 24px in", () => {
        expect(miniSproutRect(null, laptop, 2)).toEqual({
            x: laptop.x + laptop.width - 160 - 48,
            y: laptop.y + laptop.height - 160 - 48,
            width: 160,
            height: 160,
        });
    });
    it("goes back where it was dropped", () => {
        expect(miniSproutRect({ x: 100, y: 300, width: 160, height: 160 }, laptop, 2)).toEqual({
            x: 100,
            y: 300,
            width: 160,
            height: 160,
        });
    });
    it("pulls a Sprout left off the screen back onto it", () => {
        expect(miniSproutRect({ x: -500, y: 5000, width: 160, height: 160 }, laptop, 2)).toEqual({
            x: 0,
            y: laptop.y + laptop.height - 160,
            width: 160,
            height: 160,
        });
    });
    it("takes its size from this screen's scale, not the stored one", () => {
        expect(miniSproutRect({ x: 3000, y: 100, width: 160, height: 160 }, side, 1)).toMatchObject({
            width: 80,
            height: 80,
        });
    });
    it("a Sprout left on a monitor that is gone floats on the window's own", () => {
        const gone = { x: 9000, y: 200, width: 80, height: 80 };
        const screen = screenFor(gone, [{ area: laptop, scale: 2 }], { area: laptop, scale: 2 });
        const r = miniSproutRect(gone, screen.area, screen.scale);
        expect(r.x + r.width).toBeLessThanOrEqual(laptop.x + laptop.width);
        expect(r.y).toBeGreaterThanOrEqual(laptop.y);
    });
});

describe("miniSides", () => {
    it("opens left and up from the bottom-right corner", () => {
        expect(miniSides({ x: 2600, y: 1600, width: 160, height: 160 }, laptop)).toEqual({ h: "left", v: "up" });
    });
    it("opens right and down from the top-left corner", () => {
        expect(miniSides({ x: 40, y: 90, width: 160, height: 160 }, laptop)).toEqual({ h: "right", v: "down" });
    });
});

describe("miniWindowRect", () => {
    const corner = { x: 2600, y: 1600, width: 160, height: 160 };
    it("rests in a box with Sprout in its bottom-right corner when things open left and up", () => {
        expect(miniWindowRect(corner, MINI_REST_SIZE, { h: "left", v: "up" }, laptop, 2)).toEqual({
            x: 2600 + 160 - 680,
            y: 1600 + 160 - 224,
            width: 680,
            height: 224,
        });
    });
    it("opens right and down from a Sprout in the top-left corner", () => {
        const topLeft = { x: 40, y: 90, width: 160, height: 160 };
        expect(miniWindowRect(topLeft, MINI_CHAT_SIZE, { h: "right", v: "down" }, laptop, 2)).toEqual({
            x: 40,
            y: 90,
            width: 760,
            height: 1240,
        });
    });
    it("shortens the chat to the room there is rather than moving Sprout", () => {
        const small = { x: 0, y: 0, width: 1280, height: 700 };
        const low = { x: 1176, y: 480, width: 80, height: 80 };
        expect(miniWindowRect(low, MINI_CHAT_SIZE, { h: "left", v: "up" }, small, 1)).toEqual({
            x: 1176 + 80 - 380,
            y: 0,
            width: 380,
            height: 560,
        });
    });
});

describe("sproutFromWindow", () => {
    it("finds Sprout again from the window around it, whichever way it opens", () => {
        const corner = { x: 2600, y: 1600, width: 160, height: 160 };
        const all: MiniSides[] = [
            { h: "left", v: "up" },
            { h: "right", v: "down" },
            { h: "left", v: "down" },
            { h: "right", v: "up" },
        ];
        for (const sides of all) {
            const win = miniWindowRect(corner, MINI_CHAT_SIZE, sides, laptop, 2);
            expect(sproutFromWindow(win, sides, 2)).toEqual(corner);
        }
    });
});

describe("parseMiniRestore", () => {
    it("reads back what was stored", () => {
        const stored = { rect: { x: 10, y: 20, width: 720, height: 460 }, pinned: true };
        expect(parseMiniRestore(JSON.parse(JSON.stringify(stored)))).toEqual(stored);
    });
    it("rejects a value without its pin or with a broken rect", () => {
        expect(parseMiniRestore({ rect: { x: 10, y: 20, width: 720, height: 460 } })).toBeNull();
        expect(parseMiniRestore({ rect: { x: 10 }, pinned: false })).toBeNull();
        expect(parseMiniRestore("junk")).toBeNull();
    });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run frontend/app/view/agents/floatwindow.test.ts`
Expected: FAIL (`miniSproutRect` and the rest are not exported).

- [ ] **Step 3: Implement in `frontend/app/view/agents/floatwindow.ts`**

Append:

```ts
// Float folded into Sprout (floatstore.ts enterMini). The window becomes a see-through box around Sprout and grows
// for the chat, always around Sprout's own place on screen, so Sprout never moves when the chat opens or closes.
// Sprout's box is logical px here and physical in the rects, like the float's.
export const MINI_SPROUT_BOX = 80; // the 64px sprite with room for its bob, its shadow and the count chip
export const MINI_REST_SIZE = { width: 340, height: 112 }; // room beside Sprout for the hover chip and the reply bubble
export const MINI_CHAT_SIZE = { width: 380, height: 620 };
const MINI_MARGIN = 24;

// which way from Sprout the chip, the bubble and the chat open: toward the middle of the screen
export interface MiniSides {
    h: "left" | "right";
    v: "up" | "down";
}

// what giving the float window back needs
export interface MiniRestore {
    rect: WinRect;
    pinned: boolean;
}

export function miniSides(sprout: WinRect, work: WinRect): MiniSides {
    const cx = sprout.x + sprout.width / 2;
    const cy = sprout.y + sprout.height / 2;
    return {
        h: cx >= work.x + work.width / 2 ? "left" : "right",
        v: cy >= work.y + work.height / 2 ? "up" : "down",
    };
}

// Sprout's box on screen: where it was last dropped, pulled back on screen, or in the work area's bottom-right
// corner, out of the way like a first float
export function miniSproutRect(last: WinRect | null, work: WinRect, scale: number): WinRect {
    const size = MINI_SPROUT_BOX * scale;
    const margin = MINI_MARGIN * scale;
    const x = last?.x ?? work.x + work.width - size - margin;
    const y = last?.y ?? work.y + work.height - size - margin;
    return {
        x: clamp(x, work.x, work.x + work.width - size),
        y: clamp(y, work.y, work.y + work.height - size),
        width: size,
        height: size,
    };
}

// The window around Sprout's box at a logical size, Sprout in the corner away from where things open, cut to the room
// the work area has on those sides rather than moving Sprout
export function miniWindowRect(
    sprout: WinRect,
    size: { width: number; height: number },
    sides: MiniSides,
    work: WinRect,
    scale: number
): WinRect {
    const roomX = sides.h === "left" ? sprout.x + sprout.width - work.x : work.x + work.width - sprout.x;
    const roomY = sides.v === "up" ? sprout.y + sprout.height - work.y : work.y + work.height - sprout.y;
    const width = Math.min(Math.round(size.width * scale), roomX);
    const height = Math.min(Math.round(size.height * scale), roomY);
    return {
        x: sides.h === "left" ? sprout.x + sprout.width - width : sprout.x,
        y: sides.v === "up" ? sprout.y + sprout.height - height : sprout.y,
        width,
        height,
    };
}

// Sprout's box from the window around it, the inverse of miniWindowRect: a drag moves the window, and this is where
// it put Sprout
export function sproutFromWindow(win: WinRect, sides: MiniSides, scale: number): WinRect {
    const size = MINI_SPROUT_BOX * scale;
    return {
        x: sides.h === "left" ? win.x + win.width - size : win.x,
        y: sides.v === "up" ? win.y + win.height - size : win.y,
        width: size,
        height: size,
    };
}

export function parseMiniRestore(raw: unknown): MiniRestore | null {
    const r = raw as Partial<MiniRestore> | null;
    if (r == null || typeof r !== "object") {
        return null;
    }
    const rect = parseRect(r.rect);
    if (rect == null || typeof r.pinned !== "boolean") {
        return null;
    }
    return { rect, pinned: r.pinned };
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run frontend/app/view/agents/floatwindow.test.ts`
Expected: PASS, the old float tests included.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/view/agents/floatwindow.ts frontend/app/view/agents/floatwindow.test.ts
git commit -m "feat(float): where the folded float's window sits around Sprout"
```

---

### Task 3: Sprout's look and the click-through hit test

**Depends on:** none
**Files:** `frontend/app/view/jarvis/petmini.ts`, `frontend/app/view/jarvis/petmini.test.ts`, `frontend/app/view/agents/minihit.ts`, `frontend/app/view/agents/minihit.test.ts`

**Interfaces:**
- Produces (`petmini.ts`): `interface MiniLookInput { posture: PetPosture; waiting: number; errand: PetErrand | null; unread: boolean; chatOpen: boolean; frame: 0 | 1 }`,
  `interface MiniLook { pose: PetPose; marks: PetMark[]; chip: number | null; bob: boolean; label: string }`,
  `miniLook(input: MiniLookInput): MiniLook`,
  `nextUnread(prev: PetErrand | null, next: PetErrand | null, chatOpen: boolean, unread: boolean): boolean`.
- Produces (`minihit.ts`): `interface Point { x: number; y: number }`,
  `interface Box { left: number; top: number; right: number; bottom: number }` (a `DOMRect` fits),
  `hitAny(p: Point, boxes: readonly Box[]): boolean`, `toPagePoint(cursor: Point, inner: Point, scale: number): Point`.

- [ ] **Step 1: Write the failing tests**

`frontend/app/view/jarvis/petmini.test.ts`:

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { miniLook, nextUnread, type MiniLookInput } from "./petmini";
import type { PetErrand } from "./petstore";

const errand = (status: PetErrand["status"]): PetErrand => ({
    prompt: "What is arc-dev stuck on?",
    runtime: "claude",
    text: "arc-dev is waiting on a plan review.",
    status,
});
const base: MiniLookInput = { posture: "none", waiting: 0, errand: null, unread: false, chatOpen: false, frame: 0 };

describe("miniLook", () => {
    it("stands bare when there is nothing to say", () => {
        expect(miniLook(base)).toEqual({ pose: "stand", marks: [], chip: null, bob: false, label: "Open Jarvis chat" });
    });
    it("types at the laptop while a reply streams, one frame per tick", () => {
        expect(miniLook({ ...base, errand: errand("streaming") }).pose).toBe("work1");
        expect(miniLook({ ...base, errand: errand("streaming"), frame: 1 }).pose).toBe("work2");
        expect(miniLook({ ...base, errand: errand("streaming") }).label).toBe("Open Jarvis chat — thinking");
    });
    it("speaks with the unread mark when a reply landed while folded", () => {
        expect(miniLook({ ...base, errand: errand("done"), unread: true })).toMatchObject({
            pose: "speak",
            marks: ["unread"],
            label: "Open Jarvis chat — new reply",
        });
    });
    it("stops telling once the chat is open", () => {
        expect(miniLook({ ...base, errand: errand("done"), unread: true, chatOpen: true })).toMatchObject({
            pose: "stand",
            marks: [],
            label: "Collapse Jarvis chat",
        });
    });
    it("wears the review gate's eye and counts what waits", () => {
        expect(miniLook({ ...base, posture: "review-gate", waiting: 2 })).toMatchObject({
            marks: ["gate"],
            chip: 2,
            label: "Open Jarvis chat — 2 waiting on you",
        });
    });
    it("counts a plain question with the chip alone", () => {
        expect(miniLook({ ...base, waiting: 1 })).toMatchObject({ marks: [], chip: 1 });
    });
    it("lets the posture's mark win over the unread mark", () => {
        expect(miniLook({ ...base, posture: "escalation", errand: errand("done"), unread: true })).toMatchObject({
            pose: "speak",
            marks: ["escalation"],
        });
    });
    it("wears no mark while typing, so the notes above its head stay clear", () => {
        expect(miniLook({ ...base, posture: "review-gate", errand: errand("streaming") }).marks).toEqual([]);
    });
    it("bobs up on the second frame", () => {
        expect(miniLook({ ...base, frame: 1 }).bob).toBe(true);
        expect(miniLook(base).bob).toBe(false);
    });
});

describe("nextUnread", () => {
    it("marks a reply that finishes while folded", () => {
        expect(nextUnread(errand("streaming"), errand("done"), false, false)).toBe(true);
    });
    it("marks a failed reply too", () => {
        expect(nextUnread(errand("streaming"), errand("error"), false, false)).toBe(true);
    });
    it("clears when the chat opens", () => {
        expect(nextUnread(errand("done"), errand("done"), true, true)).toBe(false);
    });
    it("clears when the errand goes away", () => {
        expect(nextUnread(errand("done"), null, false, true)).toBe(false);
    });
    it("keeps what it had otherwise", () => {
        expect(nextUnread(errand("done"), errand("done"), false, true)).toBe(true);
        expect(nextUnread(null, errand("streaming"), false, false)).toBe(false);
    });
});
```

`frontend/app/view/agents/minihit.test.ts`:

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { hitAny, toPagePoint } from "./minihit";

const sprout = { left: 260, top: 32, right: 340, bottom: 112 };
const chip = { left: 40, top: 70, right: 250, bottom: 100 };

describe("hitAny", () => {
    it("hits inside a drawn box", () => {
        expect(hitAny({ x: 300, y: 70 }, [sprout, chip])).toBe(true);
        expect(hitAny({ x: 41, y: 99 }, [sprout, chip])).toBe(true);
    });
    it("passes through the see-through margin", () => {
        expect(hitAny({ x: 255, y: 70 }, [sprout, chip])).toBe(false);
        expect(hitAny({ x: 10, y: 10 }, [sprout, chip])).toBe(false);
    });
    it("counts the left and top edges in and the right and bottom edges out", () => {
        expect(hitAny({ x: 260, y: 32 }, [sprout])).toBe(true);
        expect(hitAny({ x: 340, y: 50 }, [sprout])).toBe(false);
        expect(hitAny({ x: 300, y: 112 }, [sprout])).toBe(false);
    });
    it("passes everything through when nothing is drawn", () => {
        expect(hitAny({ x: 300, y: 70 }, [])).toBe(false);
    });
});

describe("toPagePoint", () => {
    it("turns the screen's physical cursor into the page's CSS pixels", () => {
        expect(toPagePoint({ x: 2600, y: 1700 }, { x: 2000, y: 1500 }, 2)).toEqual({ x: 300, y: 100 });
    });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run frontend/app/view/jarvis/petmini.test.ts frontend/app/view/agents/minihit.test.ts`
Expected: FAIL (modules not found).

- [ ] **Step 3: Write `frontend/app/view/jarvis/petmini.ts`**

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What Sprout looks like while the float is folded into it (cockpit/sprout-mini.tsx): the walking pet's posture marks,
// a count of what waits, the errand's progress and a reply nobody has read. Pure, like petcondition.ts.

import type { PetPosture } from "./petcondition";
import type { PetMark, PetPose } from "./petsprite";
import type { PetErrand } from "./petstore";
import { POSTURE_MARK } from "./petwalk";

export interface MiniLookInput {
    posture: PetPosture;
    waiting: number;
    errand: PetErrand | null;
    unread: boolean;
    chatOpen: boolean;
    // the bob's tick: up on 1, and the typing pose's second frame
    frame: 0 | 1;
}

export interface MiniLook {
    pose: PetPose;
    marks: PetMark[];
    chip: number | null;
    bob: boolean;
    label: string;
}

export function miniLook(input: MiniLookInput): MiniLook {
    const busy = input.errand?.status === "streaming";
    const told = input.unread && !input.chatOpen;
    const postureMark = POSTURE_MARK[input.posture];
    const pose: PetPose = busy ? (input.frame === 0 ? "work1" : "work2") : told ? "speak" : "stand";
    // the typing pose draws notes where the marks go
    const marks: PetMark[] = busy ? [] : postureMark != null ? [postureMark] : told ? ["unread"] : [];
    const chip = input.waiting > 0 ? input.waiting : null;
    const status = chip != null ? `${chip} waiting on you` : busy ? "thinking" : told ? "new reply" : null;
    const label = input.chatOpen
        ? "Collapse Jarvis chat"
        : status == null
          ? "Open Jarvis chat"
          : `Open Jarvis chat — ${status}`;
    return { pose, marks, chip, bob: input.frame === 1, label };
}

// A reply that lands, or fails, while the chat is folded stays unread until the chat opens or its bubble is dismissed:
// a folded window is where a reply is easiest to miss.
export function nextUnread(
    prev: PetErrand | null,
    next: PetErrand | null,
    chatOpen: boolean,
    unread: boolean
): boolean {
    if (chatOpen || next == null) {
        return false;
    }
    if (prev?.status === "streaming" && next.status !== "streaming") {
        return true;
    }
    return unread;
}
```

- [ ] **Step 4: Write `frontend/app/view/agents/minihit.ts`**

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The float folded into Sprout is a see-through window larger than what it draws. A click on the see-through part
// must reach the app behind, so the window ignores the cursor unless it is over a drawn element
// (miniclickthrough.ts polls the cursor and asks this). Pure.

export interface Point {
    x: number;
    y: number;
}

// a DOMRect fits
export interface Box {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

export function hitAny(p: Point, boxes: readonly Box[]): boolean {
    return boxes.some((b) => p.x >= b.left && p.x < b.right && p.y >= b.top && p.y < b.bottom);
}

// the cursor, in the screen's physical pixels, as the page's CSS pixels
export function toPagePoint(cursor: Point, inner: Point, scale: number): Point {
    return { x: (cursor.x - inner.x) / scale, y: (cursor.y - inner.y) / scale };
}
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `npx vitest run frontend/app/view/jarvis/petmini.test.ts frontend/app/view/agents/minihit.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/view/jarvis/petmini.ts frontend/app/view/jarvis/petmini.test.ts frontend/app/view/agents/minihit.ts frontend/app/view/agents/minihit.test.ts
git commit -m "feat(pet): how Sprout looks folded, and which clicks the folded window takes"
```

---

### Task 4: Fold the float into Sprout and back

**Depends on:** Task 1, Task 2, Task 3
**Files:** `frontend/app/view/agents/floatstore.ts`, `frontend/app/view/agents/miniclickthrough.ts`, `frontend/app/view/jarvis/sproutsvg.tsx`, `frontend/app/view/jarvis/petfloatmark.tsx`, `frontend/app/cockpit/sprout-mini.tsx`, `frontend/app/cockpit/cockpit-root.tsx`, `frontend/app/cockpit/float-bar.tsx`, `frontend/app/cockpit/app-bar.tsx`, `frontend/tailwindsetup.css`

**Interfaces:**
- Consumes: Task 1's `setTrafficLightsHidden`, `redirectMinimize`, `FLOAT_MINIMIZE_EVENT`; Task 2's geometry; Task 3's
  `miniLook`, `hitAny`, `toPagePoint`.
- Produces (`floatstore.ts`): `floatMiniAtom: PrimitiveAtom<boolean>`, `miniSidesAtom: PrimitiveAtom<MiniSides>`,
  `miniResizingAtom: PrimitiveAtom<boolean>`, `enterMini(): Promise<void>`, `exitMini(): Promise<void>`,
  `resizeMini(chat: boolean): Promise<void>`. (`miniclickthrough.ts`): `miniHoverAtom`, `startClickThrough()`,
  `stopClickThrough()`. (`sproutsvg.tsx`): `SproutSvg({ sprite, cellPx })`. (`sprout-mini.tsx`):
  `SproutMini({ model })`, `besideSprout(sides)`.

No unit tests here: this task is Tauri window calls and rendering, and the pure parts were tested in Tasks 2–3.
Its check is the typecheck, the suite, and the person's manual pass in Step 9.

- [ ] **Step 1: Write `frontend/app/view/agents/miniclickthrough.ts`**

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// While the float is folded into Sprout, the window is see-through and larger than what it draws. Fifteen times a
// second this asks where the cursor is: over a drawn element ([data-mini-hit]) the window takes the cursor, anywhere
// else it lets it through to the app behind. A window ignoring the cursor gets no mouseenter, so this is also what
// knows Sprout is hovered.

import { globalStore } from "@/app/store/jotaiStore";
import { cursorPosition, getCurrentWindow } from "@tauri-apps/api/window";
import { atom, type PrimitiveAtom } from "jotai";
import { hitAny, toPagePoint } from "./minihit";

const POLL_MS = 1000 / 15;
// the hover chip stays this long after the cursor leaves Sprout, so the cursor can travel to its button
const HOVER_LEAVE_MS = 200;

export const miniHoverAtom = atom(false) as PrimitiveAtom<boolean>;

let timer: ReturnType<typeof setInterval> | null = null;

function boxes(selector: string): DOMRect[] {
    return Array.from(document.querySelectorAll(selector), (el) => el.getBoundingClientRect());
}

export function startClickThrough(): void {
    if (timer != null) {
        return;
    }
    const win = getCurrentWindow();
    let ignoring: boolean | null = null;
    let inFlight = false;
    let leftAt = 0;
    timer = setInterval(async () => {
        if (inFlight) {
            return;
        }
        inFlight = true;
        try {
            const [cursor, inner, scale] = await Promise.all([
                cursorPosition(),
                win.innerPosition(),
                win.scaleFactor(),
            ]);
            const p = toPagePoint(cursor, inner, scale);
            const ignore = !hitAny(p, boxes("[data-mini-hit]"));
            if (ignore !== ignoring) {
                ignoring = ignore;
                await win.setIgnoreCursorEvents(ignore);
            }
            const onSprout = hitAny(p, boxes('[data-mini-hit="sprout"], [data-mini-hit="chip"]'));
            if (onSprout) {
                leftAt = 0;
                if (!globalStore.get(miniHoverAtom)) {
                    globalStore.set(miniHoverAtom, true);
                }
            } else if (globalStore.get(miniHoverAtom)) {
                leftAt ||= Date.now();
                if (Date.now() - leftAt >= HOVER_LEAVE_MS) {
                    leftAt = 0;
                    globalStore.set(miniHoverAtom, false);
                }
            }
        } catch (e) {
            console.error("the folded float's cursor poll failed", e);
        } finally {
            inFlight = false;
        }
    }, POLL_MS);
}

export function stopClickThrough(): void {
    if (timer != null) {
        clearInterval(timer);
        timer = null;
    }
    globalStore.set(miniHoverAtom, false);
}
```

- [ ] **Step 2: Add mini to `frontend/app/view/agents/floatstore.ts`**

Extend the imports:

```ts
import { closePeek } from "@/app/view/jarvis/peekstore";
import { petPeekOpenAtom } from "@/app/view/jarvis/petstore";
import { listen } from "@tauri-apps/api/event";
import {
    FLOAT_MIN_SIZE,
    floatRect,
    MAIN_MIN_SIZE,
    MINI_CHAT_SIZE,
    MINI_REST_SIZE,
    miniSides,
    miniSproutRect,
    miniWindowRect,
    parseMiniRestore,
    parseRect,
    parseRestore,
    screenFor,
    sproutFromWindow,
    type FloatRestore,
    type MiniRestore,
    type MiniSides,
    type Screen,
    type WinRect,
} from "./floatwindow";
import { FLOAT_MINIMIZE_EVENT, redirectMinimize, setTrafficLightsHidden } from "./macwindow";
import { startClickThrough, stopClickThrough } from "./miniclickthrough";
```

After the `RESTORE_KEY` constant, add:

```ts
// Float folded into Sprout (docs/superpowers/specs/2026-10-10-float-mini-sprout-design.md): the same window, shrunk
// to a see-through box around Sprout, on top of every app. The shell stays mounted under display:none, so the terminal
// never refits; the window gets its float frame back before the shell shows again.
export const floatMiniAtom = atom(false) as PrimitiveAtom<boolean>;
// which way from Sprout the chip, the bubble and the chat open (floatwindow.ts miniSides)
export const miniSidesAtom = atom<MiniSides>({ h: "left", v: "up" }) as PrimitiveAtom<MiniSides>;
// true while the window changes size around Sprout, so a half-applied size never shows
export const miniResizingAtom = atom(false) as PrimitiveAtom<boolean>;

// where Sprout was last dropped, for the next fold; local, like the float's own place
const MINI_KEY = "arc.float.mini";
// the float frame and pin to give back; session, so a reload mid-fold can still give them back
const MINI_RESTORE_KEY = "arc.float.miniRestore";
```

Replace `giveFrameBack` with (the added lines undo what a fold or a float set, for a reload that lost the atoms):

```ts
async function giveFrameBack(win: Window, restore: FloatRestore | null): Promise<void> {
    await win.setAlwaysOnTop(false);
    // a reload mid-fold left the window see-through, frameless and deaf to the cursor; a float left the yellow button
    // pointed at Sprout
    await win.setIgnoreCursorEvents(false).catch(() => {});
    await win.setShadow(true).catch(() => {});
    await setTrafficLightsHidden(false).catch(() => {});
    await redirectMinimize(false).catch(() => {});
    writeJson(session, MINI_RESTORE_KEY, null);
    if (restore != null) {
        await win.setSize(new PhysicalSize(restore.rect.width, restore.rect.height));
        await win.setPosition(new PhysicalPosition(restore.rect.x, restore.rect.y));
    }
    // after the resize, so the window never grows to the minimum at the float's corner first
    await win.setMinSize(new LogicalSize(MAIN_MIN_SIZE.width, MAIN_MIN_SIZE.height));
    // the window opens maximized (tauri.conf.json), so that is the frame when there is none to give back
    if (restore == null || restore.maximized) {
        await win.maximize();
    }
}
```

In `enterFloat`, after `globalStore.set(floatModeAtom, true);` add:

```ts
        // the yellow button folds the float into Sprout rather than sending it to the Dock (macOS only)
        await redirectMinimize(true).catch((e) => console.error("redirecting the minimize button failed", e));
```

At the very top of `exitFloat`'s body, before its `busy` guard:

```ts
    // folded: give the float window back first, then leave float as from the float
    if (globalStore.get(floatMiniAtom)) {
        await exitMini();
    }
```

Then add the mini functions after `setFloatPinned`:

```ts
// Sprout's box on screen, physical px, while folded
let sprout: WinRect | null = null;
let miniBusy = false;

function nextFrame(): Promise<void> {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

// the screen a rect is on, or the window's own when it is on none (an unplugged monitor)
async function screenOfRect(rect: WinRect | null): Promise<Screen> {
    const [current, monitors] = await Promise.all([currentMonitor(), availableMonitors()]);
    if (current == null) {
        throw new Error("no monitor for the window");
    }
    return screenFor(rect, monitors.map(screenOf), screenOf(current));
}

// Size the folded window around Sprout: the resting box, or room for the chat.
export async function resizeMini(chat: boolean): Promise<void> {
    if (sprout == null) {
        return;
    }
    // before the first await: what the chat draws must not show at the old size
    globalStore.set(miniResizingAtom, true);
    try {
        const win = getCurrentWindow();
        const screen = await screenOfRect(sprout);
        const sides = globalStore.get(miniSidesAtom);
        const rect = miniWindowRect(sprout, chat ? MINI_CHAT_SIZE : MINI_REST_SIZE, sides, screen.area, screen.scale);
        await win.setSize(new PhysicalSize(rect.width, rect.height));
        await win.setPosition(new PhysicalPosition(rect.x, rect.y));
        await nextFrame();
    } finally {
        globalStore.set(miniResizingAtom, false);
    }
}

export async function enterMini(): Promise<void> {
    if (busy || miniBusy || !globalStore.get(floatModeAtom) || globalStore.get(floatMiniAtom)) {
        return;
    }
    miniBusy = true;
    try {
        const win = getCurrentWindow();
        const restore: MiniRestore = { rect: await frameOf(win), pinned: globalStore.get(floatPinnedAtom) };
        writeJson(session, MINI_RESTORE_KEY, restore);
        closePeek();
        // hide the shell before the window shrinks: a terminal that saw the small window would refit its PTY to it
        globalStore.set(floatMiniAtom, true);
        document.documentElement.dataset.floatMini = "";
        await nextFrame();
        await nextFrame();
        const last = parseRect(readJson(local, MINI_KEY));
        const screen = await screenOfRect(last);
        sprout = miniSproutRect(last, screen.area, screen.scale);
        globalStore.set(miniSidesAtom, miniSides(sprout, screen.area));
        await setTrafficLightsHidden(true);
        await win.setShadow(false);
        await win.setMinSize(null);
        await resizeMini(false);
        await win.setAlwaysOnTop(true);
        startClickThrough();
    } catch (e) {
        console.error("folding the float into Sprout failed", e);
        await leaveMini(getCurrentWindow()).catch(() => {});
    } finally {
        miniBusy = false;
    }
}

// Give the float window back: its frame and pin first, then the shell, so the terminal fits to the size it had.
async function leaveMini(win: Window): Promise<void> {
    stopClickThrough();
    const restore = parseMiniRestore(readJson(session, MINI_RESTORE_KEY));
    await win.setIgnoreCursorEvents(false);
    await win.setShadow(true);
    await setTrafficLightsHidden(false);
    if (restore != null) {
        await win.setSize(new PhysicalSize(restore.rect.width, restore.rect.height));
        await win.setPosition(new PhysicalPosition(restore.rect.x, restore.rect.y));
    }
    await win.setMinSize(new LogicalSize(FLOAT_MIN_SIZE.width, FLOAT_MIN_SIZE.height));
    await win.setAlwaysOnTop(restore?.pinned ?? false);
    await nextFrame();
    delete document.documentElement.dataset.floatMini;
    globalStore.set(floatMiniAtom, false);
    writeJson(session, MINI_RESTORE_KEY, null);
    sprout = null;
}

export async function exitMini(): Promise<void> {
    if (miniBusy || !globalStore.get(floatMiniAtom)) {
        return;
    }
    miniBusy = true;
    try {
        closePeek();
        await leaveMini(getCurrentWindow());
    } catch (e) {
        console.error("giving the float window back failed", e);
    } finally {
        miniBusy = false;
    }
}

// A drag moves the window: remember where it put Sprout, and turn the window around when Sprout crossed the middle.
async function settleMove(): Promise<void> {
    if (!globalStore.get(floatMiniAtom) || globalStore.get(miniResizingAtom) || sprout == null) {
        return;
    }
    const win = getCurrentWindow();
    const [frame, scale] = await Promise.all([frameOf(win), win.scaleFactor()]);
    const sides = globalStore.get(miniSidesAtom);
    const moved = sproutFromWindow(frame, sides, scale);
    const screen = await screenOfRect(moved);
    sprout = miniSproutRect(moved, screen.area, screen.scale);
    writeJson(local, MINI_KEY, sprout);
    const next = miniSides(sprout, screen.area);
    if (next.h !== sides.h || next.v !== sides.v) {
        globalStore.set(miniSidesAtom, next);
        await resizeMini(globalStore.get(petPeekOpenAtom));
    }
}
```

In `setupFloatMode`, before its `return () => {`, add:

```ts
    let moveTimer: ReturnType<typeof setTimeout> | undefined;
    const unlistenMoved = getCurrentWindow().onMoved(() => {
        if (!globalStore.get(floatMiniAtom)) {
            return;
        }
        clearTimeout(moveTimer);
        moveTimer = setTimeout(() => void settleMove().catch((e) => console.error("placing Sprout failed", e)), 300);
    });
    // the yellow button, redirected while floating (enterFloat)
    const unlistenMinimize = listen(FLOAT_MINIMIZE_EVENT, () => void enterMini());
```

and in the returned cleanup, after `unsubFullscreen();`:

```ts
        clearTimeout(moveTimer);
        void unlistenMoved.then((f) => f());
        void unlistenMinimize.then((f) => f());
```

Update the file's header comment: append "Folding the float into Sprout (enterMini) shrinks the same window again,
see-through, around Sprout."

- [ ] **Step 3: Write `frontend/app/view/jarvis/sproutsvg.tsx` and use it in `petfloatmark.tsx`**

```tsx
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Sprout drawn from its cells (petsprite.ts spriteFor) at a whole number of pixels a cell, each cell filled with its
// theme token, so a runtime theme repaints it.

import { PET_GRID, spriteFor, type PetCell } from "./petsprite";

type Sprite = ReturnType<typeof spriteFor>;

export function SproutSvg({ sprite, cellPx }: { sprite: Sprite; cellPx: number }) {
    const px = PET_GRID * cellPx;
    const cell = (c: PetCell, i: number) => (
        <rect key={i} x={c.x * cellPx} y={c.y * cellPx} width={cellPx} height={cellPx} fill={`var(${c.token})`} />
    );
    return (
        <svg width={px} height={px} viewBox={`0 0 ${px} ${px}`} aria-hidden className="block">
            {sprite.back.map(cell)}
            {sprite.body.map(cell)}
            {sprite.overlay.map(cell)}
        </svg>
    );
}
```

In `petfloatmark.tsx`: delete `cellRect`, `SPROUT_PX` and the `PET_GRID, type PetCell` import; import
`{ SproutSvg } from "./sproutsvg"`; replace the `<svg …>…</svg>` inside the button with
`<SproutSvg sprite={sprite} cellPx={CELL_PX} />`.

Its `PetPeek` renders through a portal to `body`, so the hidden shell does not hide it: folded, it would open beside
the chat Sprout opens, from the same `petPeekOpenAtom`. Import `floatMiniAtom` from `@/app/view/agents/floatstore`,
read `const folded = useAtomValue(floatMiniAtom);`, and render the peek only when not folded:

```tsx
            {/* folded, the chat opens from Sprout (cockpit/sprout-mini.tsx); this one would open behind it */}
            {folded ? null : <PetPeek model={model} anchor={anchor} corner="top-right" signals={signals} />}
```

- [ ] **Step 4: Write `frontend/app/cockpit/sprout-mini.tsx`**

```tsx
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The float folded into Sprout (floatstore.ts enterMini): the see-through window holds only this. Sprout sits in the
// window's corner away from where things open (floatwindow.ts miniSides), bobs, wears what waits on you (petmini.ts),
// and is dragged by a press that moves; a double-click, or Terminal on the hover chip, gives the float window back.
// Every element the cursor may use carries data-mini-hit, or the click-through poll lets clicks fall through it.

import { STATE_COLOR, STATE_LABEL } from "@/app/view/agents/agentheader";
import type { AgentsViewModel } from "@/app/view/agents/agents";
import { askingLabel } from "@/app/view/agents/agentsviewmodel";
import { attentionAtom } from "@/app/view/agents/attentionstore";
import { channelMessagesAtom } from "@/app/view/agents/channelsstore";
import { exitMini, miniResizingAtom, miniSidesAtom } from "@/app/view/agents/floatstore";
import type { MiniSides } from "@/app/view/agents/floatwindow";
import { miniHoverAtom } from "@/app/view/agents/miniclickthrough";
import { StatusDot } from "@/app/view/agents/statusdot";
import { postureFor } from "@/app/view/jarvis/petcondition";
import { miniLook } from "@/app/view/jarvis/petmini";
import { petOutfit, petOutfitChoice } from "@/app/view/jarvis/petoutfit";
import { queueRows } from "@/app/view/jarvis/petpeekmodel";
import { spriteFor } from "@/app/view/jarvis/petsprite";
import { petErrandAtom, petOutfitChoiceAtom, petPeekOpenAtom } from "@/app/view/jarvis/petstore";
import { usePetSignals } from "@/app/view/jarvis/petview";
import { SproutSvg } from "@/app/view/jarvis/sproutsvg";
import { cn, fireAndForget } from "@/util/util";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useAtomValue } from "jotai";
import { PictureInPicture2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

const BOB_MS = 700;
const DRAG_PX = 4;
// 4px a cell: the 16-cell sprite is 64px
const CELL_PX = 4;
// Spike result 1 or 2 failed on a platform: draw Sprout on a tile there (make this `isWindows()` or `isMacOS()`)
const MINI_TILE = false;

function useBobFrame(): 0 | 1 {
    const [frame, setFrame] = useState<0 | 1>(0);
    useEffect(() => {
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
            return;
        }
        const t = setInterval(() => setFrame((f) => (f === 0 ? 1 : 0)), BOB_MS);
        return () => clearInterval(t);
    }, []);
    return frame;
}

// Sprout's 80px box: the window's corner away from where the chip, the bubble and the chat open
function boxCorner(sides: MiniSides): string {
    return cn(sides.h === "left" ? "right-0" : "left-0", sides.v === "up" ? "bottom-0" : "top-0");
}

// the chip and the bubble: beside Sprout toward the middle of the screen, level with its feet or its head
export function besideSprout(sides: MiniSides): string {
    return cn(sides.h === "left" ? "right-[88px]" : "left-[88px]", sides.v === "up" ? "bottom-3" : "top-3");
}

export function SproutMini({ model }: { model: AgentsViewModel }) {
    const signals = usePetSignals(model);
    const sides = useAtomValue(miniSidesAtom);
    const resizing = useAtomValue(miniResizingAtom);
    const hovered = useAtomValue(miniHoverAtom);
    const chatOpen = useAtomValue(petPeekOpenAtom);
    const errand = useAtomValue(petErrandAtom);
    const items = useAtomValue(attentionAtom);
    const agents = useAtomValue(model.agentsAtom);
    const terminals = useAtomValue(model.terminalsAtom);
    const focusId = useAtomValue(model.focusIdAtom);
    const messages = useAtomValue(channelMessagesAtom);
    const outfitChoice = useAtomValue(petOutfitChoiceAtom);
    const frame = useBobFrame();
    const waiting = useMemo(() => queueRows(items, agents, messages).length, [items, agents, messages]);
    const look = miniLook({ posture: postureFor(signals), waiting, errand, unread: false, chatOpen, frame });
    const sprite = spriteFor(look.pose, look.marks, petOutfit(petOutfitChoice(outfitChoice), new Date()));
    const agent = agents.find((a) => a.id === focusId) ?? terminals.find((a) => a.id === focusId);
    const dragged = useRef(false);

    const onPointerDown = (e: ReactPointerEvent) => {
        if (e.button !== 0) {
            return;
        }
        dragged.current = false;
        const start = { x: e.screenX, y: e.screenY };
        const move = (ev: PointerEvent) => {
            if (Math.hypot(ev.screenX - start.x, ev.screenY - start.y) < DRAG_PX) {
                return;
            }
            stop();
            dragged.current = true;
            fireAndForget(() => getCurrentWindow().startDragging());
        };
        const stop = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", stop);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", stop);
    };
    const restore = () => fireAndForget(exitMini);

    return (
        <div data-sprout-mini className={cn("fixed inset-0", resizing && "opacity-0")}>
            <div
                data-mini-hit="sprout"
                className={cn(
                    "absolute h-20 w-20",
                    boxCorner(sides),
                    MINI_TILE && "rounded-[18px] border border-edge-strong bg-surface shadow-popover-sm"
                )}
            >
                <span
                    aria-hidden
                    className={cn(
                        "absolute bottom-1.5 left-1/2 h-[7px] w-[50px] -translate-x-1/2 rounded-full bg-background/50",
                        look.bob && "scale-x-[0.78] opacity-60"
                    )}
                />
                <button
                    type="button"
                    aria-label={look.label}
                    title={look.label}
                    onPointerDown={onPointerDown}
                    onDoubleClick={restore}
                    className={cn(
                        "absolute left-2 top-2 cursor-pointer rounded-[10px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                        look.bob && "-translate-y-1"
                    )}
                >
                    <SproutSvg sprite={sprite} cellPx={CELL_PX} />
                </button>
                {look.chip != null ? (
                    <span className="pointer-events-none absolute left-1 top-3 min-w-[18px] rounded-full bg-warning px-[5px] text-center text-[11px] font-bold leading-[18px] text-on-warning tabular-nums">
                        {look.chip}
                    </span>
                ) : null}
            </div>
            {hovered && !chatOpen && agent != null ? (
                <div
                    data-mini-hit="chip"
                    className={cn(
                        "absolute flex h-[30px] items-center gap-2 whitespace-nowrap rounded-full border border-edge-mid bg-surface-raised pl-2.5 pr-1 shadow-popover-sm",
                        besideSprout(sides)
                    )}
                >
                    <StatusDot state={agent.state} />
                    <span className="max-w-[110px] truncate text-[12px] font-semibold text-primary">{agent.name}</span>
                    {agent.kind !== "terminal" ? (
                        <span className="text-[11px] font-medium" style={{ color: STATE_COLOR[agent.state] }}>
                            {agent.state === "asking" ? askingLabel(agent) : STATE_LABEL[agent.state]}
                        </span>
                    ) : null}
                    <button
                        type="button"
                        data-mini-restore
                        title="Restore the float window"
                        onClick={restore}
                        className="flex h-[22px] cursor-pointer items-center gap-1 rounded-full bg-surface-hover px-2 text-[11px] font-semibold text-ink-mid hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                        <PictureInPicture2 size={12} strokeWidth={2} aria-hidden />
                        Terminal
                    </button>
                </div>
            ) : null}
        </div>
    );
}
```

- [ ] **Step 5: Wire it into `frontend/app/cockpit/cockpit-root.tsx`**

Import `floatMiniAtom` beside `floatModeAtom`, `SproutMini` from `./sprout-mini`, and `cn` from `@/util/util` if it is
not imported. After `const floating = useAtomValue(floatModeAtom);` add
`const folded = useAtomValue(floatMiniAtom);`. In the return, wrap everything from the app bar line through
`<NotificationToasts />` except `<TitleTipHost />` in one div that hides while folded, and draw Sprout beside it:

```tsx
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <NowTicker model={model} />
            <BackgroundAgentsPoller />
            <AttentionPoller />
            <PulseDriver />
            <PetSources model={model} />
            {/* folded into Sprout: everything else stays mounted under display:none, so the terminal never refits to
                the small window (floatstore.ts enterMini) */}
            <div className={cn("flex min-h-0 flex-1 flex-col overflow-hidden", folded && "hidden")}>
                {floating ? <FloatBar model={model} /> : <CockpitAppBar model={model} />}
                <div className="min-h-0 flex-1">
                    <CockpitShell model={model} tabId={tabIdRef.current} />
                </div>
                {floating ? null : <HintsFooter model={model} />}
                {/* …the existing panels, modals, PetView, ModalsRenderer, ContextMenuHost and NotificationToasts,
                    unchanged and in the same order… */}
            </div>
            {folded ? <SproutMini model={model} /> : null}
            <TitleTipHost />
        </div>
```

(The comment line with "…" stands for the existing JSX lines, moved as they are; do not type it.)

- [ ] **Step 6: Let the page go see-through while folded, in `frontend/tailwindsetup.css`**

Append:

```css
/* The float folded into Sprout (floatstore.ts enterMini): the window is see-through, so nothing may paint the page.
   !important beats index.html's inline body background. */
html[data-float-mini],
html[data-float-mini] body,
html[data-float-mini] #main {
    background: transparent !important;
}
```

- [ ] **Step 7: The Minimize button in `frontend/app/cockpit/float-bar.tsx`, and the window controls**

In `float-bar.tsx`, import `enterMini` beside `exitFloat`, `SproutSvg` from `@/app/view/jarvis/sproutsvg` and
`spriteFor` from `@/app/view/jarvis/petsprite`; above the component add:

```tsx
// a sitting Sprout on the button that folds the float into it
const MINIMIZE_SPRITE = spriteFor("sit", []);
```

and before the pin button:

```tsx
            <button
                type="button"
                data-float-minimize
                aria-label="Minimize to Sprout"
                title="Minimize to Sprout"
                onClick={() => fireAndForget(enterMini)}
                className={cn(ICON_BTN, "gap-[5px] pr-2 text-[11px] font-semibold")}
            >
                <SproutSvg sprite={MINIMIZE_SPRITE} cellPx={1} />
                Minimize
            </button>
```

In `frontend/app/cockpit/app-bar.tsx` `WindowControls`, read `const floating = useAtomValue(floatModeAtom);` (import
`floatModeAtom, enterMini` from `@/app/view/agents/floatstore`; add `useAtomValue` / `fireAndForget` imports if
missing) and change the minimize button:

```tsx
            <button
                onClick={() => (floating ? fireAndForget(enterMini) : win.minimize())}
                aria-label={floating ? "Minimize to Sprout" : "Minimize"}
                className="flex h-full w-11 cursor-pointer items-center justify-center text-secondary hover:bg-hover"
            >
```

- [ ] **Step 8: Typecheck, lint, test**

Run: `NODE_OPTIONS=--max-old-space-size=4096 task check:ts` (timeout 5 min)
Expected: exit 0.
Run: `npx eslint frontend/app/view/agents/floatstore.ts frontend/app/view/agents/miniclickthrough.ts frontend/app/view/jarvis/sproutsvg.tsx frontend/app/view/jarvis/petfloatmark.tsx frontend/app/cockpit/sprout-mini.tsx frontend/app/cockpit/cockpit-root.tsx frontend/app/cockpit/float-bar.tsx frontend/app/cockpit/app-bar.tsx`
and `npx prettier --check` on the same paths plus `frontend/tailwindsetup.css`.
Expected: clean.
Run: `npx vitest run frontend/app/view/agents frontend/app/view/jarvis frontend/app/cockpit`
Expected: PASS.

- [ ] **Step 9: The person checks it on the Mac (`task dev`)**

1. Float (`Shift+F`), then **Minimize** on the float bar: only Sprout shows, bobbing, at the bottom-right of the
   screen; no frame, no traffic lights; it stays above other apps.
2. The yellow light while floating does the same (if Spike result 3 passed).
3. Clicks beside Sprout reach the app behind; hovering Sprout shows the agent chip; **Terminal** gives the float
   window back at the same place and size, pinned as it was.
4. Drag Sprout to the top-left and back; minimize again: it comes back where it was dropped.
5. While folded, `Shift+F` after clicking Sprout (window focused): the full window comes back, not a broken one.
6. While folded, reload the dev app (`⌘R` in the inspector): the full window comes back with its frame and traffic
   lights, and clicks land in it.
7. Console: no `[termwrap] resize` between folding and restoring.

- [ ] **Step 10: Commit**

```bash
git add frontend/app/view/agents/floatstore.ts frontend/app/view/agents/miniclickthrough.ts frontend/app/view/jarvis/sproutsvg.tsx frontend/app/view/jarvis/petfloatmark.tsx frontend/app/cockpit/sprout-mini.tsx frontend/app/cockpit/cockpit-root.tsx frontend/app/cockpit/float-bar.tsx frontend/app/cockpit/app-bar.tsx frontend/tailwindsetup.css
git commit -m "feat(float): minimize folds the float window into a floating Sprout"
```

---

### Task 5: The chat from Sprout, and the reply bubble

**Depends on:** Task 4
**Files:** `frontend/app/view/jarvis/petpeek.tsx`, `frontend/app/view/jarvis/peterrand.tsx`, `frontend/app/cockpit/sprout-mini.tsx`

**Interfaces:**
- Consumes: Task 4's `resizeMini`, `exitMini`, `miniSidesAtom`, `besideSprout`; Task 3's `nextUnread`.
- Produces: `PeekCorner` gains `"mini"`; `PetPeek` gains optional props `placement?: Placement` and
  `onRestore?: () => void`; `PetErrand` gains `showPrompt?: boolean`.

- [ ] **Step 1: `PetPeek` learns the mini corner (`frontend/app/view/jarvis/petpeek.tsx`)**

Change the corner type and its tables:

```tsx
// Where the peek opens from: the walking creature's corner, the float bar's top right (petfloatmark.tsx), where it
// drops down, or Sprout folded out of the float (cockpit/sprout-mini.tsx), whose placement prop says which way.
export type PeekCorner = PetCorner | "top-right" | "mini";

const PLACEMENT: Record<PeekCorner, Placement> = {
    "bottom-right": "top-end",
    "bottom-left": "top-start",
    "top-right": "bottom-end",
    mini: "top-end",
};

const ORIGIN: Record<PeekCorner, string> = {
    "bottom-right": "bottom right",
    "bottom-left": "bottom left",
    "top-right": "top right",
    mini: "bottom right",
};

// the corner a panel grows from: its edge on the anchor's side, at the aligned end
function originOf(placement: Placement): string {
    const [side, align] = placement.split("-");
    const v = side === "top" ? "bottom" : side === "bottom" ? "top" : "center";
    const h = align === "end" ? "right" : align === "start" ? "left" : "center";
    return `${v} ${h}`;
}
```

Add `ChevronUp, PictureInPicture2` to the `lucide-react` import. Extend the props:

```tsx
export function PetPeek({
    model,
    anchor,
    corner,
    signals,
    placement,
    onRestore,
}: {
    model: AgentsViewModel;
    anchor: HTMLElement | null;
    corner: PeekCorner;
    signals: PetSignals;
    // the mini corner's way out of Sprout (toward the middle of the screen)
    placement?: Placement;
    // folded float only: the header gives the float window back instead of opening the full Jarvis view
    onRestore?: () => void;
}) {
```

In `useFloating`, `placement: placement ?? PLACEMENT[corner],`. On the `motion.div`:
`style={{ transformOrigin: placement != null ? originOf(placement) : ORIGIN[corner] }}`, add `data-mini-hit="chat"`
as an attribute, and replace `"flex max-h-[calc(100vh-16px)] w-[calc(100vw-16px)] …"` with:

```tsx
                                    className={cn(
                                        "flex w-[calc(100vw-16px)] flex-col overflow-hidden rounded-[12px] border border-border bg-surface-raised shadow-popover",
                                        // folded: Sprout's 80px box and the offset share the window with the panel
                                        corner === "mini" ? "max-h-[calc(100vh-104px)]" : "max-h-[calc(100vh-16px)]",
                                        item != null ? "max-w-[560px]" : quiet ? "max-w-[300px]" : "max-w-[420px]"
                                    )}
```

Replace the header's two buttons (**Full view** and the `×`) with:

```tsx
                                                    {onRestore != null ? (
                                                        <>
                                                            <button
                                                                type="button"
                                                                data-mini-restore
                                                                aria-label="Restore the float window"
                                                                title="Restore the float window"
                                                                onClick={() => {
                                                                    leavePeek();
                                                                    onRestore();
                                                                }}
                                                                className={cn(
                                                                    "flex h-7 flex-none items-center gap-1 whitespace-nowrap rounded-[7px] px-2 text-[11px] font-medium text-muted hover:bg-surface-hover hover:text-primary",
                                                                    FOCUS_RING
                                                                )}
                                                            >
                                                                <PictureInPicture2 aria-hidden="true" size={12} strokeWidth={2} />
                                                                Terminal
                                                            </button>
                                                            <button
                                                                type="button"
                                                                aria-label="Collapse into Sprout"
                                                                title="Collapse into Sprout (Esc)"
                                                                onClick={close}
                                                                className={cn(
                                                                    "flex h-7 w-7 flex-none items-center justify-center rounded-[7px] text-muted hover:bg-surface-hover hover:text-primary",
                                                                    FOCUS_RING
                                                                )}
                                                            >
                                                                {placement?.startsWith("bottom") ? (
                                                                    <ChevronUp aria-hidden="true" size={14} strokeWidth={2} />
                                                                ) : (
                                                                    <ChevronDown aria-hidden="true" size={14} strokeWidth={2} />
                                                                )}
                                                            </button>
                                                        </>
                                                    ) : (
                                                        <>
                                                            {/* the existing Full view and × buttons, unchanged */}
                                                        </>
                                                    )}
```

(The `{/* … */}` line stands for the two existing buttons, moved inside the fragment as they are.)

On the `<PetErrand …>` element add `showPrompt={onRestore != null}`.

- [ ] **Step 2: The asked question above the reply (`frontend/app/view/jarvis/peterrand.tsx`)**

Add `showPrompt = false` to `PetErrand`'s destructured props and `showPrompt?: boolean;` to its prop type, and replace
`{errand != null ? <ErrandReply errand={errand} /> : null}` with:

```tsx
            {/* folded float: the chat shows what you asked, the way a chat does */}
            {showPrompt && errand != null ? (
                <div className="max-w-[80%] self-end rounded-[10px] bg-surface-hover px-2.5 py-1.5 text-[11.5px] leading-[1.45] text-primary [overflow-wrap:anywhere]">
                    {errand.prompt}
                </div>
            ) : null}
            {errand != null ? <ErrandReply errand={errand} /> : null}
```

- [ ] **Step 3: Sprout opens the chat, tells an unread reply, and sizes the window (`frontend/app/cockpit/sprout-mini.tsx`)**

Replace the file with the Task 4 version plus the chat, the unread reply and the bubble:

```tsx
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The float folded into Sprout (floatstore.ts enterMini): the see-through window holds only this. Sprout sits in the
// window's corner away from where things open (floatwindow.ts miniSides), bobs, wears what waits on you (petmini.ts),
// and is dragged by a press that moves. A click opens the Jarvis chat (the pet peek) from it; a double-click, or
// Terminal, gives the float window back. A reply that lands while the chat is folded shows in a bubble beside it.
// Every element the cursor may use carries data-mini-hit, or the click-through poll lets clicks fall through it.

import { globalStore } from "@/app/store/jotaiStore";
import { STATE_COLOR, STATE_LABEL } from "@/app/view/agents/agentheader";
import type { AgentsViewModel } from "@/app/view/agents/agents";
import { askingLabel } from "@/app/view/agents/agentsviewmodel";
import { attentionAtom } from "@/app/view/agents/attentionstore";
import { channelMessagesAtom } from "@/app/view/agents/channelsstore";
import { exitMini, miniResizingAtom, miniSidesAtom, resizeMini } from "@/app/view/agents/floatstore";
import type { MiniSides } from "@/app/view/agents/floatwindow";
import { miniHoverAtom } from "@/app/view/agents/miniclickthrough";
import { StatusDot } from "@/app/view/agents/statusdot";
import { closePeek, openPetPeek } from "@/app/view/jarvis/peekstore";
import { postureFor } from "@/app/view/jarvis/petcondition";
import { miniLook, nextUnread } from "@/app/view/jarvis/petmini";
import { petOutfit, petOutfitChoice } from "@/app/view/jarvis/petoutfit";
import { PetPeek } from "@/app/view/jarvis/petpeek";
import { queueRows } from "@/app/view/jarvis/petpeekmodel";
import { spriteFor } from "@/app/view/jarvis/petsprite";
import { petErrandAtom, petOutfitChoiceAtom, petPeekOpenAtom } from "@/app/view/jarvis/petstore";
import { usePetSignals } from "@/app/view/jarvis/petview";
import { SproutSvg } from "@/app/view/jarvis/sproutsvg";
import { cn, fireAndForget } from "@/util/util";
import type { Placement } from "@floating-ui/react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { atom, useAtomValue, type PrimitiveAtom } from "jotai";
import { PictureInPicture2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

const BOB_MS = 700;
const DRAG_PX = 4;
// a second click inside this is a double-click, which restores rather than opens
const CLICK_MS = 220;
// 4px a cell: the 16-cell sprite is 64px
const CELL_PX = 4;
// Spike result 1 or 2 failed on a platform: draw Sprout on a tile there (make this `isWindows()` or `isMacOS()`)
const MINI_TILE = false;

// a reply that landed while the chat was folded (petmini.ts nextUnread)
const miniUnreadAtom = atom(false) as PrimitiveAtom<boolean>;

function useBobFrame(): 0 | 1 {
    const [frame, setFrame] = useState<0 | 1>(0);
    useEffect(() => {
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
            return;
        }
        const t = setInterval(() => setFrame((f) => (f === 0 ? 1 : 0)), BOB_MS);
        return () => clearInterval(t);
    }, []);
    return frame;
}

// Sprout's 80px box: the window's corner away from where the chip, the bubble and the chat open
function boxCorner(sides: MiniSides): string {
    return cn(sides.h === "left" ? "right-0" : "left-0", sides.v === "up" ? "bottom-0" : "top-0");
}

// the chip and the bubble: beside Sprout toward the middle of the screen, level with its feet or its head
export function besideSprout(sides: MiniSides): string {
    return cn(sides.h === "left" ? "right-[88px]" : "left-[88px]", sides.v === "up" ? "bottom-3" : "top-3");
}

function chatPlacement(sides: MiniSides): Placement {
    return `${sides.v === "up" ? "top" : "bottom"}-${sides.h === "left" ? "end" : "start"}`;
}

export function SproutMini({ model }: { model: AgentsViewModel }) {
    const signals = usePetSignals(model);
    const sides = useAtomValue(miniSidesAtom);
    const resizing = useAtomValue(miniResizingAtom);
    const hovered = useAtomValue(miniHoverAtom);
    const chatOpen = useAtomValue(petPeekOpenAtom);
    const errand = useAtomValue(petErrandAtom);
    const unread = useAtomValue(miniUnreadAtom);
    const items = useAtomValue(attentionAtom);
    const agents = useAtomValue(model.agentsAtom);
    const terminals = useAtomValue(model.terminalsAtom);
    const focusId = useAtomValue(model.focusIdAtom);
    const messages = useAtomValue(channelMessagesAtom);
    const outfitChoice = useAtomValue(petOutfitChoiceAtom);
    const frame = useBobFrame();
    const waiting = useMemo(() => queueRows(items, agents, messages).length, [items, agents, messages]);
    const look = miniLook({ posture: postureFor(signals), waiting, errand, unread, chatOpen, frame });
    const sprite = spriteFor(look.pose, look.marks, petOutfit(petOutfitChoice(outfitChoice), new Date()));
    const agent = agents.find((a) => a.id === focusId) ?? terminals.find((a) => a.id === focusId);
    // state, not a ref: the chat positions itself once this lands
    const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
    const dragged = useRef(false);
    const clickTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

    // the reply's unread mark follows the errand and the chat; the chat's opening and closing size the window
    useEffect(() => {
        let prev = globalStore.get(petErrandAtom);
        const step = () => {
            const next = globalStore.get(petErrandAtom);
            globalStore.set(
                miniUnreadAtom,
                nextUnread(prev, next, globalStore.get(petPeekOpenAtom), globalStore.get(miniUnreadAtom))
            );
            prev = next;
        };
        const unErrand = globalStore.sub(petErrandAtom, step);
        const unOpen = globalStore.sub(petPeekOpenAtom, () => {
            step();
            void resizeMini(globalStore.get(petPeekOpenAtom)).catch((e) => console.error("sizing the chat failed", e));
        });
        return () => {
            unErrand();
            unOpen();
            clearTimeout(clickTimer.current);
        };
    }, []);

    const onPointerDown = (e: ReactPointerEvent) => {
        if (e.button !== 0) {
            return;
        }
        dragged.current = false;
        const start = { x: e.screenX, y: e.screenY };
        const move = (ev: PointerEvent) => {
            if (Math.hypot(ev.screenX - start.x, ev.screenY - start.y) < DRAG_PX) {
                return;
            }
            stop();
            dragged.current = true;
            fireAndForget(() => getCurrentWindow().startDragging());
        };
        const stop = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", stop);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", stop);
    };
    const onClick = () => {
        if (dragged.current) {
            dragged.current = false;
            return;
        }
        clearTimeout(clickTimer.current);
        clickTimer.current = setTimeout(
            () => (globalStore.get(petPeekOpenAtom) ? closePeek() : openPetPeek()),
            CLICK_MS
        );
    };
    const restore = () => {
        clearTimeout(clickTimer.current);
        fireAndForget(exitMini);
    };
    const told = unread && !chatOpen && errand != null;

    return (
        <div data-sprout-mini className={cn("fixed inset-0", resizing && "opacity-0")}>
            <div
                data-mini-hit="sprout"
                className={cn(
                    "absolute h-20 w-20",
                    boxCorner(sides),
                    MINI_TILE && "rounded-[18px] border border-edge-strong bg-surface shadow-popover-sm"
                )}
            >
                <span
                    aria-hidden
                    className={cn(
                        "absolute bottom-1.5 left-1/2 h-[7px] w-[50px] -translate-x-1/2 rounded-full bg-background/50",
                        look.bob && "scale-x-[0.78] opacity-60"
                    )}
                />
                <button
                    ref={setAnchor}
                    type="button"
                    aria-label={look.label}
                    title={look.label}
                    aria-expanded={chatOpen}
                    onPointerDown={onPointerDown}
                    onClick={onClick}
                    onDoubleClick={restore}
                    className={cn(
                        "absolute left-2 top-2 cursor-pointer rounded-[10px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                        chatOpen && "bg-accentbg",
                        look.bob && "-translate-y-1"
                    )}
                >
                    <SproutSvg sprite={sprite} cellPx={CELL_PX} />
                </button>
                {look.chip != null ? (
                    <span className="pointer-events-none absolute left-1 top-3 min-w-[18px] rounded-full bg-warning px-[5px] text-center text-[11px] font-bold leading-[18px] text-on-warning tabular-nums">
                        {look.chip}
                    </span>
                ) : null}
            </div>

            {told ? (
                <div
                    data-mini-hit="bubble"
                    role="button"
                    tabIndex={0}
                    title="Open the reply"
                    onClick={openPetPeek}
                    onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            openPetPeek();
                        }
                    }}
                    className={cn(
                        "absolute flex w-[240px] cursor-pointer flex-col gap-1 rounded-[12px] border border-edge-mid bg-surface-raised px-2.5 pb-[9px] pt-2 shadow-popover-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                        besideSprout(sides)
                    )}
                >
                    <div className="flex items-center gap-1.5 text-[9.5px] text-muted">
                        <span
                            className={cn(
                                "h-[5px] w-[5px] rounded-full",
                                errand.status === "error" ? "bg-error" : "bg-success"
                            )}
                        />
                        <span className="flex-1">
                            {errand.runtime} · {errand.status === "error" ? "failed" : "replied"}
                        </span>
                        <button
                            type="button"
                            aria-label="Dismiss the reply"
                            title="Dismiss (the reply stays in the chat)"
                            onClick={(e) => {
                                e.stopPropagation();
                                globalStore.set(miniUnreadAtom, false);
                            }}
                            className="flex cursor-pointer rounded-[5px] p-0.5 text-muted hover:bg-surface-hover hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        >
                            <X size={11} strokeWidth={2.2} aria-hidden />
                        </button>
                    </div>
                    <div className="line-clamp-3 text-[11.5px] leading-[1.5] text-secondary [overflow-wrap:anywhere]">
                        {errand.text}
                    </div>
                </div>
            ) : null}

            {hovered && !chatOpen && !told && agent != null ? (
                <div
                    data-mini-hit="chip"
                    className={cn(
                        "absolute flex h-[30px] items-center gap-2 whitespace-nowrap rounded-full border border-edge-mid bg-surface-raised pl-2.5 pr-1 shadow-popover-sm",
                        besideSprout(sides)
                    )}
                >
                    <StatusDot state={agent.state} />
                    <span className="max-w-[110px] truncate text-[12px] font-semibold text-primary">{agent.name}</span>
                    {agent.kind !== "terminal" ? (
                        <span className="text-[11px] font-medium" style={{ color: STATE_COLOR[agent.state] }}>
                            {agent.state === "asking" ? askingLabel(agent) : STATE_LABEL[agent.state]}
                        </span>
                    ) : null}
                    <button
                        type="button"
                        data-mini-restore
                        title="Restore the float window"
                        onClick={restore}
                        className="flex h-[22px] cursor-pointer items-center gap-1 rounded-full bg-surface-hover px-2 text-[11px] font-semibold text-ink-mid hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                        <PictureInPicture2 size={12} strokeWidth={2} aria-hidden />
                        Terminal
                    </button>
                </div>
            ) : null}

            <PetPeek
                model={model}
                anchor={anchor}
                corner="mini"
                placement={chatPlacement(sides)}
                signals={signals}
                onRestore={restore}
            />
        </div>
    );
}
```

- [ ] **Step 4: Typecheck, lint, test**

Run: `NODE_OPTIONS=--max-old-space-size=4096 task check:ts` (timeout 5 min)
Expected: exit 0.
Run: `npx eslint frontend/app/view/jarvis/petpeek.tsx frontend/app/view/jarvis/peterrand.tsx frontend/app/cockpit/sprout-mini.tsx` and `npx prettier --check` on the same paths.
Expected: clean.
Run: `npx vitest run frontend/app/view/jarvis frontend/app/view/agents frontend/app/cockpit`
Expected: PASS.

- [ ] **Step 5: The person checks it on the Mac (`task dev`)**

1. Folded, click Sprout: one chat (not two) rises from it, the window grows without Sprout moving, the queue's keys
   (`1`–`9`, `Enter`, `Space`) work, `Esc` folds it back into Sprout and the window shrinks.
2. Ask Jarvis something, then `Esc` at once: Sprout types at its laptop; when the reply lands it speaks and the bubble
   shows three lines. Clicking the bubble opens the chat with your question above the reply; `×` hides the bubble
   and the reply is still in the chat. (To see "failed", ask with a harness that is not installed.)
3. With Sprout dragged to the top-left, the chat opens below and to the right; the chevron points up.
4. **Terminal** in the chat's header gives the float window back.
5. A double-click on Sprout restores without the chat flashing open.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/view/jarvis/petpeek.tsx frontend/app/view/jarvis/peterrand.tsx frontend/app/cockpit/sprout-mini.tsx
git commit -m "feat(float): a click on the folded Sprout opens the Jarvis chat, and a reply that lands while folded shows in a bubble"
```

---

### Task 6: Scenario, docs, and cleanup

**Depends on:** Task 5
**Files:** `scripts/cdp/scenarios.mjs`, `docs/guide/agent.md`, `docs/guide/cockpit.md`, `CHANGELOG.md`, `docs/reference/architecture.md`, `AGENTS.md`, `frontend/app/cockpit/cockpit-root.tsx`, `frontend/app/view/agents/miniprobe.ts`

**Interfaces:**
- Consumes: the DOM hooks `[data-agent-row]`, `[data-agent-float]`, `[data-float-bar]`, `[data-float-minimize]`,
  `[data-sprout-mini]`, `[data-mini-hit="sprout"] button`, `[data-pet-peek]`, `[data-mini-restore]`,
  `[data-float-exit]`; the block's persisted PTY size `runtimeopts.termsize`.

- [ ] **Step 1: Add the `float-mini` scenario to `scripts/cdp/scenarios.mjs`**

Above `export const SCENARIOS = [`, add (4-space indent, the file's own style; do not run prettier on it):

```js
// --- float folded into Sprout ------------------------------------------------------------------
// Float a fresh terminal, fold it into Sprout, open the chat from Sprout, give the float window back, and check the
// terminal's PTY size never moved (the shell is hidden before the window shrinks). Windows only: WKWebView answers
// no CDP.
const FLOAT_MINI_PROJECT = "verify-float-mini";

async function floatMiniWait(h, expr, ms = 8000) {
    return h.ev(`(async () => {
        for (let i = 0; i < ${Math.ceil(ms / 200)}; i++) {
            if (${expr}) return true;
            await new Promise((r) => setTimeout(r, 200));
        }
        return false;
    })()`);
}

async function floatMiniTermSize(h, blockId) {
    const block = await waveService(h, "object", "GetObject", [`block:${blockId}`]);
    return block?.runtimeopts?.termsize ?? null;
}

const floatMini = {
    name: "float-mini",
    surface: "agent",
    async arrange(h) {
        const ctx = { terminals: [] };
        try {
            const bootTab = String(await h.ev("window.TabRpcClient.routeId")).replace(/^tab:/, "");
            const wslist = await h.rpc("workspacelist", null);
            const ws = wslist.find((w) => (w.workspacedata?.tabids ?? []).includes(bootTab)) ?? wslist[0];
            ctx.workspaceId = ws.workspacedata.oid;
            await openRailTerminal(h, ctx, FLOAT_MINI_PROJECT);
        } catch (e) {
            ctx.arrangeError = String(e?.message ?? e);
        }
        return ctx;
    },
    async assert(h, ctx) {
        const steps = [];
        if (ctx.arrangeError) {
            steps.push({ step: "0. arrange", ok: false, detail: ctx.arrangeError });
            return steps;
        }
        const term = ctx.terminals[0];
        await h.goto("agent");
        const chosen = await floatMiniWait(h, `!!document.querySelector('[data-agent-row="${term.tabId}"]')`);
        await h.ev(`document.querySelector('[data-agent-row="${term.tabId}"]')?.click()`);
        await floatMiniWait(h, `!!document.querySelector("[data-agent-float]")`);
        await h.ev(`document.querySelector("[data-agent-float]")?.click()`);
        const floated = await floatMiniWait(h, `!!document.querySelector("[data-float-bar]")`);
        await h.ev("new Promise((r) => setTimeout(r, 1200))");
        const before = await floatMiniTermSize(h, term.blockId);
        steps.push({
            step: "1. the scenario's terminal floats",
            ok: chosen && floated && before != null,
            detail: JSON.stringify({ chosen, floated, before }),
        });

        await h.ev(`document.querySelector("[data-float-minimize]")?.click()`);
        const folded = await floatMiniWait(h, `!!document.querySelector("[data-sprout-mini]")`);
        await h.ev("new Promise((r) => setTimeout(r, 800))");
        const rest = await h.ev(`({ w: window.innerWidth, h: window.innerHeight })`);
        // the float bar is still mounted, under the hidden shell
        const barGone = await h.ev(`!document.querySelector("[data-float-bar]")?.offsetParent`);
        await h.shot("cdp-shots/float-mini-rest.png");
        steps.push({
            step: "2. Minimize folds the window into Sprout's 340x112 box",
            ok: folded && rest.w <= 340 && rest.h <= 112 && barGone,
            detail: JSON.stringify({ folded, rest, barGone }),
        });

        await h.ev(`document.querySelector('[data-mini-hit="sprout"] button')?.click()`);
        const chat = await floatMiniWait(h, `!!document.querySelector("[data-pet-peek]") && window.innerHeight > 112`);
        await h.ev("new Promise((r) => setTimeout(r, 600))");
        await h.shot("cdp-shots/float-mini-chat.png");
        steps.push({
            step: "3. a click on Sprout opens the chat and the window grows for it",
            ok: chat,
            detail: JSON.stringify(await h.ev(`({ w: window.innerWidth, h: window.innerHeight })`)),
        });

        await h.ev(`document.querySelector("[data-pet-peek] [data-mini-restore]")?.click()`);
        const back = await floatMiniWait(h, `!document.querySelector("[data-sprout-mini]") && !!document.querySelector("[data-float-bar]")?.offsetParent`);
        await h.ev("new Promise((r) => setTimeout(r, 1200))");
        const after = await floatMiniTermSize(h, term.blockId);
        await h.shot("cdp-shots/float-mini-restored.png");
        steps.push({
            step: "4. Terminal gives the float window back, and the PTY size never moved",
            ok: back && JSON.stringify(after) === JSON.stringify(before),
            detail: JSON.stringify({ back, before, after }),
        });
        return steps;
    },
    async teardown(h, ctx) {
        const step = async (what, fn) => {
            try {
                await fn();
            } catch (e) {
                console.error(`float-mini teardown: ${what} failed: ${e?.message ?? e}`);
            }
        };
        await step("restore from Sprout", () => h.ev(`document.querySelector("[data-mini-restore]")?.click()`));
        await step("leave float", () => h.ev(`document.querySelector("[data-float-exit]")?.click()`));
        await step("settle", () => h.ev("new Promise((r) => setTimeout(r, 1200))"));
        for (const t of ctx.terminals ?? []) {
            await step(`close the terminal tab ${t.tabId}`, () =>
                waveService(h, "workspace", "CloseTab", [ctx.workspaceId, t.tabId, false])
            );
        }
    },
};
```

Then add `floatMini,` as the last entry of `SCENARIOS`.

Run: `node --check scripts/cdp/scenarios.mjs`
Expected: no output (it parses).

- [ ] **Step 2: Remove the spike probe**

Delete `frontend/app/view/agents/miniprobe.ts` and its import (and comment line) in
`frontend/app/cockpit/cockpit-root.tsx`.

- [ ] **Step 3: Docs**

`docs/guide/agent.md`, the Float row of the table (line ~118): after "…lần Float sau mở lại đúng chỗ lần trước"
append: " Nút **Minimize** trên thanh (hoặc nút minimize của cửa sổ, nút vàng trên macOS) thu cửa sổ lại thành con
Sprout bay trên mọi app ở góc màn hình: bấm Sprout để mở chat Jarvis, kéo để dời chỗ, **Terminal** hoặc bấm đúp để
mở lại cửa sổ Float."

`docs/guide/cockpit.md`, section "Con vật Jarvis", add a bullet after the first one:

```markdown
- Khi cửa sổ **Float** được thu nhỏ, con vật là thứ duy nhất còn lại: nó bay ở góc màn hình, trên mọi app, đeo dấu của
  việc đang chờ và số việc chờ. Bấm vào để mở chat (hàng chờ và ô **Ask Jarvis**), `Esc` để thu lại; câu trả lời đến
  lúc chat đang thu hiện thành bong bóng cạnh nó. **Terminal** (trên chat, hoặc trên chip khi rê chuột) hay bấm đúp
  mở lại cửa sổ Float.
```

`CHANGELOG.md`, under `## Unreleased` → `### Added` (create the heading if the top section has none):

```markdown
- Minimizing a float window folds it into Sprout, who floats over your other apps at a corner of the screen: click
  Sprout to answer what waits on you or ask Jarvis, drag it anywhere, and press **Terminal** or double-click it to
  get the float window back.
```

`docs/reference/architecture.md` line 10: replace "through five Tauri commands only (`init.rs`: `get_init`,
`fe_log`; `commands.rs`: `set_window_init_status`, `open_external`; `canvas.rs`: `capture_webview`)" with "through
eight Tauri commands only (`init.rs`: `get_init`, `fe_log`; `commands.rs`: `set_window_init_status`, `open_external`;
`canvas.rs`: `capture_webview`; `notify.rs`: `notify_os`; `macwindow.rs`, macOS only: `set_traffic_lights_hidden`,
`redirect_minimize`)", and after "The window is borderless (`decorations: false`)" add ", and transparent, so the
float can fold into a free-floating Sprout".

`AGENTS.md` line ~116: "Five Tauri commands only;" → "Eight Tauri commands only (listed in
`docs/reference/architecture.md`);".

- [ ] **Step 4: Check everything once more**

Run: `NODE_OPTIONS=--max-old-space-size=4096 task check:ts` (timeout 5 min) → exit 0.
Run: `npx vitest run` → PASS.
Run: `cargo test --manifest-path src-tauri/Cargo.toml` → PASS.
On Windows only: `task verify:ui -- float-mini` → PASS (on a Mac, record it as unverified).

- [ ] **Step 5: Commit, and delete the design canvas**

```bash
git rm frontend/app/view/agents/miniprobe.ts
git add scripts/cdp/scenarios.mjs frontend/app/cockpit/cockpit-root.tsx docs/guide/agent.md docs/guide/cockpit.md CHANGELOG.md docs/reference/architecture.md AGENTS.md
git commit -m "docs(float): minimizing to Sprout, with its CDP scenario"
rm -rf .superpowers/design/jarvis-float-chat
```
