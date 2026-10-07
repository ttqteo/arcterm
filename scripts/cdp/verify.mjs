// One-command verification runner. Attaches to the running dev app over CDP, runs each scenario
// (arrange -> goto -> shot -> assert -> teardown), prints a PASS/FAIL table, writes a contact sheet,
// and exits nonzero on any failure. Usage: node scripts/cdp/verify.mjs [name...]
import { mkdirSync, writeFileSync } from "node:fs";
import { attach } from "./attach.mjs";
import { contactSheetHtml, exitCode, formatResults, shotsManifest, shotsUnder } from "./report.mjs";
import { SCENARIOS } from "./scenarios.mjs";

const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const chosen = only.length ? SCENARIOS.filter((s) => only.includes(s.name)) : SCENARIOS;
if (!chosen.length) {
    console.error(`no scenarios matched ${JSON.stringify(only)}. available: ${SCENARIOS.map((s) => s.name).join(", ")}`);
    process.exit(2);
}

const cdpPort = Number(process.env.CDP_PORT) || 9222; // worktree dev app can run on another port (see task worktree:prepare)
const h = await attach(cdpPort);
console.log(`attached to ${h.url}`);

// a freshly started app answers CDP before its first render, and a cold vite pre-bundles for a while first. Past
// the deadline the scenarios run anyway and fail on the missing nav, which is a real failure of the app.
const RENDER_WAIT_MS = 120_000;
const RENDER_POLL_MS = 500;
const waitStart = Date.now();
let rendered = false;
while (!rendered && Date.now() - waitStart < RENDER_WAIT_MS) {
    // a reload mid-boot destroys the execution context, which is not an answer either way
    rendered = await h.ev(`!!document.querySelector("nav button")`).catch(() => false);
    if (!rendered) await new Promise((r) => setTimeout(r, RENDER_POLL_MS));
}
const waited = Math.round((Date.now() - waitStart) / 1000);
console.log(rendered ? `nav rendered after ${waited}s` : `nav not rendered after ${waited}s`);

// Pin the viewport so a scenario's result does not depend on how wide the developer left the dev window.
// The Jarvis surface is width-responsive (jarvislayout.ts): below ~1290px its context rail closes and
// below ~1034px the Subjects column drops to status dots, so a run in a 1000px window was asserting
// against a different layout than a run in a 1920px one. Scenarios that drive width themselves override
// this and restore it in teardown.
const VERIFY_VIEWPORT = { width: 1600, height: 950, deviceScaleFactor: 1, mobile: false };
await h.cdp("Emulation.setDeviceMetricsOverride", VERIFY_VIEWPORT);

const SHOTS_DIR = "cdp-shots";
const results = [];
// a scenario owns the shots taken from its start to the next one's: the goto shot, then any from assert or teardown
const shotsByScenario = {};
for (const scenario of chosen) {
    const firstShot = h.shots.length;
    let ctx;
    try {
        ctx = await scenario.arrange(h);
        await h.goto(scenario.surface);
        await h.shot(`cdp-shots/${scenario.name}.png`);
        const steps = await scenario.assert(h, ctx);
        results.push({ name: scenario.name, steps });
    } catch (e) {
        results.push({ name: scenario.name, steps: [], error: String(e?.message ?? e) });
    } finally {
        try {
            if (ctx !== undefined) await scenario.teardown?.(h, ctx);
        } catch (e) {
            // a leaked fixture fails the run: the next scenario, or the next run, starts on what this one left
            results.at(-1).steps.push({ step: "teardown", ok: false, detail: String(e?.message ?? e) });
        }
        // a scenario that drove width leaves the override where it put it; restore the pin for the next one
        await h.cdp("Emulation.setDeviceMetricsOverride", VERIFY_VIEWPORT).catch(() => {});
        shotsByScenario[scenario.name] = shotsUnder(h.shots.slice(firstShot), SHOTS_DIR);
    }
}
await h.cdp("Emulation.clearDeviceMetricsOverride").catch(() => {});
h.close();

console.log(formatResults(results));
mkdirSync(SHOTS_DIR, { recursive: true });
writeFileSync(`${SHOTS_DIR}/index.html`, contactSheetHtml(h.shots, SHOTS_DIR));
writeFileSync(`${SHOTS_DIR}/shots.json`, JSON.stringify(shotsManifest(results, shotsByScenario), null, 2));
console.log(`\ncontact sheet: ${SHOTS_DIR}/index.html`);
process.exit(exitCode(results));
