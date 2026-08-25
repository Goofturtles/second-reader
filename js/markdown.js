/*
 * Markdown and LaTeX, rendered here.
 *
 * Why this is written rather than pulled in: the whole app is one folder of
 * classic scripts that a judge can open off a memory stick with no network. A
 * CDN tag for marked and KaTeX would be 300KB of someone else's code and a
 * blank page the moment the wifi drops in the room. What the feedback sheet
 * actually needs is a small, well-defined subset, and that fits in a file.
 *
 * SECURITY. The order below is load-bearing and must not be rearranged:
 *
 *   1. split the source into MATH and TEXT runs
 *   2. escape every leaf string in both, before anything is rendered
 *   3. build HTML from the escaped pieces
 *
 * Nothing untrusted is ever concatenated into markup unescaped, so a teacher
 * pasting a student's paragraph into the sheet - or a Classroom import
 * carrying a hostile file name - cannot produce an element. There is no raw
 * HTML passthrough in this dialect, deliberately: Markdown proper allows inline
 * HTML, and allowing it here would hand the whole property away.
 */

(function (global) {
  "use strict";

  /* No &#39; on purpose: every attribute this file emits is a static
     double-quoted class name, so an apostrophe cannot escape one. If
     anything here ever grows an attribute built from input, fix this
     first. */
  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /* ------------------------------------------------------------------ math */

  /* The symbols a teacher actually reaches for when marking a piece of writing
     that has numbers in it. Not a complete TeX table, and not pretending to be. */
  const SYMBOL = {
    alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε",
    theta: "θ", lambda: "λ", mu: "μ", pi: "π", rho: "ρ",
    sigma: "σ", tau: "τ", phi: "φ", omega: "ω",
    Delta: "Δ", Sigma: "Σ", Omega: "Ω", Phi: "Φ",
    times: "×", div: "÷", cdot: "·", pm: "±", mp: "∓",
    leq: "≤", le: "≤", geq: "≥", ge: "≥", neq: "≠", ne: "≠",
    approx: "≈", equiv: "≡", propto: "∝", sim: "∼",
    to: "→", rightarrow: "→", leftarrow: "←", Rightarrow: "⇒",
    infty: "∞", partial: "∂", nabla: "∇", degree: "°",
    sum: "∑", prod: "∏", int: "∫", sqrtsym: "√",
    in: "∈", notin: "∉", subset: "⊂", cup: "∪", cap: "∩",
    forall: "∀", exists: "∃", therefore: "∴", because: "∵",
    ldots: "…", cdots: "⋯", percent: "%", ",": " ", ";": " ", " ": " ",
  };

  /* Reads one balanced {...} starting at i (which must be the brace), or a
     single token if there is no brace - which is how TeX itself scopes x^2. */
  /* Sticky, so scanning never slices the remainder of the string. On a
     50,000-command formula the old src.slice(i) copied gigabytes. */
  /* Letters are a command name; the punctuation class is TeX's way of
     writing the character itself - \% is a percent sign, \_ an underscore.
     Without that branch \_ fell through and the underscore was read as a
     subscript, so $\_\_proto\_\_$ came out as nested empty <sub>s. */
  const CMD = /\\([a-zA-Z]+|[,;\s]|[%$&#_{}~^\\])/y;
  const CMDNAME = /\\[a-zA-Z]+/y;

  function group(src, i) {
    if (src[i] !== "{") {
      if (src[i] === "\\") {
        CMDNAME.lastIndex = i;
        const m = CMDNAME.exec(src);
        if (m) return { body: m[0], next: CMDNAME.lastIndex };
      }
      return { body: src[i] || "", next: i + 1 };
    }
    /* Start inside the brace at depth 1 and step over any escaped
       character, so \{ neither opens nor closes a group and an
       unbalanced paste cannot make the scan run to the end. */
    let depth = 1;
    for (let j = i + 1; j < src.length; j++) {
      const ch = src[j];
      if (ch === "\\") { j++; continue; }
      if (ch === "{") depth++;
      else if (ch === "}" && !--depth) return { body: src.slice(i + 1, j), next: j + 1 };
    }
    return { body: src.slice(i + 1), next: src.length };
  }

  /* Deep enough for any formula a person writes, shallow enough that a
     paste of twenty thousand open braces returns text instead of a
     RangeError that would take the whole panel down. */
  const MAX_DEPTH = 40;

  /*
   * flat: the same maths, drawn with only what survives a copy-paste.
   *
   * None of this page's CSS travels with the clipboard, and a fraction here is
   * a flex column with a rule between its halves - so Google Docs received
   * \frac{1}{2} as the number "12". Flat writes it with a real fraction slash,
   * which is still correct after every style has been stripped off it.
   */
  function math(src, depth, flat) {
    depth = depth || 0;
    if (depth > MAX_DEPTH) return esc(src);
    let out = "";
    let i = 0;

    while (i < src.length) {
      const ch = src[i];

      if (ch === "\\") {
        CMD.lastIndex = i;
        const m = CMD.exec(src);
        if (!m) { out += esc(ch); i++; continue; }
        const name = m[1];
        i = CMD.lastIndex;

        if (name === "frac" || name === "tfrac" || name === "dfrac") {
          const a = group(src, i); const b = group(src, a.next);
          i = b.next;
          out += flat
            ? "<sup>" + math(a.body, depth + 1, flat) + "</sup>&#8260;<sub>" +
              math(b.body, depth + 1, flat) + "</sub>"
            : '<span class="mfrac"><span class="mnum">' + math(a.body, depth + 1) +
              '</span><span class="mden">' + math(b.body, depth + 1) + "</span></span>";
        } else if (name === "sqrt") {
          const a = group(src, i);
          i = a.next;
          out += flat
            ? "√(" + math(a.body, depth + 1, flat) + ")"
            : '<span class="msqrt"><span class="mrad">√</span>' +
              '<span class="mroot">' + math(a.body, depth + 1) + "</span></span>";
        } else if (name === "text" || name === "mathrm" || name === "operatorname") {
          const a = group(src, i);
          i = a.next;
          out += flat ? esc(a.body) : '<span class="mtext">' + esc(a.body) + "</span>";
        } else if (name === "left" || name === "right") {
          /* size-aware delimiters are more than this needs; the glyph is enough */
          continue;
        } else if (!/^[a-zA-Z]/.test(name)) {
          /* an escaped literal: print it, do not interpret it */
          out += esc(name);
          continue;
        } else if (Object.prototype.hasOwnProperty.call(SYMBOL, name)) {
          out += flat ? esc(SYMBOL[name]) : '<span class="mop">' + esc(SYMBOL[name]) + "</span>";
        } else {
          out += flat ? esc(name) : '<span class="mtext">' + esc(name) + "</span>";
        }
        continue;
      }

      if (ch === "^" || ch === "_") {
        const a = group(src, i + 1);
        i = a.next;
        out += (ch === "^" ? "<sup>" : "<sub>") + math(a.body, depth + 1, flat) + (ch === "^" ? "</sup>" : "</sub>");
        continue;
      }

      if (ch === "{" ) { const a = group(src, i); i = a.next; out += math(a.body, depth + 1, flat); continue; }
      if (ch === "}") { i++; continue; }

      /* A letter on its own is a variable and is set in italic; digits and
         punctuation stay upright. That single rule is most of what makes
         rendered maths read as maths. */
      if (/[a-zA-Z]/.test(ch)) { out += flat ? "<em>" + esc(ch) + "</em>" : '<span class="mvar">' + esc(ch) + "</span>"; i++; continue; }
      if (/[+\-=<>]/.test(ch)) { out += flat ? esc(ch) : '<span class="mop">' + esc(ch) + "</span>"; i++; continue; }

      out += esc(ch);
      i++;
    }
    return out;
  }

  /* --------------------------------------------------------------- inline */

  function inline(s) {
    return s
      .replace(/`([^`]+)`/g, (_, c) => "<code>" + c + "</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[\s(])\*([^*\n]+)\*/g, "$1<em>$2</em>")
      .replace(/(^|[\s(])_([^_\n]+)_/g, "$1<em>$2</em>")
      .replace(/ {2,}$/gm, "<br>");
  }

  /* ---------------------------------------------------------------- blocks */

  /* Requires an actual ---|--- rule. The looser pattern this replaces had
     two adjacent whitespace-matching quantifiers, so a long line of spaces
     took quadratic time to FAIL and hung the tab. */
  const SEPARATOR = /^\s*\|?(?:\s*:?-+:?\s*\|)+\s*:?-*:?\s*$/;
  const BLOCK_ONLY = /^\uE002\d+\uE003$/;

  function blocks(src) {
    const lines = src.split("\n");
    let out = "";
    let i = 0;

    const para = [];
    const flush = () => {
      if (!para.length) return;
      out += "<p>" + inline(para.join("\n")) + "</p>";
      para.length = 0;
    };

    while (i < lines.length) {
      const line = lines[i];

      if (!line.trim()) { flush(); i++; continue; }

      const h = /^(#{1,4})\s+(.*)$/.exec(line);
      if (h) {
        flush();
        const level = h[1].length + 1; // the panel already owns the document h1
        out += "<h" + level + ">" + inline(h[2]) + "</h" + level + ">";
        i++;
        continue;
      }

      if (/^(---+|\*\*\*+)\s*$/.test(line)) { flush(); out += "<hr>"; i++; continue; }

      if (BLOCK_ONLY.test(line.trim())) { flush(); out += line.trim(); i++; continue; }

      if (/^&gt;\s?/.test(line)) {
        flush();
        const quote = [];
        while (i < lines.length && /^&gt;\s?/.test(lines[i])) { quote.push(lines[i].replace(/^&gt;\s?/, "")); i++; }
        out += "<blockquote>" + inline(quote.join("\n")) + "</blockquote>";
        continue;
      }

      /* A table needs its separator row to be a table at all, which is also
         what stops a line of pipes in an essay quote becoming one. */
      /* Two cheap guards before the regex runs at all: a separator always
         contains a dash, and is never longer than a line of dashes and pipes.
         Without them a pasted line of 100,000 spaces spent seconds failing. */
      const next = i + 1 < lines.length ? lines[i + 1] : "";
      if (line.indexOf("|") !== -1 && next.indexOf("-") !== -1 && next.length < 2000 &&
          SEPARATOR.test(next)) {
        flush();
        const cells = (row) => row.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim());
        const head = cells(line);
        i += 2;
        let body = "";
        while (i < lines.length && lines[i].indexOf("|") !== -1 && lines[i].trim()) {
          body += "<tr>" + cells(lines[i]).map((c) => "<td>" + inline(c) + "</td>").join("") + "</tr>";
          i++;
        }
        out += '<div class="md-table"><table><thead><tr>' +
          head.map((c) => "<th>" + inline(c) + "</th>").join("") +
          "</tr></thead><tbody>" + body + "</tbody></table></div>";
        continue;
      }

      const bullet = /^\s*([-*+]|\d+[.)])\s+/.exec(line);
      if (bullet) {
        flush();
        const ordered = /\d/.test(bullet[1]);
        let items = "";
        while (i < lines.length) {
          const m = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i]);
          if (!m || /\d/.test(m[1]) !== ordered) break;
          const parts = [m[2]];
          i++;
          /* a wrapped line under a bullet belongs to that bullet */
          while (i < lines.length && lines[i].trim() && !/^\s*([-*+]|\d+[.)])\s+/.test(lines[i]) &&
                 !/^(#{1,4}\s|&gt;|---)/.test(lines[i])) { parts.push(lines[i].trim()); i++; }
          items += "<li>" + inline(parts.join(" ")) + "</li>";
        }
        out += (ordered ? "<ol>" : "<ul>") + items + (ordered ? "</ol>" : "</ul>");
        continue;
      }

      para.push(line);
      i++;
    }
    flush();
    return out;
  }

  /* ----------------------------------------------------------------- render */

  /* Private-use codepoints, written as escapes rather than literals: a
     placeholder made of ordinary characters could be typed by a person, and
     would then be replaced with somebody else's rendered maths. */
  /* An operator, a command, or one short token. Anything padded with
     spaces is a sentence that happened to sit between two dollar signs. */
  function looksMath(body) {
    if (!body) return false;
    if (/^\s|\s$/.test(body)) return false;
    /* "$5-$10" leaves a body of "5-": an operator, but plainly a price. */
    if (/^\d[\d,.]*[-+*/]?$/.test(body)) return false;
    if (/[\\^_{}=<>+\-*\/]/.test(body)) return true;
    return body.length <= 3 && !/\s/.test(body);
  }

  const MARK = "\uE000";
  const MARKEND = "\uE001";
  /* Display maths gets its own pair. A <div> inside a <p> is not valid and
     the parser splits it, so blocks() has to be able to recognise a line
     that is nothing but one of these and emit it on its own. */
  const BLOCK = "\uE002";
  const BLOCKEND = "\uE003";

  function render(src, opts) {
    const flat = !!(opts && opts.flat);
    const store = [];
    let text = "";
    let i = 0;
    /* strip any a user pasted in, so a placeholder cannot be forged */
    const raw = String(src == null ? "" : src).replace(/[\uE000-\uE003]/g, "");

    /* Pass one: pull the maths out BEFORE escaping or any markdown rule runs,
       so $a_1 * b$ is not eaten by the emphasis rules on its way past. */
    while (i < raw.length) {
      if (raw[i] === "$" && raw[i + 1] === "$") {
        const end = raw.indexOf("$$", i + 2);
        if (end !== -1) {
          store.push(flat
            ? "<p><b>" + math(raw.slice(i + 2, end), 0, true) + "</b></p>"
            : '<div class="mblock">' + math(raw.slice(i + 2, end)) + "</div>");
          text += BLOCK + (store.length - 1) + BLOCKEND;
          i = end + 2;
          continue;
        }
      }
      if (raw[i] === "$" && raw[i + 1] !== "$") {
        const end = raw.indexOf("$", i + 1);
        /* One line only, and it has to look like maths: two prices in a
           sentence about pocket money would otherwise turn the words
           between them into italic variables. */
        if (end !== -1 && raw.slice(i + 1, end).indexOf("\n") === -1 &&
            looksMath(raw.slice(i + 1, end))) {
          store.push(flat
            ? math(raw.slice(i + 1, end), 0, true)
            : '<span class="minline">' + math(raw.slice(i + 1, end)) + "</span>");
          text += MARK + (store.length - 1) + MARKEND;
          i = end + 1;
          continue;
        }
      }
      text += raw[i];
      i++;
    }

    /* Pass two: everything that is not maths is escaped, then parsed. */
    let html = blocks(esc(text));

    /* Pass three: the rendered maths goes back in. */
    html = html
      .replace(new RegExp(MARK + "(\\d+)" + MARKEND, "g"), (_, n) => store[Number(n)] || "")
      .replace(new RegExp(BLOCK + "(\\d+)" + BLOCKEND, "g"), (_, n) => store[Number(n)] || "");
    return html;
  }

  /** Roughly what the source says, with the syntax taken off - for the plain
      half of a rich clipboard write. */
  /**
   * Roughly what the source says with the syntax taken off - the plain half of
   * a rich clipboard write, and the only thing a browser without ClipboardItem
   * support will paste.
   */
  function plain(src) {
    return String(src == null ? "" : src)
      .replace(/^#{1,4}\s+/gm, "")
      .replace(/^\s*>\s?/gm, "")
      .replace(/^(---+|\*\*\*+)\s*$/gm, "")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/(^|[\s(])\*([^*\n]+)\*/g, "$1$2")
      .replace(/(^|[\s(])_([^_\n]+)_/g, "$1$2")
      .replace(/`([^`]+)`/g, "$1")

      /* [ \t] rather than \s: \s matches a newline, so the separator pattern
         reached across the line break and welded the header row onto the first
         body row. */
      /* The pipe is required rather than optional: two adjacent classes that
         both match a space backtrack quadratically on a long run of them. */
      .replace(/^[ \t]*\|[ \t:|-]*$/gm, "")
      .replace(/^[ \t]*\|(.*)\|[ \t]*$/gm,
        (_, row) => row.split("|").map((c) => c.trim()).filter(Boolean).join("  \u2014  "))

      /* A fraction has to survive as something a person can read, and the
         delimiters only come off a run that was actually maths - otherwise
         "$5-$10 a week" is silently reduced to "5-10 a week". */
      .replace(/\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, "($1)/($2)")
      .replace(/\\sqrt\s*\{([^{}]*)\}/g, "\u221a($1)")
      .replace(/\$\$([^$]*)\$\$/g, (m, body) => body.trim())
      .replace(/\$([^$\n]*)\$/g, (m, body) => (looksMath(body) ? body : m))

      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  global.Markdown = { render, plain, math, esc };
})(window);
