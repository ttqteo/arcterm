// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { setPlatform } from "@/util/platformutil";
import { beforeEach, describe, expect, it } from "vitest";
import {
    adoptCount,
    adoptKeep,
    copyDelta,
    manageLabel,
    skillFilePath,
    skillGroups,
    skillRows,
    skillsSummary,
    type SkillKeep,
} from "./skillsmatrix";

const COLUMNS: AgentSyncSkillColumn[] = [
    { runtime: "claude", label: "Claude Code", present: true },
    { runtime: "codex", label: "Codex", present: true },
    { runtime: "opencode", label: "OpenCode", present: true },
    { runtime: "pi", label: "Pi", present: false },
];

function move(runtime: string, name: string, over: Partial<AgentSyncSkillMove> = {}): AgentSyncSkillMove {
    return { runtime, name, from: `C:\\h\\${runtime}\\skills\\${name}`, seed: false, bodydiff: false, ...over };
}

function data(over: Partial<CommandAgentSyncSkillsRtnData> = {}): CommandAgentSyncSkillsRtnData {
    return { skills: [], columns: COLUMNS, skillsroot: "C:\\vault\\skills", unmanaged: [], unresolved: [], ...over };
}

// one skill of each kind: translate (body differs), lint (key delta), commit + wrangler (same in two),
// graphify (only in claude), review-spec (only in codex), vaulted (managed)
function sample(): CommandAgentSyncSkillsRtnData {
    return data({
        skills: [
            {
                name: "vaulted",
                description: "A canonical skill.",
                states: { claude: "synced", codex: "differs", opencode: "unmanaged", pi: "absent" },
            },
        ],
        unmanaged: [
            move("claude", "commit", { seed: true }),
            move("claude", "graphify", { seed: true }),
            move("claude", "lint", { seed: true }),
            move("claude", "translate", { seed: true }),
            move("claude", "vaulted"),
            move("claude", "wrangler", { seed: true }),
            move("codex", "commit"),
            move("codex", "lint", { keys: ["description"] }),
            move("codex", "review-spec", { seed: true }),
            move("codex", "translate", { bodydiff: true }),
            move("codex", "wrangler"),
        ],
        unresolved: ["translate"],
    });
}

function groupsOf(d: CommandAgentSyncSkillsRtnData, keep: SkillKeep = {}) {
    return skillGroups(d, keep).map((g) => ({ title: g.title, names: g.rows.map((r) => r.name) }));
}

describe("skillGroups", () => {
    it("puts every skill in one group, in the spec's order, each with its members", () => {
        expect(groupsOf(sample())).toEqual([
            { title: "Needs a decision", names: ["translate"] },
            { title: "Differs between harnesses", names: ["lint"] },
            { title: "Same copy in 2 harnesses", names: ["commit", "wrangler"] },
            { title: "Only in Claude Code", names: ["graphify"] },
            { title: "Only in Codex", names: ["review-spec"] },
            { title: "Managed by arcterm", names: ["vaulted"] },
        ]);
    });

    it("sends a skill found in one harness to Only in <label>", () => {
        const groups = groupsOf(data({ unmanaged: [move("opencode", "solo", { seed: true })] }));
        expect(groups).toEqual([{ title: "Only in OpenCode", names: ["solo"] }]);
    });

    it("keeps an unresolved skill in Needs a decision until it has a keep", () => {
        expect(groupsOf(sample())[0]).toEqual({ title: "Needs a decision", names: ["translate"] });
        const kept = groupsOf(sample(), { translate: "codex" });
        expect(kept.find((g) => g.title === "Needs a decision")).toBeUndefined();
        expect(kept.find((g) => g.title === "Differs between harnesses")?.names).toEqual(["lint", "translate"]);
    });

    it("ignores a keep that names a runtime holding no copy", () => {
        expect(groupsOf(sample(), { translate: "opencode" })[0]).toEqual({
            title: "Needs a decision",
            names: ["translate"],
        });
    });

    it("splits identical copies by how many harnesses hold them, widest first", () => {
        const groups = groupsOf(
            data({
                unmanaged: [
                    move("claude", "a", { seed: true }),
                    move("claude", "b", { seed: true }),
                    move("codex", "a"),
                    move("codex", "b"),
                    move("opencode", "b"),
                ],
            })
        );
        expect(groups).toEqual([
            { title: "Same copy in 3 harnesses", names: ["b"] },
            { title: "Same copy in 2 harnesses", names: ["a"] },
        ]);
    });

    it("shows a vault skill's stray copy as its cell, not as a second row", () => {
        const names = skillGroups(sample(), {}).flatMap((g) => g.rows.map((r) => r.name));
        expect(names.filter((n) => n === "vaulted")).toHaveLength(1);
    });
});

describe("skillRows cells", () => {
    function cells(name: string, keep: SkillKeep = {}) {
        return skillRows(sample(), keep)
            .find((r) => r.name === name)!
            .cells.map((c) => c.label);
    }

    it("maps managed states, and a column that is not set up reads as nothing", () => {
        expect(cells("vaulted")).toEqual(["Synced", "Not synced", "Own copy", "—"]);
    });

    it("shows what each unmanaged copy carries", () => {
        expect(cells("translate")).toEqual(["Differs", "Body differs", "—", "—"]);
        expect(cells("lint")).toEqual(["Differs", "description", "—", "—"]);
        expect(cells("commit")).toEqual(["Own copy", "Own copy", "—", "—"]);
        expect(cells("graphify")).toEqual(["Only here", "—", "—", "—"]);
    });

    it("shows which copy a keep chooses and which it replaces", () => {
        expect(cells("translate", { translate: "codex" })).toEqual(["Replaced", "Kept", "—", "—"]);
    });
});

describe("adopt", () => {
    it("excludes an unresolved skill without a keep from the count and the keep map", () => {
        // commit, graphify, lint, review-spec, wrangler, plus vaulted's stray copy
        expect(adoptCount(sample(), {})).toBe(6);
        expect(adoptKeep(sample(), {})).toEqual({});
    });

    it("counts an unresolved skill once it has a keep, and sends that keep", () => {
        expect(adoptCount(sample(), { translate: "claude" })).toBe(7);
        expect(adoptKeep(sample(), { translate: "claude" })).toEqual({ translate: "claude" });
    });

    it("sends no keep for a resolved skill, a missing copy, or a managed skill", () => {
        const d = { ...sample(), unresolved: ["translate", "vaulted"] };
        expect(adoptKeep(d, { lint: "codex", translate: "pi", vaulted: "claude" })).toEqual({});
        expect(adoptCount(d, { vaulted: "claude" })).toBe(5);
    });

    it("labels the button", () => {
        expect(manageLabel(18)).toBe("Manage 18 skills in arcterm");
        expect(manageLabel(1)).toBe("Manage 1 skill in arcterm");
    });
});

describe("skillsSummary", () => {
    it("counts every skill once and the ones arcterm manages", () => {
        expect(skillsSummary(sample())).toBe("7 skills · 1 managed by arcterm");
    });

    it("says none when the vault holds no skill", () => {
        expect(skillsSummary(data({ unmanaged: [move("claude", "x", { seed: true })] }))).toBe(
            "1 skill · none managed by arcterm"
        );
    });
});

describe("skillFilePath", () => {
    const rows = () => skillRows(sample(), {});
    beforeEach(() => setPlatform("win32"));

    it("opens the vault copy of a managed skill", () => {
        const r = rows().find((x) => x.name === "vaulted")!;
        expect(skillFilePath(r, "C:\\vault\\skills", {})).toBe("C:\\vault\\skills\\vaulted\\SKILL.md");
    });

    it("opens the kept copy, else the base copy", () => {
        const r = rows().find((x) => x.name === "translate")!;
        expect(skillFilePath(r, "", {})).toBe("C:\\h\\claude\\skills\\translate\\SKILL.md");
        expect(skillFilePath(r, "", { translate: "codex" })).toBe("C:\\h\\codex\\skills\\translate\\SKILL.md");
    });
});

describe("copyDelta", () => {
    it("names the base copy, the overrides, or a body difference", () => {
        const copies = skillRows(sample(), {}).find((x) => x.name === "lint")!.copies;
        expect(copies.map(copyDelta)).toEqual(["Base copy", "Overrides description"]);
        const t = skillRows(sample(), {}).find((x) => x.name === "translate")!.copies;
        expect(copyDelta(t[1])).toBe("Body text differs");
    });
});
