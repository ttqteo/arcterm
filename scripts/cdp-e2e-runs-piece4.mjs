// DEV-only E2E for Channels Runs escalation guidance (Piece 4), over CDP against the running tauri
// dev app, entirely over the websocket wshrpc. Verifies the three acceptance steps:
//   1. Resolved principles reach a phase worker's initial prompt (Run.Principles + BuildPhasePrompt).
//   2. A routine run-worker ask is routed through the classifier and auto-answered (jarvis-answered)
//      on a gatekeeper channel (the default tier; concierge leaves run asks for the human).
//   3. A principle-significant fork escalates (jarvis-escalation, no auto-answer).
//
// Steps 2-3 inject asks via the `ask` RPC against the run worker's BLOCK oref (DeliverAnswer keys on
// the pending ask's block id, so an auto-answer can only be delivered to the live worker block).
// ResolveRunWorker matches by the tab oref recorded on phase.WorkerOrefs (channelOwnerORef walks the
// block up to its tab). The worker is left running through steps 2-3 so a routine answer delivers, and
// posted cards are matched to the injected question text (a live brainstorm worker may ask its own
// questions, which route through the same gatekeeper). Blast radius is contained: worker cwd is an
// isolated temp dir; the worker is killed and the channel deleted at the end.
//
//   node scripts/cdp-e2e-runs-piece4.mjs "<isolated-cwd>"
const port = "9222";
const CWD = process.argv[2];
if (!CWD) {
    console.error("usage: node scripts/cdp-e2e-runs-piece4.mjs <isolated-cwd>");
    process.exit(1);
}
function cdp(wsUrl) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(wsUrl);
        let id = 0;
        const pending = new Map();
        ws.addEventListener("open", () =>
            resolve({
                send: (m, p = {}) => {
                    const i = ++id;
                    ws.send(JSON.stringify({ id: i, method: m, params: p }));
                    return new Promise((r) => pending.set(i, r));
                },
                close: () => ws.close(),
            })
        );
        ws.addEventListener("error", reject);
        ws.addEventListener("message", (e) => {
            const m = JSON.parse(e.data);
            if (m.id && pending.has(m.id)) {
                pending.get(m.id)(m.result);
                pending.delete(m.id);
            }
        });
    });
}
const r = await fetch(`http://localhost:${port}/json/list`);
const list = await r.json();
const pg = list.find((x) => x.type === "page" && /5174|wave/i.test(x.url ?? "")) ?? list.find((x) => x.type === "page");
const c = await cdp(pg.webSocketDebuggerUrl);
await c.send("Runtime.enable");
async function ev(expr) {
    const x = await c.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    if (x.exceptionDetails) return { __err: x.exceptionDetails.exception?.description || x.exceptionDetails.text };
    return x.result?.value;
}

const e2e = `(async () => {
  const CWD = ${JSON.stringify(CWD)};
  const rpc = (command, data) => window.TabRpcClient.wshRpcCall(command, data, {});
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const results = [];

  const wslist = await rpc("workspacelist", null);
  const workspaceId = wslist[0].workspacedata.oid;

  const ch = await rpc("createchannel", { name: "runs-piece4", projectpath: CWD });
  const channelId = ch.oid;

  // a channel's messages are their own rows; the getchannels reply carries none
  async function getMessages() {
    return (await rpc("getchannelmessages", { channelid: channelId })).messages || [];
  }
  async function blockOf(tabOref) {
    const tab = await rpc("gettab", tabOref.slice(4));
    return tab && tab.blockids && tab.blockids[0];
  }
  async function blockMeta(tabOref) {
    try { const bid = await blockOf(tabOref); return bid ? await rpc("getmeta", { oref: "block:" + bid }) : null; }
    catch (e) { return { __metaErr: String(e) }; }
  }

  // STEP 1: principles reach the phase-0 worker prompt
  const created = await rpc("createrun", { channelid: channelId, workspaceid: workspaceId, goal: "add a coupon field to checkout", runtime: "claude" });
  const run = created.run, runId = run.id;
  const w0 = run.phases[0].workerorefs && run.phases[0].workerorefs[0];
  const meta0 = await blockMeta(w0);
  const args0 = meta0 && meta0["cmd:args"];
  const prompt0 = Array.isArray(args0) ? String(args0[0] || "") : String(args0 || "");
  const step1ok = prompt0.startsWith("Work by these principles:") &&
    prompt0.includes("superpowers:brainstorming") && prompt0.includes("add a coupon field to checkout");
  results.push({ step: "1. principles + skill + goal in phase-0 worker prompt", ok: step1ok,
    detail: { runPrinciples: (run.principles || "").slice(0, 80), workeroref: w0, promptHead: prompt0.slice(0, 260) } });

  const bid0 = await blockOf(w0);
  const blockOref = "block:" + bid0;
  const preFilterReason = "needs a human (multiple or multi-select questions)";

  // inject an ask against the live worker block; wait for the jarvis card whose Data echoes this
  // question (jarvis-answered card text does NOT include the question, so match on the Data payload;
  // card.choice present ⇒ auto-answered, absent ⇒ escalation).
  async function askAndWait(question, options, maxMs) {
    const beforeIds = new Set((await getMessages()).map((m) => m.id));
    await rpc("ask", { oref: blockOref, questions: [{ question, options }] });
    const deadline = Date.now() + maxMs;
    while (Date.now() < deadline) {
      await sleep(3000);
      for (const m of await getMessages()) {
        if (beforeIds.has(m.id) || m.author !== "jarvis") continue;
        if (m.kind !== "jarvis-answered" && m.kind !== "jarvis-escalation") continue;
        let card = null; try { card = JSON.parse(m.data || "{}"); } catch (e) { /* skip */ }
        if (card && card.question === question) return { kind: m.kind, choice: card.choice, reason: card.reason };
      }
    }
    return null;
  }

  // STEP 2: routine run-worker ask -> routed THROUGH classifier; a classifier-generated
  // reason (not the pre-filter string) proves it reached Classify. A routine answer auto-delivers and
  // posts jarvis-answered (card.choice set); a cautious escalation also proves routing.
  const c2 = await askAndWait(
    "Which code style should the new coupon-field source file follow?",
    [
      { label: "Match the project's existing prettier config", description: "the conventional choice in this repo" },
      { label: "Use editor defaults", description: "ignore the repo config" },
    ], 160000);
  results.push({ step: "2. routine run-worker ask routed THROUGH classifier",
    ok: !!c2 && c2.reason !== preFilterReason, detail: c2 || "no jarvis card within timeout" });

  // STEP 3: principle-significant fork (DRY vs KISS across existing code) -> escalation. Both options
  // carry a real, opposing principle cost (a 4th duplicate vs a larger refactor), with no obviously
  // minimal/safe default, so the classifier should defer to the human rather than pick unilaterally.
  const c3 = await askAndWait(
    "Coupon validation is duplicated inline at 3 existing checkout call sites and now fails on null. How do we fix it?",
    [
      { label: "Add a 4th inline null check at the failing call site", description: "smallest change; adds a 4th copy of the validation" },
      { label: "Extract all 4 into one shared validator and fix it there", description: "removes the duplication; a larger cross-site refactor" },
    ], 160000);
  results.push({ step: "3. principle-significant fork escalates (no auto-answer)",
    ok: !!c3 && c3.kind === "jarvis-escalation", detail: c3 || "no jarvis card within timeout" });

  let cleanup = {};
  try { const bid = await blockOf(w0); if (bid) await rpc("deleteblock", { blockid: bid }); cleanup.kill = "ok"; } catch (e) { cleanup.kill = String(e); }
  try { await rpc("cancelrun", { channelid: channelId, runid: runId }); cleanup.cancel = "ok"; } catch (e) { cleanup.cancel = String(e); }
  try { await rpc("deletechannel", { channelid: channelId }); cleanup.delete = "ok"; } catch (e) { cleanup.delete = String(e); }

  return { workspaceId, channelId, runId, worker: w0, cleanup, results };
})()`;

const out = await ev(e2e);
c.close();
if (out && out.__err) {
    console.error("E2E THREW:", out.__err);
    process.exit(1);
}
console.log(`workspace=${out.workspaceId}  channel=${out.channelId}  run=${out.runId}`);
console.log(`worker=${out.worker}`);
console.log(`cleanup: ${JSON.stringify(out.cleanup)}\n`);
let pass = 0;
for (const rr of out.results) {
    console.log(`${rr.ok ? "PASS" : "FAIL"}  ${rr.step}\n        ${JSON.stringify(rr.detail)}`);
    if (rr.ok) pass++;
}
console.log(`\n${pass}/${out.results.length} steps passed`);
process.exit(pass === out.results.length ? 0 : 2);
