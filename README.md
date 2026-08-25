# Second Reader

**A marking companion that never gives a grade.**

Paste a rubric and a piece of student work. It returns, per criterion, the exact
sentences in the work that evidence it, what is missing, and the single change
that would move it up a band. Every judgment is anchored to a quoted span you can
click. It never outputs a mark, because the mark is the teacher's call and the
evidence is what the teacher is actually short of.

Built for the [Prometheus August AI Challenge](https://august-ai-challenge-31059.devpost.com/)
(deadline 29 Aug 2026).

## Run it

No build step, no dependencies, no API key.

```bash
python mem/tools/serve.py 3506 second-reader
```

Then open `http://localhost:3506/`. Opening `index.html` directly off disk also
works — the whole thing is classic scripts and one stylesheet.

Views are hash-routed: `/` landing, `#login`, `#app`.

## The two readers

Two independent readers cover every submission, and the point is the disagreement.

**The close reader** (`js/engine.js`) runs entirely in the browser and is
deterministic — the same work against the same rubric returns the same result
every time, which is the minimum bar for anything a teacher is meant to trust.

1. Sentence segmentation that keeps character offsets, with guards for
   abbreviations and decimals (`0.1005 mol/L`, `et al.`)
2. Tokenising, stopwords, and a deliberately shallow suffix stemmer
3. A tf-idf space built over the sentences of *this* work
4. Each rubric criterion becomes a query vector from its own name and descriptor
   plus a synonym expansion, ranked against sentences by cosine similarity —
   that ranking is the evidence
5. Eight signal detectors: sourcing, vague sourcing, specificity, hedging,
   reasoning density, concession, sentence variety, sentence control
6. Criterion-type inference decides which of those signals actually count
7. Three bands, plus a distance-to-threshold margin that flags near-boundary reads

**The wide reader** (`js/readers.js`) is Gemini, constrained to a JSON schema
permitting three bands and verbatim quotes, and never asked for a number. Every
quote it returns is matched back onto the real document by offset; anything that
does not match is dropped rather than shown. It runs only when a key is set in
Settings — the key is stored in this browser and sent only to Google's API.

**Consensus** (`Readers.merge`) never averages. Agreement settles a criterion.
Disagreement is surfaced as *"needs a human"* with both readings side by side.
Averaging two disagreeing readers is how a marking tool becomes confidently wrong.

## The invariant

A criterion the reader cannot quote is not evidenced, whatever the signals said.
This is enforced in `read()` and it is the thing the whole product rests on — a
tool that says "evidenced" and then cannot show you where is worse than one that
says nothing.

## Files

```
index.html      three views in one page
styles.css      tokens, both themes, all components
js/data.js      three sample rubrics, four pieces of sample work
js/engine.js    the close reader
js/readers.js   the wide reader (Gemini) + consensus
js/session.js   local profiles, PINs salted and SHA-256 hashed
js/ui.js        theme, escaping, reveals, the marked-text renderer
js/landing.js   landing page + the live demo (real engine, not a recording)
js/auth.js      sign-in
js/app.js       the three-pane reader
js/main.js      hash router
```

## What it does not do

- It does not grade, and will not be talked into it.
- It cannot always tell the writer's claim from a cited author's. There is a
  first-person preference (`OWN_STANCE`) that handles the common case, not every case.
- The close reader is statistical, not semantic. It finds the sentences a marker
  would point at; it does not understand them.
- Google sign-in needs a client ID authorised for the deploy origin. Until then it
  says so instead of pretending. School SSO would need a server, which does not exist.

## Design notes

Type is **Open Runde** (SIL OFL, self-hosted in `fonts/`) — the rounded sans
acctual.com uses — with Newsreader kept for one job only: the student's essay in
the middle pane, where a reading serif genuinely helps.

The desk props in `props/` are **real transparent cutouts**, not photos with the
background blended away. All three (glasses, pen, paperclip) are cut from a
*single* overhead shoot, so the camera angle, the light direction and the shadow
direction agree across the whole hero. They were produced by flood-filling the
connected background from the image border — which preserves genuinely white
interiors like a spectacle lens — then removing the photograph's own soft shadow
in a narrow band around each object, and finally splitting the flat lay into
individual objects by connected component. Each one carries its own CSS
`drop-shadow`, so it needs no blend mode and works on both themes.

## Credits

Photography from Pexels (free licence, no attribution required).
