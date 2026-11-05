(() => {
"use strict";

/* ---------- Constants ---------- */
const LS_KEY = "vykaz-hodin-v1";
const STAGES = ["Štúdia", "DÚR", "DSP", "DÚSP", "DRS", "DSRS", "DVZ", "RDS", "Autorský dozor", "Posudok", "Iné"];
const DEFAULT_ACTS = ["Výkresová dokumentácia", "Výpočty a posudky", "BIM / 3D model", "Technická správa", "Výkaz výmer a rozpočet", "Koordinácia profesií", "Porada / rokovanie", "Obhliadka stavby", "Inžiniering a vyjadrenia", "Autorský dozor", "Kontrola a revízia", "Administratíva"];
const LAYERS = [
  { aci: 1, c: "#D7302A" }, { aci: 30, c: "#E8790F" }, { aci: 2, c: "#D9AE00" }, { aci: 3, c: "#2E9E44" },
  { aci: 4, c: "#12B5C9" }, { aci: 5, c: "#2350D9" }, { aci: 6, c: "#C02FB5" }, { aci: 8, c: "#7C8790" },
  { aci: 22, c: "#8B4A22" }, { aci: 62, c: "#8CC21A" }, { aci: 114, c: "#0B7A68" }, { aci: 190, c: "#7A3FE0" },
  { aci: 220, c: "#F06BA8" }, { aci: 242, c: "#7D1D3F" }
];
const DAYS = ["Po", "Ut", "St", "Št", "Pi", "So", "Ne"];
const MONTHS = ["január","február","marec","apríl","máj","jún","júl","august","september","október","november","december"];
const MONTHS_G = ["januára","februára","marca","apríla","mája","júna","júla","augusta","septembra","októbra","novembra","decembra"];
const DAYNAMES = ["nedeľa","pondelok","utorok","streda","štvrtok","piatok","sobota"];
const DEL = Symbol("delete");

/* ---------- Helpers ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const pad = n => String(n).padStart(2, "0");
const ds = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const todayStr = () => ds(new Date());
const parseD = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const weekStart = d => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); const wd = (x.getDay() + 6) % 7; return addDays(x, -wd); };
const hm = d => pad(d.getHours()) + ":" + pad(d.getMinutes());
const toMin = t => { if (!t) return null; const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const fromMin = m => pad(Math.floor(m / 60) % 24) + ":" + pad(m % 60);
const hrs = min => { const v = Math.round(min / 60 * 100) / 100; return v.toLocaleString("sk-SK", { minimumFractionDigits: 0, maximumFractionDigits: 2 }); };
const hrs1 = min => (Math.round(min / 60 * 10) / 10).toLocaleString("sk-SK", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const parseNum = s => { const v = parseFloat(String(s).replace(",", ".").replace(/\s/g, "")); return isFinite(v) ? v : null; };
function parseDuration(s) {
  s = String(s || "").trim().toLowerCase();
  if (!s) return null;
  let m;
  if ((m = s.match(/^(\d+):(\d{1,2})$/))) return +m[1] * 60 + +m[2];
  if ((m = s.match(/^(\d+)\s*h\s*(\d+)\s*m(in)?$/))) return +m[1] * 60 + +m[2];
  if ((m = s.match(/^(\d+)\s*m(in)?$/))) return +m[1];
  const v = parseNum(s.replace(/h$/, ""));
  return v == null ? null : Math.round(v * 60);
}
const longDate = s => { const d = parseD(s); return DAYNAMES[d.getDay()] + " " + d.getDate() + ". " + MONTHS_G[d.getMonth()]; };
const shortDate = d => d.getDate() + ". " + (d.getMonth() + 1) + ".";
const clone = o => JSON.parse(JSON.stringify(o));

let toastT;
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 3200); }

/* ---------- Store: IndexedDB, one record per document ---------- */
const DB_NAME = "vykaz-hodin", DB_VER = 2, BACKUP_DAYS = 7;
const hasData = docs => Object.keys(docs || {}).some(k => (k === "projects" && docs[k] && docs[k].items && docs[k].items.length) || k.startsWith("e-"));
const fmtDay = ts => { const d = new Date(ts); return d.getDate() + ". " + (d.getMonth() + 1) + ". " + d.getFullYear(); };

const Store = {
  db: null, docs: {}, meta: {}, bc: null, persisted: null, usage: null,
  open() {
    return new Promise((res, rej) => {
      if (!("indexedDB" in window)) { rej(new Error("no-idb")); return; }
      const rq = indexedDB.open(DB_NAME, DB_VER);
      rq.onupgradeneeded = () => {
        const db = rq.result;
        if (!db.objectStoreNames.contains("docs")) db.createObjectStore("docs");
        if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
        if (db.objectStoreNames.contains("kv")) db.deleteObjectStore("kv"); // leftover from the file-sync version
      };
      rq.onsuccess = () => { const db = rq.result; db.onversionchange = () => db.close(); res(db); };
      rq.onerror = () => rej(rq.error);
      rq.onblocked = () => toast("Zatvorte ostatné karty s touto aplikáciou a obnovte stránku.");
    });
  },
  readAll(name) {
    return new Promise((res, rej) => {
      const out = {}, tx = this.db.transaction(name), rq = tx.objectStore(name).openCursor();
      rq.onsuccess = () => { const c = rq.result; if (c) { out[c.key] = c.value; c.continue(); } };
      tx.oncomplete = () => res(out); tx.onerror = () => rej(tx.error);
    });
  },
  write(name, entries, clearFirst) {
    return new Promise((res, rej) => {
      const tx = this.db.transaction(name, "readwrite"), st = tx.objectStore(name);
      if (clearFirst) st.clear();
      entries.forEach(([k, v]) => { if (v === DEL) st.delete(k); else st.put(v, k); });
      tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error);
    });
  },
  async load() { this.docs = await this.readAll("docs"); this.meta = await this.readAll("meta"); },
  saved(p) {
    return p.then(() => { if (this.bc) this.bc.postMessage("changed"); renderStorageUI(); })
      .catch(e => toast(e && e.name === "QuotaExceededError" ? "Úložisko prehliadača je plné. Stiahnite zálohu a uvoľnite miesto." : "Zmenu sa nepodarilo uložiť do prehliadača."));
  },
  put(id, data) {
    if (data === DEL) delete this.docs[id]; else this.docs[id] = data;
    derive(); render();
    if (this.db) this.saved(this.write("docs", [[id, data]]));
  },
  replaceAll(docs) {
    this.docs = docs; derive(); render();
    if (this.db) return this.saved(this.write("docs", Object.entries(docs), true));
  },
  setMeta(k, v) { this.meta[k] = v; if (this.db) this.saved(this.write("meta", [[k, v]])); }
};

async function checkPersist(request) {
  const st = navigator.storage;
  if (!st || !st.persisted) { Store.persisted = null; return; }
  try {
    Store.persisted = await st.persisted();
    if (!Store.persisted && request && st.persist) Store.persisted = await st.persist();
    if (st.estimate) Store.usage = (await st.estimate()).usage;
  } catch (e) {}
}

function backupDue() {
  if (!hasData(Store.docs)) return false;
  const last = Store.meta.lastBackup || 0;
  return Date.now() - last > BACKUP_DAYS * 86400000;
}

function renderStorageUI() {
  const sync = $("#sync");
  sync.classList.toggle("err", !Store.db);
  sync.textContent = Store.db ? "" : "Neukladá sa – údaje sa po zatvorení stratia";
  $("#btnNudge").hidden = !Store.db || !backupDue();
  $("#btnPersist").hidden = Store.persisted !== false;
  const last = Store.meta.lastBackup;
  const parts = [];
  if (!Store.db) parts.push("Prehliadač nepovolil databázu IndexedDB (napríklad v súkromnom okne), preto sa nič neukladá. Otvorte aplikáciu v bežnom okne.");
  else {
    parts.push("Údaje sú v databáze IndexedDB tohto prehliadača na tomto zariadení" + (Store.usage != null ? ` (využité ${Math.max(1, Math.round(Store.usage / 1024)).toLocaleString("sk-SK")} kB)` : "") + ".");
    if (Store.persisted === true) parts.push("Prehliadač povolil trvalé uloženie – údaje sám nezmaže ani pri nedostatku miesta.");
    else if (Store.persisted === false) parts.push("Trvalé uloženie zatiaľ nie je povolené, takže pri nedostatku miesta ich prehliadač môže vymazať. Pomôže pridať stránku medzi záložky alebo ju nainštalovať ako aplikáciu.");
    parts.push("Ručné vymazanie údajov stránok v prehliadači zmaže aj záznamy – na to slúži záloha.");
    parts.push(last ? `Posledná záloha: ${fmtDay(last)}.` : "Zatiaľ ste si nestiahli žiadnu zálohu.");
  }
  $("#storageInfo").textContent = parts.join(" ");
}

async function initStore() {
  render();
  try {
    Store.db = await Store.open();
    await Store.load();
    // One-time move from the older localStorage version
    let legacy = null;
    try { const raw = localStorage.getItem(LS_KEY); legacy = raw ? JSON.parse(raw) : null; } catch (e) {}
    if (legacy && typeof legacy === "object") {
      if (!hasData(Store.docs) && hasData(legacy)) {
        await Store.write("docs", Object.entries(legacy), true);
        Store.docs = legacy;
        toast("Údaje z predchádzajúcej verzie som presunul do IndexedDB.");
      }
      try { [LS_KEY, LS_KEY + "-t", LS_KEY + "-seen"].forEach(k => localStorage.removeItem(k)); } catch (e) {}
    }
    // Keep several open tabs in sync (e.g. timer started in another tab)
    if ("BroadcastChannel" in window) {
      Store.bc = new BroadcastChannel(DB_NAME);
      Store.bc.onmessage = async () => { try { await Store.load(); derive(); render(); renderStorageUI(); } catch (e) {} };
    }
  } catch (e) {
    Store.db = null;
    toast("Prehliadač nepovolil ukladanie (IndexedDB). Údaje sa po zatvorení stratia.");
  }
  derive(); render();
  await checkPersist(true);
  renderStorageUI();
}

/* ---------- State ---------- */
const S = {
  projects: [], entries: [], timer: null,
  settings: { rounding: 1, dayTarget: 8, weekTarget: 40, customActs: [] },
  tab: "prehlad",
  filter: { period: "week", project: "all" },
  weekOffset: 0,
  editingEntry: null, editingProject: null, pickedColor: 0
};

function derive() {
  const d = Store.docs;
  S.projects = (d.projects && Array.isArray(d.projects.items)) ? d.projects.items : [];
  S.entries = [];
  Object.keys(d).forEach(k => { if (k.startsWith("e-") && d[k] && Array.isArray(d[k].items)) S.entries.push(...d[k].items); });
  S.entries.sort((a, b) => (b.date + (b.start || "99")).localeCompare(a.date + (a.start || "99")));
  S.timer = d.timer && d.timer.running ? d.timer : null;
  S.settings = Object.assign({ rounding: 1, dayTarget: 8, weekTarget: 40, customActs: [] }, d.settings || {});
}
const proj = id => S.projects.find(p => p.id === id) || null;
const layerColor = p => p ? LAYERS[((p.color | 0) % LAYERS.length + LAYERS.length) % LAYERS.length].c : "var(--pencil)";
const projLabel = p => p ? ((p.number ? p.number + " " : "") + p.name) : "Interné (bez zákazky)";
function defaultProjectId() {
  const last = S.entries.find(e => e.projectId && proj(e.projectId));
  if (last) return last.projectId;
  return S.projects.length ? sortProjects(S.projects)[0].id : "";
}
const activities = () => [...new Set([...DEFAULT_ACTS, ...(S.settings.customActs || []), ...S.entries.map(e => e.activity).filter(Boolean)])];

/* ---------- Mutations ---------- */
function saveProjects(list) { Store.put("projects", { items: list }); }
function monthKey(date) { return "e-" + date.slice(0, 7); }
function saveEntry(entry, prev) {
  if (prev && monthKey(prev.date) !== monthKey(entry.date)) removeEntry(prev, true);
  const k = monthKey(entry.date);
  const items = (Store.docs[k] && Store.docs[k].items ? Store.docs[k].items : []).filter(e => e.id !== entry.id);
  items.push(entry);
  Store.put(k, { items });
}
function removeEntry(entry, silent) {
  const k = monthKey(entry.date);
  const items = (Store.docs[k] && Store.docs[k].items ? Store.docs[k].items : []).filter(e => e.id !== entry.id);
  Store.put(k, items.length ? { items } : DEL);
}

/* ---------- Timer ---------- */
let tickT;
function startTimer(opts) {
  const t = { running: true, start: Date.now(), projectId: opts.projectId || "", activity: opts.activity || "", so: opts.so || "", note: opts.note || "" };
  Store.put("timer", t);
  const p = proj(t.projectId), d = new Date(t.start);
  if (!punch("in", { color: layerColor(p), label: projLabel(p), start: hm(d), date: d })) toast("Časovač beží – " + projLabel(p));
}
function stopTimer() {
  const t = S.timer; if (!t) return;
  const now = Date.now();
  const elapsedMin = (now - t.start) / 60000;
  Store.put("timer", { running: false });
  const p = proj(t.projectId), sd0 = new Date(t.start);
  const card = { color: layerColor(p), label: projLabel(p), start: hm(sd0), end: hm(new Date(now)), date: sd0 };
  if (elapsedMin < 1) { punch("out", Object.assign(card, { sum: "–" })); toast("Časovač bežal menej ako minútu, záznam sa neuložil."); return; }
  const r = Number(S.settings.rounding) || 1;
  const minutes = Math.max(r, Math.ceil(elapsedMin / r) * r);
  const sd = new Date(t.start);
  const startMin = sd.getHours() * 60 + sd.getMinutes();
  const entry = {
    id: uid(), projectId: t.projectId, date: ds(sd), start: hm(sd), end: fromMin(startMin + minutes),
    minutes, activity: t.activity, so: t.so, note: t.note, source: "timer"
  };
  saveEntry(entry);
  if (!punch("out", Object.assign(card, { sum: hrs(minutes) + " h" }))) toast("Uložené: " + hrs(minutes) + " h na " + projLabel(p));
}
/* ---------- Štiknutie: punch-card animation ---------- */
let punchChain = Promise.resolve();
function punch(kind, info) {
  if (S.settings.punchAnim === false || !Element.prototype.animate) return false;
  if (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
  punchChain = punchChain.then(() => playPunch(kind, info)).catch(() => { const L = $("#punch"); L.getAnimations({ subtree: true }).forEach(a => a.cancel()); L.hidden = true; });
  return true;
}
const wait = ms => new Promise(r => setTimeout(r, ms));
async function playPunch(kind, info) {
  const L = $("#punch"), card = L.querySelector(".pcard"), slot = L.querySelector(".pslot"), glow = slot.querySelector("i");
  const inS = L.querySelector(".ps-in"), outS = L.querySelector(".ps-out"), sum = L.querySelector(".pc-sum");
  L.style.setProperty("--c", info.color);
  card.style.setProperty("--c", info.color);
  L.querySelector(".pc-label").textContent = info.label;
  L.querySelector(".pc-date").textContent = info.date.getDate() + ". " + (info.date.getMonth() + 1) + ". " + info.date.getFullYear();
  inS.textContent = info.start; outS.textContent = info.end || ""; sum.textContent = info.sum || "";
  inS.style.opacity = kind === "in" ? 0 : 1; outS.style.opacity = 0; sum.style.opacity = 0;
  L.getAnimations({ subtree: true }).forEach(a => a.cancel());
  L.hidden = false;
  const EASE = "cubic-bezier(.2,.8,.2,1)";
  const SLOW = 1.12; // tempo of the whole sequence
  const go = (el, kf, o) => el.animate(kf, Object.assign({ fill: "forwards", easing: EASE }, o, { duration: o.duration * SLOW, delay: (o.delay || 0) * SLOW })).finished;
  const UP = "translateY(-66px)", REST = "translateY(0) rotate(-1.5deg)";
  // 1. card slides in under the slot
  await Promise.all([
    go(L, [{ opacity: 0 }, { opacity: 1 }], { duration: 140 }),
    go(card, [{ transform: "translateY(54px) rotate(-5deg)", opacity: 0 }, { transform: REST, opacity: 1 }], { duration: 280 })
  ]);
  // 2. pushed up into the slot
  await go(card, [{ transform: REST }, { transform: UP }], { duration: 210, easing: "cubic-bezier(.55,0,.85,.45)" });
  // 3. štik – the clock stamps the card (the logo in the header nods along)
  const lg = document.querySelector(".logo");
  if (lg) lg.animate([{ transform: "none" }, { transform: "translateY(2px) rotate(-6deg) scale(.94)", offset: .3 }, { transform: "none" }], { duration: 260 * SLOW, easing: "ease-out" });
  (kind === "in" ? inS : outS).style.opacity = 1;
  if (kind === "out") sum.style.opacity = 1;
  await Promise.all([
    go(slot, [{ transform: "translateY(0)" }, { transform: "translateY(4px) scaleX(1.02)", offset: .3 }, { transform: "translateY(0)" }], { duration: 170, easing: "ease-out" }),
    go(glow, [{ opacity: 0 }, { opacity: 1, offset: .25 }, { opacity: 0 }], { duration: 420, easing: "ease-out" }),
    go(card, [{ transform: UP }, { transform: "translateY(-60px)", offset: .3 }, { transform: UP }], { duration: 170, easing: "ease-out" })
  ]);
  // 4. card comes back out with the fresh stamp
  await go(card, [{ transform: UP }, { transform: REST }], { duration: 320 });
  go(kind === "in" ? inS : outS, [{ transform: "rotate(-3deg) scale(1.35)" }, { transform: "rotate(-3deg) scale(1)" }], { duration: 260 });
  if (kind === "out") go(sum, [{ transform: "rotate(-2deg) scale(1.35)" }, { transform: "rotate(-2deg) scale(1)" }], { duration: 260, delay: 90 });
  await wait(kind === "in" ? 720 : 1120);
  // 5. away: on start it tucks into the clock, on stop it drops into the tray
  const exit = kind === "in"
    ? [{ transform: REST, opacity: 1 }, { transform: "translateY(18px) scale(.82)", opacity: 0 }]
    : [{ transform: REST, opacity: 1 }, { transform: "translate(70px, 34px) rotate(9deg)", opacity: 0 }];
  await Promise.all([
    go(card, exit, { duration: 340, easing: "cubic-bezier(.5,0,.75,0)" }),
    go(slot, [{ opacity: 1 }, { opacity: 0 }], { duration: 260, delay: 120 })
  ]);
  L.getAnimations({ subtree: true }).forEach(a => a.cancel());
  L.hidden = true;
}

function tick() {
  const el = $("#clock");
  if (S.timer) {
    const sec = Math.max(0, Math.floor((Date.now() - S.timer.start) / 1000));
    const txt = Math.floor(sec / 3600) + ":" + pad(Math.floor(sec / 60) % 60) + ":" + pad(sec % 60);
    el.textContent = txt;
    document.title = txt + " · " + projLabel(proj(S.timer.projectId));
  } else {
    el.textContent = "0:00:00";
    document.title = "Štikačka – výkaz hodín na zákazky";
  }
}
let timerEditT;
function timerFieldChanged() {
  if (!S.timer) return;
  clearTimeout(timerEditT);
  timerEditT = setTimeout(() => {
    if (!S.timer) return;
    const t = Object.assign({}, S.timer, { projectId: $("#tProject").value, activity: $("#tActivity").value.trim(), so: $("#tSO").value.trim(), note: $("#tNote").value.trim() });
    Store.put("timer", t);
  }, 700);
}

function projectOptions(sel, includeDone) {
  const list = sortProjects(S.projects);
  return `<option value="">Interné (bez zákazky)</option>` + list.map(p => `<option value="${esc(p.id)}"${p.id === sel ? " selected" : ""}>${esc(projLabel(p))}</option>`).join("");
}
function soOptions(projectId) {
  const p = proj(projectId);
  const used = S.entries.filter(e => (e.projectId || "") === (projectId || "") && e.so).map(e => e.so);
  return [...new Set([...(p && p.objects ? p.objects : []), ...used])];
}

const FAV_IDLE = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 64 64%22%3E%3Cdefs%3E%3Cmask id=%22lgHole%22%3E%3Crect width=%2264%22 height=%2264%22 fill=%22%23fff%22/%3E%3Ccircle cx=%2232%22 cy=%2251%22 r=%223.6%22 fill=%22%23000%22/%3E%3C/mask%3E%3C/defs%3E%3Cg transform=%22rotate%28-8 32 32%29%22 mask=%22url%28%23lgHole%29%22%3E%3Crect x=%229%22 y=%227%22 width=%2246%22 height=%2250%22 rx=%227%22 fill=%22%23F2E8CB%22 stroke=%22%2318202B%22 stroke-width=%223%22/%3E%3Cpath d=%22M10.5 17V13a5.5 5.5 0 0 1 5.5-5.5h32a5.5 5.5 0 0 1 5.5 5.5v4z%22 fill=%22%231F4FBF%22/%3E%3Cpath d=%22M15 31.5h34M15 43h34%22 stroke=%22%23B9A877%22 stroke-width=%222%22 stroke-linecap=%22round%22/%3E%3Cpath d=%22M15 25h9M15 37h9%22 stroke=%22%238C7F5A%22 stroke-width=%222.4%22 stroke-linecap=%22round%22/%3E%3Crect x=%2230%22 y=%2220.5%22 width=%2219%22 height=%228.5%22 rx=%222.5%22 fill=%22%23C62828%22 transform=%22rotate%28-4 39.5 24.5%29%22/%3E%3C/g%3E%3C/svg%3E';
const FAV_RUN = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 64 64%22%3E%3Cdefs%3E%3Cmask id=%22lgHoleR%22%3E%3Crect width=%2264%22 height=%2264%22 fill=%22%23fff%22/%3E%3Ccircle cx=%2232%22 cy=%2251%22 r=%223.6%22 fill=%22%23000%22/%3E%3C/mask%3E%3C/defs%3E%3Cg transform=%22rotate%28-8 32 32%29%22 mask=%22url%28%23lgHoleR%29%22%3E%3Crect x=%229%22 y=%227%22 width=%2246%22 height=%2250%22 rx=%227%22 fill=%22%23F2E8CB%22 stroke=%22%2318202B%22 stroke-width=%223%22/%3E%3Cpath d=%22M10.5 17V13a5.5 5.5 0 0 1 5.5-5.5h32a5.5 5.5 0 0 1 5.5 5.5v4z%22 fill=%22%231F4FBF%22/%3E%3Cpath d=%22M15 31.5h34M15 43h34%22 stroke=%22%23B9A877%22 stroke-width=%222%22 stroke-linecap=%22round%22/%3E%3Cpath d=%22M15 25h9M15 37h9%22 stroke=%22%238C7F5A%22 stroke-width=%222.4%22 stroke-linecap=%22round%22/%3E%3Crect x=%2230%22 y=%2220.5%22 width=%2219%22 height=%228.5%22 rx=%222.5%22 fill=%22%23C62828%22 transform=%22rotate%28-4 39.5 24.5%29%22/%3E%3C/g%3E%3Ccircle cx=%2251%22 cy=%2251%22 r=%2210%22 fill=%22%23C62828%22 stroke=%22%23FFFFFF%22 stroke-width=%224%22/%3E%3C/svg%3E';
let favState = null;
function setFavicon(running) {
  if (favState === running) return; favState = running;
  const l = document.getElementById("favicon"); if (l) l.href = running ? FAV_RUN : FAV_IDLE;
}
function renderTimer() {
  const box = $("#timer");
  const running = !!S.timer;
  box.classList.toggle("running", running);
  document.body.classList.toggle("is-running", running);
  setFavicon(running);
  const sel = $("#tProject");
  let curVal = running ? S.timer.projectId : sel.value;
  if (!running && !S.tPicked) curVal = defaultProjectId();
  if (document.activeElement !== sel) { sel.innerHTML = projectOptions(curVal, false); sel.value = curVal || ""; }
  if (running) {
    const p = proj(S.timer.projectId);
    box.style.setProperty("--layer", layerColor(p));
    [["#tActivity", "activity"], ["#tSO", "so"], ["#tNote", "note"]].forEach(([s, k]) => { const el = $(s); if (document.activeElement !== el) el.value = S.timer[k] || ""; });
    $("#clockSub").innerHTML = `<span class="dot"></span>Beží od ${hm(new Date(S.timer.start))}`;
    $("#tStart").textContent = "Zastaviť";
  } else {
    $("#clockSub").textContent = "Časovač stojí";
    $("#tStart").textContent = "Spustiť";
  }
  tick();
}

/* ---------- Views ---------- */
function sumMin(list) { return list.reduce((s, e) => s + (e.minutes || 0), 0); }
function sortProjects(list) {
  return list.slice().sort((a, b) => (a.number || "").localeCompare(b.number || "", "sk", { numeric: true }) || a.name.localeCompare(b.name, "sk"));
}
function lastWorked(p) { const e = S.entries.find(x => x.projectId === p.id); return e ? e.date : ""; }
function projectRow(p) {
  const own = S.entries.filter(e => e.projectId === p.id);
  const spent = sumMin(own);
  const last = own.length ? own[0].date : "";
  return `<tr>
    <td><button class="linkish" data-act="filterProject" data-id="${esc(p.id)}" style="display:flex;align-items:center"><span class="layer" style="--c:${layerColor(p)}"></span><span><span class="pnum">${esc(p.number || "")}</span> <span class="pname">${esc(p.name)}</span>${p.client ? `<br><span class="muted" style="font-size:13px">${esc(p.client)}</span>` : ""}</span></button></td>
    <td>${p.stage ? `<span class="stage">${esc(p.stage)}</span>` : ""}</td>
    <td class="r"><b class="num">${hrs(spent)}</b> <span class="muted">h</span></td>
    <td class="muted num">${last ? shortDate(parseD(last)) + " " + parseD(last).getFullYear() : "–"}</td>
    <td class="rowacts"><button class="btn small ghost" data-act="startProject" data-id="${esc(p.id)}" title="Spustiť časovač">▶ Spustiť</button><button class="btn small ghost" data-act="editProject" data-id="${esc(p.id)}">Upraviť</button></td>
  </tr>`;
}
function projectTable(list) {
  return `<div class="tablewrap"><table class="ptable"><thead><tr><th>Zákazka</th><th>Stupeň</th><th class="r">Odpracované</th><th>Naposledy</th><th></th></tr></thead><tbody>${list.map(projectRow).join("")}</tbody></table></div>`;
}

function entryRow(e) {
  const p = proj(e.projectId);
  const when = e.start ? `${e.start}–${e.end || ""}` : (e.source === "manual" ? "ručne" : "");
  return `<div class="entry">
    <div class="when num">${esc(when)}</div>
    <div class="dur num">${hrs(e.minutes)}</div>
    <div class="what">
      <div class="l1"><span class="layer" style="--c:${layerColor(p)}"></span><span class="pnum">${esc(p ? p.number || "" : "")}</span><span class="pname">${esc(p ? p.name : "Interné")}</span>${e.activity ? `<span class="tag">${esc(e.activity)}</span>` : ""}${e.so ? `<span class="tag">${esc(e.so)}</span>` : ""}</div>
      ${e.note ? `<div class="l2">${esc(e.note)}</div>` : ""}
    </div>
    <div class="acts" style="white-space:nowrap"><button class="btn small ghost" data-act="continue" data-id="${esc(e.id)}" title="Pokračovať na tejto práci">▶</button><button class="btn small ghost" data-act="editEntry" data-id="${esc(e.id)}">Upraviť</button></div>
  </div>`;
}
function entriesByDay(list) {
  const groups = {};
  list.forEach(e => (groups[e.date] = groups[e.date] || []).push(e));
  return Object.keys(groups).sort().reverse().map(d => `<div class="day"><div class="dayhead"><h3>${longDate(d)}${d === todayStr() ? " · dnes" : ""}</h3><span class="num">${hrs(sumMin(groups[d]))} h</span></div>${groups[d].map(entryRow).join("")}</div>`).join("");
}

function viewOverview() {
  const today = todayStr();
  const ws = weekStart(new Date());
  const weekDates = [...Array(7)].map((_, i) => ds(addDays(ws, i)));
  const tMin = sumMin(S.entries.filter(e => e.date === today));
  const wMin = sumMin(S.entries.filter(e => weekDates.includes(e.date)));
  const mPrefix = today.slice(0, 7);
  const mMin = sumMin(S.entries.filter(e => e.date.startsWith(mPrefix)));
  const dayT = (S.settings.dayTarget || 8) * 60, weekT = (S.settings.weekTarget || 40) * 60;
  const weekEntries = S.entries.filter(e => weekDates.includes(e.date));
  const perDay = weekDates.map(d => sumMin(weekEntries.filter(e => e.date === d)));
  const maxD = Math.max(dayT, ...perDay);
  const weekIds = [...new Set(weekEntries.map(e => e.projectId || ""))].sort((a, b) => projLabel(proj(a)).localeCompare(projLabel(proj(b)), "sk"));
  const segs = d => weekIds.map(id => ({ id, m: sumMin(weekEntries.filter(e => e.date === d && (e.projectId || "") === id)) })).filter(x => x.m);
  const recentProjects = S.projects.filter(p => lastWorked(p)).sort((a, b) => lastWorked(b).localeCompare(lastWorked(a))).slice(0, 6);
  const shown = recentProjects.length ? recentProjects : sortProjects(S.projects).slice(0, 6);
  const recent = S.entries.slice(0, 6);

  return `
  <section class="section">
    <div class="tblock">
      <div><div class="tb-l">Dnes</div><div class="tb-v">${hrs1(tMin)} <small>/ ${hrs(dayT)} h</small></div><div class="meter"><i style="width:${Math.min(100, tMin / dayT * 100)}%"></i></div></div>
      <div><div class="tb-l">Tento týždeň</div><div class="tb-v">${hrs1(wMin)} <small>/ ${hrs(weekT)} h</small></div><div class="meter"><i style="width:${Math.min(100, wMin / weekT * 100)}%"></i></div></div>
      <div><div class="tb-l">${MONTHS[new Date().getMonth()][0].toUpperCase() + MONTHS[new Date().getMonth()].slice(1)}</div><div class="tb-v">${hrs1(mMin)} <small>h</small></div></div>
      <div><div class="tb-l">Týždeň po dňoch</div><div class="weekbars">${weekDates.map((d, i) => `<div class="wb${d === today ? " today" : ""}"><div class="stack">${segs(d).map(s => `<i style="--c:${layerColor(proj(s.id))};height:${s.m / maxD * 100}%" title="${DAYS[i]} – ${esc(projLabel(proj(s.id)))}: ${hrs(s.m)} h"></i>`).join("")}</div><span>${DAYS[i]}</span></div>`).join("")}</div>${weekIds.length ? `<div class="wlegend">${weekIds.map(id => { const p = proj(id); return `<span><span class="layer" style="--c:${layerColor(p)}"></span>${esc(p ? (p.number || p.name) : "Interné")}</span>`; }).join("")}</div>` : ""}</div>
    </div>
  </section>
  <section class="section">
    <div class="shead"><h2>Naposledy rozpracované</h2>${S.projects.length > shown.length ? `<button class="btn small ghost" data-act="tab" data-tab="zakazky">Všetky zákazky</button>` : ""}<button class="btn small primary" data-act="newProject">+ Nová zákazka</button></div>
    ${shown.length ? projectTable(shown) : `<div class="empty"><p>Zatiaľ nemáte žiadnu zákazku. Založte prvú – číslo, názov a stupeň PD.</p><button class="btn primary" data-act="newProject">Založiť zákazku</button></div>`}
  </section>
  <section class="section">
    <div class="shead"><h2>Posledné záznamy</h2>${recent.length ? `<button class="btn small ghost" data-act="tab" data-tab="zaznamy">Všetky záznamy</button>` : ""}</div>
    ${recent.length ? entriesByDay(recent) : `<div class="empty"><p>Žiadne záznamy. Spustite časovač hore, alebo dopíšte hodiny ručne.</p><button class="btn" data-act="newEntry">+ Pridať záznam</button></div>`}
  </section>`;
}

function periodRange(period) {
  const now = new Date();
  if (period === "week") { const s = weekStart(now); return [ds(s), ds(addDays(s, 6))]; }
  if (period === "lastweek") { const s = addDays(weekStart(now), -7); return [ds(s), ds(addDays(s, 6))]; }
  if (period === "month") { return [ds(new Date(now.getFullYear(), now.getMonth(), 1)), ds(new Date(now.getFullYear(), now.getMonth() + 1, 0))]; }
  if (period === "lastmonth") { return [ds(new Date(now.getFullYear(), now.getMonth() - 1, 1)), ds(new Date(now.getFullYear(), now.getMonth(), 0))]; }
  return ["0000-00-00", "9999-99-99"];
}
function filteredEntries() {
  const [a, b] = periodRange(S.filter.period);
  return S.entries.filter(e => e.date >= a && e.date <= b && (S.filter.project === "all" || (S.filter.project === "" ? !e.projectId : e.projectId === S.filter.project)));
}
function viewEntries() {
  const list = filteredEntries();
  const total = sumMin(list);
  return `
  <div class="shead"><h2>Záznamy</h2><button class="btn small" data-act="exportEntries"${list.length ? "" : " disabled"}>Export CSV</button><button class="btn small primary" data-act="newEntry">+ Pridať záznam</button></div>
  <div class="filters">
    <label class="field"><span>Obdobie</span><select id="fPeriod">
      ${[["week", "Tento týždeň"], ["lastweek", "Minulý týždeň"], ["month", "Tento mesiac"], ["lastmonth", "Minulý mesiac"], ["all", "Všetko"]].map(([v, l]) => `<option value="${v}"${S.filter.period === v ? " selected" : ""}>${l}</option>`).join("")}
    </select></label>
    <label class="field" style="min-width:240px"><span>Zákazka</span><select id="fProject">
      <option value="all"${S.filter.project === "all" ? " selected" : ""}>Všetky zákazky</option>
      ${projectOptions(S.filter.project === "all" ? null : S.filter.project, true)}
    </select></label>
  </div>
  <p class="sumline">Spolu <b class="num">${hrs(total)} h</b> v ${list.length} ${list.length === 1 ? "zázname" : "záznamoch"}</p>
  ${list.length ? entriesByDay(list) : `<div class="empty"><p>V tomto období nie sú žiadne záznamy.</p><button class="btn" data-act="newEntry">+ Pridať záznam</button></div>`}`;
}

function weekData() {
  const s = addDays(weekStart(new Date()), S.weekOffset * 7);
  const dates = [...Array(7)].map((_, i) => ds(addDays(s, i)));
  const inWeek = S.entries.filter(e => e.date >= dates[0] && e.date <= dates[6]);
  const ids = [...new Set(inWeek.map(e => e.projectId || ""))];
  ids.sort((a, b) => projLabel(proj(a)).localeCompare(projLabel(proj(b)), "sk"));
  const rows = ids.map(id => ({ id, p: proj(id), cells: dates.map(d => sumMin(inWeek.filter(e => (e.projectId || "") === id && e.date === d))) }));
  const colTot = dates.map((_, i) => rows.reduce((t, r) => t + r.cells[i], 0));
  return { s, dates, rows, colTot, total: sumMin(inWeek) };
}
function viewWeek() {
  const w = weekData();
  const today = todayStr();
  const e = addDays(w.s, 6);
  const lbl = `${shortDate(w.s)} – ${shortDate(e)} ${e.getFullYear()}`;
  return `
  <div class="shead"><h2>Týždenný výkaz</h2>
    <div class="weeknav"><button class="btn small" data-act="week" data-d="-1" aria-label="Predchádzajúci týždeň">‹</button><span class="lbl num">${lbl}</span><button class="btn small" data-act="week" data-d="1" aria-label="Nasledujúci týždeň">›</button>${S.weekOffset ? `<button class="btn small ghost" data-act="week" data-d="0">Tento týždeň</button>` : ""}</div>
    <button class="btn small" data-act="exportWeek"${w.rows.length ? "" : " disabled"}>Export CSV</button>
  </div>
  ${w.rows.length ? `<div class="tablewrap"><table class="grid"><thead><tr><th>Zákazka</th>${w.dates.map((d, i) => `<th class="h${d === today ? " today" : ""}">${DAYS[i]} ${parseD(d).getDate()}.</th>`).join("")}<th class="h">Spolu</th></tr></thead><tbody>
    ${w.rows.map(r => `<tr><td><span style="display:flex;align-items:center"><span class="layer" style="--c:${layerColor(r.p)}"></span><span><span class="pnum">${esc(r.p ? r.p.number || "" : "")}</span> ${esc(r.p ? r.p.name : "Interné")}</span></span></td>${r.cells.map(c => `<td class="h${c ? "" : " zero"}">${c ? hrs(c) : "·"}</td>`).join("")}<td class="h sum">${hrs(r.cells.reduce((a, b) => a + b, 0))}</td></tr>`).join("")}
    <tr class="tot"><td>Spolu</td>${w.colTot.map(c => `<td class="h">${c ? hrs(c) : "·"}</td>`).join("")}<td class="h">${hrs(w.total)}</td></tr>
  </tbody></table></div>
  <p class="sumline" style="margin-top:12px">Fond týždňa ${hrs((S.settings.weekTarget || 40) * 60)} h, ${w.total >= (S.settings.weekTarget || 40) * 60 ? "splnený" : "chýba " + hrs((S.settings.weekTarget || 40) * 60 - w.total) + " h"}</p>`
  : `<div class="empty"><p>V tomto týždni nie sú žiadne záznamy.</p><button class="btn" data-act="newEntry">+ Pridať záznam</button></div>`}`;
}

function viewProjects() {
  const list = sortProjects(S.projects);
  return `
  <div class="shead"><h2>Zákazky</h2><button class="btn small primary" data-act="newProject">+ Nová zákazka</button></div>
  ${list.length ? projectTable(list) : `<div class="empty"><p>Zatiaľ nemáte žiadnu zákazku. Založte prvú – číslo, názov a stupeň PD.</p><button class="btn primary" data-act="newProject">Založiť zákazku</button></div>`}`;
}

function render() {
  renderTimer();
  document.querySelectorAll(".tab").forEach(t => t.setAttribute("aria-selected", String(t.dataset.tab === S.tab)));
  const main = $("#main");
  const html = S.tab === "zaznamy" ? viewEntries() : S.tab === "vykaz" ? viewWeek() : S.tab === "zakazky" ? viewProjects() : viewOverview();
  main.innerHTML = html;
}

/* ---------- Confirm dialog ---------- */
function ask(title, msg, okLabel = "Vymazať", noLabel = "Zrušiť") {
  return new Promise(resolve => {
    const d = $("#dConfirm"), yes = $("#cYes"), no = $("#cNo");
    $("#cTitle").textContent = title; $("#cMsg").textContent = msg;
    yes.textContent = okLabel; no.textContent = noLabel; yes.classList.toggle("del", okLabel === "Vymazať");
    let settled = false;
    const done = v => {
      if (settled) return; settled = true;
      d.removeEventListener("close", onClose); yes.onclick = null; no.onclick = null;
      if (d.open) d.close();
      resolve(v);
    };
    const onClose = () => done(null);
    yes.onclick = () => done(true);
    no.onclick = () => done(false);
    d.addEventListener("close", onClose);
    d.showModal(); no.focus();
  });
}

/* ---------- Entry dialog ---------- */
const dEntry = $("#dEntry"), fEntry = $("#fEntry");
function openEntry(entry) {
  S.editingEntry = entry || null;
  $("#dEntryTitle").textContent = entry ? "Upraviť záznam" : "Nový záznam";
  $("#eDelete").hidden = !entry;
  const pid = entry ? entry.projectId : (S.filter.project !== "all" && S.tab === "zaznamy" ? S.filter.project : (S.tPicked || S.timer ? $("#tProject").value : defaultProjectId()));
  $("#eProject").innerHTML = projectOptions(pid, !!entry);
  $("#eProject").value = pid || "";
  fEntry.date.value = entry ? entry.date : todayStr();
  fEntry.start.value = entry ? entry.start || "" : "";
  fEntry.end.value = entry ? entry.end || "" : "";
  fEntry.duration.value = entry ? hrs(entry.minutes) : "";
  fEntry.activity.value = entry ? entry.activity || "" : "";
  fEntry.so.value = entry ? entry.so || "" : "";
  fEntry.note.value = entry ? entry.note || "" : "";
  dEntry.showModal();
}
function syncDuration() {
  const a = toMin(fEntry.start.value), b = toMin(fEntry.end.value);
  if (a != null && b != null) { let d = b - a; if (d < 0) d += 1440; fEntry.duration.value = hrs(d); }
}
fEntry.start.addEventListener("change", syncDuration);
fEntry.end.addEventListener("change", syncDuration);
fEntry.duration.addEventListener("change", () => {
  const m = parseDuration(fEntry.duration.value), a = toMin(fEntry.start.value);
  if (m != null && a != null) fEntry.end.value = fromMin(a + m);
});
fEntry.addEventListener("submit", ev => {
  ev.preventDefault();
  let minutes = parseDuration(fEntry.duration.value);
  const a = toMin(fEntry.start.value), b = toMin(fEntry.end.value);
  if (a != null && b != null) { minutes = b - a; if (minutes < 0) minutes += 1440; }
  if (!minutes || minutes <= 0) { fEntry.duration.focus(); toast("Zadajte trvanie (napr. 1,5) alebo čas od–do."); return; }
  if (minutes > 24 * 60) { toast("Jeden záznam môže mať najviac 24 hodín."); return; }
  if (!fEntry.date.value) { toast("Zadajte dátum."); return; }
  const prev = S.editingEntry;
  const entry = {
    id: prev ? prev.id : uid(), projectId: $("#eProject").value, date: fEntry.date.value,
    start: fEntry.start.value || "", end: fEntry.end.value || (a != null ? fromMin(a + minutes) : ""),
    minutes, activity: fEntry.activity.value.trim(), so: fEntry.so.value.trim(), note: fEntry.note.value.trim(),
    source: prev ? prev.source : "manual"
  };
  saveEntry(entry, prev);
  dEntry.close();
  toast(prev ? "Záznam upravený." : "Záznam pridaný: " + hrs(minutes) + " h");
});
$("#eDelete").addEventListener("click", async () => {
  const en = S.editingEntry; if (!en) return;
  if (!(await ask("Vymazať záznam?", `${hrs(en.minutes)} h, ${longDate(en.date)}, ${projLabel(proj(en.projectId))}`))) return;
  removeEntry(en); dEntry.close(); toast("Záznam vymazaný.");
});

/* ---------- Project dialog ---------- */
const dProject = $("#dProject"), fProject = $("#fProject");
fProject.stage.innerHTML = `<option value="">–</option>` + STAGES.map(s => `<option>${esc(s)}</option>`).join("");
function renderSwatches() {
  $("#swatches").innerHTML = LAYERS.map((l, i) => `<button type="button" class="swatch" role="radio" aria-checked="${i === S.pickedColor}" aria-label="Farba ${l.aci}" data-i="${i}" style="--c:${l.c}"><span>${l.aci}</span></button>`).join("");
}
$("#swatches").addEventListener("click", e => { const b = e.target.closest(".swatch"); if (!b) return; S.pickedColor = +b.dataset.i; renderSwatches(); });
function openProject(p) {
  S.editingProject = p || null;
  $("#dProjectTitle").textContent = p ? "Upraviť zákazku" : "Nová zákazka";
  $("#pDelete").hidden = !p;
  fProject.number.value = p ? p.number || "" : "";
  fProject.name.value = p ? p.name : "";
  fProject.client.value = p ? p.client || "" : "";
  fProject.stage.value = p ? p.stage || "" : "";
  fProject.objects.value = p && p.objects ? p.objects.join(", ") : "";
  fProject.pnote.value = p ? p.note || "" : "";
  S.pickedColor = p ? p.color : (S.projects.length % LAYERS.length);
  renderSwatches();
  dProject.showModal();
}
fProject.addEventListener("submit", ev => {
  ev.preventDefault();
  const name = fProject.name.value.trim();
  if (!name) { fProject.name.focus(); return; }
  const prev = S.editingProject;
  const p = {
    id: prev ? prev.id : uid(), number: fProject.number.value.trim(), name, client: fProject.client.value.trim(),
    stage: fProject.stage.value,
    objects: fProject.objects.value.split(/[,;]/).map(s => s.trim()).filter(Boolean),
    color: S.pickedColor, note: fProject.pnote.value.trim(), created: prev ? prev.created : Date.now()
  };
  const list = S.projects.filter(x => x.id !== p.id); list.push(p);
  saveProjects(list);
  dProject.close();
  toast(prev ? "Zákazka uložená." : "Zákazka založená.");
});
$("#pDelete").addEventListener("click", async () => {
  const p = S.editingProject; if (!p) return;
  const own = S.entries.filter(e => e.projectId === p.id);
  const n = own.length;
  const msg = n ? `Spolu so zákazkou sa ${n >= 2 && n < 5 ? "vymažú" : "vymaže"} aj ${n} ${n === 1 ? "záznam" : n < 5 ? "záznamy" : "záznamov"} (${hrs(sumMin(own))} h). Túto akciu nemožno vrátiť.` : "Túto akciu nemožno vrátiť.";
  if (!(await ask("Vymazať zákazku " + projLabel(p) + "?", msg))) return;
  [...new Set(own.map(e => monthKey(e.date)))].forEach(k => {
    const items = (Store.docs[k] && Store.docs[k].items ? Store.docs[k].items : []).filter(e => e.projectId !== p.id);
    Store.put(k, items.length ? { items } : DEL);
  });
  if (S.timer && S.timer.projectId === p.id) Store.put("timer", Object.assign({}, S.timer, { projectId: "" }));
  saveProjects(S.projects.filter(x => x.id !== p.id));
  dProject.close(); toast("Zákazka vymazaná.");
});

/* ---------- Settings dialog ---------- */
const dSettings = $("#dSettings"), fSettings = $("#fSettings");
let pickedRound = 1;
function paintRound() { document.querySelectorAll("#segRound button").forEach(b => b.setAttribute("aria-pressed", String(+b.dataset.v === pickedRound))); }
$("#segRound").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; pickedRound = +b.dataset.v; paintRound(); });
$("#btnSettings").addEventListener("click", () => {
  pickedRound = Number(S.settings.rounding) || 1; paintRound();
  fSettings.dayTarget.value = String(S.settings.dayTarget).replace(".", ",");
  fSettings.weekTarget.value = String(S.settings.weekTarget).replace(".", ",");
  fSettings.customActs.value = (S.settings.customActs || []).join(", ");
  fSettings.punchAnim.checked = S.settings.punchAnim !== false;
  dSettings.showModal();
});
fSettings.addEventListener("submit", ev => {
  ev.preventDefault();
  Store.put("settings", {
    rounding: pickedRound,
    dayTarget: parseNum(fSettings.dayTarget.value) || 8,
    weekTarget: parseNum(fSettings.weekTarget.value) || 40,
    customActs: fSettings.customActs.value.split(/[,;]/).map(s => s.trim()).filter(Boolean),
    punchAnim: fSettings.punchAnim.checked
  });
  dSettings.close(); toast("Nastavenia uložené.");
});

/* ---------- Files: CSV + backup ---------- */
function offerFile(filename, text) {
  try {
    const type = filename.endsWith(".csv") ? "text/csv;charset=utf-8" : "application/json;charset=utf-8";
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement("a"); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch (e) { toast("Súbor sa nepodarilo stiahnuť."); }
}
const csvCell = v => { const s = String(v ?? ""); return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const csv = rows => "\uFEFF" + rows.map(r => r.map(csvCell).join(";")).join("\r\n");
function exportEntries() {
  const list = filteredEntries().slice().sort((a, b) => (a.date + (a.start || "")).localeCompare(b.date + (b.start || "")));
  const rows = [["Dátum", "Od", "Do", "Hodiny", "Č. zákazky", "Zákazka", "Investor", "Stupeň PD", "Činnosť", "Objekt", "Popis"]];
  list.forEach(e => { const p = proj(e.projectId); rows.push([e.date, e.start, e.end, hrs(e.minutes), p ? p.number : "", p ? p.name : "Interné", p ? p.client : "", p ? p.stage : "", e.activity, e.so, e.note]); });
  const [a, b] = periodRange(S.filter.period);
  offerFile(`stikacka_zaznamy_${S.filter.period === "all" ? "vsetko" : a + "_" + b}.csv`, csv(rows));
}
function exportWeek() {
  const w = weekData();
  const rows = [["Č. zákazky", "Zákazka", ...w.dates.map((d, i) => DAYS[i] + " " + d), "Spolu"]];
  w.rows.forEach(r => rows.push([r.p ? r.p.number : "", r.p ? r.p.name : "Interné", ...r.cells.map(c => c ? hrs(c) : ""), hrs(r.cells.reduce((a, b) => a + b, 0))]));
  rows.push(["", "Spolu", ...w.colTot.map(c => c ? hrs(c) : ""), hrs(w.total)]);
  offerFile(`stikacka_vykaz_${w.dates[0]}.csv`, csv(rows));
}
$("#btnBackup").addEventListener("click", () => {
  const data = { app: "vykaz-hodin", version: 1, exported: new Date().toISOString(), docs: Store.docs };
  offerFile(`stikacka_zaloha_${todayStr()}.json`, JSON.stringify(data, null, 1));
  Store.setMeta("lastBackup", Date.now());
});
$("#btnRestore").addEventListener("click", () => $("#fileRestore").click());
$("#fileRestore").addEventListener("change", async e => {
  const f = e.target.files[0]; e.target.value = "";
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (!data || data.app !== "vykaz-hodin" || typeof data.docs !== "object") throw new Error("format");
    const n = Object.keys(data.docs).filter(k => k.startsWith("e-")).reduce((t, k) => t + ((data.docs[k].items || []).length), 0);
    const np = data.docs.projects && data.docs.projects.items ? data.docs.projects.items.length : 0;
    if (!(await ask("Obnoviť zálohu?", `Záloha obsahuje ${np} zákaziek a ${n} záznamov. Súčasné údaje sa nahradia.`, "Obnoviť"))) return;
    await Store.replaceAll(data.docs);
    dSettings.close(); toast("Záloha obnovená.");
  } catch (err) { toast("Súbor nie je záloha z tejto aplikácie."); }
});

/* ---------- Events ---------- */
document.addEventListener("click", e => {
  const c = e.target.closest("[data-close]"); if (c) { c.closest("dialog").close(); return; }
  const b = e.target.closest("[data-act]"); if (!b) return;
  const act = b.dataset.act, id = b.dataset.id;
  if (act === "newProject") openProject();
  else if (act === "editProject") openProject(proj(id));
  else if (act === "newEntry") openEntry();
  else if (act === "editEntry") openEntry(S.entries.find(x => x.id === id));
  else if (act === "filterProject") { S.filter = { period: "all", project: id }; S.tab = "zaznamy"; render(); }
  else if (act === "tab") { S.tab = b.dataset.tab; render(); }
  else if (act === "week") { const d = +b.dataset.d; S.weekOffset = d === 0 ? 0 : S.weekOffset + d; render(); }
  else if (act === "exportEntries") exportEntries();
  else if (act === "exportWeek") exportWeek();
  else if (act === "startProject") { if (S.timer) stopTimer(); startTimer({ projectId: id }); }
  else if (act === "continue") {
    const en = S.entries.find(x => x.id === id); if (!en) return;
    if (S.timer) stopTimer();
    startTimer({ projectId: en.projectId, activity: en.activity, so: en.so, note: en.note });
  }
});
document.addEventListener("change", e => {
  if (e.target.id === "fPeriod") { S.filter.period = e.target.value; render(); }
  if (e.target.id === "fProject") { S.filter.project = e.target.value; render(); }
});
$("#tabs").addEventListener("click", e => { const t = e.target.closest(".tab"); if (!t) return; S.tab = t.dataset.tab; render(); });
$("#tStart").addEventListener("click", () => {
  if (S.timer) { clearTimeout(timerEditT); stopTimer(); }
  else startTimer({ projectId: $("#tProject").value, activity: $("#tActivity").value.trim(), so: $("#tSO").value.trim(), note: $("#tNote").value.trim() });
});
$("#tProject").addEventListener("change", e => { S.tPicked = true; timerFieldChanged(); });
["#tActivity", "#tSO", "#tNote"].forEach(s => $(s).addEventListener("input", timerFieldChanged));
$("#tNote").addEventListener("keydown", e => { if (e.key === "Enter" && !S.timer) $("#tStart").click(); });
$("#btnAdd").addEventListener("click", () => openEntry());
document.addEventListener("keydown", e => {
  if (e.target.matches("input, textarea, select") || document.querySelector("dialog[open]")) return;
  if (e.key === "n") { e.preventDefault(); openEntry(); }
});

/* ---------- Combobox: always offers the full list ---------- */
function combo(input, getOptions) {
  input.setAttribute("role", "combobox"); input.setAttribute("aria-autocomplete", "list"); input.setAttribute("aria-expanded", "false");
  const wrap = document.createElement("div"); wrap.className = "combo";
  input.parentNode.insertBefore(wrap, input); wrap.appendChild(input);
  const btn = document.createElement("button"); btn.type = "button"; btn.className = "combo-btn"; btn.tabIndex = -1; btn.setAttribute("aria-label", "Zobraziť možnosti");
  wrap.appendChild(btn);
  const list = document.createElement("ul"); list.className = "combo-list"; list.setAttribute("role", "listbox"); list.hidden = true;
  wrap.appendChild(list);
  let items = [], active = -1, picking = false;
  const isOpen = () => !list.hidden;
  function place() {
    const r = input.getBoundingClientRect(), w = Math.max(r.width, 220);
    list.style.width = w + "px";
    list.style.left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) + "px";
    const below = window.innerHeight - r.bottom;
    if (below < 220 && r.top > below) { list.style.top = "auto"; list.style.bottom = (window.innerHeight - r.top + 3) + "px"; }
    else { list.style.bottom = "auto"; list.style.top = (r.bottom + 3) + "px"; }
  }
  function paint() { [...list.children].forEach((li, i) => li.setAttribute("aria-selected", String(i === active))); if (active >= 0) list.children[active].scrollIntoView({ block: "nearest" }); }
  function open(all) {
    const opts = getOptions();
    const q = all ? "" : input.value.trim().toLowerCase();
    items = q ? opts.filter(o => o.toLowerCase().includes(q)) : opts;
    if (!items.length) { close(); return; }
    const cur = input.value.trim();
    active = items.indexOf(cur);
    list.innerHTML = items.map((o, i) => `<li role="option" data-i="${i}"${o === cur ? ' class="cur"' : ""}>${esc(o)}</li>`).join("");
    list.hidden = false; input.setAttribute("aria-expanded", "true");
    place(); paint();
  }
  function close() { list.hidden = true; input.setAttribute("aria-expanded", "false"); active = -1; }
  function pick(v) {
    close(); input.value = v; picking = true;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    picking = false;
  }
  input.addEventListener("focus", () => open(true));
  input.addEventListener("click", () => { if (!isOpen()) open(true); });
  input.addEventListener("input", () => { if (!picking) open(false); });
  input.addEventListener("blur", () => setTimeout(close, 120));
  input.addEventListener("keydown", e => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!isOpen()) { open(true); return; }
      active = (active + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length; paint();
    } else if (e.key === "Enter" && isOpen() && active >= 0) { e.preventDefault(); e.stopPropagation(); pick(items[active]); }
    else if (e.key === "Escape" && isOpen()) { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === "Tab") close();
  });
  list.addEventListener("mousedown", e => e.preventDefault());
  list.addEventListener("click", e => { const li = e.target.closest("li"); if (li) pick(items[+li.dataset.i]); });
  btn.addEventListener("mousedown", e => e.preventDefault());
  btn.addEventListener("click", e => { e.preventDefault(); if (isOpen()) close(); else { input.focus(); open(true); } });
  window.addEventListener("scroll", e => { if (isOpen() && e.target !== list) close(); }, true);
  window.addEventListener("resize", () => { if (isOpen()) close(); });
}

/* ---------- Selects open the same dropdown as the comboboxes ---------- */
// On touch devices the native picker is kept – it is easier to use with a finger.
const coarsePointer = window.matchMedia && matchMedia("(pointer: coarse)").matches;
let selOpen = null;
function placeList(list, anchor) {
  const r = anchor.getBoundingClientRect(), w = Math.max(r.width, 220);
  list.style.width = w + "px";
  list.style.left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) + "px";
  const below = window.innerHeight - r.bottom;
  if (below < 220 && r.top > below) { list.style.top = "auto"; list.style.bottom = (window.innerHeight - r.top + 3) + "px"; }
  else { list.style.bottom = "auto"; list.style.top = (r.bottom + 3) + "px"; }
}
function paintSelect() {
  if (!selOpen) return;
  [...selOpen.list.children].forEach((li, i) => li.setAttribute("aria-selected", String(i === selOpen.active)));
  const a = selOpen.list.children[selOpen.active]; if (a) a.scrollIntoView({ block: "nearest" });
}
function openSelect(sel) {
  closeSelect();
  const list = document.createElement("ul");
  list.className = "combo-list"; list.setAttribute("role", "listbox");
  list.innerHTML = [...sel.options].map((o, i) => `<li role="option" data-i="${i}"${i === sel.selectedIndex ? ' class="cur"' : ""}>${esc(o.textContent)}</li>`).join("");
  list.addEventListener("mousedown", e => e.preventDefault());
  list.addEventListener("click", e => { const li = e.target.closest("li"); if (!li) return; e.preventDefault(); pickSelect(+li.dataset.i); });
  sel.parentNode.appendChild(list);
  placeList(list, sel);
  selOpen = { sel, list, active: sel.selectedIndex };
  sel.setAttribute("aria-expanded", "true");
  paintSelect();
}
function closeSelect() {
  if (!selOpen) return;
  selOpen.list.remove(); selOpen.sel.setAttribute("aria-expanded", "false"); selOpen = null;
}
function pickSelect(i) {
  if (!selOpen) return;
  const sel = selOpen.sel; closeSelect(); sel.focus();
  if (sel.selectedIndex !== i) { sel.selectedIndex = i; sel.dispatchEvent(new Event("change", { bubbles: true })); }
}
if (!coarsePointer) {
  document.addEventListener("mousedown", e => {
    const sel = e.target.closest && e.target.closest(".field select");
    if (sel) {
      e.preventDefault(); sel.focus();
      if (selOpen && selOpen.sel === sel) closeSelect(); else openSelect(sel);
      return;
    }
    if (selOpen && !selOpen.list.contains(e.target)) closeSelect();
  }, true);
  document.addEventListener("keydown", e => {
    const sel = e.target.closest && e.target.closest(".field select");
    if (!sel) return;
    if (selOpen && selOpen.sel === sel) {
      const n = sel.options.length;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); selOpen.active = (selOpen.active + (e.key === "ArrowDown" ? 1 : -1) + n) % n; paintSelect(); }
      else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); pickSelect(selOpen.active); }
      else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeSelect(); }
      else if (e.key === "Tab") closeSelect();
    } else if (e.key === "Enter" || e.key === " " || e.key === "F4" || (e.altKey && e.key === "ArrowDown")) {
      e.preventDefault(); openSelect(sel);
    }
  }, true);
  document.addEventListener("focusout", e => { if (selOpen && e.target === selOpen.sel) setTimeout(() => { if (selOpen && document.activeElement !== selOpen.sel) closeSelect(); }, 120); });
  window.addEventListener("scroll", e => { if (selOpen && e.target !== selOpen.list) closeSelect(); }, true);
  window.addEventListener("resize", closeSelect);
  document.addEventListener("close", closeSelect, true); // a dialog closed
}
combo($("#tActivity"), activities);
combo($("#tSO"), () => soOptions($("#tProject").value));
combo(fEntry.activity, activities);
combo(fEntry.so, () => soOptions($("#eProject").value));

$("#btnNudge").addEventListener("click", () => $("#btnBackup").click());
$("#btnPersist").addEventListener("click", async () => {
  await checkPersist(true); renderStorageUI();
  toast(Store.persisted ? "Prehliadač povolil trvalé uloženie." : "Prehliadač trvalé uloženie zatiaľ nepovolil. Pridajte stránku medzi záložky a skúste to znova.");
});

tickT = setInterval(tick, 1000);
initStore();
})();
