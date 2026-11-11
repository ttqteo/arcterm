// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { setPlatform } from "@/util/platformutil";
import { beforeEach, describe, expect, it } from "vitest";
import {
    additionsChip,
    adoptCount,
    adoptKeep,
    adoptResultText,
    adoptSkip,
    copyDelta,
    KEEP_LEAVE,
    KEEP_VAULT,
    manageLabel,
    piSkillsLine,
    skillCopyTargets,
    skillFilePath,
    skillFileSource,
    skillGroups,
    skillLinkTarget,
    skillNameError,
    skillNote,
    skillPreview,
    skillRows,
    skillsSummary,
    type SkillKeep,
} from "./skillsmatrix";

const COLUMNS: AgentSyncSkillColumn[] = [
    { runtime: "claude", label: "Claude Code", present: true, path: "/h/.claude/skills" },
    { runtime: "codex", label: "Codex", present: true, path: "/h/.codex/skills" },
    { runtime: "opencode", label: "OpenCode", present: true, path: "/h/.config/opencode/skills" },
    { runtime: "pi", label: "Pi", present: false, path: "" },
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
            { title: "Your skills", names: ["vaulted"] },
        ]);
    });

    it("splits the vault's skills: the user's own first, then the read-only ones arcterm ships", () => {
        const groups = groupsOf(
            data({
                skills: [
                    { name: "notes", states: {}, shipped: true },
                    { name: "trade-check", states: {} },
                    { name: "cockpit-ui", states: {}, shipped: true },
                    { name: "review-plan", states: {} },
                ],
            })
        );
        expect(groups).toEqual([
            { title: "Your skills", names: ["review-plan", "trade-check"] },
            { title: "Ships with arcterm", names: ["cockpit-ui", "notes"] },
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
        expect(cells("vaulted")).toEqual(["Up to date", "Out of date", "Own copy", "—"]);
    });

    it("names the local copy a managed cell describes, so nothing reads as an upload", () => {
        setPlatform("darwin");
        const titles = skillRows(sample(), {})
            .find((r) => r.name === "vaulted")!
            .cells.map((c) => c.title);
        expect(titles[0]).toBe("/h/.claude/skills/vaulted matches the vault");
        expect(titles[1]).toBe(
            "/h/.codex/skills/vaulted is older than the vault; saving or the next agent launch updates it"
        );
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

describe("skill additions", () => {
    const learned: LearnAddition[] = [
        { key: "no-emoji", text: "No emoji.", learned: "2026-10-12", count: 2 },
        { key: "short", text: "Keep it short.", learned: "2026-10-13", count: 3 },
    ];

    function withAdditions(): CommandAgentSyncSkillsRtnData {
        const d = sample();
        d.skills = [{ ...d.skills![0], additions: learned }];
        return d;
    }

    it("carries a managed skill's additions onto its row, and none for the rest", () => {
        const rows = skillRows(withAdditions(), {});
        expect(rows.find((r) => r.name === "vaulted")!.additions).toEqual(learned);
        expect(rows.find((r) => r.name === "lint")!.additions).toEqual([]);
    });

    it("defaults a managed skill with no additions to none", () => {
        expect(skillRows(sample(), {}).find((r) => r.name === "vaulted")!.additions).toEqual([]);
    });

    it("chips the count of additions, and nothing for none", () => {
        const rows = skillRows(withAdditions(), {});
        expect(additionsChip(rows.find((r) => r.name === "vaulted")!)).toBe("+2");
        expect(additionsChip(rows.find((r) => r.name === "lint")!)).toBeNull();
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

describe("skillFileSource", () => {
    it("names the copy the preview reads only when there is a choice", () => {
        const rows = skillRows(sample(), {});
        const translate = rows.find((x) => x.name === "translate")!;
        expect(skillFileSource(translate, {})).toBe("Claude Code");
        expect(skillFileSource(translate, { translate: "codex" })).toBe("Codex");
        expect(skillFileSource(rows.find((x) => x.name === "graphify")!, {})).toBeNull();
        expect(skillFileSource(rows.find((x) => x.name === "vaulted")!, {})).toBeNull();
    });
});

describe("skillPreview", () => {
    const text = "---\nname: lint\ndescription: Lints the repo.\nallowed-tools: Bash\n---\n# Lint\n";

    it("takes an unmanaged skill's description from its file and leaves the rest for the card", () => {
        const lint = skillRows(sample(), {}).find((x) => x.name === "lint")!;
        expect(skillPreview(lint, text)).toEqual({
            description: "Lints the repo.",
            fields: [["allowed-tools", "Bash"]],
            body: "# Lint\n",
        });
    });

    it("keeps the vault's description for a managed skill", () => {
        const vaulted = skillRows(sample(), {}).find((x) => x.name === "vaulted")!;
        expect(skillPreview(vaulted, text).description).toBe("A canonical skill.");
    });

    it("reads a file with no frontmatter as all body", () => {
        const lint = skillRows(sample(), {}).find((x) => x.name === "lint")!;
        expect(skillPreview(lint, "# Lint\n")).toEqual({ description: "", fields: [], body: "# Lint\n" });
    });
});

describe("skillLinkTarget", () => {
    beforeEach(() => setPlatform("win32"));
    const file = "C:\\vault\\skills\\lint\\SKILL.md";

    it("opens a relative link in the skill's folder", () => {
        expect(skillLinkTarget(file, "references/rules.md#L4")).toEqual({
            path: "C:\\vault\\skills\\lint\\references\\rules.md",
            line: 4,
        });
    });

    it("leaves web links, anchors and links out of the folder alone", () => {
        expect(skillLinkTarget(file, "https://example.com")).toBeNull();
        expect(skillLinkTarget(file, "#usage")).toBeNull();
        expect(skillLinkTarget(file, "../other/SKILL.md")).toBeNull();
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

describe("managed skills: shipped and copy targets", () => {
    beforeEach(() => setPlatform("darwin"));
    const shipped = () =>
        data({
            skills: [
                { name: "notes", states: { claude: "synced" }, shipped: true },
                { name: "mine", states: { claude: "synced" } },
            ],
        });

    it("marks a shipped skill and says it is read-only", () => {
        const rows = skillRows(shipped(), {});
        const notes = rows.find((r) => r.name === "notes")!;
        const mine = rows.find((r) => r.name === "mine")!;
        expect([notes.shipped, mine.shipped]).toEqual([true, false]);
        expect(skillNote(notes)).toContain("read-only");
        expect(skillNote(mine)).toContain("on this machine");
    });

    it("lists the folder each set-up harness holds the copy in", () => {
        const mine = skillRows(shipped(), {}).find((r) => r.name === "mine")!;
        expect(skillCopyTargets(mine, COLUMNS)).toEqual([
            { runtime: "claude", label: "Claude Code", path: "/h/.claude/skills/mine" },
            { runtime: "codex", label: "Codex", path: "/h/.codex/skills/mine" },
            { runtime: "opencode", label: "OpenCode", path: "/h/.config/opencode/skills/mine" },
        ]);
        const graphify = skillRows(sample(), {}).find((r) => r.name === "graphify")!;
        expect(skillCopyTargets(graphify, COLUMNS)).toEqual([]);
    });
});

describe("skillNameError", () => {
    it("accepts lowercase words joined by single hyphens, and an empty field says nothing yet", () => {
        expect(skillNameError("trade-check", [])).toBeNull();
        expect(skillNameError("v2", [])).toBeNull();
        expect(skillNameError("", [])).toBeNull();
    });

    it("refuses other shapes, long names and taken names", () => {
        for (const bad of ["Trade", "two words", "-lead", "trail-", "a--b", "../up", "a_b"]) {
            expect(skillNameError(bad, [])).toMatch(/Lowercase/);
        }
        expect(skillNameError("a".repeat(65), [])).toMatch(/64/);
        expect(skillNameError("notes", ["notes"])).toBe("A skill named notes already exists.");
    });
});

// ---- the fork's Skills additions (2026-11-12 sync): links, stray vault copies, leaving a skill alone ----

describe("links", () => {
    const link = (runtime: string, name: string, target: string): AgentSyncSkillLink => ({
        runtime,
        name,
        path: `C:\\h\\${runtime}\\skills\\${name}`,
        target,
    });

    it("lists a non-vault link in its own group, never counted toward Manage", () => {
        const d = data({
            unmanaged: [move("claude", "solo", { seed: true })],
            linked: [link("codex", "shared-tool", "D:\\tools\\shared-tool")],
        });
        expect(groupsOf(d)).toEqual([
            { title: "Only in Claude Code", names: ["solo"] },
            { title: "Linked from another folder", names: ["shared-tool"] },
        ]);
        const row = skillRows(d, {}).find((r) => r.name === "shared-tool")!;
        expect(row.kind).toBe("linked");
        expect(row.cells[1]).toMatchObject({ label: "Link", title: "D:\\tools\\shared-tool" });
        expect(row.cells[0].label).toBe("—");
        expect(adoptCount(d, {})).toBe(1);
        expect(adoptSkip(d, {})).toEqual([]);
    });

    it("puts the linked group ahead of the vault's own skills", () => {
        const d = data({
            skills: [{ name: "mine", states: {} }],
            linked: [link("claude", "shared-tool", "D:\\tools\\shared-tool")],
        });
        expect(groupsOf(d).map((g) => g.title)).toEqual(["Linked from another folder", "Your skills"]);
    });

    it("drops a junction's \\??\\ prefix from the target it shows", () => {
        const d = data({ linked: [link("claude", "j", "\\??\\D:\\tools\\j")] });
        expect(skillRows(d, {})[0].cells[0].title).toBe("D:\\tools\\j");
    });

    it("shows a link beside a copy of the same name as that row's Link cell, not a second row", () => {
        const d = data({
            unmanaged: [move("claude", "dual", { seed: true })],
            linked: [link("codex", "dual", "D:\\tools\\dual")],
        });
        const rows = skillRows(d, {});
        expect(rows).toHaveLength(1);
        expect(rows[0].cells.map((c) => c.label)).toEqual(["Only here", "Link", "—", "—"]);
    });

    it("reads a vault skill's linked harness entry as Link, in the warn tone", () => {
        const d = data({ skills: [{ name: "vaulted", states: { claude: "synced", codex: "linked" } }] });
        expect(skillRows(d, {})[0].cells[1]).toMatchObject({ label: "Link", tone: "warn" });
    });

    it("titles a vault skill's Link cell with its link's target, as no row of its own", () => {
        const d = data({
            skills: [{ name: "vaulted", states: { claude: "synced", codex: "linked" } }],
            linked: [link("codex", "vaulted", "\\??\\D:\\tools\\vaulted")],
        });
        const rows = skillRows(d, {});
        expect(rows).toHaveLength(1);
        expect(rows[0].cells[1]).toEqual({
            runtime: "codex",
            label: "Link",
            tone: "warn",
            title: "D:\\tools\\vaulted",
        });
        expect(groupsOf(d).map((g) => g.title)).not.toContain("Linked from another folder");
        expect(adoptCount(d, {})).toBe(0);
    });

    it("falls back to a fixed title when the backend lists no link for a vault skill", () => {
        const d = data({ skills: [{ name: "vaulted", states: { claude: "synced", codex: "linked" } }] });
        expect(skillRows(d, {})[0].cells[1].title).toBe(
            "A link to another folder: arcterm leaves it alone and does not write this skill here"
        );
    });

    it("treats a reply with no linked list as none", () => {
        const { linked: _, ...bare } = data({ unmanaged: [move("claude", "solo", { seed: true })] });
        expect(skillRows(bare, {}).map((r) => r.kind)).toEqual(["only"]);
    });

    it("says in the rail that arcterm leaves links alone, and previews the link's own folder", () => {
        setPlatform("win32");
        const d = data({ linked: [link("codex", "shared-tool", "D:\\tools\\shared-tool")] });
        const row = skillRows(d, {})[0];
        expect(skillNote(row)).toMatch(/leaves links alone/);
        expect(skillNote(row)).toMatch(/never moves one into the vault/);
        expect(skillFilePath(row, "C:\\vault\\skills", {})).toBe("C:\\h\\codex\\skills\\shared-tool\\SKILL.md");
    });
});

describe("stray copies of a vault skill", () => {
    function stray(): CommandAgentSyncSkillsRtnData {
        return data({
            skills: [{ name: "helper", states: { claude: "synced", codex: "unmanaged" } }],
            unmanaged: [move("codex", "helper", { vault: true, bodydiff: true })],
        });
    }

    it("keeps the vault skill in its own group and lists the stray copy on the row", () => {
        expect(groupsOf(stray())).toEqual([{ title: "Your skills", names: ["helper"] }]);
        const row = skillRows(stray(), {})[0];
        expect(row.kind).toBe("managed");
        expect(row.strays.map((c) => c.runtime)).toEqual(["codex"]);
        expect(row.copies).toEqual([]);
        expect(copyDelta(row.strays[0])).toBe("Body text differs");
    });

    it("says a stray copy with no difference is the same as the vault copy", () => {
        const d = data({
            skills: [{ name: "helper", states: { claude: "synced", codex: "unmanaged" } }],
            unmanaged: [move("codex", "helper", { vault: true })],
        });
        expect(copyDelta(skillRows(d, {})[0].strays[0])).toBe("Same as the vault copy");
    });

    it("counts toward Manage only once Replace is chosen, then sends the vault keep", () => {
        expect(adoptCount(stray(), {})).toBe(0);
        expect(adoptKeep(stray(), {})).toEqual({});
        const keep = { helper: KEEP_VAULT };
        expect(adoptCount(stray(), keep)).toBe(1);
        expect(adoptKeep(stray(), keep)).toEqual({ helper: "vault" });
        const row = skillRows(stray(), keep)[0];
        expect(row.replace).toBe(true);
        expect(row.cells[1]).toMatchObject({ label: "Replaced", tone: "warn" });
        expect(skillRows(stray(), {})[0].cells[1]).toMatchObject({ label: "Own copy", tone: "none" });
    });

    it("sends the vault keep for a vault skill with stray copies and for nothing else", () => {
        expect(adoptKeep(sample(), { vaulted: KEEP_VAULT, commit: KEEP_VAULT })).toEqual({});
    });

    it("leaves a stray copy the backend did not mark as the vault's counted as before", () => {
        // the existing sample: vaulted's copy carries no vault flag, so it still counts toward Manage
        expect(skillRows(sample(), {}).find((r) => r.name === "vaulted")!.strays).toEqual([]);
        expect(adoptCount(sample(), {})).toBe(6);
    });
});

describe("leaving a skill alone", () => {
    it("skips a left-alone row: Left alone cells, out of the count, sent in skip and never in keep", () => {
        const keep = { commit: KEEP_LEAVE };
        expect(adoptSkip(sample(), keep)).toEqual(["commit"]);
        expect(adoptKeep(sample(), keep)).toEqual({});
        expect(adoptCount(sample(), keep)).toBe(5);
        const row = skillRows(sample(), keep).find((r) => r.name === "commit")!;
        expect(row.left).toBe(true);
        expect(row.cells.map((c) => c.label)).toEqual(["Left alone", "Left alone", "—", "—"]);
    });

    it("lets an undecided skill be left alone instead of waiting for a decision", () => {
        const keep = { translate: KEEP_LEAVE };
        expect(adoptSkip(sample(), keep)).toEqual(["translate"]);
        expect(adoptKeep(sample(), keep)).toEqual({});
        expect(groupsOf(sample(), keep).find((g) => g.title === "Needs a decision")).toBeUndefined();
    });

    it("skips nothing for a vault skill, a name with no copy, or no choice at all", () => {
        expect(adoptSkip(sample(), { vaulted: KEEP_LEAVE, ghost: KEEP_LEAVE })).toEqual([]);
        expect(adoptSkip(sample(), {})).toEqual([]);
    });
});

describe("adoptResultText", () => {
    const moves = ["a", "b", "c"].map((n) => move("claude", n, { seed: true }));

    it("counts what the reply moved, what waits, and what was left alone", () => {
        const rtn: CommandAgentSyncAdoptRtnData = {
            moves: [
                ...moves,
                move("codex", "a"),
                move("claude", "d", { seed: true }),
                move("codex", "d", { bodydiff: true }),
            ],
            unresolved: ["d"],
        };
        expect(adoptResultText(rtn, { skip: ["x", "y"] })).toBe(
            "Moved 3 skills into the vault · 1 wait for a decision · 2 left alone"
        );
    });

    it("leaves out the zero parts and says one skill", () => {
        expect(adoptResultText({ moves: [moves[0]] }, { skip: [] })).toBe("Moved 1 skill into the vault");
    });

    it("counts a vault skill's copy only when the vault copy was kept", () => {
        const rtn = { moves: [move("codex", "helper", { vault: true })] };
        expect(adoptResultText(rtn, { skip: [] })).toBe("Moved 0 skills into the vault");
        expect(adoptResultText(rtn, { skip: [], keep: { helper: KEEP_VAULT } })).toBe("Moved 1 skill into the vault");
    });

    it("says a snapshot moved nothing", () => {
        expect(adoptResultText({ moves, dryrun: true }, { skip: [] })).toBe("Snapshot: nothing moved (would move 3)");
    });
});

describe("piSkillsLine", () => {
    const status = (pi: Partial<AgentSyncHarness>): CommandAgentSyncStatusRtnData => ({
        harnesses: [
            {
                runtime: "pi",
                label: "Pi",
                path: "",
                present: true,
                steering: "current",
                skillsmanaged: 0,
                skillsunmanaged: 0,
                ...pi,
            },
        ],
        steeringdoc: "",
        skillsroot: "",
    });

    it("says Pi's note in the tone the backend gave it", () => {
        expect(piSkillsLine(status({ note: "via the vault directly", notetone: "ok" }))).toEqual({
            text: "Pi skills: via the vault directly",
            tone: "ok",
        });
        expect(
            piSkillsLine(status({ note: "pi settings do not point at the synced skills", notetone: "warn" }))?.tone
        ).toBe("warn");
    });

    it("takes a note with no tone as ok, never by matching its text", () => {
        expect(piSkillsLine(status({ note: "pi settings do not point at the synced skills" }))?.tone).toBe("ok");
    });

    it("draws nothing when Pi is not set up or has no note", () => {
        expect(piSkillsLine(status({ present: false, note: "x", notetone: "warn" }))).toBeNull();
        expect(piSkillsLine(status({}))).toBeNull();
        expect(piSkillsLine(null)).toBeNull();
    });
});
