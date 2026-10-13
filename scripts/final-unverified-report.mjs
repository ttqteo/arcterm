// Lists the most recent orchestrator dags with their final-stage outcome, every unverified reason, and
// (with --plan-review) the plan reviewer's findings, to see why finals end "unverified".
// Usage: node scripts/final-unverified-report.mjs [--db <waveterm.db>] [--last N] [--plan-review]
// Defaults to the packaged app's store; pass --db for the dev app's (dev.arc.app-dev).
import { DatabaseSync } from "node:sqlite";
import path from "node:path";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : fallback;
};
const dbPath = opt("--db", path.join(process.env.LOCALAPPDATA ?? "", "dev.arc.app", "data", "db", "waveterm.db"));
const last = Number(opt("--last", "25"));
const withPlanReview = args.includes("--plan-review");

const flat = (s) => (s ?? "").replace(/\s+/g, " ");
// the data column comes back as a blob
const decode = (v) => (typeof v === "string" ? v : new TextDecoder().decode(v));

const db = new DatabaseSync(dbPath, { readOnly: true });
const dags = db
    .prepare("select data from db_dag")
    .all()
    .map((r) => JSON.parse(decode(r.data)))
    .sort((a, b) => b.createdts - a.createdts)
    .slice(0, last);

const counts = {};
for (const d of dags) {
    const f = d.final ?? {};
    const state = f.state ?? "-";
    counts[state] = (counts[state] ?? 0) + 1;
    const when = new Date(d.createdts).toISOString().slice(5, 16);
    console.log(`\n${when} ${d.oid.slice(0, 8)} ${state} r${f.round ?? "-"} | ${(d.title ?? "").slice(0, 50)} | finalcmd=${!!d.finalcmd}`);
    for (const u of f.unverified ?? []) console.log(`   - ${flat(u)}`);
    if (state === "failed") console.log(`   FAILED: ${flat(f.detail).slice(0, 200)}`);
    if (withPlanReview && d.planreview) {
        console.log(`   plan review: ${d.planreview.state} r${d.planreview.round}: ${flat(d.planreview.findings).slice(0, 400)}`);
    }
}
console.log("\n" + JSON.stringify(counts));
