# FluxTranslate — LLM Inline Translator (Chrome Extension)

## Overview
- Inline page translation with OpenAI/Anthropic/Gemini via a Chrome extension (MV3)
- Custom tone/style + personal glossary
- Shimmering effect while paragraphs are translating
- Context menus, omnibox trigger, popup and options with liquid-glass UI
- Caching and BYOK (Bring Your Own Key) only (no login/server)

## Quick Start
### 1) Load the extension
   - Open Chrome → More Tools → Extensions → Enable Developer mode
   - Load unpacked → choose `extension/`
   - Click the action icon → open popup, set target language, provider/model, and your API key

### 2) Try it
   - Visit any page, click "Translate Page" in the popup, or right‑click → Translate page
   - While translating, text shows a shimmering placeholder; translations replace text in place
   - Use the floating control to Toggle/Restore

### 3) Options
   - Right‑click the extension icon → Options to configure tone, concurrency, batch size, and glossary

## BYOK Only
- Store your provider API key in the extension; requests go directly to the provider from the background service worker.
- No login, no subscriptions, no server — fully client‑side.

## Notes
- Latest model names change frequently; input any valid name supported by your provider
- This is MV3; background code is a service worker using `fetch` with `host_permissions`

## Install from source
- Load the extension: Chrome → Extensions → Enable Developer mode → Load unpacked → select `extension/`
- Open the popup → set Target language, Provider/Model, and paste your API key

## Install via Chrome Web Store (recommended)
- One‑click install from the Chrome Web Store once published.
- Link: (to be added after publishing)

## Manual install from ZIP (for users)
- Download a release ZIP, then EXTRACT it. Chrome cannot install a ZIP directly.
- Open Chrome → Extensions → Enable Developer mode → Load unpacked → select the extracted folder (the one that contains `manifest.json`).

## Recommended permissions (for Store submission)
- `permissions`: `storage`, `activeTab`, `scripting`, `contextMenus`, `tabs`, `commands`
- `host_permissions` (minimized):
  - `https://api.openai.com/*`
  - `https://api.anthropic.com/*`
  - `https://generativelanguage.googleapis.com/*`
  - `https://api.groq.com/*`

## Privacy (BYOK)
- No developer‑run servers. Text is sent only to the chosen model provider for translation.
- API keys and settings are stored in your browser’s local storage.
- See `PRIVACY_POLICY.md` for details.

## Package for Chrome Web Store
- Rule: ZIP the CONTENTS of `extension/`, not the folder itself. `manifest.json` must be at ZIP root.
- Windows (File Explorer): open `extension/`, press Ctrl+A, right‑click → Send to → Compressed (zipped) folder.
- Windows (PowerShell): `Compress-Archive -Path extension\* -DestinationPath fluxtranslate.zip -Force`
- macOS (Finder): open `extension/`, select all items, right‑click → Compress.
- macOS/Linux (Terminal): `cd extension && zip -r ../fluxtranslate.zip . -x '*.DS_Store'`

## Contributing
- Issues and PRs are welcome. Keep changes focused and minimal.
- Please avoid adding server/auth code. This project is BYOK‑only.

License
- MIT — see `LICENSE`.
