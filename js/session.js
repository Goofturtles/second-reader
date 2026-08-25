/*
 * Profiles, stored in this browser only.
 *
 * A profile is a name and an email guarded by a 4-6 digit PIN. The PIN is
 * salted and SHA-256 hashed before it is written, and nothing is ever sent
 * anywhere. It exists so a teacher's saved rubrics and marked work stay
 * separate on a shared staffroom machine — not to pretend there is a server.
 *
 * crypto.subtle needs a secure context, so on file:// the PIN path degrades to
 * a plain guest profile rather than throwing.
 */

(function (global) {
  "use strict";

  const SESSION_KEY = "sr:session";
  const PROFILES_KEY = "sr:profiles:v1";

  const normEmail = (e) => String(e || "").trim().toLowerCase().slice(0, 120);

  function loadProfiles() {
    try { return JSON.parse(localStorage.getItem(PROFILES_KEY) || "{}") || {}; } catch (e) { return {}; }
  }
  function saveProfiles(all) {
    try { localStorage.setItem(PROFILES_KEY, JSON.stringify(all)); } catch (e) { /* private mode */ }
  }

  function secure() {
    return !!(global.crypto && global.crypto.subtle && global.isSecureContext);
  }

  async function hashPin(pin, salt) {
    const data = new TextEncoder().encode(salt + ":" + pin);
    const buf = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  function commit(profile) {
    const session = { name: profile.name, email: profile.email, since: profile.since, role: profile.role || "teacher" };
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch (e) { /* ignore */ }
    return session;
  }

  /** Public shape only — the hash never leaves this module. */
  function lookup(email) {
    const p = loadProfiles()[normEmail(email)];
    if (!p) return null;
    return { name: p.name, email: p.email, since: p.since, hasPin: !!p.pinHash, provider: p.provider || null };
  }

  async function create(opts) {
    const all = loadProfiles();
    const key = normEmail(opts.email);
    if (all[key]) return { ok: false, error: "exists" };

    const record = {
      name: String(opts.name || "").trim().slice(0, 60) || key.split("@")[0],
      email: key,
      role: opts.role || "teacher",
      since: new Date().toISOString(),
    };
    if (opts.role === "student") record.role = "student";
    if (secure() && opts.pin) {
      record.salt = crypto.getRandomValues(new Uint32Array(2)).join("-");
      record.pinHash = await hashPin(opts.pin, record.salt);
    }
    all[key] = record;
    saveProfiles(all);
    return { ok: true, session: commit(record) };
  }

  async function unlock(opts) {
    const record = loadProfiles()[normEmail(opts.email)];
    if (!record) return { ok: false, error: "missing" };
    if (!record.pinHash) return { ok: true, session: commit(record) };
    if (!secure()) return { ok: false, error: "insecure" };
    if ((await hashPin(opts.pin, record.salt)) !== record.pinHash) return { ok: false, error: "pin" };
    return { ok: true, session: commit(record) };
  }

  /** Google Identity vouches for the email, so these profiles carry no PIN. */
  function fromProvider(opts) {
    const all = loadProfiles();
    const key = normEmail(opts.email);
    if (!all[key]) {
      all[key] = {
        name: String(opts.name || "").trim().slice(0, 60) || key.split("@")[0],
        email: key,
        provider: opts.provider,
        role: "teacher",
        since: new Date().toISOString(),
      };
      saveProfiles(all);
    }
    return commit(all[key]);
  }

  function current() {
    try {
      const s = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
      if (s && typeof s.email === "string" && typeof s.name === "string") return s;
    } catch (e) { /* corrupted — treat as signed out */ }
    return null;
  }

  /*
   * Teacher or student. It decides which tools the app offers, so it has to be
   * answerable before anyone signs in - most people who open this will never
   * make a profile, and until now every one of them was silently a teacher with
   * no way to say otherwise.
   *
   * The signed-in profile is the source of truth when there is one; ROLE_KEY
   * carries it the rest of the time, and a profile writes through to it so
   * signing out does not quietly change what you are looking at.
   */
  const ROLE_KEY = "sr:role";
  const clean = (r) => (r === "student" ? "student" : "teacher");

  function role() {
    const s = current();
    if (s && s.role) return clean(s.role);
    try { return clean(localStorage.getItem(ROLE_KEY)); } catch (e) { return "teacher"; }
  }

  function setLocalRole(next) {
    const value = clean(next);
    try { localStorage.setItem(ROLE_KEY, value); } catch (e) { /* private mode */ }
    const s = current();
    if (s) {
      /* Keep the profile and the loose key in step, so the answer does not
         change underneath somebody when they sign in or out. */
      s.role = value;
      try { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch (e) { /* ignore */ }
      const all = loadProfiles();
      const rec = all[normEmail(s.email)];
      if (rec) { rec.role = value; saveProfiles(all); }
    }
    return value;
  }

  function setRole(email, next) {
    const all = loadProfiles();
    const rec = all[normEmail(email)];
    if (!rec) return false;
    rec.role = clean(next);
    saveProfiles(all);
    commit(rec);
    try { localStorage.setItem(ROLE_KEY, rec.role); } catch (e) { /* ignore */ }
    return true;
  }

  /** Rename keeps the email (it is the key) and refreshes the live session. */
  async function rename(email, name) {
    const all = loadProfiles();
    const rec = all[normEmail(email)];
    if (!rec) return false;
    rec.name = String(name).trim().slice(0, 60);
    saveProfiles(all);
    commit(rec);
    return true;
  }

  /** Removes the profile and the session pointing at it. */
  function remove(email) {
    const all = loadProfiles();
    delete all[normEmail(email)];
    saveProfiles(all);
    signOut();
  }

  function signOut() {
    try { localStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ }
  }

  function firstName(session) {
    return session && session.name ? session.name.split(/\s+/)[0] : null;
  }

  /** Saved reads are scoped per profile; guests share one drawer. */
  function shelfKey(session) {
    return session ? "sr:shelf:v1:" + session.email : "sr:shelf:v1:guest";
  }

  global.Session = {
    lookup, create, unlock, fromProvider, current, signOut, firstName, shelfKey, secure, rename, remove, setRole,
    role, setLocalRole,
  };
})(window);
