// Pure result formatting for the verification runner. No CDP/DOM/browser deps, so it is unit-testable
// without a live app. A scenario result is { name, steps: [{ step, ok, skip?, detail? }], error? }.
//
// A step carrying `skip` is one whose precondition this dev profile does not meet — no scan report to cite,
// no pi session focused. It is a third state on purpose: scoring it a pass counts an assertion that never
// ran toward the tally, and scoring it a failure leaves a row that is red on every run, which teaches the
// reader to skim past the table the suite exists to make readable.
import { isAbsolute, relative, resolve, sep } from "node:path";

export function exitCode(scenarioResults) {
    const allPass = scenarioResults.every((s) => !s.error && s.steps.every((st) => st.ok || st.skip));
    return allPass ? 0 : 1;
}

export function formatResults(scenarioResults) {
    const lines = [];
    let pass = 0;
    let skipped = 0;
    let ran = 0;
    for (const s of scenarioResults) {
        lines.push(`\n# ${s.name}`);
        if (s.error) lines.push(`  ERROR: ${s.error}`);
        for (const st of s.steps) {
            if (st.skip) {
                skipped++;
            } else {
                ran++;
                if (st.ok) pass++;
            }
            lines.push(`  ${st.skip ? "SKIP" : st.ok ? "PASS" : "FAIL"}  ${st.step}`);
            if (st.detail) lines.push(`        ${st.detail}`);
        }
    }
    lines.push(`\n${pass}/${ran} steps passed${skipped > 0 ? `, ${skipped} skipped` : ""}`);
    return lines.join("\n");
}

// the paths of shots (attach.mjs's { path }) that sit under root, relative to it with forward slashes. A scenario that
// writes a fixture png elsewhere must not list it as one of its screenshots
export function shotsUnder(shots, root) {
    const files = [];
    for (const s of shots) {
        const rel = relative(resolve(root), resolve(s.path));
        if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) continue;
        files.push(rel.split(sep).join("/"));
    }
    return files;
}

// the shots.json manifest the engine reads from ARC_FINAL_OUT: one entry per scenario, its shots in the order taken
// and its steps in the order asserted. shotsByScenario maps a scenario name to png paths relative to cdp-shots/
export function shotsManifest(results, shotsByScenario) {
    return results.map((s) => {
        const steps = s.steps.map((st) => ({
            step: st.step,
            state: st.skip ? "skip" : st.ok ? "pass" : "fail",
            ...(st.detail ? { detail: st.detail } : {}),
        }));
        if (s.error) steps.push({ step: "the scenario threw", state: "fail", detail: s.error });
        return { name: s.name, files: shotsByScenario[s.name] ?? [], steps };
    });
}

export function contactSheetHtml(shots, root) {
    // src is relative to the html file, which sits in root, so a shot written outside root still resolves
    const cards = shots
        .map((s) => {
            const src = relative(resolve(root), resolve(s.path)).split(sep).join("/");
            return `<figure><figcaption>${s.name}</figcaption><img src="${src}" alt="${s.name}"></figure>`;
        })
        .join("\n");
    return `<!doctype html><meta charset="utf-8"><title>verify contact sheet</title>
<style>body{background:#111;color:#eee;font:13px system-ui;margin:16px}
figure{margin:0 0 24px}figcaption{margin-bottom:6px;color:#9ab}
img{max-width:100%;border:1px solid #333}</style>
${cards}`;
}
