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

```powershell
py -m http.server 8000
```

Then open [http://localhost:8000](http://localhost:8000).

## Deploy to Firebase Hosting

This repo is configured for Firebase multi-site hosting in the `mizan-al-hikmah`
project (site `quran-reader-luminous`, target `quran`).

Live deploys happen automatically on pushes to `main` via GitHub Actions;
pull requests get a preview channel.

Manual deploy:

```powershell
firebase deploy --only hosting:quran --project mizan-al-hikmah
```

Current hosting URL:

- [https://quran-reader-luminous.web.app](https://quran-reader-luminous.web.app)

## Source control

This static site is also tracked in GitHub:

- [https://github.com/lotetreel/quran-reader-luminous](https://github.com/lotetreel/quran-reader-luminous)
