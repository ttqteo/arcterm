import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react-swc";
import { realpathSync } from "fs";
import { resolve } from "path";
import { defineConfig, searchForWorkspaceRoot } from "vite";

const fe = resolve(__dirname, ".."); // frontend/

// Mirror tsconfig.json "paths" exactly (deterministic prefix aliases; @/store -> app/store, etc.).
// A flat "@" -> frontend alias would mis-resolve @/store, @/view, @/element, @/shadcn.
export default defineConfig({
    root: resolve(__dirname),
    // serve the workspace-root public/ (Font Awesome + other static assets Electron used to serve).
    // without this, publicDir defaults to frontend/tauri/public and /fontawesome/* 404s to the SPA fallback.
    publicDir: resolve(fe, "../public"),
    plugins: [react(), tailwindcss()],
    resolve: {
        alias: {
            "@/app": resolve(fe, "app"),
            "@/store": resolve(fe, "app/store"),
            "@/view": resolve(fe, "app/view"),
            "@/element": resolve(fe, "app/element"),
            "@/shadcn": resolve(fe, "app/shadcn"),
            "@/util": resolve(fe, "util"),
        },
    },
    server: {
        port: 5174,
        strictPort: true,
        // a worktree's node_modules is a junction to the main checkout's, and vite resolves it to that real
        // path, outside the worktree: without it every asset a package loads by url() (monaco's codicon
        // font) is refused with a 403 in a worktree's dev app
        fs: { allow: [searchForWorkspaceRoot(process.cwd()), realpathSync(resolve(fe, "../node_modules"))] },
    },
    build: {
        outDir: resolve(__dirname, "dist"),
        emptyOutDir: true,
        // the file tree's ~1,250 Material icons are nearly all under the 4 KB inline limit, which would
        // put every one into the JS bundle as base64; emitted as files, a tree loads only what it shows
        assetsInlineLimit: (file) =>
            file.replace(/\\/g, "/").includes("/material-icon-theme/icons/") ? false : undefined,
        // the 500 kB default is a network-delivery budget; these chunks load from the app bundle on disk.
        // monaco alone is 3.8 MB and already lazy, so the limit sits just above it to still catch a jump.
        chunkSizeWarningLimit: 4000,
    },
});
