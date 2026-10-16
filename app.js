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
// U+06DD END OF AYAH: the Arabic fonts draw it as the ornament with the
// number inside, as in a printed mushaf
const ayahMark = (n) => "\u06DD" + arDigits(n);
const TOTAL = 114;
const THEME_COLORS = { day: "#fafaf7", sepia: "#f6f0e2", night: "#14110d" };
const EN_SCALES = [0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.45, 1.6, 1.8]; // keep in sync with html[data-ensize] in styles.css
const SETTINGS_KEY = "quran-reader.settings.v1";

const defaults = {
  sura: 1,
  aya: null,
  theme: "sepia",
  font: "scheherazade",
  size: 2,
  enSize: 2,
  mode: "luminous",
  fit: true,
  translit: true,
  english: true,
  presentLayout: "auto",
  width: "focused",
  backdrop: "ring",
};

let settings = { ...defaults };
let returning = false; // has this browser read here before?
try {
  returning = !!localStorage.getItem(SETTINGS_KEY);
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

/* ============================== deep links (#sura/aya) ============================== */

function parseHash() {
  const m = (location.hash || "").match(/^#(\d{1,3})(?:[:/](\d{1,3}))?$/);
  if (!m) return null;
  const s = +m[1];
  const a = m[2] ? +m[2] : null;
  if (s < 1 || s > TOTAL || (a !== null && a < 1)) return null;
  return { s, a };
}

function setHash(sura, aya) {
  if (landingOpen) { updateBookmarkBtn(); return; } // keep the bare address while the landing page shows
  const want = aya ? `#${sura}/${aya}` : `#${sura}`;
  if (location.hash !== want) history.replaceState(null, "", want);
  updateBookmarkBtn();
}

/* ============================== init ============================== */

async function init() {
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  applySettings();
  bindEvents();
  document.fonts?.ready.then(() => { if (settings.mode === "luminous") fitLuminous(); });
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
  const deep = parseHash();
  // a bare visit to the site opens on the landing page; deep links (#2/255)
  // and the installed app (#continue) go straight to reading
  if (!location.hash) showLanding();
  openSurah(deep ? deep.s : settings.sura, deep ? deep.a : settings.aya);
}

/* ============================== surah loading ============================== */

async function openSurah(n, aya = null) {
  if (app.loading || n < 1 || n > TOTAL) return;
  app.loading = true;
  settings.sura = n;
  settings.aya = (settings.mode === "verse" || settings.mode === "luminous") ? (aya ?? 1) : null;
  saveSettings();
  setHash(n, settings.aya);

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
    const art = el("article", "verse" + (isBookmarked(v.sura, v.aya) ? " saved" : ""));
    art.id = `v-${v.sura}-${v.aya}`;

    const arabic = el("div", "verse-arabic");
    arabic.lang = "ar";
    arabic.dir = "rtl";
    arabic.appendChild(document.createTextNode(v.arabic + "\u00A0"));
    const end = el("span", "ayah-end");
    end.textContent = ayahMark(v.aya);
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
  arabic.appendChild(document.createTextNode(v.arabic + "\u00A0"));
  const end = el("span", "ayah-end");
  end.textContent = ayahMark(a);
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
  setHash(ch.sura, a);

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
    const cap = presenting ? 2.2 : 1; // on a projector, fill the stage instead of only shrinking
    const raw = Math.min(cap, (fit.clientHeight - pad * 2) / h, (fit.clientWidth - pad * 2) / w);
    const s = Math.max(raw, 0.34); // no-scroll guarantee: shrink as far as needed at large text sizes
    if (isFinite(s) && s !== 1) {
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
    ${lumBackdrops()}
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

  // The captions sit with the verse inside the centre stage, so the two are
  // fitted together (stacked, or side by side on a big screen) instead of
  // the English scrolling in its own short strip.
  const { slide, caps } = buildLumVerse(ch, a, v, dir);
  const center = stage.querySelector(".lum-center");
  slide.appendChild(caps);
  const oldSlide = center.querySelector(".lum-slide");
  if (oldSlide) oldSlide.replaceWith(slide);
  else center.appendChild(slide);

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
  setHash(ch.sura, a);

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
    <div class="lum-arabic" lang="ar" dir="rtl" aria-label="${escapeHtml(v.arabic)}"></div>`;
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
  const tail = el("span", "lum-tail");
  words.forEach((w, i) => {
    const sp = el("span", "lum-word");
    sp.textContent = w;
    sp.style.animationDelay = t0 + i * stepMs + "ms";
    sp.setAttribute("aria-hidden", "true");
    if (i === words.length - 1) tail.appendChild(sp);
    else arab.append(sp, document.createTextNode(" "));
  });
  const end = el("span", "ayah-end lum-word");
  end.textContent = ayahMark(a);
  end.style.animationDelay = t0 + words.length * stepMs + "ms";
  end.setAttribute("aria-hidden", "true");
  tail.append(document.createTextNode("\u00A0"), end);
  arab.appendChild(tail);

  // captions land after the Arabic has finished revealing
  const capDelay = t0 + (words.length + 1) * stepMs + 250;
  caps.style.setProperty("--cap-delay", capDelay + "ms");
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
    fitLumStage(center, verse.closest(".lum-slide"));
  });
}

// Rather than shrinking a fixed-width block, scale the type itself (--pfit)
// so lines re-wrap across the available width. Your Arabic/English size
// settings keep their proportions; only the overall scale changes.
// Reading: only ever shrink, and never below a readable floor — past that
// the stage scrolls as a whole. Big screen: grow to fill, never scroll, and
// pick whichever layout lets the text be largest.
const PRESENT_SPLITS = [0.5, 0.4, 0.6]; // English column's share of the width
const PFIT_MIN = 0.2, PFIT_MAX = 2.2, WIDE_MAX = 1.5, READ_MIN = 0.62;

function fitLumStage(center, slide) {
  if (!slide) return;
  center.classList.remove("lum-scroll");
  center.scrollTop = 0;
  // wide reading spreads across the whole reading area and may grow a little
  const wide = !presenting && settings.width === "wide";
  const max = presenting ? PFIT_MAX : wide ? WIDE_MAX : 1;
  const cs = getComputedStyle(center);
  const availH = center.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  const availW = center.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  if (availH <= 0 || availW <= 0) return;

  // Wrapped text grows roughly with the square of the type scale, so a
  // square-root step lands close in a few layouts; bisection is the fallback.
  const largest = () => {
    let lo = PFIT_MIN, hi = max, s = 1;
    for (let i = 0; i < 6; i++) {
      slide.style.setProperty("--pfit", s.toFixed(3));
      const h = slide.offsetHeight;
      const ok = h <= availH && slide.scrollWidth <= slide.clientWidth + 1;
      if (ok) lo = s; else hi = s;
      if (hi - lo < 0.015) break;
      let next = s * Math.sqrt(availH / h) * (ok ? 0.995 : 0.985);
      if (!(next > lo && next < hi)) next = ok && hi === max ? max : (lo + hi) / 2;
      s = next;
    }
    return lo;
  };
  const setLayout = (kind, share) => {
    slide.classList.toggle("lp-stack", kind === "stack");
    slide.classList.toggle("lp-side", kind === "side");
    if (share) slide.style.setProperty("--cap-share", share);
  };
  const tryStack = () => { setLayout("stack"); return { kind: "stack", s: largest() }; };
  const trySide = () => {
    let best = null;
    for (const share of PRESENT_SPLITS) {
      setLayout("side", share);
      const s = largest();
      if (!best || s > best.s + 0.01) best = { kind: "side", share, s };
    }
    return best;
  };

  const caps = slide.querySelector(".lum-captions");
  const hasCaps = caps && caps.childElementCount > 0;
  let pick;
  if (!(presenting || wide) || !hasCaps || settings.presentLayout === "stack") pick = tryStack();
  else if (settings.presentLayout === "side") pick = trySide();
  else {
    // auto: keep the classic stacked look unless the verse had to shrink
    // and going side by side makes it clearly bigger (wide screens)
    pick = tryStack();
    if (pick.s < 1 && availW > availH * 1.2) {
      const side = trySide();
      if (side.s > pick.s * 1.12) pick = side;
    }
  }
  if (!presenting && pick.s < READ_MIN) {
    pick.s = READ_MIN;
    center.classList.add("lum-scroll");
  }
  setLayout(pick.kind, pick.share);
  slide.style.setProperty("--pfit", pick.s.toFixed(3));
}

// Alternatives to the ring behind the verse, picked in settings. All of them
// are rendered once per stage and CSS shows the chosen one; each stays faint
// and keeps clear of the middle, where the text sits.
let starField = "";

function lumBackdrops() {
  if (!starField) {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    const dots = [];
    for (let i = 0; i < 130; i++) {
      const x = rnd() * 100, y = rnd() * 100;
      // thin out the middle so the text has a clear field
      const dx = (x - 50) / 50, dy = (y - 48) / 48;
      if (dx * dx + dy * dy < 0.22 && rnd() < 0.75) continue;
      const size = (0.8 + rnd() * rnd() * 2.2).toFixed(2);
      const twinkle = rnd() < 0.3 ? ` lum-twinkle" style="--tw:${(5 + rnd() * 7).toFixed(1)}s;--twd:-${(rnd() * 10).toFixed(1)}s;` : `" style="`;
      dots.push(`<i class="lum-star${twinkle}left:${x.toFixed(2)}%;top:${y.toFixed(2)}%;width:${size}px;height:${size}px;opacity:${(0.25 + rnd() * 0.5).toFixed(2)}"></i>`);
    }
    starField = dots.join("");
  }
  return `
    <svg class="lum-bd lum-bd-lattice" aria-hidden="true">
      <defs>
        <pattern id="lumLattice" width="84" height="84" patternUnits="userSpaceOnUse">
          <g fill="none" stroke="currentColor" stroke-width="1">
            <polygon points="42.0,12.3 50.7,21.0 63.0,21.0 63.0,33.3 71.7,42.0 63.0,50.7 63.0,63.0 50.7,63.0 42.0,71.7 33.3,63.0 21.0,63.0 21.0,50.7 12.3,42.0 21.0,33.3 21.0,21.0 33.3,21.0"/>
            <polygon points="0.0,-29.7 8.7,-21.0 21.0,-21.0 21.0,-8.7 29.7,0.0 21.0,8.7 21.0,21.0 8.7,21.0 0.0,29.7 -8.7,21.0 -21.0,21.0 -21.0,8.7 -29.7,0.0 -21.0,-8.7 -21.0,-21.0 -8.7,-21.0"/>
            <polygon points="0.0,54.3 8.7,63.0 21.0,63.0 21.0,75.3 29.7,84.0 21.0,92.7 21.0,105.0 8.7,105.0 0.0,113.7 -8.7,105.0 -21.0,105.0 -21.0,92.7 -29.7,84.0 -21.0,75.3 -21.0,63.0 -8.7,63.0"/>
            <polygon points="84.0,-29.7 92.7,-21.0 105.0,-21.0 105.0,-8.7 113.7,0.0 105.0,8.7 105.0,21.0 92.7,21.0 84.0,29.7 75.3,21.0 63.0,21.0 63.0,8.7 54.3,0.0 63.0,-8.7 63.0,-21.0 75.3,-21.0"/>
            <polygon points="84.0,54.3 92.7,63.0 105.0,63.0 105.0,75.3 113.7,84.0 105.0,92.7 105.0,105.0 92.7,105.0 84.0,113.7 75.3,105.0 63.0,105.0 63.0,92.7 54.3,84.0 63.0,75.3 63.0,63.0 75.3,63.0"/>
            <circle cx="42" cy="42" r="5"/>
          </g>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#lumLattice)"/>
    </svg>
    <div class="lum-bd lum-bd-arch" aria-hidden="true"><div class="lum-arch-inner"></div></div>
    <div class="lum-bd lum-bd-stars" aria-hidden="true">${starField}</div>`;
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
  if (f.length >= 2 && !/^\d+$/.test(f)) {
    const more = el("button", "list-search-verses");
    more.innerHTML = `Search verses for “<b>${escapeHtml(chapterFilter.trim())}</b>” ›`;
    more.addEventListener("click", () => {
      if (isMobile()) document.body.classList.remove("nav-open");
      openJump(chapterFilter.trim());
    });
    listEl.appendChild(more);
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
  root.dataset.ensize = String(settings.enSize);
  root.dataset.mode = settings.mode;
  root.dataset.width = settings.width;
  root.dataset.backdrop = settings.backdrop;
  $("#translitToggle").checked = settings.translit;
  $("#englishToggle").checked = settings.english;
  $("#fitToggle").checked = settings.fit;
  setActiveOptions("themeRow", String(settings.theme));
  setActiveOptions("fontRow", settings.font);
  setActiveOptions("sizeRow", String(settings.size));
  $("#enSizeReadout").textContent = Math.round(EN_SCALES[settings.enSize] * 100) + "%";
  setActiveOptions("modeRow", settings.mode);
  setActiveOptions("presentLayoutRow", settings.presentLayout);
  setActiveOptions("widthRow", settings.width);
  setActiveOptions("backdropRow", settings.backdrop);
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

function adjustEnSize(delta) {
  const max = EN_SCALES.length - 1;
  const cur = Math.min(max, Math.max(0, settings.enSize | 0));
  const next = Math.min(max, Math.max(0, cur + delta));
  if (next === cur) return;
  settings.enSize = next;
  saveSettings();
  applySettings();
}

function reRenderVerses() {
  if (!app.surah) return;
  if (settings.mode === "verse" || settings.mode === "luminous") { renderCurrent(); return; }
  const y = window.scrollY;
  renderVerses($("#readerInner"));
  window.scrollTo(0, y);
}

/* ============================== presentation mode ============================== */

let presenting = false;
let wakeLock = null;
let hudTimer = null;

function setPresent(on) {
  if (on === presenting) return;
  presenting = on;
  document.body.classList.toggle("present", on);
  $("#presentHud").hidden = !on;
  $("#presentToggle").checked = on;
  if (on) {
    if (settings.mode === "scroll") {
      settings.mode = "luminous";
      settings.aya = settings.aya ?? 1;
      saveSettings();
      applySettings();
      if (app.surah) renderReader();
    }
    const root = document.documentElement;
    if (root.requestFullscreen) root.requestFullscreen().catch(() => { /* still present, just not fullscreen */ });
    if (navigator.wakeLock) {
      navigator.wakeLock.request("screen").then((wl) => {
        wakeLock = wl;
        wl.addEventListener("release", () => { wakeLock = null; });
      }).catch(() => { /* unsupported over plain http — fine */ });
    }
    if (settings.mode === "luminous" && app.surah) renderLuminous();
    armHudHide();
  } else {
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
    if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
    clearTimeout(hudTimer);
    document.body.classList.remove("hud-hidden");
    if (settings.mode === "verse") fitVerse();
    else if (settings.mode === "luminous" && app.surah) renderLuminous();
  }
}

// HUD + cursor fade out after a few idle seconds; any pointer move brings them back
function armHudHide() {
  clearTimeout(hudTimer);
  document.body.classList.remove("hud-hidden");
  hudTimer = setTimeout(() => { if (presenting) document.body.classList.add("hud-hidden"); }, 4000);
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

/* ============================== go to / search dialog ============================== */

// First verse of each juz (standard 30-part division).
const JUZ_STARTS = [
  [1, 1], [2, 142], [2, 253], [3, 93], [4, 24], [4, 148], [5, 82], [6, 111], [7, 88], [8, 41],
  [9, 93], [11, 6], [12, 53], [15, 1], [17, 1], [18, 75], [21, 1], [23, 1], [25, 21], [27, 56],
  [29, 46], [33, 31], [36, 28], [39, 32], [41, 47], [46, 1], [51, 31], [58, 1], [67, 1], [78, 1],
];

function juzOf(s, a) {
  let j = 1;
  for (let i = 0; i < JUZ_STARTS.length; i++) {
    const [js, ja] = JUZ_STARTS[i];
    if (s > js || (s === js && a >= ja)) j = i + 1;
    else break;
  }
  return j;
}

let jumpTimer = 0;

function openJump(query = "") {
  $("#jumpOverlay").hidden = false;
  const input = $("#jumpInput");
  input.value = query;
  fillPicker();
  // on touch screens don't pop the keyboard; the pickers are the quick way in
  if (query || !window.matchMedia("(pointer: coarse)").matches) input.focus();
  renderJumpResults();
}

// Surah + verse pickers: native selects, so phones show their own wheel/list.
// They open on the verse you're reading.
function fillPicker() {
  const sel = $("#pickSurah");
  if (!sel.options.length && app.chapters.length) {
    for (let s = 1; s <= TOTAL; s++) {
      const ch = app.chapters[s];
      if (ch) sel.add(new Option(`${s}. ${ch.transliteration} · ${ch.name_english}`, String(s)));
    }
  }
  const cur = currentVerse() || { s: settings.sura, a: 1 };
  sel.value = String(cur.s);
  fillVerses(cur.s, cur.a);
}

function fillVerses(s, a = 1) {
  const sel = $("#pickVerse");
  const n = app.chapters[s]?.verse_count || 1;
  if (sel.options.length !== n) {
    sel.innerHTML = "";
    for (let i = 1; i <= n; i++) sel.add(new Option(String(i), String(i)));
  }
  sel.value = String(Math.min(Math.max(a, 1), n));
}

function submitPicker() {
  const s = +$("#pickSurah").value;
  const a = +$("#pickVerse").value || 1;
  if (!app.chapters[s]) return;
  closeJump();
  goToVerse(s, a);
}

function closeJump() {
  $("#jumpOverlay").hidden = true;
}

// What the dialog's text means: a reference, a juz, or words to search.
function parseJumpQuery(raw) {
  const q = raw.trim();
  if (!q) return { kind: "empty" };
  let m = q.match(/^(\d{1,3})\s*[:\-.\/ ]?\s*(\d{1,3})?$/);
  if (m) {
    const s = +m[1];
    const a = m[2] ? +m[2] : null;
    const ch = app.chapters[s];
    if (!ch || (a && (a < 1 || a > ch.verse_count))) return { kind: "bad" };
    return { kind: "ref", s, a };
  }
  m = q.match(/^(?:juz|jz|j|para|part)\s*'?\s*(\d{1,2})$/i);
  if (m) {
    const j = +m[1];
    if (j < 1 || j > 30) return { kind: "bad" };
    return { kind: "juz", j, s: JUZ_STARTS[j - 1][0], a: JUZ_STARTS[j - 1][1] };
  }
  return q.length >= 2 ? { kind: "search", q } : { kind: "short" };
}

function submitJump() {
  const p = parseJumpQuery($("#jumpInput").value);
  if (p.kind === "ref" || p.kind === "juz") {
    closeJump();
    goToVerse(p.s, p.a);
  } else if (p.kind === "search") {
    const first = $("#jumpResults .jr-item");
    if (first) first.click();
  } else {
    jumpShake();
  }
}

function goToVerse(s, a) {
  if (s !== settings.sura || !app.surah) { openSurah(s, a); return; }
  if (a && (settings.mode === "verse" || settings.mode === "luminous")) {
    settings.aya = a;
    saveSettings();
    renderCurrent();
    return;
  }
  if (!a) { window.scrollTo({ top: 0, behavior: "smooth" }); return; }
  const target = document.getElementById(`v-${s}-${a}`);
  if (target) {
    target.scrollIntoView({ block: "center" });
    target.classList.add("flash");
    setTimeout(() => target.classList.remove("flash"), 1900);
  }
}

function jumpShake() {
  const card = $(".jump-card");
  card.classList.remove("shake");
  void card.offsetWidth; // restart animation
  card.classList.add("shake");
}

function jumpItem(s, a, label, snippetHtml) {
  const btn = el("button", "jr-item");
  const ch = app.chapters[s];
  btn.innerHTML = `
    <span class="jr-ref">${s}:${a}</span>
    <span class="jr-body">
      <span class="jr-name">${escapeHtml(label ?? (ch ? ch.transliteration : ""))}</span>
      ${snippetHtml ? `<span class="jr-snip">${snippetHtml}</span>` : ""}
    </span>`;
  btn.addEventListener("click", () => { closeJump(); goToVerse(s, a); });
  return btn;
}

function jumpSection(title) {
  const sec = el("div", "jr-section");
  const h = el("div", "jr-label");
  h.textContent = title;
  sec.appendChild(h);
  return sec;
}

function renderJumpResults() {
  clearTimeout(jumpTimer);
  const box = $("#jumpResults");
  const p = parseJumpQuery($("#jumpInput").value);
  box.innerHTML = "";

  if (p.kind === "ref") {
    const ch = app.chapters[p.s];
    box.appendChild(jumpItem(p.s, p.a ?? 1, `${ch.transliteration}${p.a ? "" : " · start of surah"}`, "Press Enter to open"));
    return;
  }
  if (p.kind === "juz") {
    box.appendChild(jumpItem(p.s, p.a, `Juz ${p.j}`, `Starts at ${app.chapters[p.s].transliteration} ${p.s}:${p.a}`));
    return;
  }
  if (p.kind === "bad") {
    const msg = el("div", "jr-empty");
    msg.textContent = "No such surah, verse or juz.";
    box.appendChild(msg);
    return;
  }
  if (p.kind === "search") {
    const msg = el("div", "jr-empty");
    msg.textContent = "Searching…";
    box.appendChild(msg);
    jumpTimer = setTimeout(() => runSearch(p.q), 180);
    return;
  }

  // empty: saved verses, then the juz grid
  const saved = jumpSection("Saved verses");
  const marks = loadBookmarks();
  if (!marks.length) {
    const msg = el("div", "jr-empty");
    msg.textContent = "Nothing saved yet. Tap the bookmark at the top (or press B) to save the verse you're on.";
    saved.appendChild(msg);
  }
  for (const b of marks) {
    const row = jumpItem(b.s, b.a, null, b.en ? escapeHtml(trimText(b.en, 110)) : "");
    const rm = el("span", "jr-remove");
    rm.setAttribute("role", "button");
    rm.setAttribute("aria-label", `Remove ${b.s}:${b.a} from saved`);
    rm.title = "Remove";
    rm.textContent = "×";
    rm.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleBookmark(b.s, b.a, false);
      renderJumpResults();
    });
    row.appendChild(rm);
    saved.appendChild(row);
  }
  box.appendChild(saved);

  const juz = jumpSection("Juz");
  const grid = el("div", "jr-juz");
  const cur = app.surah ? juzOf(settings.sura, settings.aya ?? 1) : 0;
  JUZ_STARTS.forEach(([s, a], i) => {
    const b = el("button", "jr-juz-btn" + (i + 1 === cur ? " active" : ""));
    b.textContent = String(i + 1);
    b.title = `Juz ${i + 1} · ${app.chapters[s]?.transliteration ?? ""} ${s}:${a}`;
    b.addEventListener("click", () => { closeJump(); goToVerse(s, a); });
    grid.appendChild(b);
  });
  juz.appendChild(grid);
  box.appendChild(juz);
}

/* ---------- verse search ---------- */

let allSurahs = null; // promise of [surah docs]

function loadAllSurahs() {
  if (!allSurahs) {
    allSurahs = (async () => {
      const out = new Array(TOTAL);
      let next = 1;
      const worker = async () => {
        while (next <= TOTAL) {
          const n = next++;
          const res = await fetch(`data/surahs/${pad3(n)}.json`);
          if (!res.ok) throw new Error(res.status);
          out[n - 1] = await res.json();
        }
      };
      await Promise.all(Array.from({ length: 8 }, worker));
      return out;
    })().catch((err) => { allSurahs = null; throw err; });
  }
  return allSurahs;
}

const fold = (t) => t.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const foldArabic = (t) => t
  .replace(/[ؐ-ًؚ-ٰٟۖ-ۭـ]/g, "")
  .replace(/[ٱأإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه");
const HAS_ARABIC = /[؀-ۿ]/;

async function runSearch(q) {
  const box = $("#jumpResults");
  let docs;
  try {
    docs = await loadAllSurahs();
  } catch {
    box.innerHTML = `<div class="jr-empty">Couldn't load the verses to search. Check your connection.</div>`;
    return;
  }
  if ($("#jumpInput").value.trim() !== q) return; // typed on meanwhile

  const arabic = HAS_ARABIC.test(q);
  const words = (arabic ? foldArabic(q) : fold(q)).split(/\s+/).filter(Boolean);
  const hits = [];
  for (const doc of docs) {
    for (const v of doc.verses) {
      if (arabic) {
        const hay = foldArabic(v.arabic);
        if (words.every((w) => hay.includes(w))) hits.push({ v, field: "en" });
      } else {
        const en = fold(v.english);
        if (words.every((w) => en.includes(w))) { hits.push({ v, field: "en" }); continue; }
        const tr = fold(v.transliteration_text || "");
        if (words.every((w) => tr.includes(w))) hits.push({ v, field: "tr" });
      }
    }
  }

  box.innerHTML = "";
  const sec = jumpSection(hits.length ? `${hits.length} verse${hits.length === 1 ? "" : "s"}${hits.length > 100 ? " · showing first 100" : ""}` : "No verses found");
  for (const { v, field } of hits.slice(0, 100)) {
    const text = field === "tr" ? (v.transliteration_text || "") : v.english;
    sec.appendChild(jumpItem(v.sura, v.aya, null, highlight(text, arabic ? [] : words)));
  }
  box.appendChild(sec);
}

// Show the part of the verse around the first match with matches marked.
function highlight(text, words) {
  const folded = fold(text);
  // fold() can change length for some characters; fall back to plain text then
  if (folded.length !== text.length || !words.length) return escapeHtml(trimText(text, 160));
  const first = Math.min(...words.map((w) => { const i = folded.indexOf(w); return i < 0 ? Infinity : i; }));
  let from = 0, to = text.length;
  if (text.length > 170 && Number.isFinite(first)) {
    from = Math.max(0, first - 60);
    to = Math.min(text.length, from + 170);
    if (from > 0) from = text.lastIndexOf(" ", from) + 1 || from;
  }
  const marks = [];
  for (const w of words) {
    let i = folded.indexOf(w, from);
    while (i >= 0 && i < to) { marks.push([i, i + w.length]); i = folded.indexOf(w, i + w.length); }
  }
  marks.sort((x, y) => x[0] - y[0]);
  let out = from > 0 ? "…" : "", pos = from;
  for (const [a, b] of marks) {
    if (a < pos) continue;
    out += escapeHtml(text.slice(pos, a)) + "<mark>" + escapeHtml(text.slice(a, Math.min(b, to))) + "</mark>";
    pos = Math.min(b, to);
  }
  out += escapeHtml(text.slice(pos, to)) + (to < text.length ? "…" : "");
  return out;
}

function trimText(t, n) {
  return t.length > n ? t.slice(0, t.lastIndexOf(" ", n) > n * 0.6 ? t.lastIndexOf(" ", n) : n) + "…" : t;
}

/* ============================== bookmarks ============================== */

const BOOKMARKS_KEY = "quran-reader.bookmarks.v1";

function loadBookmarks() {
  try {
    const list = JSON.parse(localStorage.getItem(BOOKMARKS_KEY) || "[]");
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}

function isBookmarked(s, a) {
  return loadBookmarks().some((b) => b.s === s && b.a === a);
}

function toggleBookmark(s, a, force) {
  let list = loadBookmarks();
  const has = list.some((b) => b.s === s && b.a === a);
  const want = force ?? !has;
  if (want === has) return;
  if (want) {
    const v = app.surah?.chapter.sura === s ? app.surah.verses.find((x) => x.aya === a) : null;
    list.unshift({ s, a, en: v ? v.english : "", t: Date.now() });
  } else {
    list = list.filter((b) => !(b.s === s && b.a === a));
  }
  try { localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(list)); } catch { /* private mode */ }
  document.getElementById(`v-${s}-${a}`)?.classList.toggle("saved", want);
  updateBookmarkBtn();
  showToast(want ? `Saved ${s}:${a}` : `Removed ${s}:${a} from saved`);
}

// The verse the bookmark button acts on: the one on screen in the verse
// modes; in scroll mode, the first verse whose text is still in view.
function currentVerse() {
  if (!app.surah) return null;
  const s = app.surah.chapter.sura;
  if (settings.mode !== "scroll") return { s, a: settings.aya ?? 1 };
  const top = (parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--topbar-h")) || 60) + 8;
  for (const v of document.querySelectorAll(".verse")) {
    if (v.getBoundingClientRect().bottom > top + 24) return { s, a: +v.id.split("-")[2] };
  }
  return { s, a: 1 };
}

function updateBookmarkBtn() {
  const btn = $("#bookmarkBtn");
  const cur = currentVerse();
  const on = !!cur && isBookmarked(cur.s, cur.a);
  btn.classList.toggle("active", on);
  btn.setAttribute("aria-pressed", String(on));
  const label = cur ? `${on ? "Remove" : "Save"} ${cur.s}:${cur.a}` : "Save this verse";
  btn.setAttribute("aria-label", label);
  btn.title = `${label} (B)`;
}

let toastTimer = 0;
function showToast(text) {
  const t = $("#toast");
  t.textContent = text;
  t.hidden = false;
  t.classList.remove("show");
  void t.offsetWidth;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 1900);
}

/* ============================== landing page ============================== */

let landingOpen = false;
let installPrompt = null;

// Short, well-known verses for "Verse of the day" (one per calendar day).
const DAILY_VERSES = [
  "2:152", "2:153", "2:186", "3:8", "3:139", "3:173", "6:162", "7:56", "9:51", "13:28",
  "14:7", "16:97", "17:80", "18:10", "20:25", "20:114", "21:87", "23:118", "25:63", "28:24",
  "29:69", "33:41", "39:53", "40:60", "42:19", "49:13", "51:56", "55:13", "57:4", "59:22",
  "64:11", "65:3", "67:2", "93:5", "94:5", "94:6", "103:1", "112:1",
];

function showLanding() {
  landingOpen = true;
  document.body.classList.add("landing-open");
  document.body.classList.remove("nav-open");
  $("#landing").hidden = false;
  $("#landing").scrollTop = 0;
  if (location.hash) history.replaceState(null, "", location.pathname + location.search);
  updateLanding();
  renderVerseOfDay();
}

function hideLanding() {
  if (!landingOpen) return;
  landingOpen = false;
  document.body.classList.remove("landing-open");
  $("#landing").hidden = true;
  if (app.surah) setHash(settings.sura, settings.mode === "scroll" ? null : settings.aya);
}

function updateLanding() {
  const ch = app.chapters[settings.sura];
  const main = $("#ldContinue .ld-btn-main");
  const sub = $("#ldContinueSub");
  if (returning && ch) {
    const a = settings.aya ?? 1;
    main.textContent = "Continue reading";
    sub.textContent = `${ch.transliteration} · ${ch.sura}:${a}`;
  } else {
    main.textContent = "Begin reading";
    sub.textContent = "Al-Fatihah · 1:1";
  }
  $("#ldInstall").hidden = !installPrompt;
}

async function renderVerseOfDay() {
  const box = $("#ldVotd");
  const day = Math.floor((Date.now() - new Date().getTimezoneOffset() * 60000) / 86400000);
  const [s, a] = DAILY_VERSES[day % DAILY_VERSES.length].split(":").map(Number);
  if (box.dataset.ref === `${s}:${a}`) return;
  try {
    const doc = await (await fetch(`data/surahs/${pad3(s)}.json`)).json();
    const v = doc.verses.find((x) => x.aya === a);
    if (!v) return;
    const ar = $("#ldVotdAr");
    ar.textContent = v.arabic + "\u00A0";
    const end = el("span", "ayah-end");
    end.textContent = ayahMark(a);
    ar.appendChild(end);
    $("#ldVotdEn").textContent = v.english;
    $("#ldVotdRef").textContent = `${doc.chapter.transliteration} ${s}:${a} · Read in context ›`;
    $("#ldVotdRef").onclick = () => enterReader(s, a);
    box.dataset.ref = `${s}:${a}`;
    box.hidden = false;
  } catch { /* offline before first visit: just leave it out */ }
}

function enterReader(s, a) {
  hideLanding();
  if (s) goToVerse(s, a);
}

/* ============================== events ============================== */

function bindEvents() {
  $("#menuBtn").addEventListener("click", () => toggleSidebar());
  $("#backdrop").addEventListener("click", () => document.body.classList.remove("nav-open"));

  $("#chapterSearch").addEventListener("input", (e) => {
    chapterFilter = e.target.value;
    renderChapterList();
  });

  $("#jumpBtn").addEventListener("click", () => openJump());
  $("#jumpClose").addEventListener("click", closeJump);
  $("#jumpInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") submitJump();
    if (e.key === "Escape") closeJump();
  });
  $("#jumpInput").addEventListener("input", renderJumpResults);
  $("#pickSurah").addEventListener("change", (e) => fillVerses(+e.target.value, 1));
  $("#pickGo").addEventListener("click", submitPicker);
  for (const id of ["#pickSurah", "#pickVerse"]) {
    $(id).addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); submitPicker(); } });
  }
  $("#topbarTitle").addEventListener("click", () => openJump());

  // landing page
  $("#brandHome").addEventListener("click", showLanding);
  $("#ldContinue").addEventListener("click", () => {
    if (returning) enterReader();
    else enterReader(1, 1);
  });
  $("#ldChoose").addEventListener("click", () => { hideLanding(); openJump(); });
  $(".ld-quick").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-go]");
    if (!b) return;
    const [s, a] = b.dataset.go.split(":").map(Number);
    enterReader(s, a);
  });
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    installPrompt = e;
    $("#ldInstall").hidden = false;
  });
  $("#ldInstall").addEventListener("click", async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice.catch(() => {});
    installPrompt = null;
    $("#ldInstall").hidden = true;
  });
  $("#bookmarkBtn").addEventListener("click", () => {
    const cur = currentVerse();
    if (cur) toggleBookmark(cur.s, cur.a);
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
    if (!panel.hidden && !panel.contains(e.target) && !$("#settingsBtn").contains(e.target) && !e.target.closest("#presentHud")) {
      panel.hidden = true;
      e.closedPanel = true; // a tap that only dismisses the panel shouldn't also step the verse
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
  $("#enSizeDown").addEventListener("click", () => adjustEnSize(-1));
  $("#enSizeUp").addEventListener("click", () => adjustEnSize(1));
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
  $("#presentToggle").addEventListener("change", (e) => setPresent(e.target.checked));
  $("#presentLayoutRow").addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    settings.presentLayout = btn.dataset.opt;
    saveSettings();
    applySettings();
  });
  $("#backdropRow").addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    settings.backdrop = btn.dataset.opt;
    saveSettings();
    applySettings();
  });
  $("#widthRow").addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    settings.width = btn.dataset.opt;
    saveSettings();
    applySettings();
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
  let bmFrame = 0;
  document.addEventListener("scroll", () => {
    if (document.documentElement.dataset.mode === "verse" || document.documentElement.dataset.mode === "luminous") return;
    const h = document.documentElement;
    const max = h.scrollHeight - h.clientHeight;
    $("#progressBar").style.width = (max > 0 ? (h.scrollTop / max) * 100 : 0) + "%";
    if (!bmFrame) bmFrame = requestAnimationFrame(() => { bmFrame = 0; updateBookmarkBtn(); });
  }, { passive: true });

  // keyboard
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (!$("#jumpOverlay").hidden) return closeJump();
      if (!$("#settingsPanel").hidden) return ($("#settingsPanel").hidden = true);
      if (document.body.classList.contains("nav-open")) return document.body.classList.remove("nav-open");
      return;
    }
    const target = e.target instanceof Element ? e.target : null;
    if (target && target.matches("input, textarea, select")) return;
    if (!$("#jumpOverlay").hidden) return;
    if (landingOpen) {
      if (e.key === "Enter" && !(target && target.matches("button"))) $("#ldContinue").click();
      else if (e.key === "g" || e.key === "G" || e.key === "/") { e.preventDefault(); $("#ldChoose").click(); }
      return;
    }
    if (e.key === "p" || e.key === "P") { setPresent(!presenting); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) { /* leave browser shortcuts alone */ }
    else if (e.key === "b" || e.key === "B") {
      const cur = currentVerse();
      if (cur) toggleBookmark(cur.s, cur.a);
      return;
    } else if (e.key === "g" || e.key === "G") {
      e.preventDefault();
      openJump();
      return;
    }
    // a focused button already acts on Space/Enter natively — don't double-step
    if (target && target.matches("button") && (e.key === " " || e.key === "Enter")) return;
    const inVerse = document.documentElement.dataset.mode === "verse" || document.documentElement.dataset.mode === "luminous";
    if (inVerse && (e.key === " " || e.key === "Enter")) {
      e.preventDefault();
      const dir = e.shiftKey ? -1 : 1;
      verseStep(dir);
      flashLumNav(dir);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
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

  // presentation: HUD controls, click-to-step, idle fade, fullscreen/focus hooks
  $("#presentGear").addEventListener("click", (e) => {
    e.stopPropagation();
    panel.hidden = !panel.hidden;
  });
  $("#presentExit").addEventListener("click", () => setPresent(false));
  document.addEventListener("click", (e) => {
    if (!presenting || e.closedPanel) return;
    if (e.target.closest("#presentHud, #settingsPanel, #jumpOverlay, button, a, input, select, .vb-foot")) return;
    // Once faded, the HUD stops taking taps, so a tap aimed at its buttons
    // lands on the stage. Treat that as "show the controls", not "next verse".
    const hud = $("#presentHud").getBoundingClientRect();
    if (e.clientX >= hud.left - 10 && e.clientX <= hud.right + 10 &&
        e.clientY >= hud.top - 20 && e.clientY <= hud.bottom + 10) return;
    const dir = e.clientX < window.innerWidth * 0.28 ? -1 : 1;
    verseStep(dir);
    flashLumNav(dir);
  });
  window.addEventListener("pointermove", () => { if (presenting) armHudHide(); }, { passive: true });
  window.addEventListener("pointerdown", () => { if (presenting) armHudHide(); }, { passive: true });
  document.addEventListener("fullscreenchange", () => {
    if (!document.fullscreenElement && presenting) setPresent(false);
  });
  document.addEventListener("visibilitychange", () => {
    if (presenting && document.visibilityState === "visible" && !wakeLock && navigator.wakeLock) {
      navigator.wakeLock.request("screen").then((wl) => {
        wakeLock = wl;
        wl.addEventListener("release", () => { wakeLock = null; });
      }).catch(() => {});
    }
  });

  // external hash edits (typing a deep link, another tab) navigate the reader
  window.addEventListener("hashchange", () => {
    const h = parseHash();
    if (h && landingOpen) hideLanding();
    if (!h || app.loading) return;
    if (h.s === settings.sura) {
      if (settings.mode !== "scroll" && (h.a ?? settings.aya) !== settings.aya) {
        settings.aya = h.a ?? settings.aya ?? 1;
        saveSettings();
        renderCurrent();
      }
      return;
    }
    openSurah(h.s, h.a);
  });

}

/* ============================== helpers ============================== */

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

document.addEventListener("DOMContentLoaded", init);
