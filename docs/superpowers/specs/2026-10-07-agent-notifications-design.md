# Agent notifications: OS toast when backgrounded, in-app toast when focused

Status: design agreed 2026-10-07. Not built.

## Problem

Nothing reaches you when arcterm is in the background. An agent that asks a question, stops on a permission prompt or
finishes its turn changes a dot and a badge inside the window, and that is all: there is no OS notification (no
notification plugin, no `Notification` API, no taskbar flash), `wsh notify` speaks only through the avatar bubble, and
the macOS Dock badge is the one native signal (skipped on Windows). Two smaller gaps make it worse:

- A permission prompt (`waiting`) folds to `working` in `agentVMFromInput` (`view/agents/agentsviewmodel.ts`), so an
  agent blocked on you does not even turn amber.
- Unread counting (`unreadagents.ts`) treats an agent on screen as read whether or not the window has focus, so a turn
  that finishes while arcterm is behind another app is marked read.

`docs/open-issues.md` carries this as "OS/dock/titlebar badge when arcterm is backgrounded".

## Decisions

- **OS notifications only when the window is not focused.** While you are in arcterm the signal is an in-app toast.
- **No inbox, no history.** A toast is transient; what is still pending stays visible through the existing badges and
  dots. (Matches the avatar spec, 2026-08-14, which rejected persisting notifications.)
- **Events:**

  | Event | Source | OS (backgrounded) | In-app (focused) |
  |---|---|---|---|
  | Request: agent asks (`asking`, `agent:ask`) or waits on a permission prompt (`waiting`) | `agent:status`, `agent:ask` | yes, sound, taskbar flash | toast |
  | Reply: agent finished its turn (working → idle) | roster | yes, silent | toast |
  | Attention that needs a decision: gate, escalation, dag-gate, dag-blocked, run-land-held, run-unverified | `attentionAtom` | yes, sound, taskbar flash | toast |
  | `wsh notify` / `wave_notify` | `Event_Notify` | yes, silent | avatar only, as today |

  radar-triage attention never notifies. A `wsh notify` stays off the toast stack while focused so the avatar and a
  toast never say the same thing (`cockpit/notificationstore.ts` header).
- **Nothing fires for an agent you are looking at** (in `viewingIds` with the window focused).
- **Native path:** `tauri-winrt-notification` on Windows, because its `on_activated` lets a click focus the window and
  open the target; `tauri-plugin-notification` on macOS, show only (a click just raises the app). Rejected:
  `tauri-plugin-notification` everywhere (no desktop click event, so a click does nothing on Windows) and the WebView2
  `Notification` API (denied by default, attributed to Edge).

## Design

### Flow

All the logic is in the frontend, which alone knows window focus (`atoms.documentHasFocus`) and what is on screen
(`viewingIds`). Rust only shows the OS toast.

```
agent:status / agent:ask ─┐
attentionAtom (10 s poll) ┼─► notifyevents.ts (pure: previous snapshot + next snapshot → NotifyEvent[])
Event_Notify ─────────────┘                │
                                           ▼
                         NotifySync (always mounted in cockpitshell)
                                           │ routeNotify (pure)
               ┌───────────────────────────┼───────────────────────────┐
        focused: pushToast           backgrounded:                viewing it: nothing
        (with an open action)        invoke("notify_os", …)
                                           │ click (Windows)
                                           ▼
                         Rust: show + set_focus the window, emit "os-notify-activated" { target }
                                           ▼
                         openref.openTarget / showTerminal for an agent
```

### Pieces

- **`frontend/app/view/agents/notifyevents.ts`** (pure, with a test beside it). Input: the previous and next snapshot
  of agent states, attention ids and the agent:ask ids. Output: `NotifyEvent { kind: "request" | "reply" |
  "attention" | "notify", target, title, body }[]`. An event fires once, on the edge: an agent entering `asking`, an
  attention id not seen before (the seen set drops ids that leave the list), a working → idle move. The first snapshot
  after boot or a websocket reconnect is a baseline and emits nothing, so opening the app does not replay old state.
- **`routeNotify(event, { focused, viewing, settings })`** (pure, same file): `"os" | "toast" | "avatar" | "none"`.
- **Coalescing** (pure, same file): events inside a 2 s window are batched; three or more become one summary ("3 agents
  waiting on you · 2 replied") whose target is the Cockpit surface. Applies to OS and in-app alike.
- **Agents in an orchestrator run** (`runId` set) never raise a reply event: workers finish turns constantly, and
  anything that needs you reaches you as a gate or escalation through attention.
- **`NotifySync`** (`view/agents/notifysync.tsx`, mounted in `cockpitshell.tsx` beside `useUnreadTracking`): feeds the
  sources into the model, routes, calls `pushToast` or `invoke("notify_os")`, and listens for `os-notify-activated`.
- **`cockpit/notificationstore.ts`**: a toast gains an optional `onOpen`; `notificationtoasts.tsx` makes such a toast
  clickable.
- **`src-tauri/src/notify.rs`**: `#[tauri::command] notify_os(title, body, target, loud)`.
  - Windows: `tauri_winrt_notification::Toast` with the bundle's AppUserModelID (`dev.arc.app`), falling back to
    `Toast::POWERSHELL_APP_ID` in a dev build, where the id is not registered (the toast then reads "Windows
    PowerShell"). `loud` picks the default sound or silence, and calls `request_user_attention(Informational)` on the
    main window. `on_activated` shows and focuses the window and emits `os-notify-activated` with the target.
  - macOS: `tauri-plugin-notification`, show only; `loud` picks the sound.
  - Errors are logged as `[tauri]` lines and never surface in the UI.
- **`agentVMFromInput`**: `waiting` maps to `asking`, so a permission prompt shows amber and counts as a request.
- **`unreadagents.ts` / `unreadagentsstore`**: the viewing set is empty while the window is not focused, so a turn
  finished in the background stays unread.

### Settings

`pkg/wconfig` (then `task generate`), all default true:

- `notify:os` — OS notifications at all.
- `notify:toast` — in-app toasts for requests and replies.
- `notify:reply` — the reply event, OS and in-app, for when finished turns are too noisy.

No per-agent settings and no quiet hours; Windows Focus Assist covers that.

### Edge cases

- A click on a toast whose agent has gone: `openref` reports it with its existing "not found" toast.
- A websocket reconnect takes a fresh baseline; what happened while disconnected is not replayed.
- The macOS Dock badge is unchanged. A Windows taskbar overlay badge stays out of scope; the open-issues row keeps
  the badge half.

## Testing

- vitest: `notifyevents.test.ts` covers the edges (enter asking, waiting as asking, working → idle, run workers
  excluded, attention seen set, baseline after reconnect), `routeNotify` (focused / backgrounded / viewing / settings
  off, `wsh notify` focused → avatar) and coalescing. `unreadagents.test.ts` gains the unfocused case;
  `agentsviewmodel` tests the `waiting` mapping.
- CDP scenario `notify-toast` in `scripts/cdp/scenarios.mjs`: with a fixture roster, flip an agent not in view to
  `asking`, assert a toast with the agent's name renders, click it, assert the Agent surface focuses that agent.
- The OS toast cannot be seen over CDP; check it by hand on the dev app: background the window, trigger an ask, click
  the toast, see the agent open.

## Docs

- `CHANGELOG.md`: one `Added` line (OS and in-app notifications) and one `Changed` (a permission prompt shows amber).
- `docs/open-issues.md`: narrow the "OS/dock/titlebar badge" row to the Windows taskbar badge.
