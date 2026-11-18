// The phone page's service worker: keeps the page shell so a phone that cannot reach Arc (remote mode off,
// the PC asleep) still opens and draws Unreachable, and shows the pushes remote mode sends.

const CACHE = "arc-remote-shell";
const SHELL = [
    "/",
    "/tokens.css",
    "/phone.css",
    "/phone.js",
    "/model.js",
    "/chat.js",
    "/chatmodel.js",
    "/transcriptpages.js",
    "/projectors.js",
    "/markdown.js",
    "/manifest.webmanifest",
    "/icon.png",
    "/fonts/hanken-grotesk-variable.woff2",
    "/fonts/jetbrains-mono-variable.woff2",
];
const SERVER_ERROR = 500;

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches
            .open(CACHE)
            .then((cache) => cache.addAll(SHELL))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener("activate", (event) => {
    event.waitUntil(self.clients.claim());
});

async function networkFirst(request, fallbackPath) {
    let res;
    try {
        res = await fetch(request);
    } catch {
        return (await caches.match(fallbackPath)) ?? Response.error();
    }
    if (res.status >= SERVER_ERROR) {
        return (await caches.match(fallbackPath)) ?? res;
    }
    // a redirect (cloudflare's login) and every other answer pass through untouched; only a plain
    // same-origin success refreshes the kept copy
    if (res.ok && res.type === "basic" && !res.redirected) {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(fallbackPath, copy));
    }
    return res;
}

self.addEventListener("fetch", (event) => {
    const req = event.request;
    const url = new URL(req.url);
    if (req.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) {
        return;
    }
    if (req.mode === "navigate") {
        event.respondWith(networkFirst(req, "/"));
        return;
    }
    if (SHELL.includes(url.pathname)) {
        event.respondWith(networkFirst(req, url.pathname));
    }
});

self.addEventListener("push", (event) => {
    let note = {};
    try {
        note = event.data?.json() ?? {};
    } catch {
        // an unreadable payload still notifies, so the owner knows to look
    }
    event.waitUntil(
        self.registration.showNotification(note.title || "arcterm", {
            body: note.body || "Something is waiting on you.",
            tag: note.key || undefined,
            icon: "/icon.png",
        })
    );
});

self.addEventListener("notificationclick", (event) => {
    event.notification.close();
    event.waitUntil(
        self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
            const open = wins.find((w) => new URL(w.url).origin === self.location.origin);
            return open ? open.focus() : self.clients.openWindow("/");
        })
    );
});
