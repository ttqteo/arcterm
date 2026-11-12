// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Tab in Chat's bash mode (a text that starts with `!`): completes the word under the caret as the shell would, the way
// Claude Code's TUI does (chatbash.ts `bashWordAt` says what kind of word it is: a command, a `$variable` or a file; wavesrv
// asks the shell's `compgen` in the agent's folder, `ShellCompleteCommand`). One answer is put in the text at once, as a
// shell does; several open a list over the box (a PickerList, as the `/` menu), where ↑↓ move, Tab or Enter pick, Esc
// closes, and any other key closes it so the next Tab asks again with the word as it is by then. Each Tab starts a shell
// (50 to 150 ms on Windows), so it is asked on Tab only, never per keystroke.

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { applyCompletion, bashWordAt, type BashWord, type BashWordKind } from "./chatbash";
import type { EditorLike, KeyLike } from "./chateditor";
import { PickerList, type PickerGroup } from "./pickerlist";

export interface BashCompleteState {
    // the list over the box (it draws nothing while no list shows)
    list: ReactNode;
    // the list is on screen
    shown: boolean;
    onKeyDown: (e: KeyLike) => void;
    onCaret: (el: EditorLike) => void;
    // the box lost the focus: the list closes unless the focus moved into the list itself
    onBlur: (e: { readonly relatedTarget: EventTarget | null }) => void;
}

const GROUP_TITLE: Record<BashWordKind, string> = { command: "Commands", variable: "Variables", file: "Files" };

const NO_ITEMS: string[] = [];

// a key that is only a modifier being pressed is no edit: Shift on the way to a capital must not close the list
const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta", "AltGraph", "CapsLock"]);

// what a Tab asked for and was answered, while the list is on screen: the text and the caret it was asked at, so a text or
// a caret that has moved since closes it
interface Offer {
    text: string;
    caret: number;
    word: BashWord;
    items: string[];
}

// A row of the list: a file's folder part (up to its last `/`, not counting the one that ends a folder's name) is muted, so
// the name reads first; a variable's `$` is muted as its folder part is
function BashRow({ item, kind }: { item: string; kind: BashWordKind }) {
    let dir = "";
    let name = item;
    if (kind === "file") {
        const slash = (item.endsWith("/") ? item.slice(0, -1) : item).lastIndexOf("/");
        dir = item.slice(0, slash + 1);
        name = item.slice(slash + 1);
    } else if (kind === "variable") {
        dir = "$";
    }
    return (
        <span className="min-w-0 truncate font-mono text-[13px] text-ink-hi">
            {dir !== "" ? <span className="text-muted">{dir}</span> : null}
            {name}
        </span>
    );
}

// The list's anchor: the editor's handle, answering with the rect of the whole box (its caption and well too), so the list
// stands over the box as the board draws it and as wide, not over the editor inside it (which would cover the caption)
function overBox(editor: EditorLike, box: HTMLElement): EditorLike {
    return Object.create(editor, {
        getBoundingClientRect: { value: () => box.getBoundingClientRect() },
        contextElement: { value: box },
    });
}

// `on` is whether the box is in bash mode; `cwd` is where the agent works ("" or undefined when it has no folder, which
// leaves Tab doing nothing). `setText` takes the caret a pick puts the text's caret at, for a box that draws the text again
// (the chat editor places it as it does). `boxRef` is the whole message box, which the list opens over; without it the list
// opens over the editor. Tab is the hook's when the caret ends a word; a Tab it does not take (no word at the caret) goes
// on to the caller.
export function useBashComplete({
    text,
    setText,
    cwd,
    inputRef,
    boxRef,
    on,
}: {
    text: string;
    setText: (text: string, caret?: number) => void;
    cwd: string | undefined;
    inputRef: RefObject<EditorLike | null>;
    boxRef?: RefObject<HTMLElement | null>;
    on: boolean;
}): BashCompleteState {
    const [offer, setOffer] = useState<Offer | null>(null);
    const [pick, setPick] = useState(0);
    // counts the asks and what cancels one (a key, a click, another Tab): an answer that comes back after any of them is
    // for a word that is gone
    const seq = useRef(0);
    const now = useRef({ text, on, setText });
    now.current = { text, on, setText };

    // the offer while its list is on screen: it is for the text it was asked at
    const live = on && offer != null && offer.text === text ? offer : null;
    // a list left over a text that has changed is stale for good, even if the same text is typed again
    useEffect(() => {
        if (live == null && offer != null) {
            setOffer(null);
        }
    }, [live, offer]);
    const items = live?.items ?? NO_ITEMS;
    const at = Math.min(pick, Math.max(items.length - 1, 0));

    const close = () => {
        seq.current++;
        setOffer(null);
        setPick(0);
    };
    const apply = (base: string, word: BashWord, item: string) => {
        const next = applyCompletion(base, word, item);
        seq.current++;
        now.current.setText(next.text, next.caret);
        setOffer(null);
        setPick(0);
        requestAnimationFrame(() => {
            inputRef.current?.focus();
            inputRef.current?.setSelectionRange(next.caret, next.caret);
        });
    };

    const ask = (word: BashWord, base: string, caret: number, folder: string) => {
        const mine = ++seq.current;
        RpcApi.ShellCompleteCommand(TabRpcClient, { cwd: folder, kind: word.kind, word: word.word })
            .catch((err) => {
                // no bash, a folder that is gone or a read that timed out is no completion, not an error to show
                console.warn("chat bash: completing failed", err);
                return [] as string[];
            })
            .then((found) => {
                const list = found ?? [];
                if (seq.current !== mine || !now.current.on || now.current.text !== base || list.length === 0) {
                    return;
                }
                if (list.length === 1) {
                    apply(base, word, list[0]);
                    return;
                }
                setOffer({ text: base, caret, word, items: list });
                setPick(0);
            });
    };

    const onKeyDown = (e: KeyLike) => {
        if (!on || e.nativeEvent.isComposing || MODIFIER_KEYS.has(e.key)) {
            return;
        }
        const plain = !e.metaKey && !e.ctrlKey && !e.altKey;
        if (live != null) {
            if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                close();
                return;
            }
            if (plain && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
                e.preventDefault();
                e.stopPropagation();
                const n = items.length;
                setPick((at + (e.key === "ArrowDown" ? 1 : n - 1)) % n);
                return;
            }
            if (plain && !e.shiftKey && (e.key === "Tab" || e.key === "Enter")) {
                e.preventDefault();
                e.stopPropagation();
                apply(live.text, live.word, live.items[at]);
                return;
            }
            // any other key: the list closes, and the key goes on to do what it does
            close();
        }
        if (e.key !== "Tab" || !plain || e.shiftKey) {
            // a key in flight for an earlier Tab makes its answer stale (the word has moved on)
            seq.current++;
            return;
        }
        const field = e.currentTarget;
        if (field.readOnly || field.selectionStart !== field.selectionEnd) {
            return;
        }
        const word = bashWordAt(text, field.selectionStart);
        if (word == null) {
            return;
        }
        e.preventDefault();
        e.stopPropagation();
        if (!cwd) {
            return;
        }
        ask(word, text, field.selectionStart, cwd);
    };

    // a click that moves the caret off the word the list was asked for closes it; so does a text that changed some other way
    const onCaret = (el: EditorLike) => {
        if (offer != null && (el.value !== offer.text || el.selectionStart !== offer.caret)) {
            close();
        }
    };

    // a click outside the box (the list is not clicked away by anything else) closes the list; so does the window losing the
    // focus. A click on a row keeps the focus in the box (PickerList), so it never gets here; the focus moving into the list
    // is the one move that keeps it open. A Tab still asking is cancelled too: its answer must not put the text in, and the
    // focus back in the box, after the reader has gone elsewhere.
    const onBlur = (e: { readonly relatedTarget: EventTarget | null }) => {
        const to = e.relatedTarget;
        if (to instanceof Element && to.closest("[data-chat-bash-list]") != null) {
            return;
        }
        close();
    };

    const anchor = useRef<EditorLike | null>(null);
    const editor = inputRef.current;
    const box = boxRef?.current;
    if (live != null && editor != null) {
        anchor.current = box != null ? overBox(editor, box) : editor;
    }
    const kind: BashWordKind = live?.word.kind ?? "file";
    const groups: PickerGroup[] = [{ title: GROUP_TITLE[kind], count: items.length, start: 0 }];
    const list = (
        <PickerList<string>
            anchor={anchor}
            shown={live != null}
            note={null}
            items={items}
            at={at}
            onPick={(item) => {
                if (live != null) {
                    apply(live.text, live.word, item);
                }
            }}
            onHover={setPick}
            label={GROUP_TITLE[kind]}
            listAttr="data-chat-bash-list"
            itemAttr="data-chat-bash-item"
            // above the box, as the `@` picker's list: the box sits at the foot of the chat, where a list that flips with
            // the room left would jump as the word changes
            side="above"
            itemKey={(item) => item}
            itemTitle={(item) => item}
            groups={groups}
            footer={
                <div className="flex shrink-0 gap-3.5 whitespace-nowrap border-t border-edge-faint px-3.5 py-[7px] text-[11.5px] text-ink-faint">
                    <span>
                        <span className="font-mono text-muted">↑↓</span> move
                    </span>
                    <span>
                        <span className="font-mono text-muted">Tab</span> complete
                    </span>
                    <span>
                        <span className="font-mono text-muted">Esc</span> close
                    </span>
                    <span className="flex-1" />
                    <span className="min-w-0 truncate" title={cwd}>
                        in {cwd ?? ""}
                    </span>
                </div>
            }
            renderItem={(item) => <BashRow item={item} kind={kind} />}
        />
    );
    return { list, shown: live != null, onKeyDown, onCaret, onBlur };
}
