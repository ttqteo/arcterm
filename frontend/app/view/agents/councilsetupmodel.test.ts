import { describe, expect, it } from "vitest";
import type { AgentVM } from "./agentsviewmodel";
import { draftWithAgents, emptyCouncilDraft, type CouncilSetupDraft, type SeatableAgent } from "./councilmodel";
import {
    addableRoles,
    addAgent,
    addFiles,
    addRole,
    addScreenshot,
    applyGroup,
    applySuggestion,
    askText,
    autoGenerateRequest,
    autoGenerateShown,
    basename,
    beginAutoGenerate,
    beginSuggest,
    draftHasAgents,
    estimateKey,
    estimateRequest,
    estimateWanted,
    expertInitial,
    expertsLine,
    expertTone,
    failAutoGenerate,
    failSuggestion,
    flipMode,
    groupFromDraft,
    groupName,
    groupSlug,
    initialPanel,
    joinAsk,
    keepAutoGenerate,
    modeChip,
    modeReason,
    modeRules,
    moreProjects,
    panelFor,
    pendingRoles,
    readingLine,
    relativeToProject,
    removeAgent,
    removeExpert,
    removeFile,
    removeScreenshot,
    replaceAutoGenerate,
    retrySuggestion,
    seatableAgents,
    seatRows,
    seatsOf,
    setExpertModel,
    setRounds,
    settleAutoGenerate,
    settleRerun,
    setupEstimate,
    splitAsk,
    startBlocker,
    startData,
    startLabel,
    suggestRequest,
    unseatedAgents,
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
        role("designer", "Designer"),
        role("builder", "Builder"),
        role("contrarian", "Contrarian"),
        role("facilitator", "Facilitator", { model: "opus", coordinator: true }),
    ],
    groups: [
        {
            id: "ui-feature",
            name: "Review a UI feature",
            roles: ["ux", "ram", "newuser", "skeptic"],
            coordinator: "coordinator",
        },
        { id: "paper", name: "Paper review", roles: ["reviewer-a", "reader"], coordinator: "areachair" },
        {
            id: "product-ideas",
            name: "Product ideas",
            roles: ["newuser", "designer", "builder", "contrarian"],
            coordinator: "facilitator",
        },
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
            mode: "review",
            modewhy: "picked by hand",
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

describe("the mode", () => {
    const asking = (extra: Partial<CouncilSetupDraft> = {}) =>
        beginSuggest(initialPanel(draft({ feature: "Rail apps", files: ["a.ts"], ...extra }), lib));
    const answer = (mode?: string, group?: string): CouncilSuggestion => ({
        files: [],
        roles: [],
        mode,
        modewhy: mode ? `why ${mode}` : undefined,
        group,
    });

    it("reads Review, and Brainstorm once it is the mode, with no word on where it came from", () => {
        expect(modeChip(draft())).toBe("Review");
        expect(modeChip(draft({ mode: "brainstorm" }))).toBe("Brainstorm");
    });

    it("says the question picked it when the suggestion named a mode", () => {
        const brainstorm = applySuggestion(asking(), answer("brainstorm"), lib);
        expect(brainstorm.mode).toBe("brainstorm");
        expect(modeChip(brainstorm)).toBe("Brainstorm · picked from your question");
        const review = applySuggestion(asking(), answer("review"), lib);
        expect(review.mode).toBe("review");
        expect(modeChip(review)).toBe("Review · picked from your question");
    });

    it("stays Review, with no word on where it came from, when the suggestion names no mode or an unknown one", () => {
        expect(modeChip(applySuggestion(asking(), answer(), lib))).toBe("Review");
        const odd = applySuggestion(asking(), answer("debate"), lib);
        expect(odd.mode).toBe("review");
        expect(modeChip(odd)).toBe("Review");
    });

    it("keeps the suggestion's reason for the Start call and for the chip's title", () => {
        const d = applySuggestion(asking(), answer("brainstorm"), lib);
        expect(d.suggestion?.mode).toBe("brainstorm");
        expect(d.suggestion?.modewhy).toBe("why brainstorm");
    });

    it("flips with a click, counts as the person's pick, and says so", () => {
        const flipped = flipMode(draft(), lib);
        expect(flipped.mode).toBe("brainstorm");
        expect(flipped.modePicked).toBe(true);
        expect(modeChip(flipped)).toBe("Brainstorm · you picked it");
        const back = flipMode(flipped, lib);
        expect(back.mode).toBe("review");
        expect(modeChip(back)).toBe("Review · you picked it");
    });

    it("is never overridden by a later suggestion once the person picked it", () => {
        const picked = beginSuggest(flipMode(initialPanel(draft({ feature: "Rail apps", files: ["a.ts"] }), lib), lib));
        expect(picked.mode).toBe("brainstorm");
        const d = applySuggestion(picked, answer("review"), lib);
        expect(d.mode).toBe("brainstorm");
        expect(modeChip(d)).toBe("Brainstorm · you picked it");
    });

    it("says you picked it for a rerun, which arrives with its mode counted as picked", () => {
        expect(modeChip(draft({ mode: "brainstorm", modePicked: true }))).toBe("Brainstorm · you picked it");
    });

    it("has one sentence of rules for each mode", () => {
        expect(modeRules("brainstorm")).toBe(
            "Ideas first and no doubts yet; then they build on each other and pick the best."
        );
        expect(modeRules("review")).toBe(
            "Every claim cites a file line or a screenshot, or is marked as citing nothing."
        );
    });

    it("moves the default group with the mode: Product ideas for Brainstorm, the suggestion's group or UI for Review", () => {
        const brainstorm = applySuggestion(asking(), answer("brainstorm", "paper"), lib);
        expect(brainstorm.group).toBe("product-ideas");
        expect(ids(brainstorm)).toEqual(["newuser", "designer", "builder", "contrarian", "facilitator"]);
        expect(brainstorm.groupPicked).toBe(false);
        // a click on the chip moves it too, and back to the group the suggestion named, else the UI group
        expect(flipMode(draft({ group: "paper", experts: panelFor(lib, "paper") }), lib).group).toBe("product-ideas");
        expect(flipMode(brainstorm, lib).group).toBe("paper");
        const noGroup = flipMode(applySuggestion(asking(), answer("brainstorm"), lib), lib);
        expect(noGroup.group).toBe("ui-feature");
        expect(ids(noGroup)).toEqual(["ux", "ram", "newuser", "skeptic", "coordinator"]);
    });

    it("keeps the group a suggestion with no mode named, so a paper question still gets the paper panel", () => {
        const d = applySuggestion(asking(), answer(undefined, "paper"), lib);
        expect(d.mode).toBe("review");
        expect(d.group).toBe("paper");
        expect(ids(d)).toEqual(["reviewer-a", "reader", "areachair"]);
    });

    it("leaves a group the person picked alone, whatever the mode does", () => {
        const picked = applyGroup(asking(), lib, "paper", true);
        const d = applySuggestion(picked, answer("brainstorm"), lib);
        expect(d.mode).toBe("brainstorm");
        expect(d.group).toBe("paper");
        expect(flipMode(picked, lib).group).toBe("paper");
        const edited = removeExpert(asking(), "ux");
        expect(applySuggestion(edited, answer("brainstorm"), lib).group).toBe("ui-feature");
    });

    it("leaves the panel alone when the library has no Product ideas group", () => {
        const old: RoleLibrary = { ...lib, groups: lib.groups.filter((g) => g.id !== "product-ideas") };
        const d = applySuggestion(asking(), answer("brainstorm"), old);
        expect(d.mode).toBe("brainstorm");
        expect(d.group).toBe("ui-feature");
        expect(flipMode(draft({ group: "ui-feature", experts: panelFor(old, "ui-feature") }), old).group).toBe(
            "ui-feature"
        );
    });

    it("sends the mode and why with Start council: the suggestion's reason, or picked by hand", () => {
        const suggested = applySuggestion(asking(), answer("brainstorm"), lib);
        expect(startData(suggested).mode).toBe("brainstorm");
        expect(startData(suggested).modewhy).toBe("why brainstorm");
        const flipped = flipMode(suggested, lib);
        expect(startData(flipped).mode).toBe("review");
        expect(startData(flipped).modewhy).toBe("picked by hand");
        expect(startData(draft()).modewhy).toBe("picked by hand");
        expect(startData(draft({ mode: "brainstorm" })).mode).toBe("brainstorm");
    });
});

describe("the Start label", () => {
    const council = (state: string): Council => ({ id: state, state }) as Council;

    it("is Start council with nothing running", () => {
        expect(startLabel(null)).toBe("Start council");
        expect(startLabel(undefined)).toBe("Start council");
        expect(startLabel([])).toBe("Start council");
    });

    it("is Queue council while any council runs, in any project", () => {
        expect(startLabel([council("done"), council("running")])).toBe("Queue council");
    });

    it("is Start council when the others are waiting on the person, queued, done, stopped, failed or not run", () => {
        const rest = ["awaiting-you", "queued", "done", "stopped", "failed", "not-run"].map(council);
        expect(startLabel(rest)).toBe("Start council");
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

describe("live agents", () => {
    const witness: SeatableAgent = {
        id: "tab-witness",
        name: "Witness synthesis",
        project: "D:\\code\\arc",
        harness: "claude",
        context: 625_000,
    };
    const audit: SeatableAgent = {
        id: "tab-audit",
        name: "UX audit",
        project: "D:\\code\\other",
        harness: "pi",
        context: 210_000,
    };
    const withAgents = (...agents: SeatableAgent[]) => initialPanel(draftWithAgents(agents), lib);
    const seatIds = (d: CouncilSetupDraft) => seatsOf(d).map((e) => e.id);

    it("seats the agents first, then the experts and the coordinator", () => {
        const d = withAgents(witness, audit);
        expect(seatIds(d)).toEqual([
            "agent-tab-witness",
            "agent-tab-audit",
            "ux",
            "ram",
            "newuser",
            "skeptic",
            "coordinator",
        ]);
        expect(seatsOf(d).at(-1)?.coordinator).toBe(true);
        expect(draftHasAgents(d)).toBe(true);
        const solo = initialPanel(draft(), lib);
        expect(draftHasAgents(solo)).toBe(false);
        expect(seatsOf(solo)).toEqual(solo.experts);
    });

    it("adds an agent once, after the ones seated, and removes one by its tab", () => {
        const d = addAgent(withAgents(witness), audit);
        expect(d.agents.map((a) => a.seat.agent)).toEqual(["tab-witness", "tab-audit"]);
        expect(d.agents[1]).toEqual({
            seat: {
                id: "agent-tab-audit",
                name: "UX audit",
                brief: "",
                model: "",
                agent: "tab-audit",
                harness: "pi",
                context: 210_000,
            },
            project: "D:\\code\\other",
        });
        expect(addAgent(d, audit)).toBe(d);
        const one = removeAgent(d, "tab-witness");
        expect(one.agents.map((a) => a.seat.agent)).toEqual(["tab-audit"]);
        expect(removeAgent(one, "tab-witness")).toBe(one);
        expect(draftHasAgents(removeAgent(one, "tab-audit"))).toBe(false);
        // the experts are not the agents' to change
        expect(ids(one)).toEqual(ids(d));
    });

    it("keeps the agents when a group replaces the panel", () => {
        const d = applyGroup(withAgents(witness), lib, "paper", true);
        expect(d.agents).toHaveLength(1);
        expect(ids(d)).toEqual(["reviewer-a", "reader", "areachair"]);
    });

    it("offers the live claude and pi agents that are not seated", () => {
        const vm = (id: string, extra: Partial<AgentVM> = {}): AgentVM => ({
            id,
            name: id,
            task: "",
            state: "idle",
            agent: "claude",
            project: "arc",
            usage: { contextpct: 62.5, contextmax: 1_000_000 },
            ...extra,
        });
        const roster: AgentVM[] = [
            vm("a"),
            vm("b", { agent: "pi", project: "other", usage: { contextpct: 21, contextmax: 1_000_000 } }),
            vm("codex-1", { agent: "codex" }),
            vm("shell", { kind: "terminal", agent: undefined }),
            vm("bg", { kind: "background" }),
            vm("lost", { project: undefined, cwd: "D:\\code\\cwd", usage: undefined }),
        ];
        const registry = { arc: { path: "D:\\code\\arc" }, other: { path: "D:\\code\\other" } };
        const found = seatableAgents(roster, registry, "D:\\code\\fallback");
        expect(found.map((a) => a.id)).toEqual(["a", "b", "lost"]);
        expect(found[0]).toEqual({ id: "a", name: "a", project: "D:\\code\\arc", harness: "claude", context: 625_000 });
        expect(found[1]).toMatchObject({ project: "D:\\code\\other", harness: "pi", context: 210_000 });
        expect(found[2]).toMatchObject({ project: "D:\\code\\cwd", context: 0 });
        const unregistered = seatableAgents([vm("x", { project: "gone", cwd: undefined })], registry, "D:\\code\\fb");
        expect(unregistered[0].project).toBe("D:\\code\\fb");

        const d = addAgent(initialPanel(draft(), lib), found[0]);
        expect(unseatedAgents(found, d).map((a) => a.id)).toEqual(["b", "lost"]);
        expect(unseatedAgents(found, addAgent(addAgent(d, found[1]), found[2]))).toEqual([]);
    });

    it("offers the library roles that are not on the panel and are no group's coordinator", () => {
        const d = initialPanel(draft(), lib);
        expect(addableRoles(d, lib).map((r) => r.id)).toEqual([
            "reviewer-a",
            "reader",
            "designer",
            "builder",
            "contrarian",
        ]);
        expect(addableRoles(removeExpert(d, "ux"), lib).map((r) => r.id)).toContain("ux");
    });

    it("keeps the Rounds to 1, 2 or 3, starting at 2", () => {
        const d = withAgents(witness);
        expect(d.rounds).toBe(2);
        expect(setRounds(d, 3).rounds).toBe(3);
        expect(setRounds(d, 1).rounds).toBe(1);
        expect(setRounds(d, 2)).toBe(d);
        expect(setRounds(d, 4)).toBe(d);
        expect(setRounds(d, 0)).toBe(d);
        expect(setRounds(d, 1.5)).toBe(d);
    });

    it("names the other projects the seats come from after the council's own", () => {
        expect(moreProjects(withAgents(witness))).toBe("");
        expect(moreProjects(withAgents(witness, audit))).toBe(" + 1 more");
        const third: SeatableAgent = { ...witness, id: "tab-3", project: "D:\\code\\third" };
        expect(moreProjects(addAgent(withAgents(witness, audit), third))).toBe(" + 2 more");
        // the same folder in another spelling is one project
        expect(moreProjects(withAgents(witness, { ...audit, id: "tab-same", project: "d:/code/arc/" }))).toBe("");
        expect(moreProjects(initialPanel(draft(), lib))).toBe("");
    });

    it("lists each seat with what one turn of it costs", () => {
        const rows = seatRows(withAgents(witness, audit), (p) => basename(p));
        expect(rows.map((r) => [r.expert.id, r.kind])).toEqual([
            ["agent-tab-witness", "agent"],
            ["agent-tab-audit", "agent"],
            ["ux", "expert"],
            ["ram", "expert"],
            ["newuser", "expert"],
            ["skeptic", "expert"],
            ["coordinator", "expert"],
        ]);
        expect(rows[0]).toMatchObject({ meta: "claude · arc", cost: "625k / turn", removable: true });
        expect(rows[1]).toMatchObject({ meta: "pi · other", cost: "210k / turn", removable: true });
        expect(rows[2]).toMatchObject({ meta: "sonnet · UX brief", cost: "≈45k / turn", removable: true });
        expect(rows[6]).toMatchObject({ meta: "opus · writes the summary", cost: "≈80k", removable: false });
        expect(rows[2].costNote).toContain("140k in round 1");
        const unknown = seatRows(withAgents({ ...witness, context: 0 }), (p) => p);
        expect(unknown[0].cost).toBe("size unknown");
    });

    it("counts an agent seat as the expert a council needs besides its coordinator", () => {
        let d = withAgents(witness);
        for (const id of ["ux", "ram", "newuser", "skeptic"]) d = removeExpert(d, id);
        d = { ...d, feature: "Rail apps" };
        expect(startBlocker(d)).toBe("");
        expect(startBlocker(removeAgent(d, "tab-witness"))).toBe("Keep at least one expert besides the coordinator");
        // the coordinator still comes from a group
        expect(startBlocker({ ...draftWithAgents([witness]), feature: "Rail apps" })).toBe("Pick a group of experts");
    });

    it("sends no Rounds from an expert-only draft, and its pause as it was", () => {
        const solo = { ...initialPanel(draft({ feature: "Rail apps" }), lib), pause: true, rounds: 3 };
        expect(startData(solo).pause).toBe(true);
        expect(startData(solo).rounds).toBeUndefined();
        expect(estimateRequest(solo).rounds).toBeUndefined();
        // a draft that had agents, then lost them, is expert-only again
        const seated = addAgent(solo, witness);
        const back = removeAgent(seated, "tab-witness");
        expect(startData(back).rounds).toBeUndefined();
        expect(startData(back).pause).toBe(true);
    });

    it("sends the agent seats before the experts, the Rounds, and no pause", () => {
        const d = { ...withAgents(witness, audit), feature: "Rail apps", pause: true, rounds: 3 };
        const data = startData(d);
        expect(data.experts?.map((e) => e.id)).toEqual(seatIds(d));
        expect(data.experts?.[0]).toMatchObject({ agent: "tab-witness", harness: "claude", context: 625_000 });
        expect(data.experts?.[1]).toMatchObject({ agent: "tab-audit", harness: "pi", context: 210_000 });
        expect(data.experts?.at(-1)?.coordinator).toBe(true);
        expect(data.rounds).toBe(3);
        expect(data.pause).toBe(false);
        // the council's project is the first agent's
        expect(data.project).toBe("D:\\code\\arc");
    });

    it("prices the agents' seats with their context, over the Rounds", () => {
        const d = { ...withAgents(witness), files: ["a.ts"], rounds: 3 };
        const req = estimateRequest(d);
        expect(req.rounds).toBe(3);
        expect(req.experts?.map((e) => e.id)).toEqual(seatIds(d));
        expect(req.experts?.[0].context).toBe(625_000);
        expect(estimateWanted(d)).toBe(true);
        expect(estimateWanted(initialPanel(draft(), lib))).toBe(true);
        expect(estimateWanted(draftWithAgents([witness]))).toBe(true);
        let bare = removeAgent(d, "tab-witness");
        for (const id of ["ux", "ram", "newuser", "skeptic"]) bare = removeExpert(bare, id);
        expect(estimateWanted(bare)).toBe(false);
    });

    it("asks for a new estimate when an agent is seated, its context changes or the Rounds do", () => {
        const base = initialPanel(draft({ files: ["a.ts"] }), lib);
        const key = estimateKey(base);
        const one = addAgent(base, witness);
        expect(estimateKey(one)).not.toBe(key);
        expect(estimateKey(addAgent(one, audit))).not.toBe(estimateKey(one));
        expect(estimateKey(addAgent(base, { ...witness, context: 100_000 }))).not.toBe(estimateKey(one));
        expect(estimateKey(setRounds(one, 3))).not.toBe(estimateKey(one));
        expect(estimateKey(removeAgent(one, "tab-witness"))).toBe(key);
        // Rounds mean nothing with no agent seated
        expect(estimateKey({ ...base, rounds: 3 })).toBe(key);
        expect(estimateKey({ ...one, pause: true, feature: "Rail apps" })).toBe(estimateKey(one));
    });

    it("splits what the agents cost out of the estimate", () => {
        expect(setupEstimate({ calls: 9, tokens: 820_000, minutes: 6 })).toBe("≈ 9 calls · ~0.8M tokens · ~6 min");
        expect(setupEstimate({ calls: 9, tokens: 820_000, minutes: 6, agenttokens: 0 })).toBe(
            "≈ 9 calls · ~0.8M tokens · ~6 min"
        );
        expect(setupEstimate({ calls: 7, tokens: 1_900_000, minutes: 8, agenttokens: 1_250_000 })).toBe(
            "≈ 7 calls · ~1.9M tokens · ~8 min · agents ~1.3M of it"
        );
    });
});

describe("Auto-generate", () => {
    const witness: SeatableAgent = {
        id: "tab-witness",
        name: "Witness synthesis",
        project: PROJECT,
        harness: "claude",
        context: 625_000,
    };
    const audit: SeatableAgent = {
        id: "tab-audit",
        name: "UX audit",
        project: "D:\\code\\other",
        harness: "pi",
        context: 210_000,
    };
    // two agents seated, the panel on the library's first group, as Discuss together opens Setup
    const seated = (extra: Partial<CouncilSetupDraft> = {}): CouncilSetupDraft => ({
        ...initialPanel(draftWithAgents([witness, audit]), lib),
        ...extra,
    });
    const answer = (extra: Partial<CouncilAutoGenerate> = {}): CouncilAutoGenerate => ({
        topic: "Rail apps",
        question: "Should a rail app open in place or take the whole surface?",
        mode: "brainstorm",
        ...extra,
    });
    // the draft after a press and an answer on an empty composer
    const generated = (extra: Partial<CouncilAutoGenerate> = {}, from: CouncilSetupDraft = seated()) =>
        settleAutoGenerate(beginAutoGenerate(from), answer(extra), lib);
    // what the draft holds besides Auto-generate's own state
    const bare = (d: CouncilSetupDraft): CouncilSetupDraft => ({
        ...d,
        autoState: undefined,
        autoError: undefined,
        autoPending: undefined,
    });

    it("shows only while at least one agent is seated", () => {
        expect(autoGenerateShown(draft())).toBe(false);
        expect(autoGenerateShown(initialPanel(draft({ feature: "Rail apps" }), lib))).toBe(false);
        expect(autoGenerateShown(seated())).toBe(true);
        expect(autoGenerateShown(removeAgent(seated(), "tab-witness"))).toBe(true);
        expect(autoGenerateShown(removeAgent(removeAgent(seated(), "tab-witness"), "tab-audit"))).toBe(false);
    });

    it("asks with the project and the seated agents' tab ids in seat order", () => {
        expect(autoGenerateRequest(seated())).toEqual({ project: PROJECT, agents: ["tab-witness", "tab-audit"] });
        const added = addAgent(initialPanel(draft(), lib), audit);
        expect(autoGenerateRequest(added)).toEqual({ project: PROJECT, agents: ["tab-audit"] });
    });

    it("does not ask while it waits, with no agent, or with no project", () => {
        expect(autoGenerateRequest(beginAutoGenerate(seated()))).toBeNull();
        expect(autoGenerateRequest(initialPanel(draft(), lib))).toBeNull();
        expect(autoGenerateRequest(seated({ project: "" }))).toBeNull();
        expect(autoGenerateRequest(seated({ project: "  " }))).toBeNull();
    });

    it("asks again after a failure, and while an answer waits on Replace / Keep", () => {
        const failed = failAutoGenerate(beginAutoGenerate(seated()), "boom");
        expect(autoGenerateRequest(failed)).not.toBeNull();
        const typed = settleAutoGenerate(beginAutoGenerate(seated({ feature: "mine" })), answer(), lib);
        expect(typed.autoState).toBe("confirm");
        expect(autoGenerateRequest(typed)).not.toBeNull();
    });

    it("waits on the answer, forgetting an earlier failure and a waiting answer", () => {
        const waiting = beginAutoGenerate(seated());
        expect(waiting.autoState).toBe("asking");
        expect(beginAutoGenerate(waiting)).toBe(waiting);
        const failed = failAutoGenerate(waiting, "no conversation to read");
        expect(failed.autoError).toBe("no conversation to read");
        const again = beginAutoGenerate(failed);
        expect(again.autoState).toBe("asking");
        expect(again.autoError).toBeUndefined();
        const confirm = settleAutoGenerate(beginAutoGenerate(seated({ feature: "mine" })), answer(), lib);
        expect(confirm.autoPending).toBeDefined();
        const afterConfirm = beginAutoGenerate(confirm);
        expect(afterConfirm.autoState).toBe("asking");
        expect(afterConfirm.autoPending).toBeUndefined();
        expect(afterConfirm.feature).toBe("mine");
    });

    it("fills an empty composer at once: the topic, the question, the mode as picked from the conversation", () => {
        const d = generated();
        expect(d.feature).toBe("Rail apps");
        expect(d.question).toBe("Should a rail app open in place or take the whole surface?");
        expect(d.autoLast).toBe("Rail apps\nShould a rail app open in place or take the whole surface?");
        expect(joinAsk(d)).toBe(d.autoLast);
        expect(d.mode).toBe("brainstorm");
        expect(d.modePicked).toBe(true);
        expect(d.modeFrom).toBe("conversation");
        expect(modeChip(d)).toBe("Brainstorm · picked from the conversation");
        expect(modeReason(d)).toBe("");
        expect(d.autoState).toBeUndefined();
        expect(d.autoPending).toBeUndefined();
        expect(d.autoError).toBeUndefined();
        // the seats and the rest of the draft are not touched
        expect(d.agents).toEqual(seated().agents);
        expect(d.project).toBe(PROJECT);
    });

    it("says Review picked from the conversation for a Review answer", () => {
        const d = generated({ mode: "review" });
        expect(d.mode).toBe("review");
        expect(d.modePicked).toBe(true);
        expect(modeChip(d)).toBe("Review · picked from the conversation");
    });

    it("moves the group to Product ideas for a Brainstorm answer, unless the person picked a group", () => {
        const d = generated({ mode: "brainstorm" });
        expect(d.group).toBe("product-ideas");
        expect(ids(d)).toEqual(["newuser", "designer", "builder", "contrarian", "facilitator"]);
        expect(d.groupPicked).toBe(false);
        const picked = generated({ mode: "brainstorm" }, applyGroup(seated(), lib, "paper", true));
        expect(picked.mode).toBe("brainstorm");
        expect(picked.group).toBe("paper");
        expect(picked.groupPicked).toBe(true);
        // editing the rows takes the panel over as well
        const edited = generated({ mode: "brainstorm" }, removeExpert(seated(), "ux"));
        expect(edited.group).toBe("ui-feature");
        expect(ids(edited)).not.toContain("designer");
    });

    it("takes the suggestion's group, else the UI group, for a Review answer, unless the person picked one", () => {
        const onIdeas = applyGroup(seated(), lib, "product-ideas", false);
        expect(generated({ mode: "review" }, onIdeas).group).toBe("ui-feature");
        const suggested: CouncilSetupDraft = {
            ...onIdeas,
            suggestion: { files: [], roles: [], group: "paper", mode: "review" },
        };
        const review = generated({ mode: "review" }, suggested);
        expect(review.group).toBe("paper");
        expect(ids(review)).toEqual(["reviewer-a", "reader", "areachair"]);
        const picked = generated({ mode: "review" }, applyGroup(onIdeas, lib, "product-ideas", true));
        expect(picked.group).toBe("product-ideas");
    });

    it("leaves the mode and group alone when the person flipped the chip, and still fills the topic and question", () => {
        const flipped = flipMode(seated(), lib);
        expect(flipped.mode).toBe("brainstorm");
        expect(flipped.group).toBe("product-ideas");
        const d = generated({ mode: "review" }, flipped);
        expect(d.mode).toBe("brainstorm");
        expect(d.group).toBe("product-ideas");
        expect(d.modePicked).toBe(true);
        expect(d.modeFrom).toBeUndefined();
        expect(modeChip(d)).toBe("Brainstorm · you picked it");
        expect(d.feature).toBe("Rail apps");
        expect(d.question).toBe("Should a rail app open in place or take the whole surface?");
        expect(d.autoLast).toBe(joinAsk(d));
    });

    it("counts a rerun's mode as the person's, which arrives picked", () => {
        const rerun = seated({ mode: "brainstorm", modePicked: true, groupPicked: true });
        const d = generated({ mode: "review" }, rerun);
        expect(d.mode).toBe("brainstorm");
        expect(modeChip(d)).toBe("Brainstorm · you picked it");
    });

    it("replaces a mode an earlier answer picked, and the group follows it again", () => {
        const first = generated({ mode: "brainstorm" });
        expect(first.group).toBe("product-ideas");
        const second = settleAutoGenerate(
            beginAutoGenerate(first),
            answer({ mode: "review", topic: "Rail app focus", question: "Does focus stay put?" }),
            lib
        );
        expect(second.mode).toBe("review");
        expect(second.group).toBe("ui-feature");
        expect(second.groupPicked).toBe(false);
        expect(second.modeFrom).toBe("conversation");
        expect(second.modePicked).toBe(true);
        expect(modeChip(second)).toBe("Review · picked from the conversation");
        expect(second.feature).toBe("Rail app focus");
        // a suggestion's group wins over the UI group for Review, a picked group over both
        const withSuggestion: CouncilSetupDraft = {
            ...first,
            suggestion: { files: [], roles: [], group: "paper", mode: "review" },
        };
        const viaSuggestion = settleAutoGenerate(beginAutoGenerate(withSuggestion), answer({ mode: "review" }), lib);
        expect(viaSuggestion.group).toBe("paper");
        const pickedGroup = settleAutoGenerate(
            beginAutoGenerate({ ...first, groupPicked: true }),
            answer({ mode: "review" }),
            lib
        );
        expect(pickedGroup.mode).toBe("review");
        expect(pickedGroup.group).toBe("product-ideas");
    });

    it("leaves the mode alone for an answer that names none of the two", () => {
        const d = generated({ mode: "debate" });
        expect(d.mode).toBe("review");
        expect(d.modePicked).toBe(false);
        expect(d.modeFrom).toBeUndefined();
        expect(modeChip(d)).toBe("Review");
        expect(d.feature).toBe("Rail apps");
    });

    it("is not undone by a Suggest that fires later: the mode stays the conversation's", () => {
        const d = beginSuggest({ ...generated({ mode: "brainstorm" }), files: ["a.ts"] });
        const after = applySuggestion(d, { files: [], roles: [], mode: "review", modewhy: "an existing thing" }, lib);
        expect(after.mode).toBe("brainstorm");
        expect(modeChip(after)).toBe("Brainstorm · picked from the conversation");
        expect(modeReason(after)).toBe("");
    });

    it("asks before replacing typed text: the answer waits in autoPending and nothing else changes", () => {
        const typed = seated({ feature: "My own topic", question: "My own question" });
        const waiting = beginAutoGenerate(typed);
        const d = settleAutoGenerate(waiting, answer(), lib);
        expect(d.autoState).toBe("confirm");
        expect(d.autoPending).toEqual(answer());
        expect(bare(d)).toEqual(typed);
        expect(joinAsk(d)).toBe("My own topic\nMy own question");
        expect(d.mode).toBe("review");
        expect(d.modePicked).toBe(false);
    });

    it("counts text from Ask the council and Run again as typed: a question alone, a session, no last answer", () => {
        const fromAsk = seated({ question: "Is the rail worth keeping?", sessionId: "sess-1" });
        expect(fromAsk.autoLast).toBeUndefined();
        const d = settleAutoGenerate(beginAutoGenerate(fromAsk), answer(), lib);
        expect(d.autoState).toBe("confirm");
        expect(d.feature).toBe("");
        expect(d.question).toBe("Is the rail worth keeping?");
        const rerun = seated({ feature: "Rail apps", question: "Keep it?", groupPicked: true, modePicked: true });
        expect(settleAutoGenerate(beginAutoGenerate(rerun), answer(), lib).autoState).toBe("confirm");
    });

    it("Replace writes the waiting answer over the text", () => {
        const confirm = settleAutoGenerate(
            beginAutoGenerate(seated({ feature: "mine", question: "?" })),
            answer(),
            lib
        );
        const d = replaceAutoGenerate(confirm, lib);
        expect(d.feature).toBe("Rail apps");
        expect(d.question).toBe("Should a rail app open in place or take the whole surface?");
        expect(d.autoLast).toBe(joinAsk(d));
        expect(d.autoState).toBeUndefined();
        expect(d.autoPending).toBeUndefined();
        expect(d.mode).toBe("brainstorm");
        expect(d.modeFrom).toBe("conversation");
        expect(d.group).toBe("product-ideas");
        expect(modeChip(d)).toBe("Brainstorm · picked from the conversation");
    });

    it("Replace still keeps a mode the person picked", () => {
        const typed = flipMode(seated({ feature: "mine", question: "?" }), lib);
        const confirm = settleAutoGenerate(beginAutoGenerate(typed), answer({ mode: "review" }), lib);
        const d = replaceAutoGenerate(confirm, lib);
        expect(d.feature).toBe("Rail apps");
        expect(d.mode).toBe("brainstorm");
        expect(modeChip(d)).toBe("Brainstorm · you picked it");
    });

    it("Keep drops the waiting answer and leaves the draft exactly as it was before the press", () => {
        const typed = seated({ feature: "My own topic", question: "My own question" });
        const confirm = settleAutoGenerate(beginAutoGenerate(typed), answer(), lib);
        expect(keepAutoGenerate(confirm)).toStrictEqual(typed);
        // the last answer is remembered across a Keep, for the second press's exception
        const first = generated();
        const edited = { ...first, feature: "Rail apps, edited" };
        const kept = keepAutoGenerate(settleAutoGenerate(beginAutoGenerate(edited), answer({ topic: "Else" }), lib));
        expect(kept).toStrictEqual(edited);
        expect(kept.autoLast).toBe(first.autoLast);
    });

    it("Replace and Keep do nothing outside a waiting answer", () => {
        const idle = seated({ feature: "mine" });
        expect(replaceAutoGenerate(idle, lib)).toBe(idle);
        expect(keepAutoGenerate(idle)).toBe(idle);
        const waiting = beginAutoGenerate(idle);
        expect(replaceAutoGenerate(waiting, lib)).toBe(waiting);
        expect(keepAutoGenerate(waiting)).toBe(waiting);
    });

    it("replaces a second time without asking while the composer is still exactly the last answer", () => {
        const first = generated();
        const second = settleAutoGenerate(
            beginAutoGenerate(first),
            answer({ topic: "Rail app focus", question: "Does focus stay put?" }),
            lib
        );
        expect(second.autoState).toBeUndefined();
        expect(second.feature).toBe("Rail app focus");
        expect(second.question).toBe("Does focus stay put?");
        expect(second.autoLast).toBe("Rail app focus\nDoes focus stay put?");
    });

    it("asks once the last answer was edited", () => {
        const first = generated();
        const edited = { ...first, question: `${first.question} And on a small window?` };
        const d = settleAutoGenerate(beginAutoGenerate(edited), answer({ topic: "Else" }), lib);
        expect(d.autoState).toBe("confirm");
        expect(d.feature).toBe("Rail apps");
        expect(d.autoPending?.topic).toBe("Else");
        // an edit put back is the last answer again
        const restored = { ...edited, question: first.question };
        expect(settleAutoGenerate(beginAutoGenerate(restored), answer({ topic: "Else" }), lib).feature).toBe("Else");
    });

    it("checks again when the answer arrives: text typed during the call asks first", () => {
        const waiting = beginAutoGenerate(seated());
        const typedDuring = { ...waiting, feature: "typed while it ran" };
        const d = settleAutoGenerate(typedDuring, answer(), lib);
        expect(d.autoState).toBe("confirm");
        expect(d.autoPending).toEqual(answer());
        expect(d.feature).toBe("typed while it ran");
        // text cleared during the call leaves an empty composer, which takes the answer at once
        const cleared = settleAutoGenerate(
            { ...beginAutoGenerate(seated({ feature: "x" })), feature: "" },
            answer(),
            lib
        );
        expect(cleared.autoState).toBeUndefined();
        expect(cleared.feature).toBe("Rail apps");
    });

    it("ignores an answer or a failure on a draft that is not waiting for one", () => {
        const idle = seated({ feature: "mine" });
        expect(settleAutoGenerate(idle, answer(), lib)).toBe(idle);
        expect(failAutoGenerate(idle, "late")).toBe(idle);
        const confirm = settleAutoGenerate(beginAutoGenerate(idle), answer(), lib);
        expect(settleAutoGenerate(confirm, answer({ topic: "Else" }), lib)).toBe(confirm);
        expect(failAutoGenerate(confirm, "late")).toBe(confirm);
        const failed = failAutoGenerate(beginAutoGenerate(idle), "first");
        expect(settleAutoGenerate(failed, answer(), lib)).toBe(failed);
        expect(failAutoGenerate(failed, "second")).toBe(failed);
    });

    it("keeps the feature and question on a failure and records the reason", () => {
        const typed = seated({ feature: "mine", question: "yours?" });
        const d = failAutoGenerate(beginAutoGenerate(typed), "none of the seated agents has a conversation to read");
        expect(d.autoState).toBe("failed");
        expect(d.autoError).toBe("none of the seated agents has a conversation to read");
        expect(bare(d)).toEqual(typed);
    });

    it("clears Auto-generate's mark when the person flips the chip", () => {
        const d = generated({ mode: "brainstorm" });
        expect(modeChip(d)).toBe("Brainstorm · picked from the conversation");
        const flipped = flipMode(d, lib);
        expect(flipped.mode).toBe("review");
        expect(flipped.modePicked).toBe(true);
        expect(flipped.modeFrom).toBeUndefined();
        expect("modeFrom" in flipped).toBe(false);
        expect(modeChip(flipped)).toBe("Review · you picked it");
        // the next answer then leaves the mode alone
        const next = generated({ mode: "brainstorm" }, flipped);
        expect(next.mode).toBe("review");
        expect(modeChip(next)).toBe("Review · you picked it");
    });

    it("passes a Vietnamese topic and question through unchanged", () => {
        const topic = "Thanh điều hướng bên trái của cockpit";
        const question = "Nên gộp các mục phụ vào menu «Thêm» hay giữ chúng trên thanh?";
        const d = generated({ topic, question, mode: "review" });
        expect(d.feature).toBe(topic);
        expect(d.question).toBe(question);
        expect(d.autoLast).toBe(`${topic}\n${question}`);
        expect(askText(d, null)).toBe(`${topic}\n${question}`);
    });
});
