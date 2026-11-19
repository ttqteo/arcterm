// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { buildGlobalBindings } from "@/app/store/keybindings/bindings";
import type { KeyContext, SurfaceKey } from "@/app/store/keybindings/types";
import { atom } from "jotai";
import { describe, expect, it, vi } from "vitest";
import { openBugReport } from "./bugreportstore";
import { buildCommandItems, postCloseContext } from "./palette-commands";

vi.mock("@/app/cockpit/bugreportstore", () => ({ openBugReport: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const ctx = (over: Partial<KeyContext> = {}): KeyContext => ({
    surface: "cockpit",
    editable: false,
    modalOpen: false,
    leader: null,
    ...over,
});

describe("the bug report binding", () => {
    const model = { surfaceAtom: atom<SurfaceKey>("cockpit") } as any;
    const find = () => buildGlobalBindings(model).find((b) => b.id === "global:bug-report")!;

    it("is Ctrl+Alt+R in Help, named for the palette row", () => {
        expect(find()).toMatchObject({ keys: "Ctrl:Alt:r", group: "Help", label: "Báo lỗi arcterm" });
    });

    it("fires from inside a terminal (an editable focus) on any surface", () => {
        const b = find();
        for (const surface of ["cockpit", "agent", "jarvis", "usage"] as SurfaceKey[]) {
            expect(b.when?.(ctx({ surface, editable: true }))).toBe(true);
        }
    });

    it("yields to an open modal, so the box never stacks on a dialog", () => {
        expect(find().when?.(ctx({ modalOpen: true }))).toBe(false);
    });

    it("opens the box with the view model", () => {
        find().run(ctx());
        expect(openBugReport).toHaveBeenCalledWith(model);
    });

    it("is a row of the palette's commands, which a dialog's being open must not take away", () => {
        // the palette is a modal itself: its rows are judged against the context one frame after it closes
        const items = buildCommandItems(buildGlobalBindings(model), postCloseContext("cockpit"));
        expect(items.find((i) => i.key === "global:bug-report")).toMatchObject({
            title: "Báo lỗi arcterm",
            group: "Help",
            keys: "Ctrl:Alt:r",
        });
    });
});
