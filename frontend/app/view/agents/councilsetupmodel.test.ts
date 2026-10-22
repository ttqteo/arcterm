import { describe, expect, it } from "vitest";
import { emptyCouncilDraft, type CouncilSetupDraft } from "./councilmodel";
import {
    addFiles,
    addRole,
    addScreenshot,
    applyGroup,
    applySuggestion,
    askText,
    basename,
    beginSuggest,
    estimateKey,
    estimateRequest,
    expertInitial,
    expertsLine,
    expertTone,
    failSuggestion,
    groupFromDraft,
    groupName,
    groupSlug,
    initialPanel,
    joinAsk,
    panelFor,
    pendingRoles,
    readingLine,
    relativeToProject,
    removeExpert,
    removeFile,
    removeScreenshot,
    retrySuggestion,
    setExpertModel,
    settleRerun,
    splitAsk,
    startBlocker,
    startData,
    suggestRequest,
    type RoleLibrary,
} from "./councilsetupmodel";

const role = (id: string, name: string, extra: Partial<CouncilExpert> = {}): CouncilExpert => ({
    id,
    name,
    brief: `${name} brief`,
    model: "sonnet",
    ...extra,
});

const lib: RoleLibrary = {
    roles: [
        role("ux", "UX"),
        role("ram", "RAM"),
        role("newuser", "New user"),
        role("skeptic", "Skeptic"),
        role("coordinator", "Coordinator", { model: "opus", coordinator: true }),
        role("reviewer-a", "Reviewer A"),
        role("reader", "Reader"),
        role("areachair", "Area chair", { model: "opus", coordinator: true }),
    ],
    groups: [
        {
            id: "ui-feature",
            name: "Review a UI feature",
            roles: ["ux", "ram", "newuser", "skeptic"],
            coordinator: "coordinator",
        },
        { id: "paper", name: "Paper review", roles: ["reviewer-a", "reader"], coordinator: "areachair" },
    ],
};

const PROJECT = "D:\\code\\arc";
const draft = (extra: Partial<CouncilSetupDraft> = {}): CouncilSetupDraft => ({
    ...emptyCouncilDraft(PROJECT),
    ...extra,
});
const ids = (d: CouncilSetupDraft) => d.experts.map((e) => e.id);

describe("panelFor", () => {
    it("lists the group's roles in its order, the coordinator last and flagged", () => {
        const panel = panelFor(lib, "ui-feature");
        expect(panel.map((e) => e.id)).toEqual(["ux", "ram", "newuser", "skeptic", "coordinator"]);
        expect(panel.map((e) => e.coordinator === true)).toEqual([false, false, false, false, true]);
        expect(panel[4].model).toBe("opus");
    });

    it("flags the coordinator from the group, not from the role, and leaves a role that is not one unflagged", () => {
        const odd: RoleLibrary = {
            roles: [role("a", "A", { coordinator: true }), role("b", "B")],
            groups: [{ id: "g", name: "G", roles: ["a"], coordinator: "b" }],
        };
        const panel = panelFor(odd, "g");
        expect(panel.map((e) => [e.id, e.coordinator === true])).toEqual([
            ["a", false],
            ["b", true],
        ]);
    });

    it("skips a role that is unknown or repeated, and the coordinator named as a member", () => {
        const g: RoleLibrary = {
            ...lib,
            groups: [
                { id: "g", name: "G", roles: ["ux", "ghost", "ux", "coordinator", "ram"], coordinator: "coordinator" },
            ],
        };
        expect(panelFor(g, "g").map((e) => e.id)).toEqual(["ux", "ram", "coordinator"]);
    });

    it("is empty for an unknown group or a group whose coordinator is not a known role", () => {
        expect(panelFor(lib, "nope")).toEqual([]);
        expect(
            panelFor({ ...lib, groups: [{ id: "g", name: "G", roles: ["ux"], coordinator: "ghost" }] }, "g")
        ).toEqual([]);
    });

    it("copies the roles, so a model change does not reach the library", () => {
        const panel = panelFor(lib, "ui-feature");
        panel[0].model = "haiku";
        expect(lib.roles[0].model).toBe("sonnet");
    });

    it("drops a suggestion's reason from a role", () => {
        const withWhy: RoleLibrary = { ...lib, roles: [...lib.roles, role("mac", "Mac user", { why: "x" })] };
        const g: RoleLibrary = {
            ...withWhy,
            groups: [{ id: "g", name: "G", roles: ["mac"], coordinator: "coordinator" }],
        };
        expect(panelFor(g, "g")[0].why).toBeUndefined();
    });
});

describe("groups on the draft", () => {
    it("picking a group sets its panel and counts as picked", () => {
        const d = applyGroup(draft(), lib, "paper", true);
        expect(d.group).toBe("paper");
        expect(ids(d)).toEqual(["reviewer-a", "reader", "areachair"]);
        expect(d.groupPicked).toBe(true);
    });

    it("a group Setup chose itself is not a pick", () => {
        expect(applyGroup(draft(), lib, "ui-feature", false).groupPicked).toBe(false);
    });

    it("a draft with no panel starts on the first group, unpicked", () => {
        const d = initialPanel(draft(), lib);
        expect(d.group).toBe("ui-feature");
        expect(ids(d)).toEqual(["ux", "ram", "newuser", "skeptic", "coordinator"]);
        expect(d.groupPicked).toBe(false);
    });

    it("leaves a draft that has a panel alone (the same object), and waits for a library with no group", () => {
        const withPanel = draft({ experts: panelFor(lib, "paper"), group: "paper" });
        expect(initialPanel(withPanel, lib)).toBe(withPanel);
        const blank = draft();
        expect(initialPanel(blank, { roles: [], groups: [] })).toBe(blank);
    });

    it("names a group, or Custom when it is gone", () => {
        expect(groupName(lib, "paper")).toBe("Paper review");
        expect(groupName(lib, "")).toBe("Custom");
        expect(groupName(lib, "gone")).toBe("Custom");
    });
});

describe("editing the panel", () => {
    const base = () => initialPanel(draft(), lib);

    it("removes an expert and counts the panel as the person's", () => {
        const d = removeExpert(base(), "newuser");
        expect(ids(d)).toEqual(["ux", "ram", "skeptic", "coordinator"]);
        expect(d.groupPicked).toBe(true);
    });

    it("never removes the coordinator", () => {
        const b = base();
        expect(removeExpert(b, "coordinator")).toBe(b);
        expect(removeExpert(b, "ghost")).toBe(b);
    });

    it("changes one expert's model", () => {
        const d = setExpertModel(base(), "ram", "haiku");
        expect(d.experts.find((e) => e.id === "ram")?.model).toBe("haiku");
        expect(d.experts.find((e) => e.id === "ux")?.model).toBe("sonnet");
        expect(d.groupPicked).toBe(true);
    });

    it("changes the coordinator's model too", () => {
        expect(setExpertModel(base(), "coordinator", "sonnet").experts.at(-1)?.model).toBe("sonnet");
    });

    it("adds a role before the coordinator, without its reason, once", () => {
        const added = addRole(base(), role("mac", "Mac user", { why: "Windows-only reload" }));
        expect(ids(added)).toEqual(["ux", "ram", "newuser", "skeptic", "mac", "coordinator"]);
        expect(added.experts.find((e) => e.id === "mac")?.why).toBeUndefined();
        expect(addRole(added, role("mac", "Mac user"))).toBe(added);
    });

    it("adds a role to a panel that has no coordinator yet at the end", () => {
        expect(ids(addRole(draft(), role("mac", "Mac user")))).toEqual(["mac"]);
    });
});

describe("files and screenshots", () => {
    it("shows a path inside the project relative, with forward slashes", () => {
        expect(relativeToProject(PROJECT, "D:\\code\\arc\\pkg\\services\\model.go")).toBe("pkg/services/model.go");
        expect(relativeToProject(PROJECT, "d:/code/arc/pkg")).toBe("pkg");
        expect(relativeToProject("/home/a/arc/", "/home/a/arc/src/x.ts")).toBe("src/x.ts");
    });

    it("leaves a path outside the project, a relative one and the project itself as they are", () => {
        expect(relativeToProject(PROJECT, "D:\\other\\spec.md")).toBe("D:\\other\\spec.md");
        expect(relativeToProject(PROJECT, "docs/spec.md")).toBe("docs/spec.md");
        expect(relativeToProject(PROJECT, "D:\\code\\arcade\\x.ts")).toBe("D:\\code\\arcade\\x.ts");
        expect(relativeToProject(PROJECT, PROJECT)).toBe(PROJECT);
    });

    it("adds files once each, trimmed, in the order given", () => {
        const d = addFiles(draft({ files: ["a.ts"] }), [" b.ts ", "a.ts", "", "D:\\code\\arc\\c.ts", "c.ts"]);
        expect(d.files).toEqual(["a.ts", "b.ts", "c.ts"]);
    });

    it("returns the same draft when nothing new was added", () => {
        const d = draft({ files: ["a.ts"] });
        expect(addFiles(d, ["a.ts", " "])).toBe(d);
    });

    it("removes one file", () => {
        expect(removeFile(draft({ files: ["a.ts", "b.ts"] }), "a.ts").files).toEqual(["b.ts"]);
    });

    it("keeps screenshots as given, once each, and removes them", () => {
        let d = addScreenshot(draft(), "C:\\Users\\u\\.arc\\attachments\\x\\rail.png");
        d = addScreenshot(d, "C:\\Users\\u\\.arc\\attachments\\x\\rail.png");
        expect(d.screenshots).toEqual(["C:\\Users\\u\\.arc\\attachments\\x\\rail.png"]);
        expect(removeScreenshot(d, "C:\\Users\\u\\.arc\\attachments\\x\\rail.png").screenshots).toEqual([]);
    });

    it("names a path by its last part", () => {
        expect(basename("C:\\a\\b\\rail.png")).toBe("rail.png");
        expect(basename("/a/b/c/")).toBe("c");
        expect(basename("")).toBe("");
    });
});

describe("when the coordinator is asked", () => {
    it("needs a feature and a first file", () => {
        expect(suggestRequest(draft({ feature: "Rail apps" }))).toBeNull();
        expect(suggestRequest(draft({ files: ["a.ts"] }))).toBeNull();
        expect(suggestRequest(draft({ feature: "  ", files: ["a.ts"] }))).toBeNull();
        expect(suggestRequest(draft({ feature: "Rail apps", files: ["a.ts", "b.ts"], question: "Why?" }))).toEqual({
            project: PROJECT,
            feature: "Rail apps",
            question: "Why?",
            files: ["a.ts", "b.ts"],
        });
    });

    it("is asked for a question from Ask the council, with the question standing for the feature", () => {
        expect(suggestRequest(draft({ question: "Is the rail right?" }))).toBeNull();
        const ask = suggestRequest(draft({ question: "Is the rail right?", sessionId: "s1" }));
        expect(ask).toEqual({
            project: PROJECT,
            feature: "Is the rail right?",
            question: "Is the rail right?",
            files: [],
        });
    });

    it("sends the typed feature when Ask the council has one", () => {
        const ask = suggestRequest(draft({ feature: "Rail apps", question: "Why?", sessionId: "s1" }));
        expect(ask?.feature).toBe("Rail apps");
        expect(ask?.question).toBe("Why?");
    });

    it("is asked once: only an idle draft asks", () => {
        const ready = draft({ feature: "Rail apps", files: ["a.ts"] });
        expect(suggestRequest(ready)).not.toBeNull();
        expect(suggestRequest(beginSuggest(ready))).toBeNull();
        expect(suggestRequest({ ...ready, suggestState: "done" })).toBeNull();
        expect(suggestRequest({ ...ready, suggestState: "failed" })).toBeNull();
    });

    it("a rerun, which arrives with its panel and its group counted as picked, counts as asked", () => {
        const rerun = draft({
            feature: "Rail apps",
            files: ["a.ts"],
            experts: panelFor(lib, "ui-feature"),
            group: "ui-feature",
            groupPicked: true,
        });
        expect(suggestRequest(rerun)).not.toBeNull();
        const settled = settleRerun(rerun);
        expect(settled.suggestState).toBe("done");
        expect(suggestRequest(settled)).toBeNull();
        expect(settled.experts).toBe(rerun.experts);
    });

    it("a draft that is not a rerun is left to ask: no panel yet, or a group nobody picked", () => {
        const fresh = draft({ feature: "Rail apps", files: ["a.ts"] });
        expect(settleRerun(fresh)).toBe(fresh);
        const unpicked = initialPanel(fresh, lib);
        expect(settleRerun(unpicked)).toBe(unpicked);
        const asking = beginSuggest(applyGroup(fresh, lib, "paper", true));
        expect(settleRerun(asking)).toBe(asking);
    });

    it("has nowhere to ask without a project", () => {
        expect(suggestRequest(draft({ project: " ", feature: "Rail apps", files: ["a.ts"] }))).toBeNull();
    });
});

describe("what the suggestion changes", () => {
    const asking = () => beginSuggest(initialPanel(draft({ feature: "Rail apps", files: ["a.ts"] }), lib));
    const mac = role("mac", "Mac user", { why: "The frame reload is Windows-only for now" });

    it("adds its files to the chips, once, and keeps the roles to offer", () => {
        const d = applySuggestion(asking(), { files: ["a.ts", "b.ts", "D:\\code\\arc\\pkg"], roles: [mac] }, lib);
        expect(d.files).toEqual(["a.ts", "b.ts", "pkg"]);
        expect(d.suggestState).toBe("done");
        expect(pendingRoles(d).map((r) => r.id)).toEqual(["mac"]);
        expect(pendingRoles(d)[0].why).toBe("The frame reload is Windows-only for now");
    });

    it("leaves the group alone when it names none", () => {
        const before = asking();
        const d = applySuggestion(before, { files: [], roles: [mac] }, lib);
        expect(d.group).toBe(before.group);
        expect(ids(d)).toEqual(ids(before));
    });

    it("replaces the group's rows with the suggested group's, unless the person picked one", () => {
        const d = applySuggestion(asking(), { files: [], roles: [], group: "paper" }, lib);
        expect(d.group).toBe("paper");
        expect(ids(d)).toEqual(["reviewer-a", "reader", "areachair"]);
        const picked = applySuggestion(
            applyGroup(asking(), lib, "ui-feature", true),
            { files: [], roles: [], group: "paper" },
            lib
        );
        expect(picked.group).toBe("ui-feature");
        expect(ids(picked)).toEqual(["ux", "ram", "newuser", "skeptic", "coordinator"]);
    });

    it("does not replace a panel the person has edited", () => {
        const edited = removeExpert(asking(), "ux");
        const d = applySuggestion(edited, { files: [], roles: [], group: "paper" }, lib);
        expect(d.group).toBe("ui-feature");
        expect(ids(d)).toEqual(["ram", "newuser", "skeptic", "coordinator"]);
    });

    it("ignores a group the library does not have", () => {
        const d = applySuggestion(asking(), { files: [], roles: [], group: "ghost" }, lib);
        expect(d.group).toBe("ui-feature");
    });

    it("offers a role until it is added, and not after", () => {
        const offered = applySuggestion(asking(), { files: [], roles: [mac] }, lib);
        const added = addRole(offered, mac);
        expect(pendingRoles(added)).toEqual([]);
        expect(ids(added)).toContain("mac");
    });

    it("lands only on a draft that is waiting for it", () => {
        const idle = initialPanel(draft({ feature: "Rail apps", files: ["a.ts"] }), lib);
        expect(applySuggestion(idle, { files: ["z.ts"], roles: [] }, lib)).toBe(idle);
    });

    it("a failure leaves the panel and files alone, and can be asked again", () => {
        const before = asking();
        const failed = failSuggestion(before);
        expect(failed.suggestState).toBe("failed");
        expect(failed.experts).toBe(before.experts);
        expect(failed.files).toBe(before.files);
        expect(retrySuggestion(failed).suggestState).toBe("idle");
        const idle = draft();
        expect(failSuggestion(idle)).toBe(idle);
        expect(retrySuggestion(idle)).toBe(idle);
    });
});

describe("the composer's text", () => {
    it("takes the first line as the feature and the rest as the question", () => {
        expect(splitAsk("Rail apps\nIs the pin worth it?")).toEqual({
            feature: "Rail apps",
            question: "Is the pin worth it?",
        });
    });

    it("leaves the question empty for one line that is not a question", () => {
        expect(splitAsk("Rail apps")).toEqual({ feature: "Rail apps", question: "" });
        expect(splitAsk("")).toEqual({ feature: "", question: "" });
    });

    it("makes one line ending in ? both the feature and the question", () => {
        expect(splitAsk("Is the pin worth it?")).toEqual({
            feature: "Is the pin worth it?",
            question: "Is the pin worth it?",
        });
    });

    it("skips blank lines before the feature and trims what it keeps", () => {
        expect(splitAsk("\n  \n  Rail apps  \n\n  Is it worth it?  \n")).toEqual({
            feature: "Rail apps",
            question: "Is it worth it?",
        });
        expect(splitAsk("\n\nIs it worth it?\n\n")).toEqual({
            feature: "Is it worth it?",
            question: "Is it worth it?",
        });
    });

    it("keeps a multi-line question with its line breaks", () => {
        expect(splitAsk("Rail apps\nIs it worth it?\nAnd for Mac users?")).toEqual({
            feature: "Rail apps",
            question: "Is it worth it?\nAnd for Mac users?",
        });
        expect(splitAsk("Rail apps\r\nOne?\r\nTwo?").question).toBe("One?\nTwo?");
    });

    it("shows Ask the council's question as the one line, and splits it back into a question", () => {
        const ask = draft({ question: "Is the rail the right home for pinned apps?", sessionId: "s1" });
        expect(joinAsk(ask)).toBe("Is the rail the right home for pinned apps?");
        expect(splitAsk(joinAsk(ask)).question).toBe(ask.question);
    });

    it("round-trips a Run again draft and one saved with a separate feature and question", () => {
        for (const d of [
            draft({ feature: "Rail apps", question: "Is the pin worth it?" }),
            draft({ feature: "Rail apps", question: "Is it worth it?\nAnd for Mac users?" }),
            draft({ feature: "Rail apps" }),
        ]) {
            expect(joinAsk(d)).toBe([d.feature, d.question].filter((x) => x !== "").join("\n"));
            expect(splitAsk(joinAsk(d)).feature).toBe(d.feature);
        }
        const both = draft({ feature: "Rail apps", question: "Is the pin worth it?" });
        expect(splitAsk(joinAsk(both))).toEqual({ feature: both.feature, question: both.question });
        expect(joinAsk(draft({ feature: "Is it?", question: "Is it?" }))).toBe("Is it?");
        expect(joinAsk(draft())).toBe("");
    });

    it("keeps what the person typed while it still reads as the draft, so a new line can be started", () => {
        const typed = "Rail apps\n";
        const d = { ...draft(), ...splitAsk(typed) };
        expect(askText(d, typed)).toBe(typed);
        // a draft that came from outside replaces it
        expect(askText(draft({ feature: "Other", question: "Why?" }), typed)).toBe("Other\nWhy?");
        expect(askText(draft({ question: "Why?", sessionId: "s1" }), null)).toBe("Why?");
    });
});

describe("Start council", () => {
    const ready = () =>
        initialPanel(draft({ feature: " Rail apps ", question: "Is the rail right?", files: ["a.ts"] }), lib);

    it("is ready with a feature and a panel", () => {
        expect(startBlocker(ready())).toBe("");
    });

    it("says what is missing", () => {
        expect(startBlocker(initialPanel(draft(), lib))).toBe("Say what the council should review");
        expect(startBlocker(draft({ feature: "Rail apps" }))).toBe("Pick a group of experts");
        let d = ready();
        for (const id of ["ux", "ram", "newuser", "skeptic"]) d = removeExpert(d, id);
        expect(startBlocker(d)).toBe("Keep at least one expert besides the coordinator");
        expect(startBlocker({ ...ready(), project: "" })).toBe("Choose a project first");
    });

    it("sends the draft's feature, question, files, screenshots, panel, pause and session", () => {
        const d = addScreenshot({ ...ready(), pause: true, sessionId: "s1" }, "C:\\shots\\rail.png");
        const data = startData(d);
        expect(data).toEqual({
            project: PROJECT,
            feature: "Rail apps",
            question: "Is the rail right?",
            files: ["a.ts"],
            screenshots: ["C:\\shots\\rail.png"],
            group: "ui-feature",
            experts: d.experts,
            pause: true,
            sessionid: "s1",
        });
        expect(data.experts?.at(-1)?.coordinator).toBe(true);
    });

    it("is ready with only a question, as Ask the council hands it over, and sends it as the feature too", () => {
        const ask = initialPanel(draft({ question: "Is the rail right?", sessionId: "s1" }), lib);
        expect(startBlocker(ask)).toBe("");
        const data = startData(ask);
        expect(data.feature).toBe("Is the rail right?");
        expect(data.question).toBe("Is the rail right?");
        expect(data.sessionid).toBe("s1");
    });

    it("leaves out what is empty", () => {
        const data = startData(initialPanel(draft({ feature: "Rail apps" }), lib));
        expect(data.question).toBeUndefined();
        expect(data.sessionid).toBeUndefined();
        expect(data.files).toEqual([]);
        expect(data.pause).toBe(false);
    });
});

describe("the estimate and the footer", () => {
    it("prices the project, its files and the panel", () => {
        const d = initialPanel(draft({ files: ["a.ts"] }), lib);
        expect(estimateRequest(d)).toEqual({ project: PROJECT, files: ["a.ts"], experts: d.experts });
    });

    it("asks again only when something it prices changes: not for a model, not for a brief", () => {
        const d = initialPanel(draft({ files: ["a.ts"] }), lib);
        const key = estimateKey(d);
        expect(estimateKey(setExpertModel(d, "ux", "haiku"))).toBe(key);
        expect(estimateKey(removeExpert(d, "ux"))).not.toBe(key);
        expect(estimateKey(addFiles(d, ["b.ts"]))).not.toBe(key);
        expect(estimateKey({ ...d, feature: "Rail apps", pause: true })).toBe(key);
    });

    it("counts the models that read the code first", () => {
        const d = initialPanel(draft(), lib);
        expect(readingLine(d)).toBe("4 sonnet experts read the code first; then they argue over text only");
        expect(readingLine(setExpertModel(d, "ux", "opus"))).toBe(
            "3 sonnet and 1 opus experts read the code first; then they argue over text only"
        );
        const three = setExpertModel(setExpertModel(d, "ux", "opus"), "ram", "haiku");
        expect(readingLine(three)).toBe(
            "2 sonnet, 1 opus and 1 haiku experts read the code first; then they argue over text only"
        );
        const one = removeExpert(removeExpert(removeExpert(d, "ux"), "ram"), "newuser");
        expect(readingLine(one)).toBe("1 sonnet expert reads the code first; then they argue over text only");
        expect(readingLine(draft())).toBe("");
    });
});

describe("expertsLine", () => {
    it("names the group's experts and the coordinator who writes the answer", () => {
        const d = initialPanel(draft(), lib);
        expect(expertsLine(d, lib)).toBe(
            "Review a UI feature: UX, RAM, New user and Skeptic each read the code from their own side; the Coordinator writes the answer."
        );
        expect(expertsLine(removeExpert(removeExpert(removeExpert(d, "ux"), "ram"), "newuser"), lib)).toBe(
            "Review a UI feature: Skeptic reads the code from its own side; the Coordinator writes the answer."
        );
    });

    it("is empty without an expert", () => {
        expect(expertsLine(draft(), lib)).toBe("");
    });
});

describe("Save as group", () => {
    it("names the group by a slug of what the person typed", () => {
        expect(groupSlug("My UI group")).toBe("my-ui-group");
        expect(groupSlug("  Ünï & cö!  ")).toBe("ünï-cö");
        expect(groupSlug("!!!")).toBe("");
    });

    it("saves the library roles of the panel in order and its coordinator", () => {
        const d = removeExpert(initialPanel(draft(), lib), "newuser");
        expect(groupFromDraft(d, lib, "Small UI")).toEqual({
            group: { id: "small-ui", name: "Small UI", roles: ["ux", "ram", "skeptic"], coordinator: "coordinator" },
            left: [],
        });
    });

    it("leaves a role that is not in the library out and names it", () => {
        const d = addRole(initialPanel(draft(), lib), role("mac", "Mac user"));
        const saved = groupFromDraft(d, lib, "With Mac");
        expect(saved?.group.roles).toEqual(["ux", "ram", "newuser", "skeptic"]);
        expect(saved?.left).toEqual(["Mac user"]);
    });

    it("saves nothing without a name, a coordinator from the library or a role", () => {
        const d = initialPanel(draft(), lib);
        expect(groupFromDraft(d, lib, "  ")).toBeNull();
        expect(groupFromDraft(draft(), lib, "x")).toBeNull();
        let only = d;
        for (const id of ["ux", "ram", "newuser", "skeptic"]) only = removeExpert(only, id);
        expect(groupFromDraft(only, lib, "x")).toBeNull();
    });
});

describe("rows", () => {
    it("takes the initial of the name", () => {
        expect(expertInitial(role("a", "New user"))).toBe("N");
        expect(expertInitial(role("a", "  ux"))).toBe("U");
        expect(expertInitial(role("a", ""))).toBe("?");
    });

    it("colors the panel in turn and the coordinator apart", () => {
        const d = initialPanel(draft(), lib);
        expect(d.experts.map((e, i) => expertTone(d.experts, i))).toEqual([
            "conn-1",
            "conn-2",
            "conn-3",
            "conn-6",
            "coordinator",
        ]);
    });

    it("gives the slot by place in the panel, so removing a row moves the rest up", () => {
        const d = removeExpert(initialPanel(draft(), lib), "ux");
        expect(d.experts.map((e, i) => expertTone(d.experts, i))).toEqual([
            "conn-1",
            "conn-2",
            "conn-3",
            "coordinator",
        ]);
    });

    it("wraps around when the panel is longer than the palette", () => {
        const many = Array.from({ length: 8 }, (_, i) => role(`r${i}`, `R${i}`));
        expect(expertTone(many, 6)).toBe(expertTone(many, 0));
    });
});
