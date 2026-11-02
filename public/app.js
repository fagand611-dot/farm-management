import {
  configured, auth, db,
  onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, sendEmailVerification, sendPasswordResetEmail, signOut,
  collection, doc, onSnapshot, setDoc, updateDoc, deleteDoc, writeBatch, serverTimestamp,
} from "./firebase.js";
import { readXlsx, excelDate } from "./xlsx.js";

/* ---------- constants ---------- */
const DEFAULT_AREAS = ["Milking – parlour","Robot unit","Herd health","Breeding & AI","Calves & youngstock","Grass & grazing","Silage & feed","Slurry & fertiliser","Housing & yards","Machinery & repairs","Staff & rota","Finances & paperwork","Contractors & suppliers"];
const DUTIES = ["Parlour – AM milking","Parlour – PM milking","Robot – checks & wires","Calf feeding","Day jobs 1","Day jobs 2","Off 1","Off 2"];
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const MONTHS_LONG = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DAYS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
const TABS = ["today","jobs","rota","map","farm"];
const FARM_TABS = [["calendar","Calendar"],["guide","How-to"],["year","Year plan"],["meeting","Meeting"],["rules","Rules & dates"]];
const JOB_STATUSES = ["Not started","In progress","Awaiting review","Done"];
const ROUTINE_OFTEN = ["Daily","Twice daily","Each collection"];
const PLANNED_OFTEN = ["Yearly","Every few months","Every few years"];
const SLOTS = ["Morning","Daytime","Evening","Night"];
const HERDS = ["Robot herd","Parlour herd","Whole herd","Heifers","Dry cows","Calves"];
// Season switches. Each one controls the knowledge-base jobs with these conditions.
const SEASONS = [
  ["inMilk", "Cows in milk", ["while cows are in milk"]],
  ["housed", "Cows housed", ["while cows are housed"]],
  ["atGrass", "Out at grass", ["while cows are out at grass", "while stock are out"]],
  ["calving", "Calving season", ["during calving season"]],
  ["breeding", "Breeding season", ["during breeding season"]],
  ["calvesOnMilk", "Calves on milk", ["while calves are on milk"]],
];
const ICON = {
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  left: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
  right: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  minus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M5 12h14"/></svg>',
  warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l10 18H2L12 3z"/><path d="M12 10v5M12 18v.5"/></svg>',
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
const longDate = s => parse(s).toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short" });
const byDue = (a, b) => (a.due || "9999").localeCompare(b.due || "9999") || String(a.title).localeCompare(String(b.title));
const initials = n => { n = String(n || "").trim(); if (!n) return ""; const p = n.split(/\s+/); return (p.length > 1 ? p[0][0] + p[1][0] : n.slice(0, 2)).toUpperCase(); };
const tag = (n, cls = "") => n ? `<span class="tag ${cls}" title="${esc(n)}">${esc(initials(n))}</span>` : `<span class="tag empty-tag ${cls}">–</span>`;
const person = (n, cls = "") => `<span class="person">${tag(n, cls)}<span>${esc(n || "Nobody")}</span></span>`;
const isDone = j => j.status === "Done";
const isOpen = j => j.status !== "Done" && j.status !== "Awaiting review";
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "x";
const uid = () => Math.random().toString(36).slice(2, 10);
const store = { get(k){ try { return localStorage.getItem(k); } catch(e){ return null; } }, set(k, v){ try { localStorage.setItem(k, v); } catch(e){} } };
const isStandalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

/* ---------- state ---------- */
const S = {
  phase: "boot", user: null, member: null, members: [],
  people: [], jobs: [], rota: {}, cal: [], calMeta: null, roles: [], meetings: [],
  kb: [], kbRules: [], contacts: [], areasCfg: null, events: [], maps: [], allocations: [], reports: [], routine: {}, farmState: {},
  tab: "today", farmTab: "calendar", jobFilter: "open", month: new Date().getMonth() + 1, weekOff: 0, rotaDay: null,
  mapId: null, mapZoom: 1, mapEdit: null, selSection: null, guideQuery: "", guideArea: "",
  online: navigator.onLine, authMode: "signin", authError: "",
};
{
  const h = location.hash.slice(1), t = store.get("tab");
  if (h === "plan") { S.tab = "farm"; S.farmTab = "year"; }
  else if (h === "meetings") { S.tab = "farm"; S.farmTab = "meeting"; }
  else if (TABS.includes(h)) S.tab = h;
  else if (TABS.includes(t)) S.tab = t;
  const ft = store.get("farmTab"); if (FARM_TABS.some(f => f[0] === ft)) S.farmTab = ft;
}
const me = () => S.member ? S.member.person : "";
const isAdmin = () => !!(S.member && S.member.role === "admin");
const myEmail = () => (S.user && S.user.email ? S.user.email.toLowerCase() : "");
const nameFor = email => { const m = S.members.find(x => x.id === email); return m ? m.person || email : email; };
const stamp = () => ({ updatedBy: myEmail(), updatedAt: serverTimestamp() });
const canWorkJob = j => isAdmin() || (!!me() && j.owner === me());
const areaNames = () => (S.areasCfg && S.areasCfg.length ? S.areasCfg.map(a => a.name) : DEFAULT_AREAS);
const kbById = id => S.kb.find(k => k.id === id);
const areaOwner = area => { const r = S.roles.find(a => a.area === area); return r ? r.owner || "" : ""; };

function dueLabel(j) {
  if (j.status === "Awaiting review") return "Waiting for review";
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
function areaOptions(cur) { const l = areaNames().slice(); if (cur && !l.includes(cur)) l.push(cur); return `<option value="">No area</option>` + l.map(n => `<option ${n === cur ? "selected" : ""}>${esc(n)}</option>`).join(""); }
const opts = (l, cur) => l.map(n => `<option ${n === cur ? "selected" : ""}>${esc(n)}</option>`).join("");
function kbOptions(cur) { return `<option value="">None</option>` + S.kb.map(k => `<option value="${esc(k.id)}" ${k.id === cur ? "selected" : ""}>${esc(k.id)} · ${esc(k.title)}</option>`).join(""); }

/* ---------- knowledge base helpers ---------- */
function monthsText(months) {
  const m = (months || []).slice().sort((a, b) => a - b), n = m.length;
  if (n === 12) return "all year";
  if (n === 0) return "months not set";
  if (n >= 8) return "all year except " + MONTHS.filter((_, i) => !m.includes(i + 1)).join(", ");
  return m.map(x => MONTHS[x - 1]).join(", ");
}
function scheduleText(k) {
  return [k.often + (k.time ? ` (${k.time.toLowerCase()})` : ""), monthsText(k.months), k.condition].filter(Boolean).join(", ");
}
function seasonFor(condition) {
  const c = String(condition || "").toLowerCase();
  return SEASONS.find(s => s[2].includes(c));
}
// A knowledge-base job applies today if its month is ticked, unless a season switch overrides it.
function kbAppliesToday(k) {
  const monthOk = (k.months || []).includes(new Date().getMonth() + 1);
  const s = seasonFor(k.condition);
  if (!s) return monthOk;
  const v = S.farmState[s[0]];
  return v === true ? true : v === false ? false : monthOk;
}
// Which knowledge-base routine jobs belong to a rota duty today.
function routineFor(dutyName) {
  const dn = dutyName.toLowerCase();
  const slot = /\bam\b/.test(dn) ? "am" : /\bpm\b/.test(dn) ? "pm" : "";
  return S.kb.filter(k => {
    if (!ROUTINE_OFTEN.includes(k.often) || !k.duty || !kbAppliesToday(k)) return false;
    const g = k.duty.toLowerCase();
    let match = g === dn;
    if (!match && g === "parlour milking") match = dn.includes("parlour");
    if (!match && g === "day jobs") match = dn.startsWith("day jobs");
    if (!match && g.startsWith("robot")) match = dn.includes("robot");
    if (!match && g === "calf feeding") match = dn.includes("calf");
    if (!match) return false;
    if (slot === "am") return ["Morning", "Morning & evening", "Any time", ""].includes(k.time || "");
    if (slot === "pm") return ["Evening", "Morning & evening"].includes(k.time || "");
    return true;
  });
}
function myDutiesToday() {
  const t = today(), r = S.rota[iso(monday(t))], di = dayIdx(t);
  if (!r || !me()) return [];
  return (r.duties || []).filter(d => d.days && d.days[di] === me() && !/^off/i.test(d.duty)).map(d => d.duty);
}
function ruleAlerts() {
  const t = iso(today()), soon = iso(addDays(today(), 21)), out = [];
  for (const r of S.kbRules) {
    if (!r.start) continue;
    const ended = r.end && r.end < t;
    if (ended) continue;
    if (r.start <= t) {
      const recent = r.end || iso(addDays(parse(r.start), 120));
      if (recent >= t) out.push({ r, text: `${r.topic}: in force${r.end ? " until " + short(r.end) : " since " + short(r.start)}`, level: "on" });
    } else if (r.start <= soon) {
      const days = Math.round((parse(r.start) - today()) / 864e5);
      out.push({ r, text: `${r.topic} starts ${days === 1 ? "tomorrow" : "in " + days + " days"} (${short(r.start)})`, level: "soon" });
    }
  }
  return out;
}

/* ---------- writes ---------- */
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
    if (isStandalone() || isIOS()) await signInWithRedirect(auth, p);
    else await signInWithPopup(auth, p);
  } catch (e) { authError(e); }
}

let unsubs = [];
let memberUnsub = null;
function stopDataOnly() { unsubs.forEach(u => u()); unsubs = []; }
function stopData() { stopDataOnly(); if (memberUnsub) { memberUnsub(); memberUnsub = null; } }

async function handleUser(u) {
  stopData();
  S.user = u; S.member = null;
  if (!u) { S.phase = "signin"; return render(); }
  if (!u.emailVerified) { S.phase = "verify"; return render(); }
  S.phase = "boot"; render();
  memberUnsub = onSnapshot(doc(db, "members", myEmail()), { includeMetadataChanges: true }, snap => {
    if (!snap.exists()) {
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

function startData() {
  stopDataOnly();
  const meta = { includeMetadataChanges: true };
  const rows = s => s.docs.map(d => Object.assign({ id: d.id, _pending: d.metadata.hasPendingWrites }, d.data({ serverTimestamps: "estimate" })));
  const fail = e => { console.error(e); if (e.code === "permission-denied") return; toast("Couldn't load some of the farm data. Reopen the app to retry."); };
  const ord = (a, b) => (a.order ?? 999) - (b.order ?? 999);
  const watch = (path, fn) => unsubs.push(onSnapshot(collection(db, path), meta, s => { fn(rows(s)); render(); }, fail));
  const watchDoc = (a, b, fn) => unsubs.push(onSnapshot(doc(db, a, b), meta, s => { fn(s.exists() ? s.data({ serverTimestamps: "estimate" }) : null); render(); }, fail));
  watch("members", r => S.members = r);
  watch("people", r => S.people = r.sort((a, b) => ord(a, b) || String(a.name).localeCompare(b.name)));
  watch("jobs", r => S.jobs = r);
  watch("rota", r => { const o = {}; r.forEach(d => o[d.id] = d); S.rota = o; });
  watch("meetings", r => S.meetings = r.sort((a, b) => String(b.date).localeCompare(a.date)));
  watch("kb", r => S.kb = r.sort((a, b) => ord(a, b) || a.id.localeCompare(b.id)));
  watch("kbRules", r => S.kbRules = r.sort(ord));
  watch("contacts", r => S.contacts = r.sort(ord));
  watch("events", r => S.events = r.sort((a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || ""))));
  watch("maps", r => { S.maps = r.sort(ord); });
  watch("allocations", r => S.allocations = r.sort((a, b) => (a.date + SLOTS.indexOf(a.slot)).localeCompare(b.date + SLOTS.indexOf(b.slot))));
  watch("reports", r => S.reports = r.sort((a, b) => String(b.date).localeCompare(a.date)));
  watch("routine", r => { const o = {}; r.forEach(d => o[d.id] = d); S.routine = o; });
  watchDoc("config", "calendar", d => { S.cal = d ? d.items || [] : []; S.calMeta = d; });
  watchDoc("config", "roles", d => { S.roles = d ? d.areas || [] : []; });
  watchDoc("config", "areas", d => { S.areasCfg = d ? d.list || [] : null; });
  watchDoc("config", "farmState", d => { S.farmState = d || {}; });
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

/* ---------- main render ---------- */
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
  const over = S.jobs.filter(j => isOpen(j) && j.due && j.due < iso(today())).length;
  const dot = $("#overDot"); dot.hidden = !over; dot.textContent = over;
  const pendingCount = [S.jobs, S.meetings, Object.values(S.rota), S.allocations, Object.values(S.routine)].reduce((n, l) => n + l.filter(x => x._pending).length, 0);
  $("#netline").textContent = !S.online ? "Offline" + (pendingCount ? ` · ${pendingCount} change${pendingCount > 1 ? "s" : ""} waiting to sync` : "") : pendingCount ? "Syncing…" : "190 parlour · 60 robot";
  // Keep scroll position and focus when live updates re-render the screen.
  const y = window.scrollY, ae = document.activeElement;
  const fid = ae && ae.id && v.contains(ae) ? ae.id : null;
  const sel = fid && typeof ae.selectionStart === "number" ? [ae.selectionStart, ae.selectionEnd] : null;
  v.innerHTML = ({ today: vToday, jobs: vJobs, rota: vRota, map: vMap, farm: vFarm })[S.tab]();
  window.scrollTo(0, y);
  if (fid) { const el = document.getElementById(fid); if (el) { el.focus(); if (sel && el.setSelectionRange) try { el.setSelectionRange(sel[0], sel[1]); } catch (e) {} } }
  let fabAct = null, fabLabel = "";
  if (isAdmin() && (S.tab === "today" || S.tab === "jobs")) { fabAct = "newjob"; fabLabel = "New job"; }
  else if (S.tab === "farm" && S.farmTab === "meeting") { fabAct = "newmeet"; fabLabel = "Log meeting"; }
  else if (isAdmin() && S.tab === "farm" && S.farmTab === "calendar") { fabAct = "newevent"; fabLabel = "Add to calendar"; }
  else if (S.tab === "today") { fabAct = "report"; fabLabel = "Report a problem"; }
  fab.hidden = !fabAct;
  if (fabAct) { fab.dataset.act = fabAct; $("#fabLabel").textContent = fabLabel; }
}

/* ---------- jobs ---------- */
function jobRow(j) {
  const t = iso(today()), done = isDone(j), waiting = j.status === "Awaiting review", over = isOpen(j) && j.due && j.due < t;
  const pills = [];
  if (isOpen(j) && j.priority === "High") pills.push(`<span class="pill high">High</span>`);
  if (isOpen(j) && j.status === "In progress") pills.push(`<span class="pill prog">In progress</span>`);
  if (waiting) pills.push(`<span class="pill prog">Awaiting review</span>`);
  if (isOpen(j) && j.needsReview) pills.push(`<span class="pill">Review when done</span>`);
  if (isOpen(j) && j.reviewNote) pills.push(`<span class="pill high">Sent back</span>`);
  if (j._pending) pills.push(`<span class="pill sync">Not synced yet</span>`);
  const can = canWorkJob(j);
  return `<li class="job ${over ? "is-over" : ""} ${done || waiting ? "is-done" : ""}">
    <button class="check ${waiting ? "half" : ""}" type="button" data-act="toggle" data-id="${esc(j.id)}" aria-label="${done || waiting ? "Mark not done" : "Mark done"}: ${esc(j.title)}" ${can ? "" : "disabled"}>${ICON.check}</button>
    <button class="job-main" type="button" data-act="editjob" data-id="${esc(j.id)}"><span class="job-title">${esc(j.title)}</span><span class="job-meta">${j.area ? `<span>${esc(j.area)}</span>` : ""}${pills.join("")}</span></button>
    <span class="job-side">${tag(j.owner, "sm")}<span class="due">${esc(dueLabel(j))}</span></span>
  </li>`;
}
const jobList = (arr, empty) => arr.length ? `<ul class="jobs card">${arr.map(jobRow).join("")}</ul>` : `<div class="card"><p class="empty">${empty}</p></div>`;

/* ---------- Today ---------- */
function vToday() {
  const t = today(), ti = iso(t), wk = iso(monday(t)), di = dayIdx(t), r = S.rota[wk], admin = isAdmin();
  const open = S.jobs.filter(isOpen);
  const overdue = open.filter(j => j.due && j.due < ti).sort(byDue);
  const soon = open.filter(j => j.due && j.due >= ti && j.due <= iso(addDays(t, 7))).sort(byDue);
  const waiting = S.jobs.filter(j => j.status === "Awaiting review");
  const doneWk = S.jobs.filter(j => isDone(j) && j.doneOn && j.doneOn >= wk).length;
  const mine = me() ? open.filter(j => j.owner === me()).sort(byDue) : [];
  const myDuties = myDutiesToday();
  const s = [];
  if (!isStandalone() && store.get("installDismissed") !== "1")
    s.push(`<div class="banner"><p><b>Put the farm on your home screen.</b> It opens like an app and works with no signal.</p><button class="btn primary small" type="button" data-act="install">How</button><button class="x" type="button" data-act="dismissinstall" aria-label="Hide">×</button></div>`);
  const seasonsOn = SEASONS.filter(x => S.farmState[x[0]] === true).map(x => x[1]);
  s.push(`<section><p class="dayline">${esc(t.toLocaleDateString("en-IE", { weekday: "long", day: "numeric", month: "long" }))}</p><p class="sub">${me() ? (myDuties.length ? `You're on: ${esc(myDuties.join(", "))}.` : "You're not on the rota today.") : "Your login isn't linked to a name yet. Ask an admin to link it."}${seasonsOn.length ? ` <span class="season-line">${esc(seasonsOn.join(" · "))}</span>` : ""}</p></section>`);
  for (const a of ruleAlerts()) s.push(`<button class="alert ${a.level}" type="button" data-act="farmtab" data-f="rules">${ICON.warn}<span>${esc(a.text)}</span></button>`);
  s.push(`<section class="stats" aria-label="Jobs at a glance">
    <button class="stat" type="button" data-act="filter" data-f="open"><b>${open.length}</b><span>Open jobs</span></button>
    <button class="stat ${overdue.length ? "alert-stat" : ""}" type="button" data-act="filter" data-f="overdue"><b>${overdue.length}</b><span>Overdue</span></button>
    <button class="stat" type="button" data-act="filter" data-f="week"><b>${soon.length}</b><span>Due in 7 days</span></button>
    ${admin ? `<button class="stat ${waiting.length ? "warn-stat" : ""}" type="button" data-act="filter" data-f="review"><b>${waiting.length}</b><span>To review</span></button>` : `<button class="stat" type="button" data-act="filter" data-f="done"><b>${doneWk}</b><span>Done this week</span></button>`}</section>`);

  // Grazing instructions for today and tomorrow
  const graze = S.allocations.filter(a => a.date === ti || a.date === iso(addDays(t, 1)));
  if (graze.length) s.push(`<section><div class="sec-head"><h2 class="sec">Grazing</h2><button class="link" type="button" data-act="go" data-tab="map">Map</button></div><div class="card">${graze.map(allocRow).join("")}</div></section>`);

  // Your routine
  if (myDuties.length) s.push(`<section><h2 class="sec">Your routine today</h2>${myDuties.map(d => dutyCard(d, ti)).join("")}</section>`);

  // Calendar events
  const todayEv = S.events.filter(e => e.date === ti);
  const mineSoon = me() ? S.events.filter(e => e.date > ti && e.date <= iso(addDays(t, 14)) && (e.people || []).includes(me())) : [];
  if (todayEv.length) s.push(`<section><h2 class="sec">On the calendar today</h2><div class="card">${todayEv.map(eventRow).join("")}</div></section>`);
  if (mineSoon.length) s.push(`<section><h2 class="sec">Coming up for you</h2><div class="card">${mineSoon.map(eventRow).join("")}</div></section>`);

  if (admin && waiting.length) s.push(`<section><h2 class="sec">To review</h2>${jobList(waiting)}</section>`);
  const openReports = S.reports.filter(x => x.status === "Open");
  if (admin && openReports.length) s.push(`<section><h2 class="sec">Problems reported</h2><div class="card">${openReports.map(reportRow).join("")}</div></section>`);

  let rota;
  if (r) {
    const rows = (r.duties || []).filter(d => d.days && d.days[di]);
    rota = rows.length ? `<ul class="duties card">${rows.map(d => `<li class="${d.days[di] === me() ? "me" : ""}"><span class="dname">${esc(d.duty)}${S.routine[ti + "_" + slug(d.duty)] ? ` <span class="pill">Done</span>` : ""}</span>${person(d.days[di])}</li>`).join("")}</ul>`
      : `<div class="card"><p class="empty">Nobody is on the rota for today. <button class="link" type="button" data-act="go" data-tab="rota">Fill in today</button></p></div>`;
  } else rota = `<div class="card"><p class="empty">There's no rota for this week yet. <button class="link" type="button" data-act="go" data-tab="rota">Set up this week</button></p></div>`;
  s.push(`<section><div class="sec-head"><h2 class="sec">On today</h2><button class="link" type="button" data-act="go" data-tab="rota">Full rota</button></div>${rota}</section>`);
  if (overdue.length) s.push(`<section><h2 class="sec">Overdue</h2>${jobList(overdue)}</section>`);
  if (me()) s.push(`<section><h2 class="sec">Your open jobs</h2>${jobList(mine, "Nothing on your list. Nice.")}</section>`);
  s.push(`<section><h2 class="sec">Due in the next 7 days</h2>${jobList(soon, "Nothing due this week.")}</section>`);
  const nm = (t.getMonth() + 1) % 12 + 1, next = yearItems(nm);
  if (next.length) s.push(`<section><div class="sec-head"><h2 class="sec">Coming up in ${MONTHS_LONG[nm - 1]}</h2><button class="link" type="button" data-act="month" data-m="${nm}">Year plan</button></div><div class="card">${next.map(yearRow).join("")}</div></section>`);
  return s.join("");
}

function dutyCard(duty, date) {
  const jobs = routineFor(duty), rec = S.routine[date + "_" + slug(duty)];
  const list = jobs.length ? `<ul class="routine">${jobs.map(k => `<li><button class="link-row" type="button" data-act="guide" data-id="${esc(k.id)}"><span>${esc(k.title)}</span><small>${esc([k.time, k.condition].filter(Boolean).join(" · "))}</small></button></li>`).join("")}</ul>`
    : `<p class="note pad">No checklist for this duty yet. It comes from the knowledge base (the Rota duty column).</p>`;
  const doneLine = rec ? `<span class="pill">Done${rec.person ? " by " + esc(rec.person) : ""}${rec.updatedAt && rec.updatedAt.toDate ? " · " + esc(rec.updatedAt.toDate().toLocaleTimeString("en-IE", { hour: "2-digit", minute: "2-digit" })) : ""}</span>` : "";
  return `<div class="card duty-card ${rec ? "is-complete" : ""}"><div class="duty-head"><b>${esc(duty)}</b>${doneLine}</div>${list}
    <div class="btn-row">${rec ? `<button class="btn ghost small" type="button" data-act="routineundo" data-duty="${esc(duty)}">Undo</button>` : `<button class="btn primary small" type="button" data-act="routinedone" data-duty="${esc(duty)}">Mark ${esc(duty)} done</button>`}<button class="btn ghost small" type="button" data-act="report" data-duty="${esc(duty)}">Report a problem</button></div></div>`;
}

function reportRow(x) {
  return `<div class="row"><div class="row-main"><b>${esc(x.text)}</b><small>${esc([x.person, x.area, x.duty, x.date ? short(x.date) : ""].filter(Boolean).join(" · "))}</small></div>
  <span class="owners"><button class="btn primary small" type="button" data-act="reportjob" data-id="${esc(x.id)}">Make a job</button><button class="btn ghost small" type="button" data-act="reportclose" data-id="${esc(x.id)}">Close</button></span></div>`;
}

function vJobs() {
  const t = today(), ti = iso(t), in7 = iso(addDays(t, 7));
  const F = {
    open: { l: "Open", f: isOpen },
    mine: { l: "Mine", f: j => !isDone(j) && me() && j.owner === me() },
    overdue: { l: "Overdue", f: j => isOpen(j) && j.due && j.due < ti },
    week: { l: "Next 7 days", f: j => isOpen(j) && j.due && j.due >= ti && j.due <= in7 },
    review: { l: "To review", f: j => j.status === "Awaiting review" },
    done: { l: "Done", f: isDone },
  };
  const cur = F[S.jobFilter] || F.open;
  let arr = S.jobs.filter(cur.f);
  arr = S.jobFilter === "done" ? arr.sort((a, b) => String(b.doneOn || "").localeCompare(a.doneOn || "")).slice(0, 60) : arr.sort(byDue);
  const chips = Object.entries(F).map(([k, o]) => `<button class="chip" type="button" data-act="filter" data-f="${k}" aria-pressed="${k === S.jobFilter}">${o.l}<span class="n">${S.jobs.filter(o.f).length}</span></button>`).join("");
  const empty = { open: isAdmin() ? "No open jobs. Add one with New job." : "No open jobs.", mine: "You've no open jobs.", overdue: "Nothing overdue.", week: "Nothing due in the next 7 days.", review: "Nothing waiting for review.", done: "No finished jobs yet." }[S.jobFilter];
  let body;
  if (S.jobFilter === "open" && arr.length) {
    const groups = {}; arr.forEach(j => { const k = j.owner || "Unassigned"; (groups[k] = groups[k] || []).push(j); });
    const order = Object.keys(groups).sort((a, b) => (a === "Unassigned") - (b === "Unassigned") || names().indexOf(a) - names().indexOf(b));
    body = order.map(k => `<section><div class="sec-head"><h2 class="sec">${esc(k)}</h2><span class="due">${groups[k].length} open</span></div>${jobList(groups[k])}</section>`).join("");
  } else body = jobList(arr, empty);
  const note = isAdmin() ? "" : `<p class="note">You can tick off and update your own jobs. To add a job, use Report a problem on the Today screen.</p>`;
  return `<section><div class="chips" role="group" aria-label="Filter jobs">${chips}</div>${note}</section>${body}`;
}

/* ---------- Rota ---------- */
function vRota() {
  const t = today(), wkD = addDays(monday(t), 7 * S.weekOff), wk = iso(wkD), r = S.rota[wk], isThis = S.weekOff === 0;
  let di = S.rotaDay; if (di == null) di = isThis ? dayIdx(t) : 0;
  const label = isThis ? "This week" : S.weekOff === 1 ? "Next week" : S.weekOff === -1 ? "Last week" : (S.weekOff > 0 ? "In " + S.weekOff + " weeks" : -S.weekOff + " weeks ago");
  const nav = `<section class="weeknav"><button class="icon-btn" type="button" data-act="week" data-d="-1" aria-label="Previous week">${ICON.left}</button><strong>${label}<small>Week starting Monday ${esc(wkD.toLocaleDateString("en-IE", { day: "numeric", month: "long" }))}</small></strong><button class="icon-btn" type="button" data-act="week" data-d="1" aria-label="Next week">${ICON.right}</button></section>`;
  if (!r) {
    const prev = Object.keys(S.rota).filter(k => k < wk).sort().pop();
    return nav + `<section class="card"><p class="empty">No rota for this week yet. The rota gets updated every Sunday evening.</p><div class="btn-row">${prev ? `<button class="btn primary small" type="button" data-act="copyweek" data-from="${prev}">Copy the week of ${esc(short(prev))}</button>` : ""}<button class="btn ghost small" type="button" data-act="blankweek">Start blank</button></div></section>`;
  }
  const chips = DAYS.map((d, i) => { const dd = addDays(wkD, i); const hasEv = S.events.some(e => e.date === iso(dd)); return `<button class="chip daychip ${isThis && i === dayIdx(t) ? "today" : ""}" type="button" data-act="rday" data-i="${i}" aria-pressed="${i === di}">${d}<small>${dd.getDate()}${hasEv ? " •" : ""}</small></button>`; }).join("");
  const dayIso = iso(addDays(wkD, di)), dayEv = S.events.filter(e => e.date === dayIso);
  const duties = r.duties || [];
  const list = `<ul class="duties card">${duties.map((d, k) => { const n = d.days && d.days[di]; return `<li class="${n && n === me() ? "me" : ""}"><button class="duty-btn" type="button" data-act="cell" data-k="${k}" data-i="${di}" aria-label="Change who covers ${esc(d.duty)} on ${DAYS[di]}"><span class="dname">${esc(d.duty)}${d.notes ? `<small>${esc(d.notes)}</small>` : ""}</span>${person(n)}</button></li>`; }).join("")}</ul>`;
  const ti = isThis ? dayIdx(t) : -1;
  const grid = `<div class="grid-wrap card"><table class="week"><thead><tr><th scope="col">Duty</th>${DAYS.map((d, i) => `<th scope="col" class="${i === ti ? "today" : ""}">${d}</th>`).join("")}</tr></thead><tbody>${duties.map(d => `<tr><td>${esc(d.duty)}</td>${DAYS.map((_, i) => `<td class="${i === ti ? "today" : ""}">${d.days && d.days[i] ? tag(d.days[i], "sm") : ""}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  return nav + `<section><div class="chips" role="group" aria-label="Day">${chips}</div></section>${dayEv.length ? `<section><h2 class="sec">On the calendar</h2><div class="card">${dayEv.map(eventRow).join("")}</div></section>` : ""}<section>${list}<p class="note">Tap a duty to change who covers it.${r._pending ? " <b>Not synced yet.</b>" : ""}</p>${changedLine(r)}</section><section><h2 class="sec">Whole week</h2>${grid}</section>`;
}

/* ---------- Map and grazing ---------- */
function whenLabel(a) {
  const t = iso(today()), tm = iso(addDays(today(), 1));
  const slot = a.slot || "Daytime";
  if (a.date === t) return { Morning: "This morning", Daytime: "Today", Evening: "This evening", Night: "Tonight" }[slot] || "Today";
  if (a.date === tm) return { Morning: "Tomorrow morning", Daytime: "Tomorrow", Evening: "Tomorrow evening", Night: "Tomorrow night" }[slot] || "Tomorrow";
  return longDate(a.date) + ", " + slot.toLowerCase();
}
function allocRow(a) {
  return `<div class="row alloc ${a.done ? "is-done" : ""}">
    <button class="check" type="button" data-act="allocdone" data-id="${esc(a.id)}" aria-label="${a.done ? "Mark not done" : "Mark done"}">${ICON.check}</button>
    <div class="row-main"><b>${esc(whenLabel(a))} · ${esc(a.herd || "Cows")} → ${esc(a.section || "no section set")}</b>${a.note ? `<small class="alloc-note">${esc(a.note)}</small>` : ""}${a.done && a.doneBy ? `<small>Done by ${esc(a.doneBy)}</small>` : ""}</div>
    <span class="owners">${a.mapId && a.section ? `<button class="btn ghost small" type="button" data-act="showsection" data-map="${esc(a.mapId)}" data-sec="${esc(a.section)}">Map</button>` : ""}${isAdmin() ? `<button class="btn ghost small" type="button" data-act="editalloc" data-id="${esc(a.id)}">Edit</button>` : ""}</span></div>`;
}
function vAllocList() {
  const t = iso(today());
  const up = S.allocations.filter(a => a.date >= t);
  const recent = S.allocations.filter(a => a.date < t && a.date >= iso(addDays(today(), -7))).reverse();
  return `<section><div class="sec-head"><h2 class="sec">Grazing instructions</h2>${isAdmin() ? `<button class="link" type="button" data-act="newalloc">New instruction</button>` : ""}</div>
    ${up.length ? `<div class="card">${up.map(allocRow).join("")}</div>` : `<div class="card"><p class="empty">No grazing instructions coming up.${isAdmin() ? " Add one with New instruction, or tap a section on the map." : ""}</p></div>`}</section>
    ${recent.length ? `<section><h2 class="sec">Last 7 days</h2><div class="card">${recent.map(allocRow).join("")}</div></section>` : ""}`;
}
function currentMap() { const m = S.maps.find(x => x.id === S.mapId) || S.maps[0]; if (m) S.mapId = m.id; return m; }
function centroid(pts) { let x = 0, y = 0; pts.forEach(p => { x += p[0]; y += p[1]; }); return [x / pts.length, y / pts.length]; }
function overlay(m) {
  const t = iso(today()), tm = iso(addDays(today(), 1));
  const active = new Set(S.allocations.filter(a => a.mapId === m.id && (a.date === t || a.date === tm) && !a.done).map(a => a.section));
  const fs = Math.max(14, Math.round(Math.max(m.w, m.h) / 38));
  let out = (m.sections || []).map(s => {
    const c = centroid(s.points), cls = ["sec", active.has(s.label) ? "active" : "", S.selSection === s.label ? "sel" : ""].join(" ");
    return `<polygon class="${cls}" points="${s.points.map(p => p.join(",")).join(" ")}" data-act="section" data-sec="${esc(s.label)}" style="stroke-width:${fs / 6}"></polygon><text class="sec-label" x="${c[0]}" y="${c[1]}" font-size="${fs}" style="stroke-width:${fs / 5}">${esc(s.label)}</text>`;
  }).join("");
  if (S.mapEdit && S.mapEdit.points.length) {
    const p = S.mapEdit.points;
    out += `<polyline class="drawing-line" points="${p.map(q => q.join(",")).join(" ")}" style="stroke-width:${fs / 5}"></polyline>` + p.map(q => `<circle class="drawing-pt" cx="${q[0]}" cy="${q[1]}" r="${fs / 3}"></circle>`).join("");
  }
  return out;
}
function vMap() {
  const admin = isAdmin();
  const head = `<section><p class="dayline">Farm map</p><p class="sub">Where each herd is going, and the grazing instructions for each section.</p></section>`;
  if (!S.maps.length) return head + `<div class="card"><p class="empty">${admin ? "No map yet. Add a screenshot of the farm from Google Maps, or a photo of a drawn map with the paddocks marked. Then draw the sections on it (A1, B2, C3…)." : "No map yet. An admin can add one."}</p>${admin ? `<div class="btn-row"><button class="btn primary small" type="button" data-act="addmap">Add a farm map</button></div>` : ""}</div>` + vAllocList();
  const m = currentMap();
  const chips = S.maps.length > 1 ? `<div class="chips" role="group" aria-label="Map">${S.maps.map(x => `<button class="chip" type="button" data-act="pickmap" data-id="${esc(x.id)}" aria-pressed="${x.id === m.id}">${esc(x.name)}</button>`).join("")}</div>` : "";
  const drawing = !!S.mapEdit;
  const tools = `<div class="map-tools">
    <button class="icon-btn" type="button" data-act="zoom" data-d="-1" aria-label="Zoom out" ${S.mapZoom <= 1 ? "disabled" : ""}>${ICON.minus}</button>
    <button class="icon-btn" type="button" data-act="zoom" data-d="1" aria-label="Zoom in" ${S.mapZoom >= 4 ? "disabled" : ""}>${ICON.plus}</button>
    <span class="spacer"></span>
    ${admin && !drawing ? `<button class="btn ghost small" type="button" data-act="drawstart">Draw a section</button><button class="btn ghost small" type="button" data-act="mapmenu">Map options</button>` : ""}
    ${drawing ? `<button class="btn ghost small" type="button" data-act="drawundo" ${S.mapEdit.points.length ? "" : "disabled"}>Undo point</button><button class="btn ghost small" type="button" data-act="drawcancel">Cancel</button><button class="btn primary small" type="button" data-act="drawfinish" ${S.mapEdit.points.length >= 3 ? "" : "disabled"}>Finish</button>` : ""}
  </div>`;
  const hint = drawing ? `<p class="note">Tap each corner of the section on the map, then tap Finish.</p>` : (m.sections || []).length ? `<p class="note">Tap a section to see or give instructions for it.</p>` : admin ? `<p class="note">Next, draw the sections on the map with Draw a section.</p>` : "";
  const mapEl = `<div class="map-wrap card" id="mapWrap"><div class="map-inner" style="width:${S.mapZoom * 100}%"><img src="${m.image}" alt="Map of ${esc(m.name)}" draggable="false"><svg class="mapsvg ${drawing ? "drawing" : ""}" id="mapSvg" viewBox="0 0 ${m.w} ${m.h}" preserveAspectRatio="none" data-act="mapclick">${overlay(m)}</svg></div></div>`;
  let panel = "";
  if (S.selSection && !drawing) {
    const sec = (m.sections || []).find(s => s.label === S.selSection);
    if (sec) {
      const t = iso(today());
      const list = S.allocations.filter(a => a.mapId === m.id && a.section === sec.label && a.date >= iso(addDays(today(), -7)));
      panel = `<section class="card sec-panel"><div class="sec-head pad"><b class="sec-title">Section ${esc(sec.label)}</b><button class="icon-btn" type="button" data-act="unselect" aria-label="Close">${ICON.close}</button></div>
        ${list.length ? list.map(allocRow).join("") : `<p class="empty">No instructions for ${esc(sec.label)} this week.</p>`}
        ${admin ? `<div class="btn-row"><button class="btn primary small" type="button" data-act="newalloc" data-map="${esc(m.id)}" data-sec="${esc(sec.label)}">Send cows to ${esc(sec.label)}</button><button class="btn ghost small" type="button" data-act="renamesec" data-sec="${esc(sec.label)}">Rename</button><button class="btn ghost small danger" type="button" data-act="delsec" data-sec="${esc(sec.label)}">Delete section</button></div>` : ""}</section>`;
    }
  }
  return head + `<section>${chips}${tools}${hint}${mapEl}</section>${panel}` + vAllocList();
}
async function fileToMapImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("bad image")); i.src = url; });
    let max = 1800, q = 0.78, data = "", w = 0, h = 0;
    for (let t = 0; t < 7; t++) {
      const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      w = Math.round(img.naturalWidth * s); h = Math.round(img.naturalHeight * s);
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      c.getContext("2d").drawImage(img, 0, 0, w, h);
      data = c.toDataURL("image/jpeg", q);
      if (data.length < 750000) break;
      max = Math.round(max * 0.82); q = Math.max(0.5, q - 0.06);
    }
    if (data.length >= 950000) throw new Error("too big");
    return { data, w, h };
  } finally { URL.revokeObjectURL(url); }
}
function saveSections(m, sections, ok) {
  return write(() => updateDoc(doc(db, "maps", m.id), { sections, ...stamp() }), ok);
}

/* ---------- Farm hub ---------- */
function vFarm() {
  const admin = isAdmin();
  const sw = `<section class="card farm-state"><div class="sec-head pad"><h2 class="sec">Right now on the farm</h2></div><div class="switches">${SEASONS.map(([k, label]) => {
    const v = S.farmState[k]; const st = v === true ? "On" : v === false ? "Off" : "Auto";
    return `<button class="switch s-${st.toLowerCase()}" type="button" data-act="season" data-k="${k}" ${admin ? "" : "disabled"} aria-label="${esc(label)}: ${st}"><span>${esc(label)}</span><b>${st}</b></button>`;
  }).join("")}</div><p class="note pad">${admin ? "Tap to switch between Auto, On and Off. Auto goes by the months ticked in the knowledge base. These decide which routine jobs show on Today." : "These decide which routine jobs show on Today. Admins change them."}</p></section>`;
  const chips = `<div class="chips" role="group" aria-label="Section">${FARM_TABS.map(([k, l]) => `<button class="chip" type="button" data-act="farmtab" data-f="${k}" aria-pressed="${S.farmTab === k}">${l}</button>`).join("")}</div>`;
  const body = ({ calendar: vCalendar, guide: vGuide, year: vYear, meeting: vMeetings, rules: vRules })[S.farmTab]();
  return `<section>${chips}</section>${S.farmTab === "calendar" ? sw : ""}${body}`;
}

function eventRow(e) {
  const k = e.kbId && kbById(e.kbId);
  return `<div class="row event"><div class="date-badge"><b>${parse(e.date).getDate()}</b><small>${MONTHS[parse(e.date).getMonth()]}</small></div>
    <div class="row-main"><b>${esc(e.title)}</b><small>${esc([longDate(e.date), e.time].filter(Boolean).join(" · "))}</small>${e.notes ? `<small>${esc(e.notes)}</small>` : ""}
    <span class="ppl">${(e.people || []).map(n => `<span class="person ${n === me() ? "is-me" : ""}">${tag(n, "sm")}<span>${esc(n)}</span></span>`).join("")}</span></div>
    <span class="owners">${k ? `<button class="btn ghost small" type="button" data-act="guide" data-id="${esc(k.id)}">How-to</button>` : ""}${isAdmin() ? `<button class="btn ghost small" type="button" data-act="editevent" data-id="${esc(e.id)}">Edit</button>` : ""}</span></div>`;
}
function vCalendar() {
  const t = today(), ti = iso(t), admin = isAdmin();
  const up = S.events.filter(e => e.date >= ti && e.date <= iso(addDays(t, 120)));
  const past = S.events.filter(e => e.date < ti && e.date >= iso(addDays(t, -30))).reverse();
  // Yearly knowledge-base jobs due this month or next that aren't booked yet
  const cm = t.getMonth() + 1, nm = cm % 12 + 1;
  const unbooked = S.kb.filter(k => PLANNED_OFTEN.includes(k.often) && (k.months || []).some(m => m === cm || m === nm))
    .filter(k => !S.events.some(e => e.kbId === k.id && e.date >= ti));
  const groups = {};
  up.forEach(e => { const key = e.date.slice(0, 7); (groups[key] = groups[key] || []).push(e); });
  const upHtml = up.length ? Object.entries(groups).map(([ym, list]) => `<h3 class="month-head">${MONTHS_LONG[Number(ym.slice(5)) - 1]} ${ym.slice(0, 4)}</h3><div class="card">${list.map(eventRow).join("")}</div>`).join("")
    : `<div class="card"><p class="empty">Nothing on the calendar yet.${admin ? " Add dates like milk recording, the TB test or the vet visit with Add to calendar." : ""}</p></div>`;
  return `<section><div class="sec-head"><h2 class="sec">Coming up</h2></div>${upHtml}</section>
    ${unbooked.length ? `<section><h2 class="sec">Planned but not booked</h2><div class="card">${unbooked.map(k => `<div class="row"><div class="row-main"><b>${esc(k.title)}</b><small>${esc(scheduleText(k))}</small></div><span class="owners">${admin ? `<button class="btn primary small" type="button" data-act="newevent" data-kb="${esc(k.id)}">Book a date</button>` : ""}</span></div>`).join("")}</div><p class="note">From the knowledge base: yearly jobs for this month and next with no date on the calendar.</p></section>` : ""}
    ${past.length ? `<section><h2 class="sec">Last 30 days</h2><div class="card">${past.map(eventRow).join("")}</div></section>` : ""}`;
}

function guideMatches() {
  const q = S.guideQuery.trim().toLowerCase();
  return S.kb.filter(k => (!S.guideArea || k.area === S.guideArea) && (!q || [k.id, k.title, k.description, k.area, k.safety].join(" ").toLowerCase().includes(q)));
}
function guideList() {
  const list = guideMatches();
  if (!S.kb.length) return `<div class="card"><p class="empty">The how-to guide is empty. ${isAdmin() ? "Import the knowledge base: tap your ear tag › Import knowledge base." : "An admin needs to import the knowledge base."}</p></div>`;
  if (!list.length) return `<div class="card"><p class="empty">No jobs match that search.</p></div>`;
  return `<div class="card">${list.map(k => `<div class="row"><button class="rowbtn" type="button" data-act="guide" data-id="${esc(k.id)}"><span class="kb-id">${esc(k.id)}</span><div class="row-main"><b>${esc(k.title)}</b><small>${esc(scheduleText(k))}</small></div>${(k.steps || []).length ? `<span class="pill">${k.steps.length} steps</span>` : ""}</button></div>`).join("")}</div>`;
}
function vGuide() {
  const areas = [...new Set(S.kb.map(k => k.area).filter(Boolean))];
  return `<section><p class="dayline">How we do things</p><p class="sub">Every job on the farm: what it involves, when, safety, and step-by-step how-tos.</p></section>
    <section><div class="field"><label for="guide-q">Search</label><input id="guide-q" type="search" placeholder="e.g. calf, slurry, robot" value="${esc(S.guideQuery)}" autocomplete="off"></div>
    <div class="chips" role="group" aria-label="Area"><button class="chip" type="button" data-act="guidearea" data-a="" aria-pressed="${!S.guideArea}">All</button>${areas.map(a => `<button class="chip" type="button" data-act="guidearea" data-a="${esc(a)}" aria-pressed="${S.guideArea === a}">${esc(a)}</button>`).join("")}</div></section>
    <section id="guideList">${guideList()}</section>`;
}

function yearItems(month) {
  if (S.kb.length) return S.kb.filter(k => !ROUTINE_OFTEN.includes(k.often) && k.often !== "Weekly" && k.often !== "As needed" && (k.months || []).includes(month))
    .map(k => ({ kb: k, task: k.title, area: k.area, owner: k.usual, notes: k.condition || "", months: k.months }));
  return S.cal.filter(c => (c.months || []).includes(month)).map(c => Object.assign({}, c));
}
function yearRow(c) {
  const inner = `<div class="row-main"><b>${esc(c.task)}</b><small>${esc(c.area || "")}${c.notes ? " · " + esc(c.notes) : ""}</small></div>${tag(c.owner, "sm")}`;
  return `<div class="row">${c.kb ? `<button class="rowbtn" type="button" data-act="guide" data-id="${esc(c.kb.id)}">${inner}</button>` : inner}</div>`;
}
function vYear() {
  const cm = new Date().getMonth() + 1, admin = isAdmin();
  const chips = MONTHS.map((m, i) => `<button class="chip ${i + 1 === cm ? "now" : ""}" type="button" data-act="month" data-m="${i + 1}" aria-pressed="${i + 1 === S.month}">${m}</button>`).join("");
  const items = yearItems(S.month);
  const mini = c => `<span class="mini-months" aria-hidden="true">${MONTHS.map((_, k) => `<i class="${(c.months || []).includes(k + 1) ? "on" : ""} ${k + 1 === S.month ? "cur" : ""}"></i>`).join("")}</span>`;
  let cal;
  if (!items.length) cal = `<div class="card"><p class="empty">Nothing in the yearly plan for ${MONTHS_LONG[S.month - 1]}.</p></div>`;
  else if (S.kb.length) cal = `<div class="card">${items.map(c => `<div class="row"><button class="rowbtn" type="button" data-act="guide" data-id="${esc(c.kb.id)}"><div class="row-main"><b>${esc(c.task)}</b><small>${esc(scheduleText(c.kb))}</small>${mini(c)}</div>${tag(c.owner, "sm")}</button></div>`).join("")}</div>`;
  else cal = `<div class="card">${S.cal.map((c, i) => Object.assign({ i }, c)).filter(c => (c.months || []).includes(S.month)).map(c => `<div class="row">${admin ? `<button class="rowbtn" type="button" data-act="editcal" data-i="${c.i}">` : `<div class="rowbtn">`}<div class="row-main"><b>${esc(c.task)}</b><small>${esc(c.area || "")}${c.notes ? " · " + esc(c.notes) : ""}</small>${mini(c)}</div>${tag(c.owner, "sm")}${admin ? "</button>" : "</div>"}</div>`).join("")}</div>`;
  const ev = S.events.filter(e => e.date.slice(5, 7) === pad(S.month) && e.date >= iso(today()).slice(0, 4) + "-01-01");
  const roleInner = a => `<div class="row-main"><b>${esc(a.area)}</b>${a.decides ? `<small>Decides alone: ${esc(a.decides)}</small>` : ""}${a.meeting ? `<small>Brings to meeting: ${esc(a.meeting)}</small>` : ""}</div><span class="owners">${tag(a.owner, "sm")}${a.backup ? `<span class="bk">backup</span>${tag(a.backup, "sm")}` : ""}</span>`;
  const roles = S.roles.length ? `<div class="card">${S.roles.map((a, i) => `<div class="row">${admin ? `<button class="rowbtn" type="button" data-act="editrole" data-i="${i}">${roleInner(a)}</button>` : roleInner(a)}</div>`).join("")}</div>` : `<div class="card"><p class="empty">No areas set up yet.</p></div>`;
  const unowned = S.roles.filter(a => !a.owner).length;
  return `<section><div class="sec-head"><h2 class="sec">Yearly jobs</h2>${admin && !S.kb.length ? `<button class="link" type="button" data-act="newcal">Add</button>` : ""}</div><div class="months" role="group" aria-label="Month">${chips}</div></section>
  <section><p class="dayline small">${MONTHS_LONG[S.month - 1]}</p>${cal}${ev.length ? `<h3 class="month-head">Booked dates</h3><div class="card">${ev.map(eventRow).join("")}</div>` : ""}<p class="note">${S.kb.length ? "From the knowledge base. Change it on the farm-knowledge sheet and import it again." : "Based on a typical spring-calving year."} Check current slurry and fertiliser dates with your advisor.</p></section>
  <section><div class="sec-head"><h2 class="sec">Who owns what</h2>${unowned ? `<span class="pill high">${unowned} without an owner</span>` : ""}</div>${roles}<p class="note">The owner makes the day-to-day calls for that area. Bigger decisions go to the weekly meeting.</p></section>`;
}

function vRules() {
  if (!S.kbRules.length) return `<div class="card"><p class="empty">No rules imported yet. They come from the Rules & dates tab of the knowledge base.</p></div>`;
  return `<section><p class="dayline">Rules &amp; dates</p><p class="sub">Closed periods, records, tests and audits. Check them with your advisor each season.</p></section>
  <section><div class="card">${S.kbRules.map(r => `<div class="row rule"><div class="row-main"><b>${esc(r.topic)}</b><small>${esc(r.rule)}</small>${r.deadline ? `<small><b>Date:</b> ${esc(r.deadline)}</small>` : ""}${r.start || r.end ? `<small><b>${r.start ? "From " + esc(short(r.start)) : ""}${r.end ? " to " + esc(short(r.end)) : ""}</b></small>` : ""}${r.source ? `<small class="src">Source: ${esc(r.source)}</small>` : ""}</div>${r.status && r.status !== "Checked" ? `<span class="pill prog">${esc(r.status)}</span>` : ""}</div>`).join("")}</div></section>`;
}

function vMeetings() {
  const t = today(), ti = iso(t), in7 = iso(addDays(t, 7));
  const open = S.jobs.filter(isOpen);
  const overdue = open.filter(j => j.due && j.due < ti).sort(byDue);
  const soon = open.filter(j => j.due && j.due >= ti && j.due <= in7).sort(byDue);
  const doneWk = S.jobs.filter(j => isDone(j) && j.doneOn && j.doneOn >= iso(addDays(t, -7))).sort((a, b) => String(b.doneOn).localeCompare(a.doneOn));
  const waiting = S.jobs.filter(j => j.status === "Awaiting review");
  const reports = S.reports.filter(x => x.status === "Open");
  const events = S.events.filter(e => e.date >= ti && e.date <= iso(addDays(t, 14)));
  const nm = (t.getMonth() + 1) % 12 + 1, next = yearItems(nm);
  const counts = {}; open.forEach(j => { const k = j.owner || "Unassigned"; counts[k] = (counts[k] || 0) + 1; });
  const max = Math.max(1, ...Object.values(counts));
  const li = (arr, f) => arr.length ? `<ul>${arr.slice(0, 8).map(f).join("")}${arr.length > 8 ? `<li>and ${arr.length - 8} more</li>` : ""}</ul>` : `<p class="note">None</p>`;
  const agenda = `<div class="card agenda">
    <div><h3>Done in the last week</h3>${li(doneWk, j => `<li>${esc(j.title)} <span class="note">(${esc(j.owner || "–")})</span></li>`)}</div>
    <div><h3>Waiting for review</h3>${li(waiting, j => `<li>${esc(j.title)} <span class="note">(${esc(j.owner || "–")})</span>${j.feedback ? `<br><span class="note">“${esc(j.feedback)}”</span>` : ""}</li>`)}</div>
    <div><h3>Overdue</h3>${li(overdue, j => `<li>${esc(j.title)} <span class="note">(${esc(j.owner || "–")}, ${esc(dueLabel(j))})</span></li>`)}</div>
    <div><h3>Due this week</h3>${li(soon, j => `<li>${esc(j.title)} <span class="note">(${esc(j.owner || "–")}, ${esc(dueLabel(j))})</span></li>`)}</div>
    <div><h3>Problems reported</h3>${li(reports, x => `<li>${esc(x.text)} <span class="note">(${esc(x.person || "–")})</span></li>`)}</div>
    <div><h3>On the calendar, next two weeks</h3>${li(events, e => `<li>${esc(e.title)} <span class="note">(${esc(longDate(e.date))}${(e.people || []).length ? ", " + esc(e.people.join(", ")) : ""})</span></li>`)}</div>
    ${next.length ? `<div><h3>Plan for ${MONTHS_LONG[nm - 1]}</h3>${li(next, c => `<li>${esc(c.task)}${c.owner ? ` <span class="note">(${esc(c.owner)})</span>` : ""}</li>`)}</div>` : ""}
    <div><h3>Open jobs by person</h3><div class="load">${Object.keys(counts).length ? Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, n]) => `<div class="load-row">${tag(k === "Unassigned" ? "" : k, "sm")}<span class="nm">${esc(k)}</span><span class="bar"><i class="${n >= Math.max(3, max) ? "hot" : ""}" style="width:${Math.round(n / max * 100)}%"></i></span><b>${n}</b></div>`).join("") : `<p class="note">No open jobs.</p>`}</div></div>
  </div>`;
  const log = S.meetings.length ? `<div class="card">${S.meetings.map(m => `<article class="meet"><div class="meet-head"><b>${esc(m.date ? parse(m.date).toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short", year: "numeric" }) : "No date")}</b><button class="btn ghost small" type="button" data-act="editmeet" data-id="${esc(m.id)}">Edit</button></div><dl>
    ${m.done ? `<div><dt>Done last week</dt><dd>${esc(m.done)}</dd></div>` : ""}
    ${m.next ? `<div><dt>Jobs for next week</dt><dd>${esc(m.next)}</dd></div>` : ""}
    ${m.decisions ? `<div><dt>Decisions</dt><dd>${esc(m.decisions)}${m.owner ? ` <span class="note">(owner: ${esc(m.owner)})</span>` : ""}</dd></div>` : ""}
    ${m.followUp ? `<div><dt>Follow-up / parked</dt><dd>${esc(m.followUp)}</dd></div>` : ""}</dl></article>`).join("")}</div>` : `<div class="card"><p class="empty">No meetings logged yet.</p></div>`;
  return `<section><p class="dayline">Weekly meeting</p><p class="sub">20 minutes, once a week. Here's this week's agenda, built from the jobs, reports and calendar.</p></section><section><h2 class="sec">Agenda</h2>${agenda}</section><section><h2 class="sec">Meeting log</h2>${log}</section>`;
}

/* ---------- bottom sheets ---------- */
let sheetCtx = null;
function openSheet(title, body, opt = {}) {
  const el = $("#sheet");
  el.innerHTML = `<div class="scrim" data-act="close"></div><form class="panel" id="sheetForm" role="dialog" aria-modal="true" aria-label="${esc(title)}" novalidate><header><h2>${esc(title)}</h2><button type="button" class="icon-btn" data-act="close" aria-label="Close">${ICON.close}</button></header><div class="body">${body}</div>${opt.save || opt.footer ? `<footer>${opt.del ? `<button type="button" class="btn ghost danger" data-act="sheetdel">Delete</button>` : ""}${opt.footer || ""}${opt.save ? `<button class="btn primary" type="submit">${esc(opt.saveLabel || "Save")}</button>` : ""}</footer>` : ""}</form>`;
  el.hidden = false; sheetCtx = opt;
  if (!opt.noFocus) { const f = el.querySelector(".body input:not([type=checkbox]):not([disabled]),.body select:not([disabled]),.body textarea:not([disabled])"); if (f) setTimeout(() => f.focus(), 30); }
}
function closeSheet() { $("#sheet").hidden = true; $("#sheet").innerHTML = ""; sheetCtx = null; }
const fv = (fd, k) => String(fd.get(k) || "").trim();
const dl = (label, val) => val ? `<div class="kv"><span>${esc(label)}</span><p>${esc(val)}</p></div>` : "";

// Admin: full edit. Owner: status and feedback only. Everyone else: read-only.
function jobSheet(j, extra = {}) {
  if (j && !isAdmin()) return canWorkJob(j) ? ownerJobSheet(j) : viewJobSheet(j);
  if (!isAdmin()) return;
  const isNew = !j || !j.id;
  j = Object.assign({ owner: "", status: "Not started", priority: "Medium", due: iso(addDays(today(), 1)) }, j || {});
  const reviewPanel = j.status === "Awaiting review" ? `<div class="review-box"><b>Waiting for your review</b><p>${esc(j.feedback || "No feedback given.")}</p><small>From ${esc(j.owner || "–")}${j.doneOn ? ", done " + esc(short(j.doneOn)) : ""}</small>
    <div class="field"><label for="f-rnote">Note if sending back</label><textarea id="f-rnote" name="reviewNote" maxlength="2000" placeholder="What still needs doing?"></textarea></div>
    <div class="btn-row flush"><button class="btn primary small" type="button" data-act="approve">Approve</button><button class="btn ghost small" type="button" data-act="sendback">Send back</button></div></div>` : "";
  openSheet(isNew ? "New job" : "Edit job", `${reviewPanel}
    <div class="field"><label for="f-title">Job</label><input id="f-title" name="title" required maxlength="200" value="${esc(j.title)}" placeholder="e.g. Book relief milker for 7–8 Nov"></div>
    <div class="two"><div class="field"><label for="f-owner">Owner</label><select id="f-owner" name="owner">${ownerOptions(j.owner)}</select></div>
    <div class="field"><label for="f-due">Due</label><input id="f-due" name="due" type="date" value="${esc(j.due || "")}"></div></div>
    <div class="field"><label for="f-area">Area</label><select id="f-area" name="area">${areaOptions(j.area)}</select></div>
    <div class="two"><div class="field"><label for="f-pri">Priority</label><select id="f-pri" name="priority">${opts(["High","Medium","Low"], j.priority || "Medium")}</select></div>
    <div class="field"><label for="f-status">Status</label><select id="f-status" name="status">${opts(JOB_STATUSES, j.status || "Not started")}</select></div></div>
    <label class="check-line"><input type="checkbox" id="f-review" name="needsReview" ${j.needsReview ? "checked" : ""}> <span><b>Needs review when done.</b> The owner sends feedback, and an admin approves it before it counts as done.</span></label>
    <div class="field"><label for="f-notes">Notes</label><textarea id="f-notes" name="notes" maxlength="2000">${esc(j.notes)}</textarea></div>
    ${j.feedback && j.status !== "Awaiting review" ? dl("Feedback", j.feedback) : ""}${j.reviewNote ? dl("Sent back with", j.reviewNote) : ""}${j.reviewedBy ? `<p class="changed">Approved by ${esc(nameFor(j.reviewedBy))}${j.reviewedAt ? " on " + esc(short(j.reviewedAt)) : ""}</p>` : ""}
    ${changedLine(j)}`,
  { job: j, save: fd => {
      const title = fv(fd, "title"); if (!title) { toast("Give the job a name first."); return false; }
      const status = fv(fd, "status") || "Not started";
      const data = { title, owner: fv(fd, "owner"), due: fv(fd, "due"), area: fv(fd, "area"), priority: fv(fd, "priority") || "Medium", status, notes: fv(fd, "notes"),
        needsReview: fd.get("needsReview") === "on", feedback: j.feedback || "", reviewNote: j.reviewNote || "", reviewedBy: j.reviewedBy || "", reviewedAt: j.reviewedAt || "",
        doneOn: status === "Done" || status === "Awaiting review" ? (j.doneOn || iso(today())) : "", createdAt: j.createdAt || Date.now(), ...stamp() };
      if (j.fromReport) data.fromReport = j.fromReport;
      const ref = isNew ? doc(collection(db, "jobs")) : doc(db, "jobs", j.id);
      const ok = write(() => setDoc(ref, data), isNew ? "Job added" : "Job saved");
      if (ok && extra.reportId) write(() => updateDoc(doc(db, "reports", extra.reportId), { status: "Made into job", jobId: ref.id, ...stamp() }));
      return ok;
    },
    del: isNew ? null : () => write(() => deleteDoc(doc(db, "jobs", j.id)), "Job deleted"),
    saveLabel: isNew ? "Add job" : "Save" });
}
function jobDetails(j) {
  return `<div class="kv-list">${dl("Job", j.title)}${dl("Area", j.area)}${dl("Owner", j.owner || "Unassigned")}${dl("Due", j.due ? longDate(j.due) : "")}${dl("Priority", j.priority)}${dl("Status", j.status)}${dl("Notes", j.notes)}</div>`;
}
function viewJobSheet(j) {
  openSheet("Job", `${jobDetails(j)}${j.feedback ? dl("Feedback", j.feedback) : ""}<p class="note">Only ${esc(j.owner || "an admin")} or an admin can change this job.</p>${changedLine(j)}`, { noFocus: true });
}
function ownerJobSheet(j) {
  const statuses = j.needsReview ? ["Not started", "In progress", "Awaiting review"] : ["Not started", "In progress", "Done"];
  const cur = statuses.includes(j.status) ? j.status : j.status === "Done" ? "Done" : "Not started";
  openSheet("Your job", `${jobDetails(j)}
    ${j.reviewNote && j.status !== "Done" ? `<div class="review-box back"><b>Sent back for more</b><p>${esc(j.reviewNote)}</p></div>` : ""}
    ${j.needsReview ? `<p class="note"><b>This job needs a review.</b> When it's done, set the status to Awaiting review and say what the reviewer needs to know.</p>` : ""}
    <div class="field"><label for="o-status">Status</label><select id="o-status" name="status" ${j.status === "Done" && j.needsReview ? "disabled" : ""}>${opts(j.status === "Done" && j.needsReview ? ["Done"] : statuses, cur)}</select></div>
    <div class="field"><label for="o-feedback">${j.needsReview ? "What the reviewer needs to know" : "Feedback (optional)"}</label><textarea id="o-feedback" name="feedback" maxlength="2000" placeholder="e.g. Cow 214 had a high reading on the left hind quarter">${esc(j.feedback)}</textarea></div>
    ${changedLine(j)}`,
  { save: fd => {
      if (j.status === "Done" && j.needsReview) return true;
      const status = fv(fd, "status"), feedback = fv(fd, "feedback");
      if (status === "Awaiting review" && !feedback) { toast("Add what the reviewer needs to know first."); return false; }
      const data = { status, feedback, doneOn: status === "Done" || status === "Awaiting review" ? (j.doneOn || iso(today())) : "", ...stamp() };
      return write(() => updateDoc(doc(db, "jobs", j.id), data), status === "Awaiting review" ? "Sent for review" : "Saved");
    }, saveLabel: "Save" });
}
function finishReviewSheet(j) {
  openSheet("Finish: " + j.title, `<p class="sub">This job needs a review. Say what's been done and anything the reviewer needs to know.</p>
    <div class="field"><label for="r-fb">Feedback</label><textarea id="r-fb" name="feedback" maxlength="2000" required placeholder="e.g. 3 cows had high cell counts: 214, 233, 260">${esc(j.feedback)}</textarea></div>`,
  { save: fd => {
      const feedback = fv(fd, "feedback"); if (!feedback) { toast("Add what the reviewer needs to know first."); return false; }
      return write(() => updateDoc(doc(db, "jobs", j.id), { status: "Awaiting review", feedback, doneOn: iso(today()), ...stamp() }), "Sent for review");
    }, saveLabel: "Send for review" });
}

function reportSheet(duty) {
  openSheet("Report a problem", `<p class="sub">Something broken, a sick animal, or a job that needs doing? It goes to the admins, who turn it into a job.</p>
    <div class="field"><label for="p-text">What's the problem?</label><textarea id="p-text" name="text" maxlength="2000" required placeholder="e.g. Water trough in C3 not filling"></textarea></div>
    <div class="field"><label for="p-area">Area</label><select id="p-area" name="area">${areaOptions("")}</select></div>`,
  { save: fd => {
      const text = fv(fd, "text"); if (!text) { toast("Say what the problem is first."); return false; }
      return write(() => setDoc(doc(collection(db, "reports")), { text, area: fv(fd, "area"), duty: duty || "", person: me(), date: iso(today()), status: "Open", ...stamp() }), "Reported. The admins will see it on their Today screen.");
    }, saveLabel: "Send report" });
}

function kbSheet(k) {
  const steps = (k.steps || []).length ? `<h3 class="sheet-h">Step by step</h3><ol class="steps big">${k.steps.map(s => `<li><p>${esc(s.text)}</p>${s.watch ? `<p class="watch">${ICON.warn}<span>${esc(s.watch)}</span></p>` : ""}${s.link ? `<p><a href="${esc(s.link)}" target="_blank" rel="noopener">Photo or video</a></p>` : ""}</li>`).join("")}</ol>` : "";
  const admin = isAdmin();
  openSheet(k.title, `<p class="kb-meta"><span class="kb-id">${esc(k.id)}</span> ${esc(k.area || "")}${k.status && k.status !== "Checked" ? ` <span class="pill prog">${esc(k.status)}</span>` : ""}</p>
    <p>${esc(k.description)}</p>
    <div class="kv-list">${dl("When", scheduleText(k))}${dl("Usually done by", k.usual)}${dl("Who can do it", k.who)}${dl("Rota duty", k.duty)}${dl("Minutes each time", k.minutes ? String(k.minutes) : "")}</div>
    ${k.safety ? `<div class="safety">${ICON.warn}<p>${esc(k.safety)}</p></div>` : ""}
    <div class="kv-list">${dl("Records to keep", k.records)}${dl("Equipment and supplies", k.equipment)}</div>
    ${steps}`,
  { noFocus: true, footer: admin && !ROUTINE_OFTEN.includes(k.often) ? `<button type="button" class="btn ghost" data-act="kbjob" data-id="${esc(k.id)}">Make a job</button><button type="button" class="btn primary" data-act="newevent" data-kb="${esc(k.id)}">Book a date</button>` : "" });
}

function eventSheet(e, kbId) {
  const isNew = !e;
  const k = kbId ? kbById(kbId) : null;
  e = e || { date: iso(addDays(today(), 7)), title: k ? k.title : "", kbId: kbId || "", people: k && k.usual && names().includes(k.usual) ? [k.usual] : [] };
  const sel = new Set(e.people || []);
  openSheet(isNew ? "Add to calendar" : "Edit calendar entry", `
    <div class="field"><label for="e-title">What</label><input id="e-title" name="title" maxlength="200" value="${esc(e.title)}" placeholder="e.g. Milk recording"></div>
    <div class="two"><div class="field"><label for="e-date">Date</label><input id="e-date" name="date" type="date" value="${esc(e.date)}"></div>
    <div class="field"><label for="e-time">Time (optional)</label><input id="e-time" name="time" maxlength="40" value="${esc(e.time)}" placeholder="e.g. 7:00, morning milking"></div></div>
    <div class="field"><span class="lbl">Who's on it</span><div class="pick multi">${team().map(n => `<button type="button" data-act="togglepick" data-n="${esc(n)}" aria-pressed="${sel.has(n)}">${tag(n, "sm")}<span>${esc(n)}</span></button>`).join("")}</div></div>
    <div class="field"><label for="e-kb">Knowledge base job (optional)</label><select id="e-kb" name="kbId">${kbOptions(e.kbId)}</select></div>
    <div class="field"><label for="e-notes">Notes</label><textarea id="e-notes" name="notes" maxlength="2000" placeholder="e.g. Recorder arrives before milking. Have the meters set up.">${esc(e.notes)}</textarea></div>
    <p class="note">Everyone you pick sees it under Coming up for you, two weeks ahead.</p>${changedLine(e)}`,
  { save: fd => {
      const title = fv(fd, "title"), date = fv(fd, "date");
      if (!title || !date) { toast("Add what it is and the date."); return false; }
      const people = Array.from(document.querySelectorAll(".pick.multi [aria-pressed=true]")).map(b => b.dataset.n);
      const data = { title, date, time: fv(fd, "time"), kbId: fv(fd, "kbId"), people, notes: fv(fd, "notes"), ...stamp() };
      return write(() => setDoc(isNew ? doc(collection(db, "events")) : doc(db, "events", e.id), data), isNew ? "Added to the calendar" : "Saved");
    },
    del: isNew ? null : () => write(() => deleteDoc(doc(db, "events", e.id)), "Removed from the calendar") });
}

function sectionOptions(mapId, cur) {
  const out = [];
  for (const m of S.maps) for (const s of m.sections || []) out.push(`<option value="${esc(m.id + "|" + s.label)}" ${m.id === mapId && s.label === cur ? "selected" : ""}>${S.maps.length > 1 ? esc(m.name) + ": " : ""}${esc(s.label)}</option>`);
  return out.join("");
}
function allocSheet(a, preset = {}) {
  const isNew = !a;
  const hour = new Date().getHours();
  a = a || { date: iso(today()), slot: hour >= 12 ? "Night" : "Daytime", herd: "Robot herd", mapId: preset.mapId || "", section: preset.section || "", note: "" };
  const hasSections = S.maps.some(m => (m.sections || []).length);
  openSheet(isNew ? "New grazing instruction" : "Edit grazing instruction", `
    <div class="two"><div class="field"><label for="g-date">Date</label><input id="g-date" name="date" type="date" value="${esc(a.date)}"></div>
    <div class="field"><label for="g-slot">When</label><select id="g-slot" name="slot">${opts(SLOTS, a.slot)}</select></div></div>
    <div class="field"><label for="g-herd">Herd</label><select id="g-herd" name="herd">${opts(HERDS.includes(a.herd) ? HERDS : HERDS.concat(a.herd), a.herd)}</select></div>
    ${hasSections ? `<div class="field"><label for="g-sec">Section</label><select id="g-sec" name="sec"><option value="">Choose a section</option>${sectionOptions(a.mapId, a.section)}</select></div>`
      : `<div class="field"><label for="g-sectext">Section</label><input id="g-sectext" name="sectext" maxlength="40" value="${esc(a.section)}" placeholder="e.g. C3"></div>`}
    <div class="field"><label for="g-note">Instructions</label><textarea id="g-note" name="note" maxlength="1000" placeholder="e.g. Give them two fencing posts more of space than last night.">${esc(a.note)}</textarea></div>`,
  { save: fd => {
      let mapId = "", section = "";
      if (hasSections) { const v = fv(fd, "sec"); if (v) { const i = v.indexOf("|"); mapId = v.slice(0, i); section = v.slice(i + 1); } }
      else section = fv(fd, "sectext");
      const date = fv(fd, "date"); if (!date) { toast("Pick a date."); return false; }
      const data = { date, slot: fv(fd, "slot"), herd: fv(fd, "herd"), mapId, section, note: fv(fd, "note"), done: a.done || false, doneBy: a.doneBy || "", doneAt: a.doneAt || "", ...stamp() };
      return write(() => setDoc(isNew ? doc(collection(db, "allocations")) : doc(db, "allocations", a.id), data), isNew ? "Instruction added" : "Saved");
    },
    del: isNew ? null : () => write(() => deleteDoc(doc(db, "allocations", a.id)), "Instruction deleted") });
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
    <p class="note">An admin adds anything from "Jobs for next week" to the Jobs list, with an owner and a due date.</p>${changedLine(m)}`,
  { save: fd => {
      const data = { date: fv(fd, "date") || iso(today()), owner: fv(fd, "owner"), done: fv(fd, "done"), next: fv(fd, "next"), decisions: fv(fd, "decisions"), followUp: fv(fd, "followUp"), ...stamp() };
      return write(() => setDoc(isNew ? doc(collection(db, "meetings")) : doc(db, "meetings", m.id), data), "Meeting saved");
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
  const row = p => `<div class="row" style="padding-inline:0">${admin ? `<button class="rowbtn" type="button" data-act="editperson" data-id="${esc(p.id)}">` : `<div class="rowbtn">`}${tag(p.name, "lg")}<div class="row-main"><b>${esc(p.name)}</b><small>${esc([p.role, p.days].filter(Boolean).join(" · "))}</small>${p.phone ? `<small class="phone">${esc(p.phone)}</small>` : ""}</div>${admin ? "</button>" : "</div>"}</div>`;
  const tm = S.people.filter(p => p.kind !== "contact");
  const ct = S.contacts.filter(c => c.name || c.phone);
  const contactRow = c => `<div class="row" style="padding-inline:0"><div class="row-main"><b>${esc(c.role)}</b><small>${esc([c.name, c.when].filter(Boolean).join(" · "))}</small>${c.phone ? `<small class="phone"><a href="tel:${esc(c.phone.replace(/\s+/g, ""))}">${esc(c.phone)}</a></small>` : ""}${c.email ? `<small class="phone">${esc(c.email)}</small>` : ""}</div></div>`;
  openSheet("Team and contacts", `<h2 class="sec">Team</h2><div>${tm.map(row).join("") || `<p class="note">No one yet.</p>`}</div>
    <h2 class="sec">Contacts</h2><div>${ct.map(contactRow).join("") || `<p class="note">No contact numbers yet. Fill them in on the Contacts tab of the knowledge base, then import it.</p>`}</div>
    ${admin ? `<button class="btn ghost" type="button" data-act="newperson">Add a person</button>` : ""}`, { noFocus: true });
}
function personSheet(p) {
  const isNew = !p; p = p || { kind: "team" };
  openSheet(isNew ? "Add a person" : "Edit " + p.name, `
    <div class="field"><label for="p-name">Name</label><input id="p-name" name="name" maxlength="60" value="${esc(p.name)}"></div>
    <div class="field"><label for="p-role">Role on the farm</label><input id="p-role" name="role" maxlength="120" value="${esc(p.role)}"></div>
    <div class="two"><div class="field"><label for="p-phone">Phone</label><input id="p-phone" name="phone" type="tel" maxlength="30" value="${esc(p.phone)}"></div>
    <div class="field"><label for="p-days">Usual days</label><input id="p-days" name="days" maxlength="120" value="${esc(p.days)}"></div></div>
    <div class="field"><label for="p-kind">Type</label><select id="p-kind" name="kind"><option value="team" ${p.kind !== "contact" ? "selected" : ""}>Team (can go on the rota)</option><option value="contact" ${p.kind === "contact" ? "selected" : ""}>Outside service (vet, contractor…)</option></select></div>`,
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
      <button class="btn ghost" type="button" data-act="kbimport">Import knowledge base (.xlsx) <span aria-hidden="true">›</span></button>
      <button class="btn ghost" type="button" data-act="exportcsv">Download jobs as a spreadsheet (CSV) <span aria-hidden="true">›</span></button>
      <button class="btn ghost" type="button" data-act="exportjson">Download a full backup <span aria-hidden="true">›</span></button>
      <button class="btn ghost" type="button" data-act="import">Restore from a backup file <span aria-hidden="true">›</span></button>` : ""}
      <button class="btn ghost danger" type="button" data-act="signout">Sign out</button>
    </div>`, { noFocus: true });
}

function membersSheet() {
  const list = S.members.slice().sort((a, b) => String(a.person).localeCompare(b.person));
  openSheet("Who can use the app", `<p class="sub">Add someone's email address, then send them the link. They sign in with Google, or create an account with that same email.</p>
    <div class="card">${list.map(m => `<div class="row"><button class="rowbtn" type="button" data-act="editmember" data-id="${esc(m.id)}">${tag(m.person, "sm")}<div class="row-main"><b>${esc(m.person || "No name linked")}</b><small>${esc(m.id)} · ${m.role === "admin" ? "Admin" : "Member"}</small></div></button></div>`).join("")}</div>
    <p class="note"><b>Members</b> see everything, tick off and update their own jobs, mark routine duties done, fill in the rota, log meetings and report problems. <b>Admins</b> also add and assign jobs, review finished work, and manage the map, calendar, knowledge base and access.</p>
    <button class="btn primary" type="button" data-act="newmember">Add someone</button>`, { noFocus: true });
}
function memberSheet(m) {
  const isNew = !m; m = m || { role: "member" };
  const self = !isNew && m.id === myEmail();
  openSheet(isNew ? "Add someone" : "Edit access", `
    <div class="field"><label for="u-email">Email address</label><input id="u-email" name="email" type="email" inputmode="email" value="${esc(m.id)}" ${isNew ? "" : "disabled"}></div>
    <div class="field"><label for="u-person">Which person on the farm is this?</label><select id="u-person" name="person">${ownerOptions(m.person)}</select></div>
    <div class="field"><label for="u-role">Access</label><select id="u-role" name="role" ${self ? "disabled" : ""}><option value="member" ${m.role !== "admin" ? "selected" : ""}>Member: their own jobs, rota and meetings</option><option value="admin" ${m.role === "admin" ? "selected" : ""}>Admin: everything, including assigning and reviewing jobs</option></select></div>
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

/* ---------- knowledge base import ---------- */
const norm = h => String(h ?? "").trim().toLowerCase();
const str = v => v == null ? "" : String(v).trim();
const truthy = v => v === true || v === 1 || /^(true|yes|x|1)$/i.test(String(v ?? "").trim());
function table(rows) {
  if (!rows || !rows.length) return [];
  const hdr = (rows[0] || []).map(norm);
  return rows.slice(1).map(r => { const o = {}; hdr.forEach((h, i) => { if (h) o[h] = (r || [])[i]; }); return o; });
}
function findTab(wb, name) { const k = Object.keys(wb).find(t => norm(t) === norm(name)); return k ? wb[k] : null; }
export function kbFromWorkbook(wb) {
  const problems = [];
  const jobsTab = findTab(wb, "Jobs");
  if (!jobsTab) throw new Error("No Jobs tab in that file. Download the farm-knowledge sheet as Microsoft Excel (.xlsx) and try again.");
  const areas = table(findTab(wb, "Areas")).map(o => ({ name: str(o.area), covers: str(o["what it covers"]), prefix: str(o["job id prefix"]) })).filter(a => a.name);
  const areaSet = new Set(areas.map(a => a.name));
  const steps = {};
  for (const o of table(findTab(wb, "Procedures"))) {
    const id = str(o["job id"]).toUpperCase(), text = str(o["what to do"]);
    if (!id || !text) continue;
    (steps[id] = steps[id] || []).push({ n: Number(o.step) || 0, text, watch: str(o["watch out for"]), link: str(o["photo or video link"]) });
  }
  const jobs = [], seen = new Set();
  let order = 0;
  for (const o of table(jobsTab)) {
    const id = str(o.id).toUpperCase(), title = str(o.job);
    if (!id && !title) continue;
    if (!id || !title) { problems.push(`A row is missing its ${id ? "job name" : "ID"} (${id || title}). Skipped.`); continue; }
    if (!/^[A-Z0-9-]{1,20}$/.test(id)) { problems.push(`${id}: IDs can only use letters, numbers and dashes. Skipped.`); continue; }
    if (seen.has(id)) { problems.push(`${id} appears twice. Only the first one was kept.`); continue; }
    seen.add(id);
    const status = str(o.status) || "Draft";
    if (status === "Not done on this farm") continue;
    const area = str(o.area);
    if (area && areaSet.size && !areaSet.has(area)) problems.push(`${id}: area "${area}" isn't on the Areas tab.`);
    const minutes = Number(o["minutes each time"]);
    jobs.push({
      id, title, description: str(o["job description"]), area, often: str(o["how often"]), time: str(o["time of day"]),
      months: MONTHS.map((m, i) => truthy(o[m.toLowerCase()]) ? i + 1 : 0).filter(Boolean),
      condition: str(o["condition or trigger"] ?? o["only when"]), minutes: minutes > 0 ? minutes : null,
      usual: str(o["usually done by"]), duty: str(o["rota duty"]), who: str(o["who can do it"]),
      safety: str(o["safety and rules"]), records: str(o["records to keep"]), equipment: str(o["equipment and supplies"]),
      status, notes: str(o["notes and questions"]),
      steps: (steps[id] || []).sort((a, b) => a.n - b.n).slice(0, 50), order: order++,
    });
  }
  for (const id of Object.keys(steps)) if (!seen.has(id)) problems.push(`Procedures has steps for ${id}, which isn't on the Jobs tab.`);
  const rules = table(findTab(wb, "Rules & dates")).map((o, i) => ({
    topic: str(o.topic), rule: str(o["rule or what to do"]), when: str(o["when it applies"]), deadline: str(o["date or deadline (zone b)"] ?? o["date or deadline"]),
    start: excelDate(o["start date"]), end: excelDate(o["end date"]), source: str(o.source), status: str(o.status), order: i,
  })).filter(r => r.topic);
  const contacts = table(findTab(wb, "Contacts")).map((o, i) => ({
    role: str(o.role), name: str(o["name or company"]), phone: str(o.phone), email: str(o.email), when: str(o["when to call"]), notes: str(o.notes), order: i,
  })).filter(c => c.role);
  return { jobs, rules, contacts, areas, problems, stepCount: jobs.reduce((n, j) => n + j.steps.length, 0) };
}
async function kbImportFile(file) {
  let kb;
  try { kb = kbFromWorkbook(await readXlsx(file)); }
  catch (e) { console.error(e); return toast(e.message && !/^bad|undefined/.test(e.message) ? e.message : "That file couldn't be read. Download the sheet as Microsoft Excel (.xlsx) and try again."); }
  if (!kb.jobs.length) return toast("No jobs found on the Jobs tab.");
  openSheet("Import knowledge base", `<p class="sub">Found in <b>${esc(file.name)}</b>:</p>
    <ul class="steps"><li><b>${kb.jobs.length}</b> jobs, with <b>${kb.stepCount}</b> how-to steps</li><li><b>${kb.rules.length}</b> rules and dates</li><li><b>${kb.contacts.length}</b> contacts</li><li><b>${kb.areas.length}</b> areas</li></ul>
    ${kb.problems.length ? `<div class="review-box back"><b>Worth fixing on the sheet</b><ul>${kb.problems.slice(0, 12).map(p => `<li>${esc(p)}</li>`).join("")}${kb.problems.length > 12 ? `<li>and ${kb.problems.length - 12} more</li>` : ""}</ul></div>` : ""}
    <p class="note">This replaces the knowledge base in the app with what's in the file. Jobs, the rota, meetings and the calendar aren't touched. Rows marked "Not done on this farm" are left out.</p>`,
  { save: () => { doKbImport(kb); return true; }, saveLabel: "Import" });
}
async function doKbImport(kb) {
  if (!S.online) return toast("You need signal to import the knowledge base.");
  toast("Importing the knowledge base…");
  const ops = [];
  const keepKb = new Set(kb.jobs.map(j => j.id));
  for (const k of S.kb) if (!keepKb.has(k.id)) ops.push(["delete", doc(db, "kb", k.id)]);
  for (const j of kb.jobs) { const { id, ...rest } = j; ops.push(["set", doc(db, "kb", id), { ...rest, ...stamp() }]); }
  const ruleIds = kb.rules.map((_, i) => "r" + pad(i + 1)), contactIds = kb.contacts.map((_, i) => "c" + pad(i + 1));
  for (const r of S.kbRules) if (!ruleIds.includes(r.id)) ops.push(["delete", doc(db, "kbRules", r.id)]);
  for (const c of S.contacts) if (!contactIds.includes(c.id)) ops.push(["delete", doc(db, "contacts", c.id)]);
  kb.rules.forEach((r, i) => ops.push(["set", doc(db, "kbRules", ruleIds[i]), { ...r, ...stamp() }]));
  kb.contacts.forEach((c, i) => ops.push(["set", doc(db, "contacts", contactIds[i]), { ...c, ...stamp() }]));
  if (kb.areas.length) ops.push(["set", doc(db, "config", "areas"), { list: kb.areas, ...stamp() }]);
  try {
    for (let i = 0; i < ops.length; i += 400) {
      const b = writeBatch(db);
      for (const [op, ref, data] of ops.slice(i, i + 400)) op === "delete" ? b.delete(ref) : b.set(ref, data);
      await b.commit();
    }
    toast(`Imported ${kb.jobs.length} jobs, ${kb.rules.length} rules and ${kb.contacts.length} contacts.`);
  } catch (e) {
    console.error(e);
    toast(e.code === "permission-denied" ? "Import refused: only admins can import, and every row has to fit the expected format." : "Import didn't finish. Check your signal and try again.");
  }
}

/* ---------- export / backup ---------- */
function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function exportCsv() {
  const cols = ["Job","Area","Owner","Due","Priority","Status","Done on","Needs review","Feedback","Notes","Last changed by"];
  const cell = v => { v = String(v == null ? "" : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const rows = S.jobs.slice().sort(byDue).map(j => [j.title, j.area, j.owner, j.due, j.priority, j.status, j.doneOn, j.needsReview ? "Yes" : "", j.feedback, j.notes, j.updatedBy ? nameFor(j.updatedBy) : ""].map(cell).join(","));
  download(`farm-jobs-${iso(today())}.csv`, "﻿" + [cols.join(","), ...rows].join("\r\n"), "text/csv;charset=utf-8");
}
const BACKUP_COLS = ["people", "jobs", "rota", "meetings", "kb", "kbRules", "contacts", "events", "maps", "allocations", "reports"];
function exportJson() {
  const strip = o => { const c = Object.assign({}, o); delete c.id; delete c._pending; delete c.updatedAt; delete c.updatedBy; return c; };
  const byId = arr => Object.fromEntries(arr.map(o => [o.id, strip(o)]));
  const data = { exportedAt: new Date().toISOString(), people: byId(S.people), jobs: byId(S.jobs), rota: byId(Object.values(S.rota)), meetings: byId(S.meetings),
    kb: byId(S.kb), kbRules: byId(S.kbRules), contacts: byId(S.contacts), events: byId(S.events), maps: byId(S.maps), allocations: byId(S.allocations), reports: byId(S.reports),
    config: { calendar: { items: S.cal }, roles: { areas: S.roles }, ...(S.areasCfg ? { areas: { list: S.areasCfg } } : {}), farmState: Object.fromEntries(Object.entries(S.farmState).filter(([k]) => SEASONS.some(s => s[0] === k))) } };
  download(`farm-backup-${iso(today())}.json`, JSON.stringify(data, null, 2), "application/json");
}
async function importFile(file) {
  if (!S.online) return toast("You need signal to import a file.");
  let data;
  try { data = JSON.parse(await file.text()); } catch (e) { return toast("That file isn't a farm backup. Choose a .json file from Download a full backup."); }
  const writes = [];
  for (const col of BACKUP_COLS) for (const [id, d] of Object.entries(data[col] || {})) writes.push([doc(db, col, id), d]);
  const cfg = data.config || {};
  if (cfg.calendar) writes.push([doc(db, "config", "calendar"), { items: cfg.calendar.items || [] }]);
  if (cfg.roles) writes.push([doc(db, "config", "roles"), { areas: cfg.roles.areas || [] }]);
  if (cfg.areas) writes.push([doc(db, "config", "areas"), { list: cfg.areas.list || [] }]);
  if (cfg.farmState) writes.push([doc(db, "config", "farmState"), cfg.farmState]);
  if (!writes.length) return toast("That file has no farm data in it.");
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

function mapPoint(e) {
  const m = currentMap(), svg = document.getElementById("mapSvg");
  if (!m || !svg) return null;
  const r = svg.getBoundingClientRect();
  return [Math.round((e.clientX - r.left) / r.width * m.w), Math.round((e.clientY - r.top) / r.height * m.h)];
}
function refreshOverlay() { const m = currentMap(), svg = document.getElementById("mapSvg"); if (m && svg) svg.innerHTML = overlay(m); const b = document.querySelector("[data-act=drawfinish]"); if (b) b.disabled = S.mapEdit.points.length < 3; const u = document.querySelector("[data-act=drawundo]"); if (u) u.disabled = !S.mapEdit.points.length; }
function toggleJob(j) {
  if (!canWorkJob(j)) return;
  const finished = isDone(j) || j.status === "Awaiting review";
  if (finished) {
    if (!isAdmin() && isDone(j) && j.needsReview) return toast("This job has been approved. Ask an admin if it needs reopening.");
    return write(() => updateDoc(doc(db, "jobs", j.id), { status: "Not started", doneOn: "", ...stamp() }), "Reopened");
  }
  if (j.needsReview && !isAdmin()) return finishReviewSheet(j);
  write(() => updateDoc(doc(db, "jobs", j.id), { status: "Done", doneOn: iso(today()), ...stamp() }), "Done: " + j.title);
}

let delArmed = null;
document.addEventListener("click", async e => {
  const b = e.target.closest("[data-act]"); if (!b) return;
  const a = b.dataset.act;
  switch (a) {
    case "go": S.tab = b.dataset.tab; store.set("tab", S.tab); S.mapEdit = null; closeSheet(); render(); scrollTo(0, 0); break;
    case "filter": S.jobFilter = b.dataset.f; S.tab = "jobs"; store.set("tab", "jobs"); render(); scrollTo(0, 0); break;
    case "farmtab": S.farmTab = b.dataset.f; S.tab = "farm"; store.set("farmTab", S.farmTab); store.set("tab", "farm"); render(); scrollTo(0, 0); break;
    case "month": S.month = +b.dataset.m; S.tab = "farm"; S.farmTab = "year"; render(); break;
    case "week": S.weekOff += +b.dataset.d; S.rotaDay = null; render(); break;
    case "rday": S.rotaDay = +b.dataset.i; render(); break;
    case "toggle": { const j = S.jobs.find(x => x.id === b.dataset.id); if (j) toggleJob(j); break; }
    case "editjob": jobSheet(S.jobs.find(x => x.id === b.dataset.id)); break;
    case "newjob": if (isAdmin()) jobSheet(); break;
    case "approve": { const j = sheetCtx && sheetCtx.job; if (!j) break;
      if (write(() => updateDoc(doc(db, "jobs", j.id), { status: "Done", reviewedBy: myEmail(), reviewedAt: iso(today()), reviewNote: "", ...stamp() }), "Approved")) closeSheet(); break; }
    case "sendback": { const j = sheetCtx && sheetCtx.job; if (!j) break; const note = ($("#f-rnote") || {}).value || "";
      if (!note.trim()) { toast("Add a note saying what still needs doing."); break; }
      if (write(() => updateDoc(doc(db, "jobs", j.id), { status: "In progress", doneOn: "", reviewNote: note.trim(), ...stamp() }), "Sent back to " + (j.owner || "the owner"))) closeSheet(); break; }
    case "kbjob": { const k = kbById(b.dataset.id); if (!k) break; closeSheet(); jobSheet({ title: k.title, area: k.area, owner: names().includes(k.usual) ? k.usual : areaOwner(k.area), notes: k.description }); break; }
    case "report": reportSheet(b.dataset.duty || ""); break;
    case "reportjob": { const x = S.reports.find(r => r.id === b.dataset.id); if (!x) break; jobSheet({ title: x.text.slice(0, 120), area: x.area, owner: areaOwner(x.area), notes: `Reported by ${x.person || "someone"} on ${short(x.date)}: ${x.text}`, fromReport: x.id }, { reportId: x.id }); break; }
    case "reportclose": write(() => updateDoc(doc(db, "reports", b.dataset.id), { status: "Closed", ...stamp() }), "Closed"); break;
    case "routinedone": { const duty = b.dataset.duty, ti = iso(today());
      write(() => setDoc(doc(db, "routine", ti + "_" + slug(duty)), { date: ti, duty, person: me(), note: "", ...stamp() }), duty + " done"); break; }
    case "routineundo": write(() => deleteDoc(doc(db, "routine", iso(today()) + "_" + slug(b.dataset.duty))), "Undone"); break;
    case "guide": { const k = kbById(b.dataset.id); if (k) kbSheet(k); break; }
    case "guidearea": S.guideArea = b.dataset.a; render(); break;
    case "season": { if (!isAdmin()) break; const k = b.dataset.k, v = S.farmState[k]; const nextV = v === undefined || v === null ? true : v === true ? false : null;
      const data = {}; for (const [key] of SEASONS) { const cur = key === k ? nextV : S.farmState[key]; if (cur === true || cur === false) data[key] = cur; }
      write(() => setDoc(doc(db, "config", "farmState"), { ...data, ...stamp() })); break; }
    case "newevent": if (isAdmin()) { closeSheet(); eventSheet(null, b.dataset.kb || ""); } break;
    case "editevent": eventSheet(S.events.find(x => x.id === b.dataset.id)); break;
    case "togglepick": b.setAttribute("aria-pressed", b.getAttribute("aria-pressed") === "true" ? "false" : "true"); break;
    // map
    case "addmap": $("#mapFile").dataset.replace = ""; $("#mapFile").click(); break;
    case "pickmap": S.mapId = b.dataset.id; S.selSection = null; render(); break;
    case "zoom": S.mapZoom = Math.min(4, Math.max(1, S.mapZoom + (+b.dataset.d))); render(); break;
    case "drawstart": S.mapEdit = { points: [] }; S.selSection = null; render(); break;
    case "drawcancel": S.mapEdit = null; render(); break;
    case "drawundo": if (S.mapEdit) { S.mapEdit.points.pop(); refreshOverlay(); } break;
    case "section":
    case "mapclick":
      if (S.mapEdit) { const p = mapPoint(e); if (p) { S.mapEdit.points.push(p); refreshOverlay(); } }
      else if (a === "section") { S.selSection = b.dataset.sec; render(); }
      break;
    case "drawfinish": { const m = currentMap(); if (!m || !S.mapEdit || S.mapEdit.points.length < 3) break;
      const pts = S.mapEdit.points.slice();
      openSheet("Name this section", `<div class="field"><label for="s-name">Section name</label><input id="s-name" name="label" maxlength="20" placeholder="e.g. C3"></div>`,
        { save: fd => { const label = fv(fd, "label"); if (!label) { toast("Give the section a name."); return false; }
          if ((m.sections || []).some(s => s.label === label)) { toast(`There's already a section called ${label}.`); return false; }
          S.mapEdit = null; S.selSection = label; return saveSections(m, (m.sections || []).concat({ id: uid(), label, points: pts }), "Section " + label + " saved"); } });
      break; }
    case "unselect": S.selSection = null; render(); break;
    case "renamesec": { const m = currentMap(), old = b.dataset.sec;
      openSheet("Rename section", `<div class="field"><label for="s-name">Section name</label><input id="s-name" name="label" maxlength="20" value="${esc(old)}"></div>`,
        { save: fd => { const label = fv(fd, "label"); if (!label) return false;
          S.selSection = label; return saveSections(m, (m.sections || []).map(s => s.label === old ? Object.assign({}, s, { label }) : s), "Renamed"); } });
      break; }
    case "delsec": { const m = currentMap();
      if (delArmed !== b) { delArmed = b; b.textContent = "Tap again to delete"; setTimeout(() => { if (delArmed === b) { delArmed = null; b.textContent = "Delete section"; } }, 3000); break; }
      delArmed = null; S.selSection = null; saveSections(m, (m.sections || []).filter(s => s.label !== b.dataset.sec), "Section deleted"); break; }
    case "mapmenu": { const m = currentMap();
      openSheet("Map options", `<div class="field"><label for="mp-name">Map name</label><input id="mp-name" name="name" maxlength="60" value="${esc(m.name)}"></div>
        <div class="menu"><button class="btn ghost" type="button" data-act="replacemap">Replace the map picture (keeps the sections)</button><button class="btn ghost" type="button" data-act="addmap">Add another map</button></div>`,
        { save: fd => write(() => updateDoc(doc(db, "maps", m.id), { name: fv(fd, "name") || m.name, ...stamp() }), "Saved"), del: () => write(() => deleteDoc(doc(db, "maps", m.id)), "Map deleted") });
      break; }
    case "replacemap": $("#mapFile").dataset.replace = currentMap().id; closeSheet(); $("#mapFile").click(); break;
    case "showsection": S.tab = "map"; S.mapId = b.dataset.map; S.selSection = b.dataset.sec; S.mapEdit = null; closeSheet(); render(); scrollTo(0, 0); break;
    case "newalloc": if (isAdmin()) allocSheet(null, { mapId: b.dataset.map, section: b.dataset.sec }); break;
    case "editalloc": allocSheet(S.allocations.find(x => x.id === b.dataset.id)); break;
    case "allocdone": { const x = S.allocations.find(r => r.id === b.dataset.id); if (!x) break;
      write(() => updateDoc(doc(db, "allocations", x.id), { done: !x.done, doneBy: x.done ? "" : (me() || myEmail()), doneAt: x.done ? "" : iso(today()), ...stamp() }), x.done ? "Marked not done" : "Done"); break; }
    // existing
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
    case "kbimport": $("#kbFile").click(); break;
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
document.addEventListener("change", e => {
  if (e.target.id === "e-kb") { const k = kbById(e.target.value), t = $("#e-title"); if (k && t && !t.value.trim()) t.value = k.title; }
});
document.addEventListener("input", e => {
  if (e.target.id === "guide-q") { S.guideQuery = e.target.value; const l = $("#guideList"); if (l) l.innerHTML = guideList(); }
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
$("#kbFile").addEventListener("change", e => { const f = e.target.files[0]; e.target.value = ""; if (f) { closeSheet(); kbImportFile(f); } });
$("#mapFile").addEventListener("change", async e => {
  const f = e.target.files[0], replace = e.target.dataset.replace; e.target.value = "";
  if (!f || !isAdmin()) return;
  if (!S.online) return toast("You need signal to upload a map.");
  closeSheet(); toast("Preparing the map…");
  let img;
  try { img = await fileToMapImage(f); } catch (err) { return toast(err.message === "too big" ? "That picture is too detailed to store. Try a smaller screenshot." : "That file isn't a picture the app can read. Use a JPG or PNG."); }
  if (replace) {
    const m = S.maps.find(x => x.id === replace); if (!m) return;
    // Keep sections in the same place relative to the new picture
    const sx = img.w / m.w, sy = img.h / m.h;
    const sections = (m.sections || []).map(s => Object.assign({}, s, { points: s.points.map(p => [Math.round(p[0] * sx), Math.round(p[1] * sy)]) }));
    write(() => updateDoc(doc(db, "maps", m.id), { image: img.data, w: img.w, h: img.h, sections, ...stamp() }), "Map picture replaced");
  } else {
    const ref = doc(collection(db, "maps"));
    S.mapId = ref.id; S.tab = "map";
    write(() => setDoc(ref, { name: S.maps.length ? "Map " + (S.maps.length + 1) : "Farm", image: img.data, w: img.w, h: img.h, sections: [], order: S.maps.length, ...stamp() }), "Map added. Now draw the sections.");
  }
});
let lastDay = iso(today());
document.addEventListener("visibilitychange", () => { if (!document.hidden && iso(today()) !== lastDay) { lastDay = iso(today()); render(); } });

/* ---------- start ---------- */
if (!configured) render();
else {
  getRedirectResult(auth).catch(authError);
  onAuthStateChanged(auth, u => handleUser(u));
}
