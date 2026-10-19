// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    appUrlFor,
    entriesToRead,
    folderName,
    formFromServer,
    guessPort,
    isServerScript,
    packageManager,
    plainCommand,
    runLine,
    runLineIn,
    scriptEntry,
    suggestScripts,
} from "./appsuggest";

// a dashboard repo's scripts: one server, among jobs that only print and exit
const DASH_PKG = JSON.stringify({
    scripts: {
        eval: "node scripts/eval-daily.mjs",
        "screen:bash": "bash screen.sh",
        dash: "node live/server.mjs",
        gold: "node scripts/fetch-gold-price.mjs",
        tunnel: "pm2 start ecosystem.config.cjs && pm2 logs ngrok",
    },
});
const DASH_SERVER = `import express from "express";
const app = express();
const PORT = Number(process.env.PORT) || 8386;
app.listen(PORT, () => console.log("Live dashboard"));`;
const GOLD_JOB = `const r = await fetch("https://example.com/gold"); console.log(await r.text());`;

describe("which script serves", () => {
    it("finds the file a script runs", () => {
        expect(scriptEntry("node live/server.mjs")).toBe("live/server.mjs");
        expect(scriptEntry("NODE_ENV=dev node --watch ./src/index.ts")).toBe("src/index.ts");
        expect(scriptEntry("tsx watch src/app.ts")).toBe("src/app.ts");
        expect(scriptEntry("tsx src/app.ts")).toBe("src/app.ts");
        expect(scriptEntry("vite --port 5000")).toBeNull();
    });

    it("is a server when its file listens, whatever its name", () => {
        expect(isServerScript("dash", "node live/server.mjs", DASH_SERVER)).toBe(true);
        expect(isServerScript("gold", "node scripts/fetch-gold-price.mjs", GOLD_JOB)).toBe(false);
        // a name that says server does not outweigh a file that does not listen
        expect(isServerScript("start", "node scripts/once.mjs", GOLD_JOB)).toBe(false);
    });

    it("is a server by its tool, or by its name when it runs no file", () => {
        expect(isServerScript("web", "vite", null)).toBe(true);
        expect(isServerScript("x", "next dev -p 4000", null)).toBe(true);
        expect(isServerScript("dev", 'concurrently "a" "b"', null)).toBe(true);
        expect(isServerScript("build", "vite build", null)).toBe(false);
        expect(isServerScript("test", "vitest", null)).toBe(false);
        expect(isServerScript("tunnel", "pm2 start x && pm2 logs", null)).toBe(false);
        expect(isServerScript("lint", "eslint .", null)).toBe(false);
    });
});

describe("guessPort", () => {
    it("reads the port the server's file falls back to", () => {
        expect(guessPort("node live/server.mjs", { entrySource: DASH_SERVER })).toEqual({ port: 8386, sure: true });
        expect(guessPort("node s.js", { entrySource: "server.listen(4100);" })).toEqual({ port: 4100, sure: true });
        expect(guessPort("node s.js", { entrySource: "const port = 9000;\napp.listen(port)" })).toEqual({
            port: 9000,
            sure: true,
        });
    });

    it("prefers the script's own flag, then .env, over the file", () => {
        expect(guessPort("vite --port 5000", { entrySource: DASH_SERVER })).toEqual({ port: 5000, sure: true });
        expect(guessPort("PORT=7000 node s.mjs", { entrySource: DASH_SERVER })).toEqual({ port: 7000, sure: true });
        expect(guessPort("node s.mjs", { entrySource: DASH_SERVER, env: "API=x\nPORT=7100\n" })).toEqual({
            port: 7100,
            sure: true,
        });
    });

    it("reads vite.config, else guesses the tool's default", () => {
        expect(guessPort("vite", { viteConfig: "export default { server: { port: 5300 } }" })).toEqual({
            port: 5300,
            sure: true,
        });
        expect(guessPort("vite")).toEqual({ port: 5173, sure: false });
        expect(guessPort("next dev")).toEqual({ port: 3000, sure: false });
        expect(guessPort("node s.mjs", { entrySource: "listen(process.env.PORT)" })).toBeNull();
    });
});

describe("suggestScripts", () => {
    it("puts the dashboard first, with its run line and port, and the jobs after", () => {
        const out = suggestScripts({
            packageJson: DASH_PKG,
            lockfiles: [],
            entries: {
                "scripts/eval-daily.mjs": GOLD_JOB,
                "live/server.mjs": DASH_SERVER,
                "scripts/fetch-gold-price.mjs": GOLD_JOB,
            },
        });
        expect(out[0]).toEqual({
            script: "dash",
            body: "node live/server.mjs",
            command: "npm run dash",
            server: true,
            port: { port: 8386, sure: true },
        });
        expect(out.slice(1).map((s) => s.script)).toEqual(["eval", "screen:bash", "gold", "tunnel"]);
        expect(out.slice(1).every((s) => !s.server && s.port == null)).toBe(true);
    });

    it("runs scripts with the folder's package manager", () => {
        expect(packageManager(["pnpm-lock.yaml"])).toBe("pnpm");
        expect(packageManager([])).toBe("npm");
        expect(runLine("pnpm", "dev")).toBe("pnpm run dev");
        expect(runLine("yarn", "dev")).toBe("yarn dev");
        expect(
            suggestScripts({ packageJson: '{"scripts":{"dev":"vite"}}', lockfiles: ["bun.lock"], entries: {} })[0]
                .command
        ).toBe("bun run dev");
    });

    it("suggests nothing without a readable package.json", () => {
        expect(suggestScripts({ packageJson: null, lockfiles: [], entries: {} })).toEqual([]);
        expect(suggestScripts({ packageJson: "{oops", lockfiles: [], entries: {} })).toEqual([]);
        expect(suggestScripts({ packageJson: "{}", lockfiles: [], entries: {} })).toEqual([]);
    });

    it("asks to read only the files the scripts run, inside the folder", () => {
        expect(entriesToRead(DASH_PKG)).toEqual([
            "scripts/eval-daily.mjs",
            "live/server.mjs",
            "scripts/fetch-gold-price.mjs",
        ]);
        expect(entriesToRead('{"scripts":{"a":"node ../up.mjs"}}')).toEqual([]);
        expect(entriesToRead(null)).toEqual([]);
    });
});

describe("names and urls", () => {
    it("names the app after its folder", () => {
        expect(folderName("~/Workspaces/dev/portfolio-journal/")).toBe("portfolio-journal");
        expect(folderName("D:\\code\\hong")).toBe("hong");
        expect(folderName("~")).toBe("");
        expect(appUrlFor(8386)).toBe("http://127.0.0.1:8386");
    });
});

describe("pinning a running server", () => {
    const scripts = suggestScripts({
        packageJson: DASH_PKG,
        lockfiles: [],
        entries: { "live/server.mjs": DASH_SERVER },
    });

    it("reads a process's command line as a script would write it", () => {
        expect(plainCommand("C:\\nvm4w\\nodejs\\node.exe live/server.mjs")).toBe("node live/server.mjs");
        expect(plainCommand('"C:\\Program Files\\nodejs\\node.exe"  live/server.mjs')).toBe("node live/server.mjs");
        expect(plainCommand("/opt/homebrew/bin/node live/server.mjs")).toBe("node live/server.mjs");
        expect(plainCommand("vite")).toBe("vite");
    });

    it("finds the run line inside a launcher", () => {
        expect(runLineIn('bash -c "cd /x && pnpm dev 2>&1"')).toBe("pnpm dev");
        expect(runLineIn("npm.cmd run dash")).toBe("npm run dash");
        expect(runLineIn("npm install")).toBeNull();
        expect(runLineIn(undefined)).toBeNull();
    });

    it("starts it again with the folder's script that runs the same thing", () => {
        expect(
            formFromServer(
                { ports: [8386], cmdline: "C:\\nvm4w\\nodejs\\node.exe live/server.mjs", cwd: "/Users/q/dev/hong" },
                scripts
            )
        ).toEqual({ name: "hong", command: "npm run dash", url: "http://127.0.0.1:8386", dir: "/Users/q/dev/hong" });
    });

    it("falls back to the launcher's run line, then the script on its port, then its own command", () => {
        const seen = { ports: [5173], cmdline: "node /x/node_modules/vite/bin/vite.js", cwd: "/w/site" };
        expect(formFromServer({ ...seen, launchercmdline: "pnpm dev" }, []).command).toBe("pnpm dev");
        expect(formFromServer({ ...seen, ports: [8386] }, scripts).command).toBe("npm run dash");
        expect(formFromServer(seen, []).command).toBe("node /x/node_modules/vite/bin/vite.js");
        expect(formFromServer({ ...seen, cwd: "C:\\w\\site\\" }, []).dir).toBe("C:\\w\\site");
    });
});
