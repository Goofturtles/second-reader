/*
 * Sign-in. Three stages on one form: email, then either unlock or create.
 *
 * The honest part matters here. There is no server, so "Continue with Google"
 * only works if a client ID has been configured for this origin, and the app
 * says so plainly rather than showing a button that silently does nothing.
 */

(function (global) {
  "use strict";

  const { esc, toast } = global.UI;

  // set this to a Google OAuth client ID authorised for the deployed origin
  const GOOGLE_CLIENT_ID = "";

  const state = { stage: "email", email: "", known: null, role: "teacher" };
  let wired = false;

  const emailOk = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
  const pinOk = (v) => /^\d{4,6}$/.test(v);

  /* The region has to stay in the accessibility tree for the update to be
     announced, so it is emptied rather than hidden. */
  function notice(message) {
    const node = document.getElementById("auth-notice");
    if (!node) return;
    node.classList.toggle("is-empty", !message);
    node.textContent = message || "";
  }

  function paint() {
    const fields = document.getElementById("auth-fields");
    const submit = document.getElementById("auth-submit");
    const change = document.getElementById("auth-change");
    if (!fields) return;

    if (state.stage === "email") {
      fields.innerHTML =
        '<label class="field"><span>Email</span>' +
        '<input class="input" id="a-email" type="email" autocomplete="email" placeholder="you@school.on.ca" value="' + esc(state.email) + '"></label>';
      submit.textContent = "Continue with email";
      change.hidden = true;
    } else if (state.stage === "pin") {
      fields.innerHTML =
        '<p class="auth-note">Welcome back, <b>' + esc(state.known.name) + "</b>. Enter your PIN to unlock this profile.</p>" +
        '<label class="field"><span>PIN</span>' +
        '<input class="input pin" id="a-pin" type="password" inputmode="numeric" autocomplete="off" placeholder="••••" aria-label="Profile PIN, 4 to 6 digits"></label>';
      submit.textContent = "Unlock profile";
      change.hidden = false;
    } else {
      fields.innerHTML =
        '<p class="auth-note">New profile for <b>' + esc(state.email.trim().toLowerCase()) + "</b>.</p>" +
        '<div class="role-pick" role="radiogroup" aria-label="Which are you?">' +
          '<button type="button" class="role" data-role="teacher" role="radio" aria-checked="' + (state.role === "teacher") + '">' +
            "<b>I am a teacher</b><span>I mark other people&rsquo;s work</span></button>" +
          '<button type="button" class="role" data-role="student" role="radio" aria-checked="' + (state.role === "student") + '">' +
            "<b>I am a student</b><span>I check my own work</span></button>" +
        "</div>" +
        '<label class="field"><span>Name</span><input class="input" id="a-name" autocomplete="name" placeholder="A. Okonjo"></label>' +
        '<label class="field"><span>Create a PIN (4–6 digits)</span>' +
        '<input class="input pin" id="a-pin" type="password" inputmode="numeric" autocomplete="off" placeholder="••••" aria-label="Create a PIN, 4 to 6 digits"></label>';
      submit.textContent = "Create profile";
      change.hidden = false;
    }

    const pin = document.getElementById("a-pin");
    if (pin) pin.addEventListener("input", () => { pin.value = pin.value.replace(/\D/g, "").slice(0, 6); });

    fields.querySelectorAll("[data-role]").forEach((b) =>
      b.addEventListener("click", () => {
        state.role = b.getAttribute("data-role");
        fields.querySelectorAll("[data-role]").forEach((x) =>
          x.setAttribute("aria-checked", x.getAttribute("data-role") === state.role));
      })
    );

    const first = fields.querySelector("input");
    if (first) first.focus();
    notice("");
  }

  function paintResume() {
    const host = document.getElementById("auth-resume");
    if (!host) return;
    const s = Session.current();
    host.innerHTML = s
      ? '<button class="btn" id="a-resume" style="width:100%;margin-top:22px;border-radius:13px;padding:12px">Continue as ' + esc(Session.firstName(s)) + "</button>"
      : "";
    const btn = document.getElementById("a-resume");
    if (btn) btn.addEventListener("click", () => global.Router.go("app"));
  }

  async function submit(e) {
    e.preventDefault();

    if (state.stage === "email") {
      const value = document.getElementById("a-email").value;
      if (!emailOk(value)) return notice("Enter a valid email to continue.");
      state.email = value;
      const found = Session.lookup(value);
      if (found && !found.hasPin) {
        // provider profile, or one made in a context without crypto.subtle
        const res = await Session.unlock({ email: value });
        if (res.ok) return global.Router.go("app");
      }
      state.known = found;
      state.stage = found ? "pin" : "create";
      return paint();
    }

    const pin = document.getElementById("a-pin").value;
    if (!Session.secure()) {
      // no crypto.subtle (file:// or plain http) — make a PIN-less profile
      const name = state.stage === "create" ? (document.getElementById("a-name").value || "").trim() : state.known.name;
      const res = await Session.create({ name: name, email: state.email, role: state.role });
      if (res.ok || Session.lookup(state.email)) {
        await Session.unlock({ email: state.email });
        toast("Signed in without a PIN — PINs need a secure connection.");
        return global.Router.go("app");
      }
      return notice("Could not create a profile in this browser.");
    }

    if (!pinOk(pin)) return notice("PINs are 4 to 6 digits.");

    if (state.stage === "pin") {
      const res = await Session.unlock({ email: state.email, pin: pin });
      if (!res.ok) return notice(res.error === "pin" ? "Wrong PIN. Try again." : "Could not unlock that profile.");
      return global.Router.go("app");
    }

    const name = (document.getElementById("a-name").value || "").trim();
    if (!name) return notice("Add your name to create the profile.");
    const res = await Session.create({ name: name, email: state.email, pin: pin, role: state.role });
    if (!res.ok) return notice("That email already has a profile here. Go back and sign in.");
    global.Router.go("app");
  }

  function google() {
    if (!GOOGLE_CLIENT_ID) {
      return notice("Google sign-in switches on once a client ID is authorised for this site. Use email below, or read as a guest — nothing is gated behind an account.");
    }
    const start = () => {
      global.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: (resp) => {
          try {
            const b64 = resp.credential.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
            const payload = JSON.parse(atob(b64));
            Session.fromProvider({ name: payload.name, email: payload.email, provider: "google" });
            global.Router.go("app");
          } catch (err) {
            notice("Google sign-in did not complete. Continue with email below.");
          }
        },
      });
      global.google.accounts.id.prompt();
    };
    if (global.google && global.google.accounts) return start();
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = start;
    s.onerror = () => notice("Could not reach Google. Continue with email below.");
    document.head.appendChild(s);
  }

  function mount() {
    if (!wired) {
      wired = true;
      document.getElementById("auth-form").addEventListener("submit", submit);
      document.getElementById("auth-change").addEventListener("click", () => {
        state.stage = "email";
        state.known = null;
        paint();
      });
      document.getElementById("sso-google").addEventListener("click", google);
      document.getElementById("sso-school").addEventListener("click", () =>
        notice("School SSO needs a district tenant and a server to hold the callback. Neither exists yet, and pretending otherwise would be the wrong start for a tool about evidence.")
      );
    }
    state.stage = "email";
    state.known = null;
    paint();
    paintResume();
  }

  global.AuthView = { mount: mount };
})(window);
