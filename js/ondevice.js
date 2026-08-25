/*
 * The on-device reader — Chrome's built-in Gemini Nano, via the Prompt API.
 *
 * This is what runs as the second reader when there is no API key, which is the
 * normal case for anyone just trying the thing. It costs nothing, needs no
 * account, and the student's writing never leaves the machine — which for a
 * tool that handles children's schoolwork is not a footnote, it is the point.
 *
 * Nano is small. It gets ONE criterion at a time with a short prompt and a
 * tight schema, rather than the whole rubric at once: a small model asked for
 * four nested objects in a single shot returns mush, and mush that parses is
 * worse than nothing here.
 */

(function (global) {
  "use strict";

  const G = global;
  const CREATE_TIMEOUT = 12000;
  const PROMPT_TIMEOUT = 20000;
  /* Nano's context is small next to a cloud model. An essay longer than this is
     trimmed for the on-device pass only — the close reader always sees all of
     it, so nothing is silently dropped from the result the teacher relies on. */
  const MAX_CHARS = 4200;

  function LM() {
    if (typeof G.LanguageModel !== "undefined") return G.LanguageModel;
    if (G.ai && G.ai.languageModel) return G.ai.languageModel; // legacy namespace
    return null;
  }

  function withTimeout(p, ms, label) {
    return Promise.race([
      Promise.resolve(p),
      new Promise((_, rej) => setTimeout(() => rej(new Error((label || "ai") + "-timeout")), ms)),
    ]);
  }

  const clamp01 = (v) => Math.min(1, Math.max(0, Number(v) || 0));

  /** 'available' | 'downloadable' | 'downloading' | 'unavailable' */
  async function status() {
    const lm = LM();
    if (!lm) return "unavailable";
    try {
      const fn = lm.availability || lm.capabilities;
      if (!fn) return "unavailable";
      const r = await withTimeout(fn.call(lm), 4000, "availability");
      // legacy capabilities() -> { available: 'readily' | 'after-download' | 'no' }
      if (r && typeof r === "object" && "available" in r) {
        return r.available === "readily" ? "available"
          : r.available === "after-download" ? "downloadable" : "unavailable";
      }
      return r || "unavailable";
    } catch (e) {
      return "unavailable";
    }
  }

  /* Recent Chrome refuses to emit output as an "untested language" unless the
     languages are declared up front, so the modern signature is tried first and
     the older ones only as fallbacks. */
  function createOptions(system, onProgress) {
    const sys = system ? [{ role: "system", content: system }] : undefined;
    const mon = {
      monitor(m) {
        if (m && m.addEventListener) {
          m.addEventListener("downloadprogress", (e) => onProgress && onProgress(clamp01(e.loaded)));
        }
      },
    };
    const base = sys ? { initialPrompts: sys } : {};
    /* temperature 0 / topK 1 first: the same essay read twice should not come
       back with a different verdict, and it was. Chrome requires the two to be
       set together and rejects the pair outright on some builds, so this is an
       extra rung at the top of the existing fallback chain rather than a change
       to the ones below it - a build that refuses it still gets a session. */
    const fixed = { temperature: 0, topK: 1 };
    return [
      Object.assign({}, base, fixed, {
        expectedInputs: [{ type: "text", languages: ["en"] }],
        expectedOutputs: [{ type: "text", languages: ["en"] }],
      }, mon),
      Object.assign({}, base, {
        expectedInputs: [{ type: "text", languages: ["en"] }],
        expectedOutputs: [{ type: "text", languages: ["en"] }],
      }, mon),
      Object.assign({}, base, { outputLanguage: "en" }, mon),
      system ? { systemPrompt: system } : {},
    ];
  }

  async function newSession(system, onProgress) {
    const lm = LM();
    if (!lm) return null;
    const attempts = createOptions(system, onProgress);
    for (let i = 0; i < attempts.length; i++) {
      try {
        return await withTimeout(lm.create(attempts[i]), CREATE_TIMEOUT, "create");
      } catch (e) {
        const msg = String((e && e.message) || "");
        // one retry on the transient "service not running" Chrome sometimes throws
        if (i === 0 && /not running|not available|invalidstate|notreadable/i.test(msg)) {
          try { return await withTimeout(lm.create(attempts[0]), CREATE_TIMEOUT, "create-retry"); } catch (e2) { /* fall through */ }
        }
      }
    }
    return null;
  }

  /** Kick (or continue) the one-time model download. */
  async function download(onProgress) {
    const session = await newSession(null, onProgress);
    if (!session) return false;
    if (session.destroy) session.destroy();
    return true;
  }

  /* Start the one-time download in the background the first time the app opens,
     so "no key" quietly becomes "reads on your device" without anyone having to
     find a settings panel. Chrome still meters the download itself; this only
     asks for it. Fire and forget — the close reader is already answering. */
  let warming = false;
  async function warm(onProgress) {
    if (warming) return false;
    warming = true; // set before the first await so same-tick callers cannot double-enter
    try {
      const st = await status();
      if (st === "downloadable" || st === "downloading") return await download(onProgress);
      return st === "available";
    } catch (e) {
      return false;
    } finally {
      warming = false;
    }
  }

  const SCHEMA = {
    type: "object",
    properties: {
      status: { type: "string", enum: ["evidenced", "partial", "missing"] },
      quote: { type: "string" },
      gap: { type: "string" },
      move: { type: "string" },
    },
    required: ["status", "quote", "gap", "move"],
  };

  const SYSTEM =
    "You are the second reader on a piece of student work. You find evidence in the text. " +
    "You never give a score, mark, grade, band number or percentage.";

  function promptFor(criterion, work, level) {
    return [
      level
        ? "WHO WROTE IT: " + level + ". Judge it to a standard reasonable for that writer. " +
          "This changes what counts as evidence. It is not a grade — never mention it."
        : "",
      "THING TO LOOK FOR: " + criterion.name + " — " + criterion.descriptor,
      "",
      "THE ESSAY:",
      '"""',
      work,
      '"""',
      "",
      "Decide:",
      '- status: "evidenced" if the essay clearly does this, "partial" if it half does it, "missing" if it does not.',
      "- quote: ONE sentence copied EXACTLY from the essay, word for word, that shows this. Use \"\" if there is none.",
      "- gap: one short sentence naming what is missing or thin.",
      "- move: one short, concrete change that would improve this.",
      "",
      "Never output a score, mark, grade or percentage.",
    ].join("\n");
  }

  function parse(raw) {
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { /* try harder below */ }
    const m = String(raw).match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch (e) { /* give up */ } }
    return null;
  }

  /**
   * Reads `work` against `rubric` one criterion at a time.
   * Returns the same shape as the cloud reader so consensus does not care which
   * one answered: { ok, reader, byId }.
   */
  async function read(work, rubric, opts) {
    opts = opts || {};
    const st = await status();
    if (st !== "available") return { ok: false, reason: st === "unavailable" ? "no-device-ai" : st };

    const text = work.length > MAX_CHARS ? work.slice(0, MAX_CHARS) : work;
    const session = await newSession(SYSTEM, opts.onProgress);
    if (!session) return { ok: false, reason: "no-device-ai" };

    const byId = {};
    let answered = 0;
    try {
      for (let i = 0; i < rubric.criteria.length; i++) {
        // a newer read has started; drop this one rather than compete for the model
        if (opts.cancelled && opts.cancelled()) return { ok: false, reason: "cancelled" };
        const c = rubric.criteria[i];
        if (opts.onStep) opts.onStep(i, rubric.criteria.length, c.name);
        let row = null;
        try {
          const raw = await withTimeout(
            session.prompt(promptFor(c, text, rubric.level), { responseConstraint: SCHEMA }),
            PROMPT_TIMEOUT,
            "prompt"
          );
          row = parse(raw);
        } catch (e) { row = null; }

        if (!row || !row.status) continue;
        answered++;
        byId[c.id] = {
          status: row.status,
          gap: row.gap || "",
          move: row.move || "",
          // the quote is located against the real document by the caller, and
          // dropped if it does not match — a paraphrase must never be shown as
          // if it were the student's own sentence
          quotes: row.quote ? [row.quote] : [],
        };
      }
    } finally {
      if (session.destroy) session.destroy();
    }

    if (!answered) return { ok: false, reason: "no-answer" };
    // a partial pass must say so; presenting 1-of-4 as a full second read is
    // exactly the kind of quiet overclaim this product exists to refuse
    return { ok: true, reader: "device", byId: byId, answered: answered, asked: rubric.criteria.length };
  }

  /** Free-form prompt, for the assistant. Returns text or null. */
  async function raw(system, prompt) {
    const session = await newSession(system);
    if (!session) return null;
    try {
      return await withTimeout(session.prompt(prompt), PROMPT_TIMEOUT, "prompt");
    } catch (e) {
      return null;
    } finally {
      if (session.destroy) session.destroy();
    }
  }

  global.OnDevice = { raw: raw, status: status, download: download, warm: warm, read: read, available: () => !!LM() };
})(window);
