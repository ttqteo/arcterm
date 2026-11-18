# Answer Arc from your phone

Remote mode puts what waits on you (an agent's question, a lead's approval, a held or blocked run)
on an installed iPhone web app, and lets you answer agent questions from it. Agents you hand over can
also be driven from it (see Hand an agent to the phone below). It runs only while you turn it on: off
means the tunnel and the phone listener are both stopped. Designs:
`docs/superpowers/specs/2026-10-27-answer-arc-from-phone-design.md` and
`docs/superpowers/specs/2026-11-03-arc-pwa-more-design.md`.

The phone reaches Arc one of two ways, picked under Settings → Remote → Connection:

- **Tailscale** (`pkg/remotemode/tailnet.go`): `tailscale serve` puts the phone listener on this machine's tailnet
  address, `https://<pc>.<tailnet>.ts.net`, open only to devices in your tailnet. No domain and no Cloudflare account;
  the phone runs the Tailscale app whenever you use it.
- **Cloudflare**: a named tunnel on a domain you own, behind Cloudflare Access. Arc never holds a Cloudflare API
  token; it holds only the tunnel token, in its secret store.

Either way the listener binds `127.0.0.1` only, and the push notifications go through Apple's push service, not the
tunnel.

## Set up with Tailscale

1. **Install Tailscale** on the PC and on the iPhone, and log both in as the same user.
2. **Turn HTTPS on for the tailnet** once: the admin console, DNS, HTTPS Certificates (MagicDNS must be on too).
   Without it the status reads "Serve is not enabled on your tailnet: enable it at <link>"; open the link, enable,
   and the address comes up by itself.
3. **Pick Tailscale** in Settings → Remote → Connection, or run `wsh remote setup --provider tailscale`. The tailnet
   address and the one login let in are read from `tailscale status`; `--hostname` and `--email` (or the two fields)
   override them, and a hand-set login is kept by later setups.
4. **Turn it on**: the switch, or `wsh remote on`. Arc runs `tailscale serve --https=443 http://127.0.0.1:<port>` in the
   foreground as its child, so the serve config lasts only while remote mode is on; turning off kills it and
   tailscaled drops the config. It takes port 443 of the tailnet address, so it clashes with a serve of your own there.
5. **On the iPhone**, with the Tailscale app connected, open the address in Safari, Share, Add to Home Screen, open it
   from the icon and tap **Turn on notifications**.

Every request must carry `Tailscale-User-Login`, which `tailscale serve` sets for a device's logged-in user after
dropping any copy the client sent, and it must match the stored login; a tagged device, a Funnel request or another
tailnet user gets 403. A program on the PC itself can reach the loopback listener directly and could forge the header,
but such a program can already drive Arc through `wsh`.

## Set up with Cloudflare

1. **Install cloudflared** on the PC: `winget install --id Cloudflare.cloudflared`.
2. **Create a named tunnel** in the Cloudflare dashboard (Zero Trust, Networks, Tunnels). Add a
   public hostname on your own domain (for example `arc.example.com`) pointing at
   `http://localhost:47821` (the default port; use your own if you pass `--port` below). Copy the
   tunnel token the dashboard shows.
3. **Create an Access application** (Zero Trust, Access, Applications, self-hosted) for that
   hostname, with one policy that allows only your email, by one-time PIN or Google. Note the team
   name (the part before `.cloudflareaccess.com`) and the application's AUD tag (on the
   application's overview).
4. **Give Arc the details.** The token is read from stdin, never a flag, so it stays out of the
   process list and your shell history:

   ```
   wsh remote setup --team <team> --aud <aud-tag> --email <you@example.com> --hostname arc.example.com [--port N]
   ```

   Type the token at the `Tunnel token:` prompt, or pipe it in. Setup prints the status; a re-setup
   keeps the stored phone subscription.
5. **Turn it on:** `wsh remote on`. `wsh remote status` shows whether the tunnel is `up`, and
   `wsh remote off` turns it off. The cockpit shows the same state: Settings → Remote, and a Remote chip
   in the footer once setup is complete.
6. **On the iPhone**, open `https://arc.example.com` in Safari and log in. Share, Add to Home
   Screen. Open Arc from the new home-screen icon (push only works from the installed app), and tap
   **Turn on notifications**.

`wsh remote status` reads, for example:

```
Remote mode: on
Address: https://arc.example.com
Local port: 47821
Tunnel: up
Phone: subscribed (1)
Setup: complete
```

If it prints `cloudflared not found`, install it as in step 1.

## Check the login on a real iPhone

The home-screen app keeps its own cookies apart from Safari, and the Access login redirects to the
team's cloudflareaccess.com address, which may open outside the installed app and never bring the
login back. Check this once, as the first use of the finished feature:

1. With remote mode on, open the installed app from the home screen and log in from inside it.
2. Have an agent ask a question and wait for the push on the phone.
3. Open the app from that push.
4. Answer the question, and see the agent continue at the desk.

A failed login looks like one of these:

- the login page opens in Safari instead of inside the installed app, and the app stays on the login;
- the app loops back to the login after you finish it.

If the login cannot be completed inside the installed app, report what you saw instead of
loosening anything. The Access check on every request and the owner-email lock stay as they are;
nothing is bypassed to make the login work.

## The Agents list

Under what waits on you, the phone page lists the agents that are alive in the cockpit, except the ones already handed
over (those sit under **Handed over**). A session that exited back to its shell is not listed, and a run's workers are
not listed one by one: they are grouped under **Runs** (below). The list is both a glance at what is running and the way
to take an agent to the phone. It comes from the same `/api/waiting` call as the rest of the page (`BuildAgentList`,
`pkg/remotemode/agents.go`), and a roster that cannot be read leaves it empty rather than failing the page.

Each row has the agent's name (and its project, only when that differs from the name), a dot coloured by what the agent
is doing, the state chip, and a second line: a working agent shows what it is doing, one asking you shows its question,
one waiting for approval shows what it wants to run, and an idle one shows the first sentence of its last reply (at
most 160 characters; arcterm rereads the transcript only when its file changed). Rows are ordered asking, needs
approval, needs input, working, idle, the longest wait first within a state.

- **Taking an agent.** Tap a row to take it: the phone asks arcterm to hand the agent over and opens its chat, the same
  one a hand-over from the desk gets (see below), and at the desk its header reads **On phone · Take back**. A row the
  phone cannot take (a codex, agy or opencode session, an agent with no terminal) is dimmed and does nothing. When
  arcterm refuses a take (the session exited since the page last refreshed, say), the row shows "Not taken: <why>"
  under its line and stays listed; the reason stays until the next take of that row.
- **Leaving without acting gives it back.** If you leave the chat (Back) without sending, stopping, approving or
  denying anything, the agent returns to the desk by itself and is listed again. Once you have done one of those, the
  take stays until **Take back**, the agent exits or remote mode turns off, like a hand-over from the desk, which
  leaving never releases. A phone that closes or locks mid-chat gives nothing back: take it back at the desk.
- **Runs.** A run with a live worker is one row under **Runs**: its name, the workers' states counted ("2 working · 1
  needs approval"), and **Needs you at the desk** when a worker is asking or waits for approval or input (such a run
  sorts first; the phone cannot answer a worker, it says to go to the desk). Tap it to open one line per worker (its
  task, "Review: " and the task for a reviewer, "Plan reviewer", "Verifier" or "Land resolver" for a stage session,
  then what it is doing); tap again to close it. Workers are read-only, since they cannot be taken, and an open run
  stays open through the 10-second refresh, not a reload. A run's orchestrator lead and a Quick run's agent are not
  workers: they are ordinary rows.
- **Older messages.** A chat opens on the latest messages (the stream's last 200 transcript lines). Scroll to the top
  and it loads the page before them (`GET /api/agents/<tab>/transcript?before=<byte offset>`, 200 lines a page, until a
  screenful of new messages or the session's start), keeping the message you were reading in place. When the connection
  drops, the stream resumes at the byte after the last line the page has (the SSE `Last-Event-ID`), so the live
  messages continue with no gap and no repeat, and what you scrolled back through stays.
- **The header's count.** It reads "N need you", or "Nothing waits on you", and counts each thing once: the open
  questions, the held, blocked and other items under Held runs, and every agent (handed over, listed or a run's
  worker) waiting for approval or input. An agent that is asking counts through its question, not again as an agent,
  and a working or idle agent never counts. The line under it counts what the page lists.

### Computer

Above **Turn off remote mode**, **Computer** has **Lock**, **Volume down**, **Mute** and **Volume up**, on the main
view and the empty one. A press is one request, with no confirm: unlocking needs your password at the desk, and locking
stops no agent. A refusal or a failure shows its reason under the buttons until a later press goes through
(`POST /api/pc/lock`, `POST /api/pc/volume` with `{"step": "down" | "mute" | "up"}`, `pkg/remotemode/pc*.go`).

- **Windows:** Lock calls `LockWorkStation`; each volume button presses the keyboard's media key once (about 2%).
- **macOS:** Lock runs `pmset displaysleepnow`, which locks the screen only when the account asks for its password at
  once on sleep (the default); volume moves the output volume by 6 points, and Mute toggles it.
- **Elsewhere** there are no controls: `/api/waiting` carries `pc: false` and the page leaves the section out.

The page shows no volume level: neither platform's media keys can read it.

## Hand an agent to the phone

A handed-over claude or pi agent shows on the phone page under **Handed over**. There you read its
transcript, send the next prompt, stop a turn, and approve or deny a Claude Code permission prompt.
What you type reaches the session as your own input.

- **From the cockpit:** **Hand to phone** in the agent header's More (⋯) menu, or `p` with the agent
  focused. Handing an agent over turns remote mode on if it is off. While it is on the phone the header
  shows **On phone · Take back**, which (or `p` again) returns it.
- **From a terminal:** `wsh remote hand [tab]` and `wsh remote take-back [tab]`. The tab is an id or a
  unique prefix. With no tab, `wsh` acts on the agent in the terminal it runs in, so an agent can hand
  itself over.
- **From the phone:** tap the agent in the Agents list (above). A take you leave without acting on goes back by itself.

Only a live claude or pi session in a terminal can be handed over: a run's task worker, reviewer,
stage session or lead-started child cannot, nor can a codex session, a closed tab, or a session that
has exited back to its shell. A refused hand-over says why and does not turn remote mode on.

A hand-over ends when:

- you take the agent back (`taken`);
- its session exits, or its tab closes (`exited`): the phone shows "Back at the desk". This lands about
  15 seconds later: an agent that drops out for less (seen once on a live claude session) keeps its
  hand-over, and the phone's sends and presses are refused until it is back. wavesrv logs each drop-out
  with its reason (`remote mode: hand-over of tab ...` in `waveapp.log`);
- remote mode turns off (`off`): the phone page goes offline, and every hand-over is cleared.

Hand-overs live in memory only. An Arc restart ends them all, even when remote mode itself comes back
on at start. Re-running `wsh remote setup` restarts the listener but keeps them.

## Turning it off

`wsh remote off`, the switch in Settings → Remote, or **Turn off remote mode** at the foot of the phone
page. The page then goes offline and the PC may sleep again.
