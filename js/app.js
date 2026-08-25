/*
 * The reader itself.
 *
 * Two panes: the essay on the left, and on the right one list of the things the
 * teacher is looking for. Opening an item shows its lines, its gap and its next
 * move underneath, and marks only that item's evidence in the essay — so the
 * page never becomes a rainbow nobody can read.
 */

(function (global) {
  "use strict";

  const { esc, el, chip, TONE, LABEL, renderMarked, toast, modal, copy } = global.UI;

  /* Teacher and student get the same engine and different words for it. */
  const ROLE = {
    teacher: {
      list: "Your checklist",
      hint: "What should the writing do? One line each.",
      add: "Add something to look for",
      stepList: "Write your checklist",
      stepWork: "Put the student\u2019s essay in",
      titleHint: "Untitled essay",
      docHint: "Start writing, or paste the essay here\u2026",
      copyA: "Write the feedback",
    },
    student: {
      list: "What it should do",
      hint: "What is your teacher looking for? One line each.",
      add: "Add something it should do",
      stepList: "Write what it should do",
      stepWork: "Put your essay in",
      titleHint: "Untitled essay",
      docHint: "Start writing, or paste your essay here\u2026",
      copyA: "Write the feedback",
    },
  };
  function roleCopy() {
    return ROLE[Session.role()];
  }

  /*
   * WHICH TOOLS EACH PERSON GETS.
   *
   * The six tabs used to be a hardcoded array in paintTabs and static markup in
   * index.html, so there was nowhere to record who a tool was for. This is that
   * place. `roles` is the whole point of the table; everything else is what
   * setTab and paintTabs already needed.
   *
   * A teacher works ACROSS a set - one rubric, thirty essays, and the job is
   * triage and consistency. A student works DOWN one essay over time, and the
   * job is knowing what to change next. That is why Class is not a student tool
   * and why Drafts matters more to a student than to anybody.
   */
  const TOOLS = [
    { id: "evidence", label: "Evidence", roles: ["teacher", "student"] },
    { id: "feedback", label: "Feedback", roles: ["teacher", "student"] },
    { id: "ask", label: "Ask", roles: ["teacher", "student"] },
    { id: "signals", label: "Signals", roles: ["teacher", "student"] },
    { id: "class", label: "Class", roles: ["teacher"] },
    { id: "drafts", label: "Drafts", roles: ["teacher", "student"] },
  ];

  function toolsFor(r) {
    const who = r || Session.role();
    return TOOLS.filter((t) => t.roles.indexOf(who) !== -1);
  }

  function toolAllowed(id) {
    return toolsFor().some((t) => t.id === id);
  }

  /*
   * Changing role changes the wording, the tool strip, and possibly the tab you
   * are standing on - so everything that reads the role has to be repainted,
   * and setTab has to be given a chance to fall back if the current tool has
   * just been taken away.
   */
  function setRole(next) {
    const value = Session.setLocalRole(next);
    paintRoleCopy();
    paintRail();
    setTab(state.tab);
    render();
    toast(value === "student"
      ? "Student tools. Class is a teacher's view, so it is put away."
      : "Teacher tools. Class is back.");
    return value;
  }

  /*
   * There is always a checklist and always a document. Both start empty.
   *
   * They used to start null and every painter guarded for it — and the guards
   * were the bug. One of them read state.rubric.criteria a line above its own
   * null check, threw on boot, and took the input handlers down with it, which
   * is why nothing could be typed into the app at all. An empty rubric says
   * exactly what null said and cannot throw.
   */
  function blankRubric() {
    return { id: "own-rubric", name: "Your checklist", context: "", level: "", criteria: [] };
  }
  /* The level is a statement about the WRITER, not about the work, and the
     prompt built from it can only move the bar for evidence - never produce a
     mark. "Not said" is first and is the default: guessing a year group from
     nothing would be worse than reading without one. */
  const LEVELS = [
    ["", "Not said"],
    ["a student in about Year 7 or Grade 6, roughly 11 years old", "Year 7 · Grade 6"],
    ["a student in about Year 8 or Grade 7, roughly 12 years old", "Year 8 · Grade 7"],
    ["a student in about Year 9 or Grade 8, roughly 13 years old", "Year 9 · Grade 8"],
    ["a student in about Year 10 or Grade 9, roughly 14 years old", "Year 10 · Grade 9"],
    ["a student in about Year 11 or Grade 10, roughly 15 years old", "Year 11 · Grade 10"],
    ["a student in about Year 12 or Grade 11, roughly 16 years old", "Year 12 · Grade 11"],
    ["a student in about Year 13 or Grade 12, roughly 17 years old", "Year 13 · Grade 12"],
    ["a first-year undergraduate", "First-year undergraduate"],
    ["an undergraduate in their final year", "Final-year undergraduate"],
    ["an adult learner returning to study", "Adult learner"],
  ];

  function levelOptions(current) {
    return LEVELS.map(function (row) {
      return '<option value="' + esc(row[0]) + '"' +
        (row[0] === (current || "") ? " selected" : "") + ">" + esc(row[1]) + "</option>";
    }).join("");
  }

  function levelLabel(value) {
    for (const row of LEVELS) if (row[0] === value && row[0]) return row[1];
    return "";
  }

  /* A typed model name gives the same error whether it is a typo or a model
     that has been retired, and the difference matters when someone is working
     out why their key stopped working. A stored value that is not on this list
     is kept and shown rather than silently replaced - the list is a
     convenience, not a whitelist. */
  const MODELS = [
    ["gemini-2.5-flash", "Gemini 2.5 Flash — the default, fast and cheap"],
    ["gemini-2.5-pro", "Gemini 2.5 Pro — slower, better on long essays"],
    ["gemini-2.5-flash-lite", "Gemini 2.5 Flash-Lite — cheapest"],
    ["gemini-2.0-flash", "Gemini 2.0 Flash"],
    ["gemini-2.0-flash-lite", "Gemini 2.0 Flash-Lite"],
  ];

  function modelOptions(current) {
    const list = MODELS.slice();
    if (current && !list.some(function (row) { return row[0] === current; })) {
      list.push([current, current + " — saved earlier"]);
    }
    return list.map(function (row) {
      return '<option value="' + esc(row[0]) + '"' +
        (row[0] === current ? " selected" : "") + ">" + esc(row[1]) + "</option>";
    }).join("");
  }

  function blankWork() {
    return { id: "own-work", rubricId: "own-rubric", label: "Your essay", title: "", meta: "", text: "" };
  }

  const state = {
    rubric: blankRubric(),
    work: blankWork(),
    result: null,
    selected: null,
    reading: false,
    second: { state: "idle" },
    mode: "write", // "write" while you type in it, "read" once it carries marks
    stale: false,  // the text moved under a result that is still on screen
    tab: "evidence",
    entryId: null, // the shelf entry this page is, once it has been saved
  };

  /* Cmd on a Mac, Ctrl everywhere else. */
  const MODKEY = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || "") ? "⌘" : "Ctrl+";

  let mounted = false;
  let readToken = 0;
  let critSeq = 0;
  let docTimer = null;
  let saveTimer = null;

  /** Criterion ids come from pasted rubrics, so they are not guaranteed safe
      inside a selector. */
  function cssEscape(v) {
    if (global.CSS && CSS.escape) return CSS.escape(v);
    return String(v).replace(/["\\]/g, "\\$&");
  }

  function pickSelection() {
    if (state.selected && state.result.criteria.some((c) => c.id === state.selected)) return;
    const flagged = state.result.criteria.find((c) => c.flagged);
    state.selected = (flagged || state.result.criteria[0]).id;
  }

  /* ------------------------------- what is in ------------------------------- */

  /* A criterion with no name is a row someone is still typing, not a thing to
     look for. Everything downstream reads this, never the raw array. */
  function liveCriteria() {
    return state.rubric.criteria.filter((c) => c.name.trim());
  }
  function docText() {
    return state.work.text.trim();
  }
  function ready() {
    return liveCriteria().length > 0 && docText().length >= 40;
  }

  function loadExample() {
    const r = RUBRICS[0];
    const w = WORKS.find((x) => x.rubricId === r.id);
    state.rubric = { id: "own-rubric", name: r.name, context: r.context,
      criteria: r.criteria.map((c) => ({ id: c.id, name: c.name, descriptor: c.descriptor, lookFor: c.lookFor })) };
    state.work = { id: "own-work", rubricId: "own-rubric", label: w.label, title: w.title, meta: w.meta, text: w.text };
    state.result = null; state.selected = null; state.stale = false; state.mode = "write";
  }

  /* --------------------------------- reading -------------------------------- */

  async function runRead() {
    if (state.reading) return;

    /* Say which of the two halves is missing and put the caret in it, rather
       than refusing with a disabled button and no explanation. */
    const crits = liveCriteria();
    if (!crits.length) {
      toast("Add at least one thing to look for.");
      showRail();
      const first = document.querySelector("#crits .crit-name");
      if (first) first.focus(); else addCriterion();
      return;
    }
    if (docText().length < 40) {
      toast("Put the essay in first.");
      setMode("write");
      const d = document.getElementById("doc");
      if (d) d.focus();
      return;
    }

    state.reading = true;
    paintReadButton();

    const rubric = { id: state.rubric.id, name: state.rubric.name, context: state.rubric.context,
                     level: state.rubric.level || "", criteria: crits };
    state.work.meta = docText().split(/\s+/).length + " words";

    // the close reader is synchronous and fast; yield once so the spinner paints
    await new Promise((r) => setTimeout(r, 16));
    const close = CloseReader.read(state.work.text, rubric);

    if (!close.ok) {
      state.reading = false;
      paintReadButton();
      toast("There is nothing to read yet.");
      return;
    }

    /* Paint the close reader's answer immediately. The second reader can take
       several seconds on-device, and making a teacher stare at a spinner for
       results that are already computed is the wrong trade. */
    const token = ++readToken;
    /* The log used to be wiped here. Re-reading an essay after an edit is a
       normal thing to do, and losing the conversation every time you did it
       made the assistant not worth talking to. */
    paintAsk();
    state.result = Readers.merge(close, null);
    state.result.signals = close.signals;
    pickSelection();
    state.reading = false;
    state.stale = false;
    state.second = { state: "working", step: null };
    state.mode = "read";
    setTab("evidence");
    render();

    const wide = await Readers.readSecond(state.work.text, rubric, {
      // lets the reader abandon its session the moment a newer read starts,
      // instead of two on-device sessions fighting each other
      cancelled: () => token !== readToken,
      /* Handing the close reader's answer over is what lets readSecond put any
         difference between the two of them back to the second reader before it
         is reported as a disagreement. Without this, a borderline criterion
         flags or does not flag depending on how the model sampled that run,
         and the same essay reads differently after a refresh. */
      close: close,
      onStep: (i, n, name) => {
        if (token !== readToken) return;
        state.second = { state: "working", step: name, i: i + 1, n: n };
        paintChips();
      },
    });

    // a newer read started while this one was thinking; its answer is stale
    if (token !== readToken) return;

    state.second = { state: wide.ok ? "done" : "off", reason: wide.reason || null };
    state.result = Readers.merge(close, wide.ok ? wide : null);
    state.result.signals = close.signals;
    pickSelection();
    render();
    /* Kept the moment there is something worth keeping, so there is no Save
       button to forget and no way to lose a read by closing the tab. */
    autoSave();

    if (wide.ok && wide.cloudFailed === "bad-key") {
      toast("That key was rejected — this read came from your device instead.");
    } else if (!wide.ok) {
      if (wide.reason === "cancelled") { /* superseded by a newer read */ }
      else if (wide.reason === "bad-key") toast("That key was rejected. The close reader still ran.");
      else if (String(wide.reason).indexOf("http-429") === 0) toast("That key is out of quota. The close reader still ran.");
      else if (wide.reason === "offline") toast("No connection — the close reader ran alone.");
      else if (wide.reason === "downloadable") toast("Chrome can run the second reader on-device. Turn it on in Settings.");
    } else if (wide.reader === "device") {
      toast("Second reader ran on your device. Nothing was sent anywhere.");
    }
  }

  function paintReadButton() {
    const btn = document.getElementById("btn-read");
    if (!btn) return;
    btn.disabled = state.reading;
    btn.innerHTML = state.reading
      ? '<i class="spin"></i> Reading'
      : state.stale ? "Read it again" : "Read it";
    /* Lit only when pressing it would do something new. A primary button that
       is always lit stops meaning anything. */
    btn.classList.toggle("is-ready", !state.reading && ready() && (!state.result || state.stale));
  }

  /* -------------------------------- rendering ------------------------------- */

  /* Everything that reflects state but does not rebuild the rows people are
     typing into. paintRail is deliberately NOT here \u2014 re-rendering an input
     under a live caret throws the caret to the start of the line. */
  function render() {
    paintRoleCopy();
    paintCounts();
    paintReadButton();
    paintChips();
    paintDoc();
    paintCovStrip();
    paintStart();
    paintStale();
    paintModes();
    paintFindings();
    paintFeedback();
    paintRailStatus();
    paintTabs();
    paintAskSource();
    paintEssayTitle();
    /* The log is state like anything else. Repainting it only at the few
       call sites that happened to remember meant switching essays could leave
       the previous one's conversation on screen. */
    paintAsk();
  }

  /* The colour a criterion carries in "All" view and on the coverage map. It is
     its position in the checklist, so the two features agree with each other
     and with the order the teacher typed. */
  function critIndex(id) {
    return state.rubric.criteria.findIndex((c) => c.id === id);
  }

  function paintRoleCopy() {
    const c = roleCopy();
    const set = (id, prop, val) => { const n = document.getElementById(id); if (n) n[prop] = val; };
    set("rail-title", "textContent", c.list);
    set("rail-hint", "textContent", c.hint);
    set("crit-add-label", "textContent", c.add);
    set("doc-title", "placeholder", c.titleHint);
    const doc = document.getElementById("doc");
    if (doc) doc.setAttribute("data-placeholder", c.docHint);
  }

  /* ------------------------------ the checklist ----------------------------- */

  /*
   * 7shifts’ task list, which is the pattern this is taken from, never has an
   * "edit" state: the rows are the inputs, and a ghost row waits at the bottom
   * of the list. There is nothing to open, nothing to save, and the thing you
   * are looking at is the thing you are changing.
   */
  function paintRail() {
    const host = document.getElementById("crits");
    if (!host) return;

    host.innerHTML = state.rubric.criteria.map((c, i) =>
      '<div class="crit" data-i="' + i + '" data-c="' + (i % 6) + '">' +
        '<span class="crit-dot" aria-hidden="true"></span>' +
        '<div class="crit-fields">' +
          '<input class="crit-name" data-i="' + i + '" data-f="name" value="' + esc(c.name) +
            '" placeholder="Name it \u2014 e.g. Counterargument" maxlength="80" aria-label="Name">' +
          '<textarea class="crit-desc" rows="1" data-i="' + i + '" data-f="descriptor"' +
            ' placeholder="What are you looking for?" maxlength="240" aria-label="What to look for">' +
            esc(c.descriptor) + "</textarea>" +
        "</div>" +
        '<button class="crit-del" data-del="' + i + '" aria-label="Remove ' + esc(c.name || "this one") + '">' +
          '<svg aria-hidden="true"><use href="#i-trash"/></svg></button>' +
      "</div>"
    ).join("");

    host.querySelectorAll("[data-f]").forEach((inp) => {
      grow(inp);
      inp.addEventListener("input", () => {
        grow(inp);
        const c = state.rubric.criteria[Number(inp.getAttribute("data-i"))];
        if (!c) return;
        const field = inp.getAttribute("data-f");
        c[field] = inp.value;
        /* The preset criteria carry hand-tuned keyword lists. Once the name is
           the user\u2019s own words those lists describe something else, so they go
           and the engine infers the type from the name instead. */
        if (field === "name") c.lookFor = [];
        markStale();
        paintCounts();
        paintReadButton();
        if (!state.result) paintFindings();
      });
      inp.addEventListener("keydown", (e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        if (inp.getAttribute("data-f") === "name") {
          const desc = inp.parentNode.querySelector(".crit-desc");
          if (desc) return desc.focus();
        }
        addCriterion();
      });
    });

    host.querySelectorAll("[data-del]").forEach((b) =>
      b.addEventListener("click", () => {
        state.rubric.criteria.splice(Number(b.getAttribute("data-del")), 1);
        markStale();
        paintRail();
        paintCounts();
        paintReadButton();
      })
    );

    /* Measured once more after layout settles. The first pass runs before the
       webfont has swapped in, and a textarea sized against the fallback font
       comes out one line short. */
    requestAnimationFrame(() => host.querySelectorAll("[data-f]").forEach(grow));

    paintRailStatus();
  }

  /* The result colours the rows without rebuilding them. */
  function paintRailStatus() {
    const rows = document.querySelectorAll("#crits .crit");
    rows.forEach((row, i) => {
      const c = state.rubric.criteria[i];
      const found = state.result && c ? state.result.criteria.find((x) => x.id === c.id) : null;
      row.setAttribute("data-tone", found ? (found.flagged ? "flag" : TONE[found.status]) : "idle");
      row.classList.toggle("is-open", !!(found && found.id === state.selected));
    });
  }

  /* A textarea that stays exactly as tall as its own text. */
  function grow(node) {
    if (node.tagName !== "TEXTAREA") return;
    node.style.height = "auto";
    node.style.height = node.scrollHeight + "px";
  }

  function addCriterion(seed) {
    const c = seed || { name: "", descriptor: "", lookFor: [] };
    if (!c.id) c.id = "c" + ++critSeq;
    state.rubric.criteria.push(c);
    paintRail();
    paintCounts();
    paintReadButton();
    const names = document.querySelectorAll("#crits .crit-name");
    const last = names[names.length - 1];
    if (last) last.focus();
    return last;
  }

  function showRail() {
    const body = document.querySelector(".app-body");
    if (body && body.classList.contains("no-rail")) toggleRail();
  }

  function toggleRail() {
    const body = document.querySelector(".app-body");
    const btn = document.getElementById("btn-rail");
    if (!body || !btn) return;
    const hidden = body.classList.toggle("no-rail");
    btn.setAttribute("aria-expanded", hidden ? "false" : "true");
    btn.setAttribute("aria-label", hidden ? "Show the checklist" : "Hide the checklist");
  }

  /* -------------------------------- the counts ------------------------------ */

  /* Grammarly’s status strip: the numbers a person actually wants while they
     are looking at a page of writing, on one thin line under it. */
  function paintCounts() {
    const text = docText();
    const words = text ? text.split(/\s+/).length : 0;
    const sentences = text ? (text.match(/[.!?]+(\s|$)/g) || []).length : 0;
    const mins = Math.max(1, Math.round(words / 200));
    const count = document.getElementById("doc-count");
    if (count) {
      count.textContent = words
        ? words + (words === 1 ? " word" : " words") + " \u00b7 " +
          sentences + (sentences === 1 ? " sentence" : " sentences") + " \u00b7 " + mins + " min read"
        : "Nothing to read yet";
    }

    const n = liveCriteria().length;
    const rc = document.getElementById("rubric-count");
    if (rc) rc.textContent = n ? n + (n === 1 ? " thing" : " things") : "nothing yet";

    const tc = document.getElementById("tab-count");
    if (tc) {
      tc.hidden = !state.result;
      if (state.result) {
        const cs = state.result.criteria;
        const found = cs.filter((c) => c.status === "evidenced").length;
        tc.textContent = found + "/" + cs.length;
        /* The panel behind this tab already draws these three states as a bar.
           The tab was the only thing in the shell not saying which one it is. */
        /* Anything flagged means two readers disagreed and a person still has
           to look, so this is not the all-clear however many were evidenced.
           The badge said 4/4 in green in exactly the state the product exists
           to surface. */
        const anyFlag = cs.some((c) => c.flagged);
        const tone = anyFlag ? "t-mid" : found === cs.length ? "t-ok" : found ? "t-mid" : "t-none";
        tc.className = "tab-count " + tone;
      }
    }

    /* "Check this one" is the state the whole two-reader architecture exists to
       produce, and until now the shell only mentioned it if the Evidence panel
       happened to be the open one. */
    const evTab = document.getElementById("tab-evidence");
    if (evTab) {
      evTab.classList.toggle(
        "has-flag",
        !!(state.result && state.result.criteria.some((c) => c.flagged))
      );
    }
  }

  function markStale() {
    if (!state.result || state.stale) return;
    state.stale = true;
    paintStale();
    paintReadButton();
  }
  function paintStale() {
    const s = document.getElementById("doc-stale");
    if (s) s.hidden = !state.stale;
  }

  /*
   * One pill, not two.
   *
   * Two long chips reading "Close reader - on your device" and "Second reader -
   * 3 of 4 on your device" said nearly the same thing twice and took a third of
   * the bar to do it. The close reader is always on and always local, so saying
   * so every time is noise; what changes is the second reader, so that is what
   * the pill reports. It is a button, because the readers are a setting and the
   * thing that reports them should be the way in to changing them.
   */
  function paintChips() {
    const pill = document.getElementById("reader-pill");
    const label = document.getElementById("reader-label");
    if (!pill || !label) return;

    const sec = state.second || { state: "idle" };
    const which = state.result && state.result.readers ? state.result.readers.which : null;
    const reason = state.result && state.result.readers ? state.result.readers.wideReason : null;

    let cls = "off", text = "One reader", title = "Only the close reader ran. It is deterministic and runs in this page.";

    if (sec.state === "warming") {
      cls = "busy"; text = "Getting ready" + (sec.pct ? " " + sec.pct + "%" : "");
      title = "Chrome is preparing the on-device model.";
    } else if (sec.state === "working") {
      cls = "busy";
      text = sec.step ? "Reading " + sec.i + " of " + sec.n : "Reading";
      title = "The second reader is going through your checklist.";
    } else if (which === "device") {
      const r = state.result.readers;
      const partial = r.answered != null && r.asked != null && r.answered < r.asked;
      cls = "live";
      text = partial ? "Two readers \u00b7 " + r.answered + " of " + r.asked : "Two readers";
      title = "Close reader plus Chrome\u2019s built-in model, both on this computer. Nothing was uploaded.";
    } else if (which === "wide") {
      cls = "live"; text = "Two readers";
      title = "Close reader on this computer, second reader via Gemini.";
    } else if (reason === "downloadable" || reason === "downloading") {
      text = "One reader"; title = "Chrome can run a second reader here, but the model needs downloading once.";
    } else if (reason === "bad-key") {
      cls = "warn"; text = "Key rejected"; title = "That Gemini key was refused. The close reader still ran.";
    } else if (reason === "offline") {
      text = "One reader"; title = "No connection, so only the close reader ran.";
    } else if (reason === "no-device-ai") {
      text = "One reader"; title = "This browser has no built-in AI. The close reader still ran.";
    }

    label.textContent = text;
    pill.className = "reader-pill " + cls;
    pill.title = title;
    pill.setAttribute("aria-label", text + ". " + title);
  }

  function setMode(next) {
    if ((next === "read" || next === "all") && !state.result) return;
    if (state.mode === next) return;
    state.mode = next;
    paintDoc();
    paintModes();
    paintStart();
    paintCovStrip();
  }

  function paintModes() {
    const wrap = document.getElementById("doc-modes");
    if (!wrap) return;
    wrap.querySelectorAll("[data-mode]").forEach((b) => {
      const m = b.getAttribute("data-mode");
      b.setAttribute("aria-pressed", m === state.mode ? "true" : "false");
      b.disabled = (m === "read" || m === "all") && !state.result;
    });
  }

  /* Shared, because the palette can reach these too. */
  function startAction(what) {
    if (what === "example") return runDemo();
    if (what === "paste") return openPaste();
    if (what === "file") return document.getElementById("file-input").click();
  }

  function paintStart() {
    const doc = document.getElementById("doc");
    if (doc) doc.classList.toggle("is-blank", !docText() && state.mode === "write");
  }

  /* -------------------------------- coverage -------------------------------- */

  /*
   * Where in the essay each thing was found.
   *
   * Every other part of this app answers "is it there?". None of them answers
   * "where?", and the answer changes the feedback: a counterargument that lives
   * entirely inside one paragraph is a different problem from one that is
   * threaded through, and a claim that appears in the first line and never
   * again is a third. That is a marking observation the teacher would have to
   * make by hand, so it is worth a panel of its own.
   */
  /*
   * A reading has to end in something the teacher could say out loud. "Mostly
   * in the middle" is a fact about coordinates; "raised early and then dropped,
   * ask why it disappears" is feedback. The tone rides along so the panel can
   * be skimmed for the ones that need attention.
   */
  function coverageOf(c) {
    const len = state.work.text.length || 1;
    const at = c.evidence.map((e) => (e.start + (e.end - e.start) / 2) / len).sort((x, y) => x - y);
    if (!at.length) {
      return { at: [], tone: "flat", short: "nothing to point at",
               read: "There is no line in the essay to point at for this one." };
    }

    const first = at[0];
    const last = at[at.length - 1];
    const spread = last - first;
    const where = (p) => (p < 0.34 ? "the opening" : p < 0.67 ? "the middle" : "the end");

    if (at.length === 1) {
      return { at: at, tone: "watch", short: "once only",
               read: "Turns up once, in " + where(first) + ", and never again." };
    }
    if (spread < 0.16) {
      return { at: at, tone: "watch", short: "all in one place",
               read: "All of it sits in one stretch near " + where(first) +
                     ". The rest of the essay never comes back to it." };
    }
    if (spread > 0.62) {
      return { at: at, tone: "good", short: "runs throughout",
               read: "Comes back from the first paragraph to the last. That is what you want to see." };
    }
    if (last < 0.4) {
      return { at: at, tone: "watch", short: "dropped early",
               read: "Raised early and then dropped \u2014 nothing after " + where(last) +
                     ". Worth asking the writer why it disappears." };
    }
    if (first > 0.6) {
      return { at: at, tone: "watch", short: "arrives late",
               read: "Only arrives near " + where(first) + ". The first half of the essay does not carry it." };
    }
    return { at: at, tone: "ok", short: "middle-weighted",
             read: "Sits mostly in " + where((first + last) / 2) + " and thins out either side." };
  }

  /* --------------------------------- feedback -------------------------------- */

  /*
   * The only surface the person being marked ever sees.
   *
   * Everything else in this app is for the marker. The handback used to be two
   * buttons that threw text at the clipboard unseen, which meant nobody could
   * check it, reword a sentence, or soften a line before it went out. It is a
   * draft you can edit, and it is on screen next to the evidence it came from.
   */
  /* A student only ever has one sheet: the one addressed to them. The other is
     a marking summary with the flag reasons and a signals dump in it. */
  let fbWhich = "student";
  function fbLocked() { return Session.role() === "student"; }
  let fbView = "read";
  const fbCaret = { student: null, teacher: null };
  const fbEdit = { student: null, teacher: null };

  function fbDraft() {
    return fbWhich === "student" || fbLocked() ? studentText() : teacherText();
  }

  function fbSource() {
    return fbEdit[fbWhich] != null ? fbEdit[fbWhich] : fbDraft();
  }

  function paintFeedback() {
    const host = document.getElementById("fb-body");
    const foot = document.getElementById("fb-foot");
    if (!host) return;

    /* A student has one sheet, so the control that picks between two goes -
       and its labels were written from the marker's chair anyway: "For the
       student" is a strange thing to read about yourself. */
    const swap = document.querySelector(".fb-switch");
    if (swap) swap.hidden = fbLocked();
    if (fbLocked()) fbWhich = "student";

    document.querySelectorAll("[data-fb]").forEach((b) =>
      b.setAttribute("aria-pressed", b.getAttribute("data-fb") === fbWhich ? "true" : "false")
    );
    document.querySelectorAll("[data-fbview]").forEach((b) =>
      b.setAttribute("aria-pressed", b.getAttribute("data-fbview") === fbView ? "true" : "false")
    );
    const tools = document.querySelector(".fb-tools");
    if (tools) tools.hidden = !state.result;

    if (!state.result) {
      if (foot) foot.hidden = true;
      host.innerHTML =
        '<div class="empty">' +
          "<h3>The sheet that goes back.</h3>" +
          "<p>Once it has read the essay, the feedback writes itself here from the lines it found \u2014 " +
          "one band, one quote and one next move per item on your checklist.</p>" +
          "<p>You can edit every word of it before it goes anywhere, in Markdown, with LaTeX for anything " +
          "that needs a formula. It never contains a mark.</p>" +
        "</div>";
      return;
    }

    if (foot) foot.hidden = false;

    if (fbView === "read") {
      /* Reuse the node when it is already there: replacing it wholesale sent
         the reader back to the top every time a criterion was opened. */
      const already = host.querySelector("#fb-read");
      if (already) {
        const at = already.scrollTop;
        try { already.innerHTML = Markdown.render(fbSource()); }
        catch (e) { already.textContent = fbSource(); }
        already.scrollTop = at;
        paintFbFoot();
        return;
      }
      /* A scroll region with no focusable child cannot be scrolled by anyone
         who is not holding a mouse. */
      host.innerHTML = '<div class="fb-read md" id="fb-read" tabindex="0" role="region" ' +
        'aria-label="The feedback, as the student will see it"></div>';
      /* Markdown.render escapes every leaf before it builds any markup, which
         is what makes this safe to assign. */
      host.querySelector("#fb-read").innerHTML = Markdown.render(fbSource());
      paintFbFoot();
      return;
    }

    let ta = host.querySelector("#fb-text");
    if (!ta) {
      host.innerHTML = '<textarea class="fb-text" id="fb-text" spellcheck="true" ' +
        'aria-label="The feedback, in Markdown"></textarea>';
      ta = host.querySelector("#fb-text");
      ta.addEventListener("input", () => {
        fbEdit[fbWhich] = ta.value;
        fbCaret[fbWhich] = ta.selectionStart;
        fbFit(ta);
        paintFbFoot();
      });
      ta.addEventListener("blur", () => { fbCaret[fbWhich] = ta.selectionStart; });
    }
    if (document.activeElement !== ta) {
      ta.value = fbSource();
      /* Swapping views rebuilds the textarea, which lands the caret at the end
         in Chrome and at zero in Firefox. Put it back where it was. */
      const at = fbCaret[fbWhich];
      if (at != null) { try { ta.setSelectionRange(at, at); } catch (e) { /* ignore */ } }
    }
    fbFit(ta);
    paintFbFoot();
  }

  /*
   * Stacked, the panel has no height of its own for the sheet to fill, and a
   * scroll region inside a page that already scrolls is how content gets
   * stranded on a phone. So on narrow screens the sheet is as long as its own
   * text; on desktop it fills its column and scrolls there.
   */
  function fbFit(ta) {
    if (!ta || ta.tagName !== "TEXTAREA") return;
    if ((global.innerWidth || 1400) > 900) { ta.style.height = ""; return; }
    ta.style.height = "auto";
    ta.style.height = Math.max(340, ta.scrollHeight) + "px";
  }

  function paintFbFoot() {
    const reset = document.getElementById("fb-reset");
    if (reset) reset.hidden = fbEdit[fbWhich] == null;
  }

  function wireFeedback() {
    const head = document.querySelector(".fb-switch");
    if (head) head.addEventListener("click", (e) => {
      const b = e.target.closest("[data-fb]");
      if (!b) return;
      fbWhich = b.getAttribute("data-fb");
      const host = document.getElementById("fb-body");
      if (host) host.innerHTML = "";  // the other sheet is a different document
      paintFeedback();
    });

    const tools = document.querySelector(".fb-view");
    if (tools) tools.addEventListener("click", (e) => {
      const b = e.target.closest("[data-fbview]");
      if (!b) return;
      fbView = b.getAttribute("data-fbview");
      const host = document.getElementById("fb-body");
      if (host) host.innerHTML = "";
      paintFeedback();
      if (fbView === "write") {
        const ta = document.getElementById("fb-text");
        if (ta) ta.focus();
      }
    });

    const reset = document.getElementById("fb-reset");
    if (reset) reset.addEventListener("click", () => {
      fbEdit[fbWhich] = null;
      const host = document.getElementById("fb-body");
      if (host) host.innerHTML = "";
      paintFeedback();
      toast("Back to the draft.");
    });

    const copyBtn = document.getElementById("fb-copy");
    if (copyBtn) copyBtn.addEventListener("click", async () => {
      if (!state.result) return toast("Read something first.");
      const src = fbSource();
      /*
       * Both halves on the clipboard at once: paste into Docs, Classroom or an
       * email and the headings and bold survive; paste into a plain box and it
       * is the Markdown, which reads fine as text. Copying raw asterisks into a
       * comment field was the worst of both.
       */
      try {
        if (global.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
          await navigator.clipboard.write([new ClipboardItem({
            /* flat: true, because none of this page\u2019s CSS travels with the
               clipboard. The fraction is drawn here as a flex column with a
               rule between the halves, so Google Docs received $\\frac{1}{2}$
               as the number "12". Flat renders it as 1\u20442, which survives. */
            "text/html": new Blob(["<div>" + Markdown.render(src, { flat: true }) + "</div>"], { type: "text/html" }),
            "text/plain": new Blob([Markdown.plain(src)], { type: "text/plain" }),
          })]);
          return toast("Copied, with the formatting.");
        }
      } catch (e) { /* fall through to plain */ }
      toast((await copy(Markdown.plain(src))) ? "Copied." : "Could not reach the clipboard.");
    });
  }

  /* The minimap beside the page. Same hues as the bars, so a band you see on
     the strip and a bar you see in the panel are obviously the same thing. */
  function paintCovStrip() {
    const strip = document.getElementById("cov-strip");
    const scroll = document.getElementById("doc-scroll");
    if (!strip || !scroll) return;

    const on = !!state.result && (state.mode === "read" || state.mode === "all");
    strip.hidden = !on;
    const pane = strip.closest(".pane-doc");
    if (pane) pane.classList.toggle("has-map", on);
    if (!on) return;

    const len = state.work.text.length || 1;
    const cs = state.mode === "all"
      ? state.result.criteria
      : [selectedCriterion()].filter(Boolean);

    strip.innerHTML =
      cs.map((c) => {
        const i = critIndex(c.id);
        return c.evidence.map((e) =>
          '<button class="cov-band" data-c="' + (i % 6) + '" data-jump="' + e.start +
          '" style="top:' + ((e.start / len) * 100).toFixed(2) + "%;height:" +
          Math.max(0.9, ((e.end - e.start) / len) * 100).toFixed(2) + '%" aria-label="' +
          esc(c.name) + '"></button>'
        ).join("");
      }).join("") +
      '<i class="cov-view" id="cov-view"></i>';

    strip.querySelectorAll("[data-jump]").forEach((b) =>
      b.addEventListener("click", () => jumpTo(Number(b.getAttribute("data-jump"))))
    );
    paintCovView();
  }

  /* The thumb showing which slice of the page you are looking at. */
  /* Both reads before either write, or the second read re-runs layout that the
     first write just invalidated - once per scroll tick. */
  let covFrame = 0;
  function paintCovView() {
    if (covFrame) return;
    covFrame = requestAnimationFrame(() => {
      covFrame = 0;
      const view = document.getElementById("cov-view");
      const scroll = document.getElementById("doc-scroll");
      if (!view || !scroll) return;
      const h = scroll.scrollHeight || 1;
      const top = scroll.scrollTop;
      const client = scroll.clientHeight;
      view.style.top = ((top / h) * 100).toFixed(2) + "%";
      view.style.height = Math.min(100, (client / h) * 100).toFixed(2) + "%";
    });
  }

  /* ------------------------------- side tabs -------------------------------- */

  function setTab(name) {
    /* Falling back rather than refusing: a role switch while Class is open has
       to land somewhere, and Evidence is the tool both roles always have. */
    state.tab = toolAllowed(name) ? name : "evidence";
    paintTabs();
    name = state.tab;
    /* A hidden panel measures as nothing, so the sheet was sized to its
       minimum while it was still behind another tab and never corrected. */
    if (name === "feedback") paintFeedback();
    /* Painted on the way in rather than on every render: each one reads the
       whole shelf or re-measures the essay, and neither is worth doing while
       somebody is typing. */
    if (name === "signals") paintSignals();
    if (name === "class") paintClass();
    if (name === "drafts") paintDrafts();
  }

  function paintTabs() {
    document.querySelectorAll(".side-tabs [data-tab]").forEach((b) => {
      const id = b.getAttribute("data-tab");
      /* A tool this role does not get is removed from the strip entirely, not
         disabled: a greyed-out tab is a promise of something you cannot have. */
      b.hidden = !toolAllowed(id);
      b.setAttribute("aria-selected", id === state.tab ? "true" : "false");
      b.tabIndex = id === state.tab ? 0 : -1;
    });
    TOOLS.forEach((t) => {
      const p = document.getElementById("panel-" + t.id);
      if (p) p.hidden = state.tab !== t.id;
    });
  }

  function paintSummary() {
    const host = document.getElementById("summary");
    if (!host) return;
    if (!state.result || !state.rubric) { host.innerHTML = ""; return; }

    const cs = state.result.criteria;
    const n = cs.length || 1;
    const flagged = cs.filter((c) => c.flagged).length;

    /* The bar's four segments have to add up to n, so a flagged criterion
       belongs to the flag segment and to no other. */
    const seg = { evidenced: 0, partial: 0, missing: 0, flag: 0 };
    cs.forEach((c) => { seg[c.flagged ? "flag" : c.status]++; });

    host.innerHTML =
      '<div class="summary-band">' +
        /* seg, not counts: counts.evidenced treats a flagged criterion as found,
           and the bar and the key directly below this line do not. The two
           disagreed on screen. */
        "<h3>" + seg.evidenced + " of " + n + " found in the essay</h3>" +
        "<p>" + (flagged
          ? esc(flagged === 1 ? "One is worth a second look. It is marked below." : flagged + " are worth a second look. They are marked below.")
          : "Nothing here is in doubt.") + "</p>" +
        /* Four segments that partition the set. A flagged criterion also has a
           status, so it was being counted twice: once in its own status
           segment and once in the sentence above. */
        '<div class="bar" role="img" aria-label="' +
            seg.evidenced + " found, " + seg.partial + " half there, " +
            seg.missing + " not there, " + seg.flag + ' worth a second look">' +
          '<i class="ok" style="width:' + (seg.evidenced / n) * 100 + '%"></i>' +
          '<i class="mid" style="width:' + (seg.partial / n) * 100 + '%"></i>' +
          '<i class="flag" style="width:' + (seg.flag / n) * 100 + '%"></i>' +
          '<i class="none" style="width:' + (seg.missing / n) * 100 + '%"></i>' +
        "</div>" +
        '<ul class="legend key">' +
          (seg.evidenced ? '<li><i class="d-ok"></i>Found it</li>' : "") +
          (seg.partial ? '<li><i class="d-mid"></i>Half there</li>' : "") +
          (seg.flag ? '<li><i class="d-flag"></i>Check this one</li>' : "") +
          (seg.missing ? '<li><i class="d-none"></i>Not there</li>' : "") +
        "</ul>" +
      "</div>";
  }

  function selectedCriterion() {
    if (!state.result) return null;
    return state.result.criteria.find((c) => c.id === state.selected) || state.result.criteria[0];
  }

  function paintDoc() {
    const doc = document.getElementById("doc");
    const title = document.getElementById("doc-title");
    if (!doc) return;

    /* Never write into a field while it is the one being typed in. */
    if (title && document.activeElement !== title) title.value = state.work.title || "";

    if ((state.mode === "read" || state.mode === "all") && state.result) {
      let spans;
      if (state.mode === "all") {
        /* Every item at once, one hue each. One criterion at a time answers
           "where is this?"; all of them at once answers "which parts of this
           essay are doing any work at all?", which is a different question and
           the one a marker asks first. */
        spans = [];
        state.result.criteria.forEach((c) => {
          const i = critIndex(c.id);
          c.evidence.forEach((e) => spans.push({ start: e.start, end: e.end, tone: "none", crit: c.id, c: i }));
        });
      } else {
        const c = selectedCriterion();
        const tone = c ? (c.flagged ? "flag" : TONE[c.status]) : "none";
        spans = c ? c.evidence.map((e) => ({ start: e.start, end: e.end, tone: tone, crit: c.id })) : [];
      }
      doc.setAttribute("contenteditable", "false");
      doc.classList.add("is-marked");
      doc.classList.toggle("is-all", state.mode === "all");
      doc.innerHTML = renderMarked(state.work.text, spans);
      return;
    }
    doc.classList.remove("is-all");

    /* Coming back from "Marked", the node still holds <mark> elements. Their
       text is identical, so a plain equality check would leave them in place
       and you would end up typing inside a highlight. */
    const wasMarked = doc.classList.contains("is-marked");
    doc.setAttribute("contenteditable", "true");
    doc.classList.remove("is-marked");
    if (wasMarked || (document.activeElement !== doc && readDoc(doc) !== state.work.text)) {
      doc.textContent = state.work.text;
    }
  }

  /* contenteditable hands back non-breaking spaces where it collapsed runs of
     whitespace, and CRLF on Windows. Both would shift every offset the engine
     produced, so the text is normalised at the door. */
  function readDoc(node) {
    return node.innerText.replace(/\u00a0/g, " ").replace(/\r\n?/g, "\n");
  }

  /*
   * One list, not two panels. Each thing the teacher is looking for is a row;
   * opening a row shows its lines, its gap and its next move underneath, and
   * marks the essay beside it. The old layout split this across a left rail and
   * a right detail pane, which meant reading three columns to answer one
   * question.
   */
  /*
   * `force` marks a repaint the user asked for.
   *
   * The guard below exists so the debounced repaint 180ms after a keystroke
   * cannot destroy a button somebody had just tabbed onto. But clicking a
   * button focuses it, so once anyone opened a finding the guard was true
   * forever and every later repaint returned early - which meant the accordion
   * stopped re-rendering AND stopped re-binding its own listeners after the
   * very first click. It looked like the buttons were dead, and they were.
   *
   * An incidental repaint still yields to focus. One the accordion itself
   * asked for does not.
   */
  function paintFindings(force) {
    const host = document.getElementById("findings");
    if (!host) return;
    if (!force && host.contains(document.activeElement)) return;

    paintSummary();

    /* Two ticks, not a wall of text. It says which half is still missing, so
       an empty screen is a short instruction rather than a dead end. */
    if (!state.result) {
      const copy = roleCopy();
      const hasList = liveCriteria().length > 0;
      const hasWork = docText().length >= 40;
      host.innerHTML =
        '<div class="empty">' +
          "<h3>Two things and it runs.</h3>" +
          '<ol class="empty-steps">' +
            '<li class="' + (hasList ? "done" : "") + '"><i></i>' + esc(copy.stepList) + "</li>" +
            '<li class="' + (hasWork ? "done" : "") + '"><i></i>' + esc(copy.stepWork) + "</li>" +
          "</ol>" +
          '<div class="empty-do">' +
            '<button type="button" data-start="example"><svg aria-hidden="true"><use href="#i-play"/></svg>' +
              "Watch it run on an example</button>" +
            '<button type="button" data-start="paste"><svg aria-hidden="true"><use href="#i-plus"/></svg>' +
              "Paste a rubric and an essay</button>" +
            '<button type="button" data-start="file"><svg aria-hidden="true"><use href="#i-file"/></svg>' +
              "Open a .txt file</button>" +
          "</div>" +
          '<p class="empty-fine">Nothing is uploaded. It is read here, on this computer.</p>' +
        "</div>";
      host.querySelectorAll("[data-start]").forEach((b) =>
        b.addEventListener("click", () => startAction(b.getAttribute("data-start")))
      );
      return;
    }

    host.innerHTML = state.result.criteria.map((c) => {
      const open = c.id === state.selected;
      const tone = c.flagged ? "flag" : TONE[c.status];
      return (
        '<article class="finding t-' + tone + (open ? " open" : "") + '">' +
          '<button class="finding-top" data-crit="' + esc(c.id) + '" aria-expanded="' + open + '">' +
            '<span class="finding-name">' + esc(c.name) + "</span>" +
            chip(c.status, c.flagged) +
            '<svg class="finding-chev" aria-hidden="true"><use href="#i-chev"/></svg>' +
          "</button>" +
          (open ? '<div class="finding-body">' + findingBody(c) + "</div>" : "") +
        "</article>"
      );
    }).join("");

    host.querySelectorAll("[data-crit]").forEach((b) =>
      b.addEventListener("click", () => {
        const id = b.getAttribute("data-crit");
        state.selected = state.selected === id ? null : id;
        if (state.selected && state.result) setMode("read");
        paintDoc();
        paintFindings(true);
        paintRailStatus();
        /* This re-render replaced the button that was just pressed, so put
           focus back on its successor. Without it a keyboard user's next Tab
           restarts from the top of the page. */
        const again = host.querySelector('[data-crit="' + cssEscape(id) + '"]');
        if (again) again.focus();
      })
    );
    host.querySelectorAll("[data-jump]").forEach((b) =>
      b.addEventListener("click", () => jumpTo(Number(b.getAttribute("data-jump"))))
    );
  }

  function findingBody(c) {
    const tone = c.flagged ? "flag" : TONE[c.status];
    /* The descriptor is on the rubric the teacher wrote; repeating it under
       every result was the bulk of the words on this pane and told them
       nothing they did not already know. */
    let html = "";

    if (c.flagged && c.flagReason) {
      html += '<p class="finding-flag">' + esc(c.flagReason) + "</p>";
    } else if (c.agreement === "unread") {
      html += '<p class="finding-unread">Only the close reader got to this one. ' +
        "The second reader ran out of time on it.</p>";
    }

    if (c.evidence.length) {
      html += '<p class="finding-label">In the essay</p>';
      html += c.evidence.slice(0, 2).map((e) =>
        '<button class="quote ' + tone + '" data-jump="' + e.start + '">' +
          esc(e.text.length > 200 ? e.text.slice(0, 200) + "\u2026" : e.text) +
        "</button>"
      ).join("");
    } else {
      html += '<p class="finding-none">There is no line in the essay to point at for this one.</p>';
    }

    /* Where it sits in the essay. It used to have a panel of its own, which
       nobody opened; beside the lines it is talking about, it lands. */
    const cov = coverageOf(c);
    if (c.evidence.length && cov.tone !== "ok") {
      html += '<p class="finding-where t-' + cov.tone + '">' + esc(cov.read) + "</p>";
    }

    const gap = (c.gaps || [])[0];
    if (gap) html += '<p class="finding-label">What I noticed</p><p class="finding-text">' + esc(gap) + "</p>";

    const moves = (c.moves || []).slice(0, 1);
    if (moves.length) {
      html += '<p class="finding-label">One thing to fix</p>';
      html += moves.map((m) => '<p class="finding-text">' + esc(m) + "</p>").join("");
    }
    return html;
  }

  function jumpTo(start) {
    const doc = document.getElementById("doc");
    const target = doc && doc.querySelector('mark[data-span="' + start + '"]');
    if (!target) return;
    const smooth = !global.matchMedia || !global.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "center" });
    target.classList.remove("pulse");
    void target.offsetWidth; // restart the animation
    target.classList.add("pulse");
  }

  /* --------------------------------- handback ------------------------------- */

  /*
   * The sheets, written as Markdown.
   *
   * They used to be flat text with two-space indents doing the work of
   * structure, which meant a wall of lines that all looked the same weight and
   * a teacher scanning for one criterion had to read the lot. Headings, a rule
   * between items and the quote set as a blockquote costs nothing and makes it
   * skimmable - and since it is Markdown, a teacher can add their own emphasis,
   * a list, or a formula without leaving the box.
   */
  const BAND_SAYS = {
    evidenced: "Found it",
    partial: "Half there",
    missing: "Not there",
  };

  function studentText() {
    const cs = state.result.criteria;
    const found = cs.filter((x) => x.status === "evidenced").length;
    const words = docText() ? docText().split(/\s+/).length : 0;

    const out = [];
    out.push("# " + (state.work.title || "Your essay"));
    const lvl = levelLabel(state.rubric.level);
    out.push("Marked against **" + state.rubric.name + "**" +
      (lvl ? " \u00b7 " + lvl : "") + (words ? " \u00b7 " + words + " words" : ""));
    out.push("");
    out.push("**" + found + " of " + cs.length + "** of the things on the checklist are evidenced here. " +
      "There is no mark on this sheet on purpose \u2014 fix the next moves and the mark follows.");

    for (const x of cs) {
      out.push("");
      out.push("---");
      out.push("");
      out.push("## " + x.name + " \u2014 " + (BAND_SAYS[x.status] || "Unread"));

      if (x.evidence.length) {
        out.push("");
        out.push("Where I saw it:");
        out.push("");
        out.push("> " + x.evidence[0].text.trim().replace(/\n+/g, " "));
      } else {
        out.push("");
        out.push("There is no line in the essay I can point at for this one yet.");
      }

      if (x.gaps && x.gaps[0]) { out.push(""); out.push("**What I noticed.** " + x.gaps[0]); }
      if (x.moves && x.moves[0]) { out.push(""); out.push("**Next time.** " + x.moves[0]); }
    }

    if (askNotes.length) {
      out.push("", "---", "", "## Also");
      askNotes.forEach((n) => { out.push(""); out.push(n); });
    }
    return out.join("\n");
  }

  function teacherText() {
    const cs = state.result.criteria;
    const flagged = cs.filter((x) => x.flagged);
    const s = state.result.signals;
    const words = docText() ? docText().split(/\s+/).length : 0;

    const out = [];
    out.push("# Marking summary");
    out.push("**" + (state.work.title || "Untitled essay") + "** \u00b7 " + state.rubric.name +
      (words ? " \u00b7 " + words + " words" : ""));
    out.push("Readers: " + (state.result.readers && state.result.readers.wide ? "close reader and second reader" : "close reader only"));
    out.push("");

    /* A table, because this half is a thing you scan down a column of, not a
       thing you read. */
    out.push("| On your checklist | Where it landed | Note |");
    out.push("| --- | --- | --- |");
    cs.forEach((x) => {
      out.push("| " + x.name.replace(/\|/g, "\\|") + " | " + (BAND_SAYS[x.status] || "Unread") + " | " +
        (x.flagged ? "**needs a human**" : x.borderline ? "near the line" : "") + " |");
    });

    cs.forEach((x) => {
      if (!x.evidence.length) return;
      out.push("", "### " + x.name);
      x.evidence.slice(0, 2).forEach((e) => { out.push(""); out.push("> " + e.text.trim().replace(/\n+/g, " ")); });
    });

    if (flagged.length) {
      out.push("", "---", "", "## Worth a second look");
      flagged.forEach((x) => { out.push(""); out.push("**" + x.name + ".** " + x.flagReason); });
    }

    if (s) {
      out.push("", "---", "", "## Signals");
      out.push("");
      out.push("- " + s.words + " words in " + s.sentenceCount + " sentences");
      out.push("- " + s.sourcing.attributions.length + " attributions, " + s.hedging.hits.length + " hedges");
      out.push("- " + s.reasoning.hits.length + " reasoning connectives");
      out.push("- " + s.control.runOns + " sentence" + (s.control.runOns === 1 ? "" : "s") + " over 42 words");
    }

    out.push("", "---", "", "*No grade is produced by this tool. The mark is yours.*");
    return out.join("\n");
  }

  /* --------------------------------- modals --------------------------------- */

  /*
   * Bulk entry, for a rubric that already exists on a sheet of paper. The rail
   * is the primary way in; this is the shortcut for people who have twelve
   * criteria and do not want to press Enter twelve times.
   */
  function openPaste() {
    const criteriaText = liveCriteria().map((c) => c.name + " :: " + c.descriptor).join("\n");

    modal(
      "<h2>Paste it all at once</h2>" +
      '<p class="sub">One line per thing you are looking for, as <b>Name :: what you are looking for</b>. ' +
      "The essay is optional here \u2014 leave it blank to keep what is already on the page.</p>" +
      '<div style="margin-top:18px">' +
        '<label class="field"><span>Call this checklist</span><input class="input" id="m-name" value="' +
          esc(state.rubric.name || "Your checklist") + '"></label>' +
        '<label class="field"><span>Who wrote it</span>' +
          '<select class="input" id="m-level">' + levelOptions(state.rubric.level) + '</select>' +
          '<small class="field-note">Sets how much the second reader expects of the writer. It changes ' +
          'what counts as evidence, never the mark — there is still no mark.</small></label>' +
        '<label class="field"><span>What to look for</span><textarea class="input" id="m-crit" spellcheck="false" ' +
          'placeholder="Claim :: states one arguable position early and holds it">' + esc(criteriaText) + "</textarea></label>" +
        '<label class="field"><span>The essay</span><textarea class="input" id="m-work" ' +
          'placeholder="Paste the writing here, or leave this blank\u2026" spellcheck="false"></textarea></label>' +
      "</div>" +
      '<div class="modal-actions">' +
        '<button class="btn btn-ghost" data-close>Cancel</button>' +
        '<button class="btn" id="m-go">Add it</button>' +
      "</div>",
      (box, close) => {
        box.querySelector("[data-close]").addEventListener("click", close);
        box.querySelector("#m-go").addEventListener("click", () => {
          const name = box.querySelector("#m-name").value.trim() || "Your checklist";
          const level = box.querySelector("#m-level").value;
          const lines = box.querySelector("#m-crit").value.split("\n").map((l) => l.trim()).filter(Boolean);
          const work = box.querySelector("#m-work").value.trim();

          if (!lines.length) return toast("Add at least one thing to look for.");

          state.rubric = {
            id: "own-rubric", name: name, context: "Yours", level: level,
            criteria: lines.map((line, i) => {
              const parts = line.split("::");
              const cname = (parts[0] || "Thing " + (i + 1)).trim();
              return {
                id: "c" + ++critSeq,
                name: cname,
                descriptor: (parts.slice(1).join("::") || cname).trim(),
                lookFor: [],
              };
            }),
          };
          if (work) {
            state.work.text = work;
            if (!state.work.title) state.work.title = name;
          }
          state.result = null;
          state.selected = null;
          state.stale = false;
          state.mode = "write";
          close();
          paintRail();
          render();
          if (docText().length >= 40) runRead();
          else toast("Checklist added. Now put the essay in.");
        });
      }
    );
  }

  const DEVICE_COPY = {
    available: ["ready", "Chrome can run the second reader right here on your computer. Nothing gets sent anywhere, and it is already switched on."],
    downloadable: ["needs a one-off download", "Chrome can run the second reader on your computer for free, but it has to fetch the model once first. It is a big download, and afterwards it works with the internet off."],
    downloading: ["downloading now", "Chrome is fetching the model. This page keeps working while it does."],
    unavailable: ["not on this browser", "Built-in AI needs a recent desktop Chrome. Without it the close reader runs alone, which is still a complete result, or you can add a Gemini key below."],
  };

  async function openSettings() {
    const key = Readers.getKey();
    const st = global.OnDevice ? await global.OnDevice.status() : "unavailable";
    const copy = DEVICE_COPY[st] || DEVICE_COPY.unavailable;

    modal(
      "<h2>The second reader</h2>" +
      '<p class="sub">The close reader always runs here on your computer, with no key and no account. A second, different reader is what lets the two disagree, and the disagreement is the useful part.</p>' +

      '<div class="block" style="margin-top:18px">' +
        "<h4>On your device &middot; " + esc(copy[0]) + "</h4>" +
        '<p class="block-p">' + esc(copy[1]) + "</p>" +
        (st === "downloadable"
          ? '<button class="btn btn-ghost" id="s-dl" style="margin-top:12px">Download it now</button>' +
            '<p id="s-prog" class="kicker" style="margin-top:10px"></p>'
          : "") +
      "</div>" +

      '<div class="block" style="margin-top:12px">' +
        "<h4>Or use Gemini in the cloud</h4>" +
        '<p class="block-p">Stronger, but it needs a key, and the essay is sent to Google for that read. ' +
        "Leave it empty to stay on your device.</p>" +
        '<label class="field" style="margin-top:12px"><span>API key</span><input class="input" id="s-key" type="password" placeholder="AIza&hellip;" value="' + esc(key) + '"></label>' +
        '<label class="field"><span>Model</span>' +
          '<select class="input" id="s-model">' + modelOptions(Readers.getModel()) + '</select></label>' +
      "</div>" +

      '<div class="modal-actions">' +
        '<button class="btn btn-ghost" id="s-clear">Clear key</button>' +
        '<button class="btn" id="s-save">Save and re-read</button>' +
      "</div>",
      (box, close) => {
        const dl = box.querySelector("#s-dl");
        if (dl) dl.addEventListener("click", async () => {
          const prog = box.querySelector("#s-prog");
          dl.disabled = true;
          dl.innerHTML = '<i class="spin"></i> Downloading';
          const ok = await global.OnDevice.download((v) => {
            if (prog) prog.textContent = Math.round(v * 100) + "% downloaded";
          });
          dl.disabled = false;
          dl.textContent = ok ? "Ready" : "Could not download";
          if (ok) { close(); toast("On-device reader is ready."); runRead(); }
        });
        box.querySelector("#s-clear").addEventListener("click", () => {
          Readers.setKey("");
          close();
          toast("Key cleared. Back to reading on your device.");
          runRead();
        });
        box.querySelector("#s-save").addEventListener("click", () => {
          Readers.setKey(box.querySelector("#s-key").value.trim());
          Readers.setModel(box.querySelector("#s-model").value.trim());
          close();
          runRead();
        });
      }
    );
  }

  /* Bring the on-device reader up in the background. No key, no account, no
     settings trip — it simply becomes available and the chip says so. */
  async function warmDevice() {
    /* Nor should it start downloading a language model. */
    if (global.self !== global.top) return;
    if (!global.OnDevice || Readers.getKey()) return;
    const st = await global.OnDevice.status();
    if (st === "available" || st === "unavailable") return;

    state.second = { state: "warming", pct: 0 };
    paintChips();
    const ok = await global.OnDevice.warm((v) => {
      state.second = { state: "warming", pct: Math.round(v * 100) };
      paintChips();
    });
    state.second = { state: ok ? "idle" : "off", reason: ok ? null : "no-device-ai" };
    paintChips();
    if (ok) {
      toast("The second reader is ready, on your device.");
      runRead();
    }
  }


  /*
   * Account settings.
   *
   * Structure from ClassDojo's account panel — chosen because ClassDojo is
   * teacher software, so its shape already answers the questions a teacher
   * has: who am I here, what does this know about me, how do I leave. A
   * category rail on the left, an avatar and role at the top of the pane, then
   * plain form rows. Perplexity's habit of putting the label on the left and
   * the action on the right is used for the rows that are not editable text.
   */
  const ACCOUNT_TABS = [
    ["profile", "Profile"],
    ["work", "Saved work"],
    ["classroom", "Classroom"],
    ["reading", "Reading"],
    ["privacy", "Privacy"],
  ];

  function initials(name) {
    return String(name || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
  }

  function accountBody(tab, session) {
    if (tab === "reading") {
      const key = Readers.getKey();
      return (
        '<p class="ac-lead">How the second reader runs when you press Read it.</p>' +
        '<div class="ac-row"><div><b>On your device</b><span>Chrome\u2019s built-in model. Nothing is uploaded.</span></div>' +
          '<span class="chip t-ok"><i class="dot"></i>Preferred</span></div>' +
        '<div class="ac-row"><div><b>Gemini in the cloud</b><span>' +
          (key ? "A key is saved in this browser." : "No key. Leave it empty to stay on your device.") +
        '</span></div><button class="btn btn-ghost" id="ac-key">' + (key ? "Change key" : "Add a key") + "</button></div>" +
        '<div class="ac-row"><div><b>Never a grade</b><span>Not a setting. The tool does not produce marks.</span></div>' +
          '<span class="ac-locked">Always on</span></div>'
      );
    }
    if (tab === "work") {
      const all = Shelf.list();
      const kb = Math.max(1, Math.round(Shelf.bytes() / 1024));
      const pct = Math.min(100, Math.round((Shelf.bytes() / Shelf.MAX_BYTES) * 100));
      return (
        '<p class="ac-lead">Essays you have read are kept here, under this profile, in this browser.</p>' +
        '<div class="ac-meter"><div class="ac-meter-top"><b>' + all.length + " of " + Shelf.MAX_ENTRIES +
          " essays</b><span>" + kb + " KB used</span></div>" +
          '<div class="bar"><i class="ok" style="width:' + pct + '%"></i></div></div>' +
        (all.length
          ? '<div class="ac-work">' + all.slice(0, 6).map((e) =>
              '<div class="ac-work-row"><div><b>' + esc(e.title) + "</b><span>" +
              esc(e.stat ? e.stat.found + "/" + e.stat.total + " found" : "not read yet") +
              (e.source === "classroom" && e.meta ? " \u00b7 " + esc(e.meta.course) : "") + "</span></div>" +
              '<button class="link-quiet" data-open-entry="' + esc(e.id) + '">Open</button></div>'
            ).join("") + (all.length > 6 ? '<p class="ac-more">and ' + (all.length - 6) + " more</p>" : "") + "</div>"
          : '<p class="ac-none">Nothing saved yet.</p>') +
        '<div class="ac-row"><div><b>Take it with you</b><span>One file with every essay and checklist in it. ' +
          "The shelf only exists in this browser, so this is how it leaves.</span></div>" +
          '<button class="btn btn-ghost" id="ac-export">Export</button></div>' +
        '<div class="ac-row"><div><b>Bring one back</b><span>Load a shelf file exported from any copy of this app.</span></div>' +
          '<button class="btn btn-ghost" id="ac-import">Import</button></div>' +
        '<div class="ac-row"><div><b>Empty the shelf</b><span>Deletes every saved essay under this profile. ' +
          "It cannot be undone.</span></div>" +
          '<button class="btn btn-ghost ac-danger" id="ac-clearshelf">Delete all</button></div>'
      );
    }

    if (tab === "classroom") {
      const id = Classroom.clientId();
      return (
        '<p class="ac-lead">Pull a whole set of submissions straight off an assignment, read-only.</p>' +
        '<div class="ac-row"><div><b>Status</b><span>' +
          (Classroom.connected() ? "Connected for this tab." : id ? "Set up, not connected yet." : "Not set up.") +
        '</span></div><span class="chip t-' + (Classroom.connected() ? "ok" : "none") + '"><i class="dot"></i>' +
          (Classroom.connected() ? "Connected" : "Off") + "</span></div>" +
        '<label class="field"><span>Your Google OAuth client id</span>' +
          '<input class="input" id="ac-gc-id" placeholder="1234\u2026.apps.googleusercontent.com" value="' + esc(id) + '"></label>' +
        '<p class="ac-note">This app is a static page with no server of ours in the loop, which is what keeps ' +
          "student work on your machine \u2014 and it is also why the Classroom connection has to run on " +
          "<b>your</b> Google Cloud project rather than ours. Create an OAuth <b>Web application</b> client, " +
          "enable the Classroom and Drive APIs on it, and add this page\u2019s address " +
          "(<code>" + esc(location.origin) + "</code>) as an authorised JavaScript origin.</p>" +
          '<p class="ac-note">The access token is held in memory for this tab only and is never written to storage, ' +
          "so you will reconnect after a reload. That is deliberate for a token that can read a whole class.</p>" +
        '<div class="ac-actions"><button class="btn" id="ac-gc-save">Save id</button>' +
          (id ? '<button class="btn btn-ghost" id="ac-gc-test">Connect and test</button>' : "") +
          (Classroom.connected() ? '<button class="btn btn-ghost ac-danger" id="ac-gc-off">Disconnect</button>' : "") +
        "</div>"
      );
    }

    if (tab === "privacy") {
      const n = Shelf.list().length;
      return (
        '<p class="ac-lead">Everything below lives in this browser and nowhere else.</p>' +
        '<div class="ac-row"><div><b>Your profile</b><span>Name and email, stored locally. The PIN is salted and hashed.</span></div>' +
          '<span class="ac-locked">This browser</span></div>' +
        '<div class="ac-row"><div><b>Student work</b><span>' +
          (n ? n + " essay" + (n === 1 ? " is" : "s are") + " saved on this computer so you can come back to them. "
             : "Nothing is saved yet. Anything you read gets kept on this computer so you can come back to it. ") +
          "It is never uploaded, and you can delete it under Saved work.</span></div>" +
          '<span class="ac-locked">This browser</span></div>' +
        '<div class="ac-row"><div><b>Delete this profile</b><span>Removes the account and its saved settings from this browser.</span></div>' +
          '<button class="btn btn-ghost ac-danger" id="ac-delete">Delete</button></div>'
      );
    }
    return (
      '<div class="ac-id">' +
        '<span class="ac-avatar">' + esc(initials(session.name)) + "</span>" +
        '<div><p class="ac-role">Teacher</p><p class="ac-name">' + esc(session.name) + "</p></div>" +
      "</div>" +
      '<label class="field"><span>Name</span><input class="input" id="ac-name" value="' + esc(session.name) + '"></label>' +
      '<label class="field"><span>Email</span><input class="input" id="ac-email" value="' + esc(session.email) + '" disabled></label>' +
      '<p class="field-label">You are a</p>' +
      '<div class="role-pick" role="radiogroup" aria-label="Which are you?">' +
        '<button type="button" class="role" data-setrole="teacher" role="radio" aria-checked="' + (session.role !== "student") + '">' +
          "<b>Teacher</b><span>I mark other people&rsquo;s work</span></button>" +
        '<button type="button" class="role" data-setrole="student" role="radio" aria-checked="' + (session.role === "student") + '">' +
          "<b>Student</b><span>I check my own work</span></button>" +
      "</div>" +
      '<p class="ac-note">Your email is the key to this profile, so it cannot be changed here. ' +
        "Sign out and create a new profile to use a different one.</p>" +
      '<div class="ac-actions"><button class="btn" id="ac-save">Save</button>' +
        '<button class="btn btn-ghost" id="ac-signout">Sign out</button></div>'
    );
  }

  function openAccount(startTab) {
    const session = Session.current();
    if (!session) return global.Router.go("login");
    let tab = ACCOUNT_TABS.some((t) => t[0] === startTab) ? startTab : "profile";

    modal(
      '<div class="ac">' +
        '<div class="ac-rail">' +
          "<h2>Account</h2>" +
          '<p class="ac-sub">Manage your profile and how it reads.</p>' +
          '<nav class="ac-tabs" id="ac-tabs"></nav>' +
        "</div>" +
        '<div class="ac-pane" id="ac-pane"></div>' +
      "</div>",
      (box, close) => {
        const tabsEl = box.querySelector("#ac-tabs");
        const paneEl = box.querySelector("#ac-pane");

        const paint = () => {
          tabsEl.innerHTML = ACCOUNT_TABS.map(
            (t) => '<button data-tab="' + t[0] + '"' + (t[0] === tab ? ' aria-current="page"' : "") + ">" + esc(t[1]) + "</button>"
          ).join("");
          paneEl.innerHTML = accountBody(tab, session);

          tabsEl.querySelectorAll("[data-tab]").forEach((b) =>
            b.addEventListener("click", () => { tab = b.getAttribute("data-tab"); paint(); })
          );

          paneEl.querySelectorAll("[data-setrole]").forEach((b) =>
            b.addEventListener("click", () => {
              Session.setRole(session.email, b.getAttribute("data-setrole"));
              session.role = b.getAttribute("data-setrole");
              paint();
              render();
            })
          );

          const save = paneEl.querySelector("#ac-save");
          if (save) save.addEventListener("click", async () => {
            const name = paneEl.querySelector("#ac-name").value.trim();
            if (!name) return toast("A name cannot be empty.");
            await Session.rename(session.email, name);
            close();
            toast("Saved.");
            global.Router.refresh();
          });

          const out = paneEl.querySelector("#ac-signout");
          if (out) out.addEventListener("click", () => { Session.signOut(); close(); global.Router.go("landing"); });

          const key = paneEl.querySelector("#ac-key");
          if (key) key.addEventListener("click", () => { close(); openSettings(); });

          paneEl.querySelectorAll("[data-open-entry]").forEach((b) =>
            b.addEventListener("click", () => { close(); openEntry(b.getAttribute("data-open-entry")); })
          );

          const exp = paneEl.querySelector("#ac-export");
          if (exp) exp.addEventListener("click", () => {
            const blob = new Blob([Shelf.exportAll()], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = "second-reader-shelf.json";
            document.body.appendChild(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 2000);
            toast("Exported.");
          });

          const imp = paneEl.querySelector("#ac-import");
          if (imp) imp.addEventListener("click", () => {
            const picker = document.createElement("input");
            picker.type = "file";
            picker.accept = ".json,application/json";
            picker.addEventListener("change", () => {
              const f = picker.files && picker.files[0];
              if (!f) return;
              const reader = new FileReader();
              reader.onload = () => {
                const out = Shelf.importAll(String(reader.result || ""));
                if (!out.ok) {
                  return toast(out.error === "wrong-file" || out.error === "unreadable"
                    ? "That is not a shelf file."
                    : out.error === "count" ? "That would go over " + Shelf.MAX_ENTRIES + " essays."
                    : out.error === "empty" ? "There were no essays in that file."
                    : "There is not enough room in this browser for that.");
                }
                paintShelfBadge();
                paint();
                toast(out.added + " added to the shelf.");
              };
              reader.readAsText(f);
            });
            picker.click();
          });

          const wipe = paneEl.querySelector("#ac-clearshelf");
          if (wipe) wipe.addEventListener("click", () => {
            if (!Shelf.list().length) return toast("The shelf is already empty.");
            Shelf.clear();
            state.entryId = null;
            paintShelfBadge();
            paint();
            toast("Shelf emptied.");
          });

          const gcSave = paneEl.querySelector("#ac-gc-save");
          if (gcSave) gcSave.addEventListener("click", () => {
            const v = paneEl.querySelector("#ac-gc-id").value.trim();
            /* Catching the obvious paste mistake here saves a trip through
               Google's own error, which does not explain itself. */
            if (v && v.indexOf(".apps.googleusercontent.com") === -1) {
              return toast("That does not look like a client id \u2014 it should end in .apps.googleusercontent.com");
            }
            Classroom.setClientId(v);
            paint();
            toast(v ? "Saved. Now press Connect and test." : "Client id removed.");
          });

          const gcTest = paneEl.querySelector("#ac-gc-test");
          if (gcTest) gcTest.addEventListener("click", async () => {
            gcTest.disabled = true;
            gcTest.innerHTML = '<i class="spin"></i> Connecting';
            const c = await Classroom.connect();
            if (!c.ok) { paint(); return toast(gcWhy(c.error)); }
            const list = await Classroom.courses();
            paint();
            toast(list.ok
              ? "Connected. " + list.courses.length + " active class" + (list.courses.length === 1 ? "" : "es") + " visible."
              : gcWhy(list.error));
          });

          const gcOff = paneEl.querySelector("#ac-gc-off");
          if (gcOff) gcOff.addEventListener("click", () => {
            Classroom.disconnect();
            paint();
            toast("Disconnected. The token was revoked.");
          });

          const del = paneEl.querySelector("#ac-delete");
          if (del) del.addEventListener("click", () => {
            Session.remove(session.email);
            close();
            toast("Profile deleted from this browser.");
            global.Router.go("landing");
          });
        };
        paint();
      }
    );
  }

  global.AccountPanel = { open: openAccount };


  /*
   * "Try it with a preset" — the app types an example in rather than snapping
   * to a finished screen.
   *
   * The point is not decoration. A blank app cannot show what it does, and a
   * pre-filled one looks staged; watching the checklist and the essay arrive,
   * and then watching the marks land on the text, is the shortest honest
   * explanation of the product there is.
   *
   * The essay types by WORD, not by character. 400 characters at a readable
   * speed is half a minute of watching a cursor; 400 words in chunks is under
   * three seconds and reads as writing rather than as a progress bar.
   */
  let demoRunning = false;

  const reduced = () =>
    global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  /* Types into a real <input>, character by character. */
  async function typeValue(input, text, delay) {
    input.focus();
    for (let i = 0; i < text.length; i++) {
      if (!demoRunning) return;
      input.value = text.slice(0, i + 1);
      await sleep(delay);
    }
  }

  /* Types into the real editable document. By word, not by character: 500
     characters at a readable speed is half a minute of watching a cursor,
     where 500 words in small chunks is three seconds and reads as writing. */
  async function typeText(node, text, opts) {
    const step = opts.byWord ? text.split(/(\s+)/) : text.split("");
    const chunk = opts.chunk || 1;
    for (let i = 0; i < step.length; i += chunk) {
      if (!demoRunning) return;
      node.textContent = step.slice(0, i + chunk).join("");
      node.scrollTop = node.scrollHeight;
      const parent = node.parentNode;
      if (parent && parent.scrollHeight) parent.scrollTop = parent.scrollHeight;
      await sleep(opts.delay || 16);
    }
    node.textContent = text;
  }

  /*
   * "Try an example" fills the app in front of you instead of snapping to a
   * finished screen. It types into the same inputs a person types into, which
   * is the point: watching the checklist and the essay arrive, and then the
   * marks land on the text, is the shortest honest explanation of the product
   * there is — and it also shows you exactly where your own writing goes.
   */
  async function runDemo() {
    if (demoRunning) return stopDemo();

    const r = RUBRICS[0];
    const w = WORKS.find((x) => x.rubricId === r.id);

    if (reduced()) { loadExample(); paintRail(); render(); return runRead(); }

    demoRunning = true;
    setDemoButton(true);
    showRail();

    state.rubric = blankRubric();
    state.rubric.name = r.name;
    state.rubric.context = r.context;
    state.work = blankWork();
    state.result = null; state.selected = null; state.stale = false; state.mode = "write";
    paintRail();
    render();

    // 1. the title
    await typeValue(document.getElementById("doc-title"), w.title, 16);
    if (!demoRunning) return stopDemo();
    state.work.title = w.title;
    paintEssayTitle();

    // 2. the checklist, one row at a time, into the real rows
    for (const c of r.criteria) {
      if (!demoRunning) return stopDemo();
      const input = addCriterion({ id: c.id, name: "", descriptor: "", lookFor: c.lookFor });
      const row = state.rubric.criteria[state.rubric.criteria.length - 1];
      await typeValue(input, c.name, 18);
      if (!demoRunning) return stopDemo();
      row.name = c.name;
      row.descriptor = c.descriptor;
      const desc = input.parentNode.querySelector(".crit-desc");
      if (desc) { desc.value = c.descriptor; grow(desc); }
      paintCounts();
      await sleep(70);
    }
    await sleep(200);

    // 3. the essay, into the real editable document
    if (!demoRunning) return stopDemo();
    const doc = document.getElementById("doc");
    doc.classList.add("is-typing");
    await typeText(doc, w.text, { byWord: true, delay: 15, chunk: 9 });
    doc.classList.remove("is-typing");
    if (!demoRunning) return stopDemo();
    state.work.text = w.text;
    paintCounts();
    await sleep(280);

    // 4. and it gets read
    demoRunning = false;
    setDemoButton(false);
    await runRead();
  }

  function stopDemo() {
    const doc = document.getElementById("doc");
    if (doc) doc.classList.remove("is-typing");
    demoRunning = false;
    setDemoButton(false);
    /* keep whatever it managed to type — it is the user’s page now */
    if (doc && state.mode === "write") state.work.text = readDoc(doc);
    const title = document.getElementById("doc-title");
    if (title) state.work.title = title.value;
    render();
  }

  function setDemoButton(on) {
    const b = document.getElementById("btn-demo");
    if (!b) return;
    b.textContent = on ? "Stop" : "Try an example";
    b.classList.toggle("is-running", on);
  }

  /*
   * Ask — a small assistant docked under the findings.
   *
   * Two rules make it worth having rather than decorative. It is grounded:
   * every answer is built from the essay text and the read currently on
   * screen, so it can quote real lines and it can say "the essay does not
   * answer that". And it inherits the same refusal as everything else — asked
   * for a mark, it declines and says why.
   *
   * It uses whichever reader is available. With no model at all it still
   * answers the questions a marker actually asks, off the close reader's own
   * analysis, because those are lookups rather than judgements.
   */
  const ASK_SYSTEM =
    "You are helping a teacher understand one student essay they are marking. " +
    "Answer ONLY from the essay text given. Quote the essay directly when you can. " +
    "If the essay does not address the question, say so plainly. " +
    "Never give a score, mark, grade, band or percentage, and never estimate one. " +
    "Earlier turns are given for context so follow-up questions make sense; " +
    "answer the latest question, not the earlier ones.";

  const MARK_ASK = /\b(what|which|give|assign|guess|estimate)?\s*(mark|grade|score|percent|percentage|out of|level|band)\b/i;

  /*
   * The lookups, and what each one actually sounds like.
   *
   * Anchored to how the question is phrased, so "improve this paragraph:
   * <400 words>" is not read as a request for the list of gaps. `verb` is
   * checked against the whole input; every pattern still has to clear the
   * length gate below.
   */
  const INTENTS = [
    { key: "gaps",      re: /^(what(\047s| is| are)?\s+)?(is\s+)?(missing|lacking)\b|\bwhat\s+(is|are)\s+(missing|the gaps?)\b|\bany\s+gaps?\b|\bwhat\s+did\s+(they|he|she|it)\s+miss\b|\bwhich\s+(ones?|items?)\s+(are|is)\s+(weak|thin|missing)\b/ },
    { key: "contested", re: /\bcontested\b|\bdisagree(d|ment)?\b|\bsplit\b|\bflagged\b|\bwhich\s+ones?\s+need\s+a\s+human\b|\bsecond look\b/ },
    { key: "paragraph", re: /\bwhich\s+paragraph\b|\bweakest\s+paragraph\b|\bleast\s+work\b|\bwhich\s+section\b/ },
    { key: "evidence",  re: /^show me the evidence\b|\bwhere(\047s| is)?\s+the\s+evidence\b|\bshow\s+me\s+the\s+(lines?|quotes?)\b|\bwhich\s+lines?\b|\bquote\s+the\b/ },
  ];

  /*
   * A question is short. A passage someone wants rewritten is not, and the one
   * thing the old matcher could not tell apart was "what is missing?" from
   * four hundred words that happen to contain the word "missing".
   */
  const ASK_MAX = 140;

  function intentOf(q) {
    const low = q.trim().toLowerCase();
    if (low.length > ASK_MAX) return null;
    for (const it of INTENTS) if (it.re.test(low)) return it.key;
    return null;
  }

  function askGrounded(q) {
    /* Answers that do not need a model: they are lookups over the read the
       close reader already produced. */
    const res = state.result;
    const intent = intentOf(q);
    if (!intent) return null;

    if (!res) {
      return "I have not read it yet. Press Read it, then ask me again \u2014 " +
        "after that I can point at the actual lines.";
    }

    if (intent === "gaps") {
      /* A flagged criterion is one the two readers could not settle, so it
         is not evidenced - it is unresolved. Answering from status alone
         said "everything is evidenced" while the panel beside it was asking
         the teacher to go and check one. */
      const weak = res.criteria.filter((c) => c.status !== "evidenced");
      const contested = res.criteria.filter((c) => c.flagged && c.status === "evidenced");

      const lines = weak
        .map((c) => "\u2022 " + c.name + " \u2014 " + (c.moves[0] || c.gaps[0] || ""))
        .concat(contested.map((c) =>
          "\u2022 " + c.name + " \u2014 the two readers disagree here, so it is not settled. " +
          (c.flagReason || "")));

      if (!lines.length) {
        return "Every item on your checklist is evidenced, and both readers agree on all of them. " +
          "What is left is a matter of degree \u2014 open any item to see where it is thin.";
      }
      return lines.join("\n");
    }

    if (intent === "contested") {
      const f = res.criteria.filter((c) => c.flagged);
      if (!f.length) {
        return res.readers && res.readers.wide
          ? "Nothing is contested. Both readers landed in the same place on all " + res.criteria.length + " items."
          : "Nothing is flagged, but only the close reader ran \u2014 so nothing had anything to disagree with. Turn the second reader on in Settings to get a real second opinion.";
      }
      return f.map((c) => "\u2022 " + c.name + " \u2014 " + c.flagReason).join("\n");
    }

    if (intent === "paragraph") {
      const paras = [];
      let at = 0;
      state.work.text.split(/\n\s*\n/).forEach((p, i) => {
        const from = state.work.text.indexOf(p, at);
        paras.push({ i: i + 1, start: from, end: from + p.length, words: p.trim().split(/\s+/).length, hits: 0 });
        at = from + p.length;
      });
      if (paras.length < 2) return "This is one block of text, so there are no paragraphs to compare. Break it up and ask me again.";
      res.criteria.forEach((c) => c.evidence.forEach((e) => {
        const p = paras.find((x) => e.start >= x.start && e.start < x.end);
        if (p) p.hits++;
      }));
      const real = paras.filter((p) => p.words > 25);
      if (!real.length) return "Every paragraph here is too short to compare fairly.";
      real.sort((x, y) => (x.hits / x.words) - (y.hits / y.words));
      const worst = real[0];
      const best = real[real.length - 1];
      return "Paragraph " + worst.i + " is doing the least work: " + worst.words + " words and " +
        (worst.hits ? worst.hits + " line" + (worst.hits === 1 ? "" : "s") : "nothing") +
        " that answers your checklist.\n\nFor contrast, paragraph " + best.i + " carries " + best.hits +
        " in " + best.words + " words. That is the gap worth showing the student.";
    }

    if (intent === "evidence") {
      const withEv = res.criteria.filter((c) => c.evidence.length);
      if (!withEv.length) return "There is nothing in this essay to point at yet.";
      return withEv.map((c) => c.name + ":\n  \u201C" + c.evidence[0].text.trim() + "\u201D").join("\n\n");
    }
    return null;
  }

  async function ask(q) {
    if (MARK_ASK.test(q)) {
      return "I will not put a number on it. Bands describe what the writing evidences; a mark is a judgement about the student, and that one is yours.\n\nWhat I can do is tell you which item is thinnest, or show you the lines behind any of them.";
    }
    const local = askGrounded(q);
    if (local) return local;

    /*
     * The turns so far go in with the question.
     *
     * Without them every question was answered cold, so "what about the
     * second one?" had nothing to attach to - the assistant could be
     * queried but not talked to. Only the last few turns, and each one
     * clipped: the essay is already most of the prompt, and the on-device
     * model has a small window to fit all of it into.
     */
    const history = askLog
      .filter((m) => !m.pending && m.text)
      .slice(-6)
      .map((m) => (m.who === "you" ? "TEACHER: " : "YOU: ") +
        (m.text.length > 700 ? m.text.slice(0, 700) + "\u2026" : m.text))
      .join("\n\n");

    const prompt = [
      "THE ESSAY:", '"""', state.work.text, '"""', "",
      history ? "WHAT HAS BEEN SAID SO FAR:\n" + history + "\n" : "",
      "THE QUESTION: " + q,
    ].filter(Boolean).join("\n");

    if (global.OnDevice && (await global.OnDevice.status()) === "available") {
      const out = await global.OnDevice.raw(ASK_SYSTEM, prompt);
      if (out) return out;
    }
    return "I could not reach a model for that one. The second reader is off \u2014 turn it on in Settings, or ask me what is missing, what is contested, or to show you the evidence, and I can answer those from the read itself.";
  }

  /*
   * Fabric names its assistant above each answer, and Notion hangs a small row
   * of actions under it. Both cost one line and both change what the thing
   * feels like: an answer you can do something with, from something that has a
   * name, rather than text that appeared in a box.
   */
  /*
   * One message, as an element - with its own handlers.
   *
   * These used to be bound by re-scanning the whole log on every paint. Once
   * paintAsk stopped rebuilding the list, that meant a node collected one more
   * listener each time, and "Add to feedback" pushed the same paragraph as
   * many times as it had been painted. It printed four times in the student
   * sheet, which is the one artifact that leaves the building.
   */
  function askNode(m, i) {
    const wrap = document.createElement("div");
    wrap.className = "ask-msg ask-" + m.who;
    wrap.dataset.pending = m.pending ? "1" : "0";

    if (m.who === "you") {
      wrap.innerHTML = "<p>" + esc(m.text) + "</p>";
      return wrap;
    }

    wrap.innerHTML =
      '<span class="ask-who"><svg aria-hidden="true"><use href="#i-spark"/></svg>Second Reader</span>' +
      (m.pending
        ? '<p class="ask-dots" aria-hidden="true"><i></i><i></i><i></i></p>'
        /* Answers are Markdown - the model writes lists and emphasis, and the
           grounded lookups return bullets. Markdown.render escapes every leaf
           before it builds any markup, so this is safe to assign. */
        : '<div class="md ask-md">' + Markdown.render(m.text) + "</div>" +
          '<div class="ask-acts">' +
            '<button type="button" data-copy>' +
              '<svg aria-hidden="true"><use href="#i-copy"/></svg>Copy</button>' +
            '<button type="button" data-into>' +
              '<svg aria-hidden="true"><use href="#i-corner"/></svg>Add to feedback</button>' +
          "</div>");

    const copyBtn = wrap.querySelector("[data-copy]");
    if (copyBtn) copyBtn.addEventListener("click", async () => {
      toast((await copy(m.text)) ? "Copied." : "Could not reach the clipboard.");
    });

    const intoBtn = wrap.querySelector("[data-into]");
    if (intoBtn) intoBtn.addEventListener("click", () => {
      /* Pressing it twice on purpose should not print the note twice either. */
      if (askNotes.indexOf(m.text) !== -1) return toast("Already in the feedback.");
      askNotes.push(m.text);
      paintFeedback();
      autoSave();
      toast("Added. It goes out with the student feedback.");
    });

    return wrap;
  }

  /* Collapsed, the pill is the only clue that a conversation exists at all. */
  function paintAskCount() {
    const asked = askLog.filter((m) => m.who === "you").length;

    /* On the tab, because that is where the answers are. */
    const badge = document.getElementById("ask-count");
    if (badge) {
      badge.hidden = !asked;
      badge.textContent = String(asked);
    }
    const clear = document.getElementById("ask-clear");
    if (clear) clear.hidden = !askLog.length;

    /* The composer keeps a quieter hint, so somebody typing under the essay
       still knows there is a conversation waiting in the column beside it. */
    const key = document.getElementById("composer-key");
    const input = document.getElementById("ask-input");
    if (!key) return;
    const busy = input && input.value.trim();
    if (asked && !busy && state.tab !== "ask") {
      key.textContent = asked + (asked === 1 ? " answer" : " answers");
      key.classList.add("has-chat");
    } else {
      key.textContent = MODKEY + "/";
      key.classList.remove("has-chat");
    }
  }

  function paintAsk() {
    paintAskCount();
    const log = document.getElementById("ask-log");
    if (!log) return;
    const pending = askLog.length && askLog[askLog.length - 1].pending;

    /* aria-busy on the log would suppress the live update it is describing, so
       "Thinking" is its own status node outside it. */
    const status = document.getElementById("ask-status");
    if (status) status.textContent = pending ? "Thinking" : "";

    /*
     * Only the tail is touched. Replacing the list wholesale made every node
     * new, so role="log" re-read the entire conversation on each turn, and any
     * button the reader had tabbed onto vanished under them.
     */
    /*
     * A different conversation, not merely a shorter one.
     *
     * This renderer appends the tail on purpose - rebuilding the list made
     * role="log" re-read the whole thing every turn. But every path that
     * SWITCHES essays assigns a brand new array, while an ordinary question
     * pushes onto the existing one. So identity is the exact test: same array,
     * append; different array, start again. Length alone missed it, and
     * opening a second essay appended its chat under the first one's.
     */
    if (askPainted !== askLog || askLog.length < log.children.length) {
      log.innerHTML = "";
      askPainted = askLog;
    }
    /* Only when it changed: replacing it every paint made aria-live re-read
       the last answer each time the composer was focused. */
    if (log.children.length && log.children.length === askLog.length) {
      const last = askLog[askLog.length - 1];
      const node = log.children[log.children.length - 1];
      if (node.dataset.pending !== (last.pending ? "1" : "0")) {
        log.replaceChild(askNode(last, askLog.length - 1), node);
      }
    }
    for (let i = log.children.length; i < askLog.length; i++) {
      log.appendChild(askNode(askLog[i], i));
    }

    log.scrollTop = log.scrollHeight;
  }

  /* Anything the teacher kept from the assistant rides along on the handback,
     so asking a question and using the answer are the same motion. */
  let askNotes = [];

  /* Which reader is going to answer, said plainly on the composer. */
  function paintAskSource() {
    const pill = document.getElementById("ask-src");
    const label = document.getElementById("ask-src-label");
    if (!pill || !label) return;
    const which = state.result && state.result.readers ? state.result.readers.which : null;
    let text = "From the read", off = !state.result;
    if (which === "device") text = "On your device";
    else if (which === "wide") text = "Gemini";
    label.textContent = text;
    pill.classList.toggle("is-off", off);
  }

  /*
   * The conversation, and the essay it belongs to.
   *
   * Tracking the owner is what makes a chat landing on the wrong essay
   * impossible rather than merely unlikely. Every path that changes which
   * document is open has to set both, and a save refuses to write a log whose
   * owner is not the entry being written.
   */
  let askLog = [];
  let askOwner = null;
  let askPainted = null; // the array the log element currently shows
  let asking = false;

  async function submitAsk(q) {
    if (asking || !q.trim()) return;
    if (!docText()) { setMode("write"); toast("Put the essay in first."); return; }
    asking = true;
    askOwner = state.entryId;
    setAsk(true);
    askLog.push({ who: "you", text: q });
    askLog.push({ who: "sr", text: "", pending: true });
    paintAsk();
    askSync();
    const answer = await ask(q);
    askLog[askLog.length - 1] = { who: "sr", text: answer };
    asking = false;
    paintAsk();
    askSync();
    autoSave();
  }

  function wireAsk() {
    /* The shortcut puts the caret in the composer rather than opening a
       panel - the panel is always there now. */
    document.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "/") {
        e.preventDefault();
        const input = document.getElementById("ask-input");
        if (input) { input.focus(); input.select(); }
      }
    });

    const clear = document.getElementById("ask-clear");
    if (clear) clear.addEventListener("click", () => {
      askLog = [];
      askOwner = state.entryId;
      autoSave();
      paintAsk();
      askSync();
      toast("Conversation cleared.");
    });

    const form = document.getElementById("ask-form");
    const input = document.getElementById("ask-input");
    const send = document.getElementById("ask-send");
    if (!form || !input) return;

    const sync = () => {
      input.style.height = "auto";
      input.style.height = Math.min(input.scrollHeight, 132) + "px";
      send.disabled = !input.value.trim() || asking;
      const chips = document.getElementById("ask-chips");
      if (chips) chips.hidden = askLog.length > 0;
      const key = document.getElementById("composer-key");
      if (key) key.hidden = !!input.value.trim();
    };
    askSync = sync;

    input.addEventListener("input", sync);
    /* Enter sends, Shift+Enter breaks the line. In a composer that grows, the
       other way round means people write one long line and never find out. */
    input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" || e.shiftKey) return;
      e.preventDefault();
      form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event("submit", { cancelable: true }));
    });

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const q = input.value;
      input.value = "";
      sync();
      submitAsk(q);
    });
    document.querySelectorAll("[data-ask]").forEach((b) =>
      b.addEventListener("click", () => submitAsk(b.getAttribute("data-ask")))
    );
    sync();
  }

  let askSync = function () {};
  /*
   * The dock can be moved.
   *
   * It sits over the essay by design - that is the thing it answers about -
   * but "over the essay" and "over the paragraph I am reading" are the same
   * place often enough to be a nuisance. Dragging it by its header moves it
   * anywhere inside the document pane, and where it is put is remembered.
   */

  /*
   * Is something up that owns the keyboard?
   *
   * This used to ask whether #layer had any child at all - but ui.js puts
   * TOASTS in that same layer for 2.6 seconds. So for nearly three seconds
   * after every toast, which includes the app\u2019s most common action, Escape
   * would not close the ask dock and the shortcut silently did nothing. Only a
   * dialog traps the keyboard, so only a dialog counts.
   */
  /*
   * Showing the answers now means putting the side column on the Ask tab.
   * Kept under the old name because the rest of the file already calls it.
   */
  function setAsk(open) {
    if (open) setTab("ask");
  }

  /* --------------------------------- the shelf ------------------------------- */

  /*
   * Nobody marks one essay. They mark a set, put three aside, and want the
   * checklist still there tomorrow. The page saves itself whenever a read
   * finishes, so there is no Save button to forget - the only explicit act is
   * starting a new one.
   */
  function shelfSnapshot() {
    const found = state.result ? state.result.criteria.filter((c) => c.status === "evidenced").length : null;
    return {
      id: state.entryId,
      title: state.work.title,
      text: state.work.text,
      rubricName: state.rubric.name,
      rubricLevel: state.rubric.level || "",
      criteria: state.rubric.criteria,
      stat: state.result ? { found: found, total: state.result.criteria.length,
                             flagged: state.result.criteria.filter((c) => c.flagged).length } : null,
      /* The pending placeholder is a spinner, not a message - and a log that
         belongs to a different entry is not this entry's to write. */
      bands: state.result
        ? state.result.criteria.reduce((o, c) => { o[c.name] = c.status; return o; }, {})
        : null,
      chat: askOwner === null || askOwner === state.entryId ? askLog.filter((m) => !m.pending) : [],
      notes: askOwner === null || askOwner === state.entryId ? askNotes : [],
      source: state.work.source || "typed",
      meta: state.work.classroom || null,
    };
  }

  /*
   * Saving is not an act the teacher performs. It happens when a read lands,
   * a couple of seconds after they stop typing, when they switch to another
   * essay, and when the tab goes away - because the one time it matters is the
   * time they closed the laptop without thinking about it.
   *
   * A checklist is not required. Half an essay with nothing to mark it against
   * is still half an essay, and losing it because the rubric was not typed yet
   * would be the worst version of this.
   */
  function autoSave() {
    /* The landing page embeds this same page at ?example=1#app to show the
       product working. Scrolling a marketing page should not put a phantom
       essay on the visitor's shelf. */
    if (global.self !== global.top) return;
    if (docText().length < 40) return;

    /* A fresh page has no entry id, so reloading the same essay - or opening
       the example twice - used to shelve a second identical copy every time.
       Same title and same words is the same piece of work. */
    if (!state.entryId) {
      const twin = Shelf.list().find((e) => e.text === state.work.text && e.title === (state.work.title || "Untitled essay"));
      if (twin) {
        state.entryId = twin.id;
        /* This page IS that entry, so it inherits its conversation too. Without
           this, reloading straight into an essay - rather than opening it from
           the shelf - adopted the saved record but started the chat again from
           nothing, and the answers looked lost. */
        if (!askLog.length && Array.isArray(twin.chat) && twin.chat.length) {
          askLog = twin.chat.slice();
          askOwner = twin.id;
          askNotes = Array.isArray(twin.notes) ? twin.notes.slice() : [];
          paintAsk();
          askSync();
        }
      }
    }

    const out = Shelf.save(shelfSnapshot());
    if (out.ok) {
      state.entryId = out.id;
      if (askOwner === null) askOwner = out.id;
      paintShelfBadge();
      return;
    }
    /* Said once, plainly, rather than swallowed - a save that silently failed
       is worse than no saving at all. */
    toast(out.error === "count"
      ? "The shelf is full at " + Shelf.MAX_ENTRIES + " essays. Delete one to keep saving."
      : "This browser is out of room. Export your shelf from Account, then clear it.");
  }

  /*
   * Everything that is about the document currently open, cleared in one
   * place.
   *
   * Three functions used to reset this by hand and each of them forgot
   * something different: "Start a blank page" kept the old entry id and
   * autosaved a blank essay over a marked one, and the edited feedback sheet
   * survived a switch, so one student's comments could be copied out under
   * another student's name. Both were the same bug twice.
   */
  function resetDocument() {
    state.result = null;
    state.selected = null;
    state.stale = false;
    state.mode = "write";
    askLog = [];
    askOwner = null;
    askNotes = [];
    fbEdit.student = null;
    fbEdit.teacher = null;
    const host = document.getElementById("fb-body");
    if (host) host.innerHTML = "";
  }

  function openEntry(id) {
    const e = Shelf.get(id);
    if (!e) return toast("That one is no longer here.");
    autoSave(); // whatever is on screen right now is not lost by leaving it
    resetDocument();
    state.entryId = e.id;
    state.rubric = { id: "own-rubric", name: e.rubricName, context: "Yours", level: e.rubricLevel || "",
      criteria: (e.criteria || []).map((c) => ({ id: c.id || ("c" + ++critSeq), name: c.name, descriptor: c.descriptor, lookFor: [] })) };
    state.work = { id: "own-work", rubricId: "own-rubric", label: e.title, title: e.title,
      meta: "", text: e.text, source: e.source, classroom: e.meta };
    /* Ids came back from storage, but the counter that mints them restarts at
       zero every page load - so the next row added would collide with a
       restored one, and two criteria sharing an id means the second shows the
       first's evidence and never highlights anything. */
    state.rubric.criteria.forEach((c) => {
      const n = /^c(\d+)$/.exec(c.id);
      if (n) critSeq = Math.max(critSeq, Number(n[1]));
    });
    /* resetDocument() has just emptied these; the entry's own conversation
       goes back in on top. It belongs to this essay, not to the app. */
    askLog = Array.isArray(e.chat) ? e.chat.slice() : [];
    askOwner = e.id;
    askNotes = Array.isArray(e.notes) ? e.notes.slice() : [];

    closeShelf();
    paintRail(); paintAsk(); render(); askSync();
    if (ready()) runRead();
  }

  function newEntry() {
    autoSave();
    resetDocument();
    /* Keep the checklist. Starting the next essay in a set and having to retype
       the rubric is the single most annoying thing a marking tool can do. */
    const keep = state.rubric.criteria.map((c) => ({ id: c.id, name: c.name, descriptor: c.descriptor, lookFor: [] }));
    state.entryId = null;
    state.work = blankWork();
    state.rubric = { id: "own-rubric", name: state.rubric.name, context: "Yours",
                     level: state.rubric.level || "", criteria: keep };
    closeShelf();
    paintRail(); paintAsk(); render(); askSync();
    const d = document.getElementById("doc");
    if (d) d.focus();
  }

  /* A bare chevron beside the title reads as a stray control. Saying what it
     holds is the whole difference between finding it and not. */
  /*
   * The title in the sidebar, split out from the count.
   *
   * They used to be painted together, and only when the shelf changed or
   * somebody typed in the title field. A title set in code - opening a saved
   * essay, or the demo typing one in - never reached the sidebar, so it sat
   * reading "Untitled essay" while the bar directly above it said something
   * else. The title is cheap, so it goes in render(); the count reads storage,
   * so it stays where it was.
   */
  function paintEssayTitle() {
    const now = document.getElementById("essay-now");
    const title = state.work.title || "Untitled essay";
    if (now && now.textContent !== title) now.textContent = title;
    const btn = document.getElementById("btn-shelf");
    const count = document.getElementById("shelf-count");
    if (btn) btn.setAttribute("aria-label", title + ". " + (count ? count.textContent : ""));
  }

  function paintShelfBadge() {
    const count = document.getElementById("shelf-count");
    const n = Shelf.list().length;
    if (count) count.textContent = n ? n + " saved \u00b7 switch" : "Nothing saved yet";
    paintEssayTitle();
  }

  function closeShelf(keepFocus) {
    const s = document.querySelector(".shelf-sheet");
    if (!s) return;
    s.remove();
    const b = document.getElementById("btn-shelf");
    if (b) {
      b.setAttribute("aria-expanded", "false");
      /* Removing the sheet outright drops focus to <body>, and the next Tab
         restarts from the top of the page. */
      if (!keepFocus && s.contains(document.activeElement)) b.focus();
    }
  }

  function openShelf(btn) {
    if (document.querySelector(".shelf-sheet")) return closeShelf();
    const all = Shelf.list();
    const sheet = document.createElement("div");
    sheet.className = "shelf-sheet";
    sheet.innerHTML =
      '<p class="shelf-head">Saved on this computer</p>' +
      (all.length
        ? '<div class="shelf-list">' + all.map((e) => {
            const stat = e.stat ? e.stat.found + "/" + e.stat.total + " found" : "not read yet";
            const words = e.text.trim() ? e.text.trim().split(/\s+/).length + " words" : "empty";
            return '<div class="shelf-row' + (e.id === state.entryId ? " on" : "") + '">' +
              '<button class="shelf-open" data-open="' + esc(e.id) + '">' +
                "<b>" + esc(e.title) + "</b>" +
                "<span>" + esc(words + " \u00b7 " + stat) + (e.source === "classroom" ? " \u00b7 Classroom" : "") + "</span>" +
              "</button>" +
              '<button class="shelf-del" data-del="' + esc(e.id) + '" aria-label="Delete ' + esc(e.title) + '">' +
                '<svg aria-hidden="true"><use href="#i-trash"/></svg></button>' +
            "</div>";
          }).join("") + "</div>"
        : '<p class="shelf-none">Nothing saved yet. Anything you read gets kept here.</p>') +
      '<div class="shelf-foot">' +
        '<button data-new><svg aria-hidden="true"><use href="#i-plus"/></svg>New essay, same checklist</button>' +
        (Classroom.configured() ? '<button data-gc><svg aria-hidden="true"><use href="#i-file"/></svg>Import from Classroom</button>' : "") +
      "</div>";

    sheet.addEventListener("click", (e) => {
      const open = e.target.closest("[data-open]");
      if (open) return openEntry(open.getAttribute("data-open"));
      const del = e.target.closest("[data-del]");
      if (del) {
        const id = del.getAttribute("data-del");
        Shelf.remove(id);
        if (id === state.entryId) state.entryId = null;
        paintShelfBadge();
        closeShelf();
        openShelf(btn);
        return;
      }
      if (e.target.closest("[data-new]")) return newEntry();
      if (e.target.closest("[data-gc]")) { closeShelf(); return openClassroom(); }
    });

    btn.parentNode.appendChild(sheet);
    btn.setAttribute("aria-expanded", "true");
  }

  /* ------------------------------ Google Classroom --------------------------- */

  const GC_WHY = {
    "no-client": "This needs an OAuth client id from your own Google Cloud project. Add one in Account \u203a Classroom.",
    "offline": "Could not reach Google. Check the connection and try again.",
    "denied": "Google did not grant access. Nothing was imported.",
    "popup_failed_to_open": "The browser blocked the Google window. Allow pop-ups for this page and try again.",
    "popup_closed_by_user": "The Google window closed before it finished.",
    "bad-client": "That client id was rejected by Google.",
    "expired": "The Google session ran out. Connect again.",
    "forbidden": "Google refused that. The Classroom API has to be enabled on the project, and the account has to teach the course.",
    "not-connected": "Not connected to Classroom.",
    "not-text": "That submission is not text \u2014 a PDF or a photo cannot be read here.",
  };
  const gcWhy = (e) => GC_WHY[e] || ("Google returned an error (" + e + ").");

  /*
   * Course, then assignment, then whose work to bring in. One modal that
   * repaints, rather than three - a wizard that keeps closing and reopening
   * loses the teacher's place.
   */
  async function openClassroom() {
    if (!Classroom.configured()) {
      toast(GC_WHY["no-client"]);
      return openAccount("classroom");
    }

    let step = "connect", courses = [], course = null, work = [], chosen = null, subs = [], gcRubric = null, busy = false;

    modal(
      '<h2>Import from Google Classroom</h2><div id="gc-body"></div>',
      (box, close) => {
        const body = box.querySelector("#gc-body");

        const fail = (e) => { step = "error"; body.dataset.why = gcWhy(e); paint(); };

        const paint = () => {
          if (busy) {
            body.innerHTML = '<p class="sub"><i class="spin"></i> Talking to Google\u2026</p>';
            return;
          }
          if (step === "error") {
            body.innerHTML = '<p class="sub">' + esc(body.dataset.why || "") + "</p>" +
              '<div class="modal-actions"><button class="btn btn-ghost" data-close>Close</button>' +
              '<button class="btn" data-retry>Try again</button></div>';
          } else if (step === "connect") {
            body.innerHTML =
              '<p class="sub">Second Reader will read your course list, your assignments, and the documents ' +
                "your students handed in. It is read-only \u2014 nothing is ever written back to Classroom, " +
                "no grade is sent, and no student sees anything.</p>" +
              '<div class="modal-actions"><button class="btn btn-ghost" data-close>Cancel</button>' +
              '<button class="btn" data-connect>Connect Google</button></div>';
          } else if (step === "course") {
            body.innerHTML = '<p class="sub">Which class?</p><div class="gc-list">' +
              (courses.length
                ? courses.map((c) => '<button data-course="' + esc(c.id) + '"><b>' + esc(c.name) + "</b>" +
                    (c.section ? "<span>" + esc(c.section) + "</span>" : "") + "</button>").join("")
                : '<p class="gc-none">No active classes on this account.</p>') +
              "</div>";
          } else if (step === "work") {
            body.innerHTML = '<p class="sub">' + esc(course.name) + " \u2014 which assignment?</p><div class=\"gc-list\">" +
              (work.length
                ? work.map((w) => '<button data-work="' + esc(w.id) + '"><b>' + esc(w.title) + "</b></button>").join("")
                : '<p class="gc-none">No published assignments in this class.</p>') +
              "</div>";
          } else if (step === "subs") {
            body.innerHTML =
              '<p class="sub">' + esc(chosen.title) + " \u2014 " + subs.length +
                " handed in with a document attached.</p>" +
              (gcRubric
                ? '<label class="gc-use"><input type="checkbox" id="gc-userubric" checked> ' +
                  "Use this assignment\u2019s Classroom rubric as the checklist (" + gcRubric.criteria.length + " criteria)</label>"
                : '<p class="gc-note">This assignment has no Classroom rubric the API will hand over, so your ' +
                  "current checklist is kept.</p>") +
              '<div class="gc-list gc-subs">' +
                subs.map((s, i) => '<label><input type="checkbox" data-sub="' + i + '" checked>' +
                  "<b>" + esc(s.who) + "</b><span>" + esc(s.fileName || "document") +
                  (s.late ? " \u00b7 late" : "") + "</span></label>").join("") +
              "</div>" +
              '<div class="modal-actions"><button class="btn btn-ghost" data-close>Cancel</button>' +
              '<button class="btn" data-import>Import</button></div>';
          } else if (step === "done") {
            body.innerHTML = '<p class="sub">' + esc(body.dataset.why || "") + "</p>" +
              '<div class="modal-actions"><button class="btn" data-close>Done</button></div>';
          }

          box.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", close));
          const retry = body.querySelector("[data-retry]");
          if (retry) retry.addEventListener("click", () => { step = "connect"; paint(); });

          const conn = body.querySelector("[data-connect]");
          if (conn) conn.addEventListener("click", async () => {
            busy = true; paint();
            const c = await Classroom.connect();
            busy = false;
            if (!c.ok) return fail(c.error);
            const list = await Classroom.courses();
            if (!list.ok) return fail(list.error);
            courses = list.courses; step = "course"; paint();
          });

          body.querySelectorAll("[data-course]").forEach((b) => b.addEventListener("click", async () => {
            course = courses.find((c) => c.id === b.getAttribute("data-course"));
            busy = true; paint();
            const w = await Classroom.assignments(course.id);
            busy = false;
            if (!w.ok) return fail(w.error);
            work = w.work; step = "work"; paint();
          }));

          body.querySelectorAll("[data-work]").forEach((b) => b.addEventListener("click", async () => {
            chosen = work.find((w) => w.id === b.getAttribute("data-work"));
            busy = true; paint();
            const s = await Classroom.submissions(course.id, chosen.id);
            /* The rubric endpoint is newer than the rest and is not on every
               account. Not having it is not a failure. */
            const r = await Classroom.rubric(course.id, chosen.id);
            gcRubric = r.ok ? r : null;
            busy = false;
            if (!s.ok) return fail(s.error);
            subs = s.submissions; step = "subs"; paint();
          }));

          const go = body.querySelector("[data-import]");
          if (go) go.addEventListener("click", async () => {
            const picked = Array.prototype.slice.call(body.querySelectorAll("[data-sub]:checked"))
              .map((n) => subs[Number(n.getAttribute("data-sub"))]);
            if (!picked.length) return toast("Pick at least one.");

            const useRubric = gcRubric && body.querySelector("#gc-userubric") && body.querySelector("#gc-userubric").checked;
            const criteria = useRubric ? gcRubric.criteria : state.rubric.criteria;
            const rubricName = useRubric ? chosen.title : state.rubric.name;

            busy = true; paint();
            let saved = 0, skipped = 0, firstId = null;
            for (const s of picked) {
              const t = await Classroom.textOf(s.fileId);
              if (!t.ok || t.text.length < 40) { skipped++; continue; }
              const out = Shelf.save({
                title: s.who + " \u2014 " + chosen.title,
                text: t.text,
                rubricName: rubricName,
                criteria: criteria,
                source: "classroom",
                meta: { course: course.name, work: chosen.title, who: s.who },
              });
              if (!out.ok) break;
              if (!firstId) firstId = out.id;
              saved++;
            }
            busy = false;

            paintShelfBadge();
            step = "done";
            body.dataset.why = saved
              ? saved + " essay" + (saved === 1 ? "" : "s") + " on your shelf" +
                (skipped ? ", " + skipped + " skipped because they were not readable text" : "") + "."
              : "Nothing could be read \u2014 those submissions are not text documents.";
            paint();
            if (firstId) setTimeout(() => openEntry(firstId), 400);
          });
        };
        paint();
      }
    );
  }

  /* ------------------------------- look closer ------------------------------- */

  const BAND_WORD = { evidenced: "Found it", partial: "Half there", missing: "Not there" };

  /*
   * Two closer looks, in one place, both computed here on the page.
   *
   * The authorship half is deliberately not a detector. It reports things a
   * teacher could count by hand and refuses to add them up, because the sum is
   * the part that is not supported by anything - and a confident percentage
   * beside a child's name gets acted on long before anyone asks how it was
   * produced.
   */
  let sigView = "reading";
  let draftAgainst = null;

  /*
   * The things you can fix by changing one sentence, quoted where they sit.
   *
   * Everything here is already computed on every read - hedging, vagueSourcing
   * and concession each keep their raw {phrase, at} hits alongside the score
   * the engine uses, and nothing has ever rendered them. So this needs no model
   * and no key, which is the point.
   *
   * Deliberately absent: any count, any total, any comparison against anything.
   * A heading that said "6 hedges" would be a dial, and clearing a dial is a
   * score going up. There is no number on this panel to move.
   */
  function fixBody() {
    const s = state.result && state.result.signals;
    if (!s) {
      return '<div class="empty"><h3>Read it first.</h3>' +
        "<p>Press Read it and this fills with the lines you can fix without " +
        "rewriting anything.</p></div>";
    }

    const sents = CloseReader.splitSentences(state.work.text);
    const at = (i) => sents.find((x) => i >= x.start && i < x.end);

    /* One sentence can hold three hedges; it is still one thing to go and fix,
       so the first hit wins and the rest of that sentence is skipped. */
    const seen = new Set();
    const rows = (hits) => (hits || [])
      .map((h) => ({ h: h, s: at(h.at) }))
      .filter((r) => r.s && !seen.has(r.s.start) && seen.add(r.s.start))
      .slice(0, 6);

    const block = (title, note, hits) => {
      const list = rows(hits);
      if (!list.length) return "";
      return '<p class="cov-label" role="heading" aria-level="3">' + esc(title) + "</p>" +
        '<p class="ins-note">' + esc(note) + "</p>" +
        list.map((x) =>
          '<button class="quote mid" data-jump="' + x.s.start + '">' + esc(x.s.text) +
          '<span class="who">' + esc(x.h.phrase) + "</span></button>").join("");
    };

    /* An objection raised and then abandoned. Same test the engine uses to
       decide whether a concession was answered, applied to the two sentences
       after the one holding it. */
    const ANSWERED = /\b(but|however|yet|still|even so|the problem|that said)\b/i;
    const hanging = ((s.concession && s.concession.hits) || []).filter((h) => {
      const host = at(h.at);
      return host && !sents.slice(host.i + 1, host.i + 3).some((n) => ANSWERED.test(n.text));
    });

    const html =
      block("Words doing the cushioning",
        "Read each sentence without the word underneath it. If it still says what you " +
        "meant, the word was doing nothing.",
        s.hedging && s.hedging.hits) +
      block("Standing in for a source",
        "Each of these points at a study without naming one. Name it, or drop the claim.",
        s.vagueSourcing && s.vagueSourcing.hits) +
      block("An objection with no answer",
        "You raise the other side here, and the next two sentences never come back to it.",
        hanging);

    return html || '<div class="empty"><h3>Nothing here is a one-line fix.</h3>' +
      "<p>Whatever is left needs a paragraph rather than a word. Open Evidence.</p></div>";
  }

  function paintSignals() {
    const host = document.getElementById("signals-body");
    if (!host) return;
    if (docText().length < 120) {
      host.innerHTML = '<div class="empty"><h3>Not enough here yet.</h3>' +
        "<p>" + (Session.role() === "student"
          ? "Put your essay in and this measures how it reads \u2014 which sentences are " +
            "long, where the going gets heavy, what to read aloud."
          : "Put an essay in and this measures how it reads, and the patterns people " +
            "associate with generated text \u2014 without ever telling you who wrote it.") +
        "</p></div>";
      return;
    }
    /*
     * "How it was written" measures a piece of writing for the patterns people
     * associate with generated text. Read the header of js/signals.js: that
     * half exists for a teacher deciding whether to have a conversation, and
     * it is explicitly not a detector. Handing it to the person being measured
     * is a different act entirely, so a student does not get it - and does not
     * get a disabled button advertising it either.
     *
     * The readability half is another matter: which of your sentences are hard
     * to read is exactly what a writer wants.
     */
    const SUB = Session.role() === "student"
      ? [["reading", "How it reads"], ["fix", "Fix in one line"]]
      : [["reading", "How it reads"], ["authorship", "How it was written"]];
    /* sigView is module-level and survives a role change, so a teacher who was
       looking at authorship and switches to student would otherwise keep it. */
    if (!SUB.some((t) => t[0] === sigView)) sigView = "reading";

    host.innerHTML =
      (SUB.length > 1
        ? '<div class="ins-tabs">' +
            SUB.map((t) => '<button data-ins="' + t[0] + '" aria-pressed="' + (t[0] === sigView) + '">' + t[1] + "</button>")
              .join("") +
          "</div>"
        : "") +
      (sigView === "reading" ? readingBody() : sigView === "fix" ? fixBody() : authorBody());

    host.querySelectorAll("[data-ins]").forEach((b) =>
      b.addEventListener("click", () => {
        sigView = b.getAttribute("data-ins");
        paintSignals();
        /* The repaint replaced the button that was pressed. */
        const now = host.querySelector('[data-ins="' + sigView + '"]');
        if (now) now.focus();
      })
    );
    /* A quote you cannot get to is a screenshot. Every quoted sentence in this
       panel carries the offset it starts at, so it lands you on it. */
    host.querySelectorAll("[data-jump]").forEach((b) =>
      b.addEventListener("click", () => jumpTo(Number(b.getAttribute("data-jump"))))
    );
  }

  function readingBody() {
    const r = Signals.readability(state.work.text);
    if (!r) return '<p class="ins-note">Not enough sentences to measure yet.</p>';

    let html =
      '<p class="ins-note">All counted from the essay itself. None of it is a judgement about ' +
      "quality \u2014 a hard-to-read sentence can be the best one in the piece.</p>" +
      '<div class="cov-tiles">' +
        '<div class="cov-tile"><b>' + r.grade + "</b><span>US grade level to read it</span></div>" +
        '<div class="cov-tile"><b>' + r.wordsPerSentence + "</b><span>words per sentence, across " +
          r.sentences + "</span></div>" +
      "</div>";

    if (r.longest.length) {
      html += '<p class="cov-label" role="heading" aria-level="3">The sentences to read aloud</p>' +
        r.longest.map((s) =>
          '<div class="ins-quote"><b>' + s.words + " words</b><p>" + esc(s.text) + "</p></div>"
        ).join("");
    }

    html += '<p class="cov-label" role="heading" aria-level="3">Two habits worth naming</p>' +
      '<div class="ins-row"><div><b>Passive constructions</b>' +
        "<span>" + r.passive + " of them, " + r.passivePer100 + " per hundred words. " +
        "Passive is not a fault; a page of it hides who did what.</span></div></div>" +
      '<div class="ins-row"><div><b>Nouns made from verbs</b>' +
        "<span>" + r.nominal + " (\u201Cimplementation\u201D for \u201Cimplementing\u201D). " +
        "They make a sentence sound official and say less.</span></div></div>";
    return html;
  }

  function authorBody() {
    const s = Signals.authorship(state.work.text);
    if (!s) return '<p class="ins-note">Not enough writing here to measure anything fairly.</p>';

    return (
      '<div class="ins-warn">' +
        "<b>This is not an AI detector, and it will not give you a verdict.</b>" +
        "<p>Tools that return one are unreliable in a way that lands on real students \u2014 they " +
        "over-flag people writing in a second language, and a confident-looking percentage next to " +
        "a name gets acted on long before anyone checks how it was produced.</p>" +
        "<p>Below are measurements. Every one is something you could count by hand on the page. " +
        "Not one of them means a person did or did not write this.</p>" +
      "</div>" +
      s.rows.map((row) =>
        '<div class="ins-row' + (row.flat ? " is-flat" : "") + '"><div>' +
          "<b>" + esc(row.label) + "</b>" +
          '<span class="ins-val">' + esc(row.value) + "</span>" +
          "<span>" + esc(row.detail) + "</span>" +
          '<span class="ins-note">' + esc(row.note) + "</span>" +
        "</div></div>"
      ).join("") +
      '<div class="ins-warn is-do"><b>The one thing that actually settles it</b>' +
        "<p>Ask the writer to talk you through how they wrote it \u2014 what they cut, where they got " +
        "stuck, why that paragraph is in that order. That conversation is evidence. This page is not.</p></div>"
    );
  }

  /* -------------------------------- the class ------------------------------- */

  /*
   * The same checklist, across everything on the shelf. One essay tells you
   * about one student; twenty tell you what to teach on Monday.
   */
  let clsView = "set", colCrit = null;

  /*
   * One item off the checklist, and the line every piece on the shelf gave you
   * for it. This is how a set actually gets marked, and until now the app made
   * it impossible: everything was organised by paper.
   *
   * Shelf order is kept on purpose - see columnBody.
   */
  async function columnBody(view) {
    const crits = liveCriteria();
    if (!crits.length) {
      view.innerHTML = '<div class="empty"><h3>Write the checklist first.</h3>' +
        "<p>One line per thing you are looking for, then this reads it down the shelf.</p></div>";
      return;
    }

    const crit = crits.find((c) => c.name === colCrit);
    if (!crit) {
      view.innerHTML =
        '<p class="ins-note">Pick one item. This reads it down every piece you have saved, ' +
        "so you are answering the same question thirty times instead of thirty different ones.</p>" +
        '<div class="gc-list">' + crits.map((c) =>
          '<button data-col="' + esc(c.name) + '"><b>' + esc(c.name) + "</b>" +
          "<span>read it down the shelf</span></button>").join("") + "</div>";
      view.querySelectorAll("[data-col]").forEach((b) =>
        b.addEventListener("click", () => { colCrit = b.getAttribute("data-col"); columnBody(view); }));
      return;
    }

    const set = Shelf.list()
      .filter((e) => e.rubricName === state.rubric.name && (e.text || "").trim().length > 80)
      .slice(0, 40);

    if (!set.length) {
      view.innerHTML = '<div class="empty"><h3>Nothing on the shelf yet.</h3>' +
        "<p>Read a second piece against this checklist and this fills with their lines.</p></div>";
      return;
    }

    view.innerHTML = '<p class="ins-note">Reading ' + set.length +
      (set.length === 1 ? " piece" : " pieces") + " for \u201c" + esc(colCrit) + "\u201d\u2026</p>";

    /* ONE criterion in the rubric, so each read costs a fraction of a full one.
       Yielding between them keeps the caret responsive if somebody is typing. */
    const one = { id: state.rubric.id, name: state.rubric.name, context: state.rubric.context,
                  level: state.rubric.level || "", criteria: [crit] };
    const rows = [];
    for (const e of set) {
      await new Promise((r) => setTimeout(r, 0));
      let c = null;
      try {
        const r = CloseReader.read(e.text, one);
        c = r.ok && r.criteria[0];
      } catch (err) { c = null; }
      rows.push({
        id: e.id,
        title: e.title || "Untitled",
        quote: c && c.evidence && c.evidence[0] ? c.evidence[0].text : null,
      });
    }

    const withLine = rows.filter((r) => r.quote);

    view.innerHTML =
      '<div class="drafts-top"><span>\u201c<b>' + esc(colCrit) + "</b>\u201d, down the shelf</span>" +
        '<button class="link-quiet" data-col-back>Change</button></div>' +
      /* Saying it out loud, because the absence of a sort is the whole design. */
      '<p class="ins-note">Shelf order, newest first. Nothing here is ranked.</p>' +
      rows.map((r) =>
        r.quote
          ? '<button class="quote" data-open="' + esc(r.id) + '">' + esc(r.quote) +
            '<span class="who">' + esc(r.title) + "</span></button>"
          : '<button class="quote none" data-open="' + esc(r.id) + '">' +
            "<em>No line to point at for this one.</em>" +
            '<span class="who">' + esc(r.title) + "</span></button>"
      ).join("") +
      /* Both explanations, never just the one that blames the writing. */
      (!withLine.length
        ? '<p class="ins-note">Not one piece gave a line for this. Either the class cannot ' +
          "do it yet, or the wording is asking for something that cannot be pointed at.</p>"
        : "");

    const back = view.querySelector("[data-col-back]");
    if (back) back.addEventListener("click", () => { colCrit = null; columnBody(view); });
    view.querySelectorAll("[data-open]").forEach((b) =>
      b.addEventListener("click", () => openEntry(b.getAttribute("data-open"))));
  }

  function paintClass() {
    const host = document.getElementById("class-body");
    if (!host) return;

    host.innerHTML = '<div class="ins-tabs">' +
      [["set", "The set"], ["column", "The column"]].map((t) =>
        '<button data-cls="' + t[0] + '" aria-pressed="' + (t[0] === clsView) + '">' + t[1] + "</button>"
      ).join("") + '</div><div id="class-view"></div>';
    host.querySelectorAll("[data-cls]").forEach((b) =>
      b.addEventListener("click", () => {
        clsView = b.getAttribute("data-cls");
        paintClass();
        const now = host.querySelector('[data-cls="' + clsView + '"]');
        if (now) now.focus();
      }));

    const view = document.getElementById("class-view");
    if (clsView === "column") return columnBody(view);
    return setBody(view);
  }

  function setBody(host) {
    if (!host) return;
    const all = Shelf.list().filter((e) => e.bands && Object.keys(e.bands).length);
    if (all.length < 2) {
      host.innerHTML = '<div class="empty"><h3>Read two and this fills in.</h3>' +
        "<p>Once a few essays have been read against the same checklist, this shows which item the " +
        "whole set is missing \u2014 which is a lesson to plan, not twenty comments to write.</p></div>";
      return;
    }

    /* Grouped by checklist, because two different rubrics do not add up. */
    const groups = {};
    all.forEach((e) => {
      const k = e.rubricName || "Your checklist";
      (groups[k] = groups[k] || []).push(e);
    });
    const name = Object.keys(groups).sort((x, y) => groups[y].length - groups[x].length)[0];
    const set = groups[name];

    const tally = {};
    set.forEach((e) => Object.keys(e.bands).forEach((c) => {
      const t = (tally[c] = tally[c] || { evidenced: 0, partial: 0, missing: 0, seen: 0 });
      t[e.bands[c]]++;
      t.seen++;
    }));

    const rows = Object.keys(tally).map((c) => {
      const t = tally[c];
      return { name: c, t: t, weak: (t.missing + t.partial) / (t.seen || 1) };
    }).sort((x, y) => y.weak - x.weak);

    const worst = rows[0];
    const lead = worst && worst.weak >= 0.5
      ? "\u201C" + worst.name + "\u201D is missing or thin in " +
        (worst.t.missing + worst.t.partial) + " of " + worst.t.seen +
        ". That is a lesson, not twenty comments."
      : "Nothing on this checklist is failing across the set. The gaps are individual.";

    host.innerHTML =
      '<div class="cov-head t-' + (worst && worst.weak >= 0.5 ? "watch" : "good") + '">' +
        '<p class="cov-head-label" role="heading" aria-level="3">What to do on Monday</p><p>' +
        esc(lead) + "</p></div>" +
      '<p class="ins-note">' + set.length + " essays marked against <b>" + esc(name) + "</b>.</p>" +
      '<p class="cov-label" role="heading" aria-level="3">Every item, across every essay</p>' +
      rows.map((r) => {
        const t = r.t;
        const pc = (n) => ((n / t.seen) * 100).toFixed(1) + "%";
        return '<div class="cls-row">' +
          '<div class="cov-row-top"><span class="cov-name">' + esc(r.name) + "</span>" +
            '<span class="cov-hits">' + t.evidenced + " of " + t.seen + "</span></div>" +
          '<div class="bar"><i class="ok" style="width:' + pc(t.evidenced) + '"></i>' +
            '<i class="mid" style="width:' + pc(t.partial) + '"></i>' +
            '<i class="none" style="width:' + pc(t.missing) + '"></i></div>' +
          '<p class="cls-legend">' + t.evidenced + " found \u00b7 " + t.partial + " half there \u00b7 " +
            t.missing + " not there</p>" +
        "</div>";
      }).join("");
  }

  /* ------------------------------- two drafts ------------------------------- */

  /*
   * Marking a redraft without the first one in front of you means marking it as
   * if it were new, and what moved is the whole point of a redraft.
   */
  function paintDrafts() {
    const host = document.getElementById("drafts-body");
    if (!host) return;

    const others = Shelf.list().filter((e) => e.id !== state.entryId && e.text.trim());
    if (!others.length) {
      host.innerHTML = '<div class="empty"><h3>Nothing to compare against.</h3>' +
        "<p>Save another piece \u2014 an earlier draft, or the same student\u2019s last one \u2014 " +
        "and this shows what was added, what went, and which items moved band.</p></div>";
      return;
    }

    const against = draftAgainst && others.find((e) => e.id === draftAgainst);
    if (!against) {
      host.innerHTML =
        '<p class="ins-note">Compare this against another piece on the shelf.</p>' +
        '<div class="gc-list">' + others.slice(0, 20).map((e) =>
          '<button data-cmp="' + esc(e.id) + '"><b>' + esc(e.title) + "</b><span>" +
          esc(e.text.trim().split(/\s+/).length + " words" +
            (e.stat ? " \u00b7 " + e.stat.found + "/" + e.stat.total + " found" : "")) +
          "</span></button>").join("") + "</div>";
      host.querySelectorAll("[data-cmp]").forEach((b) =>
        b.addEventListener("click", () => { draftAgainst = b.getAttribute("data-cmp"); paintDrafts(); })
      );
      return;
    }

    /* Sentence level, because that is the unit a teacher talks in. Trimmed and
       lowercased for the comparison only; what is shown is the real line. */
    const key = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
    const mine = Signals.sentences(state.work.text);
    const theirs = Signals.sentences(against.text);
    const theirKeys = new Set(theirs.map(key));
    const myKeys = new Set(mine.map(key));
    const added = mine.filter((s) => !theirKeys.has(key(s)));
    const gone = theirs.filter((s) => !myKeys.has(key(s)));

    let moved = "";
    if (against.bands && state.result) {
      const rows = state.result.criteria.map((c) => {
        const was = against.bands[c.name];
        if (!was || was === c.status) return null;
        const order = ["missing", "partial", "evidenced"];
        const better = order.indexOf(c.status) > order.indexOf(was);
        return '<div class="cmp-band ' + (better ? "up" : "down") + '">' +
          "<b>" + esc(c.name) + "</b><span>" + esc(BAND_WORD[was] || was) + " \u2192 " +
          esc(BAND_WORD[c.status] || c.status) + "</span></div>";
      }).filter(Boolean);
      moved = '<p class="cov-label" role="heading" aria-level="3">What moved</p>' +
        (rows.length ? rows.join("") : '<p class="ins-note">Every item landed in the same band as before.</p>');
    }

    host.innerHTML =
      '<div class="drafts-top"><span>Against <b>' + esc(against.title) + "</b></span>" +
        '<button class="link-quiet" data-cmp-back>Change</button></div>' +
      '<div class="cov-tiles">' +
        '<div class="cov-tile"><b>' + added.length + "</b><span>new sentences</span></div>" +
        '<div class="cov-tile"><b>' + gone.length + "</b><span>gone since</span></div>" +
      "</div>" + moved +
      (added.length ? '<p class="cov-label" role="heading" aria-level="3">Added</p>' + added.slice(0, 6).map((s) =>
        '<div class="ins-quote add"><p>' + esc(s) + "</p></div>").join("") : "") +
      (gone.length ? '<p class="cov-label" role="heading" aria-level="3">Removed</p>' + gone.slice(0, 6).map((s) =>
        '<div class="ins-quote cut"><p>' + esc(s) + "</p></div>").join("") : "");

    const back = host.querySelector("[data-cmp-back]");
    if (back) back.addEventListener("click", () => { draftAgainst = null; paintDrafts(); });
  }

  /* -------------------------------- the palette ------------------------------ */

  /*
   * Vapi and Juicebox both build this the same way and both are right about
   * why: the rows are GROUPED under small caps headings, the label carries a
   * dim descriptor after it, and a hint bar runs along the bottom. The hint bar
   * is the part that makes it read as a tool rather than a search box - it
   * tells you the thing is driven by the keyboard before you try.
   *
   * It also searches the essay, which is the half that earns its place: on a
   * 900-word piece, "where does he say lockdown" is a real question and
   * Ctrl+F does not know about the marks.
   */
  let palOpen = false;
  let palShelf = [];
  let palRows = [];
  let palAt = 0;
  let palReturn = null;

  function palCommands() {
    const rows = [];
    const has = !!state.result;

    rows.push(
      { g: "Do", icon: "i-play", label: "Read it", dim: ready() ? null : "needs a checklist and an essay", key: MODKEY + "\u21B5", run: runRead },
      { g: "Do", icon: "i-play", label: "Try an example", dim: "watch it type itself in", run: () => startAction("example") },
      { g: "Do", icon: "i-plus", label: "Add something to look for", run: () => { showRail(); addCriterion(); } },
      { g: "Do", icon: "i-plus", label: "Paste a whole rubric", run: () => startAction("paste") },
      { g: "Do", icon: "i-file", label: "Open a .txt file", run: () => startAction("file") },
      { g: "Do", icon: "i-trash", label: "Start a blank page", run: clearAll }
    );

    rows.push(
      { g: "View", icon: "i-pencil", label: "Write", dim: "edit the essay", run: () => setMode("write") },
      { g: "View", icon: "i-highlight", label: "Marked", dim: has ? "one item at a time" : "read it first", run: () => setMode("read"), off: !has },
      { g: "View", icon: "i-layers", label: "All", dim: has ? "every item at once, one colour each" : "read it first", run: () => setMode("all"), off: !has },
      { g: "View", icon: "i-file", label: "Feedback", dim: "the sheet that goes back", run: () => setTab("feedback") },
      { g: "Look closer", icon: "i-search", label: "Signals", dim: "how it reads, and how it was written", tool: "signals", run: () => setTab("signals") },
      { g: "Look closer", icon: "i-layers", label: "Class", dim: "what the whole set missed", tool: "class", run: () => setTab("class") },
      { g: "Look closer", icon: "i-copy", label: "Drafts", dim: "against another draft", tool: "drafts", run: () => setTab("drafts") },
      { g: "Look closer", icon: "i-panel",
        label: Session.role() === "student" ? "Switch to teacher" : "Switch to student",
        dim: "changes which tools you get",
        run: () => setRole(Session.role() === "student" ? "teacher" : "student") },
      { g: "View", icon: "i-panel", label: "Show or hide the checklist", run: toggleRail },
      { g: "View", icon: "i-moon", label: "Switch theme", run: () => { const b = document.querySelector("[data-theme-toggle]"); if (b) b.click(); } }
    );

    palShelf.slice(0, 8).forEach((e) => {
      if (e.id === state.entryId) return;
      rows.push({
        g: "Saved essays", icon: "i-file", label: e.title,
        dim: e.stat ? e.stat.found + "/" + e.stat.total + " found" : "not read yet",
        run: () => openEntry(e.id),
      });
    });
    rows.push({ g: "Saved essays", icon: "i-plus", label: "New essay, same checklist", run: newEntry });
    if (Classroom.configured()) {
      rows.push({ g: "Saved essays", icon: "i-file", label: "Import from Google Classroom", run: openClassroom });
    }

    if (has) {
      state.result.criteria.forEach((c) => {
        rows.push({
          g: "Your checklist", icon: "i-check",
          label: c.name, dim: LABEL[c.status] + (c.flagged ? " \u00b7 worth a second look" : ""),
          run: () => { state.selected = c.id; setMode("read"); setTab("evidence"); render(); const e = c.evidence[0]; if (e) jumpTo(e.start); },
        });
      });
    }

    ["What is missing?", "What is contested?", "Show me the evidence", "Which paragraph is doing the least work?"]
      .forEach((q) => rows.push({ g: "Ask", icon: "i-spark", label: q, run: () => submitAsk(q) }));
    rows.push({ g: "Ask", icon: "i-spark", label: "Ask something else", dim: MODKEY + "/", run: () => {
      setTab("ask");
      const input = document.getElementById("ask-input");
      if (input) input.focus();
    } });

    rows.push(
      { g: "Settings", icon: "i-cpu", label: "Second reader settings", run: openSettings },
      { g: "Settings", icon: "i-lock", label: Session.current() ? "Account" : "Sign in", run: () => { if (global.AccountPanel) AccountPanel.open(); } }
    );
    return palTools(rows);
  }

  /* Occurrences of the query in the essay itself, shown with enough either side
     to recognise which one you meant. */
  function palFind(q) {
    const text = state.work.text;
    if (q.length < 3 || !text) return [];
    const hay = text.toLowerCase();
    const needle = q.toLowerCase();
    const out = [];
    let at = hay.indexOf(needle);
    while (at !== -1 && out.length < 6) {
      const from = Math.max(0, at - 32);
      const snippet = (from > 0 ? "\u2026" : "") + text.slice(from, at + needle.length + 40).replace(/\s+/g, " ").trim() + "\u2026";
      out.push({ g: "In the essay", icon: "i-search", label: snippet, at: at, run: () => scrollToOffset(at) });
      at = hay.indexOf(needle, at + needle.length);
    }
    return out;
  }

  function palFilter(q) {
    const all = palCommands();
    const term = q.trim().toLowerCase();
    if (!term) return all;
    const scored = all
      .filter((r) => (r.label + " " + r.g + " " + (r.dim || "")).toLowerCase().indexOf(term) !== -1)
      /* a label match beats a match buried in the group or the descriptor */
      .sort((x, y) => x.label.toLowerCase().indexOf(term) - y.label.toLowerCase().indexOf(term));
    return palFind(q.trim()).concat(scored);
  }

  function palPaint() {
    const list = document.getElementById("palette-list");
    const count = document.getElementById("palette-count");
    if (!list) return;

    if (!palRows.length) {
      list.innerHTML = '<p class="palette-empty">Nothing matches that.</p>';
      if (count) count.textContent = "";
      return;
    }

    let group = null;
    list.innerHTML = palRows.map((r, i) => {
      let head = "";
      if (r.g !== group) { group = r.g; head = '<p class="palette-group">' + esc(r.g) + "</p>"; }
      return head +
        '<div class="palette-item' + (i === palAt ? " on" : "") + '" role="option" id="pal-' + i +
          '" aria-selected="' + (i === palAt) + '" data-i="' + i + '"' + (r.off ? ' data-off="1"' : "") + ">" +
          '<svg aria-hidden="true"><use href="#' + r.icon + '"/></svg>' +
          "<span>" + esc(r.label) + "</span>" +
          (r.dim ? ' <span class="p-dim">' + esc(r.dim) + "</span>" : "") +
          (r.key ? '<span class="p-key">' + esc(r.key) + "</span>" : "") +
        "</div>";
    }).join("");

    if (count) count.textContent = palRows.length + " result" + (palRows.length === 1 ? "" : "s");

    const input = document.getElementById("palette-input");
    if (input) input.setAttribute("aria-activedescendant", "pal-" + palAt);
    const on = list.querySelector(".palette-item.on");
    if (on) on.scrollIntoView({ block: "nearest" });

    list.querySelectorAll("[data-i]").forEach((n) => {
      n.addEventListener("mousemove", () => { palAt = Number(n.getAttribute("data-i")); palPaint(); });
      n.addEventListener("click", () => palRun());
    });
  }

  function palRun() {
    const row = palRows[palAt];
    if (!row) return;
    closePalette();
    /* run after the overlay has gone, so anything that moves focus lands on a
       page that is actually there */
    setTimeout(() => row.run(), 0);
  }

  function openPalette() {
    if (palOpen) return;
    palOpen = true;
    palReturn = document.activeElement;
    /* Read once. palFilter runs per keystroke and this is a JSON.parse of up
       to the whole storage budget. */
    palShelf = Shelf.list();
    const back = document.getElementById("palette");
    const input = document.getElementById("palette-input");
    back.hidden = false;
    input.value = "";
    palRows = palFilter("");
    palAt = 0;
    palPaint();
    input.focus();
  }

  function closePalette() {
    if (!palOpen) return;
    palOpen = false;
    document.getElementById("palette").hidden = true;
    if (palReturn && palReturn.focus) palReturn.focus();
    palReturn = null;
  }

  function wirePalette() {
    const back = document.getElementById("palette");
    const input = document.getElementById("palette-input");
    if (!back || !input) return;

    document.getElementById("btn-palette").addEventListener("click", openPalette);
    back.addEventListener("mousedown", (e) => { if (e.target === back) closePalette(); });

    input.addEventListener("input", () => {
      palRows = palFilter(input.value);
      palAt = 0;
      palPaint();
    });

    /* Focus never leaves the input - the list is a combobox popup, not a set of
       tab stops, which is also why the rows are options rather than buttons. */
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (!palRows.length) return;
        palAt = (palAt + (e.key === "ArrowDown" ? 1 : palRows.length - 1)) % palRows.length;
        palPaint();
      } else if (e.key === "Enter") {
        e.preventDefault();
        palRun();
      } else if (e.key === "Escape") {
        e.preventDefault();
        /* Otherwise the same keypress reaches the dock's listener and collapses
           a conversation the person was reading. */
        e.stopPropagation();
        closePalette();
      } else if (e.key === "Tab") {
        e.preventDefault();
      }
    });
  }

  function clearAll() {
    resetDocument();
    state.entryId = null;
    state.rubric = blankRubric();
    state.work = blankWork();
    paintRail(); paintAsk(); render(); askSync();
    const d = document.getElementById("doc");
    if (d) d.focus();
  }

  /* Nothing is marked in write mode, so there is no element to scroll to. The
     essay is one column of even text, so its offset maps closely enough to its
     height for "take me roughly there" to be true. */
  function scrollToOffset(off) {
    const scroll = document.getElementById("doc-scroll");
    if (!scroll) return;
    const ratio = off / (state.work.text.length || 1);
    const smooth = !global.matchMedia || !global.matchMedia("(prefers-reduced-motion: reduce)").matches;
    scroll.scrollTo({ top: Math.max(0, ratio * scroll.scrollHeight - scroll.clientHeight * 0.35),
                      behavior: smooth ? "smooth" : "auto" });
  }

  /* ---------------------------------- wiring -------------------------------- */

  function wireDoc() {
    const doc = document.getElementById("doc");
    const title = document.getElementById("doc-title");

    title.addEventListener("input", () => {
      state.work.title = title.value;
      paintShelfBadge();
    });

    doc.addEventListener("input", () => {
      if (state.mode !== "write") return;
      state.work.text = readDoc(doc);
      markStale();
      paintCounts();
      paintStart();
      clearTimeout(docTimer);
      docTimer = setTimeout(() => { paintReadButton(); if (!state.result) paintFindings(); }, 180);
      clearTimeout(saveTimer);
      saveTimer = setTimeout(autoSave, 2500);
    });

    /* Word and Google Docs both put HTML on the clipboard. Letting it in would
       mean the offsets the engine returns point into markup rather than into
       the essay, so it is flattened on the way in. */
    doc.addEventListener("paste", (e) => {
      if (state.mode !== "write") return;
      e.preventDefault();
      const cd = e.clipboardData || global.clipboardData;
      const text = cd ? cd.getData("text/plain") : "";
      if (!text) return;
      if (document.execCommand) document.execCommand("insertText", false, text);
      else doc.textContent = readDoc(doc) + text;
      doc.dispatchEvent(new Event("input"));
    });

    /* Grammarly: click a highlight and the card behind it opens. */
    doc.addEventListener("click", (e) => {
      const mark = e.target.closest && e.target.closest("mark[data-crit]");
      if (!mark || state.mode !== "read") return;
      const id = mark.getAttribute("data-crit");
      if (!id) return;
      state.selected = id;
      setTab("evidence");
      paintFindings();
      paintRailStatus();
      const card = document.querySelector('#findings [data-crit="' + cssEscape(id) + '"]');
      if (card) card.scrollIntoView({ block: "nearest" });
    });

    document.getElementById("doc-modes").addEventListener("click", (e) => {
      const b = e.target.closest("[data-mode]");
      if (!b || b.disabled) return;
      setMode(b.getAttribute("data-mode"));
      if (state.mode === "write") document.getElementById("doc").focus();
    });

    const file = document.getElementById("file-input");
    file.addEventListener("change", () => {
      const f = file.files && file.files[0];
      file.value = "";
      if (!f) return;
      if (f.size > 400000) return toast("That file is too big for one essay.");
      const reader = new FileReader();
      reader.onload = () => {
        state.work.text = String(reader.result || "").replace(/\r\n?/g, "\n");
        if (!state.work.title) state.work.title = f.name.replace(/\.[^.]+$/, "");
        state.result = null; state.selected = null; state.stale = false; state.mode = "write";
        render();
        toast("Opened " + f.name + ".");
      };
      reader.onerror = () => toast("That file would not open.");
      reader.readAsText(f);
    });
  }

  function wireRail() {
    document.getElementById("crit-add").addEventListener("click", () => addCriterion());
    document.getElementById("btn-rail").addEventListener("click", toggleRail);
    const shelfBtn = document.getElementById("btn-shelf");
    if (shelfBtn) shelfBtn.addEventListener("click", (e) => { e.stopPropagation(); openShelf(shelfBtn); });
    document.getElementById("btn-paste").addEventListener("click", openPaste);
  }

  function wireTabs() {
    const strip = document.querySelector(".side-tabs");
    if (!strip) return;
    strip.addEventListener("click", (e) => {
      const b = e.target.closest("[data-tab]");
      if (!b) return;
      setTab(b.getAttribute("data-tab"));
      if (b.getAttribute("data-tab") === "ask") {
        const i = document.getElementById("ask-input");
        if (i) i.focus();
      }
    });
    /* A tablist that does not answer the arrow keys is a tablist in name. */
    strip.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      /* :not([hidden]) is load-bearing. paintTabs hides the tabs this role does
         not get, and walking them anyway meant a student pressing Right from
         Signals landed on the hidden Class tab, got bounced to Evidence by
         setTab's fallback, and lost focus entirely. */
      const tabs = Array.prototype.slice.call(strip.querySelectorAll("[data-tab]:not([hidden])"));
      if (!tabs.length) return;
      const i = tabs.findIndex((t) => t.getAttribute("data-tab") === state.tab);
      const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
      setTab(next.getAttribute("data-tab"));
      /* Focus what setTab actually landed on, which is not always `next`. */
      const landed = strip.querySelector('[data-tab="' + state.tab + '"]');
      (landed || next).focus();
    });
  }

  /* Everything that is not the work itself lives behind one button, so the bar
     stays short enough to read. */
  /*
   * Grouped, and every row carries its icon.
   *
   * It was six flat rows and about to become nine, which is the point at which
   * a menu stops being a list of things you can do and becomes a wall you have
   * to read. Account and the reader settings were also two doors into the same
   * five-tab panel, so they are one row now.
   */
  /* palCommands rows carry a `tool` field for exactly this. Without the filter
     a student is still offered "Class - what the whole set missed", and with
     setTab's new fallback it no longer errors: it silently does nothing, which
     is the worse of the two failures. */
  function palTools(rows) {
    return rows.filter((r) => !r.tool || toolAllowed(r.tool));
  }

  function moreItems() {
    const student = Session.role() === "student";
    return [
      /* The one control that decides which half of the app you get. It used to
         live only in the Account dialog, behind making a profile with a PIN. */
      { g: "You are", label: student ? "A student" : "A teacher", key: "role", icon: "i-panel",
        hint: student ? "switch to teacher" : "switch to student" },
      { g: "This essay", label: "Saved essays", key: "shelf", icon: "i-file" },
      { g: "This essay", label: "Signals", key: "signals", icon: "i-search",
        hint: "how it reads, how it was written" },
      { g: "This essay", label: "Drafts", key: "drafts", icon: "i-copy",
        hint: student ? "against your last draft" : "against another draft" },
      { g: "Your set", label: "Class", key: "class", icon: "i-layers",
        hint: "what the whole set missed" },
      { g: "", label: "Open a .txt file", key: "file", icon: "i-file" },
      { g: "", label: "Start a blank page", key: "clear", icon: "i-trash" },
      { g: "", label: "Search and commands", key: "palette", icon: "i-search", kbd: MODKEY + "K" },
      { g: "", label: Session.current() ? "Settings and account" : "Sign in", key: "settings", icon: "i-cpu" },
    ].filter((m) => !TOOLS.some((t) => t.id === m.key) || toolAllowed(m.key));
  }

  function closeMore(keepFocus) {
    const sheet = document.querySelector(".more-sheet");
    if (!sheet) return;
    const held = sheet.contains(document.activeElement);
    sheet.remove();
    const btn = document.getElementById("btn-more");
    if (btn) {
      btn.setAttribute("aria-expanded", "false");
      if (!keepFocus && held) btn.focus();
    }
  }

  function openMore(btn) {
    if (document.querySelector(".more-sheet")) return closeMore();
    const sheet = document.createElement("div");
    sheet.className = "more-sheet";
    let group = null;
    sheet.innerHTML = moreItems().map((m) => {
      let head = "";
      if (m.g !== group) {
        group = m.g;
        head = m.g ? '<p class="more-group" role="heading" aria-level="3">' + esc(m.g) + "</p>" : '<hr class="more-rule">';
      }
      return head +
        '<button data-do="' + m.key + '">' +
          '<svg aria-hidden="true"><use href="#' + m.icon + '"/></svg>' +
          "<span>" + esc(m.label) + "</span>" +
          (m.hint ? '<span class="more-hint">' + esc(m.hint) + "</span>" : "") +
          (m.kbd ? '<kbd>' + esc(m.kbd) + "</kbd>" : "") +
        "</button>";
    }).join("");
    sheet.addEventListener("click", (e) => {
      const b = e.target.closest("[data-do]");
      if (!b) return;
      const what = b.getAttribute("data-do");
      /* Put focus on the menu button BEFORE the sheet goes, so a dialog opened
         from here records it as its opener and closing the dialog returns the
         user to where they came from. closeMore's own restore only fires when
         focus happened to be inside the sheet, which is not true of every way
         a row can be activated. */
      const more = document.getElementById("btn-more");
      if (more) more.focus();
      closeMore(true);
      if (what === "shelf") { showRail(); return openShelf(document.getElementById("btn-shelf")); }
      if (what === "palette") return openPalette();
      if (what === "role") return setRole(Session.role() === "student" ? "teacher" : "student");
      if (what === "signals") return setTab("signals");
      if (what === "class") return setTab("class");
      if (what === "drafts") return setTab("drafts");
      if (what === "settings") {
        return Session.current() ? AccountPanel.open("reading") : global.Router.go("login");
      }
      if (what === "file") return startAction("file");
      if (what === "clear") { autoSave(); return clearAll(); }
      /* "account" falls through to the delegated handler in main.js */
    });
    btn.parentNode.appendChild(sheet);
    btn.setAttribute("aria-expanded", "true");
  }

  function wireBar() {
    document.getElementById("btn-read").addEventListener("click", () => {
      if (demoRunning) stopDemo();
      runRead();
    });
    document.getElementById("btn-demo").addEventListener("click", () => (demoRunning ? stopDemo() : runDemo()));
    const pill = document.getElementById("reader-pill");
    if (pill) pill.addEventListener("click", () => openSettings());

    const more = document.getElementById("btn-more");
    more.addEventListener("click", (e) => { e.stopPropagation(); openMore(more); });
    document.addEventListener("click", (e) => {
      if (!e.target.closest(".menu-wrap")) { closeMore(); closeShelf(); }
      else if (!e.target.closest(".shelf-sheet") && !e.target.closest("#btn-shelf")) closeShelf();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { closeMore(); closeShelf(); }
      const cmd = e.metaKey || e.ctrlKey;
      /* A dialog owns Enter. The palette does not own its own shortcut,
         though: gating K on "is a dialog open" made the toggle unreachable the
         moment the palette itself was the thing that was open. */
      const layer = document.getElementById("layer");
      const inModal = !!(layer && layer.querySelector(".modal-back"));
      if (cmd && (inModal || (palOpen && e.key === "Enter"))) return;
      /* Cmd/Ctrl+Enter reads it, from anywhere including inside the essay. */
      if (cmd && e.key === "Enter") { e.preventDefault(); return runRead(); }
      if (cmd && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        return palOpen ? closePalette() : openPalette();
      }
    });
  }

  /* ---------------------------------- mount --------------------------------- */

  function mount() {
    if (!mounted) {
      mounted = true;
      /* Blank by default. The hero preview passes ?example=1 because a preview
         of an empty box tells a visitor nothing about the product. */
      if (/[?&]example=1/.test(location.search)) loadExample();

      /* Between a tablet and a laptop there is room for the essay and the
         findings but not comfortably for all three, so the checklist starts
         folded and one press brings it back. Below 900 the layout stacks and
         nothing needs folding at all. */
      const w = global.innerWidth || 1400;
      if (w <= 1080 && w > 900) toggleRail();

      /* Two frames, not one: a mutation callback runs as a microtask, before
         the browser has recalculated style, so measuring there measures the
         old metrics and comes out one line short. */
      const regrow = () => requestAnimationFrame(() =>
        requestAnimationFrame(() => document.querySelectorAll(".crit-desc").forEach(grow)));
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(regrow);
      /* The dark theme eases the tracking out, which is enough to push a
         descriptor onto one more line. Nothing else re-measures these, so a
         theme switch left the last line clipped. */
      if (global.MutationObserver) {
        new MutationObserver(regrow).observe(document.documentElement, {
          attributes: true, attributeFilter: ["data-theme"],
        });
      }
      let resizeTimer = null;
      global.addEventListener("resize", () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
          regrow();
          const ta = document.getElementById("fb-text");
          if (ta) fbFit(ta);
        }, 120);
      });

      wireDoc();
      wireRail();
      wireTabs();
      wireAsk();
      wireFeedback();
      wireBar();
      wirePalette();

      /* the minimap thumb follows the page */
      const scroll = document.getElementById("doc-scroll");
      if (scroll) scroll.addEventListener("scroll", paintCovView, { passive: true });

      /* pagehide fires on a real close and on a back-navigation; visibilitychange
         covers switching tabs and, on a phone, the app going to the background,
         which is where beforeunload is not reliably delivered at all.
         localStorage is synchronous, so a write in these handlers completes. */
      global.addEventListener("pagehide", autoSave);
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") autoSave();
      });

      paintRail();
      paintShelfBadge();
      if (docText()) runRead(); else render();
      warmDevice();
    } else {
      render();
    }
  }

  global.AppView = { mount: mount };
})(window);
