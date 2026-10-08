# docs

Design records and reference material for arcterm. `AGENTS.md` at the repo root is the working
reference for build commands, architecture, and gotchas — start there. `CHANGELOG.md` beside it
lists what each version changed for the user.

## Standing documents

| File | Role |
| --- | --- |
| `open-issues.md` | **The single "what's left" list** — actionable, blocked, held and declined items. Start here. |
| `deferred.md` | Append-only log of intentionally-deferred work and why. Append at the top, then mirror a one-line row into `open-issues.md`. |
| `orchestrator-redesign-flaws.md` | Living flaws tracker for the orchestrator engine; resolved rows kept as one-line summaries. |
| `keyboard-shortcuts.md` | Human-readable mirror of the keybinding registry (`frontend/app/store/keybindings/` is the source of truth). |

## Directories

| Path | What's in it |
| --- | --- |
| `reference/` | `architecture.md` (the full three-layer map extracted from `AGENTS.md`), `motion-system.md` (motion principles and tokens), and protocol references cited from source comments. |
| `agents/` | Integration notes for the agent reporters: tab auto-naming, usage reporting, and [Antigravity](agents/antigravity.md). |
| `superpowers/specs/` | Design docs — the **why** behind each feature. Written before implementation, kept after. |
| `superpowers/plans/` | Implementation plans while their work is in flight. Deleted once shipped; git history keeps them. |
| `superpowers/briefs/` | Findings reports, roadmaps and decision briefs, kept only while something live cites them. |
| `prototype/` | The few pre-rule design canvases that code comments and CDP scripts still cite. New mockups are never committed (`DESIGN.md` "Mockups"). |
| `guide/` | The user guide (Vietnamese): one page per surface, runs, the plan format and agent integration. Start at `guide/README.md`; its screenshots go in `guide/images/`. |

## Conventions

- Specs and plans are named `YYYY-MM-DD-<topic>[-design].md` and commit with the feature they describe.
- Cross-references are repo-root-relative (`docs/superpowers/specs/…`), not relative paths.
- A deleted doc is cited as `git show <commit>:<path>` so the pointer still resolves.
