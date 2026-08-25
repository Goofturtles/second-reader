/*
 * Google Classroom, read-only.
 *
 * What this is honestly able to do, and what it needs from you:
 *
 * This app is a static page. There is no server of ours anywhere in the loop,
 * which is the whole privacy claim, and it is also the reason this cannot ship
 * with a working Classroom connection baked in. Google issues OAuth clients to
 * a project, tied to an origin, and the Classroom scopes below need that
 * project verified before anyone outside its test users can consent. So the
 * connection runs on YOUR OAuth client id, entered in Settings, against YOUR
 * Google Cloud project. Without one, this module does nothing and says so.
 *
 * The access token lives in memory for the length of the tab and is never
 * written to storage. That means reconnecting after a reload, which is the
 * right trade for a token that can read a whole class's work.
 *
 * Everything here is readonly. Nothing is ever written back to Classroom, and
 * nothing is written back to a student's document.
 *
 * CALLER CONTRACT: every string handed back by this module is attacker-shaped.
 * Course and assignment titles come from whoever set the course up; student
 * names and Drive file titles come from the students themselves. None of it is
 * escaped here. Anything that reaches innerHTML must go through UI.esc first.
 */

(function (global) {
  "use strict";

  const KEY_ID = "sr:classroom:client";

  const SCOPES = [
    "https://www.googleapis.com/auth/classroom.courses.readonly",
    "https://www.googleapis.com/auth/classroom.coursework.students.readonly",
    "https://www.googleapis.com/auth/classroom.student-submissions.students.readonly",
    "https://www.googleapis.com/auth/classroom.rosters.readonly",
    "https://www.googleapis.com/auth/drive.readonly",
  ].join(" ");

  let token = null;
  let tokenClient = null;
  let gisLoading = null;

  /* ------------------------------ configuration ----------------------------- */

  function clientId() {
    try { return localStorage.getItem(KEY_ID) || ""; } catch (e) { return ""; }
  }
  function setClientId(id) {
    /* Dropping the reference is not the same as ending the grant: the old
       token stays valid at Google for about an hour, and after this there is
       no UI left that could revoke it. */
    disconnect();
    try {
      const clean = String(id || "").trim();
      if (clean) localStorage.setItem(KEY_ID, clean);
      else localStorage.removeItem(KEY_ID);
      tokenClient = null;
    } catch (e) { /* private mode */ }
  }
  function configured() { return !!clientId(); }
  function connected() { return !!token; }

  /* --------------------------------- connect -------------------------------- */

  function loadGis() {
    if (global.google && google.accounts && google.accounts.oauth2) return Promise.resolve(true);
    if (gisLoading) return gisLoading;
    gisLoading = new Promise((resolve) => {
      const s = document.createElement("script");
      s.src = "https://accounts.google.com/gsi/client";
      s.async = true;
      s.onload = () => resolve(true);
      s.onerror = () => {
        /* Otherwise one flaky load pins every later connect() in this tab to
           "offline" and the only fix the user has is a reload. */
        gisLoading = null;
        resolve(false);
      };
      document.head.appendChild(s);
    });
    return gisLoading;
  }

  async function connect() {
    const id = clientId();
    if (!id) return { ok: false, error: "no-client" };
    if (!(await loadGis())) return { ok: false, error: "offline" };

    return new Promise((resolve) => {
      try {
        tokenClient = google.accounts.oauth2.initTokenClient({
          client_id: id,
          scope: SCOPES,
          callback: (res) => {
            if (res && res.access_token) {
              token = res.access_token;
              resolve({ ok: true });
            } else {
              resolve({ ok: false, error: "denied" });
            }
          },
          error_callback: (err) => {
            /* popup_closed_by_user, popup_failed_to_open, and the rest all mean
               the same thing to the person: it did not connect. */
            resolve({ ok: false, error: (err && err.type) || "denied" });
          },
        });
        tokenClient.requestAccessToken({ prompt: "" });
      } catch (e) {
        resolve({ ok: false, error: "bad-client" });
      }
    });
  }

  function disconnect() {
    if (token && global.google && google.accounts && google.accounts.oauth2) {
      try { google.accounts.oauth2.revoke(token); } catch (e) { /* already gone */ }
    }
    token = null;
  }

  /* ---------------------------------- calls --------------------------------- */

  async function api(url) {
    if (!token) return { ok: false, error: "not-connected" };
    let res;
    try {
      res = await fetch(url, { headers: { Authorization: "Bearer " + token } });
    } catch (e) {
      return { ok: false, error: "offline" };
    }
    if (res.status === 401) { token = null; return { ok: false, error: "expired" }; }
    if (res.status === 403) return { ok: false, error: "forbidden" };
    if (!res.ok) return { ok: false, error: "http-" + res.status };
    return { ok: true, data: await res.json() };
  }

  /** Courses this account teaches. A student account gets nothing here, which
      is correct: this half of the app is the marking half. */
  async function courses() {
    const out = await api("https://classroom.googleapis.com/v1/courses?courseStates=ACTIVE&teacherId=me&pageSize=50");
    if (!out.ok) return out;
    return { ok: true, courses: (out.data.courses || []).map((c) => ({ id: c.id, name: c.name, section: c.section || "" })) };
  }

  async function assignments(courseId) {
    const out = await api("https://classroom.googleapis.com/v1/courses/" + encodeURIComponent(courseId) +
      "/courseWork?courseWorkStates=PUBLISHED&pageSize=50");
    if (!out.ok) return out;
    return {
      ok: true,
      work: (out.data.courseWork || []).map((w) => ({
        id: w.id, title: w.title, description: w.description || "", due: w.dueDate || null,
      })),
    };
  }

  /** Names, so a stack of submissions is a class rather than a list of ids.
      Rosters is a separate scope and may be refused; the import still works. */
  async function students(courseId) {
    const out = await api("https://classroom.googleapis.com/v1/courses/" + encodeURIComponent(courseId) + "/students?pageSize=200");
    const by = {};
    if (out.ok) {
      (out.data.students || []).forEach((s) => {
        by[s.userId] = (s.profile && s.profile.name && s.profile.name.fullName) || "";
      });
    }
    return by;
  }

  async function submissions(courseId, workId) {
    const out = await api("https://classroom.googleapis.com/v1/courses/" + encodeURIComponent(courseId) +
      "/courseWork/" + encodeURIComponent(workId) + "/studentSubmissions?pageSize=100");
    if (!out.ok) return out;
    const names = await students(courseId);

    const rows = (out.data.studentSubmissions || []).map((s) => {
      const atts = (s.assignmentSubmission && s.assignmentSubmission.attachments) || [];
      const file = atts.map((a) => a.driveFile).filter(Boolean)[0] || null;
      return {
        id: s.id,
        who: names[s.userId] || "Student " + String(s.userId).slice(-4),
        state: s.state,
        late: !!s.late,
        fileId: file ? file.id : null,
        fileName: file ? file.title : null,
      };
    });
    return { ok: true, submissions: rows.filter((r) => r.fileId) };
  }

  /**
   * The text of one submission.
   *
   * A Google Doc has no bytes to download, so it is exported as text/plain.
   * Anything else is fetched as-is, and anything that is not text (a PDF, a
   * photo of handwriting) is refused rather than turned into mojibake.
   */
  async function textOf(fileId) {
    if (!token) return { ok: false, error: "not-connected" };
    const meta = await api("https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(fileId) + "?fields=mimeType,name");
    if (!meta.ok) return meta;

    const mime = meta.data.mimeType || "";
    const isDoc = mime === "application/vnd.google-apps.document";
    if (!isDoc && mime.indexOf("text/") !== 0) return { ok: false, error: "not-text", mime: mime };

    const url = isDoc
      ? "https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(fileId) + "/export?mimeType=text/plain"
      : "https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(fileId) + "?alt=media";

    let res;
    try {
      res = await fetch(url, { headers: { Authorization: "Bearer " + token } });
    } catch (e) {
      return { ok: false, error: "offline" };
    }
    if (!res.ok) return { ok: false, error: "http-" + res.status };
    const text = (await res.text()).replace(/\r\n?/g, "\n").trim();
    return { ok: true, text: text, name: meta.data.name || "" };
  }

  /**
   * The assignment's own rubric, if the teacher built one in Classroom.
   *
   * This is the best thing in the whole integration when it works: the
   * checklist stops being something you retype and becomes the rubric you
   * already wrote. The endpoint is newer than the rest of the API and is not
   * on every account, so a failure here is not an error - it just means we
   * fall back to the assignment description.
   */
  async function rubric(courseId, workId) {
    const out = await api("https://classroom.googleapis.com/v1/courses/" + encodeURIComponent(courseId) +
      "/courseWork/" + encodeURIComponent(workId) + "/rubrics");
    if (!out.ok) return { ok: false, error: out.error };

    const first = (out.data.rubrics || [])[0];
    if (!first || !first.criteria || !first.criteria.length) return { ok: false, error: "none" };

    return {
      ok: true,
      criteria: first.criteria.map((c, i) => ({
        id: "gc" + i,
        name: (c.title || "Criterion " + (i + 1)).trim(),
        /* Classroom keeps the description on the criterion and the detail on
           each level. The top level is what "good" looks like, which is what
           the close reader wants to match against. */
        descriptor: (c.description || (c.levels && c.levels.length ? c.levels[c.levels.length - 1].description : "") || c.title || "").trim(),
        lookFor: [],
      })).filter((c) => c.name),
    };
  }

  global.Classroom = {
    clientId, setClientId, configured, connected,
    connect, disconnect,
    courses, assignments, submissions, textOf, rubric,
    SCOPES,
  };
})(window);
