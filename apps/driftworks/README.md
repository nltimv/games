# Driftworks for Android and iOS

The Driftworks apps are a [Capacitor](https://capacitorjs.com) shell around
the same game the website serves from `public/games/driftworks`. There is
no second copy of the game: every build copies the website's files into
`www/` (see [`scripts/build-web.mjs`](scripts/build-web.mjs)), and the app
loads them from inside the app, so it starts offline and keeps saves on the
device like the browser does.

```
apps/driftworks/
├── capacitor.config.json   # App id, name, colors
├── scripts/build-web.mjs   # Copies the game into www/ and adds the app tags
├── scripts/build-number.mjs# Store build number from the release version
├── scripts/ios-signing.sh  # CI: manual signing for the App target
├── scripts/render-assets.cjs # Icons and splash screens from assets/*.svg
├── web/app.css             # App-only CSS: safe areas, no text selection
├── assets/                 # Icon artwork (SVG)
├── android/                # Android Studio project (committed)
└── ios/                    # Xcode project, Swift Package Manager (committed)
```

What differs from the website:

- There is no "Back to Games Hub" in the menus.
- The game keeps clear of the notch, the status bar and the home bar.
- Cloud saves call the Games Hub server set at build time (below).

## Cloud saves in the app

The app's pages have their own origin (`capacitor://localhost` on iOS,
`https://localhost` on Android), so the app needs to know where the Games
Hub server is. Set the repository **variable** (not a secret)
`DRIFTWORKS_API_URL` to the public address of your Games Hub, for example
`https://games.example.com`. It must be `https://` with no path.

- Set: save codes, the cloud save page and recovery mail work in the app as
  they do on the site. The server lets the app's origins call `/api`
  (server setting `APP_ORIGINS`, on by default).
- Not set: the app plays with saves on the device only, and the menus say
  so, as on a site without cloud saves.

## Building locally

Needs Node 22, plus Android Studio (JDK 21, Android SDK 36) and/or
Xcode 26 on a Mac.

```bash
cd apps/driftworks
npm install
DRIFTWORKS_API_URL=https://games.example.com npm run android   # or: npm run ios
```

`npm run sync` copies the game into both native projects without opening
an IDE. Run it after every change to the game.

## CI and releases

The `android` and `ios` jobs in
[`.github/workflows/docker-publish.yml`](../../.github/workflows/docker-publish.yml)
build the apps on every pull request, push to `main` and release tag. What
they make depends on which secrets exist:

| | No secrets | Signing secrets | Signing + store secrets, on a release tag |
|---|---|---|---|
| Android | Debug APK (installs on any phone with "unknown sources") | Signed APK and AAB | Also sent to Google Play |
| iOS | iOS Simulator build (zipped `App.app`) | Signed App Store IPA | Also sent to TestFlight |

Every run uploads its builds as workflow artifacts (`android-app`,
`ios-app`). A release (`vX.Y.Z` tag on `main`) also attaches the APK, AAB
and IPA, or the debug APK, to the GitHub release. If an app fails to build,
the release still goes out without it.

Versions: the app version is the tag (`1.4.2`; iOS drops a prerelease
suffix). The build number is worked out from it by
[`scripts/build-number.mjs`](scripts/build-number.mjs) (`1.4.2` →
`1040299`, `1.4.2-rc.3` → `1040203`), so every release sorts above the
last. Builds that are not releases use the workflow run number.

## Secrets to add

Add these under **Settings → Secrets and variables → Actions** in the
repository. Each group is optional and works on its own.

### Android signing

Create an upload keystore once and keep it safe (losing it means asking
Google to reset the upload key):

```bash
keytool -genkeypair -v -keystore driftworks-upload.jks -alias driftworks \
  -keyalg RSA -keysize 4096 -validity 10000
base64 -w0 driftworks-upload.jks   # macOS: base64 -i driftworks-upload.jks
```

| Secret | Value |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | The base64 of the `.jks` file |
| `ANDROID_KEYSTORE_PASSWORD` | The keystore password |
| `ANDROID_KEY_ALIAS` | The key alias (`driftworks` above) |
| `ANDROID_KEY_PASSWORD` | The key password (often the same as the keystore's) |

### Google Play upload (optional)

1. Create the app in the [Play Console](https://play.google.com/console)
   with package name `io.github.nltimv.driftworks`, and turn on Play App
   Signing.
2. Upload the first AAB by hand (Play does not accept the first upload
   through the API). Take it from a release or the `android-app` artifact.
3. In Google Cloud, create a service account with a JSON key, then invite
   its email in the Play Console under **Users and permissions** with
   permission to release to testing tracks.

| Secret | Value |
|---|---|
| `PLAY_SERVICE_ACCOUNT_JSON` | The service account's JSON key, as is |

Releases go to the `internal` track. Optional repository variables:
`PLAY_TRACK` (`internal`, `alpha`, `beta`, `production`) and
`PLAY_RELEASE_STATUS` (`completed`, or `draft` while the app has never been
reviewed, which Play requires).

### iOS signing

Needs a paid Apple Developer account.

1. In [Certificates, Identifiers & Profiles](https://developer.apple.com/account/resources),
   register the App ID `io.github.nltimv.driftworks`.
2. Create an **Apple Distribution** certificate, install it in Keychain
   Access on a Mac, and export it with its private key as a `.p12` with a
   password.
3. Create an **App Store Connect** provisioning profile for that App ID
   and certificate, and download the `.mobileprovision`.

| Secret | Value |
|---|---|
| `IOS_CERTIFICATE_P12_BASE64` | `base64 -i distribution.p12` |
| `IOS_CERTIFICATE_PASSWORD` | The `.p12` export password |
| `IOS_PROVISIONING_PROFILE_BASE64` | `base64 -i Driftworks.mobileprovision` |
| `APPLE_TEAM_ID` | Your 10-character team ID (Membership details) |

### TestFlight upload (optional)

1. Create the app in [App Store Connect](https://appstoreconnect.apple.com)
   with bundle ID `io.github.nltimv.driftworks`.
2. Under **Users and Access → Integrations → App Store Connect API**,
   create a team key with the **App Manager** role and download the `.p8`
   (it can be downloaded once).

| Secret | Value |
|---|---|
| `APP_STORE_CONNECT_KEY_ID` | The key ID |
| `APP_STORE_CONNECT_ISSUER_ID` | The issuer ID shown above the keys |
| `APP_STORE_CONNECT_KEY_BASE64` | `base64 -i AuthKey_XXXXXXXXXX.p8` |

The app declares that it uses no non-exempt encryption (it only uses
HTTPS), so TestFlight builds need no export compliance answer.

## Changing the app id

The app id `io.github.nltimv.driftworks` is in `capacitor.config.json`,
`android/app/build.gradle` (`namespace`, `applicationId`, plus the Java
package under `android/app/src/main/java`), the Xcode project
(`PRODUCT_BUNDLE_IDENTIFIER`) and the workflow (`packageName`, `BUNDLE_ID`).
Change it before the first store upload: afterwards the stores treat a new
id as a different app.

## Icons and splash screens

The artwork is `assets/background.svg` and `assets/foreground.svg` (the
sun, orbits and stations, kept inside the middle two thirds for Android's
adaptive icon mask). After changing them, run
`node scripts/render-assets.cjs` and commit the PNGs it writes.
