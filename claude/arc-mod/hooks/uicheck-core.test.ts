import { describe, expect, it } from "vitest";
import { isCommit, isLiveCheck, uiCheckReminder, uiFiles } from "./uicheck-core";

describe("isCommit", () => {
    it.each([
        'git commit -m "fix" -- a.ts',
        "cd /d/repo; git commit -- AGENTS.md",
        "git -C D:/repo commit --amend --no-edit",
        'git add -- new.ts && git commit -m "x" -- new.ts',
        "GIT_INDEX_FILE=/tmp/i git commit-tree $t -p HEAD -m x > c; git update-ref HEAD $(cat c) abc",
    ])("takes %s for a commit", (command) => {
        expect(isCommit(command)).toBe(true);
    });

    it.each(["git status", "git commit-tree abc -p HEAD", "git log --grep commit", "echo git committed"])(
        "takes %s for none",
        (command) => {
            expect(isCommit(command)).toBe(false);
        }
    );
});

describe("isLiveCheck", () => {
    it.each([
        "task verify:ui -- tray-popover",
        "CDP_PORT=9223 task verify:ui",
        "node scripts/cdp-shot.mjs out.png",
        "node scripts/cdp/verify.mjs surface-smoke",
        "node scripts\\cdp\\final-verify.mjs tray",
    ])("counts %s", (command) => {
        expect(isLiveCheck(command)).toBe(true);
    });

    it.each(["task check:ts", "npx vitest run frontend/app/cockpit", "git diff scripts/cdp.md"])(
        "does not count %s",
        (command) => {
            expect(isLiveCheck(command)).toBe(false);
        }
    );
});

describe("uiFiles", () => {
    it("keeps views and styles, drops tests, models and files outside frontend", () => {
        expect(
            uiFiles([
                "frontend/app/cockpit/traypage.tsx",
                "frontend/tailwindsetup.css",
                "frontend/app/cockpit/trayformat.ts",
                "frontend/app/cockpit/traypage.test.tsx",
                "claude/arc-mod/hooks/cache-band.tsx",
                "AGENTS.md",
            ])
        ).toEqual(["frontend/app/cockpit/traypage.tsx", "frontend/tailwindsetup.css"]);
    });
});

describe("uiCheckReminder", () => {
    const ui = ["frontend/app/cockpit/traypage.tsx", "CHANGELOG.md"];

    it("names the UI files of an unchecked commit and both ways out", () => {
        const note = uiCheckReminder(ui, false);
        expect(note).toContain("frontend/app/cockpit/traypage.tsx");
        expect(note).not.toContain("CHANGELOG.md");
        expect(note).toContain("task verify:ui");
        expect(note).toContain("Waiting on a hand check");
    });

    it("says nothing once the session tried it in the app", () => {
        expect(uiCheckReminder(ui, true)).toBeNull();
    });

    it("says nothing when the commit carries its hand-check line", () => {
        expect(uiCheckReminder([...ui, "docs/open-issues.md"], false)).toBeNull();
    });

    it("says nothing for a commit with no UI", () => {
        expect(uiCheckReminder(["pkg/x/x.go", "frontend/app/cockpit/trayformat.ts"], false)).toBeNull();
    });

    it("folds a long list after four files", () => {
        const many = ["a", "b", "c", "d", "e", "f"].map((n) => `frontend/app/${n}.tsx`);
        const note = uiCheckReminder(many, false)!;
        expect(note).toContain("frontend/app/d.tsx, 2 more");
        expect(note).not.toContain("frontend/app/e.tsx");
    });
});
