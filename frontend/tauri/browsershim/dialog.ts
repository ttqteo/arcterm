// Browser stand-in for @tauri-apps/plugin-dialog (vite.browser.config.ts aliases it): no native dialog opens here, so
// every one is cancelled, which every caller already handles.
export async function open(): Promise<null> {
    return null;
}

export async function save(): Promise<null> {
    return null;
}
