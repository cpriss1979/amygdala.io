// badges.js  (module)
// Export a single API: Badges.award(id), Badges.getAll(), Badges.onChange(cb)

import { auth, db } from "./firebase-init.js";
import {
    doc, getDoc, setDoc, updateDoc, arrayUnion,
    onSnapshot, collection, getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

function defaultState() {
    return { earned: [] }; // array of badge IDs
}

function getUid() {
    return auth?.currentUser?.uid || localStorage.getItem("currentUser") || null;
}

function lsKey(uid) { return `badges:${uid}`; }
function readLS(uid) {
    try { return JSON.parse(localStorage.getItem(lsKey(uid))) || defaultState(); }
    catch { return defaultState(); }
}
function writeLS(uid, data) {
    localStorage.setItem(lsKey(uid), JSON.stringify(data));
}

// Merge root array + subcollection ids (so it matches badge.html logic)
async function fetchAll(uid) {
    if (!uid) return defaultState();

    // start with local for immediate paint
    const local = readLS(uid);
    let earned = new Set(local.earned);

    try {
        const userRef = doc(db, "users", uid);
        const rootSnap = await getDoc(userRef);
        if (rootSnap.exists()) {
            const arr = Array.isArray(rootSnap.data()?.badges) ? rootSnap.data().badges : [];
            arr.forEach(id => earned.add(id));
        }
        const sub = await getDocs(collection(db, "users", uid, "badges"));
        sub.forEach(d => earned.add(d.id));
    } catch { }

    const merged = { earned: [...earned] };
    writeLS(uid, merged);
    return merged;
}

async function ensureUserDoc(uid) {
    try {
        const userRef = doc(db, "users", uid);
        const s = await getDoc(userRef);
        if (!s.exists()) await setDoc(userRef, { badges: [] }, { merge: true });
    } catch { }
}

// Public API
export const Badges = {
    /** award('themeChange') etc. */
    async award(id) {
        const uid = getUid();
        if (!uid || !id) return;

        // local update
        const local = readLS(uid);
        if (!local.earned.includes(id)) {
            local.earned.push(id);
            writeLS(uid, local);
        }

        // Firestore (root array preferred, subcollection optional)
        try {
            await ensureUserDoc(uid);
            const userRef = doc(db, "users", uid);
            await updateDoc(userRef, { badges: arrayUnion(id) });
        } catch {
            const userRef = doc(db, "users", uid);
            await setDoc(userRef, { badges: [id] }, { merge: true });
        }
    },

    /** Returns { earned: ['login','pawprint', ...] } */
    async getAll() {
        const uid = getUid();
        return await fetchAll(uid);
    },

    /** Live updates: Badges.onChange(ids => { ... }) */
    onChange(cb) {
        const uid = getUid();
        if (!uid) { cb([]); return () => { }; }

        const userRef = doc(db, "users", uid);
        let subSet = new Set(), rootSet = new Set();

        const apply = () => cb([...new Set([...rootSet, ...subSet])]);

        const un1 = onSnapshot(userRef, snap => {
            const arr = Array.isArray(snap.data()?.badges) ? snap.data().badges : [];
            rootSet = new Set(arr);
            apply();
        });

        const un2 = onSnapshot(collection(db, "users", uid, "badges"), qs => {
            subSet = new Set();
            qs.forEach(d => subSet.add(d.id));
            apply();
        });

        return () => { try { un1(); un2(); } catch { } };
    }
};

// Make global for easy console testing
window.Badges = Badges;
