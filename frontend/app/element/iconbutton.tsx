// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useLongClick } from "@/app/hook/useLongClick";
import { cn, makeIconClass } from "@/util/util";
import { atom, useAtom } from "jotai";
import { CSSProperties, forwardRef, memo, useMemo, useRef } from "react";

type IconButtonProps = { decl: IconButtonDecl; className?: string };
export const IconButton = memo(
    forwardRef<HTMLButtonElement, IconButtonProps>(({ decl, className }, ref) => {
        ref = ref ?? useRef<HTMLButtonElement>(null);
        const spin = decl.iconSpin ?? false;
        useLongClick(ref, decl.click, decl.longClick, decl.disabled);
        const disabled = decl.disabled ?? false;
        const styleVal: CSSProperties = {};
        if (decl.iconColor) {
            styleVal.color = decl.iconColor;
        }
        return (
            <button
                ref={ref}
                className={cn(
                    "flex cursor-pointer items-center border-none opacity-70 [outline:inherit] hover:opacity-100 *:pointer-events-none",
                    (disabled || decl.noAction) && "cursor-default",
                    disabled && "!opacity-45",
                    className,
                    decl.className
                )}
                title={decl.title}
                aria-label={decl.title}
                style={styleVal}
                disabled={disabled}
            >
                {typeof decl.icon === "string" ? <i className={makeIconClass(decl.icon, true, { spin })} /> : decl.icon}
            </button>
        );
    })
);

type ToggleIconButtonProps = { decl: ToggleIconButtonDecl; className?: string };

// the terminal search's case / whole-word / regex switches
export const ToggleIconButton = memo(
    forwardRef<HTMLButtonElement, ToggleIconButtonProps>(({ decl, className }, ref) => {
        const activeAtom = useMemo(() => decl.active ?? atom(false), [decl.active]);
        const [active, setActive] = useAtom(activeAtom);
        ref = ref ?? useRef<HTMLButtonElement>(null);
        const spin = decl.iconSpin ?? false;
        const title = `${decl.title}${active ? " (Active)" : ""}`;
        const disabled = decl.disabled ?? false;
        return (
            <button
                ref={ref}
                className={cn(
                    "flex cursor-pointer items-center rounded-[3px] border-none p-px opacity-70 [outline:inherit] hover:bg-hoverbg hover:opacity-100 *:pointer-events-none",
                    active && "border border-solid border-accent p-0 opacity-100",
                    (disabled || decl.noAction) && "cursor-default",
                    disabled && "!opacity-45",
                    className,
                    decl.className
                )}
                title={title}
                aria-label={title}
                style={{ color: decl.iconColor ?? "inherit" }}
                onClick={() => setActive(!active)}
                disabled={disabled}
            >
                {typeof decl.icon === "string" ? <i className={makeIconClass(decl.icon, true, { spin })} /> : decl.icon}
            </button>
        );
    })
);
