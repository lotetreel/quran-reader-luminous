"use strict";

/* ============================================================
   Qur'an Reader — app
   Loads data/manifest.json + data/surahs/NNN.json
   ============================================================ */

const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, className) => {
  const n = document.createElement(tag);
  if (className) n.className = className;
  return n;
};
const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const arDigits = (n) => String(n).replace(/\d/g, (d) => ARABIC_DIGITS[+d]);
const pad3 = (n) => String(n).padStart(3, "0");
const TOTAL = 114;
const THEME_COLORS = { day: "#fafaf7", sepia: "#f6f0e2", night: "#14110d" };
const SETTINGS_KEY = "quran-reader.settings.v1";

const defaults = {
  sura: 1,
  aya: null,
  theme: "sepia",
  font: "amiri",
  size: 2,
  mode: "luminous",
  fit: true,
  translit: true,
  english: true,
};

let settings = { ...defaults };
try {
  const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
  for (const k of Object.keys(defaults)) if (k in saved) settings[k] = saved[k];
} catch { /* first visit */ }

const app = {
  manifest: null,
  chapters: [], // [sura] -> chapter meta
  surah: null,  // full chapter document
  loading: false,
};

let chapterFilter = "";

/* ============================== init ============================== */

async function init() {
  applySettings();
  bindEvents();
  updateTopbar();
  updateBottomNav();

  if (location.protocol === "file:") {
    showProtocolError();
    return;
  }
  showLoader("Preparing the reader");
  try {
    const res = await fetch("data/manifest.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(res.status);
    app.manifest = await res.json();
    for (const c of app.manifest.chapters) app.chapters[c.sura] = c;
  } catch {
    showLoadError();
    return;
  }
  renderChapterList();
  openSurah(settings.sura, settings.aya);
}

/* ============================== surah loading ============================== */

async function openSurah(n, aya = null) {
  if (app.loading || n < 1 || n > TOTAL) return;
  app.loading = true;
  settings.sura = n;
  settings.aya = (settings.mode === "verse" || settings.mode === "luminous") ? (aya ?? 1) : null;
  saveSettings();

  updateTopbar();
  updateBottomNav();
  updateChapterActive();
  showLoader(app.chapters[n] ? app.chapters[n].transliteration : String(n));

  try {
    const res = await fetch(`data/surahs/${pad3(n)}.json`, { cache: "no-cache" });
    if (!res.ok) throw new Error(res.status);
    app.surah = await res.json();
    renderReader();
  } catch {
    showLoadError();
    return;
  }
  app.loading = false;

  requestAnimationFrame(() => {
    if (settings.mode === "verse") { fitVerse(); return; }
    if (settings.mode === "luminous") return;
    if (aya) {
      const target = document.getElementById(`v-${n}-${aya}`);
      if (target) {
        target.scrollIntoView({ block: "center" });
        target.classList.add("flash");
        setTimeout(() => target.classList.remove("flash"), 1900);
      }
    } else {
      window.scrollTo(0, 0);
    }
  });
}

function renderSurah() {
  const ch = app.surah.chapter;
  const n = ch.sura;
  const inner = $("#readerInner");
  inner.innerHTML = "";

  const header = el("header", "surah-header");
  header.innerHTML = `
    <div class="sh-ornament" aria-hidden="true">۞</div>
    <h1 class="sh-arabic" lang="ar" dir="rtl">${ch.name_arabic}</h1>
    <div class="sh-names">${escapeHtml(ch.transliteration)}<span class="dot">·</span>${escapeHtml(ch.name_english)}</div>
    <div class="sh-chips">
      <span class="chip">${escapeHtml(ch.origin)}</span>
      <span class="chip">${arDigits(ch.verse_count)} verses</span>
      <span class="chip">Juz ${ch.juz}</span>
    </div>
    ${ch.display_basmalah ? `<div class="sh-basmalah" lang="ar" dir="rtl">${ch.display_basmalah}</div>` : ""}
    <div class="sh-rule" aria-hidden="true"></div>
  `;
  inner.appendChild(header);
  renderVerses(inner);

  // end-of-surah navigation
  const nav = el("nav", "surah-nav");
  const prev = app.chapters[n - 1];
  const next = app.chapters[n + 1];
  const left = el("button", "sn-btn");
  left.innerHTML = `<span class="sn-dir">‹ Previous surah</span><span class="sn-name">${prev ? `${escapeHtml(prev.transliteration)} · ${prev.sura}` : "— first surah"}</span>`;
  if (!prev) left.disabled = true;
  else left.addEventListener("click", () => openSurah(n - 1));
  const orn = el("span", "sn-ornament");
  orn.textContent = "۞";
  orn.setAttribute("aria-hidden", "true");
  const right = el("button", "sn-btn right");
  right.innerHTML = `<span class="sn-dir">Next surah ›</span><span class="sn-name">${next ? `${escapeHtml(next.transliteration)} · ${next.sura}` : "— final surah"}</span>`;
  if (!next) right.disabled = true;
  else right.addEventListener("click", () => openSurah(n + 1));
  nav.append(left, orn, right);
  inner.appendChild(nav);

  const footer = el("div", "reader-footer");
  footer.textContent = "۞ ۞ ۞";
  footer.setAttribute("aria-hidden", "true");
  inner.appendChild(footer);
}

function renderVerses(container) {
  const list = el("div", "verses");
  for (const v of app.surah.verses) {
    const art = el("article", "verse");
    art.id = `v-${v.sura}-${v.aya}`;

    const arabic = el("div", "verse-arabic");
    arabic.lang = "ar";
    arabic.dir = "rtl";
    arabic.appendChild(document.createTextNode(v.arabic + " "));
    const end = el("span", "ayah-end");
    end.textContent = arDigits(v.aya);
    arabic.appendChild(end);
    art.appendChild(arabic);

    if (settings.translit) {
      const tr = el("div", "verse-translit");
      tr.innerHTML = v.transliteration_html; // trusted local data
      art.appendChild(tr);
    }
    if (settings.english) {
      const en = el("div", "verse-english");
      en.textContent = v.english;
      art.appendChild(en);
    }
    list.appendChild(art);
  }
  const header = container.querySelector(".surah-header");
  const nav = container.querySelector(".surah-nav");
  container.querySelector(".verses")?.remove();
  if (nav) header.after(list);
  else container.appendChild(list);
}

/* ============================== verse-by-verse mode ============================== */

let fitRO = null;

function renderReader() {
  if (settings.mode === "verse") renderVerse();
  else if (settings.mode === "luminous") renderLuminous();
  else renderSurah();
}

function renderVerse(dir = 0) {
  const ch = app.surah.chapter;
  const a = Math.min(Math.max(settings.aya ?? 1, 1), ch.verse_count);
  settings.aya = a;
  const v = app.surah.verses.find((x) => x.aya === a) || app.surah.verses[a - 1];
  const inner = $("#readerInner");
  inner.innerHTML = "";

  const header = el("header", "surah-header vb-compact");
  header.innerHTML = `
    <div class="sh-ornament" aria-hidden="true">۞</div>
    <h1 class="sh-arabic" lang="ar" dir="rtl">${ch.name_arabic}</h1>
    <div class="sh-names">${escapeHtml(ch.transliteration)}<span class="dot">·</span>${escapeHtml(ch.name_english)}</div>
  `;
  inner.appendChild(header);

  const stage = el("div", "vb-stage");

  const top = el("div", "vb-top");
  const ref = el("div", "vb-ref");
  ref.innerHTML = `${ch.sura} · ${escapeHtml(ch.transliteration)} <span class="vb-ref-aya">${ch.sura}:${arDigits(a)}</span>`;
  const prog = el("div", "vb-progress");
  const fill = el("div", "vb-progress-fill");
  fill.style.width = (a / ch.verse_count) * 100 + "%";
  prog.appendChild(fill);
  top.append(ref, prog);

  const fit = el("div", "vb-fit");
  const anim = el("div", "vb-anim" + (dir > 0 ? " in-next" : dir < 0 ? " in-prev" : ""));
  const card = el("article", "vb-card");

  if (ch.display_basmalah && a === 1) {
    const basm = el("div", "vb-basmalah");
    basm.lang = "ar";
    basm.dir = "rtl";
    basm.textContent = ch.display_basmalah;
    card.appendChild(basm);
  }

  const arabic = el("div", "vb-arabic");
  arabic.lang = "ar";
  arabic.dir = "rtl";
  arabic.appendChild(document.createTextNode(v.arabic + " "));
  const end = el("span", "ayah-end");
  end.textContent = arDigits(a);
  arabic.appendChild(end);
  card.appendChild(arabic);

  const rule = el("div", "vb-rule");
  rule.setAttribute("aria-hidden", "true");
  card.appendChild(rule);

  if (settings.translit) {
    const tr = el("div", "vb-translit");
    tr.innerHTML = v.transliteration_html; // trusted local data
    card.appendChild(tr);
  }
  if (settings.english) {
    const en = el("div", "vb-english");
    en.textContent = v.english;
    card.appendChild(en);
  }

  anim.appendChild(card);
  fit.appendChild(anim);

  const foot = el("div", "vb-foot");
  const prev = el("button", "vb-btn");
  prev.setAttribute("aria-label", "Previous verse");
  prev.title = "Previous verse (←)";
  prev.innerHTML = `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m14 6-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const count = el("div", "vb-count");
  count.innerHTML = `${a} <span class="vb-count-sep">/</span> ${ch.verse_count}`;
  count.title = `Verse ${a} of ${ch.verse_count}`;
  const next = el("button", "vb-btn");
  next.setAttribute("aria-label", "Next verse");
  next.title = "Next verse (→)";
  next.innerHTML = `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m10 6 6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  foot.append(prev, count, next);

  prev.disabled = ch.sura === 1 && a === 1;
  next.disabled = ch.sura === TOTAL && a === ch.verse_count;
  prev.addEventListener("click", () => verseStep(-1));
  next.addEventListener("click", () => verseStep(1));

  stage.append(top, fit, foot);
  inner.appendChild(stage);

  document.title = `${ch.transliteration} ${ch.sura}:${a} — Qur'an Reader`;
  $("#progressBar").style.width = (a / ch.verse_count) * 100 + "%";

  if (typeof ResizeObserver !== "undefined") {
    if (!fitRO) fitRO = new ResizeObserver(() => fitVerse());
    fitRO.disconnect();
    fitRO.observe(fit);
  }
  fitVerse();
}

function fitVerse() {
  if (document.documentElement.dataset.mode !== "verse") return;
  const fit = $(".vb-fit");
  const card = $(".vb-card");
  if (!fit || !card) return;
  requestAnimationFrame(() => {
    if (fit !== $(".vb-fit") || !card.isConnected) return;
    const anim = card.parentElement;
    card.style.transform = "";
    anim.style.height = "";
    if (!settings.fit) return;
    const pad = 12;
    const h = card.offsetHeight;
    const w = card.offsetWidth;
    if (!h || !w) return;
    const raw = Math.min(1, (fit.clientHeight - pad * 2) / h, (fit.clientWidth - pad * 2) / w);
    const s = Math.max(raw, 0.6); // floor: below this the verse overflows and scrolls instead of shrinking tiny
    if (isFinite(s) && s < 1) {
      card.style.transform = `scale(${s})`;
      anim.style.height = Math.ceil(h * s) + "px";
    }
  });
}

function verseStep(dir) {
  if (!app.surah || app.loading) return;
  const ch = app.surah.chapter;
  const a = settings.aya ?? 1;
  if (dir > 0 && a < ch.verse_count) {
    settings.aya = a + 1;
    saveSettings();
    renderCurrent(1);
    return;
  }
  if (dir > 0) { openSurah(ch.sura + 1, 1); return; }
  if (dir < 0 && a > 1) {
    settings.aya = a - 1;
    saveSettings();
    renderCurrent(-1);
    return;
  }
  const prevCh = app.chapters[ch.sura - 1];
  if (prevCh) openSurah(ch.sura - 1, prevCh.verse_count);
}

/* ============================== luminous mode ============================== */

let lumRO = null;

function renderCurrent(dir = 0) {
  if (settings.mode === "luminous") renderLuminous(dir);
  else renderVerse(dir);
}

function renderLuminous(dir = 0) {
  const ch = app.surah.chapter;
  const a = Math.min(Math.max(settings.aya ?? 1, 1), ch.verse_count);
  settings.aya = a;
  const v = app.surah.verses.find((x) => x.aya === a) || app.surah.verses[a - 1];
  const inner = $("#readerInner");

  const R = 140;
  const C = 2 * Math.PI * R;

  // The stage shell (halo, ring, top line, nav) persists while you page
  // through one surah, so the ring never jumps: its offset simply glides
  // from where it was to where it goes. A new surah rebuilds the shell.
  const existing = inner.querySelector(".lum-stage");
  const fresh = !existing || existing.dataset.sura !== String(ch.sura);
  let stage;
  if (fresh) {
    inner.innerHTML = "";
    const T = R - 16;
    const per = (2 * Math.PI * T) / 72;
    stage = el("div", "lum-stage");
    stage.dataset.sura = String(ch.sura);
    stage.innerHTML = `
    <div class="lum-ambient" aria-hidden="true"></div>
    <div class="lum-top">
      <span class="lum-top-orn" aria-hidden="true">۞</span>
      <span class="lum-top-name">${ch.sura} · ${escapeHtml(ch.transliteration)}</span>
      <span class="lum-top-ar" lang="ar" dir="rtl">${ch.name_arabic}</span>
    </div>
    <div class="lum-center">
      <svg class="lum-ring" viewBox="0 0 320 320" aria-hidden="true">
        <defs>
          <linearGradient id="lumGrad" x1="0" y1="0" x2="1" y2="1">
            <stop class="lum-stop-a" offset="0%"/>
            <stop class="lum-stop-b" offset="100%"/>
          </linearGradient>
        </defs>
        <circle class="lum-ring-track" cx="160" cy="160" r="${R}"/>
        <circle class="lum-ring-ticks" cx="160" cy="160" r="${T}"/>
        <circle class="lum-ring-fill" cx="160" cy="160" r="${R}"/>
      </svg>
    </div>
    <div class="lum-nav">
      <button class="lum-btn lum-btn-prev" aria-label="Previous verse" title="Previous verse (←)"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m14 6-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      <span class="lum-count"></span>
      <button class="lum-btn lum-btn-next" aria-label="Next verse" title="Next verse (→)"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m10 6 6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
    </div>`;
    inner.appendChild(stage);
    const fill = stage.querySelector(".lum-ring-fill");
    fill.style.strokeDasharray = C.toFixed(2);
    fill.style.strokeDashoffset = C.toFixed(2); // start empty so the first sweep is a transition
    void fill.getBoundingClientRect();
    requestAnimationFrame(() => {
      fill.style.strokeDashoffset = (C * (1 - a / ch.verse_count)).toFixed(2);
    });
    stage.querySelector(".lum-ring-ticks").style.strokeDasharray =
      `${(per * 0.16).toFixed(3)} ${(per * 0.84).toFixed(3)}`;
  } else {
    stage = existing;
    const fill = stage.querySelector(".lum-ring-fill");
    fill.style.strokeDasharray = C.toFixed(2);
    fill.style.strokeDashoffset = (C * (1 - a / ch.verse_count)).toFixed(2); // glides via CSS transition
  }

  const { slide, caps } = buildLumVerse(ch, a, v, dir);
  const center = stage.querySelector(".lum-center");
  const oldSlide = center.querySelector(".lum-slide");
  if (oldSlide) oldSlide.replaceWith(slide);
  else center.appendChild(slide);
  const oldCaps = stage.querySelector(".lum-captions");
  if (oldCaps) oldCaps.replaceWith(caps);
  else stage.insertBefore(caps, stage.querySelector(".lum-nav"));

  const prev = stage.querySelector(".lum-btn-prev");
  const next = stage.querySelector(".lum-btn-next");
  prev.disabled = ch.sura === 1 && a === 1;
  next.disabled = ch.sura === TOTAL && a === ch.verse_count;
  prev.onclick = () => verseStep(-1);
  next.onclick = () => verseStep(1);

  const count = stage.querySelector(".lum-count");
  count.textContent = `${a} / ${ch.verse_count}`;
  count.title = `Verse ${a} of ${ch.verse_count}`;

  document.title = `${ch.transliteration} ${ch.sura}:${a} — Qur'an Reader · Luminous`;
  $("#progressBar").style.width = (a / ch.verse_count) * 100 + "%";

  if (typeof ResizeObserver !== "undefined") {
    if (!lumRO) lumRO = new ResizeObserver(() => fitLuminous());
    lumRO.disconnect();
    lumRO.observe(center);
  }
  fitLuminous();
}

// Per-verse content: the Arabic cascade + captions. Rebuilt on every step
// so the word reveal re-runs; the surrounding shell stays put.
function buildLumVerse(ch, a, v, dir) {
  const slide = el(
    "div",
    "lum-slide" + (dir > 0 ? " lum-from-next" : dir < 0 ? " lum-from-prev" : "")
  );
  const verse = el("div", "lum-verse");
  verse.innerHTML = `
    <div class="lum-bismillah-slot"></div>
    <div class="lum-arabic" lang="ar" dir="rtl" aria-label="${escapeHtml(v.arabic)}"></div>
    <div class="lum-num">
      <span class="lum-num-aya" lang="ar">${arDigits(a)}</span>
      <span class="lum-num-total">of ${ch.verse_count}</span>
    </div>`;
  slide.appendChild(verse);
  const caps = el("div", "lum-captions");

  if (ch.display_basmalah && a === 1) {
    const b = el("div", "lum-bismillah");
    b.lang = "ar";
    b.dir = "rtl";
    b.textContent = ch.display_basmalah;
    verse.querySelector(".lum-bismillah-slot").appendChild(b);
  }

  // word-by-word reveal
  const arab = verse.querySelector(".lum-arabic");
  const words = v.arabic.split(/\s+/).filter(Boolean);
  const t0 = 300, stepMs = 70;
  words.forEach((w, i) => {
    const sp = el("span", "lum-word");
    sp.textContent = w;
    sp.style.animationDelay = t0 + i * stepMs + "ms";
    sp.setAttribute("aria-hidden", "true");
    arab.appendChild(sp);
    if (i < words.length - 1) arab.appendChild(document.createTextNode(" "));
  });
  const end = el("span", "ayah-end lum-word");
  end.textContent = arDigits(a);
  end.style.animationDelay = t0 + words.length * stepMs + "ms";
  end.setAttribute("aria-hidden", "true");
  arab.appendChild(end);

  // captions land after the Arabic has finished revealing
  const capDelay = t0 + (words.length + 1) * stepMs + 250;
  caps.style.setProperty("--cap-delay", capDelay + "ms");
  verse.style.setProperty("--cap-delay", capDelay + "ms");
  if (settings.translit) {
    const tr = el("div", "lum-translit");
    tr.innerHTML = v.transliteration_html; // trusted local data
    caps.appendChild(tr);
  }
  if (settings.english) {
    const en = el("div", "lum-english");
    en.textContent = v.english;
    caps.appendChild(en);
  }
  return { slide, caps };
}

function fitLuminous() {
  const center = $(".lum-center");
  const verse = $(".lum-verse");
  if (!center || !verse) return;
  requestAnimationFrame(() => {
    if (!verse.isConnected || !center.contains(verse)) return;
    verse.style.transform = "";
    const avail = center.clientHeight - 20;
    const h = verse.scrollHeight;
    if (!h || !avail || h <= avail) return;
    verse.style.transform = `scale(${Math.max(avail / h, 0.5)})`;
  });
}

function flashLumNav(dir) {
  const btn = $(dir > 0 ? ".lum-btn-next" : ".lum-btn-prev");
  if (!btn) return;
  btn.classList.remove("lum-flash");
  void btn.offsetWidth; // restart animation
  btn.classList.add("lum-flash");
}

/* ============================== chapter list ============================== */

function renderChapterList() {
  const listEl = $("#chapterList");
  listEl.innerHTML = "";
  const f = chapterFilter.trim().toLowerCase();
  let shown = 0;

  for (let s = 1; s <= TOTAL; s++) {
    const ch = app.chapters[s];
    if (!ch) continue;
    if (f) {
      const hay = `${s} ${ch.transliteration} ${ch.name_english} ${ch.name_arabic}`.toLowerCase();
      if (!hay.includes(f)) continue;
    }
    shown++;
    const btn = el("button", "chapter-item" + (s === settings.sura ? " active" : ""));
    btn.dataset.sura = s;
    btn.setAttribute("role", "listitem");
    btn.innerHTML = `
      <span class="ci-num">${s}</span>
      <span class="ci-text">
        <span class="ci-top">
          <span class="ci-name">${escapeHtml(ch.transliteration)}</span>
          <span class="ci-arabic" lang="ar">${ch.name_arabic}</span>
        </span>
        <span class="ci-sub">${escapeHtml(ch.name_english)} · ${ch.verse_count} verses</span>
      </span>
      <span class="ci-origin ${ch.origin === "Meccan" ? "meccan" : "medinan"}">${ch.origin}</span>
    `;
    btn.addEventListener("click", () => {
      openSurah(s);
      if (isMobile()) document.body.classList.remove("nav-open");
    });
    listEl.appendChild(btn);
  }
  if (shown === 0) {
    const empty = el("div", "list-empty");
    empty.textContent = f ? "No surah matches that search." : "";
    listEl.appendChild(empty);
  }
}

function updateChapterActive() {
  for (const btn of $("#chapterList").querySelectorAll(".chapter-item")) {
    btn.classList.toggle("active", Number(btn.dataset.sura) === settings.sura);
  }
}

/* ============================== chrome updates ============================== */

function updateTopbar() {
  const ch = app.chapters[settings.sura];
  if (!ch) return;
  $("#tbName").textContent = `${ch.sura} · ${ch.transliteration}`;
  $("#tbArabic").textContent = ch.name_arabic;
  document.title = `${ch.transliteration} — Qur'an Reader · Luminous`;
}

function updateBottomNav() {
  const cur = settings.sura;
  const prev = app.chapters[cur - 1];
  const next = app.chapters[cur + 1];
  const pb = $("#prevBtn");
  const nb = $("#nextBtn");
  pb.querySelector(".bn-name").textContent = prev ? prev.transliteration : "—";
  nb.querySelector(".bn-name").textContent = next ? next.transliteration : "—";
  pb.disabled = !prev;
  nb.disabled = !next;
}

/* ============================== settings ============================== */

function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* private mode */ }
}

function applySettings() {
  const root = document.documentElement;
  root.dataset.theme = settings.theme;
  root.dataset.font = settings.font;
  root.dataset.size = String(settings.size);
  root.dataset.mode = settings.mode;
  $("#translitToggle").checked = settings.translit;
  $("#englishToggle").checked = settings.english;
  $("#fitToggle").checked = settings.fit;
  setActiveOptions("themeRow", String(settings.theme));
  setActiveOptions("fontRow", settings.font);
  setActiveOptions("sizeRow", String(settings.size));
  setActiveOptions("modeRow", settings.mode);
  document.querySelector('meta[name="theme-color"]').content = THEME_COLORS[settings.theme];
  if (settings.mode === "verse") {
    fitVerse();
    requestAnimationFrame(fitVerse);
  } else if (settings.mode === "luminous") {
    fitLuminous();
    requestAnimationFrame(fitLuminous);
  }
}

function setActiveOptions(rowId, value) {
  for (const btn of document.getElementById(rowId).querySelectorAll("button")) {
    btn.classList.toggle("active", btn.dataset.opt === value);
  }
}

function reRenderVerses() {
  if (!app.surah) return;
  if (settings.mode === "verse" || settings.mode === "luminous") { renderCurrent(); return; }
  const y = window.scrollY;
  renderVerses($("#readerInner"));
  window.scrollTo(0, y);
}

/* ============================== loader / errors ============================== */

function showLoader(label) {
  $("#readerInner").innerHTML = `
    <div class="loader">
      <div class="loader-ring"></div>
      <div class="loader-label">${escapeHtml(label)}</div>
    </div>`;
  window.scrollTo(0, 0);
}

function showLoadError() {
  $("#readerInner").innerHTML = `
    <div class="error-card"><div class="error-inner">
      <div class="orn" aria-hidden="true">۞</div>
      <h2>Couldn't load this surah</h2>
      <p>The data files appear to be missing or unreachable. Make sure the <b>data/</b> folder is inside this folder and serve it over HTTP.</p>
      <code>python3 -m http.server 8080</code>
    </div></div>`;
}

function showProtocolError() {
  $("#readerInner").innerHTML = `
    <div class="error-card"><div class="error-inner">
      <div class="orn" aria-hidden="true">۞</div>
      <h2>Serve over HTTP</h2>
      <p>Browsers block local JSON fetches when a page is opened directly from disk. Start a small web server from this folder and open it in your browser.</p>
      <code>cd quran-reader &amp;&amp; python3 -m http.server 8080</code>
    </div></div>`;
}

/* ============================== sidebar ============================== */

function isMobile() {
  return window.matchMedia("(max-width: 899px)").matches;
}

function toggleSidebar(forceOpen) {
  const open = forceOpen !== undefined
    ? forceOpen
    : isMobile()
      ? !document.body.classList.contains("nav-open")
      : document.body.classList.contains("nav-hidden");
  if (isMobile()) {
    document.body.classList.toggle("nav-open", open);
  } else {
    document.body.classList.toggle("nav-hidden", !open);
  }
}

/* ============================== jump dialog ============================== */

function openJump() {
  $("#jumpOverlay").hidden = false;
  const input = $("#jumpInput");
  input.value = "";
  input.focus();
}

function closeJump() {
  $("#jumpOverlay").hidden = true;
}

function submitJump() {
  const raw = $("#jumpInput").value.trim();
  const m = raw.match(/^(\d{1,3})\s*[:\-]?\s*(\d{1,3})?$/);
  if (!m) return jumpShake();
  const s = +m[1];
  const a = m[2] ? +m[2] : null;
  const ch = app.chapters[s];
  if (!ch || (a && (a < 1 || a > ch.verse_count))) return jumpShake();
  closeJump();
  if (s === settings.sura) {
    if (a) {
      if (settings.mode === "verse" || settings.mode === "luminous") {
        settings.aya = a;
        saveSettings();
        renderCurrent();
        return;
      }
      const target = document.getElementById(`v-${s}-${a}`);
      if (target) {
        target.scrollIntoView({ block: "center" });
        target.classList.add("flash");
        setTimeout(() => target.classList.remove("flash"), 1900);
      }
    } else {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  } else {
    openSurah(s, a);
  }
}

function jumpShake() {
  const card = $(".jump-card");
  card.classList.remove("shake");
  void card.offsetWidth; // restart animation
  card.classList.add("shake");
}

/* ============================== events ============================== */

function bindEvents() {
  $("#menuBtn").addEventListener("click", () => toggleSidebar());
  $("#backdrop").addEventListener("click", () => document.body.classList.remove("nav-open"));

  $("#chapterSearch").addEventListener("input", (e) => {
    chapterFilter = e.target.value;
    renderChapterList();
  });

  $("#jumpBtn").addEventListener("click", openJump);
  $("#jumpClose").addEventListener("click", closeJump);
  $("#jumpInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") submitJump();
    if (e.key === "Escape") closeJump();
  });
  $("#jumpOverlay").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeJump();
  });

  // settings panel
  const panel = $("#settingsPanel");
  $("#settingsBtn").addEventListener("click", (e) => {
    e.stopPropagation();
    panel.hidden = !panel.hidden;
  });
  document.addEventListener("click", (e) => {
    if (!panel.hidden && !panel.contains(e.target) && !$("#settingsBtn").contains(e.target)) {
      panel.hidden = true;
    }
  });
  $("#themeRow").addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    settings.theme = btn.dataset.opt;
    saveSettings();
    applySettings();
  });
  $("#fontRow").addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    settings.font = btn.dataset.opt;
    saveSettings();
    applySettings();
  });
  $("#sizeRow").addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    settings.size = +btn.dataset.opt;
    saveSettings();
    applySettings();
  });
  $("#modeRow").addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn || btn.dataset.opt === settings.mode) return;
    settings.mode = btn.dataset.opt;
    if (settings.mode === "verse" || settings.mode === "luminous") {
      if (!settings.aya) settings.aya = 1;
    } else {
      settings.aya = null;
    }
    saveSettings();
    applySettings();
    if (app.surah) renderReader();
  });
  $("#fitToggle").addEventListener("change", (e) => {
    settings.fit = e.target.checked;
    saveSettings();
    if (settings.mode === "verse") fitVerse();
  });
  $("#translitToggle").addEventListener("change", (e) => {
    settings.translit = e.target.checked;
    saveSettings();
    reRenderVerses();
  });
  $("#englishToggle").addEventListener("change", (e) => {
    settings.english = e.target.checked;
    saveSettings();
    reRenderVerses();
  });

  // navigation
  $("#prevBtn").addEventListener("click", () => openSurah(settings.sura - 1));
  $("#nextBtn").addEventListener("click", () => openSurah(settings.sura + 1));

  // scroll progress
  document.addEventListener("scroll", () => {
    if (document.documentElement.dataset.mode === "verse" || document.documentElement.dataset.mode === "luminous") return;
    const h = document.documentElement;
    const max = h.scrollHeight - h.clientHeight;
    $("#progressBar").style.width = (max > 0 ? (h.scrollTop / max) * 100 : 0) + "%";
  }, { passive: true });

  // keyboard
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (!$("#jumpOverlay").hidden) return closeJump();
      if (!$("#settingsPanel").hidden) return ($("#settingsPanel").hidden = true);
      if (document.body.classList.contains("nav-open")) return document.body.classList.remove("nav-open");
      return;
    }
    if (e.target instanceof Element && e.target.matches("input, textarea")) return;
    if (!$("#jumpOverlay").hidden) return;
    const inVerse = document.documentElement.dataset.mode === "verse" || document.documentElement.dataset.mode === "luminous";
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      const dir = e.key === "ArrowRight" ? 1 : -1;
      if (inVerse) {
        if (e.altKey) openSurah(settings.sura + dir);
        else { verseStep(dir); flashLumNav(dir); }
      } else {
        openSurah(settings.sura + dir);
      }
    } else if (inVerse && e.key === "Home" && app.surah) {
      settings.aya = 1;
      saveSettings();
      renderCurrent(-1);
    } else if (inVerse && e.key === "End" && app.surah) {
      settings.aya = app.surah.chapter.verse_count;
      saveSettings();
      renderCurrent(1);
    } else if (e.key === "/") {
      e.preventDefault();
      toggleSidebar(true);
      $("#chapterSearch").focus();
    }
  });

  window.addEventListener("resize", () => {
    if (!isMobile()) document.body.classList.remove("nav-open");
    const mode = document.documentElement.dataset.mode;
    if (mode === "verse") fitVerse();
    else if (mode === "luminous") fitLuminous();
  });

  // touch swipe (verse mode)
  let swipeX = null, swipeY = null;
  $("#reader").addEventListener("touchstart", (e) => {
    swipeX = e.touches[0].clientX;
    swipeY = e.touches[0].clientY;
  }, { passive: true });
  $("#reader").addEventListener("touchend", (e) => {
    const mode = document.documentElement.dataset.mode;
    if (swipeX !== null && (mode === "verse" || mode === "luminous")) {
      const dx = e.changedTouches[0].clientX - swipeX;
      const dy = e.changedTouches[0].clientY - swipeY;
      if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.4) {
        const dir = dx < 0 ? 1 : -1;
        verseStep(dir);
        flashLumNav(dir);
      }
    }
    swipeX = null;
  }, { passive: true });

}

/* ============================== helpers ============================== */

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

document.addEventListener("DOMContentLoaded", init);
