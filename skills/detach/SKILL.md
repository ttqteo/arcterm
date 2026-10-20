---
name: detach
description: Use when you start a dev server, database, watcher or other long-running process the user will keep using after this turn — via `wsh detach`, so it survives the terminal closing and arcterm restarting.
---

# Starting a process that outlives arcterm

Everything started from an arcterm terminal, your background shell commands included, dies when that terminal closes
and when arcterm quits, restarts or is reinstalled. `wsh detach` starts a command outside that tree instead.

- `wsh detach -- <command> [args...]` — runs it in the current directory with your environment and prints its pid,
  its log file and the command that stops it. Flags after the command name are the command's own:
  `wsh detach npm run dev -- --port 3000` passes `--port 3000` on to npm.
- `--log <file>` picks the log; by default it goes under the temp dir's `arc-detach` folder. Read it to check the
  process came up (`tail -n 20 <log>`); its stdin is empty, so it cannot prompt.
- A command that fails within a second comes back as an error with its log's tail.
- Stop it with the printed command (`taskkill /PID <pid> /T /F` on Windows, `kill -- -<pid>` elsewhere).

Rules:
- Use it for a process the user will keep using after your turn: a dev server, a local database, a file watcher.
  A short build, test or one-off script runs as usual.
- Tell the user its pid, log and stop command, since nothing in arcterm lists it.
- Before starting another copy, check the old one is gone (its port, or `tasklist /FI "PID eq <pid>"`).
- "a job object above this process does not allow breakaway" means the terminal is inside an arcterm from
  before `wsh detach`, or another app's job: say so and run the command the usual way.
