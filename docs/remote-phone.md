# Answer Arc from your phone

Remote mode puts what waits on you (an agent's question, a lead's approval, a held or blocked run)
on an installed iPhone web app, and lets you answer agent questions from it. Agents you hand over can
also be driven from it (see Hand an agent to the phone below). It runs only while you turn it on: off
means the tunnel and the phone listener are both stopped. Designs:
`docs/superpowers/specs/2026-10-27-answer-arc-from-phone-design.md` and
`docs/superpowers/specs/2026-11-03-arc-pwa-more-design.md`.

The phone reaches Arc through a Cloudflare named tunnel behind Cloudflare Access. Arc never holds a
Cloudflare API token; it holds only the tunnel token, in its secret store.

## Set up

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
   `wsh remote off` turns it off. The cockpit shows the same state.
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

## Hand an agent to the phone

A handed-over claude or pi agent shows on the phone page under **Handed over**. There you read its
transcript, send the next prompt, stop a turn, and approve or deny a Claude Code permission prompt.
What you type reaches the session as your own input.

- **From the cockpit:** the phone icon (**Hand to phone**) beside the fullscreen button in the agent's
  header, or `p` with the agent focused. Handing an agent over turns remote mode on if it is off.
  **On phone · Take back** (or `p` again) returns it.
- **From a terminal:** `wsh remote hand [tab]` and `wsh remote take-back [tab]`. The tab is an id or a
  unique prefix. With no tab, `wsh` acts on the agent in the terminal it runs in, so an agent can hand
  itself over.

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

`wsh remote off`, the cockpit's remote switch, or **Turn off remote mode** at the foot of the phone
page. The page then goes offline and the PC may sleep again.
