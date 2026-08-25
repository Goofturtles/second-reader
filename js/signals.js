/*
 * Two closer looks at one piece of writing, both deterministic and both local.
 *
 *   readability()  how hard this is to read, and where it gets hard
 *   authorship()   patterns people associate with generated text
 *
 * ON THE SECOND ONE, PLAINLY.
 *
 * This is not an AI detector and it must never be turned into one. Detectors
 * that return a verdict are unreliable in a way that lands on real students:
 * they systematically over-flag people writing in a second language, and a
 * confident-looking percentage next to a child's name is acted on long before
 * anyone checks how it was produced. The whole point of this app is that a
 * claim you cannot point at is not a finding.
 *
 * So what this returns is measurements and nothing else. Every number here is
 * something a teacher could count by hand and verify on the page. Not one of
 * them means a person did or did not write something - short even sentences
 * are also what a student produces when they have been taught to write short
 * even sentences - and the module refuses to combine them into a score,
 * because the combination is exactly the thing that is not supported.
 *
 * The only honest next step is the one the UI says: talk to the writer about
 * how they wrote it.
 */

(function (global) {
  "use strict";

  /* Regex lookbehind below is Chrome 62+. This file is one IIFE, so on a
     browser without it the SyntaxError takes all of Signals with it. */

  const WORDS = (s) => (s.trim() ? s.trim().split(/\s+/) : []);

  function sentences(text) {
    return text
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 1);
  }

  /* Rough, and rough is enough: a syllable count that is right to within one
     on ordinary prose moves the grade estimate by a fraction of a year. */
  function syllables(word) {
    const w = word.toLowerCase().replace(/[^a-z]/g, "");
    if (w.length <= 3) return w.length ? 1 : 0;
    const groups = w
      .replace(/(?:[^laeiouy]es|[^aeiouytd]ed|[^laeiouy]e)$/, "")
      .replace(/^y/, "")
      .match(/[aeiouy]+/g);
    return groups ? groups.length : 1;
  }

  function mean(ns) {
    return ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : 0;
  }
  function stdev(ns) {
    if (ns.length < 2) return 0;
    const m = mean(ns);
    return Math.sqrt(mean(ns.map((n) => (n - m) * (n - m))));
  }

  /* --------------------------------- reading -------------------------------- */

  function readability(text) {
    if (typeof text !== "string") return null;
    const sents = sentences(text);
    const words = WORDS(text);
    if (sents.length < 2 || words.length < 30) return null;

    const syl = words.reduce((n, w) => n + syllables(w), 0);
    /* Every word scored zero, so the text is not in a script this counts.
       A grade level derived from that is a confident number about nothing. */
    if (!syl) return null;
    const wps = words.length / sents.length;
    const spw = syl / words.length;

    /* Flesch-Kincaid, which is a US grade level. It is a proxy for sentence
       length and word length and nothing more, so it is reported next to those
       two numbers rather than on its own. */
    const grade = Math.max(1, Math.round((0.39 * wps + 11.8 * spw - 15.59) * 10) / 10);

    const lengths = sents.map((s) => WORDS(s).length);
    const longest = sents
      .map((s, i) => ({ text: s, words: lengths[i] }))
      .sort((a, b) => b.words - a.words)
      .slice(0, 3)
      .filter((s) => s.words > 30)
      .map((s) => ({ words: s.words,
        text: s.text.length > 400 ? s.text.slice(0, 400) + "\u2026" : s.text }));

    /* "was written by", "is considered", "has been shown" - the shape of it,
       not a parser. Passive is not a fault; a page of it is worth seeing. */
    const passive = (text.match(/\b(?:is|are|was|were|be|been|being)\s+(?:\w+ly\s+)?\w+(?:ed|en)\b/gi) || []).length;

    /* Nouns made out of verbs. They are what makes a sentence feel official
       and say less: "the implementation of" instead of "implementing". */
    const nominal = (text.match(/\b\w{4,}(?:tion|ment|ance|ence|ity|ness)s?\b/gi) || []).length;

    return {
      grade: grade,
      wordsPerSentence: Math.round(wps * 10) / 10,
      syllablesPerWord: Math.round(spw * 100) / 100,
      words: words.length,
      sentences: sents.length,
      longest: longest,
      passive: passive,
      passivePer100: Math.round((passive / words.length) * 1000) / 10,
      nominal: nominal,
    };
  }

  /* ------------------------------- authorship ------------------------------- */

  /*
   * Each entry is a measurement plus what it is and is not evidence of. The
   * "note" is not decoration: a number handed over without it is the thing
   * this module exists to avoid.
   */
  function authorship(text) {
    if (typeof text !== "string") return null;
    const sents = sentences(text);
    const words = WORDS(text);
    if (sents.length < 6 || words.length < 120) return null;

    const lengths = sents.map((s) => WORDS(s).length);
    const sd = stdev(lengths);
    const avg = mean(lengths);
    const even = lengths.filter((n) => Math.abs(n - avg) <= 3).length;

    const years = (text.match(/\b(?:1[89]|20)\d{2}\b/g) || []).length;
    /* Years ARE numbers. Counting them in both made "5 numbers, 3 dates"
       claim eight specifics on a page that has five. */
    const numbers = Math.max(0, (text.match(/\b\d[\d,.]*\b/g) || []).length - years);
    /* A capitalised word that is not opening a sentence: a name, a place, a
       title. Crude, and it does not need to be better than crude. */
    /* Two lookbehinds: ". Word" and ".  Word" are both a new sentence, and
       only the first was excluded - which added a phantom name per sentence
       for anybody who double-spaces after a full stop. */
    const proper = (text.match(/(?<!^)(?<![.!?]\s)(?<![.!?]\s\s)\b[A-Z][a-z]{2,}/gm) || []).length;
    const quotes = (text.match(/["“][^"”]{12,}["”]/g) || []).length;

    const first = (text.match(/\b(?:I|my|me|we|our|us)\b/gi) || []).length;
    const hedges = (text.match(/\b(?:might|maybe|perhaps|possibly|arguably|seems?|somewhat|fairly|relatively)\b/gi) || []).length;

    const paras = text.split(/\n\s*\n/).map((p) => WORDS(p).length).filter((n) => n > 20);
    const paraSd = stdev(paras);

    const content = words
      .map((w) => w.toLowerCase().replace(/[^a-z]/g, ""))
      .filter((w) => w.length > 5);
    const counts = {};
    content.forEach((w) => { counts[w] = (counts[w] || 0) + 1; });
    const distinct = Object.keys(counts);
    /* Words appearing exactly once, which is what the row claims. It used to
       report distinct/total, so "apple apple apple" said 33% appeared once
       when the honest answer is none of them - a teacher checking by hand
       would have got a different number, and that is the one failure this
       file cannot have. */
    const once = distinct.filter((w) => counts[w] === 1).length;
    const variety = distinct.length ? Math.round((once / distinct.length) * 100) : 0;

    return {
      rows: [
        {
          label: "Sentence length",
          value: Math.round(avg) + " words, give or take " + Math.round(sd),
          detail: even + " of " + sents.length + " sentences are within three words of the average.",
          note: "Writing that varies more is often described as more human. It is also what happens when somebody is not writing to a formula — including a student who has been taught one.",
          flat: sd < 4.5,
        },
        {
          label: "Things you could check",
          value: numbers + " numbers, " + years + " dates, " + proper + " names, " + quotes + " quotations",
          detail: "Specifics are the part of an essay a reader can go and verify.",
          note: "Few of them means the writing stays general. That is a weakness worth marking on its own terms, whoever wrote it.",
          flat: numbers + years + proper + quotes < 4,
        },
        {
          label: "The writer in the writing",
          value: first + " first-person words, " + hedges + " hedges",
          detail: "Where the author commits, doubts, or shows their hand.",
          note: "Absence is a style, not a signature. Plenty of school writing is taught to remove exactly this.",
          flat: first + hedges < 3,
        },
        {
          label: "Paragraph lengths",
          value: paras.length ? paras.join(", ") + " words" : "one block",
          detail: paras.length > 2 ? "Spread of " + Math.round(paraSd) + " words." : "Not enough paragraphs to compare.",
          note: "Very even paragraphs can mean a template. A five-paragraph essay is also a template, and it is one we teach.",
          flat: paras.length > 2 && paraSd < 12,
        },
        {
          label: "Word variety",
          value: variety + "% of the distinct long words appear only once",
          detail: once + " of " + distinct.length + " distinct long words appear once, out of "
        + content.length + " in all.",
          note: "Very high variety with no repetition can read as generated. Repeating your key terms is also just good argument writing.",
          flat: variety > 88,
        },
      ],
    };
  }

  global.Signals = { readability, authorship, sentences };
})(window);
