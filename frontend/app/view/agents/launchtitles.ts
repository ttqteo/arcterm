// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { atom, type PrimitiveAtom } from "jotai";

// tabId -> the title a launch took from its task (launchTitle): the name the session keeps after its row reports in
// and before its own title arrives. A new session's SessionStart reports before its first prompt, with no title, so
// without it the header and the tree read the project name between the booting row and the ai-title. Memory only:
// after a reload the hook's title (the first prompt, then the ai-title) has long arrived.
export const launchTitlesAtom = atom<Record<string, string>>({}) as PrimitiveAtom<Record<string, string>>;
