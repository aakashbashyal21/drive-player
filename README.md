# Drive Player

Paste a **public** Google Drive folder link, then **stream** audio/video or **download** it for offline playback. No Google sign-in is needed for anyone using the app.

It is a static site (plain HTML, CSS and JavaScript). The browser calls the Google Drive API with an API key.

## Setup (one-time, by the site owner)

### 1. Create a Google API key
1. Google Cloud Console → create a project → **APIs & Services → Library → Google Drive API → Enable**.
2. **APIs & Services → Credentials → Create credentials → API key**.
3. Edit the key → **Application restrictions → Websites**, add `https://aakashbashyal21.github.io/*` and `http://localhost:8080/*`.
4. **API restrictions → Restrict key → Google Drive API**.
5. Put the key in [docs/config.js](docs/config.js).

Browser API keys are visible to visitors. The referrer and API restrictions stop other sites from using your quota.

### 2. Run locally
```bash
cd docs
python -m http.server 8080
```
Open http://localhost:8080.

### 3. Host on GitHub Pages
1. Repo → Settings → Pages → Deploy from branch → `main` / `/docs`.
2. The site appears at `https://<your-github-username>.github.io/drive-player/`.
3. Free GitHub Pages needs a **public** repo. Private repos need a paid plan.

## Using it
- Paste a folder link like `https://drive.google.com/drive/folders/...`. The folder must be shared as **"Anyone with the link"**.
- Tap a folder to open it. **Play** streams the file. **Download** saves it to the browser's IndexedDB, and it then appears under *Offline*.

## Limits
- Private files and folders won't open. Drive returns "not found" for them, and the app shows a hint.
- Only files shared with "Anyone with the link" can be read with an API key. Files in another person's private drive can't be reached without sign-in.
- Downloads are held in memory while they are fetched, so very large files may fail on phones with little RAM.
- Browsers play MP4/WebM/MP3 best. MKV and some codecs may not play.
