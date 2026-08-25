/*
 * The Wide Reader (cloud) and the consensus layer.
 *
 * Second Reader runs two independent readers over the same work against the
 * same rubric. The Close Reader (engine.js) is deterministic and local. The
 * Wide Reader is a language model that reads the way a colleague would.
 *
 * The point of running both is not accuracy theatre. It is the disagreement.
 * Where two readers using different methods land on different bands for the
 * same criterion, that criterion is genuinely contested, and the app says so
 * instead of averaging the two into a confident-looking middle. Averaging is
 * how a marking tool quietly becomes wrong.
 *
 * With no key configured the second reader falls to Chrome's built-in on-device
 * model (see ondevice.js), which is the path most people actually take. If
 * neither is available the app says which reader is missing, and the Close
 * Reader's distance-to-threshold stands in as the uncertainty signal.
 */

(function (global) {
  "use strict";

  const KEY_STORE = "sr:gemini-key";
  const MODEL_STORE = "sr:gemini-model";
  const DEFAULT_MODEL = "gemini-2.5-flash";

  function getKey() {
    try { return localStorage.getItem(KEY_STORE) || ""; } catch (e) { return ""; }
  }
  function setKey(value) {
    try {
      if (value) localStorage.setItem(KEY_STORE, value);
      else localStorage.removeItem(KEY_STORE);
    } catch (e) { /* private mode — the app still runs on the Close Reader */ }
  }
  function getModel() {
    try { return localStorage.getItem(MODEL_STORE) || DEFAULT_MODEL; } catch (e) { return DEFAULT_MODEL; }
  }
  function setModel(value) {
    try { localStorage.setItem(MODEL_STORE, value || DEFAULT_MODEL); } catch (e) { /* ignore */ }
  }

  /* ------------------------------- the prompt ------------------------------ */

  /* The instruction that matters most is the last one. A model asked to grade
     will always produce a number, and a number is the one thing this product
     refuses to hand over. */
  /* The level says who wrote this, so the reader knows what a reasonable
     attempt looks like. It moves the bar for what counts as EVIDENCE and
     nothing else. The last two lines are there because a model handed a year
     group will otherwise start awarding grades, which is the one thing this
     product does not do. */
  function levelLine(rubric) {
    if (!rubric.level) return "";
    return [
      "",
      "WHO WROTE IT: " + rubric.level + ".",
      "Judge whether the writing does each thing to a standard that is reasonable for that writer.",
      "Do not expect of a younger writer what you would expect of an older one, and do not give an",
      "older one credit for less.",
      "This changes what counts as evidence. It is NOT a grade, a band or a level to report back,",
      "and you must not mention it in your answer.",
    ].join("\n");
  }

  function buildPrompt(work, rubric) {
    const criteria = rubric.criteria
      .map((c, i) => (i + 1) + ". id=" + c.id + " — " + c.name + ": " + c.descriptor)
      .join("\n");

    return [
      "You are the second reader on a piece of student work. A teacher has already formed their own view.",
      "Your job is to find the EVIDENCE in the text for each rubric criterion, not to decide the mark.",
      "",
      levelLine(rubric),
      "RUBRIC (" + rubric.name + "):",
      criteria,
      "",
      "THE WORK:",
      '"""',
      work,
      '"""',
      "",
      "For each criterion return:",
      "- status: exactly one of evidenced | partial | missing",
      "- quotes: 1-3 spans copied VERBATIM from the work, character for character, that a marker could point at. Use [] if the work contains nothing relevant.",
      "- gap: one sentence naming what is missing or thin, referring to something actually in the text.",
      "- move: one concrete change that would raise this criterion, specific to this work.",
      "",
      "Rules: quote exactly, never paraphrase inside quotes. Never output a score, a mark, a percentage or a letter grade.",
    ].join("\n");
  }

  const RESPONSE_SCHEMA = {
    type: "object",
    properties: {
      criteria: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            status: { type: "string", enum: ["evidenced", "partial", "missing"] },
            quotes: { type: "array", items: { type: "string" } },
            gap: { type: "string" },
            move: { type: "string" },
          },
          required: ["id", "status", "quotes", "gap", "move"],
        },
      },
    },
    required: ["criteria"],
  };

  /* Model quotes come back with whatever whitespace the model felt like. Map
     them onto real offsets so they can be highlighted; drop the highlight
     rather than highlight the wrong span. */
  function locate(work, quote) {
    const needle = String(quote || "").trim().replace(/\s+/g, " ");
    if (needle.length < 8) return null;

    const direct = work.indexOf(needle);
    if (direct !== -1) return { start: direct, end: direct + needle.length };

    // whitespace-insensitive scan: walk the work building a normalised index
    const map = [];
    let norm = "";
    let lastWasSpace = true;
    for (let i = 0; i < work.length; i++) {
      const ch = work[i];
      if (/\s/.test(ch)) {
        if (lastWasSpace) continue;
        norm += " ";
        map.push(i);
        lastWasSpace = true;
      } else {
        norm += ch;
        map.push(i);
        lastWasSpace = false;
      }
    }
    const at = norm.indexOf(needle);
    if (at === -1) return null;
    return { start: map[at], end: (map[at + needle.length - 1] || map[map.length - 1]) + 1 };
  }

  /** Model quotes -> real spans. Anything that does not match is dropped. */
  function locateAll(work, quotes) {
    return (quotes || [])
      .map((q) => {
        const at = locate(work, q);
        return at ? { start: at.start, end: at.end, text: work.slice(at.start, at.end) } : null;
      })
      .filter(Boolean);
  }

  /*
   * Which second reader runs, in order of what the reader can actually offer:
   *
   *   1. a Gemini key, if one is set  — strongest, but costs the user an account
   *   2. Chrome's built-in Gemini Nano — free, needs nothing, never leaves the
   *      machine, and is therefore the RIGHT default for children's schoolwork
   *   3. neither — the close reader stands alone and the app says so
   *
   * The on-device path is not a fallback bolted on the side. For anyone who
   * just opens the page it is the one that actually runs.
   */
  async function readSecond(work, rubric, opts) {
    opts = opts || {};
    const first = await readSecondOnce(work, rubric, opts);
    /* opts.close is the close reader's result. When the caller passes it, any
       difference between the two readers is put back to the second reader
       before it is allowed to become a flag. */
    if (opts.close) return recheck(opts.close, first, work, rubric, opts);
    return first;
  }

  async function readSecondOnce(work, rubric, opts) {
    opts = opts || {};
    if (getKey()) {
      const cloud = await readWide(work, rubric);
      if (cloud.ok) return cloud;
      // a dead key should not cost the user the second reader entirely — but it
      // must still be reported, or they keep a broken key forever
      const device = await tryDevice(work, rubric, opts);
      if (device.ok) return Object.assign({}, device, { cloudFailed: cloud.reason });
      return cloud;
    }
    return tryDevice(work, rubric, opts);
  }

  async function tryDevice(work, rubric, opts) {
    if (!global.OnDevice) return { ok: false, reason: "no-device-ai" };
    const res = await global.OnDevice.read(work, rubric, opts);
    if (!res.ok) return res;
    const byId = {};
    for (const id of Object.keys(res.byId)) {
      const row = res.byId[id];
      byId[id] = { status: row.status, gap: row.gap, move: row.move, evidence: locateAll(work, row.quotes) };
    }
    return { ok: true, reader: "device", byId: byId, answered: res.answered, asked: res.asked };
  }

  async function readWide(work, rubric) {
    const key = getKey();
    if (!key) return { ok: false, reason: "no-key" };

    // key travels in a header, not the query string: URLs end up in history,
    // proxy logs and every screen recording of the demo
    const url =
      "https://generativelanguage.googleapis.com/v1beta/models/" +
      encodeURIComponent(getModel()) + ":generateContent";

    let res;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          contents: [{ parts: [{ text: buildPrompt(work, rubric) }] }],
          generationConfig: {
            /* Was 0.2. Two reads of one essay have to agree with each other
               before a disagreement between the two READERS means anything. */
            temperature: 0,
            topK: 1,
            candidateCount: 1,
            responseMimeType: "application/json",
            responseSchema: RESPONSE_SCHEMA,
          },
        }),
      });
    } catch (e) {
      return { ok: false, reason: "offline" };
    }

    if (!res.ok) {
      return { ok: false, reason: res.status === 400 || res.status === 403 ? "bad-key" : "http-" + res.status };
    }

    let parsed;
    try {
      const body = await res.json();
      const text = body?.candidates?.[0]?.content?.parts?.[0]?.text;
      parsed = JSON.parse(text);
    } catch (e) {
      return { ok: false, reason: "unparseable" };
    }

    const byId = {};
    for (const row of parsed.criteria || []) {
      byId[row.id] = {
        status: row.status,
        gap: row.gap,
        move: row.move,
        evidence: locateAll(work, row.quotes),
      };
    }
    return { ok: true, reader: "wide", byId };
  }

  /* ------------------------------- second opinion ---------------------------
   *
   * Temperature 0 lowers the variance of a sampled model; it does not abolish
   * it, and the cloud path promises nothing at all. So before a difference
   * between the two readers is reported as a disagreement, the second reader is
   * asked again about only the criteria in question.
   *
   *   re-ask agrees with the close reader  ->  the first answer was noise, and
   *                                            the criterion is settled
   *   re-ask repeats itself                ->  they really do disagree
   *
   * The cost is one extra call per disputed criterion, and in an ordinary read
   * that is zero or one. What it buys is that "the two readers disagree" is a
   * statement about the readers rather than about the sampler.
   */
  async function recheck(close, wide, work, rubric, opts) {
    if (!wide || !wide.ok || !close || !close.ok) return wide;

    const disputed = close.criteria.filter((c) => {
      const other = wide.byId[c.id];
      return other && other.status !== c.status;
    });
    if (!disputed.length) return wide;

    const again = await readSecondOnce(
      work,
      { id: rubric.id, name: rubric.name, context: rubric.context,
        level: rubric.level || "", criteria: disputed },
      opts
    );
    if (!again || !again.ok) return wide;

    const byId = Object.assign({}, wide.byId);
    const settled = [];
    for (const c of disputed) {
      const second = again.byId[c.id];
      if (!second) continue;
      if (second.status === c.status) {
        /* The second reader now agrees with the close reader. Its first answer
           does not get to stand as a disagreement - but it is not thrown away
           silently either: the confirmed reading replaces it. */
        byId[c.id] = second;
        settled.push(c.id);
      }
    }
    return Object.assign({}, wide, { byId: byId, rechecked: disputed.length, settled: settled });
  }

  /* ------------------------------- consensus ------------------------------- */

  const RANK = { missing: 0, partial: 1, evidenced: 2 };

  /* Merge, but never average. Where the readers agree, the criterion is settled
     and both sets of evidence are shown. Where they disagree, the app holds
     both readings side by side and hands the decision back. */
  function merge(close, wide) {
    const criteria = close.criteria.map((c) => {
      const other = wide && wide.ok ? wide.byId[c.id] : null;

      if (!other) {
        return Object.assign({}, c, {
          agreement: wide && wide.ok ? "unread" : "single",
          flagged: c.borderline,
          flagReason: c.borderline
            ? "The close reader landed close to a band boundary here, so this one is a judgment call."
            : null,
          wide: null,
        });
      }

      const same = other.status === c.status;
      const distance = Math.abs(RANK[other.status] - RANK[c.status]);

      return Object.assign({}, c, {
        agreement: same ? "agree" : distance > 1 ? "split" : "near",
        flagged: !same,
        flagReason: same
          ? null
          : "The two readers disagree: the close reader says “" +
            labelOf(c.status) + "”, the second reader says “" + labelOf(other.status) + "”.",
        wide: {
          status: other.status,
          gap: other.gap,
          move: other.move,
          evidence: other.evidence,
        },
        // both readings' evidence, close reader first, de-duplicated by span
        evidence: dedupeSpans(c.evidence.concat(other.evidence.map((e) => Object.assign({ strength: 0.9, from: "wide" }, e)))),
        wideFrom: wide.reader,
      });
    });

    return {
      criteria,
      readers: {
        close: true,
        wide: !!(wide && wide.ok),
        which: wide && wide.ok ? wide.reader : null,
        wideReason: wide && !wide.ok ? wide.reason : null,
        answered: wide && wide.ok ? wide.answered : null,
        asked: wide && wide.ok ? wide.asked : null,
      },
      flagged: criteria.filter((c) => c.flagged).length,
    };
  }

  function labelOf(status) {
    return status === "evidenced" ? "Found it" : status === "partial" ? "Half there" : "Not there";
  }

  function dedupeSpans(spans) {
    const out = [];
    for (const s of spans) {
      const overlap = out.some((o) => s.start < o.end && o.start < s.end);
      if (!overlap) out.push(s);
    }
    return out.sort((a, b) => a.start - b.start);
  }

  global.Readers = {
    readSecond: readSecond,
    recheck: recheck,
    readWide: readWide,
    merge: merge,
    labelOf: labelOf,
    getKey: getKey,
    setKey: setKey,
    getModel: getModel,
    setModel: setModel,
    DEFAULT_MODEL: DEFAULT_MODEL,
  };
})(window);
