// frontend/app/view/code/codedifftarget.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The diff toggle's cycle and the header naming what the diff is against. Pure, so the cycle is
// tested without a store; codestore.ts decides whether the base is usable and drives the atoms.

import type { HeadText } from "./codestore";

export type DiffStep = "off" | "head" | "base";

export type DiffBase =
    | { kind: "usable"; branch: string; sha: string }
    | { kind: "skip" }
    | { kind: "error"; message: string };

const SHORT_SHA = 7;

// Whether HEAD has a base worth diffing against. Nothing ahead of the default branch means the
// merge-base is HEAD itself (you are on it), so the step would repeat the HEAD diff under another name.
export function diffBaseOf(
    defaultBranch: string,
    div: Pick<CommandGitDivergenceRtnData, "ahead" | "mergebase" | "isrepo"> | null
): DiffBase {
    if (defaultBranch === "" || div == null || !div.isrepo || (div.ahead ?? []).length === 0) {
        return { kind: "skip" };
    }
    if (!div.mergebase) {
        return { kind: "error", message: `HEAD has no merge-base with ${defaultBranch}` };
    }
    return { kind: "usable", branch: defaultBranch, sha: div.mergebase };
}

// A read for another file or another ref must never render: a HEAD copy labelled "base" is the lie
// the header exists to prevent.
export function headMatches(
    head: HeadText,
    path: string,
    ref: string | null
): head is Exclude<HeadText, { kind: "idle" }> {
    return head.kind !== "idle" && head.path === path && head.ref === ref;
}

// a base that is not usable (on the default branch, or no default branch) is skipped, not shown empty
export function nextDiffStep(cur: DiffStep, baseUsable: boolean): DiffStep {
    switch (cur) {
        case "off":
            return "head";
        case "head":
            return baseUsable ? "base" : "off";
        case "base":
            return "off";
    }
}

export function diffTargetLabel(target: "head" | "base", base?: { branch: string; sha: string }): string {
    if (target === "head") {
        return "Against HEAD";
    }
    if (base == null) {
        return "Against the branch base";
    }
    return `Against the merge-base with ${base.branch} (${base.sha.slice(0, SHORT_SHA)})`;
}
