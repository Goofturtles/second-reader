/*
 * The shelf: essays you have kept, in this browser.
 *
 * A marker does not read one essay. They read thirty, put four aside to come
 * back to, and want the checklist to still be there in the morning. Until now
 * the app held exactly one piece of work and lost it on reload, which made it
 * a demo rather than a thing you could mark a set with.
 *
 * Everything is per profile, so a shared staffroom machine does not mix two
 * teachers' classes together. Nothing is uploaded; this is localStorage and
 * localStorage only, which is also why there is a hard ceiling on it.
 *
 * Every field is coerced on the way in. An entry can arrive from an export
 * file the user hand-edited, or from a Google Classroom submission whose title
 * a student chose, so nothing here trusts its own input.
 */

(function (global) {
  "use strict";

  const MAX_ENTRIES = 80;

  /*
   * Browsers give an origin roughly 5MB, and this profile's shelf shares that
   * with every other key the app writes. The budget is measured in BYTES, not
   * in string length: localStorage is charged per UTF-16 code unit at two bytes
   * each, so counting characters overstates the headroom by about double and
   * the "clean refusal" would never fire before the browser threw.
   */
  const MAX_BYTES = 2_000_000;

  function key() {
    return global.Session ? Session.shelfKey(Session.current()) : "sr:shelf:v1:guest";
  }

  /** What this string actually costs in the store. */
  function weigh(s) {
    return String(s).length * 2;
  }

  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(key()) || "[]");
      return Array.isArray(raw) ? raw.filter((e) => e && typeof e.id === "string") : [];
    } catch (e) {
      return [];
    }
  }

  function write(all) {
    try {
      localStorage.setItem(key(), JSON.stringify(all));
      return { ok: true };
    } catch (e) {
      return { ok: false, error: "full" };
    }
  }

  function bytes() {
    try { return weigh(localStorage.getItem(key()) || ""); } catch (e) { return 0; }
  }

  /** Newest first, which is the order anyone actually wants to see them in. */
  function list() {
    return load().sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  }

  function get(id) {
    return load().find((e) => e.id === id) || null;
  }

  /*
   * Date.now alone collides when eighty submissions are imported inside the
   * same millisecond, and a collision here is silent data loss: save() would
   * take the overwrite branch and the import would still report success.
   */
  let seq = 0;
  function newId() {
    seq = (seq + 1) % 1e6;
    return "e" + Date.now().toString(36) + "-" + seq.toString(36) + "-" +
      Math.floor(Math.random() * 1e6).toString(36);
  }

  const str = (v, max) => String(v == null ? "" : v).slice(0, max);

  /** Coerces anything into the shape the app expects, or into empty. */
  function clean(entry, id, madeAt) {
    const src = entry && typeof entry === "object" ? entry : {};
    const crits = Array.isArray(src.criteria) ? src.criteria : [];
    return {
      id: id,
      title: str(src.title, 140).trim() || "Untitled essay",
      text: typeof src.text === "string" ? src.text : "",
      rubricName: str(src.rubricName, 140).trim() || "Your checklist",
      criteria: crits
        .filter((c) => c && typeof c === "object")
        .slice(0, 60)
        .map((c) => ({ id: str(c.id, 60), name: str(c.name, 120), descriptor: str(c.descriptor, 400) })),
      stat: src.stat && typeof src.stat === "object" ? {
        found: Number(src.stat.found) || 0,
        total: Number(src.stat.total) || 0,
        flagged: Number(src.stat.flagged) || 0,
      } : null,
      /* The conversation, and anything kept from it. Capped: this is a record
         of a chat, not a transcript archive, and it shares a 2MB budget with
         every essay on the shelf. */
      chat: (Array.isArray(src.chat) ? src.chat : [])
        .filter((m) => m && (m.who === "you" || m.who === "sr") && typeof m.text === "string")
        .slice(-40)
        .map((m) => ({ who: m.who, text: m.text.slice(0, 4000) })),
      notes: (Array.isArray(src.notes) ? src.notes : [])
        .filter((n) => typeof n === "string")
        .slice(0, 20)
        .map((n) => n.slice(0, 4000)),
      /* Which band each criterion landed in, kept so a whole set can be read
         at once without re-running the reader over every essay in it. */
      bands: src.bands && typeof src.bands === "object"
        ? Object.keys(src.bands).slice(0, 60).reduce((o, k) => {
            const v = src.bands[k];
            if (v === "evidenced" || v === "partial" || v === "missing") o[str(k, 120)] = v;
            return o;
          }, {})
        : null,
      source: str(src.source, 20) || "typed",
      meta: src.meta && typeof src.meta === "object" ? {
        course: str(src.meta.course, 140),
        work: str(src.meta.work, 140),
        who: str(src.meta.who, 140),
      } : null,
      savedAt: Date.now(),
      madeAt: Number(src.madeAt) || madeAt || Date.now(),
    };
  }

  /**
   * Upsert. `entry.id` decides whether this is a new piece of work or the one
   * already open, which is what lets the app autosave without asking.
   */
  function save(entry) {
    const all = load();
    const id = (entry && typeof entry.id === "string" && entry.id) || newId();
    const at = all.findIndex((e) => e.id === id);
    const record = clean(entry, id, at === -1 ? null : all[at].madeAt);

    if (at === -1) {
      if (all.length >= MAX_ENTRIES) return { ok: false, error: "count" };
      all.push(record);
    } else {
      /*
       * An empty conversation never overwrites a stored one.
       *
       * A save can fire from a tab that has not restored the chat yet - a
       * reload racing its own autosave, say - and one such save would destroy
       * the whole history silently. Nothing in the app clears a chat on
       * purpose; starting fresh mints a new id, so this can only ever prevent
       * a loss.
       */
      if (!record.chat.length && all[at].chat && all[at].chat.length) record.chat = all[at].chat;
      if (!record.notes.length && all[at].notes && all[at].notes.length) record.notes = all[at].notes;
      all[at] = record;
    }

    /* Measured before committing, so a save that would blow the budget is
       refused cleanly instead of relying on the browser to throw. */
    if (weigh(JSON.stringify(all)) > MAX_BYTES) return { ok: false, error: "full" };

    const out = write(all);
    return out.ok ? { ok: true, id: id } : out;
  }

  function remove(id) {
    return write(load().filter((e) => e.id !== id));
  }

  function rename(id, title) {
    const all = load();
    const e = all.find((x) => x.id === id);
    if (!e) return { ok: false, error: "missing" };
    e.title = str(title, 140).trim() || "Untitled essay";
    e.savedAt = Date.now();
    return write(all);
  }

  function clear() {
    return write([]);
  }

  /** A file the teacher can keep. The shelf is one browser deep, so being able
      to take it somewhere else is the difference between saved and trapped. */
  function exportAll() {
    return JSON.stringify({ kind: "second-reader-shelf", version: 1, saved: new Date().toISOString(), entries: list() }, null, 2);
  }

  /**
   * All of it or none of it.
   *
   * Committing entry by entry meant a file that failed halfway left the shelf
   * in a state nobody asked for and could not undo. The whole import is built
   * in memory and written once.
   */
  function importAll(json) {
    let parsed;
    try { parsed = JSON.parse(json); } catch (e) { return { ok: false, error: "unreadable" }; }
    const entries = parsed && Array.isArray(parsed.entries) ? parsed.entries : null;
    if (!entries) return { ok: false, error: "wrong-file" };

    const all = load();
    let added = 0;
    for (const e of entries) {
      if (!e || typeof e.text !== "string" || !e.text.trim()) continue;
      if (all.length >= MAX_ENTRIES) return { ok: false, error: "count", added: 0 };
      /* New ids on the way in, so importing a file twice does not silently
         overwrite work that happens to share an id with it. */
      all.push(clean(e, newId(), Number(e.madeAt) || null));
      added++;
    }
    if (!added) return { ok: false, error: "empty" };
    if (weigh(JSON.stringify(all)) > MAX_BYTES) return { ok: false, error: "full", added: 0 };

    const out = write(all);
    return out.ok ? { ok: true, added: added } : { ok: false, error: out.error, added: 0 };
  }

  global.Shelf = { list, get, save, remove, rename, clear, bytes, exportAll, importAll, MAX_ENTRIES, MAX_BYTES };
})(window);
