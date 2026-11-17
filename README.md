# Wave Focus — Website (PWA)

Installable offline-first progressive web app. This folder is the Firebase
Hosting root (`firebase.json` deploys it as-is).

Live: <https://wavefocus.vercel.app/>

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

`updates/version.json` is the only file the Windows and Android apps read.
It holds the desktop release fields plus an `android` block
(`version_name`, `version_code`, `apk_url`). The website itself does not
use it — the PWA updates through its service worker.

Publish it with `tools/publish-update.cmd` (fills in SHA-256/size and can
deploy with `-Deploy`) after uploading the new `WaveFocus-<version>-Setup.exe`
and `WaveFocus-<version>.apk` to their GitHub releases. Keep
`updates/version.json` and the no-cache header in `firebase.json` in every
deployment, otherwise the apps cannot check for updates.
