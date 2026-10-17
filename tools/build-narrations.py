#!/usr/bin/env python3
"""Build data/narrations/quran.json from Mizan al-Hikmah.

Takes chapter 327 ("The Qur'an") of Mizan al-Hikmah vol. 4, cleans up the
scan artefacts (repeated hadith numbers, stray footnote markers, broken
spacing in the Arabic), splits out who is speaking, and adds the curated
links between narrations and the verses they quote or explain.

    python3 tools/build-narrations.py path/to/mizan_al_hikmah_vol4.json

The source JSON lives in github.com/lotetreel/mizan-al-hikmah (public/data).
"""

import json
import re
import sys
from pathlib import Path

CHAPTER = 327
OUT = Path(__file__).resolve().parent.parent / "data" / "narrations" / "quran.json"

SECTION_TITLES = {
    1509: "Adhere to the Qur'an",
    1510: "The Qur'an is new in every era",
    1511: "Learning and teaching the Qur'an",
    1512: "Memorising the Qur'an, and the manners of those who carry it",
    1513: "The call to recite the Qur'an",
    1514: "Reciting the Qur'an with a beautiful voice",
    1515: "Reciting it as it deserves",
    1516: "The etiquette of recitation",
    1517: "Those whom the Qur'an curses",
    1518: "Listening to the Qur'an",
    1519: "Caution against interpreting it by opinion",
}

# English that the scan garbled beyond what the generic clean-up handles.
EN_FIXES = {
    5177: "Imam al-Sadiq (AS) said, 'Whoever forgets a chapter (surah) from the Quran, it will exemplify to him as a form of a reward and a high station. When he sees it, he will ask, ‘Who are you? How great you are! If only you were mine!’ and it will say to him, ‘Don't you know me? I am chapter so and so, and if you did not forget me I would have elevated you to this place.’'",
    5179: "The Prophet (SAWA) said, 'It will be said to the reciter of the Quran, ‘Read and rise in rank, and recite as you recited in the world, for your station is as per the last verse that you recited.’'",
    5187: "Imam al-Sadiq (AS), with respect to Allah's verse “Those to whom We have given the Book follow it as it ought to be followed,” said, 'They recite its verses and understand its meanings and act according to its laws. They hope for its reward, fear its punishment, take examples from its stories, take lesson from its parables, perform its orders, stay away from what it has prohibited. By Allah, it is not just memorizing its verses, citing its words, reciting its chapters, and learning its parts. They have memorized its words and lost its limits. That which is important is contemplating into its verses; Allah Almighty says, “[It is] a blessed Book that We have sent down to you, so that they may contemplate its signs.”'",
    5190: "The Prophet (SAWA), with regard to Allah's verse “and recite the Quran in a measured tone,” said, 'Recite it clearly, do not disperse it prosaically, nor rave it like raving poetry. Stop where it mentions wonders, and move the hearts with it, and do not let your only concern be [to finish] the end of the chapter.'",
    5194: "Imam al-Rida (AS) constantly recited the Quran in his bed at night during the path to Khurasan. When he would read a verse that mentioned Heaven or Hell, he would cry and ask Allah for Heaven or seek refuge from Hell.",
    5201: "The Prophet (SAWA) said, 'Allah the Exalted has said, ‘Those who interpret My words with their own opinion do not believe in Me.’'",
}
AR_FIXES = {
    ("أ نّهُ", "أنّهُ"),
    ("بِئسَما لأِحدِكُم", "بِئسَما لِأحدِكُم"),
}
NOTES = {
    5194: "Narrated by Raja' ibn Abi al-Dahhak, who travelled with him, in ʿUyun Akhbar al-Rida.",
}

# Verses each narration quotes ("on") or plainly speaks to ("echo").
VERSE_LINKS = {
    5151: [("41:42", "on")],
    5159: [("39:23", "echo"), ("10:57", "echo"), ("12:3", "echo")],
    5160: [("17:82", "echo")],
    5187: [("2:121", "on"), ("38:29", "on")],
    5189: [("16:98", "on")],
    5190: [("73:4", "on")],
    5191: [("47:24", "echo"), ("4:82", "echo")],
    5200: [("7:204", "on")],
}

# Shown at the end of a surah: on recitation, its reward and its manner.
END_OF_SURAH = [5178, 5179, 5180, 5181, 5182, 5199, 5198, 5162, 5163, 5191,
                5165, 5164, 5161, 5159, 5172, 5196, 5186, 5183, 5190, 5153]
# Narration of the day: short, and right for any reader on any day.
DAILY = [5152, 5153, 5154, 5156, 5158, 5159, 5161, 5162, 5163, 5164, 5165,
         5168, 5170, 5172, 5173, 5176, 5178, 5179, 5180, 5181, 5182, 5183,
         5184, 5186, 5191, 5196, 5198, 5199, 5150, 5160, 5167, 5174, 5175,
         5185, 5190]

SPEAKERS = [
    "The Prophet (SAWA)",
    "Imam Ali (AS)",
    "Imam Zayn al-Abidin (AS)",
    "Imam al-Sadiq (AS)",
    "Imam al-Rida (AS)",
]
AR_SPEAKER = re.compile(r"^(رسول\S*\s+\S+\s+صلى\s+\S+\s+عليه\s+وآله|الإمام\S*\s+(?:\S+\s+){1,2}?عليه\s+السلام)\s*")


def smart_quotes(t):
    # an apostrophe before a letter, not after one, opens a quote; any other closes it
    t = re.sub(r"(?<![\w’])'(?=\w)", "‘", t)
    return t.replace("'", "’")


def clean_en(n, raw):
    t = EN_FIXES.get(n) or raw
    t = re.sub(r"^(\d{4}\.\s*)+", "", t.strip())       # "5154. 5163. The Prophet…"
    t = re.sub(r"\s+\d{3,4}$", "", t)                   # trailing footnote marker
    t = re.sub(r"\s+([.,;:!?])", r"\1", t)
    t = t.replace("'.", ".'") if t.endswith("'.") else t
    by = next((s for s in SPEAKERS if t.startswith(s)), None)
    if not by:
        raise SystemExit(f"{n}: no speaker in {t[:60]!r}")
    m = re.fullmatch(re.escape(by) + r" said, '(.*)'", t, re.S)
    # a back-and-forth ("…' He was asked, '…") is not one quotation
    if m and not re.search(r"(?<!\w)'|'(?!\w)", m.group(1)):
        quote = m.group(1).strip()
        if quote[-1] not in ".!?’”":
            quote += "."
        return by, smart_quotes(quote), True
    return by, smart_quotes(t), False


def clean_ar(n, raw):
    t = re.sub(r"^\d{4}\.\s*", "", raw.strip())
    for a, b in AR_FIXES:
        t = t.replace(a, b)
    t = re.sub(r"(ع\u064e?ز[\u064b-\u0652]*)(و\u064e?ج)", r"\1 \2", t)  # عزّوجلّ
    # the scan dropped spaces where a right-to-left mark sat between two words
    t = re.sub(r"(?<=[ء-ْ])‏(?=[ا-ي])", " ", t)
    t = t.replace("‏", "")
    t = re.sub(r"\s*،\s*", "، ", t).strip(" ،")
    # "speaker - when asked … - : reply" → "when asked … — reply"
    t = re.sub(r"\s*-\s*:\s*", " — ", t)
    t = re.sub(r"\s+-\s+", " — ", t)
    t = re.sub(r"\s+([؛:؟!.])", r"\1", t)
    t = re.sub(r"\s{2,}", " ", t)
    t = re.sub(r"\s*\.$", "", t)
    # Qur'an quotations: ornate brackets, as in print
    t = re.sub(r"\(([^()]+)\)", "﴿\\1﴾", t)
    m = AR_SPEAKER.match(t)
    by = m.group(1) if m else ""
    rest = t[m.end():] if m else t
    rest = re.sub(r"^[:\-—]\s*", "", rest)
    return by, rest


def main():
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    vol = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    ch = next(c for c in vol if c["chapter_num"] == CHAPTER)
    sections, seen = [], set()
    for s in ch["sections"]:
        items = []
        for h in s["hadiths"]:
            n = h["hadith_num"]
            by, en, quote = clean_en(n, h["english"])
            ar_by, ar = clean_ar(n, h["arabic"])
            item = {"n": n, "by": by, "en": en, "quote": quote, "ar_by": ar_by, "ar": ar}
            if n in NOTES:
                item["note"] = NOTES[n]
            if n in VERSE_LINKS:
                item["verses"] = [{"ref": r, "kind": k} for r, k in VERSE_LINKS[n]]
            items.append(item)
            seen.add(n)
        sections.append({
            "n": s["section_num"],
            "title": SECTION_TITLES[s["section_num"]],
            "title_ar": s["section_title_ar"].replace("‏", "").strip(),
            "items": items,
        })
    for n in END_OF_SURAH + DAILY + list(VERSE_LINKS):
        if n not in seen:
            raise SystemExit(f"curated narration {n} is not in the chapter")
    doc = {
        "title": "The Qur'an",
        "title_ar": ch["chapter_title_ar"].replace("‏", "").strip(),
        "source": {
            "book": "Mizan al-Hikmah",
            "author": "Muhammad Muhammadi Rayshahri",
            "volume": 4,
            "chapter": CHAPTER,
        },
        "end_of_surah": END_OF_SURAH,
        "daily": DAILY,
        "sections": sections,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"wrote {OUT} · {len(seen)} narrations in {len(sections)} sections")


if __name__ == "__main__":
    main()
