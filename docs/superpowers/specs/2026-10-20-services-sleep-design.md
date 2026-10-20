# Held services sleep when not in use

Held services (`docs/superpowers/specs/2026-10-20-held-services-design.md`, run 8ab6bd47) start every service with
`autostart` (default true) when arcterm opens and keep it running all day. On an 8 GB Mac that is RAM spent on apps no
one is looking at: the portfolio dashboard holds 87 MB once used (measured 2026-10-20), a Next dev server 0.5–1 GB.

The person's call (2026-10-20): a service that is not in use may stop, as long as RAM is optimized; the cost is the
initial load when it is opened again.

## Decisions

- **A service sleeps when it is not in use.** Ten minutes after its tab left the screen, arcterm stops it. That is not
  the person's Stop: nothing is remembered, and the service reads `sleeping`. A sleeping service costs 0 MB. A service
  started while off screen (Start in the Services popover or the row menu) sleeps ten minutes after that start unless
  it is shown meanwhile; a start while the timer runs (a retry) does not push its ten minutes back.
- **In use** means its tab shows on the Agent surface while that surface is the one showing: in the centre (page or
  log), in a grid cell, or in the panel under the agent when the panel is not folded. History, a session or a
  subagent's interior in the centre hide every pane, so they count as off screen, as does a folded panel. The frontend
  tells wavesrv the whole set each time it changes. Idle by HTTP traffic is out: it would need a proxy.
- **A sleeping service starts when it comes on screen**: a click on its tree row, a row of the Services popover, a
  later rail pin, or the centre showing it when arcterm opens. The person waits for the first load; that is the
  accepted trade-off (a few seconds for the portfolio dashboard, 5–20 s for a Next dev server).
- **Keep running** is the `autostart` key, now default **false**, shown as "Keep running" (detail row sub: "Run it even
  when its page is not on screen, and start it with arcterm"; the same check in the row menu). On, a service behaves
  as today: it starts with arcterm and never sleeps. The key keeps its name: held services are still under
  `Unreleased` in `CHANGELOG.md`, so no entry in anyone's `tools.json` relies on the old default.
- **The person's Stop still wins.** A stopped service does not start when shown; Start clears it, as today.
- **What survives a sleep:** the remembered port, so the app's own state stored in the browser for
  `127.0.0.1:<port>` (localStorage, cookies) is still there. The portfolio dashboard keeps its tab group, chart symbol
  and timeframe that way (`live/app.js`). The terminal's scrollback stays too. The page's own URL and scroll are not
  restored on a Mac: the host cannot run script in the app's frame there (`app_frame_action` is a no-op off Windows,
  `src-tauri/src/pagekeys.rs:152`), so the page opens at its start URL.
- **The frame and the server sleep together.** The page frame is already dropped ten minutes after it was last on
  screen (`APP_FRAME_IDLE_MS`, `appmodel.ts`); the sleep uses the same ten minutes, and a sleeping service's frame is
  dropped at once.
- **Running elsewhere never sleeps**: arcterm did not start it. A `retrying` service that is off screen sleeps at the
  ten-minute mark like any other, which ends its retries.
- **Boot:** Keep-running services start; every other one starts as `sleeping`, except one the person stopped, which
  reads `stopped`.

## State and words

| State | Row words | Dot | Hover action |
|---|---|---|---|
| sleeping | `sleeping` | hollow, muted | none (showing it starts it) |

The header of a sleeping service reads `Sleeping · starts when shown` (seen only for the moment before it starts). The
Services chip counts a sleeping service neither as running nor as needing the person; the popover lists it with the
stopped ones. `canStart` holds for it, `canStop` does not. The popover's subtitle reads `held by arcterm` (no longer
"started with it"); a sleeping row has no hover action there either, and a click on it opens it in the centre, which
starts it.

## Wire

One new wshrpc command, `ServiceSeenCommand(ctx, { ids })`: the whole set of services on screen, sent each time it
changes and when the Agent surface mounts (an empty set included), so each report replaces the last and a frontend
reload heals itself. A service that joins the set has its sleep timer cancelled and starts if it sleeps; one that leaves
it has the ten-minute timer armed when it is without Keep running and arcterm owns its process (or it is retrying).
wavesrv keeps the set even for ids it does not know yet: Boot, and `SetTools` adding an entry, start a shown service
the person did not stop.

## Not in scope

- A per-service idle time: one ten-minute rule.
- Restoring the page's URL or scroll on a Mac.
- The nav rail pin: its own spec, `2026-10-20-rail-apps-design.md` (shipped in run 85770eac).

## Verification

- Go, with the supervisor's fake clock: the timer sleeps an unseen service at ten minutes and not before; showing it
  again cancels the timer; showing a sleeping service starts it; a stopped one stays stopped; Keep running never
  sleeps; boot leaves non-keep-running services sleeping; elsewhere never sleeps; a service started off screen sleeps
  at ten minutes; a set reported before Boot starts its shown service at Boot; a wake reuses the remembered port.
- vitest: the sleeping row words, header, chip and order; which services are on screen as a pure function (centre,
  grid cells, the panel, History, another surface); `formKeywords` writing `autostart: true` only when Keep running is
  on.
- CDP: a sleeping service starts when its row is clicked, and Keep running writes `autostart: true`. The ten minutes
  are not waited out in a scenario; the Go test covers them.
- The canvas board `RowStates` gains the Sleeping row.
