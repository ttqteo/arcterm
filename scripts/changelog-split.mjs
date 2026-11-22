#!/usr/bin/env node
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Splits a long `## Unreleased` section of CHANGELOG.md into even minor releases, by when each line landed, so one
// build does not carry a few hundred lines under a single version. Run it before `task tauri:build BUMP=auto` when the
// section holds twice PER_RELEASE lines or more (AGENTS.md says when):
//
//   node scripts/changelog-split.mjs [--per 60] [--dry-run]
//
// It cuts the lines, oldest first by the commit `git blame HEAD` names for each (a line HEAD does not hold counts as
// newest), into floor(n / per) parts of even size, so each holds at least `per`. Every part but the newest becomes a dated minor release, numbered on
// from package.json's version and dated with its newest line's day; the newest part stays Unreleased for the build's
// own bump. package.json then takes the last version it wrote (package-lock.json, src-tauri/Cargo.toml,
// src-tauri/tauri.conf.json and src-tauri/Cargo.lock with it), so BUMP=auto numbers the build after them. Commit
// those files before the build: it builds a commit, not the checkout.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// the fewest lines a release a split makes holds (MIN_RELEASE_LINES); a section of twice as many or more is split
export const PER_RELEASE = 60;

const SECTIONS = ["Added", "Changed", "Fixed"];

// The Unreleased section's items: each with its section, its place in the file and its lines (the `- ` line and the
// indented ones under it). Null when the top section is not Unreleased.
export function unreleasedItems(text) {
    const lines = text.split("\n");
    const start = lines.findIndex((l) => l.startsWith("## "));
    if (start < 0 || lines[start].trim() !== "## Unreleased") {
        return null;
    }
    let end = lines.findIndex((l, i) => i > start && l.startsWith("## "));
    if (end < 0) {
        end = lines.length;
    }
    const items = [];
    let section = null;
    for (const line of lines.slice(start + 1, end)) {
        if (line.startsWith("### ")) {
            section = line.slice(4).trim();
            if (!SECTIONS.includes(section)) {
                throw new Error(`unknown section in Unreleased: ${section}`);
            }
        } else if (line.startsWith("- ")) {
            items.push({ section, order: items.length, lines: [line] });
        } else if (line.startsWith("  ") && items.length > 0) {
            items[items.length - 1].lines.push(line);
        } else if (line.trim() !== "") {
            throw new Error(`unexpected line in Unreleased: ${line}`);
        }
    }
    return { lines, start, end, items };
}

// The next minor versions after `version`: 1.3.0, 2 -> ["1.4.0", "1.5.0"].
export function nextMinors(version, count) {
    const [major, minor] = version.split(".").map(Number);
    return Array.from({ length: count }, (_, i) => `${major}.${minor + i + 1}.0`);
}

function dayOf(ms) {
    const d = new Date(ms);
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Splits the text's Unreleased section. `when(line)` is the ms its first line landed, or undefined for a line not yet
// committed (newest). Answers the new text and each part's facts, oldest first, or null when there is nothing to split.
export function splitUnreleased(text, when, version, per = PER_RELEASE) {
    const parsed = unreleasedItems(text);
    if (parsed == null || parsed.items.length < 2 * per) {
        return null;
    }
    const { lines, start, end, items } = parsed;
    const parts = Math.floor(items.length / per);
    const timeOf = (it) => when(it.lines[0]) ?? Infinity;
    const byTime = [...items].sort((a, b) => timeOf(a) - timeOf(b) || a.order - b.order);
    const size = items.length / parts;
    const group = new Map(byTime.map((it, k) => [it, Math.min(parts - 1, Math.floor(k / size))]));
    const versions = nextMinors(version, parts - 1);
    const render = (g) => {
        const out = [];
        for (const section of SECTIONS) {
            const mine = items.filter((it) => it.section === section && group.get(it) === g);
            if (mine.length > 0) {
                out.push("", `### ${section}`, "", ...mine.flatMap((it) => it.lines));
            }
        }
        return out;
    };
    const report = [];
    const body = ["## Unreleased", ...render(parts - 1), ""];
    for (let g = parts - 2; g >= 0; g--) {
        const newest = Math.max(...items.filter((it) => group.get(it) === g).map(timeOf));
        body.push(`## ${versions[g]} — ${dayOf(newest)}`, ...render(g), "");
    }
    for (let g = 0; g < parts; g++) {
        const mine = items.filter((it) => group.get(it) === g);
        report.push({
            version: g < parts - 1 ? versions[g] : "Unreleased",
            lines: mine.length,
            added: mine.filter((it) => it.section === "Added").length,
            big: mine.filter((it) => it.lines.some((l) => l.includes("<!-- big -->"))).length,
        });
    }
    return {
        text: [...lines.slice(0, start), ...body, ...lines.slice(end)].join("\n"),
        version: versions[versions.length - 1],
        report,
    };
}

// each line's commit time in HEAD's CHANGELOG.md, ms, the first time a text appears
function blameTimes(root) {
    const out = execFileSync("git", ["blame", "--line-porcelain", "HEAD", "--", "CHANGELOG.md"], {
        cwd: root,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
    });
    const times = new Map();
    let t;
    for (const line of out.split("\n")) {
        if (line.startsWith("committer-time ")) {
            t = Number(line.split(" ")[1]) * 1000;
        } else if (line.startsWith("\t") && !times.has(line.slice(1))) {
            times.set(line.slice(1), t);
        }
    }
    return times;
}

// package.json, package-lock.json's two copies, Cargo.lock's app crate; then the synced sites
function setVersion(root, from, to) {
    const swap = (file, re, max) => {
        const path = `${root}/${file}`;
        let n = 0;
        const text = readFileSync(path, "utf8").replace(re, (m, head) => (n++ < max ? `${head}${to}"` : m));
        if (n === 0) {
            throw new Error(`no ${from} version in ${file}`);
        }
        writeFileSync(path, text);
    };
    const ver = from.replace(/\./g, "\\.");
    swap("package.json", new RegExp(`("version":\\s*")${ver}"`, "g"), 1);
    swap("package-lock.json", new RegExp(`("version":\\s*")${ver}"`, "g"), 2);
    swap("src-tauri/Cargo.lock", new RegExp(`(name = "wave-tauri"\\r?\\nversion = ")${ver}"`, "g"), 1);
    execFileSync(process.execPath, [`${root}/scripts/sync-tauri-version.mjs`], { cwd: root, stdio: "inherit" });
}

function main() {
    const root = fileURLToPath(new URL("..", import.meta.url)).replace(/[\\/]$/, "");
    const args = process.argv.slice(2);
    const perAt = args.indexOf("--per");
    const per = perAt >= 0 ? Number(args[perAt + 1]) : PER_RELEASE;
    const dry = args.includes("--dry-run");
    const path = `${root}/CHANGELOG.md`;
    const text = readFileSync(path, "utf8");
    const version = JSON.parse(readFileSync(`${root}/package.json`, "utf8")).version;
    const times = blameTimes(root);
    const split = splitUnreleased(text, (line) => times.get(line), version, per);
    if (split == null) {
        console.log(`Unreleased holds fewer than ${2 * per} lines: nothing to split`);
        return;
    }
    for (const r of split.report) {
        console.log(`${r.version}: ${r.lines} lines, ${r.added} Added, ${r.big} big`);
    }
    if (dry) {
        console.log(`--dry-run: package.json would go ${version} -> ${split.version}`);
        return;
    }
    writeFileSync(path, split.text);
    setVersion(root, version, split.version);
    console.log(`package.json ${version} -> ${split.version}; commit CHANGELOG.md and the version files, then build`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
    main();
}
