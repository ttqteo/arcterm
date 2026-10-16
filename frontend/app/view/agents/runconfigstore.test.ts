// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_PARALLELISM, MAX_PARALLELISM } from "./runconfig";
import {
    autonomousAtom,
    configTouchedAtom,
    endRunConfigDraft,
    forgetConfiguredChannel,
    hydrateRunConfigFromProfile,
    parallelismAtom,
    planPathAtom,
    planPreviewAtom,
    requestRouteOpen,
    resetRunConfig,
    resetRunConfigForChannel,
    routeOpenRequestAtom,
    routeTouchedAtom,
    runRouteAtom,
    runShapeAtom,
    setAutonomous,
    setParallelism,
    setPlanPath,
    setRunRoute,
    setRunShape,
    setStart,
    setWorkerRoute,
    startAtom,
    stepParallelism,
    workerRouteAtom,
} from "./runconfigstore";

const pin = (model: string): RoutePin => ({ runtime: "claude", model }) as RoutePin;

beforeEach(() => {
    forgetConfiguredChannel();
    resetRunConfig();
});

describe("resetRunConfig", () => {
    it("returns every control to its launch default", () => {
        globalStore.set(runShapeAtom, "orchestrator");
        globalStore.set(workerRouteAtom, pin("opus"));
        setRunRoute(pin("sonnet"));
        setParallelism(7);

        resetRunConfig();

        expect(globalStore.get(runShapeAtom)).toBe("quick");
        expect(globalStore.get(runRouteAtom)).toBeNull();
        expect(globalStore.get(workerRouteAtom)).toBeNull();
        expect(globalStore.get(parallelismAtom)).toBe(DEFAULT_PARALLELISM);
    });

    // carrying "orchestrator, 6 wide" onto the next channel would arm a dispatch the user
    // configured somewhere else — the reset is what makes the config per-channel
    it("clears the manual-route flag so the next channel's preference flows in again", () => {
        setRunRoute(pin("opus"));
        expect(globalStore.get(routeTouchedAtom)).toBe(true);

        resetRunConfig();

        expect(globalStore.get(routeTouchedAtom)).toBe(false);
    });
});

describe("setRunRoute", () => {
    // the composer re-applies the channel's preferred route whenever it changes, guarded only by this
    // flag; setting the atom without it would let a preference tick replace the user's own pick
    it("marks the route as manually chosen in the same write", () => {
        expect(globalStore.get(routeTouchedAtom)).toBe(false);

        setRunRoute(pin("opus"));

        expect(globalStore.get(runRouteAtom)).toEqual(pin("opus"));
        expect(globalStore.get(routeTouchedAtom)).toBe(true);
    });

    it("counts clearing the route back to inherited as a manual choice too", () => {
        setRunRoute(null);
        expect(globalStore.get(routeTouchedAtom)).toBe(true);
    });
});

describe("setParallelism", () => {
    it("stores only widths the engine accepts", () => {
        setParallelism(MAX_PARALLELISM + 5);
        expect(globalStore.get(parallelismAtom)).toBe(MAX_PARALLELISM);

        setParallelism(0);
        expect(globalStore.get(parallelismAtom)).toBe(1);
    });
});

describe("stepParallelism", () => {
    // clicks batch: a stepper that computed `par + 1` from its render closure re-read the same stale
    // value for every click in the batch, so a fast double-click advanced one step. Measured over CDP
    // before the fix — twelve clicks moved 4 -> 5.
    it("accumulates every click in a batch", () => {
        expect(globalStore.get(parallelismAtom)).toBe(DEFAULT_PARALLELISM);

        stepParallelism(1);
        stepParallelism(1);
        stepParallelism(1);

        expect(globalStore.get(parallelismAtom)).toBe(DEFAULT_PARALLELISM + 3);
    });

    it("holds at the ceiling and the floor rather than running past them", () => {
        for (let i = 0; i < 20; i++) {
            stepParallelism(1);
        }
        expect(globalStore.get(parallelismAtom)).toBe(MAX_PARALLELISM);

        for (let i = 0; i < 20; i++) {
            stepParallelism(-1);
        }
        expect(globalStore.get(parallelismAtom)).toBe(1);
    });
});

describe("requests", () => {
    it("bumps the route-open counter for a repeated blocked launch", () => {
        const before = globalStore.get(routeOpenRequestAtom);
        requestRouteOpen();
        expect(globalStore.get(routeOpenRequestAtom)).toBe(before + 1);
    });
});

describe("resetRunConfigForChannel", () => {
    // every surface but Agent unmounts on switch, so the composer's mount effect fires again on the
    // same channel. A mount-keyed reset would throw away a configured-but-unlaunched run for the cost
    // of a glance at Usage — the whole reason the config moved to module-level atoms.
    it("survives a remount on the same channel", () => {
        resetRunConfigForChannel("ch-1");
        globalStore.set(runShapeAtom, "orchestrator");
        setParallelism(6);

        resetRunConfigForChannel("ch-1");

        expect(globalStore.get(runShapeAtom)).toBe("orchestrator");
        expect(globalStore.get(parallelismAtom)).toBe(6);
    });

    it("clears the configuration when the channel actually changes", () => {
        resetRunConfigForChannel("ch-1");
        globalStore.set(runShapeAtom, "orchestrator");
        setParallelism(6);

        resetRunConfigForChannel("ch-2");

        expect(globalStore.get(runShapeAtom)).toBe("quick");
        expect(globalStore.get(parallelismAtom)).toBe(DEFAULT_PARALLELISM);
    });

    it("treats leaving a channel for a non-channel subject as a change", () => {
        resetRunConfigForChannel("ch-1");
        globalStore.set(runShapeAtom, "orchestrator");

        resetRunConfigForChannel(null);

        expect(globalStore.get(runShapeAtom)).toBe("quick");
    });

    // + Run's channel is a field of the launch being composed, not a place you navigated to. Changing
    // the project there used to discard the shape and width you had already picked, and the project's
    // saved defaultmode hydrated over them — an orchestrator run from a Quick you selected by hand.
    it("keeps hand-made choices across a channel change when the caller asks it to", () => {
        resetRunConfigForChannel("ch-1", true);
        setRunShape("orchestrator");
        setParallelism(6);

        resetRunConfigForChannel("ch-2", true);

        expect(globalStore.get(runShapeAtom)).toBe("orchestrator");
        expect(globalStore.get(parallelismAtom)).toBe(6);
        // still the user's, so the newly picked project's profile must not hydrate over it either
        expect(globalStore.get(configTouchedAtom)).toBe(true);
    });

    // untouched is what makes the project you pick supply the defaults, keepTouched or not
    it("still clears an untouched draft when the channel changes", () => {
        resetRunConfigForChannel("ch-1", true);
        globalStore.set(runShapeAtom, "orchestrator");

        resetRunConfigForChannel("ch-2", true);

        expect(globalStore.get(runShapeAtom)).toBe("quick");
    });
});

// A launch or a discarded draft ends the configuration the manual choices belonged to. Without this the
// touched flag stayed set forever, and every later profile save was silently ignored on that channel.
describe("endRunConfigDraft", () => {
    it("clears the touched flag so a later profile save hydrates", () => {
        setRunShape("orchestrator");
        setParallelism(6);
        expect(globalStore.get(configTouchedAtom)).toBe(true);

        endRunConfigDraft({ playbook: [], defaultmode: "orchestrator", parallelism: 5 } as JarvisProfile);
        expect(globalStore.get(configTouchedAtom)).toBe(false);

        // a profile written after the launch is the next draft's starting point
        hydrateRunConfigFromProfile({
            playbook: [],
            defaultmode: "orchestrator",
            parallelism: 2,
        } as JarvisProfile);
        expect(globalStore.get(runShapeAtom)).toBe("orchestrator");
        expect(globalStore.get(parallelismAtom)).toBe(2);
    });

    it("returns the next draft to the channel's saved defaults, not to the launched one", () => {
        setRunShape("orchestrator");
        setWorkerRoute(pin("haiku"));
        setParallelism(6);

        endRunConfigDraft({
            playbook: [],
            defaultmode: "orchestrator",
            parallelism: 5,
            workerroute: pin("opus"),
        } as JarvisProfile);

        expect(globalStore.get(runShapeAtom)).toBe("orchestrator");
        expect(globalStore.get(parallelismAtom)).toBe(5);
        expect(globalStore.get(workerRouteAtom)).toEqual(pin("opus"));
    });

    it("falls back to the launch baselines when the channel has no profile", () => {
        setRunShape("orchestrator");
        setWorkerRoute(pin("opus"));
        setParallelism(6);

        endRunConfigDraft(null);

        expect(globalStore.get(runShapeAtom)).toBe("quick");
        expect(globalStore.get(parallelismAtom)).toBe(DEFAULT_PARALLELISM);
        expect(globalStore.get(workerRouteAtom)).toBeNull();
        expect(globalStore.get(configTouchedAtom)).toBe(false);
    });
});

// The launcher's starting point is the channel's saved profile, or a saved profile would be a preference
// nothing reads. Each field is applied only when the profile states it, since the launcher's own default is
// the right answer where the profile is silent.
describe("hydrateRunConfigFromProfile", () => {
    it("applies the saved shape, machine, width and worker route", () => {
        hydrateRunConfigFromProfile({
            playbook: [],
            defaultmode: "orchestrator",
            parallelism: 5,
            workerroute: pin("opus"),
        } as JarvisProfile);

        expect(globalStore.get(runShapeAtom)).toBe("orchestrator");
        expect(globalStore.get(parallelismAtom)).toBe(5);
        expect(globalStore.get(workerRouteAtom)).toEqual(pin("opus"));
    });

    it("leaves the launcher's defaults alone where the profile is silent", () => {
        hydrateRunConfigFromProfile({ playbook: [] } as JarvisProfile);
        expect(globalStore.get(runShapeAtom)).toBe("quick");
        expect(globalStore.get(parallelismAtom)).toBe(DEFAULT_PARALLELISM);
        expect(globalStore.get(workerRouteAtom)).toBeNull();
    });

    // a save while the user is mid-composition must not repaint the controls under them
    it("never overwrites a configuration the user has edited by hand", () => {
        setRunShape("orchestrator");
        setParallelism(2);
        setWorkerRoute(pin("haiku"));

        hydrateRunConfigFromProfile({
            playbook: [],
            defaultmode: "orchestrator",
            parallelism: 8,
            workerroute: pin("opus"),
        } as JarvisProfile);

        expect(globalStore.get(runShapeAtom)).toBe("orchestrator");
        expect(globalStore.get(parallelismAtom)).toBe(2);
        expect(globalStore.get(workerRouteAtom)).toEqual(pin("haiku"));
    });

    // a profile that stops stating a field must not leave the value it used to state standing: the launcher
    // would then offer a setup no saved profile describes.
    it("reverts a field the profile has stopped stating to the launch baseline", () => {
        hydrateRunConfigFromProfile({
            playbook: [],
            defaultmode: "orchestrator",
            parallelism: 5,
            workerroute: pin("opus"),
        } as JarvisProfile);
        expect(globalStore.get(runShapeAtom)).toBe("orchestrator");

        hydrateRunConfigFromProfile({ playbook: [], defaultmode: "quick" } as JarvisProfile);

        expect(globalStore.get(runShapeAtom)).toBe("quick");
        expect(globalStore.get(parallelismAtom)).toBe(DEFAULT_PARALLELISM);
        expect(globalStore.get(workerRouteAtom)).toBeNull();
    });

    it("hydrates again for the next channel, whose own profile is the default there", () => {
        setRunShape("orchestrator");
        expect(globalStore.get(configTouchedAtom)).toBe(true);

        resetRunConfigForChannel("chan-a");
        hydrateRunConfigFromProfile({ playbook: [], defaultmode: "orchestrator", parallelism: 4 } as JarvisProfile);
        expect(globalStore.get(runShapeAtom)).toBe("orchestrator");
        expect(globalStore.get(parallelismAtom)).toBe(4);
    });
});

describe("autonomous", () => {
    it("seeds from the profile's Approvals and back to Ask me where the profile is silent", () => {
        hydrateRunConfigFromProfile({ playbook: [], autonomous: true } as JarvisProfile);
        expect(globalStore.get(autonomousAtom)).toBe(true);

        hydrateRunConfigFromProfile({ playbook: [] } as JarvisProfile);
        expect(globalStore.get(autonomousAtom)).toBe(false);
    });

    it("is a hand-made choice a profile arriving does not replace", () => {
        setAutonomous(true);
        expect(globalStore.get(configTouchedAtom)).toBe(true);

        hydrateRunConfigFromProfile({ playbook: [], autonomous: false } as JarvisProfile);
        expect(globalStore.get(autonomousAtom)).toBe(true);
    });

    it("ends with the draft, back to the channel's saved Approvals", () => {
        setAutonomous(true);
        endRunConfigDraft({ playbook: [] } as JarvisProfile);
        expect(globalStore.get(autonomousAtom)).toBe(false);
    });

    it("resets with the rest of the configuration", () => {
        setAutonomous(true);
        resetRunConfig();
        expect(globalStore.get(autonomousAtom)).toBe(false);
    });
});

describe("plan start", () => {
    it("is a choice the user made, so a profile arriving does not replace it", () => {
        setStart("plan");
        setPlanPath("/repo/plan.md");
        hydrateRunConfigFromProfile({ playbook: [], defaultmode: "orchestrator" } as JarvisProfile);
        expect(globalStore.get(configTouchedAtom)).toBe(true);
        expect(globalStore.get(startAtom)).toBe("plan");
        expect(globalStore.get(planPathAtom)).toBe("/repo/plan.md");
    });

    // a plan file belongs to one launch; the next draft starts from a goal again
    it("ends with the draft", () => {
        setStart("plan");
        setPlanPath("/repo/plan.md");
        endRunConfigDraft(null);
        expect(globalStore.get(startAtom)).toBe("goal");
        expect(globalStore.get(planPathAtom)).toBe("");
    });

    it("resets with the rest of the configuration", () => {
        setStart("plan");
        setPlanPath("/repo/plan.md");
        globalStore.set(planPreviewAtom, { path: "/repo/plan.md", error: "plan has no tasks" });
        resetRunConfig();
        expect(globalStore.get(startAtom)).toBe("goal");
        expect(globalStore.get(planPathAtom)).toBe("");
        expect(globalStore.get(planPreviewAtom)).toBeNull();
    });
});
