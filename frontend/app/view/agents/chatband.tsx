// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Chat band under an agent's header (docs/superpowers/specs/2026-11-14-chat-initiative-link-design.md, and for its
// brainstorm part 2026-11-14-chat-brainstorm-status-design.md): one line of up to two parts, the initiative the agent works
// on (initiativebandview.tsx) and the brainstorm attached to it (brainstormbandview.tsx), each opening in place under the
// line, pushing the conversation down and never covering it. An agent with only one of them shows only that part; one with
// neither has no band. One part is expanded at a time (initiativebandstore.ts holds which, per agent).
//
// This file owns what the parts share: the root and its DOM contract, the width measurement (a cell may be a quarter of the
// screen), the one expanding region, focus, and the keys. The root is data-owns-keys, so the dispatcher counts focus in it
// as editable and every single-key binding stands down; its handler answers instead: Esc closes whichever part is open (and
// with none open hands the keyboard back to the message box), `i` toggles the initiative part (over an open brainstorm
// part), m / n / w / arrows / Enter belong to the initiative part, and `b` opens the Brainstorm tab, since the global `b`
// stands down in here and the part's `Open in Brainstorm (b)` hint would otherwise be dead exactly when it shows.

import { springReveal } from "@/app/element/motiontokens";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import type { AgentsViewModel } from "./agents";
import type { AgentVM } from "./agentsviewmodel";
import { setAgentView } from "./agentview";
import { BrainstormBody, BrainstormLine } from "./brainstormbandview";
import { brainstormAtom, brainstormBandAtom } from "./brainstormstore";
import { usePartMotion } from "./chatfooter";
import { focusChatBox } from "./chatinsert";
import { NARROW_BAND_PX } from "./initiativeband";
import { setBandPart, useBandPart } from "./initiativebandstore";
import { useInitiativePart } from "./initiativebandview";
import { CURSOR_RING } from "./initiativechunkmenu";
import { openInitiativeLinkPicker } from "./initiativepopover";

/** The band for `agent`, or nothing when it has neither an initiative nor a brainstorm whose file has been read. */
export function ChatBand({ model, agent }: { model: AgentsViewModel; agent: AgentVM }) {
    const bs = useAtomValue(brainstormBandAtom(agent.id));
    if (agent.effortId == null && bs == null) {
        return null;
    }
    return <ChatBandRoot model={model} agent={agent} />;
}

function ChatBandRoot({ model, agent }: { model: AgentsViewModel; agent: AgentVM }) {
    const bs = useAtomValue(brainstormBandAtom(agent.id));
    // attached, whether or not its file has been read: `b` opens the tab either way
    const attached = useAtomValue(brainstormAtom(agent.id)) != null;
    // the part the store says is expanded; what is drawn also needs the part to exist (an initiative that loaded, a
    // brainstorm whose file was read)
    const part = useBandPart(agent.id);
    const rootRef = useRef<HTMLDivElement>(null);
    const [focused, setFocused] = useState(false);
    const [narrow, setNarrow] = useState(false);

    // the band's width, not the window's: it sits in a cell that may be a quarter of the screen. A cell that is not on
    // screen has no width, and keeps what it measured.
    useLayoutEffect(() => {
        const el = rootRef.current;
        if (el == null) {
            return;
        }
        const apply = (w: number) => {
            if (w > 0) {
                setNarrow(w < NARROW_BAND_PX);
            }
        };
        apply(el.getBoundingClientRect().width);
        const ro = new ResizeObserver((entries) => apply(entries[entries.length - 1].contentRect.width));
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    const focusRoot = () => {
        const root = rootRef.current;
        if (root != null && !root.contains(document.activeElement)) {
            root.focus({ preventScroll: true });
        }
    };
    // hands the keyboard back to the message box
    const leave = () => {
        if (!focusChatBox(agent.id)) {
            (document.activeElement as HTMLElement | null)?.blur();
        }
    };
    const ini = useInitiativePart({ model, agent, part, narrow, focused, brainstormBeside: bs != null, focusRoot });

    // Opening a part takes the focus (a click, `i`, Pick a chunk…), so the keys answer at once; closing the band hands it
    // back to the message box when the band held it. Switching from one part to the other leaves it where it is. A band
    // that starts open (remembered) takes nothing, so this reads the stored part, not the one drawn: a brainstorm part
    // remembered open before its file was read must not take the focus when the file arrives.
    const wasPart = useRef(part);
    useEffect(() => {
        if (part != null && part !== wasPart.current) {
            focusRoot();
        } else if (part == null && wasPart.current != null) {
            const root = rootRef.current;
            if (root != null && root.contains(document.activeElement)) {
                leave();
            }
        }
        wasPart.current = part;
    }, [part]);

    const shownPart: "initiative" | "brainstorm" | null =
        ini.body != null ? "initiative" : part === "brainstorm" && bs != null ? "brainstorm" : null;
    const bodyMotion = usePartMotion(springReveal);

    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        // an input (rename, note) keeps its own typing, and a chord belongs to the app
        if (
            e.nativeEvent.isComposing ||
            e.ctrlKey ||
            e.metaKey ||
            e.altKey ||
            (e.target as HTMLElement).tagName === "INPUT"
        ) {
            return;
        }
        const handled = () => {
            e.preventDefault();
            e.stopPropagation();
        };
        if (ini.menuOpen) {
            ini.menuKey(e, handled);
            return;
        }
        if (e.key === "Escape") {
            handled();
            if (part != null) {
                setBandPart(agent.id, null);
            } else {
                leave();
            }
        } else if (e.key === "i") {
            handled();
            if (part === "initiative") {
                setBandPart(agent.id, null);
            } else if (ini.active && part === "brainstorm") {
                setBandPart(agent.id, "initiative");
            } else if (ini.active || !openInitiativeLinkPicker(agent.id)) {
                // a brainstorm-only band: `i` is the link picker's when this agent's own header has the chip, as outside
                // the band (agent:initiative); otherwise the key goes back to the message box
                leave();
            }
        } else if (e.key === "m" && ini.active) {
            handled();
            ini.markDone();
        } else if (e.key === "n" && ini.active) {
            handled();
            ini.startNote();
        } else if (e.key === "b" && attached) {
            handled();
            setAgentView(agent.id, "brainstorm", Date.now());
        } else if (ini.open && ini.rowKey(e, handled)) {
            return;
        } else if (e.key === "Enter" && e.target === e.currentTarget && part == null) {
            handled();
            setBandPart(agent.id, ini.active ? "initiative" : "brainstorm");
        }
    };

    const bodyNode =
        shownPart === "initiative" ? (
            ini.body
        ) : shownPart === "brainstorm" && bs != null ? (
            <BrainstormBody agent={agent} bs={bs} narrow={narrow} only={!ini.active} />
        ) : null;

    return (
        <div
            ref={rootRef}
            data-chat-band={agent.id}
            data-chat-band-open={shownPart ?? undefined}
            // the initiative band's DOM contract: the root of any band with an initiative part (the `i` binding reads it as
            // "a band with an initiative part is on screen")
            data-initiative-band={ini.active ? agent.id : undefined}
            data-band-open={ini.body != null ? "" : undefined}
            data-band-narrow={narrow ? "" : undefined}
            data-owns-keys
            tabIndex={-1}
            onKeyDown={onKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                    setFocused(false);
                }
            }}
            className="flex-none border-b border-edge-mid bg-surface outline-none"
        >
            <div
                data-chat-band-line
                className={cn("flex h-[36px] min-w-0 items-center", focused && shownPart == null && CURSOR_RING)}
            >
                {ini.line}
                {ini.active && bs != null ? <span aria-hidden className="h-[18px] w-px flex-none bg-edge-mid" /> : null}
                {bs != null ? (
                    <BrainstormLine
                        agent={agent}
                        bs={bs}
                        narrow={narrow}
                        only={!ini.active}
                        open={shownPart === "brainstorm"}
                    />
                ) : null}
            </div>
            {ini.error}
            <AnimatePresence initial={false}>
                {bodyNode != null ? (
                    <motion.div key="body" {...bodyMotion} className="overflow-hidden">
                        {bodyNode}
                    </motion.div>
                ) : null}
            </AnimatePresence>
        </div>
    );
}
