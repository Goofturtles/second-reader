/*
 * Router and boot. Three views on one page, addressed by hash so the hero
 * preview can point an iframe straight at #app and so a judge can deep-link
 * to the thing itself rather than the pitch.
 */

(function (global) {
  "use strict";

  const { $$, applyTheme, preferredTheme, toggleTheme } = global.UI;

  const VIEWS = { landing: "view-landing", login: "view-login", app: "view-app" };

  function routeFromHash() {
    const hash = (location.hash || "").replace(/^#/, "");
    if (hash.indexOf("login") === 0) return "login";
    if (hash.indexOf("app") === 0) return "app";
    return "landing";
  }

  function show(view) {
    for (const name of Object.keys(VIEWS)) {
      const node = document.getElementById(VIEWS[name]);
      if (node) node.hidden = name !== view;
    }
    if (view === "landing") global.LandingView.mount();
    if (view === "login") global.AuthView.mount();
    if (view === "app") global.AppView.mount();
    paintSession();
    document.title =
      view === "app" ? "Second Reader — the reader"
      : view === "login" ? "Sign in — Second Reader"
      : "Second Reader — the marking companion that never gives a grade";
  }

  function go(view) {
    const next = view === "landing" ? "" : "#" + view;
    if (location.hash === next || (!location.hash && !next)) show(view);
    else location.hash = next;
    if (view === "landing") global.scrollTo({ top: 0, behavior: "auto" });
  }

  function paintSession() {
    const s = Session.current();
    $$("[data-signed-out]").forEach((n) => { n.hidden = !!s; });
    $$("[data-signed-in]").forEach((n) => { n.hidden = !s; });
    const hello = document.getElementById("nav-hello");
    // textContent already escapes; running esc() first prints the entities
    if (hello && s) hello.textContent = "Hi, " + Session.firstName(s);
  }

  /* The nav links collapse below 860px, so they need somewhere to go. */
  const MENU = [["How it works", "#how"], ["Private", "#private"], ["Who it\u2019s for", "#who"], ["FAQ", "#faq"]];

  function closeMenu() {
    const sheet = document.querySelector(".nav-sheet");
    if (sheet) sheet.remove();
    const btn = document.getElementById("nav-menu");
    if (btn) btn.setAttribute("aria-expanded", "false");
  }

  function toggleMenu(btn) {
    if (document.querySelector(".nav-sheet")) return closeMenu();
    const sheet = document.createElement("div");
    sheet.className = "nav-sheet";
    sheet.innerHTML = MENU.map((m) => '<a href="' + m[1] + '">' + m[0] + "</a>").join("");
    sheet.addEventListener("click", closeMenu);
    btn.closest(".nav-inner").appendChild(sheet);
    btn.setAttribute("aria-expanded", "true");
  }

  /*
   * The keyboard hints said Cmd on every machine. On Windows and Linux the key
   * is Ctrl, so the two shortcuts this app advertises were being shown wrong to
   * most of the people who would ever open it - including the author.
   */
  function paintPlatformKeys() {
    const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || "");
    if (mac) return;
    document.querySelectorAll("[data-key]").forEach((n) => {
      n.textContent = n.getAttribute("data-key").replace("⌘", "Ctrl+");
    });
  }

  function boot() {
    applyTheme(preferredTheme());

    document.addEventListener("click", (e) => {
      const themeBtn = e.target.closest("[data-theme-toggle]");
      if (themeBtn) return toggleTheme();

      const menu = e.target.closest("#nav-menu");
      if (menu) { e.preventDefault(); return toggleMenu(menu); }
      if (!e.target.closest(".nav-sheet")) closeMenu();

      const acct = e.target.closest("[data-account]");
      if (acct && global.AccountPanel) { e.preventDefault(); return global.AccountPanel.open(); }

      const goBtn = e.target.closest("[data-go]");
      if (goBtn) {
        e.preventDefault();
        if (global.self !== global.top && goBtn.getAttribute("data-go") !== "app") return;
        return go(goBtn.getAttribute("data-go"));
      }

      const top = e.target.closest("[data-top]");
      if (top) {
        // The hero embeds this same page at #app. Without this guard, clicking
        // the brand inside that frame loads the whole landing page into it,
        // which then embeds another one.
        if (global.self !== global.top) return;
        if (routeFromHash() !== "landing") return go("landing");
        const smooth = !global.matchMedia || !global.matchMedia("(prefers-reduced-motion: reduce)").matches;
        return global.scrollTo({ top: 0, behavior: smooth ? "smooth" : "auto" });
      }
    });

    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMenu(); });
    global.addEventListener("hashchange", () => show(routeFromHash()));
    paintPlatformKeys();
    show(routeFromHash());
  }

  global.Router = { go: go, refresh: paintSession };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})(window);
