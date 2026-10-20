// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The app surface (spec 2026-10-20-rail-apps-design.md): a service pinned to the nav rail, with its page filling the
// surface under the Agent header's own buttons. The page is not drawn here: AppSlotView leaves the slot and AppFrames
// in the shell moves the one frame over it, so the page Agent showed stays loaded. What it shows is railapps.ts's
// (appSurfaceBody, appCard); the services' state is wavesrv's. This reports nothing to wavesrv's seen set: AgentSurface,
// always mounted, already counts this surface's service as on screen (serviceseen.ts), and a second reporter would
// replace its set.

import { getApi } from "@/app/store/global";
import { globalStore } from "@/app/store/jotaiStore";
import { openTarget } from "@/app/view/jarvis/openref";
import { isWindows } from "@/util/platformutil";
import { useAtomValue } from "jotai";
import { ArrowLeft, ArrowRight, ExternalLink, House, PinOff, Play, RotateCw, Square, Terminal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AgentsViewModel } from "./agents";
import { appWaitLine } from "./appmodel";
import { AppSlotView } from "./apppane";
import { appHistory, appStatesAtom, homeApp, reloadAppPage, setAppView } from "./appstore";
import { appCard, appSurfaceBody, appSurfaceService, appWaitTitle } from "./railapps";
import { appSurfaceIdAtom, railPinsAtom, setRailPinned } from "./railappsstore";
import { canRestart, canStart, canStop, serviceHeaderLine, serviceRowWords } from "./servicesmodel";
import {
    ensureServicesFeed,
    openService,
    restartService,
    servicesAtom,
    startService,
    stopService,
} from "./servicesstore";
import { SWAP_BTN, SWAP_PRIMARY_BTN } from "./swapbar";
import { BUTTON, StateDot, STOP_BUTTON } from "./terminalpaneheadview";
import { ToolGlyph } from "./terminalsrail";
import { toolIcon } from "./toolsmodel";
import { loadTools, toolsStatusAtom } from "./toolsstore";

// the state line has a clock in it while running (up 5m) and while retrying (retry in 3s)
const STATE_LINE_TICK_MS = 30_000;

// Log is a word beside its icon (board RailAppSurface), so it is wider than BUTTON's 24 px square; the rest is BUTTON's
const LOG_BUTTON =
    "flex h-[24px] shrink-0 cursor-pointer items-center gap-[5px] rounded-[6px] px-[8px] text-[11.5px] font-semibold text-muted hover:bg-surface-hover hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted";

// Opens the service's terminal tab on the Agent surface, its log showing. The terminal is never drawn here.
function openLog(model: AgentsViewModel, tabId: string): void {
    setAppView(tabId, "log");
    void openTarget(model, { kind: "agent", tabId });
}

function AppHeader({
    model,
    service,
    tabId,
    onPage,
    now,
}: {
    model: AgentsViewModel;
    service: ServiceStatus;
    tabId: string | null;
    onPage: boolean;
    now: number;
}) {
    const tools = useAtomValue(toolsStatusAtom);
    const words = serviceRowWords(service, now);
    const url = service.url;
    return (
        <div
            data-app-surface-head={service.id}
            data-service-state={service.state}
            className="flex h-[34px] shrink-0 items-center gap-[8px] border-b border-border bg-surface pl-[12px] pr-[8px]"
        >
            <ToolGlyph name={toolIcon(tools?.find((t) => t.id === service.id))} className="text-muted" />
            <span title={service.name} className="min-w-0 truncate text-[13px] font-semibold text-primary">
                {service.name}
            </span>
            {service.project ? (
                <span className="min-w-0 shrink truncate text-[11px] text-ink-faint">{service.project}</span>
            ) : null}
            <span data-app-surface-line className="flex min-w-0 items-center gap-[6px]">
                <StateDot tone={words.tone} dot={words.dot} />
                <span className="min-w-0 truncate text-[11.5px] tabular-nums text-muted">
                    {serviceHeaderLine(service, now)}
                </span>
            </span>
            <span className="flex-1" />
            <button
                type="button"
                data-app-back
                aria-label="Back"
                title="Back"
                disabled={!onPage || tabId == null}
                onClick={() => tabId != null && void appHistory(tabId, -1)}
                className={BUTTON}
            >
                <ArrowLeft size={14} aria-hidden />
            </button>
            <button
                type="button"
                data-app-forward
                aria-label="Forward"
                title="Forward"
                disabled={!onPage || tabId == null}
                onClick={() => tabId != null && void appHistory(tabId, 1)}
                className={BUTTON}
            >
                <ArrowRight size={14} aria-hidden />
            </button>
            {isWindows() ? (
                // the host reloads the frame where it is (pagekeys.rs), which a Mac's webview cannot yet
                <button
                    type="button"
                    data-app-reload
                    aria-label="Reload the page (Ctrl+R in it)"
                    title="Reload the page (Ctrl+R in it)"
                    disabled={!onPage || tabId == null}
                    onClick={() => tabId != null && void reloadAppPage(tabId)}
                    className={BUTTON}
                >
                    <RotateCw size={14} aria-hidden />
                </button>
            ) : null}
            <button
                type="button"
                data-app-home
                aria-label="Home: the app's start page, loaded afresh"
                title="Home: the app's start page, loaded afresh"
                disabled={!onPage || tabId == null}
                onClick={() => tabId != null && homeApp(tabId)}
                className={BUTTON}
            >
                <House size={14} aria-hidden />
            </button>
            <button
                type="button"
                data-app-browser
                aria-label="Open in the browser"
                title="Open in the browser"
                disabled={url == null}
                onClick={() => url != null && getApi().openExternal(url)}
                className={BUTTON}
            >
                <ExternalLink size={14} aria-hidden />
            </button>
            <button
                type="button"
                data-app-log
                aria-label="Its log, in Agent"
                title="Its log, in Agent"
                disabled={tabId == null}
                onClick={() => tabId != null && openLog(model, tabId)}
                className={LOG_BUTTON}
            >
                <Terminal size={13} aria-hidden />
                Log
            </button>
            {canRestart(service) ? (
                <button
                    type="button"
                    data-app-restart
                    aria-label={`Restart ${service.name}`}
                    title={`Restart ${service.name}`}
                    onClick={() => void restartService(service.id)}
                    className={BUTTON}
                >
                    <RotateCw size={14} aria-hidden />
                </button>
            ) : null}
            {canStop(service) ? (
                // a word, not an icon: a square reads as the window's maximize
                <button
                    type="button"
                    data-app-stop
                    aria-label={`Stop ${service.name}`}
                    title={`Stop ${service.name}`}
                    onClick={() => void stopService(service.id)}
                    className={STOP_BUTTON}
                >
                    <Square size={10} aria-hidden />
                    Stop
                </button>
            ) : canStart(service) ? (
                <button
                    type="button"
                    data-app-start
                    aria-label={`Start ${service.name}`}
                    title={`Start ${service.name}`}
                    onClick={() => void startService(service.id)}
                    className={STOP_BUTTON}
                >
                    <Play size={10} aria-hidden />
                    Start
                </button>
            ) : null}
            <button
                type="button"
                data-app-unpin
                aria-label={`Unpin ${service.name} from the rail`}
                title="Unpin from the rail"
                onClick={() => setRailPinned(service.id, false)}
                className={BUTTON}
            >
                <PinOff size={14} aria-hidden />
            </button>
        </div>
    );
}

// A starting app counts its seconds; a sleeping one on screen (stopped by hand, nothing yet starting it) only says so
function WaitingCard({ service, tabId, now }: { service: ServiceStatus; tabId: string; now: number }) {
    const starting = service.state === "starting";
    return (
        <div data-app-waiting={tabId} className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <div className="flex items-center gap-2 text-[14px] font-semibold text-primary">
                {starting ? (
                    <span aria-hidden className="h-[8px] w-[8px] animate-pulse rounded-full bg-accent" />
                ) : null}
                {appWaitTitle(service)}
            </div>
            {starting ? (
                <div className="text-[12.5px] tabular-nums text-muted">
                    {appWaitLine({ url: service.url ?? "", startedMs: service.startedms ?? 0 }, now)}
                </div>
            ) : null}
        </div>
    );
}

function CrashCard({
    model,
    service,
    tabId,
    now,
}: {
    model: AgentsViewModel;
    service: ServiceStatus;
    tabId: string;
    now: number;
}) {
    const card = appCard(service, now);
    return (
        <div data-app-card={service.state} className="flex flex-1 items-center justify-center bg-background p-6">
            <div className="flex w-[380px] max-w-full flex-col gap-3 rounded-[8px] border border-edge-mid bg-surface-raised p-5">
                <div className="text-[14px] font-semibold text-primary">{card.title}</div>
                <div className="text-[12.5px] leading-[1.5] text-muted">{card.line}</div>
                <div className="flex gap-2">
                    <button
                        type="button"
                        data-app-card-action={card.action}
                        onClick={() =>
                            void (card.action === "restart" ? restartService(service.id) : startService(service.id))
                        }
                        className={SWAP_PRIMARY_BTN}
                    >
                        {card.action === "restart" ? "Restart" : "Start"}
                    </button>
                    <button type="button" data-app-open-log onClick={() => openLog(model, tabId)} className={SWAP_BTN}>
                        Open its log
                    </button>
                </div>
            </div>
        </div>
    );
}

export function AppSurface({ model }: { model: AgentsViewModel }) {
    const id = useAtomValue(appSurfaceIdAtom);
    const pins = useAtomValue(railPinsAtom);
    const services = useAtomValue(servicesAtom);
    const states = useAtomValue(appStatesAtom);
    const tools = useAtomValue(toolsStatusAtom);
    useEffect(() => ensureServicesFeed(), []);
    // the header's icon is the tool's category, which the library names
    useEffect(() => {
        if (tools == null) {
            void loadTools();
        }
    }, [tools]);
    const service = services == null ? null : appSurfaceService(id, pins, services);
    const tabId = service?.tabid ?? null;

    // A shown service with no tab yet gets one (a pin made from the tree has one; a hand-edited list may not).
    const opening = useRef<string | null>(null);
    useEffect(() => {
        if (service != null && service.tabid == null && opening.current !== service.id) {
            opening.current = service.id;
            void openService(service.id);
        }
    }, [service]);

    // Leaving: the shown service unpinned and still there goes to Agent on its tab, so the same page stays on screen;
    // one gone from tools.json (or no id at all) goes to the Agent surface as it was. Once, and not before the first
    // read of the services, which cannot say a pin is gone.
    const leaving = useRef(false);
    useEffect(() => {
        if (services == null || service != null || leaving.current) {
            return;
        }
        leaving.current = true;
        const backToAgent = () => globalStore.set(model.surfaceAtom, "agent");
        const still = id != null ? services.find((s) => s.id === id) : undefined;
        if (still?.tabid) {
            void openTarget(model, { kind: "agent", tabId: still.tabid }, () => {}).then((r) => {
                if (!r.ok) {
                    backToAgent();
                }
            });
        } else {
            backToAgent();
        }
    }, [services, service, id, model]);

    const body = service != null ? appSurfaceBody(service) : null;
    // a clock for the state line and the cards, only while one of them has a clock in it
    const ticking =
        service != null && (service.state === "running" || service.state === "retrying" || body === "waiting");
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (!ticking) {
            return;
        }
        setNow(Date.now());
        const every = service?.state === "running" ? STATE_LINE_TICK_MS : 1000;
        const timer = setInterval(() => setNow(Date.now()), every);
        return () => clearInterval(timer);
    }, [ticking, service?.state]);

    if (service == null || body == null) {
        // services not read yet, or this surface is on its way out
        return <div data-app-surface={id ?? ""} className="flex h-full w-full flex-col bg-background" />;
    }
    return (
        <div data-app-surface={service.id} className="flex h-full w-full flex-col bg-background">
            <AppHeader
                model={model}
                service={service}
                tabId={tabId}
                onPage={body === "page" && states[tabId ?? ""] != null}
                now={now}
            />
            <div className="flex min-h-0 flex-1 flex-col">
                {tabId == null ? null : body === "page" ? (
                    <AppSlotView tabId={tabId} />
                ) : body === "waiting" ? (
                    <WaitingCard service={service} tabId={tabId} now={now} />
                ) : (
                    <CrashCard model={model} service={service} tabId={tabId} now={now} />
                )}
            </div>
        </div>
    );
}
