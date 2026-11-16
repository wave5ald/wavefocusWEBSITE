# Wave Focus — Website (PWA) 2.0

Installable offline-first progressive web app. This folder is the Firebase
Hosting root (`firebase.json` deploys it as-is).

Live: <https://gen-lang-client-0965379779.web.app>

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

## Windows update manifest

`updates/version.json` is read by the desktop app on every launch and by
"Check for updates" in Settings. Publish it with
`tools/publish-update.ps1` (fills in SHA-256 and size, optional `-Deploy`)
after uploading the new `WaveFocus-<version>.exe` to a GitHub release.
