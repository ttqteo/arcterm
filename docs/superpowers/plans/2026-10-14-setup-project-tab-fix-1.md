# Setup → Project tab, fix round 1: the fixture-run harness survives a slow boot

**Goal:** Final's `setup-project` scenario never ran. The said-once notice steps in `surface-smoke` (on main since
db64e15b0) failed in `arrangeFixtureRun`: `createrun` came back "loading channel: context deadline exceeded", because
the handler probes the lead's harness before it loads the channel and the default 5 s RPC deadline ran out on a cold
boot. `teardownFixtureRun` then reloaded the page and waited a fixed 2.5 s. The first boot had taken 35 s to render, so
`setup-project` found no nav and stopped. This round makes both helpers wait for a slow app, so Final can reach
`setup-project`.

**Spec:** `docs/superpowers/specs/2026-10-14-setup-project-tab-design.md`

Conventions: commit only `scripts/cdp/scenarios.mjs`, with a pathspec (`git commit -m "..." -- scripts/cdp/scenarios.mjs`);
no `Co-Authored-By` trailer; never `git push`. Never run prettier on `scripts/*.mjs` (4-space, hand-formatted).

---

### Task 1: `arrangeFixtureRun` and `teardownFixtureRun` wait for a slow app

**Depends on:** none

**Files:** `scripts/cdp/scenarios.mjs`

Both helpers sit near line 13520.

**Step 1: give `arrangeFixtureRun`'s `createrun` a 30 s deadline**

In `arrangeFixtureRun`, pass a third argument to the `createrun` call, as the `listharnesses` call already does
(`h.rpc("listharnesses", null, { timeout: 30000 })`), with a comment saying why:

```js
    // createrun probes the lead's harness before it loads the channel; on a cold Final boot that outlasted the
    // 5s default and the channel load failed with "context deadline exceeded"
    const created = await h.rpc(
        "createrun",
        {
            channelid: ctx.channelId,
            workspaceid: wslist[0].workspacedata.oid,
            goal: `verify ${label}: do nothing`,
            runtime: "claude",
            mode: "orchestrator",
            deferstart: true,
            ...runExtra,
        },
        { timeout: 30000 }
    );
```

Change only this one call. The other `createrun` calls in the file stay as they are.

**Step 2: after `teardownFixtureRun`'s reload, wait for the nav**

Replace the fixed sleep in the "reload onto the live roster" step:

```js
    await step("reload onto the live roster", async () => {
        await h.ev("location.reload()");
        await new Promise((r) => setTimeout(r, 2500));
    });
```

with a wait for the nav (up to 30 s; a cold Final boot took 35 s to render, and a reload reuses Vite's transforms), so
the next scenario never starts on a page that is still booting:

```js
    await step("reload onto the live roster", async () => {
        await h.ev("location.reload()");
        // a fixed wait left the next scenario on a page still booting: a cold Final boot took 35s to render
        await new Promise((r) => setTimeout(r, 500));
        if (!(await polishWaitFor(h, `!!document.querySelector("nav button")`, 30000))) {
            throw new Error("the app did not come back within 30s of the reload");
        }
    });
```

The first 500 ms keep `polishWaitFor` from reading the old page before the reload takes it down. `polishWaitFor` is
a function declaration further down the file, so it is hoisted, and it treats a throw from `h.ev` (the page reloading)
as false.

**Step 3: check**

Run: `node --check scripts/cdp/scenarios.mjs`
Expected: no output, exit 0.

Do not start a dev app or run the scenarios: Final runs `setup-project` and `surface-smoke` on the merged result.

**Step 4: commit**

```bash
git commit -m "test(cdp): fixture runs wait for a slow app: createrun gets 30s, teardown waits for the nav after its reload" -- scripts/cdp/scenarios.mjs
```
