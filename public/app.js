import {
  configured, auth, db,
  onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, sendEmailVerification, sendPasswordResetEmail, signOut,
  collection, doc, onSnapshot, setDoc, updateDoc, deleteDoc, serverTimestamp,
} from "./firebase.js";

/* ---------- constants ---------- */
const AREAS = ["Milking – parlour","Robot unit","Herd health","Breeding & AI","Calves & youngstock","Grass & grazing","Silage & feed","Slurry & fertiliser","Machinery & repairs","Staff & rota","Finances & paperwork","Contractors & suppliers"];
const DUTIES = ["Parlour – AM milking","Parlour – PM milking","Robot – checks & wires","Calf feeding","Day jobs 1","Day jobs 2","Off 1","Off 2"];
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const MONTHS_LONG = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DAYS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
const TABS = ["today","jobs","rota","plan","meetings"];
const ICON = {
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  left: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
  right: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  google: '<svg viewBox="0 0 24 24"><path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.2-2.1 3.5-5.1 3.5-8.7z"/><path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24z"/><path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.3a12 12 0 0 0 0 10.8l4-3.1z"/><path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9z"/></svg>',
};

/* ---------- small helpers ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
const pad = n => String(n).padStart(2, "0");
const iso = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const parse = s => { const [y,m,d] = String(s).split("-").map(Number); return new Date(y, m-1, d); };
const today = () => { const d = new Date(); d.setHours(0,0,0,0); return d; };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const monday = d => addDays(d, -((d.getDay() + 6) % 7));
const dayIdx = d => (d.getDay() + 6) % 7;
const short = s => parse(s).toLocaleDateString("en-IE", { day: "numeric", month: "short" });
const byDue = (a, b) => (a.due || "9999").localeCompare(b.due || "9999") || String(a.title).localeCompare(String(b.title));
const initials = n => { n = String(n || "").trim(); if (!n) return ""; const p = n.split(/\s+/); return (p.length > 1 ? p[0][0] + p[1][0] : n.slice(0, 2)).toUpperCase(); };
const tag = (n, cls = "") => n ? `<span class="tag ${cls}" title="${esc(n)}">${esc(initials(n))}</span>` : `<span class="tag empty-tag ${cls}">–</span>`;
const person = (n, cls = "") => `<span class="person">${tag(n, cls)}<span>${esc(n || "Nobody")}</span></span>`;
const isDone = j => j.status === "Done";
const store = { get(k){ try { return localStorage.getItem(k); } catch(e){ return null; } }, set(k, v){ try { localStorage.setItem(k, v); } catch(e){} } };
const isStandalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

/* ---------- state ---------- */
const S = {
  phase: "boot", user: null, member: null, members: [],
  people: [], jobs: [], rota: {}, rotaMeta: {}, cal: [], calMeta: null, roles: [], meetings: [],
  tab: "today", jobFilter: "open", month: new Date().getMonth() + 1, weekOff: 0, rotaDay: null,
  online: navigator.onLine, authMode: "signin", authError: "",
};
{ const h = location.hash.slice(1), t = store.get("tab"); if (TABS.includes(h)) S.tab = h; else if (TABS.includes(t)) S.tab = t; }
const me = () => S.member ? S.member.person : "";
const isAdmin = () => !!(S.member && S.member.role === "admin");
const myEmail = () => (S.user && S.user.email ? S.user.email.toLowerCase() : "");
const nameFor = email => { const m = S.members.find(x => x.id === email); return m ? m.person || email : email; };
const stamp = () => ({ updatedBy: myEmail(), updatedAt: serverTimestamp() });

function dueLabel(j) {
  if (isDone(j)) return j.doneOn ? "Done " + short(j.doneOn) : "Done";
  if (!j.due) return "";
  const t = today(), d = parse(j.due), diff = Math.round((d - t) / 864e5);
  if (diff < 0) return diff === -1 ? "1 day late" : (-diff) + " days late";
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff < 7) return d.toLocaleDateString("en-IE", { weekday: "short" }) + " " + d.getDate();
  return short(j.due);
}
function changedLine(o) {
  if (!o || !o.updatedBy) return "";
  const when = o.updatedAt && o.updatedAt.toDate ? o.updatedAt.toDate().toLocaleString("en-IE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
  return `<p class="changed">Last changed by ${esc(nameFor(o.updatedBy))}${when ? " · " + esc(when) : ""}</p>`;
}
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 3500); }
const names = () => S.people.map(p => p.name).filter(Boolean);
const team = () => S.people.filter(p => p.kind !== "contact").map(p => p.name);
function ownerOptions(cur) { const l = names(); if (cur && !l.includes(cur)) l.push(cur); return `<option value="">Unassigned</option>` + l.map(n => `<option ${n === cur ? "selected" : ""}>${esc(n)}</option>`).join(""); }
function areaOptions(cur) { const l = AREAS.slice(); if (cur && !l.includes(cur)) l.push(cur); return `<option value="">No area</option>` + l.map(n => `<option ${n === cur ? "selected" : ""}>${esc(n)}</option>`).join(""); }
const opts = (l, cur) => l.map(n => `<option ${n === cur ? "selected" : ""}>${esc(n)}</option>`).join("");

/* ---------- writes ----------
   Firestore keeps writes on the phone and sends them when there's signal, so we never wait on the
   server here: the change shows straight away and the toast says whether it's synced yet. */
function write(fn, ok) {
  let p;
  try { p = fn(); } catch (e) { writeFailed(e); return false; }
  Promise.resolve(p).catch(writeFailed);
  if (ok) toast(S.online ? ok : ok + ". It'll sync when you're back online.");
  return true;
}
function writeFailed(e) {
  console.error(e);
  if (e && e.code === "permission-denied") toast("That change wasn't saved: you don't have permission to make it.");
  else toast("That change wasn't saved. Try again.");
}

/* ---------- auth ---------- */
const AUTH_MSG = {
  "auth/invalid-credential": "That email and password don't match. Check them, or reset your password.",
  "auth/wrong-password": "That email and password don't match. Check them, or reset your password.",
  "auth/user-not-found": "There's no account with that email yet. Use Create account.",
  "auth/email-already-in-use": "There's already an account with that email. Sign in instead.",
  "auth/weak-password": "Use a password with at least 6 characters.",
  "auth/invalid-email": "That email address doesn't look right.",
  "auth/missing-password": "Enter your password.",
  "auth/network-request-failed": "No connection. You need signal to sign in the first time.",
  "auth/too-many-requests": "Too many attempts. Wait a few minutes and try again.",
  "auth/unauthorized-domain": "This web address isn't allowed to sign in yet. Add it under Firebase > Authentication > Settings > Authorised domains.",
  "auth/popup-blocked": "The sign-in window was blocked. Allow pop-ups for this site, or open the installed app.",
};
function authError(e) {
  if (!e || e.code === "auth/popup-closed-by-user" || e.code === "auth/cancelled-popup-request") return;
  S.authError = AUTH_MSG[e.code] || "Sign-in didn't work (" + (e.code || e.message) + ").";
  render();
}
async function googleSignIn() {
  S.authError = "";
  const p = new GoogleAuthProvider();
  p.setCustomParameters({ prompt: "select_account" });
  try {
    // Installed apps and iPhones handle a full-page redirect better than a pop-up.
    if (isStandalone() || isIOS()) await signInWithRedirect(auth, p);
    else await signInWithPopup(auth, p);
  } catch (e) { authError(e); }
}

let unsubs = [];
let memberUnsub = null;
function stopData() { unsubs.forEach(u => u()); unsubs = []; if (memberUnsub) { memberUnsub(); memberUnsub = null; } }

async function handleUser(u) {
  stopData();
  S.user = u; S.member = null;
  if (!u) { S.phase = "signin"; return render(); }
  if (!u.emailVerified) { S.phase = "verify"; return render(); }
  S.phase = "boot"; render();
  memberUnsub = onSnapshot(doc(db, "members", myEmail()), { includeMetadataChanges: true }, snap => {
    if (!snap.exists()) {
      // Offline on a phone that has never loaded the list: wait for signal rather than saying "not on the list".
      if (snap.metadata.fromCache) { if (!S.member) { S.phase = "boot"; render(); } return; }
      stopDataOnly(); S.member = null; S.phase = "notmember"; return render();
    }
    const first = !S.member;
    S.member = Object.assign({ id: snap.id }, snap.data());
    S.phase = "app";
    if (first) startData();
    render();
  }, err => { console.error(err); S.phase = "notmember"; render(); });
}
function stopDataOnly() { unsubs.forEach(u => u()); unsubs = []; }

function startData() {
  stopDataOnly();
  const meta = { includeMetadataChanges: true };
  const rows = s => s.docs.map(d => Object.assign({ id: d.id, _pending: d.metadata.hasPendingWrites }, d.data({ serverTimestamps: "estimate" })));
  const fail = e => { console.error(e); if (e.code === "permission-denied") return; toast("Couldn't load some of the farm data. Pull down or reopen the app to retry."); };
  unsubs.push(onSnapshot(collection(db, "members"), meta, s => { S.members = rows(s); render(); }, fail));
  unsubs.push(onSnapshot(collection(db, "people"), meta, s => { S.people = rows(s).sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || String(a.name).localeCompare(b.name)); render(); }, fail));
  unsubs.push(onSnapshot(collection(db, "jobs"), meta, s => { S.jobs = rows(s); render(); }, fail));
  unsubs.push(onSnapshot(collection(db, "rota"), meta, s => { const r = {}; rows(s).forEach(d => r[d.id] = d); S.rota = r; render(); }, fail));
  unsubs.push(onSnapshot(collection(db, "meetings"), meta, s => { S.meetings = rows(s).sort((a, b) => String(b.date).localeCompare(a.date)); render(); }, fail));
  unsubs.push(onSnapshot(doc(db, "config", "calendar"), meta, s => { const d = s.exists() ? s.data({ serverTimestamps: "estimate" }) : null; S.cal = d ? d.items || [] : []; S.calMeta = d; render(); }, fail));
  unsubs.push(onSnapshot(doc(db, "config", "roles"), meta, s => { const d = s.exists() ? s.data({ serverTimestamps: "estimate" }) : null; S.roles = d ? d.areas || [] : []; render(); }, fail));
}

/* ---------- screens before the app ---------- */
function vSetup() {
  return `<div class="auth"><div class="auth-head"><span class="tag xl">LR</span><h1>Lough Ree Farm</h1></div>
  <div class="card"><b>Almost there</b><p class="sub">This copy of the app isn't connected to Firebase yet. Fill in <code>public/config.js</code> with your project's web config (README step 4), then deploy again.</p></div></div>`;
}
function vSignin() {
  const create = S.authMode === "create";
  return `<div class="auth">
    <div class="auth-head"><span class="tag xl">LR</span><h1>Lough Ree Farm</h1><p class="sub">Rota, jobs and the weekly meeting, for everyone on the farm.</p></div>
    <div class="card">
      <button class="google" type="button" data-act="google">${ICON.google}<span>Continue with Google</span></button>
      <div class="or">or use your email</div>
      <div class="seg" role="group" aria-label="Sign in or create an account">
        <button type="button" data-act="authmode" data-m="signin" aria-pressed="${!create}">Sign in</button>
        <button type="button" data-act="authmode" data-m="create" aria-pressed="${create}">Create account</button>
      </div>
      <form id="authForm" class="menu" novalidate>
        <div class="field"><label for="a-email">Email</label><input id="a-email" name="email" type="email" autocomplete="email" inputmode="email" required></div>
        <div class="field"><label for="a-pass">Password</label><input id="a-pass" name="password" type="password" autocomplete="${create ? "new-password" : "current-password"}" required minlength="6"></div>
        ${S.authError ? `<p class="err" role="alert">${esc(S.authError)}</p>` : ""}
        <button class="btn primary block" type="submit">${create ? "Create account" : "Sign in"}</button>
        ${create ? `<p class="note">We'll email you a link to confirm the address. David then adds you to the farm.</p>` : `<button class="link" type="button" data-act="reset">Forgot your password?</button>`}
      </form>
    </div>
  </div>`;
}
function vVerify() {
  return `<div class="auth"><div class="auth-head"><span class="tag xl">LR</span><h1>Check your email</h1></div>
  <div class="card"><p class="sub">We sent a link to <b>${esc(S.user && S.user.email)}</b>. Tap it to confirm your address, then come back here.</p>
  ${S.authError ? `<p class="err" role="alert">${esc(S.authError)}</p>` : ""}
  <button class="btn primary block" type="button" data-act="verified">I've confirmed it</button>
  <button class="btn ghost block" type="button" data-act="resend">Send the email again</button>
  <button class="link" type="button" data-act="signout">Use a different account</button></div></div>`;
}
function vNotMember() {
  return `<div class="auth"><div class="auth-head"><span class="tag xl empty-tag">?</span><h1>Not on the list yet</h1></div>
  <div class="card"><p class="sub">You're signed in as <b>${esc(S.user && S.user.email)}</b>, but this address hasn't been added to the farm.</p>
  <p class="sub">Send this email address to David or another admin. Once they add you, this screen opens the app by itself.</p>
  <button class="btn ghost block" type="button" data-act="copyemail">Copy my email address</button>
  <button class="link" type="button" data-act="signout">Sign out</button></div></div>`;
}

/* ---------- app views ---------- */
function render() {
  const app = S.phase === "app";
  document.body.classList.toggle("noapp", !app);
  $("#top").hidden = !app; $("#tabbar").hidden = !app;
  $("#offline").hidden = !(app && !S.online);
  const v = $("#view"), fab = $("#fab");
  if (!app) {
    fab.hidden = true;
    v.innerHTML = !configured ? vSetup() : S.phase === "signin" ? vSignin() : S.phase === "verify" ? vVerify() : S.phase === "notmember" ? vNotMember()
      : `<div class="boot"><span class="tag lg">LR</span><p>${S.online ? "Loading the farm…" : "No signal. The app needs signal the first time it opens on this phone."}</p></div>`;
    return;
  }
  document.querySelectorAll(".tab").forEach(b => b.setAttribute("aria-current", b.dataset.tab === S.tab ? "page" : "false"));
  $("#whoName").textContent = me() || myEmail();
  $("#whoTag").outerHTML = me() ? `<span id="whoTag" class="tag sm">${esc(initials(me()))}</span>` : `<span id="whoTag" class="tag sm empty-tag">?</span>`;
  const over = S.jobs.filter(j => !isDone(j) && j.due && j.due < iso(today())).length;
  const dot = $("#overDot"); dot.hidden = !over; dot.textContent = over;
  const pendingCount = S.jobs.filter(j => j._pending).length + S.meetings.filter(m => m._pending).length + Object.values(S.rota).filter(r => r._pending).length;
  $("#netline").textContent = !S.online ? "Offline" + (pendingCount ? ` · ${pendingCount} change${pendingCount > 1 ? "s" : ""} waiting to sync` : "") : pendingCount ? "Syncing…" : "190 parlour · 60 robot";
  // Keep scroll position when live updates re-render the screen.
  const y = window.scrollY;
  v.innerHTML = ({ today: vToday, jobs: vJobs, rota: vRota, plan: vPlan, meetings: vMeetings })[S.tab]();
  window.scrollTo(0, y);
  const showFab = ["today", "jobs", "meetings"].includes(S.tab);
  fab.hidden = !showFab;
  if (showFab) { const m = S.tab === "meetings"; fab.dataset.act = m ? "newmeet" : "newjob"; $("#fabLabel").textContent = m ? "Log meeting" : "New job"; }
}

function jobRow(j) {
  const t = iso(today()), done = isDone(j), over = !done && j.due && j.due < t;
  const pills = [];
  if (!done && j.priority === "High") pills.push(`<span class="pill high">High</span>`);
  if (!done && j.status === "In progress") pills.push(`<span class="pill prog">In progress</span>`);
  if (j._pending) pills.push(`<span class="pill sync">Not synced yet</span>`);
  return `<li class="job ${over ? "is-over" : ""} ${done ? "is-done" : ""}">
    <button class="check" type="button" data-act="toggle" data-id="${esc(j.id)}" aria-label="${done ? "Mark not done" : "Mark done"}: ${esc(j.title)}">${ICON.check}</button>
    <button class="job-main" type="button" data-act="editjob" data-id="${esc(j.id)}"><span class="job-title">${esc(j.title)}</span><span class="job-meta">${j.area ? `<span>${esc(j.area)}</span>` : ""}${pills.join("")}</span></button>
    <span class="job-side">${tag(j.owner, "sm")}<span class="due">${esc(dueLabel(j))}</span></span>
  </li>`;
}
const jobList = (arr, empty) => arr.length ? `<ul class="jobs card">${arr.map(jobRow).join("")}</ul>` : `<div class="card"><p class="empty">${empty}</p></div>`;

function vToday() {
  const t = today(), ti = iso(t), wk = iso(monday(t)), di = dayIdx(t), r = S.rota[wk];
  const open = S.jobs.filter(j => !isDone(j));
  const overdue = open.filter(j => j.due && j.due < ti).sort(byDue);
  const soon = open.filter(j => j.due && j.due >= ti && j.due <= iso(addDays(t, 7))).sort(byDue);
  const doneWk = S.jobs.filter(j => isDone(j) && j.doneOn && j.doneOn >= wk).length;
  const mine = me() ? open.filter(j => j.owner === me()).sort(byDue) : [];
  let rota;
  if (r) {
    const rows = (r.duties || []).filter(d => d.days && d.days[di]);
    rota = rows.length ? `<ul class="duties card">${rows.map(d => `<li class="${d.days[di] === me() ? "me" : ""}"><span class="dname">${esc(d.duty)}</span>${person(d.days[di])}</li>`).join("")}</ul>`
      : `<div class="card"><p class="empty">Nobody is on the rota for today. <button class="link" type="button" data-act="go" data-tab="rota">Fill in today</button></p></div>`;
  } else rota = `<div class="card"><p class="empty">There's no rota for this week yet. <button class="link" type="button" data-act="go" data-tab="rota">Set up this week</button></p></div>`;
  const myDuties = r && me() ? (r.duties || []).filter(d => d.days && d.days[di] === me()).map(d => d.duty) : [];
  const nm = (t.getMonth() + 1) % 12 + 1, next = S.cal.filter(c => (c.months || []).includes(nm));
  const s = [];
  if (!isStandalone() && store.get("installDismissed") !== "1")
    s.push(`<div class="banner"><p><b>Put the farm on your home screen.</b> It opens like an app and works with no signal.</p><button class="btn primary small" type="button" data-act="install">How</button><button class="x" type="button" data-act="dismissinstall" aria-label="Hide">×</button></div>`);
  s.push(`<section><p class="dayline">${esc(t.toLocaleDateString("en-IE", { weekday: "long", day: "numeric", month: "long" }))}</p><p class="sub">${me() ? (myDuties.length ? `You're on: ${esc(myDuties.join(", "))}.` : "You're not on the rota today.") : "Your login isn't linked to a name yet. Ask an admin to link it."}</p></section>`);
  s.push(`<section class="stats" aria-label="Jobs at a glance">
    <button class="stat" type="button" data-act="filter" data-f="open"><b>${open.length}</b><span>Open jobs</span></button>
    <button class="stat ${overdue.length ? "alert" : ""}" type="button" data-act="filter" data-f="overdue"><b>${overdue.length}</b><span>Overdue</span></button>
    <button class="stat" type="button" data-act="filter" data-f="week"><b>${soon.length}</b><span>Due in 7 days</span></button>
    <button class="stat" type="button" data-act="filter" data-f="done"><b>${doneWk}</b><span>Done this week</span></button></section>`);
  s.push(`<section><div class="sec-head"><h2 class="sec">On today</h2><button class="link" type="button" data-act="go" data-tab="rota">Full rota</button></div>${rota}</section>`);
  if (overdue.length) s.push(`<section><h2 class="sec">Overdue</h2>${jobList(overdue)}</section>`);
  if (me()) s.push(`<section><h2 class="sec">Your open jobs</h2>${jobList(mine, "Nothing on your list. Nice.")}</section>`);
  s.push(`<section><h2 class="sec">Due in the next 7 days</h2>${jobList(soon, "Nothing due this week.")}</section>`);
  if (next.length) s.push(`<section><div class="sec-head"><h2 class="sec">Coming up in ${MONTHS_LONG[nm - 1]}</h2><button class="link" type="button" data-act="month" data-m="${nm}">Year plan</button></div><div class="card">${next.map(c => `<div class="row"><div class="row-main"><b>${esc(c.task)}</b><small>${esc(c.area || "")}${c.notes ? " · " + esc(c.notes) : ""}</small></div>${tag(c.owner, "sm")}</div>`).join("")}</div></section>`);
  return s.join("");
}

function vJobs() {
  const t = today(), ti = iso(t), in7 = iso(addDays(t, 7));
  const F = {
    open: { l: "Open", f: j => !isDone(j) },
    mine: { l: "Mine", f: j => !isDone(j) && me() && j.owner === me() },
    overdue: { l: "Overdue", f: j => !isDone(j) && j.due && j.due < ti },
    week: { l: "Next 7 days", f: j => !isDone(j) && j.due && j.due >= ti && j.due <= in7 },
    done: { l: "Done", f: isDone },
  };
  const cur = F[S.jobFilter] || F.open;
  let arr = S.jobs.filter(cur.f);
  arr = S.jobFilter === "done" ? arr.sort((a, b) => String(b.doneOn || "").localeCompare(a.doneOn || "")).slice(0, 60) : arr.sort(byDue);
  const chips = Object.entries(F).map(([k, o]) => `<button class="chip" type="button" data-act="filter" data-f="${k}" aria-pressed="${k === S.jobFilter}">${o.l}<span class="n">${S.jobs.filter(o.f).length}</span></button>`).join("");
  const empty = { open: "No open jobs. Add one with New job.", mine: "You've no open jobs.", overdue: "Nothing overdue.", week: "Nothing due in the next 7 days.", done: "No finished jobs yet." }[S.jobFilter];
  let body;
  if (S.jobFilter === "open" && arr.length) {
    const groups = {}; arr.forEach(j => { const k = j.owner || "Unassigned"; (groups[k] = groups[k] || []).push(j); });
    const order = Object.keys(groups).sort((a, b) => (a === "Unassigned") - (b === "Unassigned") || names().indexOf(a) - names().indexOf(b));
    body = order.map(k => `<section><div class="sec-head"><h2 class="sec">${esc(k)}</h2><span class="due">${groups[k].length} open</span></div>${jobList(groups[k])}</section>`).join("");
  } else body = jobList(arr, empty);
  return `<section><div class="chips" role="group" aria-label="Filter jobs">${chips}</div></section>${body}`;
}

function vRota() {
  const t = today(), wkD = addDays(monday(t), 7 * S.weekOff), wk = iso(wkD), r = S.rota[wk], isThis = S.weekOff === 0;
  let di = S.rotaDay; if (di == null) di = isThis ? dayIdx(t) : 0;
  const label = isThis ? "This week" : S.weekOff === 1 ? "Next week" : S.weekOff === -1 ? "Last week" : (S.weekOff > 0 ? "In " + S.weekOff + " weeks" : -S.weekOff + " weeks ago");
  const nav = `<section class="weeknav"><button class="icon-btn" type="button" data-act="week" data-d="-1" aria-label="Previous week">${ICON.left}</button><strong>${label}<small>Week starting Monday ${esc(wkD.toLocaleDateString("en-IE", { day: "numeric", month: "long" }))}</small></strong><button class="icon-btn" type="button" data-act="week" data-d="1" aria-label="Next week">${ICON.right}</button></section>`;
  if (!r) {
    const prev = Object.keys(S.rota).filter(k => k < wk).sort().pop();
    return nav + `<section class="card"><p class="empty">No rota for this week yet. The rota gets updated every Sunday evening.</p><div class="btn-row">${prev ? `<button class="btn primary small" type="button" data-act="copyweek" data-from="${prev}">Copy the week of ${esc(short(prev))}</button>` : ""}<button class="btn ghost small" type="button" data-act="blankweek">Start blank</button></div></section>`;
  }
  const chips = DAYS.map((d, i) => { const dd = addDays(wkD, i); return `<button class="chip daychip ${isThis && i === dayIdx(t) ? "today" : ""}" type="button" data-act="rday" data-i="${i}" aria-pressed="${i === di}">${d}<small>${dd.getDate()}</small></button>`; }).join("");
  const duties = r.duties || [];
  const list = `<ul class="duties card">${duties.map((d, k) => { const n = d.days && d.days[di]; return `<li class="${n && n === me() ? "me" : ""}"><button class="duty-btn" type="button" data-act="cell" data-k="${k}" data-i="${di}" aria-label="Change who covers ${esc(d.duty)} on ${DAYS[di]}"><span class="dname">${esc(d.duty)}${d.notes ? `<small>${esc(d.notes)}</small>` : ""}</span>${person(n)}</button></li>`; }).join("")}</ul>`;
  const ti = isThis ? dayIdx(t) : -1;
  const grid = `<div class="grid-wrap card"><table class="week"><thead><tr><th scope="col">Duty</th>${DAYS.map((d, i) => `<th scope="col" class="${i === ti ? "today" : ""}">${d}</th>`).join("")}</tr></thead><tbody>${duties.map(d => `<tr><td>${esc(d.duty)}</td>${DAYS.map((_, i) => `<td class="${i === ti ? "today" : ""}">${d.days && d.days[i] ? tag(d.days[i], "sm") : ""}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  return nav + `<section><div class="chips" role="group" aria-label="Day">${chips}</div></section><section>${list}<p class="note">Tap a duty to change who covers it.${r._pending ? " <b>Not synced yet.</b>" : ""}</p>${changedLine(r)}</section><section><h2 class="sec">Whole week</h2>${grid}</section>`;
}

function vPlan() {
  const cm = new Date().getMonth() + 1, admin = isAdmin();
  const chips = MONTHS.map((m, i) => `<button class="chip ${i + 1 === cm ? "now" : ""}" type="button" data-act="month" data-m="${i + 1}" aria-pressed="${i + 1 === S.month}">${m}</button>`).join("");
  const items = S.cal.map((c, i) => Object.assign({ i }, c)).filter(c => (c.months || []).includes(S.month));
  const mini = c => `<span class="mini-months" aria-hidden="true">${MONTHS.map((_, k) => `<i class="${(c.months || []).includes(k + 1) ? "on" : ""} ${k + 1 === S.month ? "cur" : ""}"></i>`).join("")}</span>`;
  const rowInner = c => `<div class="row-main"><b>${esc(c.task)}</b><small>${esc(c.area || "")}${c.notes ? " · " + esc(c.notes) : ""}</small>${mini(c)}</div>${tag(c.owner, "sm")}`;
  const cal = items.length ? `<div class="card">${items.map(c => `<div class="row">${admin ? `<button class="rowbtn" type="button" data-act="editcal" data-i="${c.i}">${rowInner(c)}</button>` : rowInner(c)}</div>`).join("")}</div>` : `<div class="card"><p class="empty">Nothing in the yearly plan for ${MONTHS_LONG[S.month - 1]}.</p></div>`;
  const roleInner = a => `<div class="row-main"><b>${esc(a.area)}</b>${a.decides ? `<small>Decides alone: ${esc(a.decides)}</small>` : ""}${a.meeting ? `<small>Brings to meeting: ${esc(a.meeting)}</small>` : ""}</div><span class="owners">${tag(a.owner, "sm")}${a.backup ? `<span class="bk">backup</span>${tag(a.backup, "sm")}` : ""}</span>`;
  const roles = S.roles.length ? `<div class="card">${S.roles.map((a, i) => `<div class="row">${admin ? `<button class="rowbtn" type="button" data-act="editrole" data-i="${i}">${roleInner(a)}</button>` : roleInner(a)}</div>`).join("")}</div>` : `<div class="card"><p class="empty">No areas set up yet.</p></div>`;
  const unowned = S.roles.filter(a => !a.owner).length;
  return `<section><div class="sec-head"><h2 class="sec">Yearly jobs</h2>${admin ? `<button class="link" type="button" data-act="newcal">Add</button>` : ""}</div><div class="months" role="group" aria-label="Month">${chips}</div></section>
  <section><p class="dayline" style="font-size:22px">${MONTHS_LONG[S.month - 1]}</p>${cal}<p class="note">Based on a typical spring-calving year. Check current slurry and fertiliser dates with your advisor.${admin ? "" : " Only admins can change the year plan."}</p></section>
  <section><div class="sec-head"><h2 class="sec">Who owns what</h2>${unowned ? `<span class="pill high">${unowned} without an owner</span>` : ""}</div>${roles}<p class="note">The owner makes the day-to-day calls for that area. Bigger decisions go to the weekly meeting.</p></section>`;
}

function vMeetings() {
  const t = today(), ti = iso(t), in7 = iso(addDays(t, 7));
  const open = S.jobs.filter(j => !isDone(j));
  const overdue = open.filter(j => j.due && j.due < ti).sort(byDue);
  const soon = open.filter(j => j.due && j.due >= ti && j.due <= in7).sort(byDue);
  const doneWk = S.jobs.filter(j => isDone(j) && j.doneOn && j.doneOn >= iso(addDays(t, -7))).sort((a, b) => String(b.doneOn).localeCompare(a.doneOn));
  const nm = (t.getMonth() + 1) % 12 + 1, next = S.cal.filter(c => (c.months || []).includes(nm));
  const counts = {}; open.forEach(j => { const k = j.owner || "Unassigned"; counts[k] = (counts[k] || 0) + 1; });
  const max = Math.max(1, ...Object.values(counts));
  const li = (arr, f) => arr.length ? `<ul>${arr.slice(0, 8).map(f).join("")}${arr.length > 8 ? `<li>and ${arr.length - 8} more</li>` : ""}</ul>` : `<p class="note">None</p>`;
  const agenda = `<div class="card agenda">
    <div><h3>Done in the last week</h3>${li(doneWk, j => `<li>${esc(j.title)} <span class="note">(${esc(j.owner || "–")})</span></li>`)}</div>
    <div><h3>Overdue</h3>${li(overdue, j => `<li>${esc(j.title)} <span class="note">(${esc(j.owner || "–")}, ${esc(dueLabel(j))})</span></li>`)}</div>
    <div><h3>Due this week</h3>${li(soon, j => `<li>${esc(j.title)} <span class="note">(${esc(j.owner || "–")}, ${esc(dueLabel(j))})</span></li>`)}</div>
    ${next.length ? `<div><h3>Plan for ${MONTHS_LONG[nm - 1]}</h3>${li(next, c => `<li>${esc(c.task)}${c.owner ? ` <span class="note">(${esc(c.owner)})</span>` : ""}</li>`)}</div>` : ""}
    <div><h3>Open jobs by person</h3><div class="load">${Object.keys(counts).length ? Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, n]) => `<div class="load-row">${tag(k === "Unassigned" ? "" : k, "sm")}<span class="nm">${esc(k)}</span><span class="bar"><i class="${n >= Math.max(3, max) ? "hot" : ""}" style="width:${Math.round(n / max * 100)}%"></i></span><b>${n}</b></div>`).join("") : `<p class="note">No open jobs.</p>`}</div></div>
  </div>`;
  const log = S.meetings.length ? `<div class="card">${S.meetings.map(m => `<article class="meet"><div class="meet-head"><b>${esc(m.date ? parse(m.date).toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short", year: "numeric" }) : "No date")}</b><button class="btn ghost small" type="button" data-act="editmeet" data-id="${esc(m.id)}">Edit</button></div><dl>
    ${m.done ? `<div><dt>Done last week</dt><dd>${esc(m.done)}</dd></div>` : ""}
    ${m.next ? `<div><dt>Jobs for next week</dt><dd>${esc(m.next)}</dd></div>` : ""}
    ${m.decisions ? `<div><dt>Decisions</dt><dd>${esc(m.decisions)}${m.owner ? ` <span class="note">(owner: ${esc(m.owner)})</span>` : ""}</dd></div>` : ""}
    ${m.followUp ? `<div><dt>Follow-up / parked</dt><dd>${esc(m.followUp)}</dd></div>` : ""}</dl></article>`).join("")}</div>` : `<div class="card"><p class="empty">No meetings logged yet.</p></div>`;
  return `<section><p class="dayline">Weekly meeting</p><p class="sub">20 minutes, once a week. Here's this week's agenda, built from the jobs and the year plan.</p></section><section><h2 class="sec">Agenda</h2>${agenda}</section><section><h2 class="sec">Meeting log</h2>${log}</section>`;
}

/* ---------- bottom sheets ---------- */
let sheetCtx = null;
function openSheet(title, body, opt = {}) {
  const el = $("#sheet");
  el.innerHTML = `<div class="scrim" data-act="close"></div><form class="panel" id="sheetForm" role="dialog" aria-modal="true" aria-label="${esc(title)}" novalidate><header><h2>${esc(title)}</h2><button type="button" class="icon-btn" data-act="close" aria-label="Close">${ICON.close}</button></header><div class="body">${body}</div>${opt.save ? `<footer>${opt.del ? `<button type="button" class="btn ghost danger" data-act="sheetdel">Delete</button>` : ""}<button class="btn primary" type="submit">${esc(opt.saveLabel || "Save")}</button></footer>` : ""}</form>`;
  el.hidden = false; sheetCtx = opt;
  if (!opt.noFocus) { const f = el.querySelector(".body input:not([type=checkbox]),.body select,.body textarea"); if (f) setTimeout(() => f.focus(), 30); }
}
function closeSheet() { $("#sheet").hidden = true; $("#sheet").innerHTML = ""; sheetCtx = null; }
const fv = (fd, k) => String(fd.get(k) || "").trim();

function jobSheet(j) {
  const isNew = !j;
  j = j || { owner: me(), status: "Not started", priority: "Medium", due: iso(addDays(today(), 1)) };
  openSheet(isNew ? "New job" : "Edit job", `
    <div class="field"><label for="f-title">Job</label><input id="f-title" name="title" required maxlength="200" value="${esc(j.title)}" placeholder="e.g. Book relief milker for 7–8 Nov"></div>
    <div class="two"><div class="field"><label for="f-owner">Owner</label><select id="f-owner" name="owner">${ownerOptions(j.owner)}</select></div>
    <div class="field"><label for="f-due">Due</label><input id="f-due" name="due" type="date" value="${esc(j.due || "")}"></div></div>
    <div class="field"><label for="f-area">Area</label><select id="f-area" name="area">${areaOptions(j.area)}</select></div>
    <div class="two"><div class="field"><label for="f-pri">Priority</label><select id="f-pri" name="priority">${opts(["High","Medium","Low"], j.priority || "Medium")}</select></div>
    <div class="field"><label for="f-status">Status</label><select id="f-status" name="status">${opts(["Not started","In progress","Done"], j.status || "Not started")}</select></div></div>
    <div class="field"><label for="f-notes">Notes</label><textarea id="f-notes" name="notes" maxlength="2000">${esc(j.notes)}</textarea></div>
    ${changedLine(j)}`,
  { save: fd => {
      const title = fv(fd, "title"); if (!title) { toast("Give the job a name first."); return false; }
      const status = fv(fd, "status") || "Not started";
      const data = { title, owner: fv(fd, "owner"), due: fv(fd, "due"), area: fv(fd, "area"), priority: fv(fd, "priority") || "Medium", status, notes: fv(fd, "notes"),
        doneOn: status === "Done" ? (j.doneOn || iso(today())) : "", createdAt: j.createdAt || Date.now(), ...stamp() };
      const ref = isNew ? doc(collection(db, "jobs")) : doc(db, "jobs", j.id);
      return write(() => setDoc(ref, data), isNew ? "Job added" : "Job saved");
    },
    del: isNew ? null : () => write(() => deleteDoc(doc(db, "jobs", j.id)), "Job deleted"),
    saveLabel: isNew ? "Add job" : "Save" });
}

function meetSheet(m) {
  const isNew = !m; m = m || { date: iso(today()) };
  openSheet(isNew ? "Log this week's meeting" : "Edit meeting", `
    <div class="two"><div class="field"><label for="m-date">Date</label><input id="m-date" name="date" type="date" value="${esc(m.date)}"></div>
    <div class="field"><label for="m-owner">Decision owner</label><select id="m-owner" name="owner">${ownerOptions(m.owner)}</select></div></div>
    <div class="field"><label for="m-done">Done last week</label><textarea id="m-done" name="done" maxlength="4000">${esc(m.done)}</textarea></div>
    <div class="field"><label for="m-next">Jobs for next week</label><textarea id="m-next" name="next" maxlength="4000">${esc(m.next)}</textarea></div>
    <div class="field"><label for="m-dec">Decisions made</label><textarea id="m-dec" name="decisions" maxlength="4000">${esc(m.decisions)}</textarea></div>
    <div class="field"><label for="m-fu">Follow-up / parked</label><textarea id="m-fu" name="followUp" maxlength="4000">${esc(m.followUp)}</textarea></div>
    <p class="note">Add anything from "Jobs for next week" to the Jobs list too, with an owner and a due date.</p>${changedLine(m)}`,
  { save: fd => {
      const data = { date: fv(fd, "date") || iso(today()), owner: fv(fd, "owner"), done: fv(fd, "done"), next: fv(fd, "next"), decisions: fv(fd, "decisions"), followUp: fv(fd, "followUp"), ...stamp() };
      const ref = isNew ? doc(collection(db, "meetings")) : doc(db, "meetings", m.id);
      return write(() => setDoc(ref, data), "Meeting saved");
    },
    del: !isNew && isAdmin() ? () => write(() => deleteDoc(doc(db, "meetings", m.id)), "Meeting deleted") : null });
}

function calSheet(i) {
  const c = i != null ? S.cal[i] : { months: [S.month] };
  openSheet(i != null ? "Edit yearly job" : "Add yearly job", `
    <div class="field"><label for="c-task">Job</label><input id="c-task" name="task" maxlength="200" value="${esc(c.task)}" placeholder="e.g. Herd test (TB)"></div>
    <div class="two"><div class="field"><label for="c-area">Area</label><select id="c-area" name="area">${areaOptions(c.area)}</select></div>
    <div class="field"><label for="c-owner">Owner</label><select id="c-owner" name="owner">${ownerOptions(c.owner)}</select></div></div>
    <div class="field"><span class="lbl">Months</span><div class="monthpick">${MONTHS.map((m, k) => `<label><input type="checkbox" id="c-m${k + 1}" name="m" value="${k + 1}" ${(c.months || []).includes(k + 1) ? "checked" : ""}><span>${m}</span></label>`).join("")}</div></div>
    <div class="field"><label for="c-notes">Notes</label><input id="c-notes" name="notes" maxlength="300" value="${esc(c.notes)}"></div>${changedLine(S.calMeta)}`,
  { save: fd => {
      const task = fv(fd, "task"); if (!task) { toast("Give the job a name first."); return false; }
      const item = { task, area: fv(fd, "area"), owner: fv(fd, "owner"), months: fd.getAll("m").map(Number), notes: fv(fd, "notes") };
      const items = S.cal.map(x => Object.assign({}, x)); if (i != null) items[i] = item; else items.push(item);
      return write(() => setDoc(doc(db, "config", "calendar"), { items, ...stamp() }), "Year plan saved");
    },
    del: i != null ? () => write(() => setDoc(doc(db, "config", "calendar"), { items: S.cal.filter((_, k) => k !== i), ...stamp() }), "Removed from the year plan") : null });
}

function roleSheet(i) {
  const a = S.roles[i];
  openSheet(a.area, `
    <div class="two"><div class="field"><label for="r-owner">Owner</label><select id="r-owner" name="owner">${ownerOptions(a.owner)}</select></div>
    <div class="field"><label for="r-backup">Backup</label><select id="r-backup" name="backup">${ownerOptions(a.backup)}</select></div></div>
    <div class="field"><label for="r-dec">Owner decides alone</label><textarea id="r-dec" name="decides" maxlength="1000">${esc(a.decides)}</textarea></div>
    <div class="field"><label for="r-meet">Bring to weekly meeting</label><textarea id="r-meet" name="meeting" maxlength="1000">${esc(a.meeting)}</textarea></div>
    <div class="field"><label for="r-notes">Notes</label><input id="r-notes" name="notes" maxlength="300" value="${esc(a.notes)}"></div>`,
  { save: fd => {
      const areas = S.roles.map(x => Object.assign({}, x));
      areas[i] = Object.assign({}, a, { owner: fv(fd, "owner"), backup: fv(fd, "backup"), decides: fv(fd, "decides"), meeting: fv(fd, "meeting"), notes: fv(fd, "notes") });
      return write(() => setDoc(doc(db, "config", "roles"), { areas, ...stamp() }), "Saved");
    } });
}

function rotaWeek() { return iso(addDays(monday(today()), 7 * S.weekOff)); }
function cloneDuties(src) { return (src || []).map(x => { const days = (x.days || []).slice(0, 7); while (days.length < 7) days.push(""); return { duty: x.duty, notes: x.notes || "", days }; }); }
function cellSheet(k, di) {
  const wk = rotaWeek(), r = S.rota[wk], d = r.duties[k], cur = (d.days && d.days[di]) || "";
  const dd = addDays(parse(wk), di);
  const l = team(); if (cur && !l.includes(cur)) l.push(cur);
  openSheet(d.duty, `<p class="sub">${esc(dd.toLocaleDateString("en-IE", { weekday: "long", day: "numeric", month: "long" }))}</p>
    <div class="pick">${l.map(n => `<button type="button" data-act="pickcell" data-n="${esc(n)}" aria-pressed="${n === cur}">${tag(n, "sm")}<span>${esc(n)}</span></button>`).join("")}<button type="button" data-act="pickcell" data-n="" aria-pressed="${!cur}">${tag("", "sm")}<span>Nobody</span></button></div>
    <label class="check-line"><input type="checkbox" id="c-all"> <span>Same person every day this week</span></label>`,
  { noFocus: true, pick: n => {
      const all = $("#c-all") && $("#c-all").checked;
      const duties = cloneDuties(r.duties);
      if (all) duties[k].days = duties[k].days.map(() => n); else duties[k].days[di] = n;
      if (write(() => setDoc(doc(db, "rota", wk), { weekStart: wk, duties, ...stamp() }))) closeSheet();
    } });
}

function teamSheet() {
  const admin = isAdmin();
  const row = p => `<div class="row" style="padding-inline:0">${admin ? `<button class="rowbtn" type="button" data-act="editperson" data-id="${esc(p.id)}">` : `<div class="rowbtn">`}${tag(p.name, "lg")}<div class="row-main"><b>${esc(p.name)}</b><small>${esc([p.role, p.days].filter(Boolean).join(" · "))}</small>${p.phone ? `<small style="user-select:all"><a href="tel:${esc(p.phone.replace(/\s+/g, ""))}">${esc(p.phone)}</a></small>` : ""}</div>${admin ? "</button>" : "</div>"}</div>`;
  const tm = S.people.filter(p => p.kind !== "contact"), ct = S.people.filter(p => p.kind === "contact");
  openSheet("Team and contacts", `<h2 class="sec">Team</h2><div>${tm.map(row).join("") || `<p class="note">No one yet.</p>`}</div><h2 class="sec">Contacts</h2><div>${ct.map(row).join("") || `<p class="note">No contacts yet.</p>`}</div>${admin ? `<button class="btn ghost" type="button" data-act="newperson">Add a person or contact</button>` : ""}`, { noFocus: true });
}
function personSheet(p) {
  const isNew = !p; p = p || { kind: "team" };
  openSheet(isNew ? "Add a person" : "Edit " + p.name, `
    <div class="field"><label for="p-name">Name</label><input id="p-name" name="name" maxlength="60" value="${esc(p.name)}"></div>
    <div class="field"><label for="p-role">Role on the farm</label><input id="p-role" name="role" maxlength="120" value="${esc(p.role)}"></div>
    <div class="two"><div class="field"><label for="p-phone">Phone</label><input id="p-phone" name="phone" type="tel" maxlength="30" value="${esc(p.phone)}"></div>
    <div class="field"><label for="p-days">Usual days</label><input id="p-days" name="days" maxlength="120" value="${esc(p.days)}"></div></div>
    <div class="field"><label for="p-kind">Type</label><select id="p-kind" name="kind"><option value="team" ${p.kind !== "contact" ? "selected" : ""}>Team (can go on the rota)</option><option value="contact" ${p.kind === "contact" ? "selected" : ""}>Contact (vet, contractor…)</option></select></div>`,
  { save: fd => {
      const name = fv(fd, "name"); if (!name) { toast("Add a name first."); return false; }
      const data = { name, role: fv(fd, "role"), phone: fv(fd, "phone"), days: fv(fd, "days"), kind: fv(fd, "kind") === "contact" ? "contact" : "team", order: p.order ?? (S.people.length + 1), ...stamp() };
      return write(() => setDoc(isNew ? doc(collection(db, "people")) : doc(db, "people", p.id), data), "Saved");
    },
    del: isNew ? null : () => write(() => deleteDoc(doc(db, "people", p.id)), "Removed") });
}

function accountSheet() {
  const admin = isAdmin();
  openSheet("Your account", `
    <div class="row" style="padding-inline:0">${tag(me(), "lg")}<div class="row-main"><b>${esc(me() || "No name linked")}</b><small>${esc(myEmail())} · ${admin ? "Admin" : "Member"}</small></div></div>
    <div class="menu">
      <button class="btn ghost" type="button" data-act="install">Install on this phone <span aria-hidden="true">›</span></button>
      ${admin ? `<h2 class="sec" style="margin-top:8px">Admin</h2>
      <button class="btn ghost" type="button" data-act="members">Who can use the app <span aria-hidden="true">›</span></button>
      <button class="btn ghost" type="button" data-act="exportcsv">Download jobs as a spreadsheet (CSV) <span aria-hidden="true">›</span></button>
      <button class="btn ghost" type="button" data-act="exportjson">Download a full backup <span aria-hidden="true">›</span></button>
      <button class="btn ghost" type="button" data-act="import">Import farm data from a file <span aria-hidden="true">›</span></button>` : ""}
      <button class="btn ghost danger" type="button" data-act="signout">Sign out</button>
    </div>`, { noFocus: true });
}

function membersSheet() {
  const list = S.members.slice().sort((a, b) => String(a.person).localeCompare(b.person));
  openSheet("Who can use the app", `<p class="sub">Add someone's email address, then send them the link. They sign in with Google, or create an account with that same email.</p>
    <div class="card">${list.map(m => `<div class="row"><button class="rowbtn" type="button" data-act="editmember" data-id="${esc(m.id)}">${tag(m.person, "sm")}<div class="row-main"><b>${esc(m.person || "No name linked")}</b><small>${esc(m.id)} · ${m.role === "admin" ? "Admin" : "Member"}</small></div></button></div>`).join("")}</div>
    <button class="btn primary" type="button" data-act="newmember">Add someone</button>`, { noFocus: true });
}
function memberSheet(m) {
  const isNew = !m; m = m || { role: "member" };
  const self = !isNew && m.id === myEmail();
  openSheet(isNew ? "Add someone" : "Edit access", `
    <div class="field"><label for="u-email">Email address</label><input id="u-email" name="email" type="email" inputmode="email" value="${esc(m.id)}" ${isNew ? "" : "disabled"}></div>
    <div class="field"><label for="u-person">Which person on the farm is this?</label><select id="u-person" name="person">${ownerOptions(m.person)}</select></div>
    <div class="field"><label for="u-role">Access</label><select id="u-role" name="role" ${self ? "disabled" : ""}><option value="member" ${m.role !== "admin" ? "selected" : ""}>Member: jobs, rota and meetings</option><option value="admin" ${m.role === "admin" ? "selected" : ""}>Admin: also people, year plan and access</option></select></div>
    ${self ? `<p class="note">You can't remove your own admin access, so there's always someone who can manage the app.</p>` : ""}`,
  { save: fd => {
      const email = isNew ? fv(fd, "email").toLowerCase() : m.id;
      if (!/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(email)) { toast("That email address doesn't look right."); return false; }
      const data = { person: fv(fd, "person"), role: self ? "admin" : (fv(fd, "role") === "admin" ? "admin" : "member"), ...stamp() };
      return write(() => setDoc(doc(db, "members", email), data), isNew ? "Added. Send them the link." : "Saved");
    },
    del: isNew || self ? null : () => write(() => deleteDoc(doc(db, "members", m.id)), "Access removed") });
}

function installSheet() {
  let body;
  if (isStandalone()) body = `<p class="sub">You're already using the installed app. Nice.</p>`;
  else if (deferredPrompt) body = `<p class="sub">Install the farm app on this phone. It gets its own icon and works with no signal.</p><button class="btn primary" type="button" data-act="doinstall">Install</button>`;
  else if (isIOS()) body = `<ol class="steps"><li>Open this page in <b>Safari</b>.</li><li>Tap the <b>Share</b> button (the square with an arrow).</li><li>Scroll down and tap <b>Add to Home Screen</b>, then <b>Add</b>.</li><li>Open the <b>Farm</b> icon from your home screen and sign in there once.</li></ol>`;
  else body = `<ol class="steps"><li>Open the browser menu (⋮).</li><li>Tap <b>Install app</b> or <b>Add to Home screen</b>.</li><li>Open the <b>Farm</b> icon from your home screen.</li></ol>`;
  openSheet("Install on this phone", body, { noFocus: true });
}

/* ---------- export / import ---------- */
function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function exportCsv() {
  const cols = ["Job","Area","Owner","Due","Priority","Status","Done on","Notes","Last changed by"];
  const cell = v => { v = String(v == null ? "" : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const rows = S.jobs.slice().sort(byDue).map(j => [j.title, j.area, j.owner, j.due, j.priority, j.status, j.doneOn, j.notes, j.updatedBy ? nameFor(j.updatedBy) : ""].map(cell).join(","));
  download(`farm-jobs-${iso(today())}.csv`, "﻿" + [cols.join(","), ...rows].join("\r\n"), "text/csv;charset=utf-8");
}
function exportJson() {
  const strip = o => { const c = Object.assign({}, o); delete c.id; delete c._pending; delete c.updatedAt; delete c.updatedBy; return c; };
  const byId = arr => Object.fromEntries(arr.map(o => [o.id, strip(o)]));
  const data = { exportedAt: new Date().toISOString(), people: byId(S.people), jobs: byId(S.jobs), rota: byId(Object.values(S.rota)), meetings: byId(S.meetings),
    config: { calendar: { items: S.cal }, roles: { areas: S.roles } } };
  download(`farm-backup-${iso(today())}.json`, JSON.stringify(data, null, 2), "application/json");
}
async function importFile(file) {
  if (!S.online) return toast("You need signal to import a file.");
  let data;
  try { data = JSON.parse(await file.text()); } catch (e) { return toast("That file isn't a farm backup. Choose a .json file from Download a full backup."); }
  const writes = [];
  for (const col of ["people", "jobs", "rota", "meetings"]) for (const [id, d] of Object.entries(data[col] || {})) writes.push([doc(db, col, id), d]);
  if (data.config && data.config.calendar) writes.push([doc(db, "config", "calendar"), { items: data.config.calendar.items || [] }]);
  if (data.config && data.config.roles) writes.push([doc(db, "config", "roles"), { areas: data.config.roles.areas || [] }]);
  if (!writes.length) return toast("That file has no farm data in it.");
  // One record at a time, so each is checked by the security rules on its own
  // (and the report can say exactly which one was refused).
  closeSheet(); toast(`Importing ${writes.length} records…`);
  let done = 0;
  for (const [ref, d] of writes) {
    const c = Object.assign({}, d); delete c.updatedAt; delete c.updatedBy;
    try { await setDoc(ref, { ...c, ...stamp() }); done++; }
    catch (e) {
      console.error(ref.path, e);
      return toast(e.code === "permission-denied"
        ? `Import stopped at ${ref.path}: that record isn't in the expected format. ${done} records imported before it.`
        : `Import stopped after ${done} records. Check your signal and import the file again.`);
    }
  }
  toast(`Imported ${done} records.`);
}

/* ---------- events ---------- */
let deferredPrompt = null;
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); deferredPrompt = e; });
window.addEventListener("online", () => { S.online = true; render(); toast("Back online. Syncing your changes."); });
window.addEventListener("offline", () => { S.online = false; render(); });

let delArmed = null;
document.addEventListener("click", async e => {
  const b = e.target.closest("[data-act]"); if (!b) return;
  const a = b.dataset.act;
  switch (a) {
    case "go": S.tab = b.dataset.tab; store.set("tab", S.tab); closeSheet(); render(); scrollTo(0, 0); break;
    case "filter": S.jobFilter = b.dataset.f; S.tab = "jobs"; store.set("tab", "jobs"); render(); scrollTo(0, 0); break;
    case "month": S.month = +b.dataset.m; S.tab = "plan"; render(); break;
    case "week": S.weekOff += +b.dataset.d; S.rotaDay = null; render(); break;
    case "rday": S.rotaDay = +b.dataset.i; render(); break;
    case "toggle": { const j = S.jobs.find(x => x.id === b.dataset.id); if (!j) return; const done = !isDone(j);
      write(() => updateDoc(doc(db, "jobs", j.id), { status: done ? "Done" : "Not started", doneOn: done ? iso(today()) : "", ...stamp() }), done ? "Done: " + j.title : "Reopened"); break; }
    case "editjob": jobSheet(S.jobs.find(x => x.id === b.dataset.id)); break;
    case "newjob": jobSheet(); break;
    case "newmeet": meetSheet(); break;
    case "editmeet": meetSheet(S.meetings.find(x => x.id === b.dataset.id)); break;
    case "editcal": if (isAdmin()) calSheet(+b.dataset.i); break;
    case "newcal": if (isAdmin()) calSheet(null); break;
    case "editrole": if (isAdmin()) roleSheet(+b.dataset.i); break;
    case "cell": cellSheet(+b.dataset.k, +b.dataset.i); break;
    case "pickcell": if (sheetCtx && sheetCtx.pick) sheetCtx.pick(b.dataset.n); break;
    case "team": teamSheet(); break;
    case "newperson": personSheet(); break;
    case "editperson": personSheet(S.people.find(x => x.id === b.dataset.id)); break;
    case "account": accountSheet(); break;
    case "members": membersSheet(); break;
    case "newmember": memberSheet(); break;
    case "editmember": memberSheet(S.members.find(x => x.id === b.dataset.id)); break;
    case "install": installSheet(); break;
    case "doinstall": if (deferredPrompt) { deferredPrompt.prompt(); await deferredPrompt.userChoice.catch(() => {}); deferredPrompt = null; closeSheet(); } break;
    case "dismissinstall": store.set("installDismissed", "1"); render(); break;
    case "exportcsv": exportCsv(); break;
    case "exportjson": exportJson(); break;
    case "import": $("#importFile").click(); break;
    case "close": closeSheet(); break;
    case "copyweek": { const src = S.rota[b.dataset.from], wk = rotaWeek();
      write(() => setDoc(doc(db, "rota", wk), { weekStart: wk, duties: cloneDuties(src.duties), ...stamp() }), "Rota copied. Make any changes for this week."); break; }
    case "blankweek": { const wk = rotaWeek();
      write(() => setDoc(doc(db, "rota", wk), { weekStart: wk, duties: DUTIES.map(d => ({ duty: d, notes: "", days: ["","","","","","",""] })), ...stamp() }), "Blank rota started"); break; }
    case "sheetdel":
      if (delArmed !== b) { delArmed = b; b.textContent = "Tap again to delete"; setTimeout(() => { if (delArmed === b) { delArmed = null; b.textContent = "Delete"; } }, 3000); break; }
      delArmed = null; if (sheetCtx && sheetCtx.del && sheetCtx.del()) closeSheet(); break;
    // auth
    case "google": googleSignIn(); break;
    case "authmode": S.authMode = b.dataset.m; S.authError = ""; render(); break;
    case "reset": { const email = ($("#a-email") || {}).value; if (!email) { S.authError = "Type your email address above first, then tap Forgot your password."; return render(); }
      try { await sendPasswordResetEmail(auth, email.trim()); S.authError = ""; render(); toast("Check your email for a link to set a new password."); } catch (err) { authError(err); } break; }
    case "verified": try { await auth.currentUser.reload(); if (auth.currentUser.emailVerified) { await auth.currentUser.getIdToken(true); S.authError = ""; handleUser(auth.currentUser); } else { S.authError = "Not confirmed yet. Tap the link in the email first."; render(); } } catch (err) { authError(err); } break;
    case "resend": try { await sendEmailVerification(auth.currentUser); toast("Sent. Check your inbox and spam folder."); } catch (err) { authError(err); } break;
    case "copyemail": try { await navigator.clipboard.writeText(S.user.email); toast("Copied"); } catch (err) { toast(S.user.email); } break;
    case "signout": closeSheet(); stopData(); await signOut(auth); break;
  }
});
document.addEventListener("submit", async e => {
  e.preventDefault();
  if (e.target.id === "sheetForm") { if (sheetCtx && sheetCtx.save && sheetCtx.save(new FormData(e.target))) closeSheet(); return; }
  if (e.target.id === "authForm") {
    const fd = new FormData(e.target), email = fv(fd, "email"), pass = String(fd.get("password") || "");
    S.authError = "";
    try {
      if (S.authMode === "create") { const cred = await createUserWithEmailAndPassword(auth, email, pass); await sendEmailVerification(cred.user); }
      else await signInWithEmailAndPassword(auth, email, pass);
    } catch (err) { authError(err); }
  }
});
document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("#sheet").hidden) closeSheet(); });
$("#importFile").addEventListener("change", e => { const f = e.target.files[0]; e.target.value = ""; if (f) importFile(f); });
let lastDay = iso(today());
document.addEventListener("visibilitychange", () => { if (!document.hidden && iso(today()) !== lastDay) { lastDay = iso(today()); render(); } });

/* ---------- start ---------- */
if (!configured) render();
else {
  getRedirectResult(auth).catch(authError);
  onAuthStateChanged(auth, u => handleUser(u));
}
