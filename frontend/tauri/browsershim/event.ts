// Browser stand-in for @tauri-apps/api/event (vite.browser.config.ts aliases it): an in-page bus, since no Rust side
// emits here. core.ts emits wave-init on it, as the host does.
type TauriEvent<T> = { event: string; id: number; payload: T };
type Handler = (e: TauriEvent<unknown>) => void;

const handlers = new Map<string, Set<Handler>>();
let nextId = 1;

export async function listen<T>(event: string, handler: (e: TauriEvent<T>) => void): Promise<() => void> {
    const set = handlers.get(event) ?? new Set<Handler>();
    handlers.set(event, set);
    set.add(handler as Handler);
    return () => {
        set.delete(handler as Handler);
    };
}

export async function emit(event: string, payload?: unknown): Promise<void> {
    for (const h of [...(handlers.get(event) ?? [])]) h({ event, id: nextId++, payload });
}

// the browser app has one page and no other window, so a target is only a label here (the Sidecar bridge's emitTo)
export async function emitTo(_target: string, event: string, payload?: unknown): Promise<void> {
    await emit(event, payload);
}
