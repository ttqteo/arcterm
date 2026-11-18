// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The usage-limit strip above Chat's composer: one thin line that warns when the Claude account this agent runs on is
// near its weekly or 5-hour limit, names that account when there is more than one, offers to switch to the one with the
// most room, and can be snoozed for an hour, four hours or until tomorrow. The rules (thresholds, wording, the switch
// target, the snooze times) are chatlimitstrip.ts; this only reads the atoms and the clock and draws them.
// Switch moves the app to that account (the shared switch Settings uses, which offers the other agents a restart) and
// restarts this agent on it, even when it was already the active account.
// See docs/superpowers/specs/2026-11-18-chat-suggest-card-design.md (section 2).

import { pushToast } from "@/app/cockpit/notificationstore";
import { PopoverReveal } from "@/app/element/popoverreveal";
import { globalStore } from "@/app/store/jotaiStore";
import * as WOS from "@/app/store/wos";
import { cn, fireAndForget } from "@/util/util";
import { atom, useAtomValue, type Atom, type PrimitiveAtom } from "jotai";
import { TriangleAlert } from "lucide-react";
import { useEffect, useReducer, useRef, useState, type KeyboardEvent } from "react";
import type { AgentsViewModel } from "./agents";
import type { AgentVM } from "./agentsviewmodel";
import {
    agentAccountId,
    agentReading,
    limitStrip,
    nextSnooze,
    parseSnoozes,
    pruneSnoozes,
    stripText,
    switchTarget,
    type SnoozeChoice,
    type SnoozeMap,
} from "./chatlimitstrip";
import {
    defaultAccountName,
    launchAccountChoices,
    projectsWithOwnAccount,
    restartCandidates,
    restartOnAccount,
} from "./claudeaccount";
import { switchClaudeAccount } from "./claudeaccountswitch";
import { projectsAtom } from "./projectsstore";
import {
    activeClaudeAccountAtom,
    agentQuotaKey,
    claudeIdentityAtom,
    claudeQuotaKey,
    savedRateLimitsAtom,
    type ClaudeIdentity,
    type SavedSnapshot,
} from "./ratelimitstore";
import { agentProject } from "./runlineage";

declare global {
    interface Window {
        // DEV: a CDP scenario stands in for the identity, the saved snapshots, the active account and the project pin
        // (a dev store holds no second account); read on every tick, so a scenario can reseed it
        __chatLimitFake?: {
            identity: ClaudeIdentity;
            saved: Record<string, SavedSnapshot>;
            active: string;
            pinned?: boolean;
        };
    }
}

const SNOOZE_KEY = "arc.chatLimitSnooze";
const TICK_MS = 60_000;

function readRawSnoozes(): string | null {
    try {
        return globalThis.localStorage?.getItem(SNOOZE_KEY) ?? null;
    } catch {
        return null;
    }
}

// The snoozes, one atom for every pane so a snooze hides the strip in every agent of that account at once. localStorage
// is where they live, the atom its copy: `syncSnoozes` takes up what another window (or a cleared key) did.
let seenRaw = readRawSnoozes();
const snoozeAtom = atom<SnoozeMap>(parseSnoozes(seenRaw)) as PrimitiveAtom<SnoozeMap>;

function syncSnoozes(): void {
    const raw = readRawSnoozes();
    if (raw !== seenRaw) {
        seenRaw = raw;
        globalStore.set(snoozeAtom, parseSnoozes(raw));
    }
}

// The account `key` is snoozed until `until` (epoch ms). A lost write only shows the strip again.
function snooze(key: string, until: number): void {
    const next = { ...pruneSnoozes(globalStore.get(snoozeAtom), Date.now()), [key]: { until } };
    globalStore.set(snoozeAtom, next);
    try {
        globalThis.localStorage?.setItem(SNOOZE_KEY, JSON.stringify(next));
    } catch {
        // storage is off or full: the atom still serves this session
    }
    // what storage holds now, so the write that did not land is not read back as someone else's change
    seenRaw = readRawSnoozes();
}

const NO_BLOCK: Atom<Block | undefined> = atom(undefined as Block | undefined);

const SNOOZE_CHOICES: { id: SnoozeChoice; label: string }[] = [
    { id: "1h", label: "1 hour" },
    { id: "4h", label: "4 hours" },
    { id: "tomorrow", label: "Until tomorrow" },
];

// the small buttons at the strip's right: plain text with a faint ground on hover, a ring on keyboard focus
const BUTTON =
    "flex-none cursor-pointer rounded-[6px] px-1.5 py-0.5 text-[12px] transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default disabled:opacity-55 disabled:hover:bg-transparent motion-reduce:transition-none";
const MENU_ROW =
    "flex w-full cursor-pointer items-center rounded-[6px] px-2 py-[6px] text-left text-[13px] text-primary transition-colors hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:outline-none motion-reduce:transition-none";

// Snooze and its three choices, opening upward over the chat. Escape, a press outside and Tab out close it; while it is
// open it owns the keys, so Escape does not also leave the agent (the key dispatcher reads data-owns-keys).
function SnoozeMenu({ onPick }: { onPick: (c: SnoozeChoice) => void }) {
    const [open, setOpen] = useState(false);
    const root = useRef<HTMLDivElement>(null);
    const button = useRef<HTMLButtonElement>(null);
    useEffect(() => {
        if (!open) {
            return;
        }
        const onDown = (e: PointerEvent) => {
            if (!root.current?.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener("pointerdown", onDown, true);
        return () => document.removeEventListener("pointerdown", onDown, true);
    }, [open]);
    const choices = () => [...(root.current?.querySelectorAll<HTMLElement>("[data-chat-limit-snooze-choice]") ?? [])];
    const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
        if (!open) {
            return;
        }
        if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            setOpen(false);
            button.current?.focus();
        } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            const all = choices();
            if (all.length === 0) {
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            const at = all.indexOf(document.activeElement as HTMLElement);
            const step = e.key === "ArrowDown" ? 1 : -1;
            all[at < 0 ? (step > 0 ? 0 : all.length - 1) : (at + step + all.length) % all.length].focus();
        }
    };
    return (
        <div
            ref={root}
            data-owns-keys={open ? "" : undefined}
            onKeyDown={onKeyDown}
            onBlur={(e) => {
                if (open && e.relatedTarget != null && !root.current?.contains(e.relatedTarget as Node)) {
                    setOpen(false);
                }
            }}
            className="relative flex-none"
        >
            <button
                ref={button}
                type="button"
                data-chat-limit-snooze
                aria-haspopup="menu"
                aria-expanded={open}
                onClick={(e) => {
                    setOpen((v) => !v);
                    // opened from the keyboard (detail 0): the first choice takes focus once the menu is up
                    if (!open && e.detail === 0) {
                        requestAnimationFrame(() => choices()[0]?.focus());
                    }
                }}
                className={cn(BUTTON, "text-muted hover:text-primary", open && "bg-surface-hover text-primary")}
            >
                Snooze
            </button>
            <div className="absolute bottom-[calc(100%+8px)] right-0 z-10 w-[150px]">
                <PopoverReveal
                    open={open}
                    origin="bottom right"
                    className="rounded-[10px] border border-edge-mid frost p-[6px] shadow-popover"
                >
                    <div role="menu" aria-label="Snooze the usage warning">
                        {SNOOZE_CHOICES.map((c) => (
                            <button
                                key={c.id}
                                type="button"
                                role="menuitem"
                                tabIndex={-1}
                                data-chat-limit-snooze-choice={c.id}
                                onClick={() => {
                                    setOpen(false);
                                    onPick(c.id);
                                }}
                                className={MENU_ROW}
                            >
                                {c.label}
                            </button>
                        ))}
                    </div>
                </PopoverReveal>
            </div>
        </div>
    );
}

function errorText(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

function ClaudeLimitStrip({ model, agent }: { model: AgentsViewModel; agent: AgentVM }) {
    const realSaved = useAtomValue(savedRateLimitsAtom);
    const realIdentity = useAtomValue(claudeIdentityAtom);
    const realActive = useAtomValue(activeClaudeAccountAtom);
    const block = useAtomValue(
        agent.blockId ? WOS.getWaveObjectAtom<Block>(WOS.makeORef("block", agent.blockId)) : NO_BLOCK
    );
    const projects = useAtomValue(projectsAtom);
    const roster = useAtomValue(model.agentsAtom);
    const lineage = useAtomValue(model.lineageAtom);
    const snoozes = useAtomValue(snoozeAtom);
    const [busy, setBusy] = useState(false);
    const [, tick] = useReducer((n: number) => n + 1, 0);

    const fake = import.meta.env.DEV && typeof window !== "undefined" ? window.__chatLimitFake : undefined;
    const saved = fake?.saved ?? realSaved;
    const identity = fake?.identity ?? realIdentity;
    const active = fake?.active ?? realActive;
    const now = Date.now();

    const accountId = agentAccountId(agent.usage, block?.meta, active);
    const key = agentQuotaKey(accountId, agent.loginEmail, identity);
    const until = snoozes[key]?.until;
    const strip = limitStrip(agentReading(agent.usage, saved[key], now), until, now);

    // the time is read again each minute while the strip shows or a snooze runs, so a snooze running out or a window
    // resetting changes the line with no other event
    const needsTick = strip != null || (until != null && until > now);
    useEffect(() => {
        if (!needsTick) {
            return;
        }
        const id = setInterval(() => {
            syncSnoozes();
            tick();
        }, TICK_MS);
        return () => clearInterval(id);
    }, [needsTick]);
    // DEV: a scenario reseeds the fake or clears the snooze key from outside, so look for it more often
    useEffect(() => {
        if (!import.meta.env.DEV) {
            return;
        }
        let seen = window.__chatLimitFake;
        const id = setInterval(() => {
            const rawBefore = seenRaw;
            syncSnoozes();
            if (window.__chatLimitFake !== seen || seenRaw !== rawBefore) {
                seen = window.__chatLimitFake;
                tick();
            }
        }, 400);
        return () => clearInterval(id);
    }, []);

    if (strip == null) {
        return null;
    }

    const choices = launchAccountChoices(identity);
    const multi = choices.length > 0;
    const ownLabel = multi
        ? (choices.find((c) => c.id === accountId)?.label ?? defaultAccountName(identity.loginEmail))
        : undefined;
    // an agent in a project tied to its own account stays there: no switch
    const pinned =
        fake?.pinned ?? projectsWithOwnAccount(projects, identity.accounts).has(agentProject(lineage, roster, agent));
    const target =
        multi && !pinned
            ? switchTarget({
                  choices,
                  ownKey: key,
                  keyOf: (c) => claudeQuotaKey(c.id, identity),
                  saved,
                  window: strip.window,
                  now,
              })
            : null;
    // no session to resume (or no block) means the agent could not move with the switch
    const candidate =
        target == null
            ? undefined
            : restartCandidates(
                  roster.some((a) => a.id === agent.id) ? roster : [agent, ...roster],
                  target.id,
                  lineage
              ).find((c) => c.tabId === agent.id);

    const onSwitch = () => {
        if (target == null || candidate == null || busy) {
            return;
        }
        setBusy(true);
        fireAndForget(async () => {
            try {
                await switchClaudeAccount(target.id, {
                    agents: globalStore.get(model.agentsAtom),
                    lineage: globalStore.get(model.lineageAtom),
                    projects,
                    accounts: identity.accounts,
                    identity,
                    active,
                    exclude: agent.id,
                });
                await restartOnAccount(candidate, target.id);
            } catch (e) {
                pushToast({ title: "Could not switch account", message: errorText(e), level: "error" });
            } finally {
                setBusy(false);
            }
        });
    };

    const text = stripText(strip);
    return (
        <div
            role="status"
            data-chat-limit-strip={agent.id}
            data-chat-limit-window={strip.window}
            className="flex w-full min-w-0 items-center gap-2 px-1 pb-1.5 text-[12px] leading-[18px]"
        >
            <TriangleAlert size={13} aria-hidden className="flex-none text-warning" />
            <span className="min-w-0 flex-1 truncate" title={ownLabel != null ? `${text} · ${ownLabel}` : text}>
                <span data-chat-limit-text className="text-warning-soft">
                    {text}
                </span>
                {ownLabel != null ? (
                    <span className="text-muted">
                        {" · "}
                        <span data-chat-limit-account>{ownLabel}</span>
                    </span>
                ) : null}
            </span>
            {target != null && candidate != null ? (
                <button
                    type="button"
                    data-chat-limit-switch
                    disabled={busy}
                    onClick={onSwitch}
                    className={cn(BUTTON, "text-primary")}
                >
                    Switch to {target.label}
                </button>
            ) : null}
            <SnoozeMenu onPick={(c) => snooze(key, nextSnooze(c, Date.now()))} />
        </div>
    );
}

export function ChatLimitStrip({ model, agent }: { model: AgentsViewModel; agent: AgentVM }) {
    if ((agent.agent || "claude") !== "claude") {
        return null;
    }
    return <ClaudeLimitStrip model={model} agent={agent} />;
}
