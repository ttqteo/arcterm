---
name: learn
description: Use when the user corrects you, repeats an instruction, or says "from now on…" / "always…" / "never…" — note it with `wsh learn note` so a repeated correction becomes a lasting rule they approve.
---

# Noting what the user teaches you

When the user corrects how you work, repeats something they told you before, or states a lasting preference, note it.
Arcterm counts notes; when the same point comes up in two sessions it asks the user, in Needs you, whether to make it a
rule. Nothing changes until they say yes, so note freely but only real corrections, not one-off task details.

1. Pick the target: the vault skill the rule belongs to (`--skill <name>`, e.g. `notes`, `cockpit-runs`), or
   `--memory` for a rule about this project that no skill owns.
2. Reuse a key: `wsh learn list --skill <name>` (or `--memory`). If a listed key means the same thing, use it.
   Otherwise make a short kebab-case key (`notes-in-vietnamese`).
3. Note it, as one imperative line of at most 200 characters, with the user's own words as the quote:

   wsh learn note "Write notes in Vietnamese" --key notes-in-vietnamese --skill notes --quote "<what they said>"

- "Not noted: the user dismissed this before" means they declined this rule: follow their current instruction, do not
  note it again.
- If `wsh learn` fails, tell the user in one line and carry on; do not retry.
- Plugin skills (superpowers, anthropic-skills) cannot take additions: use `--memory`.
