// frontend/app/view/code/codefollow.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure: whether a change of the app-bar project should open that project in Code. Only a change made
// while Code shows counts: the value Code arrives with is not a change, so the persisted Code pick still
// wins on arrival, and "All projects" names nothing to open.

import { sameRepoPath } from "@/util/paths";
import type { CodeProject } from "./codestore";

export function projectToFollow(
    prev: string,
    next: string,
    projects: CodeProject[],
    current: CodeProject | null
): CodeProject | null {
    if (next === prev || next === "all") {
        return null;
    }
    const target = projects.find((p) => p.name === next);
    if (target == null || (current != null && sameRepoPath(current.path, target.path))) {
        return null;
    }
    return target;
}
