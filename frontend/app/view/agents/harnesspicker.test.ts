import { describe, expect, it } from "vitest";
import { harnessPickerFace, harnessPickerItems } from "./harnesspicker";

const harnesses: HarnessInfo[] = [
    { runtime: "claude", label: "Claude Code", installed: true, consultcapable: true, runworkercapable: true, leadcapable: true },
    { runtime: "codex", label: "Codex", installed: false, consultcapable: true, runworkercapable: true, leadcapable: false },
    { runtime: "opencode", label: "OpenCode", installed: true, consultcapable: true, runworkercapable: true, leadcapable: false },
    { runtime: "pi", label: "Pi", installed: true, consultcapable: true, runworkercapable: true, leadcapable: true },
];

describe("harnessPickerItems", () => {
    it("marks unavailable and unsupported rows without selecting Claude", () => {
        const items = harnessPickerItems(harnesses, "opencode", "run-worker");
        expect(items.find((x) => x.runtime === "opencode")).toMatchObject({ selected: true, selectable: true });
        expect(items.find((x) => x.runtime === "codex")).toMatchObject({ selectable: false, unavailableReason: "not-installed" });
        expect(harnessPickerFace("", harnesses, "run-worker")).toEqual({ label: "Choose harness", valid: false });
    });

    it("gives every row a stable order and a label", () => {
        const items = harnessPickerItems(harnesses, "", "consult");
        expect(items.map((x) => x.runtime)).toEqual(["claude", "codex", "opencode", "pi"]);
        for (const item of items) {
            expect(item.label.length).toBeGreaterThan(0);
        }
    });

    it("discloses unattended file/command authority only for run workers", () => {
        const run = harnessPickerItems(harnesses, "", "run-worker");
        const consult = harnessPickerItems(harnesses, "", "consult");
        expect(run[0].disclosure).toContain("without approval");
        expect(consult[0].disclosure).toBeUndefined();
    });
});

describe("harnessPickerFace", () => {
    it("names the saved runtime and stays valid for an installed, capable harness", () => {
        expect(harnessPickerFace("opencode", harnesses, "run-worker")).toEqual({ label: "OpenCode", valid: true });
    });

    it("stays invalid for a saved-but-uninstalled harness", () => {
        expect(harnessPickerFace("codex", harnesses, "run-worker")).toMatchObject({ label: "Codex", valid: false });
    });

    it("renders an unknown runtime visibly rather than falling back to Claude", () => {
        expect(harnessPickerFace("mystery", harnesses, "run-worker")).toEqual({ label: "Unknown: mystery", valid: false });
    });
});
