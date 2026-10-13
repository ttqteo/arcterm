import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const SCRIPT = fileURLToPath(new URL("./cdp-shot.mjs", import.meta.url));

// A raw stack dump / unhandled rejection is exactly the failure this hardening prevents. Any of
// these tokens in stderr means the script leaked an internal error instead of an actionable line.
const STACK_NOISE = /TypeError|undici|processTicksAndRejections|UnhandledPromiseRejection|\n\s+at\s/;

// Spawn the real CLI so we assert the user-visible contract: exit code + stderr, and that it exits
// on its own (execFile timeout catches a hang). It never reaches the screenshot, so no PNG is written.
async function runShot(port) {
    try {
        const { stdout, stderr } = await execFileAsync(process.execPath, [SCRIPT, "cdp-shots/smoke-test.png", port], {
            timeout: 15_000,
        });
        return { code: 0, stdout, stderr, killed: false };
    } catch (e) {
        return { code: e.code ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "", killed: Boolean(e.killed) };
    }
}

function listen(handler) {
    return new Promise((resolve) => {
        const server = createServer(handler);
        server.listen(0, "127.0.0.1", () => resolve({ server, port: String(server.address().port) }));
    });
}

describe("cdp-shot.mjs failure handling", () => {
    it("exits nonzero with an actionable message when the port is closed (dev app not running)", async () => {
        // bind then release a port so it is deterministically closed for the run.
        const { server, port } = await listen((_req, res) => res.end("[]"));
        await new Promise((r) => server.close(r));

        const r = await runShot(port);
        expect(r.killed).toBe(false); // exited on its own — did not hang into the execFile timeout
        expect(r.code).not.toBe(0);
        expect(r.stderr).toMatch(/dev app running with the debug flag/i);
        expect(r.stderr).not.toMatch(STACK_NOISE);
    });

    it("exits nonzero with an actionable message when no page target is present", async () => {
        const { server, port } = await listen((req, res) => {
            res.setHeader("content-type", "application/json");
            res.end(req.url === "/json/list" ? "[]" : "");
        });
        try {
            const r = await runShot(port);
            expect(r.killed).toBe(false);
            expect(r.code).not.toBe(0);
            expect(r.stderr).toMatch(/no page target/i);
            expect(r.stderr).not.toMatch(STACK_NOISE);
        } finally {
            await new Promise((r) => server.close(r));
        }
    });
});
