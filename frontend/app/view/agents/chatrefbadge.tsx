// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The badge an `agent:<id>`, `run:<id>`, `council:<id>`, `session:<id>` or `effort:<id>` reference is drawn as in Chat
// (refbadge.ts finds and resolves them): in your sent bubble (RefBadge, through remarkrefmention.ts) and in the message
// box (chateditorrefpill.tsx, through useResolvedRef and RefBadgeFace). Chat provides what a badge resolves against
// (ChatRefLinks); with none around a badge is its token as plain text. The text itself is never changed: a badge only
// draws the token it stands for.

import type { OpenTarget } from "@/app/view/jarvis/address";
import { openOrPeek, type OpenGesture } from "@/app/view/jarvis/openref";
import { cn, fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { Flag, History } from "lucide-react";
import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import type { AgentsViewModel } from "./agents";
import type { AgentVM } from "./agentsviewmodel";
import { councilListAtom, loadCouncils } from "./councilstore";
import { devRosterAtom } from "./devmock";
import { selectingInto } from "./pathlinkcontext";
import { loadProjectRuns, projectRunsAtom } from "./projecthistorystore";
import { badgeLook, refTitle, resolveBareRef, resolveRef, type RefSources, type ResolvedRef } from "./refbadge";
import type { RefKind } from "./refmention";
import { loadRefEfforts, loadRefSessions, refEffortsAtom } from "./refmentionstore";
import { RuntimeMark } from "./runtimemark";
import { sessionsArchiveAtom } from "./sessionsarchivestore";

export interface RefLinksValue {
    model: AgentsViewModel;
    /** the chat's project folder (the registered project's path), "" for a chat outside one */
    project: string;
    /** the chat's own tab */
    selfId: string;
}

const RefLinks = createContext<RefLinksValue | null>(null);

export function ChatRefLinks({ value, children }: { value: RefLinksValue; children: ReactNode }) {
    return <RefLinks.Provider value={value}>{children}</RefLinks.Provider>;
}

// the tab whose Chat draws this, or null outside a Chat (a code block in another surface's markdown)
export function useChatSelfId(): string | null {
    return useContext(RefLinks)?.selfId ?? null;
}

// a bubble with ten badges asks for the project's runs or councils once, not ten times while the first read is on its way
const loadingRuns = new Set<string>();
const loadingCouncils = new Set<string>();

function loadRunsOnce(project: string): void {
    if (loadingRuns.has(project)) {
        return;
    }
    loadingRuns.add(project);
    void loadProjectRuns(project).finally(() => loadingRuns.delete(project));
}

function loadCouncilsOnce(project: string): void {
    if (loadingCouncils.has(project)) {
        return;
    }
    loadingCouncils.add(project);
    void loadCouncils(project).finally(() => loadingCouncils.delete(project));
}

// plain terminals are not agents: the picker leaves them out, so a token naming one is no agent either
function useRefAgents(roster: readonly AgentVM[], hasLinks: boolean): RefSources["agents"] {
    return useMemo(
        () =>
            hasLinks
                ? roster
                      .filter((a) => a.kind == null || a.kind === "agent" || a.kind === "background")
                      .map((a) => ({ id: a.id, name: a.name, state: a.state, agent: a.agent }))
                : [],
        [roster, hasLinks]
    );
}

/** What a bare id in an agent's code span names right now (resolveBareRef): an open agent from the roster, else a run or
 *  a council of the chat's project, read once when the id names no agent. With no ChatRefLinks around, nothing. */
export function useResolvedBareRef(id: string, enabled = true): ResolvedRef {
    const links = useContext(RefLinks);
    const project = links?.project ?? "";
    const roster = useAtomValue(devRosterAtom);
    const runs = useAtomValue(projectRunsAtom(project)).runs;
    const councils = useAtomValue(councilListAtom(project));
    const agents = useRefAgents(roster, links != null);
    const resolved = useMemo(
        () => resolveBareRef(id, { agents, runs: runs ?? [], councils: councils ?? [], project }),
        [id, agents, runs, councils, project]
    );
    const unresolved = resolved.status === "unresolved";
    const runsUnread = runs == null;
    const councilsUnread = councils == null;
    useEffect(() => {
        if (!enabled || links == null || project === "" || !unresolved) {
            return;
        }
        if (runsUnread) {
            loadRunsOnce(project);
        }
        if (councilsUnread) {
            loadCouncilsOnce(project);
        }
    }, [enabled, links, project, unresolved, runsUnread, councilsUnread]);
    return resolved;
}

/** What `kind:id` names right now: the roster live; the chat project's runs and councils, and the conversations and
 *  initiatives of any project (each read once, when a token of its kind first needs them and nothing has read them yet).
 *  With no ChatRefLinks around, nothing is known. */
export function useResolvedRef(kind: RefKind, id: string): ResolvedRef {
    const links = useContext(RefLinks);
    const project = links?.project ?? "";
    // the roster the cockpit shows (a dev fixture's when one is loaded), the one the `@` picker lists from
    const roster = useAtomValue(devRosterAtom);
    const runs = useAtomValue(projectRunsAtom(project)).runs;
    const councils = useAtomValue(councilListAtom(project));
    const sessions = useAtomValue(sessionsArchiveAtom);
    const efforts = useAtomValue(refEffortsAtom);
    const runsUnread = runs == null;
    const councilsUnread = councils == null;
    const sessionsUnread = sessions == null;
    const effortsUnread = efforts == null;
    useEffect(() => {
        // a conversation and an initiative belong to no project: they load for a chat outside one too
        if (kind === "session" && sessionsUnread) {
            loadRefSessions();
        }
        if (kind === "effort" && effortsUnread) {
            fireAndForget(loadRefEfforts);
        }
        if (project === "") {
            return;
        }
        if (kind === "run" && runsUnread) {
            loadRunsOnce(project);
        }
        if (kind === "council" && councilsUnread) {
            loadCouncilsOnce(project);
        }
    }, [kind, project, runsUnread, councilsUnread, sessionsUnread, effortsUnread]);
    const agents = useRefAgents(roster, links != null);
    return useMemo(
        () =>
            resolveRef(kind, id, {
                agents,
                runs: runs ?? [],
                councils: councils ?? [],
                project,
                sessions: sessions ?? [],
                efforts: efforts ?? [],
                now: Date.now(),
            }),
        [kind, id, agents, runs, councils, project, sessions, efforts]
    );
}

/** The badge's look: the file pill's frame, filled and bordered in the kind's colour, its mark, its name and (an agent
 *  working or asking) its state's dot. `selected` is the box's pill under the keyboard; an unresolved token is dashed.
 *  `opens` is whether a click opens what it names, which its tooltip says: the bubble's does, the box's only selects. */
export function RefBadgeFace({
    resolved,
    raw,
    selected = false,
    opens = true,
}: {
    resolved: ResolvedRef;
    raw: string;
    selected?: boolean;
    opens?: boolean;
}) {
    const look = badgeLook(resolved);
    const known = resolved.status === "resolved";
    // a conversation's age, an initiative's chunks; an unresolved token has none
    const meta = known ? resolved.meta : undefined;
    const metaDone = known && resolved.metaDone === true;
    return (
        // the file pill's frame and its lift (chateditorpill.tsx), so a badge sits in the text as a file pill does.
        // Never data-chat-pill: that is the file pill's attribute, which agent-chat counts to prove a pick drew none
        <span
            data-chat-ref={raw}
            data-ref-state={resolved.status}
            data-ref-mark={look.mark ?? ""}
            data-ref-selected={selected ? "true" : "false"}
            title={refTitle(resolved, { opens })}
            className={cn(
                "relative -top-[1.5px] mx-px inline-flex h-5 items-center gap-1 rounded-[6px] border px-1.5 align-middle text-[12.5px] leading-none text-ink-hi",
                // the meta never truncates, so a badge that has one is wider to leave the name its room
                meta ? "max-w-[260px]" : "max-w-[240px]",
                selected ? "border-accent bg-accent/12" : look.frame
            )}
        >
            {known && look.mark === "runtime" ? (
                <RuntimeMark runtime={resolved.runtime} className="size-3 shrink-0" />
            ) : null}
            {look.mark === "run" ? <span className="mx-0.5 size-[7px] shrink-0 rotate-45 bg-mark-run" /> : null}
            {look.mark === "council" ? (
                <span className="mx-px size-[7px] shrink-0 rounded-full bg-mark-council" />
            ) : null}
            {look.mark === "session" ? <History size={12} className="shrink-0 text-muted" /> : null}
            {look.mark === "effort" ? <Flag size={12} className="shrink-0 text-muted" /> : null}
            <span data-ref-name className={cn("min-w-0 truncate", !known && "font-mono text-[11.5px]")}>
                {known ? resolved.name : raw}
            </span>
            {meta ? (
                <span
                    data-ref-meta
                    className={cn("shrink-0 text-[11.5px] tabular-nums", metaDone ? "text-success" : "text-muted")}
                >
                    {meta}
                </span>
            ) : null}
            {look.dot === "working" ? (
                <span data-ref-dot="working" className="pulse-dot ml-0.5 size-1.5 shrink-0 rounded-full bg-working" />
            ) : null}
            {look.dot === "asking" ? (
                <span
                    data-ref-dot="asking"
                    className="pulse-dot ml-0.5 size-[7px] shrink-0 rounded-full border-[1.5px] border-asking"
                />
            ) : null}
        </span>
    );
}

function targetOf(resolved: Extract<ResolvedRef, { status: "resolved" }>): OpenTarget {
    if (resolved.kind === "agent") {
        return { kind: "agent", tabId: resolved.id };
    }
    if (resolved.kind === "run") {
        return { kind: "run", runId: resolved.id };
    }
    if (resolved.kind === "session") {
        return { kind: "session", sessionId: resolved.id };
    }
    if (resolved.kind === "effort") {
        return { kind: "effort", effortId: resolved.id };
    }
    return { kind: "council", councilId: resolved.id };
}

/** A reference in a sent bubble: its badge, a button that opens what it names (Ctrl-click peeks) when it resolved, else
 *  the dashed token alone. With no ChatRefLinks around, `children`, the token as text. */
export function RefBadge({
    kind,
    id,
    raw,
    children,
}: {
    kind: RefKind;
    id: string;
    raw: string;
    children?: ReactNode;
}) {
    const links = useContext(RefLinks);
    const resolved = useResolvedRef(kind, id);
    if (links == null) {
        return <>{children}</>;
    }
    if (resolved.status === "unresolved") {
        return <RefBadgeFace resolved={resolved} raw={raw} />;
    }
    return <OpenableBadge model={links.model} resolved={resolved} raw={raw} />;
}

/** A code span in an agent's reply that is an id (`4e6ea128`, `agent:4e6e…`; refbadge.ts codeRef): the badge of what it
 *  names, a button that opens it, when it names something; else `children`, the code as written (an id nothing open has,
 *  a commit's, is no reference, so it is never drawn dashed). With no ChatRefLinks around, `children`. */
export function CodeRefBadge({
    kind,
    id,
    raw,
    children,
}: {
    kind?: RefKind;
    id: string;
    raw: string;
    children?: ReactNode;
}) {
    const links = useContext(RefLinks);
    // a hook per path, both always called: a span's text never changes its kind between renders, but hooks need the order
    const named = useResolvedRef(kind ?? "agent", id);
    const bare = useResolvedBareRef(id, kind == null);
    const resolved = kind != null ? named : bare;
    if (links == null || resolved.status === "unresolved") {
        return <>{children}</>;
    }
    return <OpenableBadge model={links.model} resolved={resolved} raw={raw} />;
}

function OpenableBadge({
    model,
    resolved,
    raw,
}: {
    model: AgentsViewModel;
    resolved: Extract<ResolvedRef, { status: "resolved" }>;
    raw: string;
}) {
    const open = (e: OpenGesture) => fireAndForget(() => openOrPeek(model, targetOf(resolved), e));
    return (
        <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
                // a drag that ends on the badge selects text and also fires a click: that was selecting, not opening
                if (selectingInto(e.currentTarget)) {
                    return;
                }
                // the bubble around it must not take the click
                e.stopPropagation();
                open(e);
            }}
            onKeyDown={(e) => {
                if (e.key === "Enter") {
                    e.preventDefault();
                    e.stopPropagation();
                    open(e);
                }
            }}
            className="cursor-pointer rounded-[6px] outline-none transition-[filter] hover:brightness-125 focus-visible:ring-1 focus-visible:ring-accent"
        >
            <RefBadgeFace resolved={resolved} raw={raw} />
        </span>
    );
}
