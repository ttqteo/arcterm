// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// How many more workers the machine's free RAM holds, as the app bar chip and the worker steppers say it. The
// formula is the backend's (pkg/workercap); this file decides what a pick adds and how to word it.

export type WorkerCapacity = CommandGetWorkerCapacityRtnData;

const GIB = 1024 ** 3;

/** "1.3 GB", "8 GB": GiB to one decimal, a trailing .0 dropped. */
export function formatGB(bytes: number): string {
    return `${Number((bytes / GIB).toFixed(1))} GB`;
}

/** How many new workers a pick adds: the launcher's whole width (nothing while it is unset and the lead
 * decides), or on a live run the width above the tasks already running. */
export function extraWorkers(picked: number | null, running = 0): number {
    return picked == null ? 0 : Math.max(0, picked - running);
}

/** Whether a pick adds more workers than fit. Never without a reading: no number, no warning. */
export function overCapacity(cap: WorkerCapacity | null, extra: number): boolean {
    return cap != null && extra > cap.moreworkers;
}

function moreFit(n: number): string {
    return `~${n} more ${n === 1 ? "fits" : "fit"}`;
}

/** The app bar chip's tooltip, one fact per line. */
export function capacityTitle(cap: WorkerCapacity): string {
    return [
        `${formatGB(cap.availablebytes)} free of ${formatGB(cap.totalbytes)}`,
        `~${formatGB(cap.perworkerbytes)} per worker, ~${formatGB(cap.heavybytes)} for a heavy job (${cap.measured ? "measured" : "default"})`,
        `${cap.liveworkers} running · ${moreFit(cap.moreworkers)}`,
    ].join("\n");
}

/** The worker stepper's warning tooltip. */
export function capacityWarnTitle(cap: WorkerCapacity): string {
    return `${moreFit(cap.moreworkers)} in RAM (${formatGB(cap.availablebytes)} free)`;
}
