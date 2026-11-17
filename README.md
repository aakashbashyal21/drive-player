# Drive Player

Sign in with Google, open a Google Drive folder, then **stream** audio/video or **download** it for offline playback on your phone or computer.

It is a static site: plain HTML, CSS and JavaScript. The browser calls the Google Drive API directly, so there is no backend and no secret to keep.

## Setup

### 1. Google OAuth client ID
1. Google Cloud Console → create a project → enable **Google Drive API**.
2. OAuth consent screen → External → add your Google account as a **test user** (while the app is in Testing mode).
3. Credentials → Create credentials → **OAuth client ID** → type **Web application**.
4. Under **Authorized JavaScript origins**, add:
   - `http://localhost:8080` (local testing)
   - your site origin, e.g. `https://<your-github-username>.github.io`
   
   Origins have no path, so do not include `/drive-player`.
5. Copy the client ID into [docs/config.js](docs/config.js).

### 2. Run locally
```bash
cd docs
python -m http.server 8080
```
Open http://localhost:8080. (Any static server works.)

### 3. Host on GitHub Pages
1. Repo → Settings → Pages → Deploy from branch → `main` / `/docs`.
2. The site appears at `https://<your-github-username>.github.io/drive-player/`.
3. GitHub Pages on a **private** repo needs a paid GitHub plan. Make the repo public, or host elsewhere (Netlify, Cloudflare Pages). The code has no secrets, so public is fine.

## Using it
- Sign in with Google (read-only access to Drive).
- Paste a folder link or ID. Tap a folder to open it.
- **Play** streams the file. **Download** saves it to the browser's IndexedDB, and it then appears under *Offline*.

## Notes and limits
- Sign-in lasts about an hour. When it expires, sign in again.
- Google's `drive.readonly` scope is restricted. Until the app is verified, only test users can sign in.
- Streaming puts the short-lived access token in the media URL, so the token can show up in browser history. It expires after an hour.
- Downloads are held in memory while they are fetched, so very large files may fail on phones with little RAM.
- Browsers play MP4/WebM/MP3 best. MKV and some codecs may not play.
