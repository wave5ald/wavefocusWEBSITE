# Wave Focus - Website (PWA) 2.2.0

Installable offline-first progressive web app. This folder is the Firebase
Hosting root (`firebase.json` deploys it as-is).

Live: <https://wavefocus.vercel.app/>
Manifest mirror: <https://gen-lang-client-0965379779.web.app>

## v2.2 changes

- **Theme color slider** (`js/theme-hue.js`, `js/views/settings.js`,
  `css/app.css`): Settings → *Appearance* gains a **Theme color** card with a
  hue slider, eight preset swatches and **Reset**. `hueTokens()` writes the
  accent CSS variables (`--primary`, `--primary-soft`, `--secondary`,
  `--tertiary`, the two background glows) on `#app`, so every button, ring,
  chip and highlight repaints while surfaces and text stay neutral. A zero
  shift removes the inline variables, leaving the original design untouched.
- `js/app.js` re-applies the saved hue through `applyHue()` on every theme
  change and on reload; `js/store.js` seeds `settings.hue = 0`.
- New strings (`themeColor`, `themeColorHint`, `resetColor`,
  `themeColorSaved`) in English and Arabic; the version row reads `2.2.0`.
- `sw.js` cache bumped to `wavefocus-v2.2.0` (adds `js/theme-hue.js` to the
  shell), and `updates/version.json` now advertises 2.2.0 / versionCode 4.

## v2 changes

- `js/hijri-sync.js` verifies the Saudi (Umm al-Qura) Hijri calendar online
  (Aladhan `gToH` with method `HJCoSA`), persists the day offset and cached
  month lengths, and re-verifies on launch, reconnect, focus and every 6 h.
- `js/dates.js` now supports a configurable routine-day start
  (`setDayStart`) plus Saudi Hijri lookups (`setHijriOffset`,
  `setHijriDateLookup`, `setHijriMonthLookup`).
- Settings → **Day & Calendar**: choose the daily task reset time and watch the
  verification status.
- `sw.js` cache bumped to `wavefocus-v2.0.0`.

## Run / deploy

```bash
# local preview (service workers need http)
npx serve .

# deploy
firebase deploy --only hosting --project gen-lang-client-0965379779
```

No build step: plain ES modules. `firebase.json` sets no-cache headers for
`sw.js`, `index.html` and `updates/version.json`.

## App update manifest

`updates/version.json` is the only file the Windows and Android apps read
(`https://gen-lang-client-0965379779.web.app/updates/version.json`). It holds
the desktop release fields plus an `android` block (`version_name`,
`version_code`, `apk_url`). The website itself does not use it - the PWA
updates through its service worker.

Current content: `2.2.0` for Windows, `2.2` / `version_code 4` for Android,
with the SHA-256 and byte size of `WaveFocus-2.2.0-Setup.exe` and
`WaveFocus-2.2.apk`.

Publish it with `tools/publish-update.ps1` (fills in SHA-256/size and can
deploy with `-Deploy`) after uploading the new `WaveFocus-<version>-Setup.exe`
and `WaveFocus-<version>.apk` to their GitHub releases. Keep
`updates/version.json` and the no-cache header in `firebase.json` in every
deployment, otherwise the apps cannot check for updates.
