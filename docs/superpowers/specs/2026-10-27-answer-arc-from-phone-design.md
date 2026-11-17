# Answer Arc from your phone

## Intent

Things that wait on the owner (an agent's question, a lead's approval, a held or blocked run) reach
an iPhone while the owner is away from the desk, and the owner can answer questions from there. It
came out of an open exploration of what Arc could do next. Every comparable agent cockpit (GitHub
Copilot app, Claude Code Agent View, Omnara, Conductor) has some remote or mobile path; Arc has
none. Nothing in `pkg/` sends anything off the machine, and the attention popup is desktop-only.

## Why: what the data says

- **Runs held at landing are the long waits.** From `db_runevent` in the packaged store
  (2026-08-26 to 2026-10-27): of 34 held lands, the median wait to land is 7 min, the p90 is 14.7 h,
  7 waited over 2 h, and about 361 h in total. A blocked DAG clears in a median of 1 min (p90
  5 min), but 3 sat over 2 h, the longest 70 h.
- **Why runs are held.** About 21 to 24 of the 34 come from checkout or git state: git refused the
  merge over untracked or uncommitted files, unstaged edits to files the run changes, or a
  landing-tree problem. These are cleared at the desk. The final stage failing accounts for 9 more.
- **Regular agents' questions rarely wait.** 431 `AskUserQuestion` calls in the last 30 days across
  every Claude Code session: median 0.6 min to answer, p90 1.9 min, p99 5.8 min; 2 waited over
  30 min. Not measured: permission prompts, and agents sitting idle after a turn.

So the feature matters most in the evening, overnight or at lunch. The owner learns that something
is waiting and why, and answers whatever can be answered with a tap or a line.

## Goals

- Anything the cockpit flags as waiting on the owner reaches the phone: held and blocked runs, a
  lead's questions, and a regular agent's question (Claude Code or pi). It uses the same definition
  as the cockpit's waiting list (`pkg/jarvis/attention.go`).
- From the phone, the owner **answers questions**: picks an option or types a line. Nothing else
  acts on agents or runs: no rerun, no release, no fix, no diff.
- Remote mode is an explicit switch. It is on only while the owner turns it on, and while it is off
  the page cannot be reached at all.

## Non-goals

- Acting on runs from the phone (rerun a Final, release a hold, hand a hold to an agent).
- Diffs or file contents on the phone.
- Sending a new prompt to an agent that finished its turn (remote chat).
- Android; the owner's phone is an iPhone.
- Turning remote mode on from the phone.

## Anti-goals

- The main wavesrv listener, its per-launch auth key, or any RPC beyond the few this feature needs
  being reachable from off the machine.
- Arc holding a Cloudflare API token, or anything else able to change the owner's Cloudflare
  account.
- The page staying reachable while remote mode is off.

## The design

### Remote mode, the switch

- `wsh remote on`, `wsh remote off` and `wsh remote status`, in the spirit of Claude Code's `/rc`.
  Agents can run them too. The cockpit has the same switch and shows while remote mode is on.
- It is turned off by `wsh remote off`, by the cockpit switch, or by a **Turn off remote mode**
  button on the phone page. Turning it on happens only at the desk: once it is off, the page is
  gone.
- It never turns itself off: no idle timeout, no time limit, no turning off when the owner comes
  back.
- **Off means unreachable.** Off stops cloudflared and the phone listener, and the address answers
  nothing.
- **While on, Arc keeps the PC awake.** It asks Windows not to sleep, using the execution-state call,
  while the screen may still turn off. Turning remote mode off, from anywhere, or Arc exiting
  returns the normal sleep setting. This PC sleeps after 2 hours idle on power (`powercfg`: AC
  standby 7200 s), so without this the phone would lose Arc partway through an evening.
- Agent's call: remote mode survives an Arc restart. If it was on, it comes back on.

### The path off the machine

- **Cloudflare Tunnel + Access, on the owner's own domain.** A named tunnel (the free
  trycloudflare.com quick tunnels cannot carry an Access login) publishes the phone page at an
  address under the owner's domain, behind a Cloudflare Access login.
- **First-time setup is by hand, then Arc runs it.** The owner creates the named tunnel and the
  Access application, with a policy allowing only their email, once in the Cloudflare dashboard.
  `wsh remote setup` takes the tunnel token and the Access team name (plus whatever identifies the
  Access application, such as its audience tag) and stores them in `pkg/secretstore`. `wsh remote
  on` starts cloudflared with the token. Arc never holds a Cloudflare API token.
- Agent's call: if `cloudflared` is not installed, `wsh remote setup` says how to install it
  (winget) and does not install it itself.
- Ship a short written guide for the one-time dashboard steps.

### Who can reach it

An answer typed on the phone goes into an agent that can run commands on the PC, so whoever reaches
this page can effectively drive the machine. There are two locks:

1. **Cloudflare Access:** a login in front of the address. Only the owner's email gets through,
   with a one-time code or their Google login, and everyone else stops at Cloudflare.
2. **Arc checks the login itself.** Cloudflare attaches a signed token (`Cf-Access-Jwt-Assertion`)
   to every request. The phone server verifies it on every request against the team's published
   signing keys and the application's audience, and refuses any request without a valid token for
   the owner. If the Access rule were ever deleted or misconfigured, the page would still let no
   one in.

**A small, separate server.** cloudflared forwards only to a second listener inside wavesrv, on
127.0.0.1. It serves the phone page and exactly four calls: list what is waiting, answer a
question, turn remote mode off, and store the phone's push subscription. (Agent's call: the third
call follows from the phone's off button, the fourth from notifications.) The main wavesrv listener, which the cockpit uses for
everything, stays as it is (`pkg/web/web.go` `MakeTCPListener`, random port, per-launch key). The
small listener runs only while remote mode is on.

### Check the login on a real iPhone, after the run lands

The home-screen app keeps its own cookies apart from Safari, and the Access login redirects to the
team's cloudflareaccess.com address, which may open outside the installed app and never bring the
login back. No engine worker can hold the owner's phone or click through the Cloudflare dashboard,
so this check is not a plan task: the owner chose to make it after the run lands, as the first use
of the finished feature (setup, Add to Home Screen, log in from inside the installed app, receive a
push, open the app from that push, answer a question). The guide lists these steps and what a
failed login looks like. If the login cannot be completed inside the installed app, the owner comes
back with what was found. No fallback is pre-approved, and both locks stay as written (builder
question 2).

### The phone page

An installable web app (manifest and service worker), served by that small listener and installed
on the iPhone's home screen. Mockup: `.superpowers/design/arc-remote-phone/project/`, with the
boards `Main`, `Answer`, `Empty` and `Unreachable`.

- **The list (`Main`).** Questions come first. Each shows the agent, its project, a runtime dot,
  how long it has waited, the question's header and text, and leads to the answer view. Held runs
  follow, each with the run's title, project and age, the hold reason word for word, and "Clear it
  at the desk". The header shows "Remote on" and counts. The foot has the **Turn off remote mode**
  button, with a line saying the page goes offline and the PC may sleep again.
- **Answering (`Answer`).** It shows the question's full text and, folded under one line, only what the ask
  itself carries: the options' descriptions and previews. A plan or spec appears only when the
  agent put it in a preview; Arc does not look up or read files for the phone (builder question 1). The options are large rows (touch targets of at least 44 px), numbered,
  with the recommended one marked. Below them are an own-answer field and one **Send answer**
  button. After sending, the view shows "Answered" and what was sent, with a link back to the list.
  It follows the cockpit's answer bar (`frontend/app/view/agents/answerbar.tsx`): asking amber,
  numbered rows, the recommended mark.
- **Nothing waiting (`Empty`)** and **Arc not reachable (`Unreachable`).** Agent's call: `Empty`
  drops the board's "[N] agents are working" count, since nothing on the server counts working
  agents today; the "your phone buzzes" line stays. The second covers remote
  mode being off or the PC being asleep or offline. It says that turning it off from the phone
  leads here, and that it is turned back on at the desk with `wsh remote on`.
- Other waiting kinds (blocked runs, unverified runs, escalations, workflow scans) are shown, not
  acted on, like held runs.
- The look comes from `DESIGN.md` and the `@theme` tokens in `frontend/tailwindsetup.css`: Midnight
  palette, Hanken Grotesk and JetBrains Mono, no text under 10.5 px.

### Notifications

- While remote mode is on, every new waiting item pushes to the phone as soon as it appears: the
  owner turned remote mode on because they are leaving, so there is nothing to filter. While off,
  nothing is pushed.
- iOS delivers Web Push only to a page added to the home screen (iOS 16.4 or later), and asks for
  permission only after a tap inside it. One-time steps on the phone: open the address in Safari,
  log in through Cloudflare, Add to Home Screen, open it from there, and tap **Turn on
  notifications**. Arc stores the subscription.
- A push carries the agent and the question's header, not the full text. The text loads in the page
  after the Cloudflare login.

## What exists to build on

- `pkg/jarvis/attention.go` is the single, server-side definition of what is waiting: blocked DAGs
  and held lands, escalations, asks, unverified runs, workflow scans.
- `pkg/agentask` keeps pending asks in memory, keyed by block. `AnswerAgentCommand`
  (`pkg/wshrpc/wshserver/wshserver_ask.go`) encodes an answer and injects it into the agent.
  `publishAgentAsk` raises the event the cockpit and the attention popup react to.
- `pkg/secretstore` encrypts secrets on Windows (DPAPI).
- `pkg/web/web.go` holds the existing listener setup.
- Tauri packaging is Windows-only, so everything here is Windows.

## Builder's calls

The spec left these to the builder. Each is the agent's call, made while planning.

**Where it lives.**

- One Go package, `pkg/remotemode` (`pkg/remote` is taken by the SSH connection code), holds remote mode: its stored configuration and state, the small
  listener and its routes, the Access token check, Web Push, keep-awake, and the cloudflared child.
  wavesrv starts it; `wsh remote` and the cockpit reach it through new wshrpc commands.
- The phone page is plain HTML, CSS and JavaScript with no build step, embedded into wavesrv with
  `go:embed` (the served files under `pkg/remotemode/web/static/`). A Vite build would have to run before the Go build and
  bundle into wavesrv, which nothing in the build does today. Its testable logic is a pure ES
  module with a vitest test beside it, like the frontend's `foo.ts` and `foo.test.ts`.
- The page's colors and fonts come from the cockpit's single source: a sync step (run by every dev
  and backend build, like `sync:piartifacts`) writes the `@theme` `--color-*` and `--font-*` values
  of `frontend/tailwindsetup.css` to `pkg/remotemode/web/static/tokens.css` and copies the Hanken Grotesk and
  JetBrains Mono woff2 files from `public/fonts/`. The copies are committed, so `go build` works in
  a fresh tree, and never hand-edited.

**Stored configuration.** One `pkg/secretstore` entry holds a JSON object: the tunnel token, the
Access team name, the application's audience (AUD) tag, the owner's email, the public hostname, the
local port, the VAPID key pair, the stored push subscriptions, and whether remote mode is on. One
entry keeps one source for all of it. On wavesrv start, if it says on, remote mode turns on.

**`wsh remote setup`.** Flags for the team name, audience tag, owner email, public hostname and an
optional local port (a fixed default the guide names; the tunnel's public hostname points at
`http://localhost:<port>` in the dashboard). The tunnel token is read from stdin, not a flag, so it
stays out of shell history and the process list. It generates the VAPID key pair once. If
`cloudflared` is not found, it prints the `winget install` line and stores the rest.

**cloudflared.** Started as a child of wavesrv with `tunnel --no-autoupdate run` and the token in
the `TUNNEL_TOKEN` environment variable, never in its arguments, inside a kill-on-close job object
(`pkg/util/jobobject`) so it cannot outlive Arc. Its output goes to the wavesrv log. If it exits
while remote mode is on, Arc restarts it with a backoff and status reports the tunnel as down with
its last error line.

**The Access check (lock 2), on every request.** The `Cf-Access-Jwt-Assertion` header must be an
RS256 token signed by a key from `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`
(cached, refetched on an unknown key id), with the stored audience, the team as issuer, a valid
expiry, and the owner's email (case-insensitive). It uses `golang-jwt/jwt/v5`, already a
dependency. Anything else gets 403 and a log line. The POST calls (answer, turn off, store the subscription) also require a JSON content
type and an `Origin` that matches the public hostname: Cloudflare adds the token to any request
that carries the owner's Access cookie, so without this a page on another site could post a form
through the owner's own login.

**What the phone can answer.** Agent questions (`ask` items: a regular agent's or a lead's) are
answered. Held and blocked runs, escalations, unverified runs and workflow scans are shown only. The
list call returns the waiting list from `GatherAttention` and, for each ask, the pending ask's
questions and ask id from the registry. The answer call takes the block oref, the ask id and one
answer per question in the cockpit's `AgentAnswerItem` shape, and goes through
`agentask.DeliverAnswer`, the path `AnswerAgentCommand` uses. An ask that was answered or withdrawn
meanwhile (a different ask id, or none) is refused; the phone says so and returns to the list.

**Answering many questions at once.** A multi-question ask shows every question on one Answer view,
each with its own options and own-answer field, and one **Send answer** for all. A multi-select
question's rows toggle. A prose ask submits the picked label as text, as the cockpit's answer bar
does.

**Push.** While remote mode is on, the server reads the waiting list on a short fixed interval and
pushes each item it did not see on its previous read (a question is told apart by its key and ask
id, so an agent's next question pushes too, and an item that leaves and comes back pushes again).
What was already waiting when it turned on is not pushed: the owner just saw it at the desk. The payload names the agent or
run and the question's header (for a run, the kind of wait), never the question text or the hold
reason. Web Push is implemented with the standard library (RFC 8291 payload encryption, RFC 8292
VAPID), with no new dependency. A subscription the push service reports gone (404 or 410) is
dropped.

**The page and its service worker.** The manifest is linked with credentials, so its fetch carries
the Access cookie. The service worker caches the page shell. A navigation answered by a redirect
(Cloudflare's login) goes through untouched; a failed fetch or a 5xx (the tunnel down, the PC
asleep) shows the cached shell, which draws `Unreachable` with the last time it reached Arc, kept on
the phone. The list refreshes on open, when the page becomes visible, and on a short interval while
visible.

**Keep-awake.** `SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED)` on a goroutine locked
to its OS thread for as long as remote mode is on, since the state belongs to the thread that set
it. Turning off clears it on that thread; Arc exiting ends the process, which releases it.

**The cockpit.** A Settings section, Remote, holds the switch and status lines: setup complete or
what is missing, the tunnel's state, the public address, and whether a phone has subscribed. Until
setup is complete, the switch is disabled and says to run `wsh remote setup`. While remote mode is
on, the app bar shows a **Remote on** pill that opens Settings > Remote. A `remote:status` event,
published on every change (including the phone's off button), keeps both current. Setup stays a CLI
step.

**The guide.** `docs/remote-phone.md`: the dashboard steps (named tunnel, its public hostname
pointing at the local port, the Access application with an allow-only-my-email policy, where to
find the team name and AUD tag), `wsh remote setup`, the phone steps, and the login check above.

**Checking it over CDP.** The phone page cannot be opened in the dev app's window, and turning on
remote mode needs a real tunnel. A dev-only program, `cmd/remotepreview` (never built into wavesrv
or shipped), serves the real phone handler on a random loopback port with a fixed waiting list, a
recording answer sink and a test token check. A `remote-phone` scenario drives it in headless Edge
or Chrome at 390 by 844 (as `scripts/cdp/design-states.mjs` already does) through the four boards
and the Answered state. A `remote-switch` scenario covers Settings > Remote and the app-bar pill in
the dev app, with the status set through the frontend store.
