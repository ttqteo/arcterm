# Antigravity (agy)

Antigravity CLI (`agy`) is a harness like Claude Code and pi: live status on the rail, questions on the cockpit card,
launch and resume, `ask @agy` consults, Conversation History, token usage, and plan task workers. Design:
`docs/superpowers/specs/2026-10-08-agy-harness-design.md`.

## What arcterm installs

`wsh install-agent-hooks` (run on every launch, when `~/.gemini/antigravity-cli/` exists) writes an `arcterm` key into
`~/.gemini/config/hooks.json`. It registers `PreInvocation`, `PreToolUse`, `PostToolUse` and `Stop`, each calling a fixed
copy of `wsh` under `~/.arc/bin/` as `wsh agy-hook <Event>`. The command also accepts `PostInvocation`. The
`PreToolUse` timeout is 3720 seconds, because a question waits for a person; every other event's is 10. Foreign keys
in `hooks.json` are kept, and a malformed file is reported and left alone.

Steering and skills sync like the other harnesses: steering goes to `~/.gemini/config/AGENTS.md`, skills to
`~/.gemini/config/skills/`, whenever `~/.gemini/config/` exists. The Antigravity desktop app reads the same
directory, which is intended.

## First run

Run `agy` once in a terminal before using it from arcterm. Its onboarding and Terms of Service page carry a
data-sharing consent only you can give; arcterm does not automate it. An agent that never reports (onboarding not done,
signed out) shows no status; a run worker in that state stalls at the five-minute first-token deadline.

## What the rail cannot see

- agy's own permission prompt (mode `request-review`) fires no hook, so there is no "waiting on permission" state.
  Run workers launch with `--dangerously-skip-permissions` and never prompt.
- The context size: agy's transcript has per-call token counts but no context window, so there is no context meter.
- Cost: tokens count, and cost shows $0, whatever model agy served.

## Questions

agy's `ask_question` tool is answered on the cockpit card, for interactive agents and run workers alike; the answer
returns to agy as the tool's denial reason. Outside arcterm (the desktop app, a plain terminal) the hook answers
neutrally and agy asks in its own UI. A heavy shell command waits its turn in arcterm's job queue like claude's and
pi's, but agy has no "command finished" event, so its slot is released as soon as the command starts.

## Runs

A run never leads on agy, even when Antigravity is the consult preference: the lead, reviewer and run-route pickers do
not list it and the server refuses the route. agy works plan tasks only. See `docs/deferred.md`, "agy as a run lead".
