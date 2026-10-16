// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { beforeEach, describe, expect, it } from "vitest";
import { profileRunDefaults } from "./runconfig";
import {
    configTouchedAtom,
    endRunConfigDraft,
    forgetConfiguredChannel,
    hydrateRunConfigFromProfile,
    lightReviewerRouteAtom,
    resetRunConfig,
    reviewerPicksAtom,
    reviewerRouteAtom,
    setLightReviewerRoute,
    setReviewerPicks,
    setReviewerRoute,
    setWorkerRoute,
    workerRouteAtom,
} from "./runconfigstore";

const pin = (model: string): RoutePin => ({ runtime: "claude", model }) as RoutePin;

beforeEach(() => {
    forgetConfiguredChannel();
    resetRunConfig();
});

describe("profileRunDefaults reviewer fields", () => {
    it("reads the workers setting and the reviewer route", () => {
        const defaults = profileRunDefaults({ reviewerpicks: true, reviewerroute: pin("opus") } as JarvisProfile);
        expect(defaults.reviewerPicks).toBe(true);
        expect(defaults.reviewerRoute).toEqual(pin("opus"));
    });

    it("gives false and null for a profile that says nothing", () => {
        const defaults = profileRunDefaults({} as JarvisProfile);
        expect(defaults.reviewerPicks).toBe(false);
        expect(defaults.reviewerRoute).toBeNull();
        expect(profileRunDefaults(null).reviewerPicks).toBe(false);
    });
});

describe("workers setting exclusivity", () => {
    it("choosing Reviewer picks clears the worker route", () => {
        setWorkerRoute(pin("sonnet"));
        setReviewerPicks(true);
        expect(globalStore.get(reviewerPicksAtom)).toBe(true);
        expect(globalStore.get(workerRouteAtom)).toBeNull();
        expect(globalStore.get(configTouchedAtom)).toBe(true);
    });

    it("choosing a worker route turns Reviewer picks off", () => {
        setReviewerPicks(true);
        setWorkerRoute(pin("sonnet"));
        expect(globalStore.get(reviewerPicksAtom)).toBe(false);
        expect(globalStore.get(workerRouteAtom)).toEqual(pin("sonnet"));
    });

    it("choosing Same as lead turns Reviewer picks off", () => {
        setReviewerPicks(true);
        setWorkerRoute(null);
        expect(globalStore.get(reviewerPicksAtom)).toBe(false);
        expect(globalStore.get(workerRouteAtom)).toBeNull();
    });

    it("setting the reviewer route marks the config touched and leaves the workers alone", () => {
        setWorkerRoute(pin("sonnet"));
        globalStore.set(configTouchedAtom, false);
        setReviewerRoute(pin("opus"));
        expect(globalStore.get(reviewerRouteAtom)).toEqual(pin("opus"));
        expect(globalStore.get(workerRouteAtom)).toEqual(pin("sonnet"));
        expect(globalStore.get(configTouchedAtom)).toBe(true);
    });
});

describe("hydration of the reviewer fields", () => {
    it("fills both from the profile", () => {
        hydrateRunConfigFromProfile({ reviewerpicks: true, reviewerroute: pin("opus") } as JarvisProfile);
        expect(globalStore.get(reviewerPicksAtom)).toBe(true);
        expect(globalStore.get(reviewerRouteAtom)).toEqual(pin("opus"));
    });

    it("reverts both when the profile stops stating them", () => {
        hydrateRunConfigFromProfile({ reviewerpicks: true, reviewerroute: pin("opus") } as JarvisProfile);
        hydrateRunConfigFromProfile({} as JarvisProfile);
        expect(globalStore.get(reviewerPicksAtom)).toBe(false);
        expect(globalStore.get(reviewerRouteAtom)).toBeNull();
    });

    it("never overwrites a choice made by hand", () => {
        setReviewerRoute(pin("haiku"));
        hydrateRunConfigFromProfile({ reviewerpicks: true, reviewerroute: pin("opus") } as JarvisProfile);
        expect(globalStore.get(reviewerRouteAtom)).toEqual(pin("haiku"));
        expect(globalStore.get(reviewerPicksAtom)).toBe(false);
    });

    it("ending the draft returns to the profile's settings", () => {
        setReviewerPicks(true);
        setReviewerRoute(pin("haiku"));
        endRunConfigDraft({ reviewerroute: pin("opus") } as JarvisProfile);
        expect(globalStore.get(reviewerPicksAtom)).toBe(false);
        expect(globalStore.get(reviewerRouteAtom)).toEqual(pin("opus"));
    });

    it("a reset clears both", () => {
        setReviewerPicks(true);
        setReviewerRoute(pin("haiku"));
        resetRunConfig();
        expect(globalStore.get(reviewerPicksAtom)).toBe(false);
        expect(globalStore.get(reviewerRouteAtom)).toBeNull();
    });
});

describe("the Light reviewers route", () => {
    it("reads the profile's route, and null for a profile that says nothing", () => {
        expect(profileRunDefaults({ lightreviewerroute: pin("haiku") } as JarvisProfile).lightReviewerRoute).toEqual(
            pin("haiku")
        );
        expect(profileRunDefaults({} as JarvisProfile).lightReviewerRoute).toBeNull();
        expect(profileRunDefaults(null).lightReviewerRoute).toBeNull();
    });

    it("hydrates from the profile and reverts when the profile stops stating it", () => {
        hydrateRunConfigFromProfile({ lightreviewerroute: pin("haiku") } as JarvisProfile);
        expect(globalStore.get(lightReviewerRouteAtom)).toEqual(pin("haiku"));
        hydrateRunConfigFromProfile({} as JarvisProfile);
        expect(globalStore.get(lightReviewerRouteAtom)).toBeNull();
    });

    it("a choice by hand marks the config touched, survives hydration, and a reset clears it", () => {
        setLightReviewerRoute(pin("opus"));
        expect(globalStore.get(configTouchedAtom)).toBe(true);
        hydrateRunConfigFromProfile({ lightreviewerroute: pin("haiku") } as JarvisProfile);
        expect(globalStore.get(lightReviewerRouteAtom)).toEqual(pin("opus"));
        resetRunConfig();
        expect(globalStore.get(lightReviewerRouteAtom)).toBeNull();
    });
});
