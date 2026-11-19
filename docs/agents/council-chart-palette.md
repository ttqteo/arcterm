# Council chart palette

The four colours of the benchmark chart (Library → Councils → Benchmark, figure F of the council figures), one per
variant. They are `--color-chart-1..4` in
`frontend/tailwindsetup.css`, an identity palette that stays the same across themes (DESIGN.md "Identity palettes"):
`themes.ts` does not override them.

| Token | Variant | Hex |
|---|---|---|
| `chart-1` | solo | `#497bf8` |
| `chart-2` | council | `#c97a30` |
| `chart-3` | team | `#2a9d8f` |
| `chart-4` | brainstorm | `#b04fbf` |

These four are for figure F's variants only. A seat is never drawn in a chart colour: the seat tones `conn-*` sit above
the lightness band for a dark surface, so a seat is told apart by its row, avatar and name. A variant also wears a shape
(solo ●, council ■, team ▲, brainstorm ◆) and a direct label, so colour never carries it alone.

## Why these four

On 2026-11-19 they passed every check of the dataviz validator on `#1c1c1c` with `--pairs all` (a scatter point can sit
beside any other): worst colour-blind ΔE 10.1, worst normal-vision ΔE 18.5. The seat tones `conn-*` and a blue/purple
pair both failed.

## The validator run

- **Validator used:** the dataviz skill's `scripts/validate_palette.js`, here
  `/tmp/claude/bundled-skills/2.1.328/68a512fbb7788a0d1d9cf6ec321e1275/dataviz/scripts/validate_palette.js` (the folder is
  versioned by the Claude Code install; find the newest with
  `ls -d /tmp/claude/bundled-skills/*/*/dataviz/scripts/validate_palette.js | tail -1`).
- **Command**, one run per distinct `surfaceRaised` in `THEMES` (`frontend/app/view/agents/themes.ts`):
  `node <validator> "#497bf8,#c97a30,#2a9d8f,#b04fbf" --mode dark --pairs all --surface <surfaceRaised>`
- **Result, 2026-11-19:** every theme exits 0 with "ALL CHECKS PASS": lightness band, chroma floor, CVD separation,
  normal-vision floor. The colour-to-colour ΔE does not depend on the surface, so the worst pairs are the same in every
  theme: **ΔE 10.1** colour-blind (`#b04fbf` ↔ `#2a9d8f`, deutan; tritan 4.5) and **ΔE 18.5** normal vision
  (`#b04fbf` ↔ `#497bf8`). The one check that varies with the surface is contrast against it:

| Theme | `surfaceRaised` | Worst ΔE (colour-blind / normal) | Contrast vs surface |
|---|---|---|---|
| Graphite | `#1c1c1c` | 10.1 / 18.5 | all 4 ≥ 3:1 |
| Claude, Spider | `#30302e` | 10.1 / 18.5 | WARN: `#b04fbf` 2.97:1 |
| Midnight | `#13171d` | 10.1 / 18.5 | all 4 ≥ 3:1 |
| Slate | `#161d2b` | 10.1 / 18.5 | all 4 ≥ 3:1 |
| Carbon | `#1b1b18` | 10.1 / 18.5 | all 4 ≥ 3:1 |
| Nocturne | `#191527` | 10.1 / 18.5 | all 4 ≥ 3:1 |
| One Dark | `#2f343d` | 10.1 / 18.5 | WARN: `#b04fbf` 2.81:1 |
| Monokai | `#33342d` | 10.1 / 18.5 | WARN: `#b04fbf` 2.82:1 |
| Christmas | `#16241d` | 10.1 / 18.5 | all 4 ≥ 3:1 |
| Jarvis | `#0f1b2c` | 10.1 / 18.5 | all 4 ≥ 3:1 |

No theme fails, so no slot was stepped (the plan steps a slot's lightness only on a failure). The three WARNs are the
validator's "relief required: visible labels or table view" for the brainstorm purple a hair under 3:1 on the three
lightest surfaces; figure F gives it both (a direct label on every newest-harness point, and the Table toggle), and the
purple is never the only way to tell brainstorm apart: it is the only ◆. If a theme later fails a hard check, step that
slot's lightness (keep it inside L 0.48–0.67) and rerun the loop above over every theme.
