# Council seats pick their model by responsibility

## Intent

A council seat's model should follow what the seat has to do for the question at hand. A seat that gathers, plans or
asks runs on sonnet; a seat that has to judge whether the question's central claim, method or result holds runs on
opus. Today the rule is by position only: every role seat runs sonnet (`ModelExpert`, `pkg/council/roles.go:15`), the
coordinator runs opus (`ModelCoordinator`), and an agent that writes roles follows the same mould.

## What runs today (context)

- A role with no model gets sonnet (`pkg/council/roles.go:140`). Setup's Suggest always gives a suggested role
  `ModelExpert` (`pkg/council/runner.go:3454`) and asks for Vietnamese names through `LangLine`
  (`pkg/council/prompts.go:1178`). Setup has a per-seat model picker (`frontend/app/view/agents/councilsetup.tsx:1426`).
- `wsh council start` and `wsh council estimate` take `--model <seat>=<model>` for one council; a named seat wins
  over a bare `--model` (`skills/council/SKILL.md:72-74`). The skill says to pass it only "when the person asks for
  one".
- A role in `councilroles.json` has only `id`, `name`, `brief` and `model` (`pkg/wconfig/settingsconfig.go:198`). A
  name the person or an agent chose keeps that name in every council (`pkg/council/roles.go:159`); only a stock role has
  a Vietnamese twin (`NameVi`) that follows the question's language.
- The thesis panel (`thesis-*`, `conf-*`) was hand-written into `councilroles.json` by an agent: every seat sonnet,
  Mentor and Area chair opus, English names. `skills/council/SKILL.md` says nothing about writing roles.

## Decisions

### Scope

The change is to `skills/council/SKILL.md` only, which ships in the arc mod (`skills/` is embedded by
`skills/skills.go`). It changes what an agent does when it starts a council (`wsh council start`) and when it writes a
role. Setup's Suggest, the role file's fields and any new `wsh` command stay out of scope: no Go change.

### When a seat gets opus

The choice is made at each start, from that council's question, not fixed in the role. A role keeps the sonnet
default (an agent writing a new role leaves `model` out, or writes `sonnet`; a role the person set to opus stays opus).
Each time an agent runs `wsh council start`, it reads the question and puts the seat or seats that carry its hardest
part on opus with `--model <seat>=opus`. This applies to stock roles and the person's own roles alike. The coordinator
keeps its own model.

How the agent knows what each seat does (Agent's call): the skill carries no table of roles. It names in one line the
stock roles whose job is to judge (`reviewer-a`, `reviewer-b`, `skeptic`, `contrarian`), and tells the agent to read the
briefs of the person's own roles in `councilroles.json` (`wconfig.CouncilRolesFile`, in arcterm's config dir).

### Before an opus seat starts

Before it starts, the agent says in one line which seats go to opus and why, with the token estimate from
`wsh council estimate` run with the same `--model` flags. It says plainly that the estimate counts tokens only and does
not reflect opus costing more: tokens are counted, not priced (`pkg/council/estimate.go:33`), and the Token burn gate
takes the same number (`pkg/tokengate/tokengate.go:59`). Then it starts the council, and the person approves on the
Token burn card, as for any council. There is no extra question to the person. The run adds one `(arcterm)` line to
`docs/open-issues.md`: the council estimate and the Token burn card are model-blind, so an opus seat looks as cheap as a
sonnet one.

### Names of agent-written roles

When an agent writes a role into `councilroles.json`, it writes the role's `name` in the language the person is writing
to it in (Vietnamese for a Vietnamese conversation). The `id` stays an English kebab-case slug. No `nameVi` field is
added.

### Vetting a new role before it joins the library

Before an agent writes a new role into `councilroles.json`, it drafts the role, checks the draft against a checklist in
`skills/council/SKILL.md`, and revises it:

- it does not duplicate a role already in the library (stock or the person's own);
- it holds one angle only;
- its brief ends with the evidence rule every stock brief ends with (`briefEvidenceRule`, `pkg/council/roles.go:19`);
- its name is in the person's language (above).

Then it shows the final name and brief to the person in chat, and writes the role only once they approve. No council
or bench reviews the draft. This is one more turn with the person before such a council starts, on top of the one-line
opus notice.

Roles already in the file (Agent's call): the run changes only the skill and never edits the person's
`councilroles.json`. The thesis panel keeps its names and models; Mentor and Area chair are coordinators, so they keep
opus under the rule above anyway. Renaming that panel to Vietnamese is a separate edit outside the run.

### Left to the builder

- Where in `skills/council/SKILL.md` the rules go: the start rule beside the `--model` bullet in "Starting it" (which
  today says to pass `--model` only when the person asks; that wording changes), and the naming rule in a short new
  section on writing roles. Their wording.
- How the agent tells which seat carries the question's hardest part. Guess: a seat whose brief must judge whether the
  question's central claim, method or result holds, and no opus seat at all when the question is a light one (a
  wording pass, a list of ideas, a UI review).
- The `CHANGELOG.md` line: the skill reaches every user through the arc mod, so one `Changed` line in the top section.

## Testing

The skill is prose read by an agent; there is no unit test for it. Check that `claude plugin validate claude/arc-mod`
still passes after `task sync:claudemod` if the build copies skills there, and read the changed section once as an agent
would. A hand check in `docs/hand-checks.md`: start a council on a thesis question in a live session and see the
agent name its opus seat and price before the Token burn card.
