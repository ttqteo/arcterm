// A What's new picture for a big CHANGELOG line, from the dev app as it is on screen now:
//
//   node scripts/whatsnew-shot.mjs <topic> [--selector <css>] [--pad <px>] [--version <x.y.z>] [--port <cdp port>]
//
// It writes public/whatsnew/<next minor>-<topic>.webp, 2:1 and under 120 KB, centred on --selector (the whole window
// without it), and prints the `<!-- shot: … -->` comment to end the line with. The port defaults to CDP_PORT or 9222.
// Inside a scenario, call the handle's whatsnewShot(topic, opts) instead (scripts/cdp/whatsnewshot.mjs).
import { fileURLToPath } from "node:url";
import { attach } from "./cdp/attach.mjs";
import { captureWhatsnewShot } from "./cdp/whatsnewshot.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url)).replace(/[\\/]$/, "");

function parseArgs(argv) {
    const opts = { port: Number(process.env.CDP_PORT) || 9222 };
    const rest = [];
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--selector") opts.selector = argv[++i];
        else if (a === "--pad") opts.pad = Number(argv[++i]);
        else if (a === "--version") opts.version = argv[++i];
        else if (a === "--port") opts.port = Number(argv[++i]);
        else rest.push(a);
    }
    return { topic: rest.join(" "), opts };
}

const { topic, opts } = parseArgs(process.argv.slice(2));
if (topic === "") {
    console.error("usage: node scripts/whatsnew-shot.mjs <topic> [--selector <css>] [--pad <px>] [--version <x.y.z>] [--port <n>]");
    process.exit(2);
}
const h = await attach(opts.port);
try {
    const shot = await captureWhatsnewShot(h, topic, { ...opts, root: ROOT });
    console.log(`wrote public/whatsnew/${shot.file} (${Math.round(shot.bytes / 1024)} KB, ${shot.clip.width}x${shot.clip.height} CSS px)`);
    console.log(`end the big CHANGELOG line with: ${shot.comment}`);
} catch (e) {
    console.error(e?.message ?? String(e));
    process.exitCode = 1;
} finally {
    h.close();
}
