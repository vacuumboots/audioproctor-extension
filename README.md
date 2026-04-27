# AudioProctor Extension

Chrome Extension (Manifest V3) used for secure student audio assessment playback in AudioProctor.

## Open-source and auditable

This extension code is publicly mirrored so schools, IT teams, and security reviewers can audit exactly what runs in student browsers.

Public repository:
https://github.com/vacuumboots/audioproctor-extension

Scope note:
- This repository contains the extension client only.
- Backend APIs, database rules, and teacher dashboard code live in the private main project repository.

## What the extension does

- Accepts a teacher-provided access code
- Calls `/api/session` to validate the code and fetch a short-lived signed audio URL
- Opens a fullscreen player window for playback
- Uses an offscreen document for reliable audio playback
- Requires teacher exit word verification before closing
- Sends session telemetry events (start/pause/replay/completion/exit) to the API

## Privacy and security model

- No permanent student data storage inside the extension
- Session data is stored in `chrome.storage.session` (ephemeral)
- Audio URL must match expected Supabase host pattern
- API base is allowlisted (`https://audioproctor.com` and `https://app.audioproctor.com`)
- Exit word is verified by SHA-256 hash comparison (plaintext exit word is not stored in the extension)
- Content Security Policy is declared in `manifest.json`, restricting scripts to extension-origin only and limiting network connections to the AudioProctor API and Supabase storage
- No external fonts or resources are loaded; all assets are bundled within the extension to prevent data leakage to third parties
- All `fetch()` calls use `referrerPolicy: 'no-referrer'` to prevent the extension URL from appearing in server access logs

## Permissions used

Defined in `manifest.json`:
- `storage` – temporary session state
- `windows` – fullscreen popup window control
- `offscreen` – offscreen audio playback document

Host permissions:
- `https://audioproctor.com/*`
- `https://app.audioproctor.com/*`
- `https://*.supabase.co/*`

## Development

Load unpacked in Chrome:
1. Open `chrome://extensions`
2. Enable Developer mode
3. Click **Load unpacked**
4. Select this `extension/` directory

## Versioning and release flow

The public `audioproctor-extension` repository is synced from the `extension/` subtree of the private main repository.

Main-branch changes to `extension/**` are automatically pushed to the public repo via GitHub Actions.

## Responsible disclosure

If you identify a security issue, please report it privately to the maintainer before public disclosure.