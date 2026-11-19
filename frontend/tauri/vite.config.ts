import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react-swc";
import { cpSync, createReadStream, existsSync, realpathSync } from "fs";
import { resolve, sep } from "path";
import { defineConfig, searchForWorkspaceRoot, type Plugin } from "vite";
import { buildCommit } from "./buildcommit";

const fe = resolve(__dirname, ".."); // frontend/
const outDir = resolve(__dirname, "dist");

// Excalidraw fetches its fonts at run time from window.EXCALIDRAW_ASSET_PATH, else from esm.sh. The CSP is
// default-src 'self' and the app must work offline, so the app serves them itself at EXCALIDRAW_FONTS_URL
// (boardstore.ts points Excalidraw at its parent, /excalidraw/): from the package in dev, copied into the bundle on build.
const EXCALIDRAW_FONTS_URL = "/excalidraw/fonts/";
const excalidrawFontsDir = resolve(fe, "../node_modules/@excalidraw/excalidraw/dist/prod/fonts");

function excalidrawFonts(): Plugin {
    return {
        name: "arc-excalidraw-fonts",
        configureServer(server) {
            server.middlewares.use(EXCALIDRAW_FONTS_URL, (req, res, next) => {
                const rel = decodeURIComponent((req.url ?? "").split("?")[0]);
                const file = resolve(excalidrawFontsDir, "." + rel);
                if (!file.startsWith(excalidrawFontsDir + sep) || !existsSync(file)) {
                    return next();
                }
                res.setHeader("Content-Type", "font/woff2");
                createReadStream(file).pipe(res);
            });
        },
        writeBundle() {
            cpSync(excalidrawFontsDir, resolve(outDir, ...EXCALIDRAW_FONTS_URL.split("/").filter(Boolean)), {
                recursive: true,
            });
        },
    };
}

// Mirror tsconfig.json "paths" exactly (deterministic prefix aliases; @/store -> app/store, etc.).
// A flat "@" -> frontend alias would mis-resolve @/store, @/view, @/element.
export default defineConfig({
    root: resolve(__dirname),
    // serve the workspace-root public/ (Font Awesome, fonts, logos, cockpit fixtures). Without this,
    // publicDir defaults to frontend/tauri/public, which does not exist, and /fontawesome/* 404s to the SPA fallback.
    publicDir: resolve(fe, "../public"),
    plugins: [react(), tailwindcss(), excalidrawFonts()],
    // the commit this bundle is built from, shown beside the version (cockpit/versioninfo.ts)
    define: { __ARC_COMMIT__: JSON.stringify(buildCommit(process.env)) },
    // each checkout keeps its own optimized-deps cache, in a real directory of its own. A worktree's
    // node_modules is a junction to the main checkout's, and every tree's config hashes differently (the
    // aliases are absolute), so a shared node_modules/.vite is re-optimized under every other running dev
    // app: a page then loads deps that were replaced (504) and never boots.
    cacheDir: resolve(fe, "../.vite"),
    resolve: {
        alias: {
            "@/app": resolve(fe, "app"),
            "@/store": resolve(fe, "app/store"),
            "@/view": resolve(fe, "app/view"),
            "@/element": resolve(fe, "app/element"),
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
        outDir,
        emptyOutDir: true,
        // the file tree's ~1,250 Material icons are nearly all under the 4 KB inline limit, which would
        // put every one into the JS bundle as base64; emitted as files, a tree loads only what it shows
        assetsInlineLimit: (file) =>
            file.replace(/\\/g, "/").includes("/material-icon-theme/icons/") ? false : undefined,
        // the 500 kB default is a network-delivery budget; these chunks load from the app bundle on disk.
        // monaco alone is 3.8 MB and already lazy, so the limit sits just above it to still catch a jump.
        chunkSizeWarningLimit: 4000,
        // three entries, so tray.html (the menu bar / tray popover's page) and sidecar.html (the Sidecar window's page)
        // ship beside index.html
        rollupOptions: {
            input: {
                main: resolve(__dirname, "index.html"),
                tray: resolve(__dirname, "tray.html"),
                sidecar: resolve(__dirname, "sidecar.html"),
            },
        },
    },
});
