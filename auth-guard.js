/**
    * auth-guard.js
    * Usage:
    *   import {requireAuth, whenAuthed} from "./auth-guard.js";
    */

    export function getNextParam() {
  const params = new URLSearchParams(location.search);
    return params.get("next") || "";
}

    export function safeDest(dest, fallback = "./index.html") {
  // allow only same-origin relative pages
  if (!dest) return fallback;
    if (dest.startsWith("http")) return fallback;
    if (dest.includes("//")) return fallback;
    if (dest.startsWith("javascript:")) return fallback;
    return dest;
}

    export function goToLoginWithNext(dest) {
  const next = encodeURIComponent(dest || (location.pathname.split("/").pop() || "index.html"));
    location.replace(`./login.html?next=${next}`);
}

    export function requireAuth(auth, onAuthed) {
  // Wait for Firebase to resolve session
  const unsub = auth.onAuthStateChanged((user) => {
        unsub();

    if (!user) {
      // send them to login and return to THIS page
      const here = location.pathname.split("/").pop() || "index.html";
    goToLoginWithNext(`./${here}${location.hash || ""}`);
    return;
    }

    if (typeof onAuthed === "function") onAuthed(user);
  });
}

    export function whenAuthed(auth, cb) {
  const unsub = auth.onAuthStateChanged((user) => {
    if (user && typeof cb === "function") cb(user);
  });
    return unsub;
}
