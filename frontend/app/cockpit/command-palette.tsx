// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The universal search — Ctrl+P on every surface. One overlay with visible scopes (All, Needs you, Go to,
// Agents, Runs, Sessions, Records, Projects, Files, Commands): Tab walks them, and a typed prefix ("r:")
// or one of the old sigils narrows to one from an empty All. In All, text that names something opens it
// and text that names nothing is a goal the launch rows start. Code's own file finder folded in as the
// Files scope, preselected there.
// This is the ONE palette: a new findable kind is a new entry source here, never a second overlay or a
// second shortcut. The rules live in the pure palette-*.ts modules; this file wires sources to them.

import { launchAgent } from "@/app/cockpit/cockpit-actions";
import { ModalShell } from "@/app/modals/modalshell";
import { globalStore } from "@/app/store/jotaiStore";
import { bindingsAtom } from "@/app/store/keybindings/store";
import type { AgentsViewModel } from "@/app/view/agents/agents";
import { formatAge } from "@/app/view/agents/agentsviewmodel";
import { answerAgentAsk } from "@/app/view/agents/askanswer";
import { attentionAtom } from "@/app/view/agents/attentionstore";
import { sendChannelMessage } from "@/app/view/agents/channelactions";
import { activeChannelAtom, channelsAtom, primeChannels } from "@/app/view/agents/channelsstore";
import { openReview } from "@/app/view/agents/docreviewstore";
import { activeFocusAtom, enterFocusFor, exitFocus, focusesAtom, loadFocuses } from "@/app/view/agents/focusstore";
import type { Runtime } from "@/app/view/agents/launch";
import { openInFocusedPanel } from "@/app/view/agents/pathlinkroute";
import { channelProjectLabel } from "@/app/view/agents/projectlabel";
import { projectListAtom, projectsAtom, recentProjectsAtom, rowsWithChannel } from "@/app/view/agents/projectsstore";
import { runStatusView, type RunStatusTone } from "@/app/view/agents/runmodel";
import { openRunDag } from "@/app/view/agents/runrailsections";
import { loadSessionsArchive, sessionsArchiveAtom } from "@/app/view/agents/sessionsarchivestore";
import { themeOverridesAtom, themePresetAtom } from "@/app/view/agents/themestore";
import { recentPaths } from "@/app/view/code/codehistory";
import {
    codeHistoryAtom,
    codeIndexAtom,
    codePendingLineAtom,
    codeProjectAtom,
    loadFileIndex,
    openInCode,
    type CodeIndex,
} from "@/app/view/code/codestore";
import { buildBriefIndex, rankBriefRows, type BriefRow } from "@/app/view/jarvis/briefpalette";
import { workOnInitiative } from "@/app/view/jarvis/initiativeworkaction";
import { newRunPrefillAtom } from "@/app/view/jarvis/newruncontrol";
import { openAddress, openTarget } from "@/app/view/jarvis/openref";
import { taskListAtom } from "@/app/view/jarvis/tasksstore";
import { joinRepoPath, sameRepoPath } from "@/util/paths";
import { cn, fireAndForget } from "@/util/util";
import { atom, useAtomValue, type PrimitiveAtom } from "jotai";
import {
    ArrowUpRight,
    CircleX,
    Eye,
    Flag,
    GitFork,
    Search,
    SlidersHorizontal,
    Square,
    SquareTerminal,
    type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { THING_KINDS } from "./actions";
import {
    verbRows,
    type ActionGroup,
    type ThingAction,
    type ThingEntry,
    type ThingKindDef,
    type VerbRow,
} from "./actions/types";
import { runPaletteAction } from "./palette-action";
import { actionListGroups, verbGroupLabel, verbLeads } from "./palette-actionrows";
import {
    buildCommandItems,
    buildExtraItems,
    buildThemeItems,
    commandGroups,
    GOTO_GROUP,
    postCloseContext,
    START_BINDINGS,
    START_DEFS,
    type StartId,
} from "./palette-commands";
import { allRunsAtom, loadAllRuns, palettePickChannel } from "./palette-data";
import { loadPaletteEntities, mergeRanked, paletteEffortsAtom } from "./palette-entities";
import { assembleFileGroups, fileEcho } from "./palette-files";
import { buildFocusItems } from "./palette-focus";
import {
    ALL_KIND_ORDER,
    assembleAllGroups,
    assembleScopeGroups,
    capGroups,
    groupByKind,
    MAX_IN_ALL,
    MAX_IN_SCOPE,
    type GroupKind,
    type PaletteGroup,
} from "./palette-groups";
import { buildLaunchItems, type LaunchDeps } from "./palette-launch";
import { rankPaletteItems } from "./palette-match";
import { MAX_RECENT, nextMru, paletteMruAtom, recentItems, sortByMru } from "./palette-mru";
import {
    inlineSelections,
    NEEDS_GROUP_LABELS,
    needsGroups,
    needsRows,
    needsTarget,
    type NeedsRow,
    type NeedsTarget,
} from "./palette-needs";
import { PaletteGroupView, type PaletteItem, type StatusTone } from "./palette-rows";
import {
    backspaceEmpty,
    caretAtEnd,
    cycleScope,
    DRILL_LABELS,
    ghostHint,
    initialNav,
    leaveActions,
    openActionInput,
    openActions,
    openDrill,
    parseProjectLaunch,
    pickScope,
    placeholderFor,
    resolveChannelToken,
    scopeDef,
    SCOPES,
    typeQuery,
    type DrillId,
    type NavState,
    type ScopeId,
} from "./palette-scope";

type CommandRow = PaletteItem & { group: string };

// a thing the palette can act on: its kind's definition and its current entry
interface ActionTarget {
    def: ThingKindDef<any>;
    entry: ThingEntry<any>;
}

const ACTION_ICONS: Record<ActionGroup, LucideIcon> = { open: ArrowUpRight, steer: SlidersHorizontal, stop: Square };

function actionIcon(a: ThingAction<any>): LucideIcon {
    return a.destructive ? CircleX : ACTION_ICONS[a.group];
}

// what Enter does on an action's row: an input is written or picked first, else the label's own verb
function actionVerb(a: ThingAction<any>): string {
    if (a.input != null) {
        return a.input.kind === "text" ? "Write" : "Pick";
    }
    return a.label.split(" ", 1)[0];
}

// the input level's chip and placeholder add their own "…"
const bareLabel = (a: ThingAction<any>) => a.label.replace(/…$/, "");

const START_ICONS: Record<StartId, LucideIcon> = { run: SlidersHorizontal, agent: SquareTerminal, initiative: Flag };

// the attention kind as the one word a Needs you row's status shows
const NEEDS_STATUS: Record<string, string> = {
    ask: "asking",
    escalation: "escalated",
    gate: "gate",
    "dag-gate": "gate",
    "dag-blocked": "blocked",
    "run-land-held": "land held",
    "run-unverified": "unverified",
};

function needsIcon(row: NeedsRow): LucideIcon {
    if (row.agent == null) {
        return GitFork;
    }
    return row.review ? Eye : SquareTerminal;
}

function needsEcho(row: NeedsRow, t: NeedsTarget | null): string {
    const name = row.agent?.name ?? "";
    switch (t?.kind) {
        case "agent":
            return `Opens ${name}’s terminal at its question`;
        case "review":
            return `Opens ${name}’s review`;
        case "dag":
            return "Opens the run’s task graph";
        case "run":
            return "Opens the run in Jarvis";
        case "channel":
            return row.item.channelname ? `Opens #${row.item.channelname} in Jarvis` : "Opens its project in Jarvis";
        default:
            return "Nothing to open from here";
    }
}

// the kinds each narrowed scope lists, in the order its groups show
const SCOPE_KINDS: Partial<Record<ScopeId, GroupKind[]>> = {
    goto: ["surface"],
    agents: ["agent"],
    runs: ["run"],
    sessions: ["session"],
    records: ["record", "effort"],
    projects: ["channel"],
};

function runTone(tone: RunStatusTone): StatusTone {
    if (tone === "running") {
        return "working";
    }
    return tone === "review" || tone === "blocked" ? "asking" : "muted";
}

// A run's status is its lifecycle word unless it is executing, where the phase count says more.
function runStatusLabel(r: Run, label: string): string {
    if (r.status !== "executing" || !r.phases?.length) {
        return label;
    }
    return `${r.phases.filter((p) => p.state === "done").length}/${r.phases.length}`;
}

export function CommandPalette({ model }: { model: AgentsViewModel }) {
    const open = useAtomValue(model.paletteOpenAtom);
    const agents = useAtomValue(model.agentsAtom);
    const sessions = useAtomValue(sessionsArchiveAtom);
    const channel = useAtomValue(activeChannelAtom);
    const channels = useAtomValue(channelsAtom);
    const runs = useAtomValue(allRunsAtom);
    const attention = useAtomValue(attentionAtom);
    const recentProjects = useAtomValue(recentProjectsAtom);
    const projectRows = useAtomValue(projectListAtom);
    const projects = useAtomValue(projectsAtom);
    const spaces = useAtomValue(focusesAtom);
    const activeSpace = useAtomValue(activeFocusAtom);
    const records = useAtomValue(taskListAtom);
    const efforts = useAtomValue(paletteEffortsAtom);
    const surface = useAtomValue(model.surfaceAtom);
    const bindings = useAtomValue(bindingsAtom);
    const mru = useAtomValue(paletteMruAtom);
    const themePreset = useAtomValue(themePresetAtom);
    const codeProject = useAtomValue(codeProjectAtom);
    const codeIndex = useAtomValue(codeIndexAtom);
    const codeHistory = useAtomValue(codeHistoryAtom);
    // every thing the palette can act on, per kind; computed only while open, as its sources move often
    const thingsAtom = useMemo(
        () =>
            atom((get) =>
                get(model.paletteOpenAtom) ? THING_KINDS.map((def) => ({ def, entries: def.entries(get, model) })) : []
            ),
        [model]
    );
    const things = useAtomValue(thingsAtom);
    const [nav, setNavState] = useState<NavState>(() => initialNav(surface));
    const [sel, setSel] = useState(0);
    const [paletteError, setPaletteError] = useState<string | undefined>(undefined);
    // Files off Code: the active project's index, loaded on first use of the scope
    const [loadedFiles, setLoadedFiles] = useState<{ path: string; index?: CodeIndex; error?: string } | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const loadedRef = useRef(false);

    const close = () => globalStore.set(model.paletteOpenAtom, false);
    const setNav = (next: NavState | ((s: NavState) => NavState)) => {
        setNavState(next);
        setSel(0);
        setPaletteError(undefined);
    };
    const q = nav.query.trim();

    // Lazy-load the sessions archive on first open (the Agent sidebar and History load it on their own).
    useEffect(() => {
        if (open && !loadedRef.current) {
            loadedRef.current = true;
            fireAndForget(loadSessionsArchive);
        }
        if (open) {
            loadFocuses();
            // records / initiatives: re-read per open (as loadFocuses does) so archiving one in
            // the Jarvis surface is reflected the next time the palette is asked to find it.
            loadPaletteEntities();
            // only Jarvis loads the channel list, so a palette opened first thing elsewhere had no project to
            // start in and no runs; primeChannels, not loadChannels, which also selects a channel
            fireAndForget(primeChannels);
        }
    }, [open]);

    // every project's runs: nothing else keeps them, so the palette fans out per open once channels are in
    useEffect(() => {
        if (open && channels != null) {
            fireAndForget(() => loadAllRuns(channels));
        }
    }, [open, channels]);

    // the active project, else the one last used, else the only one
    const homeChannel = palettePickChannel(channel, projectRows, recentProjects[0] ?? null);

    // Each open starts fresh on the surface's own scope, and focuses the input after paint.
    useEffect(() => {
        if (!open) {
            return;
        }
        setNav(initialNav(globalStore.get(model.surfaceAtom)));
        setLoadedFiles((cur) => (cur?.error != null ? null : cur)); // a failed listing gets another try
        const raf = requestAnimationFrame(() => inputRef.current?.focus());
        return () => cancelAnimationFrame(raf);
    }, [open]);

    // --- Files ------------------------------------------------------------------------------------
    // On Code, the project Code has open; elsewhere, the active project — not whatever Code last had.
    const fileTarget = useMemo(() => {
        if (surface === "code" && codeProject != null) {
            return codeProject;
        }
        if (homeChannel?.projectpath) {
            return { name: channelProjectLabel(homeChannel, projects), path: homeChannel.projectpath };
        }
        return null;
    }, [surface, codeProject, homeChannel, projects]);
    const codeOwnsTarget = codeProject != null && fileTarget != null && sameRepoPath(codeProject.path, fileTarget.path);
    const needFileLoad = open && nav.scope === "files" && fileTarget != null && !(codeOwnsTarget && codeIndex != null);
    useEffect(() => {
        if (!needFileLoad || loadedFiles?.path === fileTarget.path) {
            return;
        }
        const path = fileTarget.path;
        setLoadedFiles({ path });
        loadFileIndex(path).then(
            (index) => setLoadedFiles((cur) => (cur?.path === path ? { path, index } : cur)),
            (e) => setLoadedFiles((cur) => (cur?.path === path ? { path, error: String(e) } : cur))
        );
    }, [needFileLoad, fileTarget?.path]);
    const fileIndex: CodeIndex | undefined =
        codeOwnsTarget && codeIndex != null
            ? codeIndex
            : loadedFiles != null && loadedFiles.path === fileTarget?.path
              ? loadedFiles.index
              : undefined;
    const fileError = loadedFiles?.path === fileTarget?.path ? loadedFiles?.error : undefined;

    // --- Sources ----------------------------------------------------------------------------------
    const focusItems = useMemo<PaletteItem[]>(
        () =>
            buildFocusItems(spaces, activeSpace?.ref.id ?? null, {
                focus: (s) => {
                    // a task summary carries no project, so the project filter is left alone
                    enterFocusFor(model, { ref: { kind: "task", id: s.id }, label: s.objective, project: "" });
                    close();
                },
                exit: () => {
                    exitFocus();
                    close();
                },
            }).map((fi) => ({
                key: fi.key,
                kind: "focus-task" as const,
                search: fi.subtitle ? `${fi.title} ${fi.subtitle}` : fi.title,
                title: fi.title,
                meta: fi.subtitle,
                verb: "Focus",
                echo:
                    fi.key === "focus-exit" ? "Shows everything again" : `Narrows Cockpit and History to “${fi.title}”`,
                run: fi.run,
            })),
        [spaces, activeSpace, model]
    );

    const themeItems = useMemo<PaletteItem[]>(
        () =>
            buildThemeItems(themePreset).map((t) => ({
                key: t.key,
                kind: "theme" as const,
                search: t.title,
                title: t.title,
                meta: t.current ? "current" : undefined,
                swatch: t.swatch,
                verb: "Apply",
                echo: t.current ? "Already the theme" : `Switches the theme to ${t.title}, dropping per-role overrides`,
                run: () => {
                    // matches selectPreset in settingssurface.tsx: picking a preset drops per-role overrides
                    globalStore.set(themePresetAtom, t.id);
                    globalStore.set(themeOverridesAtom, {});
                    close();
                },
            })),
        [themePreset]
    );

    // Registry-derived: the "Go to" bindings are the surfaces, everything else is a command.
    const { gotoItems, commandItems } = useMemo(() => {
        const drillMeta: Record<DrillId, string> = {
            theme: `${themeItems.length} themes ›`,
            focus: `${focusItems.length} tasks ›`,
        };
        const all = [
            ...buildCommandItems(bindings, postCloseContext(surface)),
            ...buildExtraItems({ openNewProject: () => globalStore.set(model.newProjectOpenAtom, true) }),
        ];
        const goto: PaletteItem[] = all
            .filter((c) => c.group === GOTO_GROUP)
            .map((c) => ({
                key: c.key,
                kind: "surface" as const,
                search: c.title,
                title: c.title,
                chord: c.keys,
                verb: "Go to",
                echo: `Goes to ${c.title}`,
                run: () => {
                    c.run();
                    close();
                },
            }));
        const commands: CommandRow[] = all
            .filter((c) => c.group !== GOTO_GROUP && !START_BINDINGS.has(c.key))
            .map((c) => {
                const drill = c.drill;
                return {
                    key: c.key,
                    kind: "command" as const,
                    group: c.group,
                    search: `${c.title} ${c.group}`,
                    title: c.title,
                    chord: c.keys,
                    meta: drill != null ? drillMeta[drill] : undefined,
                    verb: drill != null ? "Pick" : "Run",
                    echo: drill != null ? `Opens the ${DRILL_LABELS[drill].toLowerCase()} picker` : `Runs “${c.title}”`,
                    run:
                        drill != null
                            ? () => setNav((s) => openDrill(s, drill))
                            : () => {
                                  c.run();
                                  close();
                              },
                };
            });
        return { gotoItems: goto, commandItems: commands };
    }, [bindings, surface, model, themeItems.length, focusItems.length]);

    const startItems = useMemo<PaletteItem[]>(() => {
        const opens: Record<StartId, PrimitiveAtom<boolean>> = {
            run: model.newRunOpenAtom,
            agent: model.newAgentOpenAtom,
            initiative: model.newInitiativeOpenAtom,
        };
        return START_DEFS.map((d) => ({
            key: `start:${d.id}`,
            kind: "start" as const,
            search: d.title,
            title: d.title,
            icon: START_ICONS[d.id],
            meta: d.meta,
            chord: bindings.find((b) => b.id === d.binding && b.group === "Global")?.keys,
            verb: "Open",
            echo: d.echo,
            run: () => {
                close();
                globalStore.set(opens[d.id], true);
            },
        }));
    }, [bindings, model]);

    const agentItems = useMemo<PaletteItem[]>(
        () =>
            agents.map((a) => {
                const asking = a.state === "asking";
                return {
                    key: `agent:${a.id}`,
                    kind: "agent" as const,
                    search: `${a.name} ${a.task ?? ""} ${a.project ?? ""}`,
                    title: a.task ? `${a.name} — ${a.task}` : a.name,
                    // the one thing the dropped preview pane earned: what an asking agent wants to know
                    sub: asking ? a.ask?.questions?.[0]?.question : undefined,
                    status: { label: a.state, tone: asking ? "asking" : a.state === "working" ? "working" : "muted" },
                    verb: asking ? "Answer" : "Open",
                    echo: asking ? `Opens ${a.name}’s terminal at its question` : `Opens ${a.name}’s terminal`,
                    run: () => {
                        model.openTerminal(a.id);
                        close();
                    },
                };
            }),
        [agents, model]
    );

    // every project's runs, so each row names its project
    const runItems = useMemo<PaletteItem[]>(() => {
        const labels = new Map((channels ?? []).map((c) => [c.oid, channelProjectLabel(c, projects)]));
        return runs.map(({ channelId, run: r }) => {
            const view = runStatusView(r.status);
            const title = r.goal || "(untitled run)";
            const label = labels.get(channelId);
            return {
                key: `run:${r.id}`,
                kind: "run" as const,
                search: title,
                title,
                status: { label: runStatusLabel(r, view.label), tone: runTone(view.tone) },
                meta: label ? `#${label}` : undefined,
                verb: "Open",
                echo: "Opens the run in Jarvis",
                run: () => {
                    fireAndForget(() => openTarget(model, { kind: "run", runId: r.id }));
                    close();
                },
            };
        });
    }, [runs, channels, projects, model]);

    // --- Needs you ---------------------------------------------------------------------------------
    const needs = useMemo(() => needsRows(attention, agents), [attention, agents]);
    const needsGrouped = useMemo(() => needsGroups(needs), [needs]);
    const needsByKey = useMemo(() => new Map(needs.map((r) => [`needs:${r.item.key}`, r])), [needs]);

    // Enter's landing for a Needs you row; an item that names nowhere keeps the palette open
    const openNeeds = (t: NeedsTarget | null) => {
        switch (t?.kind) {
            case "agent":
                model.openTerminal(t.agentId);
                break;
            case "review":
                // as the Agent surface's Review binding: the agent, with its review open (a Spec or Plan
                // review's dialog, or a Doc review in the terminal's place)
                model.openTerminal(t.agentId);
                openReview(model, t.agentId);
                break;
            case "dag":
                // openRunDag reads only the dag's oid off the run's dag
                openRunDag(
                    model,
                    {
                        runId: t.runId,
                        channelId: t.channelId,
                        title: "",
                        project: "",
                        dag: { oid: t.dagId } as TaskGroup,
                    },
                    t.taskId
                );
                break;
            case "run":
                fireAndForget(() => openTarget(model, { kind: "channel", channelId: t.channelId, runId: t.runId }));
                break;
            case "channel":
                fireAndForget(() => openTarget(model, { kind: "channel", channelId: t.channelId }));
                break;
            default:
                return;
        }
        close();
    };

    // A digit answers through the Cockpit's own send; one it cannot send opens the agent at its question
    // rather than guessing.
    const answerNeeds = (row: NeedsRow, digit: number) => {
        const agentId = row.agent!.id;
        const selections = inlineSelections(row, digit - 1);
        if (selections == null || !answerAgentAsk(model, agentId, selections, {})) {
            model.openTerminal(agentId);
        }
        close();
    };

    // In the Needs you scope Enter opens a row and digits answer it. On All's empty screen typed digits are
    // query text, so an ask with options answers by first going to the scope with that ask selected.
    const needsItems = useMemo(() => {
        const order = needsGrouped.flatMap((g) => g.rows);
        const item = (row: NeedsRow): PaletteItem => {
            const a = row.agent;
            const t = needsTarget(row);
            const title = a != null ? (a.task ? `${a.name} — ${a.task}` : a.name) : row.item.text;
            const sub = a != null ? a.ask?.questions?.[0]?.question?.split("\n")[0] : row.item.source;
            const meta = row.item.channelname ? `#${row.item.channelname}` : undefined;
            return {
                key: `needs:${row.item.key}`,
                kind: "needs" as const,
                search: [title, sub, meta].filter(Boolean).join(" "),
                title,
                sub: sub || undefined,
                icon: needsIcon(row),
                status: { label: row.review ? "review" : (NEEDS_STATUS[row.item.kind] ?? "waiting"), tone: "asking" },
                meta,
                verb: row.review ? "Review" : "Open",
                echo: needsEcho(row, t),
                run: () => openNeeds(t),
            };
        };
        const inScope = order.map(item);
        const inAll = order.map((row, idx): PaletteItem => {
            const base = inScope[idx];
            if (row.options.length === 0) {
                return base;
            }
            return {
                ...base,
                verb: "Answer",
                echo: `Shows ${row.agent!.name}’s options here, so you answer without leaving`,
                run: () => {
                    // the scope lists the same rows in the same order, so the ask keeps its index
                    setNav((s) => pickScope(s, "needs"));
                    setSel(idx);
                },
                alt: { echo: `Opens ${row.agent!.name}’s terminal at the question instead`, run: base.run },
            };
        });
        return { inScope, inAll };
    }, [needsGrouped, model]);

    const sessionItems = useMemo<PaletteItem[]>(() => {
        const now = Date.now();
        return (sessions ?? [])
            .filter((s) => s.resumecommand)
            .map((s) => {
                const title = s.task || "(untitled session)";
                return {
                    key: `session:${s.runtime}:${s.id}`,
                    kind: "session" as const,
                    search: `${s.task} ${s.projectname} ${s.branch}`,
                    title,
                    meta: `${s.runtime} · ${formatAge(now - s.lastactivets)}`,
                    verb: "Resume",
                    echo: `Resumes “${title}” in a new ${s.runtime} tab`,
                    run: () => {
                        const piResume =
                            s.runtime === "pi" && s.resumeargs?.length
                                ? { startupArgs: s.resumeargs, resumePath: s.transcriptpath }
                                : {};
                        fireAndForget(() =>
                            launchAgent(model, {
                                runtime: s.runtime as Runtime,
                                startupCommand: s.resumecommand!,
                                task: "",
                                projectPath: s.projectpath,
                                projectName: s.projectname || "agent",
                                ...piResume,
                            })
                        );
                        close();
                    },
                };
            });
    }, [sessions, model]);

    // Enter switches the active project and opens it.
    const channelItems = useMemo<PaletteItem[]>(
        () =>
            rowsWithChannel(projectRows).map(({ name, channel: c }) => {
                const current = c.oid === channel?.oid;
                return {
                    key: `channel:${c.oid}`,
                    kind: "channel" as const,
                    search: `#${name} ${c.projectpath ?? ""}`,
                    title: `#${name}`,
                    meta: current ? "current" : c.projectpath?.split(/[\\/]/).pop(),
                    verb: "Switch",
                    echo: current ? "Already the active project" : `Switches to #${name}`,
                    run: () => {
                        fireAndForget(() => openTarget(model, { kind: "channel", channelId: c.oid }));
                        close();
                    },
                };
            }),
        [projectRows, channel, model]
    );

    // Records and initiatives, archived ones included. briefpalette owns the index and the ranking (it
    // sinks archived rows below every live one), so this only maps its rows onto palette rows, in its
    // order: re-ranking here would undo the archived-last guarantee. Uncapped here — capGroups caps per
    // group, the only place a cap cannot starve one kind to feed another.
    const briefIndex = useMemo(
        () => buildBriefIndex({ records: records ?? [], efforts: efforts ?? [] }),
        [records, efforts]
    );
    const briefItems = useMemo<PaletteItem[]>(() => {
        const now = Date.now();
        const open = (row: BriefRow) => {
            // an effort row's id is already an address
            fireAndForget(() => openAddress(model, row.kind === "record" ? `task:${row.id}` : row.id));
        };
        // a live initiative can also be worked on from here; an archived one is finished
        const workOn = (row: BriefRow): PaletteItem["alt"] => {
            const e = row.kind === "effort" && !row.archived ? efforts?.find((s) => s.oref === row.id) : undefined;
            if (e == null) {
                return undefined;
            }
            return {
                echo: "Works on it in a new agent, or goes to the one open on it",
                run: () => {
                    void workOnInitiative(model, e);
                    close();
                },
            };
        };
        return rankBriefRows(briefIndex, nav.query, briefIndex.length).rows.map((r) => ({
            key: r.key,
            kind: r.kind, // BriefKind is a subset of GroupKind
            search: r.search,
            title: r.title,
            meta: [r.meta, r.ts > 0 ? formatAge(now - r.ts) : ""].filter(Boolean).join(" · ") || undefined,
            archived: r.archived,
            verb: "Open",
            echo: r.kind === "record" ? "Opens the record" : "Opens the initiative",
            run: () => {
                open(r);
                close();
            },
            alt: workOn(r),
        }));
    }, [briefIndex, nav.query, model, efforts]);

    // --- Launch -----------------------------------------------------------------------------------
    // Projects scope with "<project> <goal>" targets that project; everywhere else, the home one.
    const projectLaunch = nav.scope === "projects" && nav.drill == null ? parseProjectLaunch(nav.query) : null;
    const pickedChannel = projectLaunch
        ? (resolveChannelToken(
              projectLaunch.token,
              (channels ?? []).map((c) => ({ c, name: channelProjectLabel(c, projects) }))
          )?.c ?? null)
        : null;
    const targetChannel = projectLaunch ? pickedChannel : homeChannel;
    const launchGoal = projectLaunch ? projectLaunch.goal : nav.scope === "all" ? nav.query : "";
    const targetLabel = targetChannel ? channelProjectLabel(targetChannel, projects) : "";
    // no project to guess is not a dead end: the New run window asks for one
    const launchLabel = targetLabel ? `#${targetLabel}` : "a project";
    // a "#name goal" naming no project shows that instead of offering to start somewhere else
    const unmatchedProject = projectLaunch != null && pickedChannel == null;

    const launchItems = useMemo<PaletteItem[]>(() => {
        if (launchGoal.trim() === "" || unmatchedProject) {
            return [];
        }
        const ch = targetChannel;
        const projectName = ch ? channelProjectLabel(ch, projects) : "";
        // a failure keeps the goal in the palette and says why; success lands on the result, then closes
        const fireLaunch = (action: () => Promise<unknown>, land: () => void) => {
            setPaletteError(undefined);
            void runPaletteAction(action).then((result) => {
                if ("error" in result) {
                    setPaletteError(`Launch failed: ${result.error.replace(/^Error:\s*/, "")}`);
                    return;
                }
                land();
                close();
            });
        };
        const deps: LaunchDeps = {
            // the window clears the prefill once its project list loads
            open: (goal, shape) => {
                globalStore.set(newRunPrefillAtom, { projectName, goal, shape });
                close();
                globalStore.set(model.newRunOpenAtom, true);
            },
            // only offered with a project; the user never types "ask @", the transport string is synthesized
            consult: (runtime, goal) =>
                fireLaunch(
                    () =>
                        sendChannelMessage({
                            model,
                            channelId: ch!.oid,
                            projectPath: ch!.projectpath ?? "",
                            projectName: projectName || "agent",
                            roster: agents.map((a) => ({ id: a.id, name: a.name, blockId: a.blockId })),
                            text: `ask @${runtime} ${goal}`,
                        }),
                    () => globalStore.set(model.surfaceAtom, "jarvis")
                ),
        };
        return buildLaunchItems(launchGoal, projectName || undefined, deps).map((li) => ({
            key: li.key,
            kind: "launch" as const,
            search: "",
            title: li.title,
            desc: li.desc,
            launchIcon: li.icon,
            chord: li.chord,
            verb: li.verb,
            echo: li.echo,
            run: li.run,
            alt: li.alt,
        }));
    }, [targetChannel, launchGoal, unmatchedProject, agents, model, projects]);

    // --- Actions ----------------------------------------------------------------------------------
    const targetByKey = useMemo(() => {
        const m = new Map<string, ActionTarget>();
        for (const { def, entries } of things) {
            for (const entry of entries) {
                m.set(entry.key, { def, entry });
            }
        }
        return m;
    }, [things]);
    const allVerbs = useMemo(
        () => things.flatMap(({ def, entries }) => verbRows(def, entries).map((v) => ({ def, v }))),
        [things]
    );
    // a verb row borrows its thing's meta (a run's project), so two runs with one goal stay apart
    const thingMeta = useMemo(
        () => new Map([...agentItems, ...runItems, ...sessionItems, ...channelItems].map((it) => [it.key, it.meta])),
        [agentItems, runItems, sessionItems, channelItems]
    );

    // a failure keeps the palette open on the error, as a launch does; success closes
    const runThingAction = (t: ActionTarget, action: ThingAction<any>, value?: string) => {
        setPaletteError(undefined);
        void runPaletteAction(async () => action.run(t.entry.thing, { model }, value)).then((result) => {
            if ("error" in result) {
                setPaletteError(`${bareLabel(action)} failed: ${result.error.replace(/^Error:\s*/, "")}`);
                return;
            }
            close();
        });
    };
    const drillThing = (t: ActionTarget) => ({ key: t.entry.key, title: t.entry.title, noun: t.def.noun });
    // an action that takes a value opens its input level, inside the thing's action list, first
    const startAction = (t: ActionTarget, action: ThingAction<any>) => {
        if (action.input == null) {
            runThingAction(t, action);
            return;
        }
        const inList = nav.actions?.thing.key === t.entry.key ? nav : openActions(nav, drillThing(t), selClamped);
        setNav(openActionInput(inList, { actionId: action.id, label: bareLabel(action) }));
    };
    const actionItem = (t: ActionTarget, action: ThingAction<any>, over: Partial<PaletteItem> = {}): PaletteItem => ({
        key: `act:${action.id}`,
        kind: "action",
        search: action.label,
        title: action.input?.kind === "text" ? `${bareLabel(action)}…` : action.label,
        icon: actionIcon(action),
        danger: action.destructive,
        verb: actionVerb(action),
        echo:
            action.input == null
                ? `${bareLabel(action)}: “${t.entry.title}”`
                : action.input.kind === "pick"
                  ? `Lists the choices, for “${t.entry.title}”`
                  : `Takes the text here, for “${t.entry.title}”`,
        run: () => startAction(t, action),
        ...over,
    });

    // "cancel" lists Cancel run once per cancellable run; a thing's name alone lists no verb rows
    const verbLabels = new Set(
        q === "" ? [] : [...new Set(allVerbs.map(({ v }) => v.action.label))].filter((l) => verbLeads(q, l))
    );
    const verbHits = allVerbs.filter(({ v }) => verbLabels.has(v.action.label));
    const verbByKey = new Map<string, VerbRow<any>>(verbHits.map(({ v }) => [v.key, v]));
    const verbItems: PaletteItem[] = verbHits.map(({ def, v }) =>
        actionItem({ def, entry: v.entry }, v.action, {
            key: v.key,
            search: v.search,
            title: `${v.action.label} · ${v.entry.title}`,
            meta: thingMeta.get(v.entry.key),
        })
    );

    // → on a thing's row: its action list, or the input level of the action picked there
    function actionDrillGroups(): PaletteGroup<PaletteItem>[] {
        const { thing, input } = nav.actions!;
        const t = targetByKey.get(thing.key);
        if (t == null) {
            return [{ key: "empty", label: thing.noun, items: [], emptyText: "It is no longer listed." }];
        }
        const action = input != null ? t.def.actions.find((a) => a.id === input.actionId) : undefined;
        if (action?.input?.kind === "pick") {
            const options = action.input.options(t.entry.thing).map((o) =>
                actionItem(t, action, {
                    key: `opt:${o.value}`,
                    search: o.label,
                    title: o.label,
                    icon: undefined,
                    verb: "Pick",
                    echo: `${bareLabel(action)}: ${o.label}`,
                    run: () => runThingAction(t, action, o.value),
                })
            );
            const hits = rankPaletteItems(options, nav.query);
            return [
                {
                    key: "pick",
                    label: bareLabel(action),
                    items: hits,
                    ...(hits.length === 0
                        ? { emptyText: q === "" ? "Nothing to pick." : `Nothing matches “${q}”.` }
                        : {}),
                },
            ];
        }
        if (action?.input?.kind === "text") {
            const text = nav.query;
            const submit = actionItem(t, action, {
                key: "submit",
                search: "",
                title: q === "" ? action.input.placeholder : text,
                hl: "",
                verb: "Send",
                echo: q === "" ? "Type it here, then Enter sends it" : `${bareLabel(action)}: “${q}”`,
                // an empty field has nothing to send, so Enter stays put
                run: q === "" ? () => {} : () => runThingAction(t, action, text),
            });
            return [{ key: "text", label: bareLabel(action), items: [submit] }];
        }
        const { groups: sections, notNow } = actionListGroups(t.def, t.entry, nav.query);
        const out: PaletteGroup<PaletteItem>[] = sections.map((g) => ({
            key: `act:${g.key}`,
            label: g.label,
            items: g.actions.map((a) => actionItem(t, a)),
        }));
        if (out.length === 0) {
            out.push({
                key: "empty",
                label: "Actions",
                items: [],
                emptyText: q === "" ? "Nothing applies right now." : `No actions match “${q}”.`,
            });
        }
        if (notNow != null) {
            out[out.length - 1] = { ...out[out.length - 1], note: notNow };
        }
        return out;
    }

    // --- Groups -----------------------------------------------------------------------------------
    const widenItem: PaletteItem | null =
        q === ""
            ? null
            : {
                  key: "widen",
                  kind: "widen",
                  search: "",
                  title: `Search everything for “${q}”`,
                  verb: "Search",
                  echo: `Widens to All, keeping “${q}”`,
                  run: () => setNav((s) => pickScope(s, "all")),
              };
    const narrowed = (rows: PaletteItem[], order: GroupKind[], withWiden = true, query = nav.query) => {
        const def = scopeDef(nav.scope);
        return assembleScopeGroups({
            rows,
            order,
            label: def.label,
            noun: def.noun,
            query,
            widenItem: withWiden ? widenItem : null,
        });
    };

    let groups: PaletteGroup<PaletteItem>[];
    let cap = MAX_IN_SCOPE;
    let fileHighlight: string | undefined;
    if (nav.actions != null) {
        groups = actionDrillGroups();
    } else if (nav.drill != null) {
        const rows = nav.drill === "theme" ? themeItems : focusItems;
        const hits = rankPaletteItems(rows, nav.query);
        groups = [
            {
                key: nav.drill,
                label: DRILL_LABELS[nav.drill],
                items: hits,
                ...(hits.length === 0 ? { emptyText: q === "" ? "Nothing to pick." : `Nothing matches “${q}”.` } : {}),
            },
        ];
    } else if (nav.scope === "all") {
        cap = MAX_IN_ALL;
        const pool = sortByMru(
            [
                ...gotoItems,
                ...startItems,
                ...agentItems,
                ...runItems,
                ...sessionItems,
                ...channelItems,
                ...commandItems,
                // last, so a tie with the thing's own row keeps the thing first
                ...verbItems,
            ],
            mru
        );
        // mergeRanked interleaves by score without re-ranking either side, so the brief rows keep
        // briefpalette's order (archived last) while the merged head is still the best match overall
        const ranked = mergeRanked(nav.query, rankPaletteItems(pool, nav.query), briefItems);
        const asGoalItem: PaletteItem | null =
            launchItems.length > 0
                ? {
                      key: "as-goal",
                      kind: "as-goal",
                      search: "",
                      title: `Start “${q}” as a goal`,
                      meta: launchLabel,
                      verb: "Choose",
                      echo: `Shows the ways to start “${q}”`,
                      run: () => setNav((s) => ({ ...s, asGoal: true })),
                  }
                : null;
        groups = assembleAllGroups({
            query: nav.query,
            ranked,
            recent: recentItems([...pool, ...briefItems], mru, MAX_RECENT),
            goto: gotoItems,
            launch: launchItems,
            asGoalItem,
            asGoal: nav.asGoal,
            projectLabel: launchLabel,
            needs: needsItems.inAll,
            start: startItems,
        });
    } else if (nav.scope === "needs") {
        // server order within each group, filtered rather than re-ranked: what waited longest stays first
        const hits = new Set(rankPaletteItems(needsItems.inScope, nav.query).map((it) => it.key));
        const byKey = new Map(needsItems.inScope.map((it) => [it.key, it]));
        groups = needsGrouped
            .map((g) => {
                const items = g.rows.map((r) => byKey.get(`needs:${r.item.key}`)!).filter((it) => hits.has(it.key));
                return {
                    key: `needs:${g.group}`,
                    label: `${NEEDS_GROUP_LABELS[g.group]} · ${items.length}`,
                    asking: g.group === "asks",
                    items,
                };
            })
            .filter((g) => g.items.length > 0);
        if (groups.length === 0) {
            groups = narrowed([], ["needs"]);
        }
    } else if (nav.scope === "commands") {
        if (q === "") {
            groups = [{ key: "start", label: "Start", items: startItems }, ...commandGroups(commandItems, surface)];
        } else {
            const hits = rankPaletteItems([...startItems, ...verbItems, ...commandItems], nav.query);
            groups =
                hits.length > 0
                    ? groupByKind(hits, ["start", "action", "command"]).map((g) =>
                          g.key === "action"
                              ? { ...g, label: verbGroupLabel(g.items.map((it) => verbByKey.get(it.key)!)) }
                              : g
                      )
                    : narrowed([], ["command"]);
        }
    } else if (nav.scope === "projects" && projectLaunch != null) {
        groups =
            launchItems.length > 0
                ? [{ key: "launch", label: `Start in #${targetLabel}`, rich: true, items: launchItems }]
                : [
                      {
                          key: "empty",
                          label: "Projects",
                          items: [],
                          emptyText: `No project matches “${projectLaunch.token}”.`,
                      },
                  ];
    } else if (nav.scope === "files") {
        ({ groups, fileHighlight } = fileScopeGroups());
    } else if (nav.scope === "records") {
        groups = narrowed(briefItems, SCOPE_KINDS.records);
    } else {
        const pools: Partial<Record<ScopeId, PaletteItem[]>> = {
            goto: gotoItems,
            agents: agentItems,
            runs: runItems,
            sessions: sessionItems,
            projects: channelItems,
        };
        groups = narrowed(rankPaletteItems(pools[nav.scope] ?? [], nav.query), SCOPE_KINDS[nav.scope] ?? []);
    }

    function fileScopeGroups(): { groups: PaletteGroup<PaletteItem>[]; fileHighlight?: string } {
        const empty = (emptyText: string) => [{ key: "empty", label: "Files", items: [], emptyText }];
        if (fileTarget == null) {
            return { groups: empty("No project to search. Pick one on Code or in the cockpit.") };
        }
        const label = `#${fileTarget.name}`;
        if (fileError != null) {
            return { groups: empty(`Couldn’t list files in ${label}: ${fileError}`) };
        }
        if (fileIndex == null) {
            return { groups: empty(`Loading files in ${label}…`) };
        }
        if (!fileIndex.isRepo) {
            return { groups: empty(`${label} isn’t a git repository, so there is no file list.`) };
        }
        const recent = codeOwnsTarget ? recentPaths(codeHistory) : [];
        const fg = assembleFileGroups(nav.query, fileIndex.paths, recent, label, MAX_IN_SCOPE);
        const rows: PaletteGroup<PaletteItem>[] = fg.groups.map((g) => ({
            key: g.key,
            label: g.label,
            items: g.items.map((f) => ({
                key: `file:${f.path}`,
                kind: "file" as const,
                search: "",
                title: f.base,
                meta: [f.dir, fg.line != null ? `:${fg.line}` : ""].filter(Boolean).join("  ") || undefined,
                verb: "Open",
                echo: fileEcho(f, fg.line),
                run: () => {
                    close();
                    // on the Agent surface, a file under the focused agent's directory opens in its panel
                    if (openInFocusedPanel(model, joinRepoPath(fileTarget.path, f.path), fg.line)) {
                        return;
                    }
                    fireAndForget(() =>
                        openInCode(model, { projectPath: fileTarget.path, rel: f.path, line: fg.line })
                    );
                },
            })),
        }));
        // a bare ":152" on Code names no file, so it means "that line of the file already open"
        if (surface === "code" && fg.text === "" && fg.line != null) {
            const line = fg.line;
            rows.unshift({
                key: "line",
                label: "Open file",
                items: [
                    {
                        key: "line",
                        kind: "line",
                        search: "",
                        title: `Line ${line} of the open file`,
                        verb: "Go to",
                        echo: `Moves the open file to line ${line}`,
                        run: () => {
                            close();
                            globalStore.set(codePendingLineAtom, line);
                        },
                    },
                ],
            });
        }
        if (rows.length === 0) {
            // quote the path part: "readme:3" found no file named readme, not no file named "readme:3"
            return { groups: narrowed([], ["file"], false, fg.text) };
        }
        return { groups: rows, fileHighlight: fg.text };
    }

    // a thing's row says how many of its actions apply now; → opens them
    const withActions = (it: PaletteItem): PaletteItem => {
        const t = nav.actions == null ? targetByKey.get(it.key) : undefined;
        const n = t == null ? 0 : t.def.actions.filter((a) => a.applies(t.entry.thing)).length;
        return n > 0 ? { ...it, actions: n } : it;
    };
    const capped = capGroups(groups, cap).map((g) => ({ ...g, items: g.items.map(withActions) }));
    const flat = capped.flatMap((g) => g.items);
    const selClamped = flat.length === 0 ? 0 : Math.min(sel, flat.length - 1);
    const indexOf = new Map(flat.map((it, i) => [it.key, i]));
    const selected = flat[selClamped];

    // The selected Needs you ask shows its options under it. They join the rows only after the selection is
    // resolved and never the selection order, so showing them cannot move what ↑↓ lands on.
    const answering =
        nav.scope === "needs" && nav.actions == null && selected?.kind === "needs"
            ? needsByKey.get(selected.key)
            : undefined;
    const answerRows: PaletteItem[] = (answering?.options ?? []).map((label, i) => ({
        key: `answer:${answering!.item.key}:${i + 1}`,
        kind: "answer" as const,
        search: "",
        title: label,
        digit: i + 1,
        verb: "Answer",
        echo: `Answers ${answering!.agent!.name}: “${label}”`,
        run: () => answerNeeds(answering!, i + 1),
    }));
    const shown =
        answerRows.length === 0
            ? capped
            : capped.map((g) => {
                  const at = g.items.findIndex((it) => it.key === selected.key);
                  return at < 0
                      ? g
                      : { ...g, items: [...g.items.slice(0, at + 1), ...answerRows, ...g.items.slice(at + 1)] };
              });
    const footerExtra: { k: string; text: string }[] = [
        ...(selected?.alt != null ? [{ k: "ctrl ⏎", text: selected.alt.echo }] : []),
        ...(answerRows.length > 0
            ? [
                  {
                      k: answerRows.length === 1 ? "1" : `1–${answerRows.length}`,
                      text: `Answers ${answering!.agent!.name} here`,
                  },
              ]
            : []),
        ...(selected?.actions ? [{ k: "→", text: `Its ${selected.actions} actions` }] : []),
    ];

    // Arrow-keying past the visible rows used to move the selection out of view — the scroll container
    // was never told to follow it.
    // The first row goes to the very top, or a group header above it stays scrolled out of view (the
    // launch block's "Start in" line, after "as a goal" expands from the bottom of the list).
    useEffect(() => {
        if (selClamped === 0) {
            listRef.current?.scrollTo({ top: 0 });
            return;
        }
        listRef.current?.querySelector(`[data-idx="${selClamped}"]`)?.scrollIntoView({ block: "nearest" });
    }, [selClamped, capped.length, nav.asGoal, nav.scope, nav.drill, nav.actions]);

    // Only rows All can list are recorded: the launch, goal, widen and file rows are not things to
    // float back up under Recent (files have Code's own history), and neither are actions, so a Cancel
    // run never waits on the empty screen.
    const fire = (it: PaletteItem | undefined) => {
        if (it == null) {
            return;
        }
        if (ALL_KIND_ORDER.includes(it.kind) && it.kind !== "action") {
            globalStore.set(paletteMruAtom, (prev) => nextMru(prev, it.key));
        }
        it.run();
        // a row that keeps the palette open (as a goal, widen, a drill) hands the keyboard back to the
        // field; one that closed it must not pull focus into the exiting modal
        if (globalStore.get(model.paletteOpenAtom)) {
            inputRef.current?.focus();
        }
    };

    const openRowActions = (idx: number) => {
        const t = targetByKey.get(flat[idx]?.key);
        if (t != null) {
            setNav(openActions(nav, drillThing(t), idx));
        }
    };
    // back one level: an action's input to its thing's list, the list to the results it came from
    const leaveLevel = () => {
        if (nav.actions?.input != null) {
            setNav({ ...nav, query: "", actions: { ...nav.actions, input: null } });
            return;
        }
        const back = leaveActions(nav);
        if (back != null) {
            setNav(back.nav);
            setSel(back.sel);
        }
    };

    const onKeyDown = (e: React.KeyboardEvent) => {
        // a digit past the ask's options is query text, as in any other scope
        const digit = /^[1-9]$/.test(e.key) && !e.ctrlKey && !e.altKey && !e.metaKey ? Number(e.key) : 0;
        const bare = !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey;
        if (digit > 0 && digit <= answerRows.length) {
            e.preventDefault();
            fire(answerRows[digit - 1]);
        } else if (e.key === "ArrowDown") {
            e.preventDefault();
            setSel((s) => (flat.length ? (Math.min(s, flat.length - 1) + 1) % flat.length : 0));
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setSel((s) => (flat.length ? (Math.min(s, flat.length - 1) - 1 + flat.length) % flat.length : 0));
        } else if (e.key === "Enter") {
            e.preventDefault();
            if (e.ctrlKey && selected?.alt != null) {
                const alt = selected.alt;
                fire({ ...selected, run: alt.run });
            } else {
                fire(selected);
            }
        } else if (e.key === "Tab") {
            e.preventDefault();
            setNav(cycleScope(nav, e.shiftKey ? -1 : 1));
        } else if (e.key === "ArrowRight") {
            // mid-query, → moves the caret as it always has
            const caret = inputRef.current?.selectionStart ?? null;
            if (bare && nav.actions == null && selected?.actions && caretAtEnd(nav.query, caret)) {
                e.preventDefault();
                openRowActions(selClamped);
            }
        } else if (e.key === "ArrowLeft") {
            if (bare && nav.actions != null && nav.query === "") {
                e.preventDefault();
                leaveLevel();
            }
        } else if (e.key === "Backspace") {
            if (nav.actions != null && nav.query === "") {
                e.preventDefault();
                leaveLevel();
                return;
            }
            const next = backspaceEmpty(nav);
            if (next != null) {
                e.preventDefault();
                setNav(next);
            }
        }
    };

    const atTop = nav.drill == null && nav.actions == null;
    const placeholder =
        atTop && nav.scope === "files" && fileTarget != null
            ? `Open a file in #${fileTarget.name}, path:line jumps…`
            : placeholderFor(nav);
    // a narrowed scope names itself in the box; in All, a lone letter that starts a prefix says where it leads
    const token = atTop && nav.scope !== "all" ? scopeDef(nav.scope).label : null;
    const ghost = atTop && nav.scope === "all" ? ghostHint(nav.query) : null;

    return (
        <ModalShell open={open} onClose={close} className="flex h-[min(600px,80vh)] w-[min(820px,93vw)] flex-col">
            {open ? (
                <>
                    <div className="flex shrink-0 items-center gap-2.5 px-4 pb-[7px] pt-[13px]">
                        <Search size={15} strokeWidth={2} className="shrink-0 text-muted" />
                        {token != null ? (
                            <span
                                data-palette-token
                                className="shrink-0 rounded-[5px] bg-accentbg px-[7px] py-px text-[12px] font-medium text-accent-soft"
                            >
                                {token}
                            </span>
                        ) : null}
                        {nav.drill != null ? (
                            <button
                                type="button"
                                aria-label="Back to all commands"
                                onClick={() => {
                                    setNav((s) => ({ ...s, drill: null, query: "" }));
                                    inputRef.current?.focus();
                                }}
                                className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-edge-mid bg-surface-raised px-2 py-0.5 text-[12px] text-secondary"
                            >
                                <span className="text-muted">Commands</span>
                                <span className="text-muted">›</span>
                                <span>{DRILL_LABELS[nav.drill]}</span>
                            </button>
                        ) : null}
                        {nav.actions != null ? (
                            <button
                                type="button"
                                data-palette-drill
                                aria-label="Back to results"
                                onClick={() => {
                                    leaveLevel();
                                    inputRef.current?.focus();
                                }}
                                className="flex min-w-0 max-w-[55%] shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-edge-mid bg-surface-raised px-2 py-0.5 text-[12px] text-secondary"
                            >
                                <span className="shrink-0 text-muted">{nav.actions.thing.noun}</span>
                                <span className="shrink-0 text-muted">›</span>
                                <span className="truncate">{nav.actions.thing.title}</span>
                                {nav.actions.input != null ? (
                                    <>
                                        <span className="shrink-0 text-muted">›</span>
                                        <span className="shrink-0">{nav.actions.input.label}</span>
                                    </>
                                ) : null}
                            </button>
                        ) : null}
                        <div className="relative min-w-0 flex-1">
                            <input
                                ref={inputRef}
                                data-palette-input
                                aria-label="Search"
                                value={nav.query}
                                onChange={(e) => setNav(typeQuery(nav, e.target.value))}
                                onKeyDown={onKeyDown}
                                placeholder={placeholder}
                                autoComplete="off"
                                spellCheck={false}
                                className="w-full bg-transparent text-[14px] text-primary outline-none placeholder:text-muted"
                            />
                            {ghost != null ? (
                                // the typed text, invisible, holds the ghost just past the caret
                                <div
                                    aria-hidden
                                    className="pointer-events-none absolute inset-0 flex items-center overflow-hidden whitespace-pre text-[14px]"
                                >
                                    <span className="invisible">{nav.query}</span>
                                    <span className="text-muted">{ghost}</span>
                                </div>
                            ) : null}
                        </div>
                        <span className="shrink-0 rounded-[5px] border border-edge-mid px-[7px] py-0.5 font-mono text-[10.5px] text-muted">
                            esc
                        </span>
                    </div>
                    <div
                        role="group"
                        aria-label="Scope"
                        className="flex shrink-0 items-stretch gap-1 border-b border-border px-2.5"
                    >
                        {SCOPES.map((s) => {
                            const on = s.id === nav.scope;
                            const count = s.id === "needs" ? needs.length : 0;
                            return (
                                <button
                                    key={s.id}
                                    type="button"
                                    aria-pressed={on}
                                    data-palette-scope={s.id}
                                    tabIndex={-1}
                                    onClick={() => {
                                        setNav(pickScope(nav, s.id));
                                        inputRef.current?.focus();
                                    }}
                                    className={cn(
                                        "flex cursor-pointer items-center gap-1.5 px-[7px] pb-[9px] pt-2 text-[12.5px] font-medium",
                                        on
                                            ? "text-primary shadow-[inset_0_-2px_0_var(--color-accent)]"
                                            : "text-muted hover:text-secondary"
                                    )}
                                >
                                    <span>{s.label}</span>
                                    {count > 0 ? (
                                        <span className="text-[10.5px] font-bold tabular-nums text-asking">{count}</span>
                                    ) : null}
                                </button>
                            );
                        })}
                    </div>
                    {paletteError ? (
                        <div
                            role="alert"
                            className="shrink-0 border-b border-error/30 bg-error/10 px-4 py-2 text-[12px] text-error-soft"
                        >
                            {paletteError}
                        </div>
                    ) : null}
                    <div
                        ref={listRef}
                        role="listbox"
                        aria-label="Results"
                        className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2 pt-1"
                    >
                        {capped.length === 0 ? (
                            <div className="px-4 py-8 text-center text-[13px] text-muted">
                                {q === ""
                                    ? "Nothing here yet."
                                    : `Nothing matches “${q}”, and no project to start it in.`}
                            </div>
                        ) : (
                            shown.map((g) => (
                                <PaletteGroupView
                                    key={g.key}
                                    group={g}
                                    indexOf={indexOf}
                                    selected={selClamped}
                                    query={fileHighlight ?? nav.query}
                                    onHover={setSel}
                                    onFire={fire}
                                    onActions={(idx) => {
                                        openRowActions(idx);
                                        inputRef.current?.focus();
                                    }}
                                />
                            ))
                        )}
                        {nav.scope === "files" && fileIndex?.truncated ? (
                            <div className="px-2.5 pt-2 text-[10.5px] text-muted">
                                Index truncated: searching the first 20,000 files only.
                            </div>
                        ) : null}
                    </div>
                    <div className="flex shrink-0 flex-col gap-1 border-t border-border px-4 py-[9px]">
                        <div className="flex items-center gap-3">
                            {/* widened only to line up with a key line below it */}
                            <span
                                className={cn(
                                    "shrink-0 font-mono text-[11px] text-accent-soft",
                                    footerExtra.length > 0 && "w-[60px]"
                                )}
                            >
                                ⏎
                            </span>
                            <span className="min-w-0 flex-1 truncate text-[12px] text-secondary">
                                {selected?.echo ?? "Nothing to run"}
                            </span>
                            <span className="flex shrink-0 items-center gap-3 text-[10.5px] text-muted">
                                <span>↑↓ move</span>
                                <span>{nav.actions != null ? "← back" : "Tab scope"}</span>
                                <span>esc close</span>
                            </span>
                        </div>
                        {footerExtra.map((f) => (
                            <div key={f.k} className="flex items-center gap-3">
                                <span className="w-[60px] shrink-0 font-mono text-[11px] text-accent-soft">{f.k}</span>
                                <span className="min-w-0 flex-1 truncate text-[12px] text-secondary">{f.text}</span>
                            </div>
                        ))}
                    </div>
                </>
            ) : null}
        </ModalShell>
    );
}
