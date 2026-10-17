#!/usr/bin/env python3
"""Build data/tafsir/ from the Tafsir Ahl al-Bayt reader's surah files.

Each verse's narrations (Arabic original, Persian and English translations,
the book reference and the source list) become one small entry; speakers
written many ways ("Al-Sadiq", "Imam al-Sadiq (AS)", "Abu Abdillah"…) are
brought to one name; the Noor-style Arabic encoding of ة is repaired.

    python3 tools/build-tafsir.py path/to/tafsir-ahlul-bayt-reader/data/surahs

The source is github.com/lotetreel/tafsir-ahlul-bayt-reader (data/surahs).
Output: data/tafsir/NNN-K.json — each surah in chunks of consecutive
verses, small enough to open quickly on a phone — and data/tafsir/index.json
(narrations per verse, and where each surah's chunks start).
"""

import hashlib
import json
import re
import sys
import unicodedata
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "data" / "tafsir"
CHUNK_BYTES = 350_000

# (key, label, kind, patterns) — first match wins, so the more specific
# names come before the ones they contain. kind: m = the Prophet and his
# Household, c = commentator, s = companion or other narrator.
SPEAKERS = [
    ("qummi", "Ali ibn Ibrahim al-Qummi", "c", [r"ali ibn ibrahim", r"qummi"]),
    ("ibnabbas", "Ibn Abbas", "s", [r"ibn .?abbas"]),
    ("sadiqayn", "Imams al-Baqir and al-Sadiq (AS)", "m", [r"truthful ones", r"two truthful", r"sadiqayn", r"sadiqain"]),
    ("sajjad", "Imam al-Sajjad (AS)", "m", [r"sajjad", r"zayn al", r"ali ibn al-husayn"]),
    ("prophet", "The Prophet (SAWA)", "m", [r"messenger", r"prophet"]),
    ("ali", "Imam Ali (AS)", "m", [r"amir al", r"commander of the faithful", r"imam ali\b", r"ali ibn abi talib", r"^ali \("]),
    ("fatima", "Lady Fatimah (AS)", "m", [r"fatima", r"zahra"]),
    ("husayn", "Imam al-Husayn (AS)", "m", [r"husayn", r"husain", r"sayyid al-shuhada"]),
    ("hasan", "Imam al-Hasan (AS)", "m", [r"al-hasan\b", r"imam hasan", r"^hasan"]),
    ("baqir", "Imam al-Baqir (AS)", "m", [r"baqir", r"abu ja.?far"]),
    ("sadiq", "Imam al-Sadiq (AS)", "m", [r"sadiq", r"abu .?abd ?(?:al)?lah", r"abu abdillah", r"ja.?far ibn muhammad"]),
    ("kazim", "Imam al-Kazim (AS)", "m", [r"kazim", r"kāẓim", r"musa ibn ja"]),
    ("rida", "Imam al-Rida (AS)", "m", [r"rida", r"riḍā", r"reza", r"ridha"]),
    ("jawad", "Imam al-Jawad (AS)", "m", [r"jawad", r"\btaqi\b"]),
    ("hadi", "Imam al-Hadi (AS)", "m", [r"\bhadi\b", r"\bnaqi\b"]),
    ("askari", "Imam al-Askari (AS)", "m", [r"askari", r"ʿaskarī"]),
    ("mahdi", "Imam al-Mahdi (AS)", "m", [r"mahdi", r"qa.?im\b", r"imam of the time"]),
    ("imams", "The Imams (AS)", "m", [r"\bimams\b", r"one of them \(peace"]),
]

LABELS = re.compile(r"^(Attribution|Scope|English translation|Book|References):[ \t]*", re.M)


def parse_english(t):
    """Split 'Attribution: … Scope: … English translation: … Book: … References: …'."""
    parts, last = {}, None
    pieces = LABELS.split(t)
    # pieces: [before, label, text, label, text, …]
    for i in range(1, len(pieces) - 1, 2):
        label, body = pieces[i], pieces[i + 1].strip()
        if label in parts and label == "English translation":
            parts[label] += "\n\n" + body  # one entry carries two translations
        elif label not in parts:
            parts[label] = body
    return parts


def honorifics(t):
    t = re.sub(r"\(peace (?:and blessings )?be upon him and his (?:family|progeny)\)|\(pbuh(?:&hf)?\)", "(SAWA)", t, flags=re.I)
    t = re.sub(r"\(peace be upon (?:him|her|them)\)", "(AS)", t, flags=re.I)
    return re.sub(r"\s*\(may allah have mercy (?:on|upon) (?:him|them)\)", "", t, flags=re.I)


def speaker(attribution):
    a = (attribution or "").strip().rstrip(".")
    low = "".join(c for c in unicodedata.normalize("NFKD", a.lower()) if not unicodedata.combining(c))
    for key, label, kind, pats in SPEAKERS:
        if any(re.search(p, low) for p in pats):
            # keep the chain when it says more than the name ("X from Abu Ja'far")
            short = honorifics(a)
            detail = short if re.search(r"\bfrom\b|narrated|\s-\s|,|\band\b", short) else ""
            return key, label, kind, detail
    a = honorifics(a).strip()
    return "other", a or "Narration", "s", ""


def clean_arabic(t):
    t = t or ""
    # Noor's encoding of tā' marbūṭa: ه + sukūn + tanwīn (+ the real vowel)
    t = re.sub(r"ه[َِ]?(?:ًْ|ًْ)([ً-ِ]?)", "ة\\1", t)
    t = re.sub(r"هً(?=[\s.،؛:!؟)»\]]|$)", "ة", t)
    t = re.sub(r"[‌‎‏]", " ", t)
    t = re.sub(r"[ \t]{2,}", " ", t)
    return t.strip()


def clean_attr_ar(t):
    return clean_arabic(t).rstrip("-").strip()


def clean_persian(t):
    t = re.sub(r"[‎‏]", "", t or "")
    return re.sub(r"[ \t]{2,}", " ", t).strip()


def clean_english(t):
    t = re.sub(r"[ \t]+\n", "\n", t or "").strip()
    return re.sub(r"\n{3,}", "\n\n", t)


def build_entry(e):
    parts = parse_english(e.get("english_translation") or "")
    key, label, kind, detail = speaker(parts.get("Attribution"))
    entry = {"k": key, "by": label, "kind": kind}
    if detail:
        entry["via"] = detail
    ar_by = clean_attr_ar(e.get("arabic_attribution"))
    if ar_by:
        entry["ar_by"] = ar_by
    entry["ar"] = clean_arabic(e.get("arabic"))
    entry["fa"] = clean_persian(e.get("persian"))
    entry["en"] = clean_english(parts.get("English translation", ""))
    if parts.get("Book"):
        entry["book"] = parts["Book"].strip()
    if parts.get("References"):
        entry["refs"] = parts["References"].strip()
    return entry


def main():
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    src = Path(sys.argv[1])
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob("*.json"):
        old.unlink()
    index = {"counts": {}, "intro": {}, "chunks": {}}
    total = 0
    for f in sorted(src.glob("[0-9][0-9][0-9].json")):
        doc = json.loads(f.read_text(encoding="utf-8"))
        sura = doc["chapter"]["sura"]
        intro, verses, counts = [], {}, []
        for v in doc["verses"]:
            seen, here = set(), []
            for e in (v.get("commentary") or {}).get("entries") or []:
                h = hashlib.md5((e.get("arabic") or e.get("english_translation") or "").encode()).hexdigest()
                if h in seen:
                    continue
                seen.add(h)
                entry = build_entry(e)
                if not entry["en"] and not entry["ar"]:
                    continue
                (intro if "مقدمه" in (e.get("scope") or "") else here).append(entry)
            if here:
                verses[v["aya"]] = here
            counts.append(len(here))
            total += len(here)
        total += len(intro)

        # consecutive verses into chunks; the surah's introduction rides with verse 1
        chunks, cur, size = [], {"intro": intro, "verses": {}}, len(json.dumps(intro, ensure_ascii=False).encode())
        starts = [1]
        for aya in range(1, len(counts) + 1):
            es = verses.get(aya)
            if not es:
                continue
            n = len(json.dumps(es, ensure_ascii=False).encode())
            if cur["verses"] and size + n > CHUNK_BYTES:
                chunks.append(cur)
                cur, size = {"verses": {}}, 0
                starts.append(aya)
            cur["verses"][str(aya)] = es
            size += n
        chunks.append(cur)
        for i, ch in enumerate(chunks):
            ch = {"sura": sura, **ch}
            (OUT / f"{sura:03d}-{i + 1}.json").write_text(json.dumps(ch, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        index["counts"][str(sura)] = counts
        index["chunks"][str(sura)] = starts
        if intro:
            index["intro"][str(sura)] = len(intro)
    (OUT / "index.json").write_text(json.dumps(index, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {OUT} · {total} narrations")


if __name__ == "__main__":
    main()
