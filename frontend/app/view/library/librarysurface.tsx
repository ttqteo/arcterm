// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Library surface: what is over, kept apart from what is live. A tab strip across the top (Conversations, Canvases,
// Councils, Boards) over the tab's own view; the tab, the Conversations view, the open council and the open board live in
// librarystore.ts, so they survive a switch to another surface (Library unmounts like every surface but Agent).
//   Conversations  `list` is Conversation History's master-detail (a row read in place); `session` and `run` are one
//                  session's or run's pane at full width, shown when a session is opened from outside Library
//                  (showLibrarySession), whose Back (leaveLibraryDetail) returns to the surface that opened it
//   Canvases       the Canvas gallery and its viewer
//   Councils       the list of every council, under the folded Benchmark chart (councilbenchchart.tsx: key lines found
//                  against tokens per run, once the bench has a scored row); a council opened from it (or from Jarvis, a
//                  notification, `wsh ui`) reads under a slim Back row, its views on Library's own selection through
//                  LIBRARY_COUNCIL_HOST
//   Boards         the boards agents drew (libraryboards.tsx): a live agent's opens beside its Chat, an ended one's here
// Thin: the views are the ones the Agent surface used to hold as centre modes. The keys are buildLibraryBindings', so this
// file holds no key handler but the tab strip's arrows.

import { indicatorSlide } from "@/app/element/motiontokens";
import { buildLibraryBindings } from "@/app/store/keybindings/bindings";
import { useKeybindings } from "@/app/store/keybindings/store";
import { formatChordString } from "@/util/keysym";
import { cn } from "@/util/util";
import { useAtom, useAtomValue } from "jotai";
import { ArrowLeft } from "lucide-react";
import { motion, MotionConfig } from "motion/react";
import { useMemo, type KeyboardEvent, type ReactNode } from "react";
import type { AgentsViewModel } from "../agents/agents";
import { CanvasGallery } from "../agents/canvasgalleryview";
import { ConversationHistory } from "../agents/conversationhistory";
import { CouncilBenchChart } from "../agents/councilbenchchart";
import { CouncilHistory } from "../agents/councilhistoryview";
import { CouncilHostContext } from "../agents/councilhost";
import { CouncilPane } from "../agents/councilpane";
import { RunPane } from "../agents/runpane";
import { SessionPane } from "../agents/sessionpane";
import { FADE_IN } from "../agents/setupstyles";
import { LibraryBoards } from "./libraryboards";
import {
    leaveLibraryCouncil,
    LIBRARY_COUNCIL_HOST,
    LIBRARY_TABS,
    libraryConvViewAtom,
    libraryCouncilSelAtom,
    libraryTabAtom,
    type LibraryTab,
} from "./librarystore";

const TAB_LABEL: Record<LibraryTab, string> = {
    conversations: "Conversations",
    canvases: "Canvases",
    councils: "Councils",
    boards: "Boards",
};

// The tab strip: plain labels standing on the header's bottom rule, the open one marked by an accent underline that
// slides to the next tab picked (indicatorSlide; reduced motion snaps it). Every label keeps one weight, so a switch
// never shifts the row. The 1–4 keys are named in each tab's tooltip, not drawn beside its label.
function Tabs() {
    const [tab, setTab] = useAtom(libraryTabAtom);
    const onKey = (e: KeyboardEvent) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") {
            return;
        }
        e.preventDefault();
        const i = LIBRARY_TABS.indexOf(tab);
        const next = LIBRARY_TABS[(i + (e.key === "ArrowRight" ? 1 : LIBRARY_TABS.length - 1)) % LIBRARY_TABS.length];
        setTab(next);
        document.getElementById(`library-tab-${next}`)?.focus();
    };
    return (
        <div role="tablist" aria-label="Library" onKeyDown={onKey} className="flex gap-1 self-stretch">
            {LIBRARY_TABS.map((t, i) => (
                <button
                    key={t}
                    id={`library-tab-${t}`}
                    data-library-tab={t}
                    type="button"
                    role="tab"
                    aria-selected={tab === t}
                    aria-controls="library-tabpanel"
                    aria-keyshortcuts={String(i + 1)}
                    title={`${TAB_LABEL[t]} (${formatChordString(String(i + 1))})`}
                    tabIndex={tab === t ? 0 : -1}
                    onClick={() => setTab(t)}
                    className={cn(
                        "relative flex cursor-pointer items-center border-0 bg-transparent px-2.5 text-[13px] font-medium",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent",
                        tab === t ? "text-primary" : "text-muted hover:text-secondary"
                    )}
                >
                    {TAB_LABEL[t]}
                    {tab === t ? (
                        <motion.span
                            layoutId="library-tab-underline"
                            data-library-tab-underline
                            aria-hidden
                            transition={indicatorSlide}
                            className="absolute inset-x-2.5 -bottom-px h-0.5 rounded-full bg-accent"
                        />
                    ) : null}
                </button>
            ))}
        </div>
    );
}

// the Councils tab: the list, or the council opened from it under a Back row. Both sit in Library's council host, so the
// views read Library's selection and leave Agent's centre column alone.
function Councils({ model }: { model: AgentsViewModel }) {
    const sel = useAtomValue(libraryCouncilSelAtom);
    return (
        <CouncilHostContext.Provider value={LIBRARY_COUNCIL_HOST}>
            {sel == null ? (
                <>
                    {/* the benchmark, folded to one line until opened, over the list; it draws nothing (and `empty:hidden`
                        takes this box with it) until the bench has a scored row. Its box scrolls when the open chart is
                        taller than the pane lets it be, so the list under it keeps a place. */}
                    <div
                        data-library-bench
                        className="max-h-[60vh] flex-none overflow-y-auto px-[24px] pb-[6px] pt-[14px] empty:hidden"
                    >
                        <CouncilBenchChart />
                    </div>
                    <CouncilHistory model={model} />
                </>
            ) : (
                <>
                    <div className="flex h-9 flex-none items-center border-b border-edge-faint px-4">
                        <button
                            type="button"
                            data-library-council-back
                            onClick={leaveLibraryCouncil}
                            className="flex w-fit flex-none cursor-pointer items-center gap-[6px] rounded-[6px] px-[6px] py-[3px] text-[12px] text-muted hover:bg-surface-hover hover:text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        >
                            <ArrowLeft size={13} aria-hidden />
                            Back
                        </button>
                    </div>
                    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                        <CouncilPane model={model} />
                    </div>
                </>
            )}
        </CouncilHostContext.Provider>
    );
}

function Conversations({ model }: { model: AgentsViewModel }) {
    const view = useAtomValue(libraryConvViewAtom);
    return view === "session" ? (
        <SessionPane model={model} />
    ) : view === "run" ? (
        <RunPane model={model} />
    ) : (
        <ConversationHistory model={model} />
    );
}

function TabBody({ tab, model }: { tab: LibraryTab; model: AgentsViewModel }): ReactNode {
    return tab === "canvases" ? (
        <CanvasGallery model={model} />
    ) : tab === "councils" ? (
        <Councils model={model} />
    ) : tab === "boards" ? (
        <LibraryBoards model={model} />
    ) : (
        <Conversations model={model} />
    );
}

export function LibrarySurface({ model }: { model: AgentsViewModel }) {
    const tab = useAtomValue(libraryTabAtom);
    const bindings = useMemo(() => buildLibraryBindings(model), [model]);
    useKeybindings(bindings);
    return (
        <MotionConfig reducedMotion="user">
            <div data-library data-library-active={tab} className="flex h-full min-h-0 flex-col bg-background">
                <div className="flex h-[52px] flex-none items-center gap-5 border-b border-border px-5">
                    <div className="text-[15px] font-semibold text-primary">Library</div>
                    <Tabs />
                </div>
                <motion.div
                    key={tab}
                    {...FADE_IN}
                    id="library-tabpanel"
                    role="tabpanel"
                    aria-labelledby={`library-tab-${tab}`}
                    className="flex min-h-0 min-w-0 flex-1 flex-col"
                >
                    <TabBody tab={tab} model={model} />
                </motion.div>
            </div>
        </MotionConfig>
    );
}
