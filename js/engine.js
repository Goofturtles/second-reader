/*
 * The Close Reader — the offline half of Second Reader.
 *
 * It runs entirely in the browser, with no network, and it is deterministic:
 * the same work read against the same rubric returns the same result every
 * time. That matters for a marking tool. A teacher who gets a different read
 * on Tuesday than they got on Monday stops trusting the thing.
 *
 * What it actually does, in order:
 *   1. splits the work into sentences, keeping character offsets so every
 *      judgment can be pinned back onto the exact span of text
 *   2. tokenises, drops stopwords, and applies a light suffix stemmer
 *   3. builds a tf-idf space over the sentences of THIS work
 *   4. turns each rubric criterion into a query vector (its name, its
 *      descriptor, its look-for terms, plus a synonym expansion) and ranks
 *      sentences against it by cosine similarity — that ranking is the evidence
 *   5. runs eight linguistic signal detectors over the whole work
 *   6. infers what kind of criterion it is looking at, and combines topical
 *      coverage with the signals that criterion actually depends on
 *   7. converts that to a status, a distance-to-threshold margin, and a
 *      written gap and next move that quote real detected text
 *
 * It never returns a grade. See NOTE at scoreCriterion().
 */

(function (global) {
  "use strict";

  /* ------------------------------ vocabulary ------------------------------ */

  const STOPWORDS = new Set(
    ("a about above after again against all am an and any are as at be because been before being below between both but by " +
      "can did do does doing down during each few for from further had has have having he her here hers herself him himself " +
      "his how i if in into is it its itself just me more most my myself no nor not now of off on once only or other our ours " +
      "ourselves out over own same she so some such than that the their theirs them themselves then there these they " +
      "this those through to too under until up very was we were what when where which while who whom why with you your " +
      "yours yourself yourselves get got make makes made also into one two " +
      // Degree and frequency adverbs. These matter: rubric descriptors are full
      // of them ("should never be unsure"), they are rare inside any single
      // essay, and tf-idf therefore hands them enormous weight — which is how a
      // criterion called "Claim" ends up retrieving a sentence whose only tie to
      // it is the word "never".
      "never always ever even still really quite much many well back way ways thing things " +
      "able rather instead another every actually simply often sometimes usually upon").split(" ")
  );

  /* Deliberately absent from that list: should, would, could, will, must. In
     argumentative writing the modal IS the claim — stopword it and a criterion
     called "Claim" has nothing left to retrieve on. */

  /* Rubrics and student writing rarely use the same words for the same idea.
     A rubric says "evidence"; an essay says "a 2016 study found". These bridges
     are what stop the retrieval step from missing the obvious. */
  const SYNONYMS = {
    evidence: ["study", "data", "research", "statistic", "figure", "source", "quote", "found", "report", "survey", "percent", "cited"],
    source: ["study", "research", "according", "journal", "author", "cite", "reference"],
    claim: ["argue", "position", "thesis", "should", "must", "believe", "contend", "stance"],
    thesis: ["argue", "claim", "position", "should"],
    counterargument: ["however", "critic", "objection", "opponent", "although", "concede", "admit", "granted", "some", "argue"],
    counter: ["however", "critic", "objection", "opponent", "although", "concede", "admit"],
    objection: ["critic", "opponent", "however", "although", "concede"],
    analysis: ["because", "therefore", "means", "explain", "suggest", "show", "implies", "reason", "why"],
    reasoning: ["because", "therefore", "since", "means", "follows", "implies"],
    clarity: ["clear", "precise", "concise", "direct", "plain"],
    structure: ["first", "next", "finally", "paragraph", "conclusion", "introduction", "then"],
    organisation: ["first", "next", "finally", "paragraph", "conclusion"],
    mechanics: ["grammar", "spelling", "punctuation", "sentence"],
    method: ["procedure", "apparatus", "measured", "trial", "repeated", "sample", "prepared"],
    control: ["constant", "same", "varied", "variable", "kept"],
    hypothesis: ["predict", "expect", "because", "purpose", "test"],
    error: ["uncertainty", "parallax", "contamination", "overshoot", "bias", "systematic", "random", "imprecise"],
    impact: ["teacher", "student", "learn", "classroom", "school", "help", "problem", "hours"],
    ai: ["model", "engine", "inference", "embedding", "neural", "gemini", "llm", "trained", "algorithm"],
    execution: ["works", "runs", "stable", "deployed", "offline", "fallback", "interface", "latency", "tested"],
    demo: ["video", "walkthrough", "shows", "screen", "seconds", "explain"],
  };

  const HEDGES = [
    "maybe", "might", "probably", "possibly", "sort of", "kind of", "i think", "i feel", "somewhat", "fairly",
    "arguably", "perhaps", "seems", "appears", "a bit", "quite", "rather", "i guess", "or something", "pretty much",
  ];

  const CONNECTIVES = [
    "because", "therefore", "however", "although", "whereas", "since", "so that", "as a result", "which means",
    "in contrast", "even though", "consequently", "but", "yet", "instead", "rather than", "so", "thus",
  ];

  const CONCESSION = [
    "critics say", "critics argue", "some argue", "some people", "opponents", "objection", "on the other hand",
    "it could be argued", "admittedly", "granted", "some say", "might say", "one argument against", "the strongest objection",
  ];

  /* Not only modals. A fifteen-year-old stakes a position with "I think the ban
     is right" far more often than with "I argue that", and a detector that only
     recognises the formal register will report that the essay never took a side. */
  const CLAIM_VERBS = [
    "should", "must", "argue", "argues", "shows", "proves", "demonstrates", "means", "suggests", "implies",
    "causes", "leads to", "is why", "matters", "need to", "ought",
    "i think", "i believe", "in my view", "is right", "is wrong", "the real reason", "the better reason",
  ];

  /* "MacMillan argues that…" and "I think that…" both trip CLAIM_VERBS, but only
     one of them is the writer taking a position. When a passage contains both,
     the writer's own stance has to win, or the tool quotes a cited historian
     back at the student as though it were their thesis. */
  const OWN_STANCE = ["i think", "i believe", "in my view", "i would", "we should", "should", "must", "is right", "is wrong"];

  const VAGUE_SOURCE = ["studies show", "research shows", "everyone knows", "it is known", "experts say", "people say", "they say"];

  const hasAny = (sentence, phrases) => {
    const low = sentence.text.toLowerCase();
    return phrases.some((p) => low.includes(p));
  };

  /** The writer's own claim if there is one, otherwise any claim-shaped sentence. */
  function findStance(candidates) {
    return candidates.find((s) => hasAny(s, OWN_STANCE)) || candidates.find((s) => hasAny(s, CLAIM_VERBS)) || null;
  }

  /* -------------------------------- helpers -------------------------------- */

  /** Light suffix stemmer. Deliberately shallow: over-stemming collides words
      that a teacher would never consider the same, and this is a small corpus. */
  function stem(word) {
    let w = word;
    if (w.length > 5 && w.endsWith("ations")) return w.slice(0, -6);
    if (w.length > 4 && w.endsWith("ing")) w = w.slice(0, -3);
    else if (w.length > 4 && w.endsWith("ed")) w = w.slice(0, -2);
    else if (w.length > 4 && w.endsWith("ies")) return w.slice(0, -3) + "y";
    else if (w.length > 3 && w.endsWith("es")) w = w.slice(0, -2);
    else if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1);
    if (w.length > 5 && w.endsWith("ly")) w = w.slice(0, -2);
    if (w.length > 6 && w.endsWith("tion")) w = w.slice(0, -4) + "t";
    return w;
  }

  function tokenize(text) {
    const raw = String(text).toLowerCase().match(/[a-z][a-z'-]*/g) || [];
    const out = [];
    for (const t of raw) {
      const clean = t.replace(/^'+|'+$/g, "");
      if (clean.length < 3 || STOPWORDS.has(clean)) continue;
      out.push(stem(clean));
    }
    return out;
  }

  /* Sentence split that keeps offsets. Abbreviations and decimals would
     otherwise cut sentences in half ("0.1005 mol/L", "et al.", "Dr."). */
  function splitSentences(text) {
    const guarded = text
      .replace(/\b(Dr|Mr|Mrs|Ms|Prof|St|vs|etc|al|Fig|No|Inc|Ltd)\./g, (m) => m.replace(".", ""))
      .replace(/(\d)\.(\d)/g, "$1$2");

    const out = [];
    let start = 0;
    const re = /([.!?])(\s+|$)/g;
    let m;
    while ((m = re.exec(guarded)) !== null) {
      const end = m.index + 1;
      const slice = text.slice(start, end);
      if (slice.trim().length > 1) out.push({ start, end, text: slice.trim() });
      start = end + m[2].length;
    }
    if (start < text.length && text.slice(start).trim().length > 1) {
      out.push({ start, end: text.length, text: text.slice(start).trim() });
    }
    return out.map((s, i) => Object.assign({ i }, s));
  }

  /** Which sentence a character offset falls inside. Detector hits carry raw
      offsets; this is how a hit becomes something quotable. */
  function sentenceAt(sentences, charIndex) {
    for (const s of sentences) if (charIndex >= s.start && charIndex < s.end) return s;
    return null;
  }

  function countPhrases(lowerText, phrases) {
    const hits = [];
    for (const p of phrases) {
      let from = 0;
      for (;;) {
        const at = lowerText.indexOf(p, from);
        if (at === -1) break;
        hits.push({ phrase: p, at });
        from = at + p.length;
      }
    }
    return hits;
  }

  /* -------------------------------- tf-idf --------------------------------- */

  function buildSpace(sentences) {
    const df = new Map();
    const vectors = sentences.map((s) => {
      const tokens = tokenize(s.text);
      const tf = new Map();
      for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
      for (const t of tf.keys()) df.set(t, (df.get(t) || 0) + 1);
      return { tf, length: tokens.length };
    });

    const n = Math.max(sentences.length, 1);
    const idf = new Map();
    for (const [term, d] of df) idf.set(term, Math.log(1 + n / (1 + d)) + 1);

    const weighted = vectors.map((v) => {
      const vec = new Map();
      let norm = 0;
      for (const [t, c] of v.tf) {
        const w = (1 + Math.log(c)) * (idf.get(t) || 1);
        vec.set(t, w);
        norm += w * w;
      }
      norm = Math.sqrt(norm) || 1;
      for (const [t, w] of vec) vec.set(t, w / norm);
      return { vec, length: v.length };
    });

    return { idf, vectors: weighted };
  }

  function queryVector(terms, idf) {
    const tf = new Map();
    for (const t of terms) tf.set(t, (tf.get(t) || 0) + 1);
    const vec = new Map();
    let norm = 0;
    for (const [t, c] of tf) {
      const w = (1 + Math.log(c)) * (idf.get(t) || 1.35); // unseen terms still carry weight
      vec.set(t, w);
      norm += w * w;
    }
    norm = Math.sqrt(norm) || 1;
    for (const [t, w] of vec) vec.set(t, w / norm);
    return vec;
  }

  function cosine(a, b) {
    let sum = 0;
    const [small, large] = a.size < b.size ? [a, b] : [b, a];
    for (const [t, w] of small) {
      const other = large.get(t);
      if (other) sum += w * other;
    }
    return sum;
  }

  /* ------------------------------- signals -------------------------------- */

  /* Eight detectors over the whole work. Each returns a 0..1 reading plus the
     raw hits, because the write-up quotes the hits back at the teacher. */
  function readSignals(text, sentences) {
    const lower = text.toLowerCase();
    const words = (text.match(/[A-Za-z][A-Za-z'-]*/g) || []).length || 1;
    const per100 = (n) => (n / words) * 100;

    const hedgeHits = countPhrases(lower, HEDGES);
    const connectiveHits = countPhrases(lower, CONNECTIVES);
    const concessionHits = countPhrases(lower, CONCESSION);
    // "Some people might say…" trips both "some people" and "might say". Count
    // the sentences that concede, not the phrases, or one clause reads as two.
    const concessionSentences = new Set(
      concessionHits.map((h) => { const s = sentenceAt(sentences, h.at); return s ? s.i : -1; }).filter((i) => i >= 0)
    );
    const vagueHits = countPhrases(lower, VAGUE_SOURCE);

    // sourcing: a number with a unit or percent, a year, a named study, a quote
    const numbers = text.match(/\b\d[\d.,]*\s*(%|percent|mol\/L|mL|L|g|kg|cm|mm|s|hours|words)?/g) || [];
    const years = text.match(/\b(19|20)\d{2}\b/g) || [];
    const attributions = countPhrases(lower, ["according to", "found that", "study", "research by", "journal", "reported", "data shows", "et al"]);
    // “/” are the curly pair; writing them literally here collapsed to
    // two ASCII quotes, which silently disabled smart-quote detection for
    // anything pasted out of Word or Docs
    const quotes = text.match(/[“‘][^”’]{6,}[”’]|"[^"]{6,}"/g) || [];

    // proper nouns: capitalised words that are not sentence-initial
    let properNouns = 0;
    for (const s of sentences) {
      const inner = s.text.split(/\s+/).slice(1);
      for (const w of inner) if (/^[A-Z][a-z]{2,}/.test(w)) properNouns++;
    }

    const lengths = sentences.map((s) => (s.text.match(/\S+/g) || []).length);
    const mean = lengths.reduce((a, b) => a + b, 0) / (lengths.length || 1);
    const variance = lengths.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (lengths.length || 1);
    const sd = Math.sqrt(variance);

    const runOns = lengths.filter((l) => l > 42).length;
    const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim().length > 0);

    const clamp = (x) => Math.max(0, Math.min(1, x));

    return {
      words,
      sentenceCount: sentences.length,
      paragraphCount: paragraphs.length,

      sourcing: {
        score: clamp((attributions.length * 1.4 + years.length * 1.2 + quotes.length * 1.2 + numbers.length * 0.5) / 8),
        attributions, years, quotes, numbers,
      },
      specificity: {
        score: clamp((properNouns * 0.8 + numbers.length * 1.0) / 12),
        properNouns, numbers: numbers.length,
      },
      hedging: {
        // inverted: a high score means the writing commits
        score: clamp(1 - per100(hedgeHits.length) / 2.2),
        hits: hedgeHits, per100: per100(hedgeHits.length),
      },
      reasoning: {
        score: clamp(connectiveHits.length / Math.max(sentences.length * 0.8, 1)),
        hits: connectiveHits,
      },
      concession: {
        score: clamp(concessionSentences.size / 2),
        hits: concessionHits,
      },
      vagueSourcing: {
        score: clamp(1 - vagueHits.length / 2),
        hits: vagueHits,
      },
      variety: {
        score: clamp(sd / 9),
        sd, mean,
      },
      control: {
        score: clamp(1 - runOns / Math.max(sentences.length * 0.25, 1)),
        runOns,
      },
    };
  }

  /* ----------------------------- criterion type ---------------------------- */

  /* Order matters only for ties. "analysis" sits above "evidence" so that a
     criterion called "Data and analysis" is read as reasoning rather than as
     sourcing — a lab report's numbers are its own, not a citation. */
  const TYPE_RULES = [
    ["counter", ["counter", "opposing", "objection", "rebuttal", "alternative view", "other side"]],
    ["error", ["error", "uncertainty", "limitation", "sources of error"]],
    ["hypothesis", ["hypothes", "purpose", "predict", "aim"]],
    ["method", ["method", "procedure", "control", "apparatus", "replicat"]],
    ["clarity", ["clarity", "control", "mechanic", "grammar", "style", "convention", "concise"]],
    ["claim", ["claim", "thesis", "position", "argument", "stance"]],
    ["analysis", ["analysis", "reasoning", "explain", "interpret", "insight", "creative", "impact"]],
    ["evidence", ["evidence", "sourc", "cite", "citation", "data", "support", "research"]],
    ["structure", ["structure", "organis", "organiz", "sequence", "flow", "pitch", "demo"]],
  ];

  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  /* Matching has to respect word boundaries. Plain substring matching reads
     "Claim" as a hypothesis (it contains "aim") and "Clarity and control" as a
     method (it contains "control"), which then applies the wrong signals to the
     wrong criterion — a silent failure that still looks like a working result.
     Every rule is scored instead of first-match-wins, and the criterion's own
     name counts double because that is where the teacher put the real word. */
  function inferType(criterion) {
    const name = " " + String(criterion.name).toLowerCase() + " ";
    const body = " " + String(criterion.descriptor || "").toLowerCase() + " ";

    let best = "general";
    let bestScore = 0;
    for (const [type, keys] of TYPE_RULES) {
      let score = 0;
      for (const k of keys) {
        const re = new RegExp("\\b" + escapeRe(k), "i");
        if (re.test(name)) score += 2;
        else if (re.test(body)) score += 1;
      }
      if (score > bestScore) { bestScore = score; best = type; }
    }
    return best;
  }

  /* Which signals a criterion of each type actually depends on, and how much.
     Topical coverage always carries the largest single share: if the work never
     goes near the subject of the criterion, no amount of clean prose saves it. */
  const TYPE_WEIGHTS = {
    claim: { coverage: 0.55, hedging: 0.3, specificity: 0.15 },
    evidence: { coverage: 0.4, sourcing: 0.4, vagueSourcing: 0.2 },
    counter: { coverage: 0.35, concession: 0.5, reasoning: 0.15 },
    analysis: { coverage: 0.45, reasoning: 0.35, specificity: 0.2 },
    clarity: { coverage: 0.2, control: 0.3, variety: 0.25, hedging: 0.25 },
    structure: { coverage: 0.5, reasoning: 0.25, variety: 0.25 },
    method: { coverage: 0.5, specificity: 0.35, control: 0.15 },
    hypothesis: { coverage: 0.6, reasoning: 0.25, specificity: 0.15 },
    error: { coverage: 0.5, specificity: 0.3, reasoning: 0.2 },
    general: { coverage: 0.6, specificity: 0.2, reasoning: 0.2 },
  };

  /* -------------------------------- scoring -------------------------------- */

  const THRESHOLDS = { evidenced: 0.62, partial: 0.34 };
  const MARGIN_BAND = 0.07;

  function statusFor(score) {
    if (score >= THRESHOLDS.evidenced) return "evidenced";
    if (score >= THRESHOLDS.partial) return "partial";
    return "missing";
  }

  function marginFor(score) {
    return Math.min(Math.abs(score - THRESHOLDS.evidenced), Math.abs(score - THRESHOLDS.partial));
  }

  function expandTerms(criterion) {
    const base = tokenize(criterion.name + " " + criterion.descriptor);
    const extra = [];
    for (const t of criterion.lookFor || []) extra.push.apply(extra, tokenize(t));
    // pull synonym bridges for any rubric word that has one
    const seed = new Set(base.concat(extra));
    for (const key of Object.keys(SYNONYMS)) {
      if (seed.has(stem(key))) for (const s of SYNONYMS[key]) extra.push.apply(extra, tokenize(s));
    }
    // the criterion's own name is the strongest term: repeat it for weight
    const nameTokens = tokenize(criterion.name);
    return base.concat(extra, nameTokens, nameTokens);
  }

  /* NOTE: this returns a confidence that the work *evidences* the criterion.
     It is deliberately not a mark. Nothing downstream converts it to one, and
     the number is never shown to the user — only the band and the margin. */
  function scoreCriterion(criterion, sentences, space, signals) {
    const type = inferType(criterion);
    const q = queryVector(expandTerms(criterion), space.idf);

    const ranked = sentences
      .map((s, i) => ({ sentence: s, score: cosine(q, space.vectors[i].vec) }))
      .sort((a, b) => b.score - a.score);

    const floor = 0.045;
    const top = ranked.filter((r) => r.score > floor).slice(0, 3);
    const coverage = top.length
      ? Math.min(1, (top.reduce((a, r) => a + r.score, 0) / top.length) * 2.6)
      : 0;

    const weights = TYPE_WEIGHTS[type] || TYPE_WEIGHTS.general;
    let score = 0;
    for (const key of Object.keys(weights)) {
      const value = key === "coverage" ? coverage : (signals[key] ? signals[key].score : 0);
      score += value * weights[key];
    }
    score = Math.max(0, Math.min(1, score));

    /* A detector can fire on a phrase that topical retrieval ranked below the
       floor — "Some people might say…" is a textbook concession that shares
       almost no vocabulary with a rubric line about counterarguments. When that
       happens the sentence the detector actually landed on is promoted into the
       evidence, because a band with nothing to point at is exactly what this
       product exists to refuse. */
    const evidence = top.slice();
    const have = new Set(evidence.map((e) => e.sentence.i));
    for (const s of anchorSentences(type, signals, sentences)) {
      if (evidence.length >= 3) break;
      if (have.has(s.i)) continue;
      have.add(s.i);
      evidence.push({ sentence: s, score: Math.max(floor, 0.12), anchored: true });
    }
    evidence.sort((a, b) => a.sentence.start - b.sentence.start);

    return { type, score, coverage, evidence, ranked };
  }

  /** Sentences a type's own detectors physically landed on, in document order. */
  function anchorSentences(type, signals, sentences) {
    const hosts = [];
    const push = (hits) => {
      for (const h of hits || []) {
        const s = sentenceAt(sentences, h.at);
        if (s && !hosts.some((x) => x.i === s.i)) hosts.push(s);
      }
    };

    if (type === "counter") push(signals.concession.hits);
    else if (type === "evidence") { push(signals.sourcing.attributions); push(signals.vagueSourcing.hits); }
    else if (type === "clarity") push(signals.hedging.hits);
    else if (type === "analysis") push(signals.reasoning.hits);
    else if (type === "claim") {
      const opener = sentences.slice(0, 4);
      const own = opener.filter((s) => hasAny(s, OWN_STANCE));
      const any = opener.filter((s) => hasAny(s, CLAIM_VERBS));
      for (const s of own.concat(any)) if (!hosts.some((x) => x.i === s.i)) hosts.push(s);
    }
    return hosts.slice(0, 3);
  }

  /* ------------------------- written gap and next move ---------------------- */

  function firstWords(text, n) {
    const words = text.trim().split(/\s+/).slice(0, n).join(" ");
    return words + (text.trim().split(/\s+/).length > n ? "…" : "");
  }

  function sentenceContaining(sentences, phrase) {
    const p = phrase.toLowerCase();
    return sentences.find((s) => s.text.toLowerCase().includes(p)) || null;
  }

  /* Every string here is built from something the detectors actually found, so
     the teacher can check the claim against the text in front of them. */
  /* When a branch has nothing type-specific left to say, the move is derived
     from whichever signal that criterion actually depends on scored worst. It
     is still grounded in a measurement rather than being filler. */
  const SIGNAL_MOVES = {
    sourcing: "Attach a named source — author, year or dataset — to the claim doing the most work here.",
    vagueSourcing: "Swap the “studies show” phrasing for the study itself.",
    specificity: "Name one concrete thing: a number, a date, a case. It stays general at the moment.",
    hedging: "Cut the hedging and let the sentence stand without a cushion around it.",
    reasoning: "Finish one of these points with “because”. They are listed rather than argued.",
    concession: "Name the strongest argument against this, then answer it.",
    variety: "Vary the sentence lengths — a short one after a long one changes the pace.",
    control: "Split the longest sentence at its first “and”.",
    coverage: "Address this criterion directly. There is very little here for a marker to point at.",
  };

  /* Weakest relevant signal first, skipping any already spent on another
     criterion in this read — four criteria of similar type otherwise receive
     the same sentence four times, which tells the teacher nothing and looks
     like the tool gave up. */
  function fallbackMove(type, signals, usedMoves) {
    const weights = TYPE_WEIGHTS[type] || TYPE_WEIGHTS.general;
    const byScore = (a, b) => signals[a].score - signals[b].score;
    const relevant = Object.keys(weights).filter((k) => k !== "coverage" && signals[k]).sort(byScore);

    /* A type only carries two or three relevant signals, so a four-criterion
       rubric exhausts them. The tail lets the search keep going through every
       other detector rather than repeating a line it has already used. */
    const tail = Object.keys(SIGNAL_MOVES)
      .filter((k) => signals[k] && relevant.indexOf(k) === -1)
      .sort(byScore);

    const pick = relevant.concat(tail).find((k) => !usedMoves.has(k));
    if (!pick) return SIGNAL_MOVES.coverage;
    usedMoves.add(pick);
    return SIGNAL_MOVES[pick];
  }

  function writeNotes(criterion, result, sentences, signals, status, shared) {
    const s = signals;
    const gaps = [];
    const moves = [];

    switch (result.type) {
      case "evidence": {
        const vague = s.vagueSourcing.hits;
        if (vague.length) {
          const host = sentenceContaining(sentences, vague[0].phrase);
          gaps.push(
            "“" + vague[0].phrase + "” stands in for a source" +
            (vague.length > 1 ? " (" + vague.length + " times)" : "") + "."
          );
          if (host) moves.push("Replace “" + vague[0].phrase + "” in “" + firstWords(host.text, 7) + "” with the study's name and year.");
        }
        if (s.sourcing.attributions.length === 0 && s.sourcing.years.length === 0) {
          gaps.push("No sentence names where a fact came from — no author, year, journal or dataset appears anywhere.");
          moves.push("Pick the single claim doing the most work and attach one named source to it.");
        } else if (s.sourcing.years.length && s.sourcing.attributions.length) {
          gaps.push(
            s.sourcing.attributions.length + " attributions and " + s.sourcing.years.length +
            " dated references are present, which is why this reads as sourced."
          );
        }
        if (s.specificity.numbers === 0) {
          gaps.push("There are no figures in the work, so every claim rests on assertion alone.");
          moves.push("Add one number with its unit to the strongest claim.");
        }
        break;
      }

      case "counter": {
        if (!s.concession.hits.length) {
          gaps.push("No sentence introduces an opposing view. The reader never meets the other side.");
          moves.push("Add a paragraph that states the best argument against this position before answering it.");
        } else {
          const first = s.concession.hits[0];
          const host = sentenceContaining(sentences, first.phrase);
          const idx = host ? host.i : -1;
          const after = idx >= 0 ? sentences.slice(idx + 1, idx + 3) : [];
          const answered = after.some((x) => /\b(but|however|yet|still|even so|the problem|that said)\b/i.test(x.text));
          gaps.push(
            "An opposing view is raised at “" + firstWords(host ? host.text : first.phrase, 8) + "”" +
            (answered ? ", and the next sentences answer it." : ", but nothing after it answers the objection.")
          );
          if (!answered) moves.push("Follow that concession with the reason it does not overturn the argument.");
          if (s.concession.hits.length === 1 && answered) {
            moves.push("One objection is handled. Naming a second, harder one would show the position survives more than a single test.");
          }
        }
        break;
      }

      case "claim": {
        const opener = sentences.slice(0, 4);
        const host = findStance(opener);
        const soft = s.hedging.per100 > 1.6;
        const list = Array.from(new Set(s.hedging.hits.map((h) => h.phrase))).slice(0, 3);

        /* These three readings have to stay consistent with whatever band the
           scorer landed on, so each one describes the text rather than passing
           its own verdict. A gap that says "no position is taken" underneath a
           chip that says "Evidenced" destroys trust in both. */
        if (!host) {
          gaps.push("The opening paragraph describes the topic without taking a side.");
          moves.push("Put the position in the first paragraph, in one sentence, using “should” or “because”.");
        } else if (soft) {
          gaps.push(
            "A position does appear — “" + firstWords(host.text, 9) + "” — but the writing softens itself " +
            s.hedging.hits.length + " times (" + list.map((x) => "“" + x + "”").join(", ") +
            "), so it reads as a position the writer is not sure they hold."
          );
          moves.push("Cut the hedges around the main claim and let the sentence stand on its own.");
        } else {
          gaps.push("The position is stated early — “" + firstWords(host.text, 10) + "”");
          if (s.hedging.hits.length >= 3) {
            moves.push("The claim itself is clear; the hedges further down (" + list.map((x) => "“" + x + "”").join(", ") + ") are where it loses force.");
          }
        }
        break;
      }

      case "clarity": {
        if (s.control.runOns > 0) {
          gaps.push(s.control.runOns + " sentence" + (s.control.runOns > 1 ? "s run" : " runs") + " past 42 words.");
          moves.push("Split the longest sentence at its first “and”.");
        }
        if (s.variety.sd < 4.5) {
          gaps.push("Sentence length barely varies (spread of " + s.variety.sd.toFixed(1) + " words), so the prose flattens.");
          moves.push("Follow the next long sentence with a short one.");
        }
        if (s.hedging.per100 > 1.2) {
          gaps.push("Hedging runs at " + s.hedging.per100.toFixed(1) + " per 100 words.");
          moves.push("Delete every “" + (s.hedging.hits[0] ? s.hedging.hits[0].phrase : "maybe") + "” and see whether the sentence got worse. It usually did not.");
        }
        if (!gaps.length) gaps.push("Sentences vary and the writing commits. Nothing here is fighting the reader.");
        break;
      }

      case "analysis": {
        if (s.reasoning.hits.length < Math.max(2, s.sentenceCount * 0.25)) {
          gaps.push("Only " + s.reasoning.hits.length + " reasoning connectives across " + s.sentenceCount + " sentences — points sit next to each other rather than following from each other.");
          moves.push("Add “because” or “which means” to the two strongest points and finish the thought.");
        } else {
          gaps.push(s.reasoning.hits.length + " reasoning connectives carry the argument between points.");
        }
        if (s.specificity.score < 0.3) {
          gaps.push("The work stays general: few named things, few figures.");
          moves.push("Name one concrete case and walk through it.");
        }
        break;
      }

      case "error": {
        const named = /parallax|contaminat|overshoot|systematic|random|calibrat|residual|evaporat|impur/i.test(
          sentences.map((x) => x.text).join(" ")
        );
        if (!named) {
          gaps.push("No specific mechanism of error is named. “Human error” is not a source of error.");
          moves.push("Name one error, say which direction it pushes the result, and by roughly how much.");
        } else {
          const directional = /bias|higher|lower|push|overestimat|underestimat|nearer/i.test(
            sentences.map((x) => x.text).join(" ")
          );
          gaps.push("Specific mechanisms are named" + (directional ? ", and their direction on the result is stated." : ", but not which way each one moves the result."));
          if (!directional) moves.push("For each error named, say whether it raises or lowers the measured value.");
        }
        break;
      }

      case "hypothesis": {
        const joined = sentences.map((x) => x.text).join(" ");
        const predicts = /predict|expect|hypothes|should (be|come|give|produce)|i thought/i.test(joined);
        const reasoned = /because|since|based on|given that|as the label|works out to/i.test(joined);
        if (!predicts) {
          gaps.push("Nothing here commits to an outcome before the experiment runs.");
          moves.push("State the expected result as a number or a direction before the method section.");
        } else if (!reasoned) {
          gaps.push("A prediction is made, but no reason is attached to it — which makes it a guess rather than a hypothesis.");
          moves.push("Add the “because” to the prediction: what about the chemistry made you expect that value?");
        } else {
          gaps.push("The prediction is stated and reasoned, so the result has something to be measured against.");
        }
        break;
      }

      case "method": {
        if (s.specificity.numbers < 3) {
          gaps.push("The procedure is described without enough quantities to repeat it.");
          moves.push("Add volumes, concentrations and counts to each step.");
        } else {
          gaps.push(s.specificity.numbers + " quantities appear, which is enough to run this again.");
        }
        if (!/kept|constant|same|control|varied/i.test(sentences.map((x) => x.text).join(" "))) {
          gaps.push("Nothing states what was held constant.");
          moves.push("Add one sentence naming the controlled variables and the one that varied.");
        }
        break;
      }

      default: {
        if (result.coverage < 0.35) {
          gaps.push("The work barely touches the subject of this criterion.");
          moves.push("Address it directly — right now a marker has nothing to point at.");
        } else {
          gaps.push("The work engages with this, and the passages on the right are where it does.");
        }
        if (s.specificity.score < 0.3) moves.push("Ground it in one specific example rather than describing it in general.");
      }
    }

    /* The clarity, analysis and general branches read document-level signals, so
       two different criteria of the same type would otherwise be handed word-for-
       word identical feedback — which reads as a broken tool even when the bands
       are right. Anchoring each one to its own strongest passage keeps them
       distinct and tells the teacher where to look. */
    if (result.type === "clarity" || result.type === "analysis" || result.type === "general") {
      // Strongest match, not the earliest: evidence is held in document order
      // for reading, so taking [0] made every criterion quote the opening
      // sentence back at the teacher. usedAnchors then stops two criteria
      // landing on the same sentence, which reads as a broken tool even when
      // both matches are legitimate.
      const ranked = result.evidence.slice().sort((a, b) => b.score - a.score);
      const top = ranked.find((e) => !shared.anchors.has(e.sentence.i)) || ranked[0];
      if (top) {
        shared.anchors.add(top.sentence.i);
        gaps.unshift(
          (result.coverage >= 0.5 ? "The work meets this most directly at “" : "The closest the work comes to this is “") +
          firstWords(top.sentence.text, 9) + "”."
        );
      }
    }

    if (status === "missing" && !moves.length) {
      moves.push("Nothing in the work speaks to this yet. It needs to be written, not revised.");
    }
    /* Anything short of evidenced owes the reader a next move — that is the
       promise on the front of the box. */
    if ((status !== "evidenced" || result.borderline) && !moves.length) {
      moves.push(fallbackMove(result.type, signals, shared.moves));
    }
    if (!gaps.length) gaps.push("Nothing stands out as missing against this criterion.");

    return { gaps, moves: moves.slice(0, 3) };
  }

  /* --------------------------------- public -------------------------------- */

  function read(work, rubric) {
    const text = String(work || "");
    const sentences = splitSentences(text);
    if (!sentences.length) {
      return { ok: false, reason: "empty", criteria: [], signals: null, sentences: [] };
    }

    const space = buildSpace(sentences);
    const signals = readSignals(text, sentences);

    // shared across the whole read so no two criteria quote the same sentence
    // back, or fall through to the same generic next move
    const shared = { anchors: new Set(), moves: new Set() };

    const criteria = rubric.criteria.map((c) => {
      const result = scoreCriterion(c, sentences, space, signals);

      /* The invariant this whole product rests on: a criterion the reader
         cannot quote is not evidenced, whatever the signals said. Without this
         a strong detector reading can award a band with nothing behind it, and
         a marking tool that says "evidenced" and then cannot show you where is
         worse than one that says nothing at all. */
      const status = result.evidence.length ? statusFor(result.score) : "missing";
      const margin = result.evidence.length ? marginFor(result.score) : 1;
      result.borderline = result.evidence.length ? marginFor(result.score) < MARGIN_BAND : false;
      const notes = writeNotes(c, result, sentences, signals, status, shared);

      return {
        id: c.id,
        name: c.name,
        descriptor: c.descriptor,
        type: result.type,
        status,
        confidence: result.score,
        margin,
        borderline: margin < MARGIN_BAND,
        evidence: result.evidence.map((e) => ({
          start: e.sentence.start,
          end: e.sentence.end,
          text: e.sentence.text,
          strength: Math.min(1, e.score * 3),
        })),
        gaps: notes.gaps,
        moves: notes.moves,
      };
    });

    return { ok: true, reader: "close", criteria, signals, sentences };
  }

  global.CloseReader = { read: read, splitSentences: splitSentences, THRESHOLDS: THRESHOLDS };
})(window);
