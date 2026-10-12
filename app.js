/* =====================================================================
   Santa Soirée 2026 — app logic (Firebase edition)
   - Accounts: Firebase Authentication (email + password; Google for organizers)
   - Data: Cloud Firestore  (settings/main, students/{uid}, registrations/{EVENT_uid}, seats/{EVENT_uid})
   - Security: firestore.rules  (keep admin emails in sync with firebase-config.js)
   ===================================================================== */
(() => {
"use strict";
const { firebaseConfig = {}, ADMIN_EMAILS = [] } = window.SS_CONFIG || {};
document.documentElement.classList.add("anim");   // enables scroll animations only when this script runs

const FIREBASE_VERSION = "12.19.0";
const SDK = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;

/* ---------------- Event config ---------------- */
const EVENT_DATE = "2026-12-20";
const START = new Date(EVENT_DATE + "T10:00:00+05:30");
const END   = new Date(EVENT_DATE + "T20:00:00+05:30");

const BASE_EVENTS = [
  {id:"FB", name:"FrostByte", icon:"💻", cat:"coding", accent:"#5aa9ff", sub:"Hackathon & Coding Challenge",
   desc:"Solve problems, build creative solutions and show off your coding skills against the clock.",
   start:10, end:12, seats:40, team:{max:4}, extra:{label:"Preferred language / stack", ph:"e.g. Python, JavaScript"},
   keywords:["coding","programming","code","hackathon","python","java","javascript","c++","algorithms","dsa","competitive programming","web development","app development","software","developer","problem solving","ai","ml","machine learning","data science"]},
  {id:"SK", name:"SnowKing", icon:"🎮", cat:"gaming", accent:"#b27bff", sub:"Gaming Championship",
   desc:"Challenge your friends, think strategically and battle your way to the SnowKing crown.",
   start:12, end:14, seats:64, team:null, extra:{label:"Game name", ph:"Which game will you play?"},
   keywords:["gaming","games","game","esports","video games","strategy","strategy games","bgmi","valorant","fifa","chess","pc gaming","mobile gaming","competition","tournament"]},
  {id:"AA", name:"Aurora ArtFest", icon:"🎨", cat:"creativity", accent:"#ff7ab8", sub:"Graphics & Creative Design",
   desc:"Turn your imagination into stunning digital artwork, posters and creative designs.",
   start:14, end:16, seats:50, team:null, extra:{label:"Design category", ph:"e.g. Poster, Illustration, UI"},
   keywords:["design","graphic design","digital art","art","drawing","illustration","painting","poster","ui","ux","photoshop","figma","canva","creativity","creative","animation","photography","video editing","editing","sketching"]},
  {id:"RL", name:"Reindeer Innovation Lab", icon:"🚀", cat:"innovation", accent:"#f3c56b", sub:"Innovative Projects & Models",
   desc:"Present exciting ideas, working models and technology-driven innovations to the jury.",
   start:16, end:18, seats:30, team:{max:5}, extra:{label:"Project title", ph:"Name of your project"},
   keywords:["innovation","startups","startup","entrepreneurship","robotics","robots","iot","hardware","electronics","arduino","research","projects","models","ai","ml","machine learning","sustainability","ideas","pitching","public speaking"]}
];
const INTEREST_TAGS = ["Coding","AI / ML","Web development","Competitive programming","Gaming","Esports","Strategy games","Graphic design","Digital art","UI / UX","Photography","Video editing","Robotics","IoT","Hardware","Startups","Research","Public speaking"];
const DEPARTMENTS = ["CSE AIML","CSE","CSE (Data Science)","CSE (Cyber Security)","IT","ECE","EE","ME","CE"];
const DEFAULT_SETTINGS = {domain:"", allowPersonalFirstYear:true, regOpen:true, signupOpen:true, deadline:"2026-12-18"};

/* ---------------- State ---------------- */
const configured = !!(firebaseConfig && firebaseConfig.apiKey && !/PASTE/i.test(firebaseConfig.apiKey) && !/PASTE/i.test(firebaseConfig.projectId || ""));
const adminList = (ADMIN_EMAILS || []).map(e => String(e).trim().toLowerCase()).filter(e => e && !e.endsWith("@example.com"));
let fb = null;                       // Firebase functions + auth + db
const state = {
  authReady:false, authBusy:false, user:null, profile:null, myRegs:[], myRegsUnsub:null,
  settings:null, settingsLoaded:false, seats:{},
  admin:{live:false, students:[], regs:[], unsubs:[], loaded:0}
};
let currentView = null, pendingEvent = null;

/* ---------------- Helpers ---------------- */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fmtH = h => (h % 12 || 12) + " " + (h >= 12 ? "PM" : "AM");
const ord = n => ["1st","2nd","3rd","4th"][n - 1] || n;
const initials = n => String(n || "?").trim().split(/\s+/).slice(0, 2).map(w => w[0]).join("").toUpperCase();
const yearsText = ys => ys.length >= 4 ? "All years" : ys.length ? ys.slice().sort().map(ord).join(", ") + " year" : "No years";
const emailOk = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const cleanDomain = d => String(d || "").trim().toLowerCase().replace(/^@/, "");
const toDate = t => t && typeof t.toDate === "function" ? t.toDate() : (t ? new Date(t) : null);
const fmtDT = t => { const d = toDate(t); return d && !isNaN(d) ? d.toLocaleString("en-IN", {dateStyle:"medium", timeStyle:"short"}) : "—"; };
function toast(msg, ms = 3400){ const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove("show"), ms); }
function download(name, text, type){ const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], {type})); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }
function toCSV(head, rows){ const cell = v => `"${String(v ?? "").replace(/"/g, '""')}"`; return "﻿" + [head, ...rows].map(r => r.map(cell).join(",")).join("\n"); }
function go(view){ location.hash = "#/" + view; }
function busy(btn, on, label){ if(!btn) return; if(on){ btn.dataset.label = btn.textContent; btn.textContent = label || "Please wait…"; btn.disabled = true; } else { if(btn.dataset.label) btn.textContent = btn.dataset.label; btn.disabled = false; } }
const D = (...p) => fb.doc(fb.db, ...p);
const C = p => fb.collection(fb.db, p);

function errMsg(e){
  const code = (e && e.code) || "";
  const map = {
    "auth/email-already-in-use":"An account with this email already exists. Try signing in instead.",
    "auth/invalid-email":"That email address doesn't look right.",
    "auth/weak-password":"Password must be at least 6 characters.",
    "auth/invalid-credential":"Incorrect email or password.",
    "auth/wrong-password":"Incorrect email or password.",
    "auth/user-not-found":"No account found with this email.",
    "auth/too-many-requests":"Too many attempts. Please wait a few minutes and try again.",
    "auth/requires-recent-login":"For security, sign out and sign in again before changing your password.",
    "auth/network-request-failed":"Network error. Check your internet connection.",
    "auth/popup-closed-by-user":"Sign-in window was closed.",
    "auth/popup-blocked":"Your browser blocked the sign-in popup. Allow popups for this site and try again.",
    "auth/operation-not-allowed":"This sign-in method isn't enabled in Firebase yet (Authentication → Sign-in method).",
    "auth/unauthorized-domain":"This website's domain isn't authorised in Firebase (Authentication → Settings → Authorized domains).",
    "permission-denied":"Not allowed. Registrations or sign-ups may be closed, or your details don't meet the rules (e.g. email domain).",
    "unavailable":"Can't reach the server. Check your internet connection."
  };
  return map[code] || (e && e.message ? e.message.replace(/^Firebase:\s*/, "") : "Something went wrong. Please try again.");
}

/* ---------------- Derived data ---------------- */
function settings(){ const s = state.settings || {}; return {...DEFAULT_SETTINGS, ...s, events:{...(s.events || {})}}; }
function events(){
  const ov = settings().events;
  return BASE_EVENTS.map(e => { const o = ov[e.id] || {};
    return {...e, seats:o.seats ?? e.seats, open:o.open ?? true, years:o.years ?? [1,2,3,4], team:e.team ? {max:o.teamMax ?? e.team.max} : null}; });
}
const byEvent = id => events().find(e => e.id === id);
const taken = id => state.seats[id] || 0;
const me = () => (state.user && state.profile) || null;
const isAdminEmail = u => !!(u && u.email && adminList.includes(u.email.toLowerCase()));
const isAdmin = () => isAdminEmail(state.user) && !!state.user.emailVerified;
const myReg = id => state.myRegs.find(r => r.event === id);

function emailRule(email, year){
  const s = settings(), d = cleanDomain(s.domain);
  if(!d) return null;
  if(email.toLowerCase().split("@")[1] === d) return null;
  if(year === 1 && s.allowPersonalFirstYear) return null;
  return year === 1 ? `Please use your institutional email (@${d}).` : `${ord(year)} year students must use their institutional email (@${d}). Personal emails are only allowed for 1st years.`;
}
function emailHint(year){
  const s = settings(), d = cleanDomain(s.domain);
  if(!d) return "Use an email you check regularly.";
  if(year === 1 && s.allowPersonalFirstYear) return `1st years: institutional (@${d}) or personal email both work.`;
  return `Use your institutional email ending in @${d}.`;
}
function blockReason(ev, st){
  if(!configured || (state.settingsLoaded && !state.settings)) return "Registrations open soon.";
  const s = settings();
  if(!s.regOpen) return "Registrations are currently closed.";
  if(s.deadline && Date.now() > new Date(s.deadline + "T23:59:59+05:30").getTime()) return "The registration deadline has passed.";
  if(!ev.open) return `${ev.name} isn't accepting registrations right now.`;
  if(st && !ev.years.includes(st.year)) return `Open to ${yearsText(ev.years).toLowerCase()} students only.`;
  if(taken(ev.id) >= ev.seats) return `${ev.name} is full.`;
  return null;
}

/* ---------------- Interest matching ---------------- */
const tokens = t => String(t || "").toLowerCase().split(/[^a-z0-9+#]+/).filter(x => x.length >= 2);
function matchEvent(ev, text){
  const toks = tokens(text); if(!toks.length) return [];
  const hit = t => toks.some(x => x === t || (x.length >= 4 && t.startsWith(x)) || (t.length >= 4 && x.startsWith(t)));
  const hits = ev.keywords.filter(k => tokens(k).every(hit));
  return hits.filter(k => !hits.some(o => o !== k && o.includes(k)));
}
const interestText = st => st ? [...(st.interests || []), st.interestsOther || ""].join(", ") : "";
const rankEvents = text => events().map(e => ({e, hits:matchEvent(e, text)})).sort((a, b) => b.hits.length - a.hits.length);
const tagButtons = sel => INTEREST_TAGS.map(t => `<button type="button" class="tagbtn" aria-pressed="${sel.includes(t)}" data-tag="${esc(t)}">${esc(t)}</button>`).join("");
function bindTags(el){ el.addEventListener("click", e => { const b = e.target.closest(".tagbtn"); if(b) b.setAttribute("aria-pressed", b.getAttribute("aria-pressed") !== "true"); }); }
const pickedTags = el => [...el.querySelectorAll('.tagbtn[aria-pressed="true"]')].map(b => b.dataset.tag);

/* ---------------- Theme, nav, banner ---------------- */
const root = document.documentElement;
function setTheme(t){ root.dataset.theme = t; $("#themeBtn").textContent = t === "dark" ? "☀️" : "🌙"; try{ localStorage.setItem("ss-theme", t); }catch(e){} }
let savedTheme = null; try{ savedTheme = localStorage.getItem("ss-theme"); }catch(e){}
setTheme(savedTheme || (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark"));
$("#themeBtn").onclick = () => setTheme(root.dataset.theme === "dark" ? "light" : "dark");
$("#menuBtn").onclick = () => { const o = $("#navLinks").classList.toggle("open"); $("#menuBtn").setAttribute("aria-expanded", o); };
document.addEventListener("click", e => { if(e.target.closest(".nav-links a")) $("#navLinks").classList.remove("open"); });
function updateNav(){
  const s = me(), acc = $("#accountBtn"), cta = $("#ctaBtn");
  if(s){ acc.textContent = "👤 " + s.name.split(" ")[0]; acc.href = "#/profile"; cta.textContent = "Register"; cta.href = "#events"; }
  else if(state.user && isAdminEmail(state.user)){ acc.textContent = "🔐 Admin"; acc.href = "#/admin"; cta.textContent = "Events"; cta.href = "#events"; }
  else if(state.user){ acc.textContent = "Complete profile"; acc.href = "#/signup"; cta.textContent = "Events"; cta.href = "#events"; }
  else { acc.textContent = "Sign in"; acc.href = "#/login"; cta.textContent = "Create account"; cta.href = "#/signup"; }
}
function renderBanner(){
  const b = $("#sysBanner"); let html = "";
  if(!configured) html = `⚙️ <b>Setup needed:</b> paste your Firebase config into <code>firebase-config.js</code>. Until then accounts and registrations are disabled.`;
  else if(state.settingsLoaded && !state.settings) html = `🎄 Registrations open soon. <span class="note">Organizers: sign in to the <a href="#/admin">admin panel</a> and click “Initialize site”.</span>`;
  b.innerHTML = html; b.hidden = !html;
}

/* ---------------- Router ---------------- */
const VIEWS = ["home","signup","login","profile","foryou","admin"];
const renderers = {home:renderHome, signup:renderSignup, login:renderLogin, profile:renderProfile, foryou:renderForYou, admin:renderAdmin};
function route(){
  const h = location.hash; let v = "home", anchor = null;
  if(h.startsWith("#/")) v = h.slice(2).split("?")[0] || "home"; else if(h.length > 1) anchor = h.slice(1);
  if(!VIEWS.includes(v)) v = "home";
  if(v === "profile" && state.authReady){ if(!state.user) return go("login"); if(!state.profile) return go(isAdminEmail(state.user) ? "admin" : "signup"); }
  const changed = v !== currentView; currentView = v;
  $$("[data-view]").forEach(s => s.hidden = s.dataset.view !== v);
  renderers[v](); updateNav(); renderBanner();
  if(changed || anchor) requestAnimationFrame(() => { const el = anchor && document.getElementById(anchor); el ? el.scrollIntoView() : window.scrollTo(0, 0); });
}
window.addEventListener("hashchange", route);
/* When live data changes, re-render only views that have no half-filled forms */
function softRefresh(){
  if(currentView === "home") renderHome();
  else if(currentView === "profile") renderProfile();
  else if(currentView === "admin") adminRefresh();
  else if(currentView === "foryou" && $("#fyResults").innerHTML) showForYou(lastFyText);
  updateNav(); renderBanner();
}
const loading = msg => `<div class="empty">${msg || "Loading…"}</div>`;

/* ---------------- Home ---------------- */
let currentCat = "all";
function renderHome(){ renderEvents(); renderTimeline(); updateStats(); renderRec(); }
function updateStats(){
  $("#statRegs").textContent = Object.values(state.seats).reduce((a, b) => a + b, 0);
  $("#statSeats").textContent = events().reduce((s, e) => s + Math.max(e.seats - taken(e.id), 0), 0);
}
function renderRec(){
  const s = me(), text = interestText(s);
  const top = text ? rankEvents(text).filter(x => x.hits.length).slice(0, 2) : [];
  $("#recStrip").innerHTML = top.length
    ? `<div class="rec"><span>✨ Picked for you: <b>${top.map(x => esc(x.e.name)).join("</b> &amp; <b>")}</b></span><a href="#/foryou" class="btn btn-ghost btn-sm">See why →</a></div>`
    : `<div class="rec"><span>✨ Not sure where to start? Tell us what you like and we'll suggest events <b>only for you</b>.</span><a href="#/foryou" class="btn btn-ghost btn-sm">Find my events →</a></div>`;
}
function eventCard(e, hits){
  const st = me(), t = taken(e.id), left = Math.max(e.seats - t, 0), pct = Math.min(t / e.seats * 100, 100), mine = st && myReg(e.id);
  let foot;
  if(mine) foot = `<button class="btn btn-ghost btn-sm" data-ticket="${esc(mine.event)}">✓ Registered · View ticket</button>`;
  else { const why = blockReason(e, st);
    foot = why ? `<button class="btn btn-primary btn-sm" disabled>Unavailable</button><span class="note">${esc(why)}</span>`
               : `<button class="btn btn-primary btn-sm" data-reg="${e.id}">${st ? "Register now →" : "Sign in to register →"}</button>`; }
  return `<article class="card" style="--accent:${e.accent}">
    <div class="card-top"><div class="card-icon">${e.icon}</div><div class="badges">${hits && hits.length ? `<span class="match">${hits.length >= 3 ? "Top match" : "Good match"}</span>` : ""}<span class="tag">${e.cat}</span></div></div>
    <div><h3>${e.name}</h3><p class="sub">${e.sub}</p></div>
    <p class="desc">${e.desc}</p>
    ${hits && hits.length ? `<p class="why">Because you like <b>${hits.slice(0, 5).map(esc).join("</b>, <b>")}</b></p>` : ""}
    <div class="meta"><span>🕒 <b>${fmtH(e.start)} – ${fmtH(e.end)}</b></span><span>👥 <b>${e.team ? "Solo or team (up to " + e.team.max + ")" : "Individual"}</b></span><span>🎓 <b>${yearsText(e.years)}</b></span></div>
    <div class="seats">${left ? `<b>${left}</b> of ${e.seats} slots left` : "<b>Full</b>"}<div class="bar"><i style="width:${pct}%"></i></div></div>
    <div class="card-foot">${foot}</div>
  </article>`;
}
function renderEvents(){
  const q = $("#search").value.trim().toLowerCase();
  const list = events().filter(e => (currentCat === "all" || e.cat === currentCat) && (!q || (e.name + " " + e.sub + " " + e.desc + " " + e.cat).toLowerCase().includes(q)));
  $("#eventGrid").innerHTML = list.length ? list.map(e => eventCard(e)).join("") : `<div class="empty">No events match “${esc(q)}”. Try another search.</div>`;
}
$$(".filter").forEach(b => b.onclick = () => { currentCat = b.dataset.cat; $$(".filter").forEach(x => x.setAttribute("aria-pressed", x === b)); renderEvents(); });
$("#search").addEventListener("input", renderEvents);
document.addEventListener("click", e => {
  const r = e.target.closest("[data-reg]"); if(r) return openReg(r.dataset.reg);
  const t = e.target.closest("[data-ticket]"); if(t){ const reg = myReg(t.dataset.ticket); if(reg) showTicket(reg); }
});
function renderTimeline(){
  const now = new Date(), sched = [...events().map(e => ({icon:e.icon, name:e.name, start:e.start, end:e.end})), {icon:"🎉", name:"Closing Ceremony", start:18, end:20}];
  $("#timeline").innerHTML = sched.map(s => {
    const at = h => new Date(`${EVENT_DATE}T${String(h).padStart(2, "0")}:00:00+05:30`);
    const st = now >= at(s.end) ? ["done","✓ Done"] : now >= at(s.start) ? ["live","● Live now"] : ["","Upcoming"];
    return `<div class="slot"><div class="dot">${s.icon}</div><div class="slot-body"><div><h3>${s.name}</h3><small>${fmtH(s.start)} – ${fmtH(s.end)} · Genesis Building</small></div><span class="status ${st[0]}">${st[1]}</span></div></div>`;
  }).join("");
}

/* ---------------- Sign up / complete / edit profile ---------------- */
function signupMode(){ if(!state.user) return "new"; if(!state.profile) return "complete"; return "edit"; }
function renderSignup(){
  const form = $("#signupForm");
  if(!configured){ form.innerHTML = `<div class="notice warn">Accounts aren't available yet — the site is still being set up.</div>`; return; }
  if(!state.authReady){ form.innerHTML = loading(); return; }
  const mode = signupMode(), s = state.profile, set = settings();
  const titles = {new:["Student account","Create your account","One account for all Santa Soirée events. Your details are filled in automatically whenever you register."],
                  complete:["Almost there","Complete your profile","Add your student details to start registering for events."],
                  edit:["Your profile","Edit your profile","Keep your details up to date."]}[mode];
  $("#signupEyebrow").textContent = titles[0]; $("#signupTitle").textContent = titles[1]; $("#signupLead").textContent = titles[2];
  if(mode === "new" && state.settingsLoaded && !state.settings){ form.innerHTML = `<div class="notice">🎄 Sign-ups open soon. Please check back later.</div>`; return; }
  if(mode === "new" && state.settings && !set.signupOpen){ form.innerHTML = `<div class="notice warn">New account sign-ups are closed right now. Please check back later or contact the coordinators.</div><a href="#/login" class="btn btn-ghost">Sign in instead</a>`; return; }
  const year = s ? s.year : 1, email = s ? s.email : (state.user ? state.user.email : "");
  form.innerHTML = `
    <fieldset class="fs"><legend>👤 Personal details</legend>
      <div class="field"><label for="s-name">Full name</label><input id="s-name" name="name" autocomplete="name" maxlength="100" value="${esc(s?.name || state.user?.displayName || "")}" required></div>
      <div class="row">
        <div class="field"><label for="s-email">Email</label><input id="s-email" name="email" type="email" autocomplete="email" value="${esc(email)}" ${mode === "new" ? "" : "readonly"} required><span class="hint" id="emailHint"></span></div>
        <div class="field"><label for="s-phone">Phone</label><input id="s-phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="10-digit number" value="${esc(s?.phone)}" required></div>
      </div>
      ${mode === "complete" ? "" : `<div class="row">
        <div class="field"><label for="s-pw">${mode === "edit" ? "New password <span class='hint'>(leave blank to keep)</span>" : "Password"}</label><input id="s-pw" name="pw" type="password" autocomplete="new-password"><span class="hint">At least 6 characters.</span></div>
        <div class="field"><label for="s-pw2">Confirm password</label><input id="s-pw2" name="pw2" type="password" autocomplete="new-password"></div>
      </div>`}
    </fieldset>
    <fieldset class="fs"><legend>🎓 Student details</legend>
      <span class="lbl">Year of study</span>
      <div class="seg four" role="radiogroup" aria-label="Year of study" style="margin-top:6px">
        ${[1,2,3,4].map(y => `<label><input type="radio" name="year" value="${y}" ${y === year ? "checked" : ""}> ${ord(y)}</label>`).join("")}
      </div>
      <div class="row">
        <div class="field"><label for="s-enr">Enrollment number</label><input id="s-enr" name="enrollment" maxlength="40" value="${esc(s?.enrollment)}" required></div>
        <div class="field"><label for="s-roll">University roll number</label><input id="s-roll" name="roll" maxlength="40" value="${esc(s?.roll)}" required></div>
      </div>
      <div class="row">
        <div class="field"><label for="s-dept">Department</label><input id="s-dept" name="dept" list="deptList" maxlength="60" placeholder="e.g. CSE AIML" value="${esc(s?.dept)}" required><datalist id="deptList">${DEPARTMENTS.map(d => `<option value="${d}">`).join("")}</datalist></div>
        <div class="field"><label for="s-sec">Section / batch <span class="hint">(optional)</span></label><input id="s-sec" name="section" maxlength="20" placeholder="e.g. A" value="${esc(s?.section)}"></div>
      </div>
    </fieldset>
    <fieldset class="fs"><legend>✨ Areas of interest</legend>
      <p class="lead">Pick at least one. We use these to suggest events made for you, and you can change them anytime.</p>
      <div class="tags" id="signupTags">${tagButtons(s?.interests || [])}</div>
      <div class="field" style="margin-top:14px"><label for="s-other">Anything else? <span class="hint">(optional)</span></label><input id="s-other" name="other" maxlength="200" placeholder="e.g. Arduino, anime art, chess" value="${esc(s?.interestsOther)}"></div>
    </fieldset>
    <p class="form-error" id="signupError" aria-live="assertive"></p>
    <div class="btnrow"><button class="btn btn-primary" type="submit" id="signupBtn">${{new:"Create account", complete:"Save profile", edit:"Save changes"}[mode]}</button>
      ${mode === "new" ? `<a href="#/login" class="btn btn-ghost">I already have an account</a>` : mode === "edit" ? `<a href="#/profile" class="btn btn-ghost">Cancel</a>` : `<button type="button" class="btn btn-ghost" id="cancelComplete">Sign out</button>`}</div>`;
  const setHint = y => { $("#emailHint").textContent = mode === "new" ? emailHint(y) : (emailRule(email, y) || "Email can't be changed."); };
  setHint(year);
  form.querySelectorAll('[name="year"]').forEach(r => r.onchange = () => setHint(+r.value));
  bindTags($("#signupTags"));
  if($("#cancelComplete")) $("#cancelComplete").onclick = () => signOutAll();
  form.onsubmit = e => submitSignup(e, mode);
}
async function submitSignup(ev, mode){
  ev.preventDefault();
  const form = $("#signupForm"), f = Object.fromEntries(new FormData(form)), err = $("#signupError"), btn = $("#signupBtn");
  const fail = (m, el) => { err.textContent = m; const x = el && form.elements[el]; if(x && x.focus) x.focus(); };
  err.textContent = "";
  const year = +f.year, email = String(f.email || "").trim().toLowerCase(), phone = String(f.phone || "").replace(/[\s-]/g, "");
  if(!String(f.name || "").trim()) return fail("Please enter your full name.", "name");
  if(!emailOk(email)) return fail("Please enter a valid email address.", "email");
  const rule = emailRule(email, year); if(rule) return fail(rule, "email");
  if(!/^\+?\d{10,13}$/.test(phone)) return fail("Please enter a valid phone number.", "phone");
  if(mode === "new" || f.pw){ if(String(f.pw || "").length < 6) return fail("Password must be at least 6 characters.", "pw"); if(f.pw !== f.pw2) return fail("Passwords don't match.", "pw2"); }
  if(![1,2,3,4].includes(year)) return fail("Please choose your year of study.");
  for(const [k, label] of [["enrollment","enrollment number"],["roll","roll number"],["dept","department"]]) if(!String(f[k] || "").trim()) return fail(`Please enter your ${label}.`, k);
  const tags = pickedTags($("#signupTags")), other = String(f.other || "").trim();
  if(!tags.length && !other) return fail("Please pick at least one area of interest.");
  const data = {name:f.name.trim().slice(0, 100), email, phone, year, enrollment:f.enrollment.trim(), roll:f.roll.trim(), dept:f.dept.trim(), section:String(f.section || "").trim(),
    interests:tags, interestsOther:other, updatedAt:fb.serverTimestamp()};
  busy(btn, true, "Saving…");
  try{
    if(mode === "new"){
      state.authBusy = true;
      const cred = await fb.createUserWithEmailAndPassword(fb.auth, email, f.pw);
      try{ await fb.setDoc(D("students", cred.user.uid), {...data, createdAt:fb.serverTimestamp()}); }
      catch(e2){ await cred.user.delete().catch(() => {}); throw e2; }
      fb.sendEmailVerification(cred.user).catch(() => {});
      await loadUser(cred.user);
      toast(`Welcome, ${data.name.split(" ")[0]}! 🎄`);
    }else if(mode === "complete"){
      await fb.setDoc(D("students", state.user.uid), {...data, createdAt:fb.serverTimestamp()});
      await loadUser(state.user); toast("Profile saved ✓");
    }else{
      await fb.setDoc(D("students", state.user.uid), data, {merge:true});
      if(f.pw) await fb.updatePassword(state.user, f.pw);
      await loadUser(state.user); toast("Profile updated ✓");
    }
    state.authBusy = false; state.authReady = true;
    afterAuth();
  }catch(e){ state.authBusy = false; fail(errMsg(e)); }
  finally{ busy(btn, false); }
}
function afterAuth(){
  if(pendingEvent && state.profile){ const p = pendingEvent; pendingEvent = null; location.hash = "#events"; setTimeout(() => openReg(p), 200); return; }
  if(!state.profile) return go(isAdminEmail(state.user) ? "admin" : "signup");
  go("profile");
}

/* ---------------- Login ---------------- */
function renderLogin(){
  $("#loginError").textContent = configured ? "" : "Sign-in isn't available yet — the site is still being set up.";
  if(configured && state.authReady && state.user) afterAuth();
}
$("#loginForm").addEventListener("submit", async e => {
  e.preventDefault();
  if(!fb) return;
  const email = $("#l-id").value.trim().toLowerCase(), pw = $("#l-pw").value, err = $("#loginError"), btn = $("#loginBtn");
  err.textContent = "";
  if(!emailOk(email) || !pw) return err.textContent = "Enter your email and password.";
  busy(btn, true, "Signing in…");
  try{
    state.authBusy = true;
    const cred = await fb.signInWithEmailAndPassword(fb.auth, email, pw);
    await loadUser(cred.user); state.authBusy = false; state.authReady = true;
    $("#loginForm").reset();
    if(state.profile) toast(`Welcome back, ${state.profile.name.split(" ")[0]}!`);
    afterAuth();
  }catch(x){ state.authBusy = false; err.textContent = errMsg(x); }
  finally{ busy(btn, false); }
});
$("#forgotBtn").addEventListener("click", async () => {
  if(!fb) return;
  const email = $("#l-id").value.trim().toLowerCase(), err = $("#loginError");
  if(!emailOk(email)){ err.textContent = "Type your email above first, then tap “Forgot password”."; $("#l-id").focus(); return; }
  try{ await fb.sendPasswordResetEmail(fb.auth, email); err.textContent = ""; toast("If an account exists, a reset link has been sent to " + email, 5000); }
  catch(x){ err.textContent = errMsg(x); }
});

/* ---------------- Profile ---------------- */
function renderProfile(){
  const body = $("#profileBody");
  if(!state.authReady || !state.profile){ body.innerHTML = loading(); return; }
  const s = state.profile, mine = state.myRegs, interests = [...(s.interests || []), ...(s.interestsOther ? [s.interestsOther] : [])], set = settings();
  body.innerHTML = `
    <div class="page-head"><span class="eyebrow">My account</span><h1>Hi, ${esc(s.name.split(" ")[0])} 👋</h1></div>
    ${state.user && !state.user.emailVerified ? `<div class="notice">📧 Please verify your email — we sent a link to <b>${esc(s.email)}</b>. <button class="link-btn" id="resendVerify">Resend link</button></div>` : ""}
    <div class="profile-grid">
      <div class="panel">
        <div class="profile-id"><div class="avatar lg">${esc(initials(s.name))}</div><div><h2>${esc(s.name)}</h2><p>${ord(s.year)} year · ${esc(s.dept)}${s.section ? " · Sec " + esc(s.section) : ""}</p></div></div>
        <p class="subhead">Student details</p>
        <dl class="dl"><dt>Department</dt><dd>${esc(s.dept)}</dd><dt>Year</dt><dd>${ord(s.year)} year</dd>${s.section ? `<dt>Section</dt><dd>${esc(s.section)}</dd>` : ""}<dt>Enrollment no.</dt><dd>${esc(s.enrollment)}</dd><dt>Roll no.</dt><dd>${esc(s.roll)}</dd><dt>Email</dt><dd>${esc(s.email)}</dd><dt>Phone</dt><dd>${esc(s.phone)}</dd></dl>
        <p class="subhead">Areas of interest</p>
        <div class="chiplist" style="margin-bottom:22px">${interests.length ? interests.map(i => `<span>${esc(i)}</span>`).join("") : `<span class="note">No interests added yet</span>`}</div>
        <div class="btnrow"><a href="#/signup?edit" class="btn btn-ghost btn-sm">✏️ Edit profile</a><button class="btn btn-ghost btn-sm" id="signOut">Sign out</button>${isAdmin() ? `<a href="#/admin" class="btn btn-ghost btn-sm">🔐 Admin panel</a>` : ""}</div>
      </div>
      <div class="panel">
        <h3>🎟️ My registrations</h3>
        ${mine.length ? mine.map(r => { const e = byEvent(r.event); return `<div class="myreg"><div><h4>${e ? e.icon + " " + e.name : esc(r.event)}</h4><small><code>${esc(r.ticket)}</code> · ${e ? fmtH(e.start) + " – " + fmtH(e.end) : ""} · ${r.mode === "Team" ? "Team " + esc(r.team) : "Individual"}</small></div>
          <div class="btnrow"><button class="btn btn-ghost btn-sm" data-ticket="${esc(r.event)}">View ticket</button>${set.regOpen ? `<button class="btn btn-danger btn-sm" data-cancel="${esc(r.event)}">Cancel</button>` : ""}</div></div>`; }).join("")
          : `<p class="note" style="margin:10px 0 18px">You haven't registered for any events yet.</p>`}
        <div class="rec" style="margin:22px 0 0"><span>✨ See which events match <b>your interests</b></span><a href="#/foryou" class="btn btn-ghost btn-sm">For You →</a></div>
        <a href="#events" class="btn btn-primary btn-sm" style="margin-top:16px">Browse all events</a>
      </div>
    </div>`;
  $("#signOut").onclick = async () => { await signOutAll(); toast("Signed out"); location.hash = "#top"; };
  if($("#resendVerify")) $("#resendVerify").onclick = () => fb.sendEmailVerification(state.user).then(() => toast("Verification email sent"), x => toast(errMsg(x)));
  body.onclick = async e => {
    const c = e.target.closest("[data-cancel]"); if(!c || !confirm("Cancel this registration? Your seat will be released.")) return;
    const id = c.dataset.cancel + "_" + state.user.uid, b = fb.writeBatch(fb.db);
    b.delete(D("registrations", id)); b.delete(D("seats", id));
    try{ await b.commit(); toast("Registration cancelled"); }catch(x){ toast(errMsg(x)); }
  };
}

/* ---------------- For You ---------------- */
let lastFyText = "";
function renderForYou(){
  const s = me();
  $("#fyTags").innerHTML = tagButtons(s?.interests || []);
  $("#fyText").value = s?.interestsOther || "";
  $("#fySaveWrap").hidden = !s;
  if(s && interestText(s).replace(/[,\s]/g, "")) showForYou(interestText(s)); else $("#fyResults").innerHTML = "";
}
bindTags($("#fyTags"));
$("#fyForm").addEventListener("submit", async e => {
  e.preventDefault();
  const s = me(), tags = pickedTags($("#fyTags")), other = $("#fyText").value.trim();
  if(!tags.length && !other) return toast("Pick a tag or type an interest first");
  showForYou([...tags, other].join(", "));
  $("#fyResults").scrollIntoView({behavior:"smooth", block:"start"});
  if(s && $("#fySave").checked){
    try{ await fb.updateDoc(D("students", state.user.uid), {interests:tags, interestsOther:other.slice(0, 200), updatedAt:fb.serverTimestamp()}); state.profile = {...state.profile, interests:tags, interestsOther:other}; toast("Interests saved to your profile ✓"); }
    catch(x){ toast(errMsg(x)); }
  }
});
function showForYou(text){
  lastFyText = text;
  const ranked = rankEvents(text), matched = ranked.filter(x => x.hits.length), rest = ranked.filter(x => !x.hits.length), s = me();
  $("#fyResults").innerHTML = `
    ${matched.length ? `<div class="section-head" style="margin-bottom:24px"><span class="eyebrow">Only for you</span><h2>${matched.length} event${matched.length > 1 ? "s" : ""} picked for you</h2>${s ? "" : `<p><a href="#/signup" class="note">Create an account</a> to save your interests and register in one tap.</p>`}</div>
      <div class="events">${matched.map(x => eventCard(x.e, x.hits)).join("")}</div>`
      : `<div class="empty">We couldn't match those interests to an event yet. Try tags like “Coding”, “Gaming”, “Digital art” or “Robotics”, or browse everything below.</div>`}
    ${rest.length ? `<div class="section-head" style="margin:48px 0 24px"><span class="eyebrow">Also happening</span><h2>More at Santa Soirée</h2></div><div class="events">${rest.map(x => eventCard(x.e)).join("")}</div>` : ""}`;
}

/* ---------------- Event registration ---------------- */
const regDialog = $("#regDialog"), regForm = $("#regForm");
function openReg(id){
  const e = byEvent(id), st = me();
  if(!e) return;
  if(!configured) return toast("Registrations open soon");
  if(!state.user){ pendingEvent = id; toast("Sign in or create an account to register"); return go("login"); }
  if(!st){ pendingEvent = id; toast("Complete your profile first"); return go("signup"); }
  if(myReg(id)) return toast("You're already registered for this event");
  const why = blockReason(e, st); if(why) return toast(why);
  $("#regTitle").textContent = `${e.icon} ${e.name}`;
  regForm.dataset.event = id;
  regForm.innerHTML = `
    <div class="who"><div class="avatar">${esc(initials(st.name))}</div><div><b>${esc(st.name)}</b><small>${ord(st.year)} year · ${esc(st.dept)} · ${esc(st.enrollment)}</small></div><a href="#/signup?edit" class="link-btn" style="margin-left:auto" data-close>Edit</a></div>
    ${e.team ? `<div class="seg" role="radiogroup" aria-label="Registration type"><label><input type="radio" name="mode" value="Individual" checked> Individual</label><label><input type="radio" name="mode" value="Team"> Team (you lead)</label></div>` : ""}
    <div class="field"><label for="f-extra">${e.extra.label}</label><input id="f-extra" name="extra" placeholder="${e.extra.ph}" maxlength="120" required></div>
    ${e.team ? `<div id="teamFields" hidden>
      <div class="field"><label for="f-team">Team name</label><input id="f-team" name="team" maxlength="60"></div>
      <div class="field"><label for="f-members">Team members (name – roll no.)</label><textarea id="f-members" name="members" placeholder="One teammate per line"></textarea><span class="hint">Up to ${e.team.max - 1} teammates besides you.</span></div>
    </div>` : ""}
    <p class="form-error" id="formError" aria-live="assertive"></p>
    <button class="btn btn-primary" type="submit" id="regBtn" style="width:100%">Confirm registration</button>`;
  if(e.team) regForm.querySelectorAll('[name="mode"]').forEach(r => r.onchange = () => { $("#teamFields").hidden = regForm.mode.value !== "Team"; });
  regDialog.showModal(); setTimeout(() => $("#f-extra").focus(), 50);
}
regForm.addEventListener("submit", async ev => {
  ev.preventDefault();
  const e = byEvent(regForm.dataset.event), st = me(), f = Object.fromEntries(new FormData(regForm)), err = $("#formError"), btn = $("#regBtn");
  const fail = (m, el) => { err.textContent = m; if(el) regForm.elements[el].focus(); };
  if(!st) return fail("Please sign in again.");
  if(!String(f.extra || "").trim()) return fail(`Please fill in “${e.extra.label}”.`, "extra");
  let members = [];
  if(f.mode === "Team"){
    if(!String(f.team || "").trim()) return fail("Please add a team name.", "team");
    members = String(f.members || "").split("\n").map(s => s.trim().slice(0, 100)).filter(Boolean);
    if(!members.length) return fail("Add at least one teammate, or switch to Individual.", "members");
    if(members.length > e.team.max - 1) return fail(`A team can have at most ${e.team.max} people including you.`, "members");
  }
  const why = blockReason(e, st); if(why) return fail(why);
  if(myReg(e.id)) return fail("You're already registered for this event.");
  const uid = state.user.uid, id = `${e.id}_${uid}`;
  const reg = {ticket:`SS26-${e.id}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`, event:e.id, studentId:uid,
    name:st.name, roll:st.roll, enrollment:st.enrollment, email:st.email, phone:st.phone, dept:st.dept, year:st.year,
    extra:f.extra.trim(), mode:f.mode || "Individual", team:String(f.team || "").trim(), members, at:fb.serverTimestamp()};
  busy(btn, true, "Registering…");
  try{
    const b = fb.writeBatch(fb.db);
    b.set(D("registrations", id), reg);
    b.set(D("seats", id), {event:e.id, at:fb.serverTimestamp()});
    await b.commit();
    regDialog.close(); showTicket({...reg, at:new Date()}); toast(`Registered for ${e.name}! 🎄`);
  }catch(x){ fail(errMsg(x)); }
  finally{ busy(btn, false); }
});

/* ---------------- Ticket ---------------- */
function showTicket(r){
  const e = byEvent(r.event) || {icon:"🎟️", name:r.event, start:10, end:20};
  $("#ticketBody").innerHTML = `
    <div class="ticket">
      <div class="ticket-top"><small>Santa Soirée 2026 · Entry pass</small><h3>${e.icon} ${e.name}</h3></div>
      <div class="ticket-body">
        <div><small>Name</small><b>${esc(r.name)}</b></div>
        <div><small>Enrollment / roll</small><b>${esc(r.enrollment || r.roll)}</b></div>
        <div><small>Year &amp; dept</small><b>${r.year ? ord(r.year) + " year · " : ""}${esc(r.dept)}</b></div>
        <div><small>Entry</small><b>${r.mode === "Team" ? "Team · " + esc(r.team) : "Individual"}</b></div>
        <div><small>Date &amp; time</small><b>20 Dec · ${fmtH(e.start)} – ${fmtH(e.end)}</b></div>
        <div><small>Venue</small><b>Genesis Building</b></div>
      </div>
      <div class="ticket-cut"></div>
      <div class="ticket-body"><div class="ticket-id">${esc(r.ticket)}</div></div>
    </div>
    <div class="ticket-actions"><button class="btn btn-primary btn-sm" id="printTicket">🖨️ Print / Save ticket</button><button class="btn btn-ghost btn-sm" id="copyId">Copy ID</button></div>
    <p class="note" style="margin-top:12px">Show this ticket ID and your college ID at the venue.</p>`;
  $("#printTicket").onclick = () => { document.body.classList.add("print-ticket"); window.print(); };
  $("#copyId").onclick = () => { navigator.clipboard?.writeText(r.ticket).then(() => toast("Ticket ID copied"), () => toast(r.ticket)); };
  $("#ticketDialog").showModal();
}
window.addEventListener("afterprint", () => document.body.classList.remove("print-ticket"));

/* =====================================================================
   ADMIN PANEL — access = email in ADMIN_EMAILS + verified, enforced by firestore.rules
   ===================================================================== */
let adminTab = "overview", adminDraw = null, adminHadSettings = null;
const TABS = [["overview","📊 Overview"],["registrations","🎟️ Registrations"],["students","🎓 Students"],["events","🗓️ Events"],["settings","⚙️ Settings"]];
function startAdmin(){
  if(state.admin.live) return;
  state.admin.live = true; state.admin.loaded = 0;
  const onErr = x => { console.error(x); toast("Admin data: " + errMsg(x), 6000); };
  state.admin.unsubs = [
    fb.onSnapshot(C("students"), qs => { state.admin.students = qs.docs.map(d => ({id:d.id, ...d.data()})); state.admin.loaded |= 1; adminRefresh(); }, onErr),
    fb.onSnapshot(C("registrations"), qs => { state.admin.regs = qs.docs.map(d => ({docId:d.id, ...d.data()})); state.admin.loaded |= 2; adminRefresh(); }, onErr)
  ];
}
function stopAdmin(){ state.admin.unsubs.forEach(u => { try{ u(); }catch(e){} }); state.admin = {live:false, students:[], regs:[], unsubs:[], loaded:0}; }
function adminRefresh(){
  if(currentView !== "admin") return;
  if(!isAdmin() || !$("#adminPanel") || !!state.settings !== adminHadSettings) return renderAdmin();
  if(adminTab === "overview") adminOverview(); else if(adminDraw) adminDraw();
}
function renderAdmin(){
  const body = $("#adminBody"); adminDraw = null; adminHadSettings = null;
  if(!configured){ body.innerHTML = `<div class="set-card"><h3>⚙️ Firebase isn't connected yet</h3><p>Open <code>firebase-config.js</code>, paste your Firebase config and your organizer email, then re-upload the site. Full steps are in README.md.</p></div>`; return; }
  if(!state.authReady){ body.innerHTML = loading(); return; }
  const u = state.user;
  if(!u){
    body.innerHTML = `<div class="form-card narrow">
      <h3 style="font-size:22px;margin-bottom:6px">Organizer sign-in</h3><p class="note" style="margin-bottom:18px">Only emails listed as organizers can open the admin panel.</p>
      <button class="btn btn-ghost" id="gSignIn" style="width:100%;margin-bottom:16px">Continue with Google</button>
      <form id="adminLogin" novalidate>
        <div class="field"><label for="a-email">Email</label><input id="a-email" type="email" autocomplete="username"></div>
        <div class="field"><label for="a-pw">Password</label><input id="a-pw" type="password" autocomplete="current-password"></div>
        <p class="form-error" id="aErr"></p>
        <div class="btnrow"><button class="btn btn-primary" id="aLoginBtn">Sign in</button><button type="button" class="btn btn-ghost" id="aCreate">Create organizer account</button></div>
      </form></div>`;
    $("#gSignIn").onclick = async () => { try{ await fb.signInWithPopup(fb.auth, new fb.GoogleAuthProvider()); }catch(x){ $("#aErr").textContent = errMsg(x); } };
    const creds = () => [$("#a-email").value.trim().toLowerCase(), $("#a-pw").value];
    $("#adminLogin").onsubmit = async e => { e.preventDefault(); const [em, pw] = creds(); busy($("#aLoginBtn"), true); try{ await fb.signInWithEmailAndPassword(fb.auth, em, pw); }catch(x){ $("#aErr").textContent = errMsg(x); busy($("#aLoginBtn"), false); } };
    $("#aCreate").onclick = async () => { const [em, pw] = creds();
      if(!adminList.includes(em)) return $("#aErr").textContent = "This email isn't in the organizer list (firebase-config.js → ADMIN_EMAILS).";
      if(pw.length < 6) return $("#aErr").textContent = "Type your email and choose a password of at least 6 characters.";
      try{ const c = await fb.createUserWithEmailAndPassword(fb.auth, em, pw); await fb.sendEmailVerification(c.user); toast("Account created — check your inbox to verify your email", 6000); }catch(x){ $("#aErr").textContent = errMsg(x); } };
    return;
  }
  if(!isAdminEmail(u)){ body.innerHTML = `<div class="set-card"><h3>🚫 Not an organizer account</h3><p>You're signed in as <b>${esc(u.email)}</b>, which isn't in the organizer list.</p><button class="btn btn-ghost btn-sm" id="aOut">Sign out</button></div>`; $("#aOut").onclick = () => signOutAll(); return; }
  if(!u.emailVerified){
    body.innerHTML = `<div class="set-card"><h3>📧 Verify your email</h3><p>For security, organizer emails must be verified. Open the link we sent to <b>${esc(u.email)}</b>, then tap “I've verified”.</p>
      <div class="btnrow"><button class="btn btn-primary btn-sm" id="aCheck">I've verified</button><button class="btn btn-ghost btn-sm" id="aResend">Resend email</button><button class="btn btn-ghost btn-sm" id="aOut">Sign out</button></div></div>`;
    $("#aCheck").onclick = async () => { await u.reload(); await u.getIdToken(true); state.user = fb.auth.currentUser; if(state.user.emailVerified){ toast("Verified ✓"); renderAdmin(); } else toast("Not verified yet — check your inbox (and spam)"); };
    $("#aResend").onclick = () => fb.sendEmailVerification(u).then(() => toast("Verification email sent"), x => toast(errMsg(x)));
    $("#aOut").onclick = () => signOutAll();
    return;
  }
  if(!state.settingsLoaded){ body.innerHTML = loading(); return; }
  adminHadSettings = !!state.settings;
  if(!state.settings){
    body.innerHTML = `<div class="set-card"><h3>🎄 Initialize site</h3><p>One-time setup: creates the site settings in Firestore (events, seats, registration window). Students can't sign up or register until this is done.</p><button class="btn btn-primary" id="initBtn">Initialize site</button></div>`;
    $("#initBtn").onclick = async () => {
      const evs = {}; BASE_EVENTS.forEach(e => { evs[e.id] = {open:true, seats:e.seats, years:[1,2,3,4], ...(e.team ? {teamMax:e.team.max} : {})}; });
      busy($("#initBtn"), true, "Setting up…");
      try{
        adminTab = "settings";
        await fb.setDoc(D("settings","main"), {...DEFAULT_SETTINGS, deadlineAt:fb.Timestamp.fromDate(new Date(DEFAULT_SETTINGS.deadline + "T23:59:59+05:30")), events:evs, updatedAt:fb.serverTimestamp()});
        toast("Site initialized ✓ — now set your email domain");
      }catch(x){ busy($("#initBtn"), false); toast(errMsg(x), 7000); }
    };
    return;
  }
  startAdmin();
  body.innerHTML = `<div class="tabs" role="tablist">${TABS.map(([k, l]) => `<button class="tab" role="tab" data-tab="${k}" aria-selected="${k === adminTab}">${l}</button>`).join("")}<button class="tab" id="aSignOut" style="margin-left:auto">Sign out</button></div><div id="adminPanel"></div>`;
  body.querySelectorAll("[data-tab]").forEach(b => b.onclick = () => { adminTab = b.dataset.tab; renderAdmin(); });
  $("#aSignOut").onclick = () => signOutAll();
  ({overview:adminOverview, registrations:adminRegs, students:adminStudents, events:adminEvents, settings:adminSettings})[adminTab]();
}
const studentOf = r => state.admin.students.find(s => s.id === r.studentId);
function adminOverview(){
  const S = state.admin.students, R = state.admin.regs, E = events(), set = settings(), max = Math.max(1, ...[1,2,3,4].map(y => S.filter(s => s.year === y).length));
  const warn = [];
  if(!cleanDomain(set.domain)) warn.push("Institutional email domain isn't set, so any email is accepted. Set it in <b>Settings</b>.");
  if(!set.regOpen) warn.push("Event registrations are currently <b>closed</b>.");
  if(state.admin.loaded !== 3){ $("#adminPanel").innerHTML = loading("Loading live data…"); return; }
  $("#adminPanel").innerHTML = `
    ${warn.map(w => `<div class="notice warn">${w}</div>`).join("")}
    <div class="kpis">
      <div class="kpi"><small>Student accounts</small><strong>${S.length}</strong></div>
      <div class="kpi"><small>Event registrations</small><strong>${R.length}</strong></div>
      <div class="kpi"><small>Seats left (all events)</small><strong>${E.reduce((a, e) => a + Math.max(e.seats - taken(e.id), 0), 0)}</strong></div>
      <div class="kpi"><small>Team entries</small><strong>${R.filter(r => r.mode === "Team").length}</strong></div>
    </div>
    <div class="grid2">
      <div class="set-card"><h3>Students by year</h3><p>Accounts created per year of study.</p>
        ${[1,2,3,4].map(y => { const n = S.filter(s => s.year === y).length; return `<div class="ybar"><span>${ord(y)} year</span><div class="bar" style="margin:0"><i style="width:${n / max * 100}%"></i></div><b>${n}</b></div>`; }).join("")}</div>
      <div class="set-card"><h3>Event fill rate</h3><p>Registrations against seat limits.</p>
        ${E.map(e => { const t = R.filter(r => r.event === e.id).length; return `<div class="ybar" style="grid-template-columns:150px 1fr 60px;--accent:${e.accent}"><span>${e.icon} ${e.name}</span><div class="bar" style="margin:0"><i style="width:${Math.min(t / e.seats * 100, 100)}%"></i></div><b>${t}/${e.seats}</b></div>`; }).join("")}</div>
    </div>
    <p class="note" style="margin-top:14px">🟢 Live — updates automatically as students register.</p>`;
}
function adminRegs(){
  $("#adminPanel").innerHTML = `
    <div class="admin-tools"><input type="search" id="aSearch" placeholder="Search name, enrollment, ticket ID, email, team…">
      <select id="aEvent"><option value="">All events</option>${events().map(e => `<option value="${e.id}">${e.name}</option>`).join("")}</select>
      <select id="aYear"><option value="">All years</option>${[1,2,3,4].map(y => `<option value="${y}">${ord(y)} year</option>`).join("")}</select>
      <button class="btn btn-primary btn-sm" id="csvRegs">⬇ Export CSV</button></div>
    <div class="table-wrap"><table><thead><tr><th>Ticket ID</th><th>Student</th><th>Year</th><th>Event</th><th>Entry</th><th>Contact</th><th>Details</th><th>Registered</th><th></th></tr></thead><tbody id="aRows"></tbody></table></div>
    <p class="note" style="margin-top:10px" id="aCount"></p>`;
  const filtered = () => { const q = $("#aSearch").value.toLowerCase(), ev = $("#aEvent").value, y = $("#aYear").value;
    return state.admin.regs.map(r => { const s = studentOf(r); return s ? {...r, name:s.name, roll:s.roll, enrollment:s.enrollment, email:s.email, phone:s.phone, dept:s.dept, year:s.year} : r; })
      .filter(r => (!ev || r.event === ev) && (!y || String(r.year) === y) && (!q || [r.ticket, r.name, r.roll, r.enrollment, r.email, r.team].join(" ").toLowerCase().includes(q)))
      .sort((a, b) => (toDate(b.at) || 0) - (toDate(a.at) || 0)); };
  adminDraw = () => { if(!$("#aRows")) return; const rows = filtered();
    $("#aRows").innerHTML = state.admin.loaded !== 3 ? `<tr><td colspan="9">${loading()}</td></tr>` : rows.length ? rows.map(r => `<tr>
      <td><code>${esc(r.ticket)}</code></td><td><b>${esc(r.name)}</b><br><small>${esc(r.enrollment || r.roll)} · ${esc(r.dept)}</small></td><td>${r.year ? ord(r.year) : "—"}</td>
      <td>${esc(byEvent(r.event)?.name || r.event)}</td><td>${r.mode === "Team" ? `<b>${esc(r.team)}</b><br><small>${(r.members || []).map(esc).join(", ")}</small>` : "Individual"}</td>
      <td>${esc(r.email)}<br><small>${esc(r.phone)}</small></td><td>${esc(r.extra)}</td><td><small>${fmtDT(r.at)}</small></td>
      <td><button class="act red" data-del="${esc(r.docId)}">Delete</button></td></tr>`).join("") : `<tr><td colspan="9" style="text-align:center;padding:28px" class="note">No registrations found.</td></tr>`;
    $("#aCount").textContent = `Showing ${rows.length} of ${state.admin.regs.length} registrations.`; };
  adminDraw();
  $("#aSearch").oninput = adminDraw; $("#aEvent").onchange = adminDraw; $("#aYear").onchange = adminDraw;
  $("#aRows").onclick = async e => { const id = e.target.dataset.del; if(!id || !confirm("Delete this registration? The student's seat will be released.")) return;
    const b = fb.writeBatch(fb.db); b.delete(D("registrations", id)); b.delete(D("seats", id));
    try{ await b.commit(); toast("Registration deleted"); }catch(x){ toast(errMsg(x)); } };
  $("#csvRegs").onclick = () => { const rows = filtered(); if(!rows.length) return toast("Nothing to export");
    download("santa-soiree-registrations.csv", toCSV(["Ticket ID","Event","Name","Enrollment","Roll","Year","Department","Email","Phone","Entry","Team","Members","Details","Registered at"],
      rows.map(r => [r.ticket, byEvent(r.event)?.name || r.event, r.name, r.enrollment, r.roll, r.year ? ord(r.year) : "", r.dept, r.email, r.phone, r.mode, r.team, (r.members || []).join("; "), r.extra, fmtDT(r.at)])), "text/csv;charset=utf-8");
    toast("CSV downloaded"); };
}
function adminStudents(){
  $("#adminPanel").innerHTML = `
    <div class="admin-tools"><input type="search" id="sSearch" placeholder="Search name, enrollment, roll, email, department, interest…">
      <select id="sYear"><option value="">All years</option>${[1,2,3,4].map(y => `<option value="${y}">${ord(y)} year</option>`).join("")}</select>
      <button class="btn btn-primary btn-sm" id="csvStu">⬇ Export CSV</button></div>
    <div class="table-wrap"><table><thead><tr><th>Student</th><th>Enrollment / roll</th><th>Department</th><th>Year</th><th>Contact</th><th>Areas of interest</th><th>Events</th><th></th></tr></thead><tbody id="sRows"></tbody></table></div>
    <p class="note" style="margin-top:10px" id="sCount"></p>`;
  const filtered = () => { const q = $("#sSearch").value.toLowerCase(), y = $("#sYear").value;
    return state.admin.students.filter(s => (!y || String(s.year) === y) && (!q || [s.name, s.enrollment, s.roll, s.email, s.dept, ...(s.interests || []), s.interestsOther].join(" ").toLowerCase().includes(q)))
      .sort((a, b) => String(a.name).localeCompare(String(b.name))); };
  adminDraw = () => { if(!$("#sRows")) return; const rows = filtered(), R = state.admin.regs;
    const count = k => { const m = {}; state.admin.students.forEach(s => { const v = String(s[k] || "").trim().toLowerCase(); if(v) m[v] = (m[v] || 0) + 1; }); return m; };
    const dupE = count("enrollment"), dupR = count("roll"), dup = (m, v) => m[String(v || "").trim().toLowerCase()] > 1 ? ` <span title="Duplicate — check this student">⚠️</span>` : "";
    $("#sRows").innerHTML = state.admin.loaded !== 3 ? `<tr><td colspan="8">${loading()}</td></tr>` : rows.length ? rows.map(s => `<tr>
      <td><b>${esc(s.name)}</b></td>
      <td>${esc(s.enrollment)}${dup(dupE, s.enrollment)}<br><small>${esc(s.roll)}${dup(dupR, s.roll)}</small></td><td>${esc(s.dept)}${s.section ? `<br><small>Sec ${esc(s.section)}</small>` : ""}</td><td>${ord(s.year)}</td>
      <td>${esc(s.email)}<br><small>${esc(s.phone)}</small></td>
      <td><small>${esc([...(s.interests || []), s.interestsOther].filter(Boolean).join(", ")) || "—"}</small></td>
      <td>${R.filter(r => r.studentId === s.id).map(r => esc(byEvent(r.event)?.name || r.event)).join("<br>") || "—"}</td>
      <td><button class="act" data-reset="${esc(s.id)}">Send password reset</button><button class="act red" data-sdel="${esc(s.id)}">Delete</button></td></tr>`).join("")
      : `<tr><td colspan="8" style="text-align:center;padding:28px" class="note">No student accounts found.</td></tr>`;
    $("#sCount").textContent = `Showing ${rows.length} of ${state.admin.students.length} students. ⚠️ marks duplicate enrollment/roll numbers.`; };
  adminDraw();
  $("#sSearch").oninput = adminDraw; $("#sYear").onchange = adminDraw;
  $("#sRows").onclick = async e => {
    const r = e.target.dataset.reset, d = e.target.dataset.sdel;
    if(r){ const s = state.admin.students.find(x => x.id === r); if(!s) return;
      try{ await fb.sendPasswordResetEmail(fb.auth, s.email); toast(`Password reset email sent to ${s.email}`, 5000); }catch(x){ toast(errMsg(x)); } }
    if(d){ const s = state.admin.students.find(x => x.id === d); if(!s || !confirm(`Delete ${s.name}'s profile and all their registrations?\n\n(Their login stays in Firebase Authentication — remove it there if needed.)`)) return;
      const b = fb.writeBatch(fb.db); b.delete(D("students", d));
      state.admin.regs.filter(x => x.studentId === d).forEach(x => { b.delete(D("registrations", x.docId)); b.delete(D("seats", x.docId)); });
      try{ await b.commit(); toast("Student deleted"); }catch(x){ toast(errMsg(x)); } }
  };
  $("#csvStu").onclick = () => { const rows = filtered(), R = state.admin.regs; if(!rows.length) return toast("Nothing to export");
    download("santa-soiree-students.csv", toCSV(["Name","Enrollment","Roll","Year","Department","Section","Email","Phone","Areas of interest","Registered events","Account created"],
      rows.map(s => [s.name, s.enrollment, s.roll, ord(s.year), s.dept, s.section, s.email, s.phone,
        [...(s.interests || []), s.interestsOther].filter(Boolean).join("; "), R.filter(r => r.studentId === s.id).map(r => byEvent(r.event)?.name || r.event).join("; "), fmtDT(s.createdAt)])), "text/csv;charset=utf-8");
    toast("CSV downloaded"); };
}
function adminEvents(){
  $("#adminPanel").innerHTML = `<p class="note" style="margin-bottom:16px">Control seats, team size, which years can join, and whether each event is open. Changes go live instantly for everyone.</p>` +
    events().map(e => `<form class="ev-edit" data-ev="${e.id}" style="--accent:${e.accent}">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap"><h3>${e.icon} ${e.name}</h3><label class="switch"><input type="checkbox" name="open" ${e.open ? "checked" : ""}> Accepting registrations</label></div>
      <div class="row">
        <div class="field" style="margin:0"><label>Seats / slots (${taken(e.id)} taken)</label><input type="number" name="seats" min="${taken(e.id)}" value="${e.seats}"></div>
        ${e.team ? `<div class="field" style="margin:0"><label>Max team size</label><input type="number" name="teamMax" min="2" max="10" value="${e.team.max}"></div>` : `<div></div>`}
      </div>
      <div><span class="lbl">Open to</span><div class="checks" style="margin-top:6px">${[1,2,3,4].map(y => `<label><input type="checkbox" name="years" value="${y}" ${e.years.includes(y) ? "checked" : ""}> ${ord(y)} year</label>`).join("")}</div></div>
      <div><button class="btn btn-primary btn-sm">Save ${e.name}</button></div>
    </form>`).join("");
  $$(".ev-edit").forEach(f => f.onsubmit = async ev => {
    ev.preventDefault();
    const id = f.dataset.ev, years = [...f.querySelectorAll('[name="years"]:checked')].map(x => +x.value), seats = parseInt(f.seats.value, 10);
    if(!years.length) return toast("Select at least one year");
    if(isNaN(seats) || seats < taken(id)) return toast(`Seats can't be less than the ${taken(id)} already registered`);
    const val = {open:f.open.checked, seats, years};
    if(f.teamMax){ const t = parseInt(f.teamMax.value, 10); if(isNaN(t) || t < 2) return toast("Team size must be at least 2"); val.teamMax = t; }
    try{ await fb.updateDoc(D("settings","main"), {["events." + id]:val, updatedAt:fb.serverTimestamp()}); toast(`${byEvent(id).name} updated ✓`); }catch(x){ toast(errMsg(x)); }
  });
}
function adminSettings(){
  const s = settings();
  $("#adminPanel").innerHTML = `<div class="settings">
    <form class="set-card" id="setAccess"><h3>🔑 Account &amp; email rules</h3><p>2nd–4th year students must sign up with the institutional email domain. 1st years can be allowed to use personal emails. Firestore security rules enforce this too.</p>
      <div class="field"><label for="setDomain">Institutional email domain</label><input id="setDomain" placeholder="e.g. college.edu.in" value="${esc(s.domain)}"><span class="hint">Without the @. Leave blank to accept any email.</span></div>
      <label class="switch" style="margin-bottom:12px"><input type="checkbox" id="setPersonal" ${s.allowPersonalFirstYear ? "checked" : ""}> Allow personal emails for 1st year students</label>
      <label class="switch" style="margin-bottom:16px"><input type="checkbox" id="setSignup" ${s.signupOpen ? "checked" : ""}> Allow new account sign-ups</label>
      <button class="btn btn-primary btn-sm">Save account rules</button></form>
    <form class="set-card" id="setReg"><h3>🎟️ Registration window</h3><p>Close all event registrations at once, or set a last date.</p>
      <label class="switch" style="margin-bottom:14px"><input type="checkbox" id="setOpen" ${s.regOpen ? "checked" : ""}> Event registrations open</label>
      <div class="field"><label for="setDeadline">Last date to register</label><input id="setDeadline" type="date" value="${esc(s.deadline)}"><span class="hint">Registrations close at 11:59 PM IST on this day. Leave blank for no deadline.</span></div>
      <button class="btn btn-primary btn-sm">Save registration window</button></form>
    <div class="set-card"><h3>🔐 Organizers</h3><p>Organizer access comes from the email list in <code>firebase-config.js</code> and <code>firestore.rules</code>. To add or remove an organizer, edit both files and redeploy.</p>
      <div class="chiplist">${adminList.map(e => `<span>${esc(e)}</span>`).join("")}</div></div>
    <div class="set-card"><h3>💾 Backup</h3><p>Download all students, registrations and settings as a JSON file. Firebase also keeps everything safely in the cloud.</p>
      <button class="btn btn-ghost btn-sm" id="backupBtn">⬇ Download backup (.json)</button></div>
  </div>`;
  $("#setAccess").onsubmit = async e => { e.preventDefault(); const d = cleanDomain($("#setDomain").value);
    if(d && !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)) return toast("Enter a valid domain, e.g. college.edu.in");
    try{ await fb.setDoc(D("settings","main"), {domain:d, allowPersonalFirstYear:$("#setPersonal").checked, signupOpen:$("#setSignup").checked, updatedAt:fb.serverTimestamp()}, {merge:true}); toast("Account rules saved ✓"); }catch(x){ toast(errMsg(x)); } };
  $("#setReg").onsubmit = async e => { e.preventDefault(); const dl = $("#setDeadline").value;
    try{ await fb.setDoc(D("settings","main"), {regOpen:$("#setOpen").checked, deadline:dl, deadlineAt:dl ? fb.Timestamp.fromDate(new Date(dl + "T23:59:59+05:30")) : null, updatedAt:fb.serverTimestamp()}, {merge:true}); toast("Registration window saved ✓"); }catch(x){ toast(errMsg(x)); } };
  $("#backupBtn").onclick = () => {
    const plain = o => JSON.parse(JSON.stringify(o ?? null, (k, v) => v && typeof v.toDate === "function" ? v.toDate().toISOString() : v));
    download(`santa-soiree-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({app:"santa-soiree-2026", exportedAt:new Date().toISOString(), settings:plain(state.settings), students:plain(state.admin.students), registrations:plain(state.admin.regs)}, null, 2), "application/json");
    toast("Backup downloaded"); };
}

/* ---------------- Firebase boot ---------------- */
async function signOutAll(){
  stopAdmin();
  if(state.myRegsUnsub){ state.myRegsUnsub(); state.myRegsUnsub = null; }
  await fb.signOut(fb.auth);
}
async function loadUser(u){
  state.user = u; state.profile = null; state.myRegs = [];
  if(state.myRegsUnsub){ state.myRegsUnsub(); state.myRegsUnsub = null; }
  if(!u){ stopAdmin(); return; }
  try{ const p = await fb.getDoc(D("students", u.uid)); state.profile = p.exists() ? {id:u.uid, ...p.data()} : null; }
  catch(e){ console.error("profile", e); }
  state.myRegsUnsub = fb.onSnapshot(fb.query(C("registrations"), fb.where("studentId", "==", u.uid)),
    qs => { state.myRegs = qs.docs.map(d => ({docId:d.id, ...d.data()})); softRefresh(); }, e => console.error("myRegs", e));
}
async function boot(){
  if(!configured){ state.authReady = true; route(); return; }
  try{
    const [appM, authM, fsM] = await Promise.all([import(`${SDK}/firebase-app.js`), import(`${SDK}/firebase-auth.js`), import(`${SDK}/firebase-firestore.js`)]);
    const app = appM.initializeApp(firebaseConfig);
    fb = {...authM, ...fsM, auth:authM.getAuth(app), db:fsM.getFirestore(app)};
  }catch(e){
    console.error(e); state.authReady = true; route();
    $("#sysBanner").hidden = false; $("#sysBanner").innerHTML = "⚠️ Couldn't load Firebase. Check your internet connection and refresh.";
    return;
  }
  fb.onSnapshot(D("settings","main"), s => { state.settings = s.exists() ? s.data() : null; state.settingsLoaded = true; softRefresh(); },
    e => { console.error("settings", e); state.settingsLoaded = true; softRefresh(); });
  fb.onSnapshot(C("seats"), qs => { const c = {}; qs.forEach(d => { const ev = d.data().event; c[ev] = (c[ev] || 0) + 1; }); state.seats = c; softRefresh(); },
    e => console.error("seats", e));
  fb.onAuthStateChanged(fb.auth, async u => {
    if(state.authBusy){ state.user = u; return; }
    await loadUser(u);
    state.authReady = true;
    route();
  });
}

/* ---------------- Countdown, tree, snow, dialogs ---------------- */
function tick(){
  const now = Date.now(), d = START - now, set = (id, v) => $("#" + id).textContent = String(v).padStart(2, "0");
  if(d <= 0){ ["days","hours","minutes","seconds"].forEach(x => set(x, 0));
    $("#cdMessage").textContent = now < END ? "🔴 Santa Soirée is live right now at the Genesis Building!" : "🎄 Thank you for celebrating with us. See you next year!"; return; }
  set("days", Math.floor(d / 864e5)); set("hours", Math.floor(d % 864e5 / 36e5)); set("minutes", Math.floor(d % 36e5 / 6e4)); set("seconds", Math.floor(d % 6e4 / 1e3));
}
tick(); setInterval(tick, 1000);
(() => { const colors = ["#ff5a5f","#f3c56b","#5aa9ff","#ff7ab8","#fff"], spots = [[118,80],[140,112],[100,128],[90,170],[150,162],[120,196],[70,236],[176,224],[110,250],[60,290],[140,284],[196,292],[98,300]];
  spots.forEach(([x, y], i) => { const l = document.createElement("span"), c = colors[i % colors.length]; l.className = "light";
    l.style.cssText = `left:${x}px;top:${y}px;background:${c};box-shadow:0 0 10px ${c};animation-delay:${(i % 5) * .35}s`; $("#tree").appendChild(l); }); })();
if(!matchMedia("(prefers-reduced-motion: reduce)").matches){
  for(let i = 0; i < 20; i++){ const s = document.createElement("span"); s.className = "snow"; s.textContent = "❄"; s.setAttribute("aria-hidden", "true");
    s.style.cssText = `left:${Math.random() * 100}%;font-size:${8 + Math.random() * 12}px;animation-duration:${8 + Math.random() * 10}s;animation-delay:${-Math.random() * 15}s;opacity:${.3 + Math.random() * .5}`;
    document.body.appendChild(s); }
}
$$("dialog").forEach(d => d.addEventListener("click", e => { if(e.target === d || e.target.closest("[data-close]")) d.close(); }));
const io = new IntersectionObserver(es => es.forEach(x => { if(x.isIntersecting){ x.target.classList.add("in"); io.unobserve(x.target); } }), {threshold:.1});
$$(".reveal").forEach(el => io.observe(el));
setInterval(() => { if(currentView === "home") renderTimeline(); }, 60000);

route();   // show the page immediately with default event data
boot();    // then connect to Firebase
})();
