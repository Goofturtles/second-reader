/*
 * The landing page: the marquee, the six "inside" cards, and the FAQ, plus the
 * live preview of the real app.
 *
 * Each section's layout is noted where it is built. The preview is the actual
 * product in an iframe rather than a screenshot — a marking tool that shows you
 * a picture of itself working is asking for trust it has not earned.
 */

(function (global) {
  "use strict";

  const { esc, watchReveals } = global.UI;

  const MARQUEE = [
    "reads your words, not a template",
    "every answer points at a real line",
    "eight things it checks in the writing",
    "two readers, and it never splits the difference",
    "no mark, ever, on purpose",
    "keeps working with the internet off",
    "when they disagree, it tells you",
    "your standard, not a stock one",
  ];

  /* The six pieces. Card anatomy is Browserbase's: a typographic mockup on a
     faint grid up top, then an uppercase category, a body, and a pill. The
     mockup is written as real marked-up text because that IS the product —
     showing a highlighted sentence explains more than any icon would. */
  const PARTS = [
    {
      vis: 'Backs up claims with <mark>something real</mark>',
      cat: "Your list",
      n: "01",
      body: "Written the way you would say it out loud.",
    },
    {
      vis: 'A 2016 study found <mark>scores rose 6.4%</mark>',
      cat: "The close reader",
      n: "02",
      body: "Runs on your computer. No internet, same answer every time.",
    },
    {
      vis: 'Critics say a ban <mark class="m2">treats students</mark> like children',
      cat: "The second reader",
      n: "03",
      body: "A different model, reading the same essay against the same list.",
    },
    {
      vis: 'One says <mark>found it</mark>, one says <mark class="m3">half there</mark>',
      cat: "When they disagree",
      n: "04",
      body: "It says so, and hands that one back to you.",
    },
    {
      vis: '&ldquo;<mark>So the ban should stay.</mark>&rdquo;',
      cat: "The proof",
      n: "05",
      body: "Nothing is claimed without a line of the essay attached.",
    },
    {
      vis: 'Next time: <mark class="m2">cut the hedges</mark>',
      cat: "Handing it back",
      n: "06",
      body: "Feedback for the student, a summary for you. Neither has a mark.",
    },
  ];

  const FAQS = [
    ["Does it grade essays?", "No, and it cannot be talked into it. It says one of three things about each item on your list — the essay shows this, partly shows it, or does not — and then shows you the lines behind that answer. That is a statement about the writing. A grade is a statement about the child, and that belongs to someone who knows them."],
    ["What actually happens when I press Read it?", "The close reader splits the work into sentences and keeps their character offsets, tokenises and stems them, builds a tf-idf space over the sentences of that specific piece, turns each item on your list into a query from your own wording plus a synonym expansion, and ranks sentences by similarity. Those top sentences are the evidence. Then eight detectors measure sourcing, specificity, hedging, reasoning density, concession, vague attribution, sentence variety and control, and the kind of item decides which of those actually count."],
    ["Why two readers?", "Because one reader on its own is a guess with a confident voice. Two readers that work in completely different ways agree on the easy things and split on the hard ones. The split is the useful bit: it points at the one item worth your next five minutes."],
    ["Does my students' writing get sent anywhere?", "Only if you choose it. Out of the box everything runs in the page and nothing leaves the browser — the second reader uses Chrome's own on-device model when your browser has it. Adding a Gemini key in Settings is the only thing that sends an essay to a server, and the app always shows which readers ran."],
    ["Is this trying to replace teachers?", "It is trying to replace the third read-through. The one at nine at night, on essay 78 of 140, where you already know the mark and you are just hunting for the line that proves it. The judgement was never the slow part."],
    ["Can I use my own list?", "Yes, and that is the point. Press \u201cPaste your own\u201d in the reader, put one item per line as Name :: what you are looking for, drop in the essay, and it reads against yours. Essay lists, lab lists, or the one you happen to be holding right now."],
  ];

  /* ------------------------------- static bits ------------------------------ */

  function fillMarquee() {
    const host = document.getElementById("marquee");
    if (!host) return;
    const run = MARQUEE.map((t) => "<span>" + esc(t) + '<i aria-hidden="true">\u2726</i></span>').join("");
    host.innerHTML = run + run; // two passes so the -50% loop is seamless
  }

  function fillParts() {
    const host = document.getElementById("parts-grid");
    if (!host) return;
    /* `vis` is the only field written as markup rather than escaped: it is a
       fixed string in this file, never user or model input, and it carries the
       <mark> tags that make the card show a marked line instead of describing
       one. Everything else goes through esc(). */
    host.innerHTML = PARTS.map(
      (p, i) =>
        '<article class="part reveal" style="transition-delay:' + i * 50 + 'ms">' +
          '<div class="part-vis" aria-hidden="true">' +
            '<span class="part-fig">Fig. ' + (i + 1) + '</span>' +
            "<p>" + p.vis + "</p>" +
          "</div>" +
          '<div class="part-body">' +
            '<p class="part-cat">' + esc(p.cat) + "</p>" +
            "<p>" + esc(p.body) + "</p>" +
          "</div>" +
        "</article>"
    ).join("");
  }

  function fillFaq() {
    const host = document.getElementById("faq-list");
    if (!host) return;
    host.innerHTML = FAQS.map(
      (qa) =>
        '<details class="faq reveal"><summary>' + esc(qa[0]) +
        '<svg aria-hidden="true"><use href="#i-chev"/></svg></summary><p>' + esc(qa[1]) + "</p></details>"
    ).join("");
  }

  /* ------------------------------- hero preview ----------------------------- */

  function wirePreview() {
    const wrap = document.getElementById("preview");
    const play = document.getElementById("preview-play");
    const frame = document.getElementById("preview-frame");
    if (!wrap || !play || !frame) return;

    const load = () => {
      if (frame.dataset.loaded) return;
      frame.dataset.loaded = "1";
      frame.src = "index.html?example=1#app";
      frame.addEventListener("load", () => {
        try {
          frame.contentDocument.documentElement.setAttribute(
            "data-theme",
            document.documentElement.getAttribute("data-theme")
          );
        } catch (e) { /* same-origin only; fine either way */ }
      });
    };

    /* This iframe is a whole second copy of the document, so it waits until the
       preview is nearly on screen — with a timer backstop, because an observer
       that never fires leaves an empty rectangle where the product should be. */
    if ("IntersectionObserver" in global) {
      const io = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) { load(); io.disconnect(); }
      }, { rootMargin: "300px" });
      io.observe(wrap);
      setTimeout(load, 2500);
    } else {
      load();
    }

    /*
     * The whole stage takes the click, not just the pill.
     *
     * Someone looking at a screenshot of a running app clicks the app, not the
     * label underneath it - and with the frame inert, that click lands on the
     * stage anyway. The pill stays as the visible affordance and as a real
     * keyboard target; its click simply bubbles up to here.
     */
    const stage = document.getElementById("preview-stage");

    function handOver() {
      load();
      if (play) play.remove();
      frame.removeAttribute("inert");
      frame.removeAttribute("tabindex");
      if (stage) stage.classList.add("is-live");
      const card = wrap.querySelector(".preview-card");
      if (card) card.classList.remove("preview-float");
      frame.focus();
    }

    /* The pill is a real <button> stretched over the whole stage, so it is
       already the keyboard target and already catches a click anywhere on the
       preview. The listener sits on the stage only so that the click still
       lands if the pill has been removed or restyled. */
    if (stage) stage.addEventListener("click", handOver);
  }

  /* ------------------------------- the photographs --------------------------
   * Two of the pictures on this page are hotlinked, and this app is supposed
   * to open off disk with no network at all. Left alone, a failed load leaves
   * a 1040x390 hole with a broken-image icon and the alt text showing, and the
   * dark break goes on reserving 220px of padding for a band that is not
   * there. Neither picture carries meaning the page needs, so when one cannot
   * be fetched the page simply closes up around it.
   */
  function guardPhotos() {
    const plate = document.querySelector(".rows-plate");
    const plateImg = plate && plate.querySelector("img");
    if (plateImg) {
      const drop = () => plate.setAttribute("hidden", "");
      if (plateImg.complete && plateImg.naturalWidth === 0) drop();
      else plateImg.addEventListener("error", drop);
    }

    const dark = document.querySelector(".dark-plate");
    if (dark) {
      const drop = () => {
        dark.remove();
        const sec = document.getElementById("private");
        if (sec) sec.classList.add("no-plate");
      };
      if (dark.complete && dark.naturalWidth === 0) drop();
      else dark.addEventListener("error", drop);
    }
  }


  /* ------------------------------ the hero marks --------------------------
   *
   * A sentence from the invented example essay marks itself: wash, underline,
   * verdict chip, handwritten aside - then the next one. Three slides, three
   * states, so the hero teaches the vocabulary the legend repeats below.
   *
   * Everything here defers to prefers-reduced-motion: one slide, fully
   * settled, no cycle, no parallax.
   */
  const DEMO = [
    { pre: "", mark: "I think the ban is right, but not for the reason most people give.",
      post: "", tone: "var(--ok)", wash: "var(--hl-ok)",
      chip: "Claim \u00b7 found it", note: "states the position \u2014 and holds it" },
    { pre: "Everyone knows that phones are distracting and ",
      mark: "studies show", post: " that they make it harder to learn.",
      tone: "var(--mid)", wash: "var(--hl-mid)",
      chip: "Evidence \u00b7 half there", note: "\u201cstudies show\u201d is standing in for a source" },
    { pre: "", mark: "Some people might say that phones are useful for looking things up.",
      post: "", tone: "var(--flag)", wash: "var(--hl-flag)",
      chip: "Counterargument \u00b7 check this one", note: "the two readers disagree here" },
  ];

  function heroDemo() {
    const host = document.getElementById("hero-demo");
    if (!host) return;
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let at = 0, timer = null;

    const card = (d) =>
      '<div class="dm-card" style="--t:' + d.tone + ';--w:' + d.wash + ';--u:' + d.tone + '">' +
        '<p class="dm-quote">' + esc(d.pre) +
          '<span class="dm-mark">' + esc(d.mark) + "</span>" + esc(d.post) + "</p>" +
        '<div class="dm-foot">' +
          '<span class="dm-chip"><i></i>' + esc(d.chip) + "</span>" +
          '<span class="dm-note">' + esc(d.note) + "</span>" +
        "</div>" +
      "</div>" +
      '<div class="dm-dots">' + DEMO.map((_, i) =>
        "<i" + (i === at ? ' class="on"' : "") + "></i>").join("") + "</div>";

    const show = () => { host.innerHTML = card(DEMO[at]); };
    show();
    if (still) return;

    const advance = () => {
      const c = host.querySelector(".dm-card");
      if (c) c.classList.add("out");
      setTimeout(() => { at = (at + 1) % DEMO.length; show(); }, 330);
    };
    const arm = () => { timer = setInterval(advance, 4800); };
    arm();
    /* Hovering means reading; reading means do not yank it away. */
    host.addEventListener("mouseenter", () => { clearInterval(timer); timer = null; });
    host.addEventListener("mouseleave", () => { if (!timer) arm(); });
  }

  /* ------------------------------ the desk drifts -------------------------
   * Three depths, one lerp. Touch devices and reduced motion sit it out.
   */
  function heroParallax() {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (matchMedia("(hover: none)").matches) return;
    const hero = document.querySelector(".hero");
    if (!hero) return;
    const layers = [
      [document.querySelector(".prop-books"), 10],
      [document.querySelector(".prop-pen"), 16],
      [document.querySelector(".prop-specs"), 7],
    ].filter((p) => p[0]);
    if (!layers.length) return;

    let tx = 0, ty = 0, cx = 0, cy = 0, raf = null;
    const step = () => {
      cx += (tx - cx) * 0.06;
      cy += (ty - cy) * 0.06;
      for (const [el, depth] of layers) {
        el.style.transform = "translate(" + (cx * depth).toFixed(1) + "px," + (cy * depth).toFixed(1) + "px)";
      }
      if (Math.abs(tx - cx) + Math.abs(ty - cy) > 0.001) raf = requestAnimationFrame(step);
      else raf = null;
    };
    hero.addEventListener("mousemove", (e) => {
      const r = hero.getBoundingClientRect();
      tx = (e.clientX - r.left) / r.width - 0.5;
      ty = (e.clientY - r.top) / r.height - 0.5;
      if (!raf) raf = requestAnimationFrame(step);
    });
    hero.addEventListener("mouseleave", () => {
      tx = 0; ty = 0;
      if (!raf) raf = requestAnimationFrame(step);
    });
  }

  /* ---------------------------------- mount --------------------------------- */

  let built = false;
  function mount() {
    if (!built) {
      built = true;
      fillMarquee();
      fillParts();
      fillFaq();
      wirePreview();
      guardPhotos();
      heroDemo();
      heroParallax();
    }
    watchReveals(document.getElementById("view-landing"));
  }

  global.LandingView = { mount: mount };
})(window);
