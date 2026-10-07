# Needs you in the Cockpit — design

Status: design settled 2026-10-07. Reverses the "two disjoint badges, Jarvis is the list's home" rule of
`2026-07-27-jarvis-consolidation-design.md` §10 and `2026-07-31-attention-and-observability-design.md`
(L99-103, L266, L270), at the user's request: they handle requests in the Cockpit, whose request cards
they prefer, and Jarvis's badge sent them to a surface they find weaker for it.

## Problem

The nav rail splits the server's attention list (`splitAttention`, `attentionstore.ts`): items with a
channel badge Jarvis, standalone asks badge the Cockpit, radar triage badges Radar. A run agent's ask
already renders as a card in the Cockpit (the run card's answer bar), yet it lights the Jarvis badge. And
the non-ask items (`dag-gate`, `dag-blocked`, `run-unverified`, `run-land-held`, `escalation`) can only be
acted on in Jarvis's Waiting list.

## Decisions

1. **One badge for needs-you: the Cockpit's.** It counts every attention item except `radar-triage`
   (which keeps the Radar badge). Jarvis's nav entry shows no attention badge. The dock badge
   (`dockbadgesync.ts`) counts the same set as the Cockpit badge.
2. **A "Cần bạn" strip at the top of the Cockpit** lists the attention items that are not asks
   (`dag-gate`, `dag-blocked`, `run-unverified`, `run-land-held`, `escalation`), oldest first as the
   server orders them, scoped by the Cockpit's project filter like the grid. Each row: kind chip, source,
   text, age, and the same action Jarvis's Waiting row offers (`attentionAct`): Approve, Retry,
   Acknowledge, Land again; plus Open (opens the run sheet / run, as Jarvis's Open does). Hidden when empty.
3. **Asks stay cards.** An `ask` item is already a card (plain agent or run card); the strip does not
   repeat it. An `escalation` row's Open goes to the asking agent's card when that agent is in the roster
   (join through the escalation card's `askORef` / `workerORef`), else to the run.
4. **One implementation of the actions.** The Waiting row's action runner (`actOnQueue` in
   `briefsurface.tsx`) moves to a shared module that both Jarvis and the Cockpit call. Jarvis's Waiting
   list stays as it is.
5. **Human-owned dag-child asks** (`ChildAskCard`, `DagAsksCommand`) are out of scope here; they remain in
   the run sheet and the agent rail. Filed in `docs/open-issues.md`.

## Testing

- vitest: the badge split (Cockpit counts all but radar, Jarvis none), the strip's item filter and
  project scoping, the escalation → agent join, as pure functions.
- The shared action runner keeps Jarvis's behavior: existing Jarvis tests still pass.
- CDP: rendering is unverified until a scenario opens the Cockpit with a seeded gate (follow
  `docs/reference/cdp-run-fixtures.md`).
