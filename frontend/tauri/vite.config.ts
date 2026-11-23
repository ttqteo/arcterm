import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react-swc";
import { cpSync, createReadStream, existsSync, realpathSync } from "fs";
import { relative, resolve, sep } from "path";
import { defineConfig, searchForWorkspaceRoot, type Plugin } from "vite";
import { buildCommit } from "./buildcommit";

const fe = resolve(__dirname, ".."); // frontend/
const outDir = resolve(__dirname, "dist");

// Excalidraw fetches its fonts at run time from window.EXCALIDRAW_ASSET_PATH, else from esm.sh. The CSP is
// default-src 'self' and the app must work offline, so the app serves them itself at EXCALIDRAW_FONTS_URL
// (boardstore.ts points Excalidraw at its parent, /excalidraw/): from the package in dev, copied into the bundle on build.
const EXCALIDRAW_FONTS_URL = "/excalidraw/fonts/";
const excalidrawFontsDir = resolve(fe, "../node_modules/@excalidraw/excalidraw/dist/prod/fonts");

// The board's Vietnamese face. Excalifont has no ơ ư đ ạ ế…, so a board with Vietnamese turns its text to Nunito
// (boardmodel.ts withReadableFont), the one face Excalidraw ships with a Vietnamese subset, but Nunito is a plain sans
// beside hand-drawn shapes. Excalidraw has no way to add a font, so Nunito's files are served as Shantell Sans (OFL, a
// hand-drawn marker face with Vietnamese), subset for subset: Excalidraw registers each file under the same unicode
// range Google Fonts gives both. Its metrics (1020/-320 per 1000) are close to Nunito's (1011/-353) that Excalidraw
// lays text out with. The picker's "Nunito" draws Shantell Sans too; excalidraw.com draws the saved file in Nunito.
const shantellDir = resolve(__dirname, "excalidraw-fonts/ShantellSans");
const NUNITO_FILE = "Nunito/Nunito-Regular-XRXI3I6Li01BKofiOc5wtlZ2di8HDIkhd";
const fontOverrides: Record<string, string> = {
    [`${NUNITO_FILE}TQ3j6zbXWjgeg.woff2`]: "latin",
    [`${NUNITO_FILE}To3j6zbXWjgevT5.woff2`]: "latin-ext",
    [`${NUNITO_FILE}Ts3j6zbXWjgevT5.woff2`]: "vietnamese",
    [`${NUNITO_FILE}TA3j6zbXWjgevT5.woff2`]: "cyrillic",
    [`${NUNITO_FILE}Tk3j6zbXWjgevT5.woff2`]: "cyrillic-ext",
};
const overrideFile = (subset: string) => resolve(shantellDir, `shantell-sans-${subset}-400-normal.woff2`);
// Xiaolai, Excalidraw's hand-drawn Chinese face, is 209 woff2 files and 13 MB: two thirds of everything else the
// frontend puts in the app. It is left out, and a board's Chinese text draws in the system's CJK font instead.
const SKIPPED_FONT_DIRS = new Set(["Xiaolai"]);
const keptFont = (rel: string) => !SKIPPED_FONT_DIRS.has(rel.split(/[\\/]/)[0]);

// Monaco's TypeScript worker is the whole TypeScript compiler, 7 MB. monaco-env.ts turns its language service off,
// so no worker is ever asked for, but monaco's workerManager still names it as `new Worker(new URL('ts.worker.js',
// import.meta.url))`, which makes Vite emit it anyway. Replacing that with a throw keeps the file out of the bundle.
function noTypeScriptWorker(): Plugin {
    return {
        name: "arc-no-ts-worker",
        enforce: "pre",
        transform(code, id) {
            if (
                !/monaco-editor[\\/]esm[\\/]vs[\\/]language[\\/]typescript[\\/]workerManager\.js$/.test(
                    id.split("?")[0]
                )
            ) {
                return null;
            }
            const out = code.replace(
                /new Worker\(new URL\(['"]ts\.worker\.js['"], import\.meta\.url\)[^)]*\)/,
                `(() => { throw new Error("arcterm ships no TypeScript worker (see monaco-env.ts)"); })()`
            );
            if (out === code) {
                // a monaco upgrade moved the line: fail the build rather than ship the 7 MB again unnoticed
                this.error("arc-no-ts-worker: the ts.worker line in monaco's workerManager.js was not found");
            }
            return out;
        },
    };
}

// KaTeX's stylesheet lists each of its 20 fonts as woff2, woff and ttf; WebView2 and WKWebView both take the woff2,
// so the other two only made Vite emit 40 files (~1 MB) nothing loads. Dropping them from the src lists before Vite
// reads the urls keeps them out of the bundle.
function katexWoff2Only(): Plugin {
    return {
        name: "arc-katex-woff2-only",
        enforce: "pre",
        transform(code, id) {
            if (!/[\\/]katex[\\/]dist[\\/]katex(\.min)?\.css$/.test(id.split("?")[0])) {
                return null;
            }
            return code.replace(/,\s*url\([^)]*\.(?:woff|ttf)\)\s*format\("(?:woff|truetype)"\)/g, "");
        },
    };
}

function excalidrawFonts(): Plugin {
    return {
        name: "arc-excalidraw-fonts",
        configureServer(server) {
            server.middlewares.use(EXCALIDRAW_FONTS_URL, (req, res, next) => {
                const rel = decodeURIComponent((req.url ?? "").split("?")[0]).replace(/^\/+/, "");
                const subset = fontOverrides[rel];
                const file = subset ? overrideFile(subset) : resolve(excalidrawFontsDir, rel);
                if ((!subset && !file.startsWith(excalidrawFontsDir + sep)) || !keptFont(rel) || !existsSync(file)) {
                    return next();
                }
                res.setHeader("Content-Type", "font/woff2");
                createReadStream(file).pipe(res);
            });
        },
        writeBundle() {
            const dest = resolve(outDir, ...EXCALIDRAW_FONTS_URL.split("/").filter(Boolean));
            cpSync(excalidrawFontsDir, dest, {
                recursive: true,
                filter: (src) => keptFont(relative(excalidrawFontsDir, src)),
            });
            for (const [rel, subset] of Object.entries(fontOverrides)) {
                cpSync(overrideFile(subset), resolve(dest, rel));
            }
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
    plugins: [react(), tailwindcss(), excalidrawFonts(), katexWoff2Only(), noTypeScriptWorker()],
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
