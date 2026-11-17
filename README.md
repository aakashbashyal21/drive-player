# Drive Player

Login with GitHub, open a Google Drive folder, then **stream** audio/video or **download** it for offline playback. No npm packages: plain Node.js (18+) backend and vanilla HTML/CSS/JS frontend.

## Setup

### 1. GitHub OAuth app
1. GitHub → Settings → Developer settings → OAuth Apps → **New OAuth App**
2. Homepage URL: `http://localhost:3000`
3. Authorization callback URL: `http://localhost:3000/auth/github/callback`
4. Copy the Client ID and generate a Client Secret.

### 2. Google OAuth client
1. Google Cloud Console → create a project → enable **Google Drive API**.
2. OAuth consent screen → External → add your own Google account as a **test user**.
3. Credentials → Create credentials → **OAuth client ID** → Web application.
4. Authorized redirect URI: `http://localhost:3000/auth/google/callback`
5. Copy the Client ID and Client Secret.

### 3. Configure and run
```bash
cp .env.example .env   # fill in the values
npm start
```
Open http://localhost:3000.

## Using it
- Log in with GitHub, then connect Google Drive (read-only).
- Paste a Drive folder link or ID. Folders open on tap; **Play** streams the file.
- **Download** saves the file to the browser's IndexedDB. Downloaded files appear under *Offline* and play without a network connection.

## Phone access
`localhost` is not reachable from a phone. Either:
- deploy it somewhere with HTTPS (Render, Railway, Fly.io, a VPS), set `BASE_URL` to that URL, and update both OAuth callback URLs; or
- expose your local server with a tunnel (e.g. `cloudflared tunnel --url http://localhost:3000`) and use that URL as `BASE_URL` in the same way.

## Notes and limits
- Sessions are in memory: restarting the server means logging in again.
- Downloads are held in memory while they are being fetched, so very large files (multiple GB) may fail on phones with little RAM.
- Browsers play MP4/WebM/MP3 well; MKV and some codecs may not play in every browser.
- `drive.readonly` is a restricted scope. While the Google app is in *Testing* mode, only listed test users can log in.
