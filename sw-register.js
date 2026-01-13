// sw-register.js (calm iOS-safe version with reset helper, preserves original behavior)
(() => {
    if (!("serviceWorker" in navigator)) return;

    // Only run on http/https (works on localhost too)
    if (!/^https?:$/.test(location.protocol)) {
        console.log("[SW] Not registering on non-HTTP(S) origin.");
        return;
    }

    // ---- Optional reset for testing: visit any page with ?sw=reset to unregister and clear caches ----
    // Example: http://localhost:8080/index.html?sw=reset
    if (new URL(location.href).searchParams.get("sw") === "reset") {
        Promise.all([
            navigator.serviceWorker.getRegistrations()
                .then(regs => Promise.all(regs.map(r => r.unregister()))),
            (async () => {
                const keys = await caches.keys();
                await Promise.all(keys.map(k => caches.delete(k)));
            })()
        ]).then(() => {
            const url = new URL(location.href);
            url.searchParams.delete("sw");   // remove the flag from the URL
            location.replace(url.toString());
        });
        return; // skip registration on this run
    }

    // Bump this whenever sw.js changes
    const SW_VERSION = 39; // ⬅️ bumped from 38

    // Compute the repo base robustly:
    // - On GitHub Pages project sites: always "/<repo>/"
    // - Else: fall back to current directory ("/" on localhost)
    function computeBase() {
        const { hostname, pathname } = location;
        if (hostname.endsWith("github.io")) {
            const seg = pathname.split("/").filter(Boolean)[0]; // repo name
            return seg ? `/${seg}/` : "/";
        }
        // Non-GitHub hosts: current folder
        return new URL(".", location).pathname;
    }

    const BASE = computeBase();             // e.g. "/three-sides.io/" or "/"
    const SW_URL = `${BASE}sw.js?v=${SW_VERSION}`;
    const SCOPE = BASE;

    // Detect standalone modes
    const IS_STANDALONE =
        (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) ||
        // iOS Safari standalone
        (typeof navigator.standalone === "boolean" && navigator.standalone === true);

    // Simple debounce
    function debounce(fn, ms) {
        let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
    }

    // Track and (optionally) activate an update once the app is stable
    function setupUpdateFlow(reg) {
        if (!reg) return;

        // NEVER hard-reload on controllerchange — this causes flicker on iOS PWAs
        navigator.serviceWorker.addEventListener("controllerchange", () => {
            console.log("[SW] controllerchange (new SW controlling). No auto-reload.");
        });

        // Keep a pointer to the waiting worker if present
        let waiting = reg.waiting || null;

        // If a new worker appears, remember it and decide when to activate
        reg.addEventListener("updatefound", () => {
            const nw = reg.installing;
            if (!nw) return;
            nw.addEventListener("statechange", () => {
                if (nw.state === "installed") {
                    // If there's an existing controller, this is an update (not first install)
                    if (navigator.serviceWorker.controller) {
                        waiting = reg.waiting || nw;
                        console.log("[SW] Update installed (waiting). Deferring activation.");
                        tryPromptOrAutoActivate();
                    } else {
                        console.log("[SW] First install complete; offline ready.");
                    }
                }
            });
        });

        // Debounced manual checks help Safari pick up updates
        const debouncedUpdate = debounce(() => reg.update().catch(() => { }), 800);

        document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "visible") debouncedUpdate();
        });

        window.addEventListener("pageshow", (e) => {
            if (e.persisted) debouncedUpdate();
        });

        // Gentle periodic check (every hour)
        const hourly = setInterval(() => reg.update().catch(() => { }), 60 * 60 * 1000);

        // Try to activate the waiting worker when it’s safe (no immediate reloads)
        function tryPromptOrAutoActivate() {
            if (!waiting) return;

            // If we’re still booting, wait a bit
            const bootReady =
                document.documentElement.getAttribute("data-boot") === "1" ||
                document.documentElement.getAttribute("data-ready") === "1" ||
                document.readyState === "complete";

            // iOS standalone can be jittery right after launch; give it breathing room
            const safeToActivate =
                bootReady && document.visibilityState === "visible" && !IS_STANDALONE;

            if (safeToActivate) {
                // Activate quietly; no reload. New assets will be used on next navigation.
                waiting.postMessage({ type: "SKIP_WAITING" });
                console.log("[SW] Activating update quietly (no reload).");
                waiting = null;
            } else {
                // Defer activation until visible & not iOS standalone
                const onVisible = () => {
                    setTimeout(() => {
                        if (document.visibilityState === "visible" && !IS_STANDALONE && waiting) {
                            waiting.postMessage({ type: "SKIP_WAITING" });
                            console.log("[SW] Deferred activation done (visible & stable).");
                            waiting = null;
                            document.removeEventListener("visibilitychange", onVisible);
                        }
                    }, 1200);
                };
                document.addEventListener("visibilitychange", onVisible);

                // Failsafe activation after a gentle delay (no reload) when not iOS standalone
                setTimeout(() => {
                    if (waiting && !IS_STANDALONE) {
                        waiting.postMessage({ type: "SKIP_WAITING" });
                        console.log("[SW] Failsafe activation (no reload).");
                        waiting = null;
                        document.removeEventListener("visibilitychange", onVisible);
                    }
                }, 8000);
            }
        }

        // If a waiting worker already exists at startup, handle it
        if (reg.waiting) {
            waiting = reg.waiting;
            tryPromptOrAutoActivate();
        }

        // Cleanup on unload
        window.addEventListener("beforeunload", () => clearInterval(hourly));
    }

    // Register after load so it never blocks first paint
    window.addEventListener("load", () => {
        navigator.serviceWorker.register(SW_URL, { scope: SCOPE /*, updateViaCache: 'all'*/ })
            .then((reg) => {
                console.log("[SW] Registered at", reg.scope);
                setupUpdateFlow(reg);
                return navigator.serviceWorker.ready;
            })
            .catch((err) => console.error("[SW] Register error", err));
    });
})();
