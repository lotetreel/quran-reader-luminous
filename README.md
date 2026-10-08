# Qur'an Reader - Luminous

A quiet, beautiful reader for the Holy Qur'an - Arabic, transliteration, and English.
Features the "Luminous" verse mode: an animated, medallion verse-by-verse reading
experience with a progress ring, star-lattice background, and word-by-word reveal.

This repository is a deploy-ready static build of the reader.

It includes:

- the reader UI
- per-surah JSON data under `data/`
- no build step - the site deploys as-is

## Run locally

```bash
python3 -m http.server 8090
```

Then open [http://localhost:8090](http://localhost:8090). Any static file
server works (the site is also reachable over Tailscale for phone use).

## Presentation mode (masjid / big screen)

Toggle **Present on big screen** in the settings panel, or press `P`.
The reader goes fullscreen (where allowed), hides all chrome, enlarges
the type, scales verses up to fill the stage, dims the HUD and cursor
when idle, and holds a screen wake lock when available. Works in
Luminous and Verse-by-verse modes; pressing it from Scroll mode switches
to Luminous first.

Controls: `Space` / `→` next verse · `Shift+Space` / `←` previous ·
`Alt+← →` surahs · click the left/right side of the screen to step ·
`P` or `Esc` to exit.

Deep links address a verse directly, e.g. `http://<host>:8090/#2/255`
opens Ayat al-Kursi — handy for bringing up the right verse on the
projector from your phone.

The fonts (Amiri, Literata, Manrope, Scheherazade New) are self-hosted
under `fonts/`, so the reader works with no internet connection.

## Deploy to Firebase Hosting

This repo is configured for Firebase Hosting in the `quran-reader-live`
project (site `quran-reader-live`, target `quran`).

Live deploys happen automatically on pushes to `main` via GitHub Actions;
pull requests get a preview channel.

Manual deploy:

```powershell
firebase deploy --only hosting:quran --project quran-reader-live
```

Current hosting URL:

- [https://quran-reader-live.web.app](https://quran-reader-live.web.app)

## Source control

This static site is also tracked in GitHub:

- [https://github.com/lotetreel/quran-reader-luminous](https://github.com/lotetreel/quran-reader-luminous)
