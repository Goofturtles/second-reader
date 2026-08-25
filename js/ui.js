/*
 * Shared UI helpers: theme, escaping, reveal-on-scroll, toasts, and the one
 * piece of rendering both the landing demo and the app depend on — turning a
 * plain string plus a list of character spans into marked-up, highlighted text.
 */

(function (global) {
  "use strict";

  const THEME_KEY = "sr:theme";

  /* ---------------------------------- theme --------------------------------- */

  function preferredTheme() {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved === "light" || saved === "dark") return saved;
    } catch (e) { /* ignore */ }
    return global.matchMedia && global.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    /* Kept in step with the inline bootstrap in <head>, so the browser's own
       canvas and scrollbars follow a toggle as well as a reload. */
    document.documentElement.style.colorScheme = theme;
    try { localStorage.setItem(THEME_KEY, theme); } catch (e) { /* ignore */ }
    const icon = theme === "dark" ? "#i-sun" : "#i-moon";
    document.querySelectorAll("[data-theme-icon] use").forEach((u) => u.setAttribute("href", icon));
    // the hero preview runs the app in an iframe; keep it in step
    const frame = document.getElementById("preview-frame");
    if (frame && frame.contentDocument && frame.contentDocument.documentElement) {
      frame.contentDocument.documentElement.setAttribute("data-theme", theme);
      frame.contentDocument.documentElement.style.colorScheme = theme;
    }
  }

  function toggleTheme() {
    applyTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark");
  }

  /* --------------------------------- basics --------------------------------- */

  const esc = (s) =>
    String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));

  function el(tag, attrs, html) {
    const node = document.createElement(tag);
    if (attrs) for (const k of Object.keys(attrs)) {
      if (k === "class") node.className = attrs[k];
      else if (attrs[k] != null) node.setAttribute(k, attrs[k]);
    }
    if (html != null) node.innerHTML = html;
    return node;
  }

  const TONE = { evidenced: "ok", partial: "mid", missing: "none" };
  /* Plain words. "Partly evidenced" is how a rubric talks, not how a person
     does, and the band has to be readable at a glance from across a desk. */
  const LABEL = { evidenced: "Found it", partial: "Half there", missing: "Not there" };

  function chip(status, flagged) {
    const tone = flagged ? "flag" : TONE[status] || "none";
    const text = flagged ? "Check this one" : LABEL[status] || "Unread";
    return '<span class="chip t-' + tone + '"><i class="dot"></i>' + esc(text) + "</span>";
  }

  /* ------------------------------ marked-up text ---------------------------- */

  /* Renders `text` into paragraphs, wrapping each span in <mark>. Spans are
     character offsets into the ORIGINAL string, which is why the engine keeps
     them: a highlight that is one character out is worse than no highlight. */
  function renderMarked(text, spans) {
    const clean = (spans || [])
      .filter((s) => s && s.end > s.start)
      .slice()
      .sort((a, b) => a.start - b.start);

    // drop overlaps so nesting can never happen
    const marks = [];
    for (const s of clean) {
      if (!marks.length || s.start >= marks[marks.length - 1].end) marks.push(s);
    }

    let out = "";
    let cursor = 0;
    for (const m of marks) {
      out += esc(text.slice(cursor, m.start));
      const tone = m.tone || "none";
      out +=
        '<mark class="ev ' + tone + '" data-crit="' + esc(m.crit || "") + '" data-span="' + m.start + '"' +
        /* data-n is the criterion's number, 1-based, and it is what actually
           identifies the criterion in All mode. The hue beside it is a second
           cue, not the carrier: six identity hues cannot be told apart from
           each other AND from the three verdict hues, so the numeral does the
           work. Emitted only when the criterion is still in the rubric -
           critIndex returns -1 for one that has been deleted since the read. */
        (m.c == null || m.c < 0 ? "" : ' data-c="' + (m.c % 6) + '" data-n="' + (m.c + 1) + '"') + ">" +
        esc(text.slice(m.start, m.end)) +
        "</mark>";
      cursor = m.end;
    }
    out += esc(text.slice(cursor));

    return out
      .split(/\n\s*\n/)
      .map((para) => "<p>" + para.replace(/\n/g, "<br>") + "</p>")
      .join("");
  }

  /* -------------------------------- behaviour ------------------------------- */

  let observer = null;
  function watchReveals(root) {
    if (!("IntersectionObserver" in global)) {
      $$(".reveal", root).forEach((n) => n.classList.add("in"));
      return;
    }
    if (!observer) {
      observer = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (e.isIntersecting) { e.target.classList.add("in"); observer.unobserve(e.target); }
          }
        },
        { threshold: 0.12 }
      );
    }
    $$(".reveal", root).forEach((n) => { if (!n.classList.contains("in")) observer.observe(n); });
  }

  let toastTimer = null;
  function toast(message) {
    const layer = document.getElementById("layer");
    if (!layer) return;
    const existing = layer.querySelector(".toast");
    if (existing) existing.remove();
    const node = el("div", { class: "toast", role: "status", "aria-live": "polite" });
    layer.appendChild(node);
    // inserted empty, filled on the next frame, so the live region announces
    requestAnimationFrame(() => { node.textContent = message; });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => node.remove(), 2600);
  }

  const FOCUSABLE = 'a[href], button:not([disabled]), input, textarea, select, [tabindex]:not([tabindex="-1"])';

  /* A dialog that does not trap focus is a dialog a keyboard user tabs straight
     out of, into a page they cannot see. It also has to hand focus back where
     it came from, and name itself from its own heading. */
  function modal(html, onMount) {
    const layer = document.getElementById("layer");
    const opener = document.activeElement;
    const back = el("div", { class: "modal-back" });
    const titleId = "modal-title-" + Math.floor(performance.now());
    back.innerHTML =
      '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="' + titleId + '" tabindex="-1">' + html + "</div>";

    const box = back.querySelector(".modal");
    const heading = box.querySelector("h2");
    if (heading) heading.id = titleId;
    else box.setAttribute("aria-label", "Dialog");

    const close = () => {
      back.remove();
      document.removeEventListener("keydown", onKey, true);
      if (opener && opener.focus) opener.focus();
    };

    const onKey = (e) => {
      /* The dock listens for Escape too; without this the same keypress closes
         the dialog AND collapses a conversation behind it. */
      if (e.key === "Escape") { e.stopPropagation(); return close(); }
      if (e.key !== "Tab") return;
      const items = $$(FOCUSABLE, box).filter((n) => n.offsetParent !== null);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };

    back.addEventListener("mousedown", (e) => { if (e.target === back) close(); });
    document.addEventListener("keydown", onKey, true);
    layer.appendChild(back);
    if (onMount) onMount(box, close);
    const focusable = box.querySelector(FOCUSABLE) || box;
    focusable.focus();
    return close;
  }

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      // clipboard API needs a secure context; fall back to a selectable box
      const ta = el("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;top:-1000px";
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand("copy"); } catch (err) { ok = false; }
      ta.remove();
      return ok;
    }
  }

  global.UI = {
    preferredTheme, applyTheme, toggleTheme,
    esc, $, $$, el, chip, TONE, LABEL,
    renderMarked, watchReveals, toast, modal, copy,
  };
})(window);
