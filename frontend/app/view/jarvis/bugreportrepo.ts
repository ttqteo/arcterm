// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Which registered project is arcterm's repo for the bug-report agent (bugreportprocess.ts): the one already registered at
// the folder, else the name a new one would take. Runs, initiatives and the agent itself all file under a registered
// project, so a folder the person picked, or one the setting was written with by hand, is registered before it is used. Pure.

import { normProjectPath } from "@/app/view/agents/channelderive";
import { uniqueProjectName } from "@/app/view/agents/newprojectmodel";

type Registry = Readonly<Record<string, { path?: string } | undefined>>;

// Windows and macOS compare paths without case: "D:\Arcterm" and "d:/arcterm" are one folder, and registering it
// twice would split its runs across two names
const key = (path: string): string => normProjectPath(path).toLowerCase();

/** The name of the project registered at path, or undefined. */
export function projectAtPath(registry: Registry | null | undefined, path: string): string | undefined {
    const want = key(path);
    if (want === "") {
        return undefined;
    }
    return Object.entries(registry ?? {}).find(
        ([, p]) => p?.path != null && p.path !== "" && key(p.path) === want
    )?.[0];
}

/** The last segment of a folder path, "arcterm" for "D:\work\arcterm\"; "arcterm" too when the path has none. */
export function repoBaseName(path: string): string {
    return (
        normProjectPath(path)
            .split("/")
            .filter((s) => s !== "")
            .pop() ?? "arcterm"
    );
}

/** The name to register path under: the folder's name, with the first free "-2", "-3"… when another path holds it. */
export function newRepoProjectName(registry: Registry | null | undefined, path: string): string {
    return uniqueProjectName(repoBaseName(path), Object.keys(registry ?? {}));
}
