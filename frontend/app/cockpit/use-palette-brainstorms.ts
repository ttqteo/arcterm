// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The Resume brainstorm picker's list: every project's open brainstorms, read while the picker shows, less the ones
// an agent still has attached.

import { notAttached } from "@/app/view/agents/brainstormmodel";
import {
    dismissBrainstorm,
    listAllOpenBrainstorms,
    tauriOpenBrainstormsIO,
    type ProjectBrainstorm,
} from "@/app/view/agents/brainstormpoller";
import { brainstormsAtom } from "@/app/view/agents/brainstormstore";
import type { ProjectRow } from "@/app/view/agents/projectsstore";
import { useAtomValue } from "jotai";
import { useEffect, useMemo, useRef, useState } from "react";

export interface PaletteBrainstorms {
    list: ProjectBrainstorm[] | null; // null: still reading
    dismiss: (b: ProjectBrainstorm) => void;
}

const errorText = (e: unknown) => String(e).replace(/^Error:\s*/, "");

export function usePaletteBrainstorms(
    active: boolean,
    projects: ProjectRow[],
    setPaletteError: (error: string | undefined) => void
): PaletteBrainstorms {
    const [list, setList] = useState<ProjectBrainstorm[] | null>(null);
    const [gen, setGen] = useState(0);
    const latest = useRef(0);
    const attached = useAtomValue(brainstormsAtom);

    useEffect(() => {
        const id = ++latest.current;
        if (!active) {
            setList(null);
            return;
        }
        // never rejects: a project that can't be read is logged and left out
        void listAllOpenBrainstorms(projects, tauriOpenBrainstormsIO).then(
            (rows) => id === latest.current && setList(rows)
        );
    }, [active, projects, gen]);

    const shown = useMemo(
        () =>
            list &&
            notAttached(
                list,
                Object.values(attached).map((s) => s.path)
            ),
        [list, attached]
    );
    const dismiss = (b: ProjectBrainstorm) => {
        // drop it at once; the re-read confirms the marker landed
        setList((cur) => cur?.filter((x) => x.path !== b.path) ?? cur);
        dismissBrainstorm(b.path).then(
            () => setGen((g) => g + 1),
            (e) => {
                setPaletteError(`Dismissing “${b.title}” failed: ${errorText(e)}`);
                setGen((g) => g + 1);
            }
        );
    };
    return { list: shown, dismiss };
}
