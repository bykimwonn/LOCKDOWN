# BT LOCKDOWN - Complete Setup Guide (Download → Run → Build)

This is the live BT LOCKDOWN phone app. It connects to your TEACHING website (BT LEARNING) via HTTPS. No demo account — you sign in with a real student account from the website.

---

## 0) What you need BEFORE you start

### Required software:
1. **Node.js 18 or 20 LTS** - https://nodejs.org (check with `node -v`)
2. **Git** - https://git-scm.com (check with `git --version`)
3. **JDK 17 (Temurin recommended)** - https://adoptium.net (check with `java -version`)
   - Required for `eas build --local` and `npx expo run:android`. Gradle 8.10.2
     (used by Expo SDK 52) **cannot run on JDK 25** — if `java -version` says 25,
     your local build fails. See Common Issue #10.
4. **VS Code** or any code editor
5. For Android testing:
   - **Android Studio** + Android SDK + Emulator, OR
   - A real Android phone with **Expo Go** app (Play Store) for quick UI test, but native lockdown won't work in Expo Go — you need a dev build for full features.
   - **EAS CLI** for building APK: `npm install -g eas-cli`

### Accounts you need:
- **Expo account** (expo.dev) — for EAS Build
- **TEACHING backend deployed** — e.g. `https://your-teaching.onrender.com` must be LIVE with `teaching_mobile.py` installed. See Section 7.

---

## 1) Download the code from Arena

**Option A - Download ZIP from Arena UI:**
In Arena, click Download / Export → you get a ZIP of `arena/01a03506-lockdown` branch.

**Option B - Clone from GitHub (if you pushed):**
```bash
git clone https://github.com/bykimwonn/LOCKDOWN.git
cd LOCKDOWN
git checkout arena/01a03506-lockdown
```

**Option C - From this sandbox directly:**
If you're in the Arena workspace, your code is already at `/home/user/LOCKDOWN`.

---

## 2) Unzip & Open

1. Unzip `LOCKDOWN.zip` to Desktop or Documents, e.g.:
   - Windows: `C:\Users\YourName\Desktop\LOCKDOWN`
   - Mac/Linux: `~/Desktop/LOCKDOWN`
2. Open that folder in VS Code: `File → Open Folder → LOCKDOWN`

You should see:
```
app/                    # Expo Router screens
src/                    # logic: api, store, services
modules/bt-lockdown-native/  # native Android lockdown code (Kotlin)
plugins/withBTLockdown.js    # config plugin that injects native services
assets/                 # icons, splash
app.json                # Expo config, apiBaseUrl baked in
package.json            # dependencies
eas.json                # build profiles
FOR_TEACHING/           # teaching_mobile.py to copy to website repo
```

---

## 3) Install dependencies

Open terminal in the LOCKDOWN folder:

**Windows (PowerShell):**
```powershell
cd "C:\Users\YourName\Desktop\LOCKDOWN"
npm install
```

**Mac / Linux:**
```bash
cd ~/Desktop/LOCKDOWN
npm install
```

This will install Expo SDK 52, React Native 0.76.9, Expo Router, etc. (~300MB, takes 1-3 min).

Verify:
```bash
npx expo --version
# should show 52.x or higher
```

---

## 4) Configure API URL

The phone needs to know your TEACHING website URL.

**3 places you can set it (priority order):**

1. **Environment variable (best for local dev):**
Create `.env` file in root:
```
EXPO_PUBLIC_API_URL=https://your-teaching.onrender.com
```
No trailing slash.

2. **Baked into app.json (for production APK):**
Edit `app.json` → `expo.extra.apiBaseUrl`:
```json
"extra": {
  "apiBaseUrl": "https://your-teaching.onrender.com",
  ...
}
```

3. **At runtime on the phone:**
On the Auth screen, there's a field "BT LEARNING URL" — user can type the URL there and it saves to AsyncStorage.

For local development, use `.env`. For APK build, edit `app.json` BEFORE building.

---

## 5) Make sure TEACHING backend is ready (IMPORTANT)

The phone will NOT work without this. Your TEACHING repo must have:

**A) File `teaching_mobile.py` next to `app.py`**

Copy from:
- `LOCKDOWN/FOR_TEACHING/teaching_mobile.py` OR
- `LOCKDOWN/website/teaching_mobile.py`

Paste into your TEACHING repo folder (same folder as `app.py`).

**B) Two lines in TEACHING's `app.py`:**

Near top imports:
```python
from teaching_mobile import install_mobile_lockdown
```

Right after `app = Flask(__name__)`:
```python
install_mobile_lockdown(app)
```

**C) Environment variable on Render:**
```
TZ=Africa/Harare
```

Then push TEACHING repo:
```bash
cd TEACHING-REPO
git add teaching_mobile.py app.py
git commit -m "Keep BT LOCKDOWN link"
git push
```

Wait for Render to show **Live**.

Test backend is working:
```bash
curl https://your-teaching.onrender.com/api/lockdown/login -X POST -H "Content-Type: application/json" -d '{"id":"test@test.com","password":"test"}'
```
Should return JSON, not HTML.

---

## 6) Run the app locally

### 6A) Run on WEB (fastest to test UI):
```bash
npm run web
# or
npx expo start --web --port 8081 --host lan
```
Opens http://localhost:8081 — you can test login UI, but native blocking won't work on web (shows as unavailable, which is expected).

### 6B) Run on Android Emulator or Real Device (Dev Build required for lockdown features):

This project has native Kotlin code, so you CANNOT use plain Expo Go for full testing. You need a dev build:

```bash
# 1. Prebuild native folders (first time only)
npx expo prebuild --clean

# 2. Run on Android
npm run android
# or
npx expo run:android
```

This will:
- Build the native Android project (needs Android Studio SDK)
- Install on emulator or USB-connected phone (enable USB debugging)
- Start Metro bundler

**If you don't have Android Studio**, use Expo Go for UI-only test:
```bash
npx expo start
```
Then scan QR with Expo Go app. Auth + timetable will work, but it will say "Enforcement unavailable" — that's normal in Expo Go.

### 6C) Run on iOS (Mac only):
```bash
npm run ios
```
Note: iOS enforcement is intentionally disabled in this build — sync works, blocking is Android-only.

---

## 7) Test Login Flow

1. App starts → Splash → Onboarding → Auth screen
2. Enter:
   - **BT LEARNING URL**: `https://your-teaching.onrender.com`
   - **Student ID or Email**: same as website login
   - **Password**: same as website
3. Tap Sign In
4. If TEACHING is live, you go to Permissions screen
5. Grant:
   - Accessibility Service → BT LOCKDOWN → Enable
   - Overlay permission → Allow
   - Notifications → Allow
   - Battery exemption → Allow (important for Xiaomi/MIUI)
6. Then you land in main app (index.tsx) with:
   - Deep Work status
   - Timetable
   - Shield apps
   - Violations

**Polling:** App hits `/api/lockdown/sync` every 4 seconds. When Deep Work is active on website, phone auto-seals (HOME + overlay barrier). See `ANDROID_15_16.md` for Android 15/16 support, 16 KB compliance and the Expo SDK 54 upgrade path.

---

## 8) Build APK for real phone

### Install EAS CLI:
```bash
npm install -g eas-cli
eas login
# login with your expo.dev account (owner: bingen in app.json)
```

### Configure EAS:
```bash
eas init
# if asked, use projectId 6ba262dd-d81c-4184-b214-a2911dad08b0 (already in app.json)
```

### Build preview APK (for testing on Redmi etc.):
```bash
eas build --platform android --profile preview
```

This builds in cloud (~10-20 min). You'll get a download link for APK.

**Important:** Before building, set production API URL in `app.json` → `extra.apiBaseUrl` to your Render URL, otherwise APK will have old default `https://api.btlearningsolutions.com`.

### Build APK locally on Windows (Android Studio — no cloud, no EAS)

`eas build --local` **does not work on Windows** — EAS only supports local Android builds on
macOS or Linux, so you'll get:

```
Unsupported platform, macOS or Linux is required to build apps for Android
```

If your EAS free tier is used up, don't fight it. On Windows you already have everything you
need (Android Studio bundles the Android SDK + a JDK), so **build directly with Gradle** and
skip EAS entirely. Verified working on Windows 10 + Android Studio + Expo SDK 52:

**1. Set two environment variables (persistent) in PowerShell — open a NEW PowerShell after:**

```powershell
[Environment]::SetEnvironmentVariable("ANDROID_HOME", "$env:LOCALAPPDATA\Android\Sdk", "User")
[Environment]::SetEnvironmentVariable("ANDROID_SDK_ROOT", "$env:LOCALAPPDATA\Android\Sdk", "User")
[Environment]::SetEnvironmentVariable("JAVA_HOME", "C:\Program Files\Android\Android Studio\jbr", "User")
```

The Android SDK default is `C:\Users\<You>\AppData\Local\Android\Sdk`. To confirm the exact
path, open **Android Studio → File → Settings → Appearance & Behavior → System Settings →
Android SDK** and copy the **Android SDK Location** (or check that path has `platform-tools`,
`platforms`, `build-tools`).

**2. Confirm the SDK + JDK in a fresh PowerShell:**

```powershell
Test-Path "$env:ANDROID_HOME"                       # must be True
Test-Path "$env:ANDROID_HOME\platform-tools"        # must be True
java -version                                        # must be 17.x or 21.x, NOT 25
```

**3. Generate the native Android project:**

```powershell
npx expo prebuild --platform android --no-install
npm run test:manifest    # repo's own guardrail — should print "valid"
```

**4. CRITICAL — point Gradle at a real JDK 17 (not Android Studio's JBR):**

Android Studio's bundled JBR (`...\Android Studio\jbr`) is often **Java 25**, which Gradle 8.10.2
cannot run. Your `java -version` may print 17 while Gradle still uses a 25 launcher. Force
Gradle onto JDK 17 by editing `android\gradle.properties` and adding:

```properties
org.gradle.java.home=C:/Program Files/Microsoft/jdk-17.0.20.101-hotspot
```

Replace the path with **your own** JDK 17 (`C:\Program Files\Microsoft\jdk-...` or Eclipse
Adoptium Temurin). Use forward slashes even on Windows.

**5. If the Gradle wrapper download times out** (slow internet), open `android\gradle\wrapper\gradle-wrapper.properties`
and add a big timeout (ms), then rebuild:

```properties
networkTimeout=600000
```

**6. Build the release APK:**

```powershell
cd android
.\gradlew.bat --stop                        # kill any stale daemon on the wrong JDK
.\gradlew.bat --version                     # "Daemon JVM" must be 17.x, NOT 25.x
.\gradlew.bat assembleRelease
```

Result:
```
android\app\build\outputs\apk\release\app-release.apk
```

Signed with the local debug keystore — fine for sideloading on your phone (not for Play Store).
Not supported on Windows: `eas build --local`. Supported: the Gradle path above, or a cloud
`eas build` (needs EAS free tier / quota).

**If Gradle says a component is missing**, open Android Studio → **Tools → SDK Manager**:
- **SDK Platforms** → tick **Android 15 (API 35)** → Apply
- **SDK Tools** → tick **NDK (Side by Side)** (any recent) → Apply

Then re-run `.\gradlew.bat assembleRelease`.

### Install APK on phone:
- Download APK on phone, allow unknown sources, install.
- Open BT LOCKDOWN
- Enter TEACHING URL + student credentials
- Grant all permissions (see MIUI autostart note below)

**MIUI / Xiaomi / Redmi special:**
After permissions, app will try to open Autostart settings:
- Enable Autostart for BT LOCKDOWN
- Battery saver → No restrictions
- Otherwise Android kills the foreground service.

### Build production AAB (for Play Store):
```bash
eas build --platform android --profile production
```

---

## 9) Project Structure Explained

```
app/
  (app)/_layout.tsx    → main tabs layout
  (app)/index.tsx      → home / status ring
  (app)/shield.tsx     → blocked apps list
  (app)/timetable.tsx  → schedule from /sync
  (app)/violations.tsx → penalty history
  auth.tsx             → login (URL + id + password) - NO demo button
  onboarding.tsx       → first launch
  permissions.tsx      → accessibility + overlay
  lockdown.tsx         → active lockdown screen

src/
  config.ts            → apiBase + token stored in AsyncStorage
  services/api.ts      → all HTTP calls to TEACHING
  services/lockdownNative.ts → bridge to Kotlin module
  store/AppState.tsx   → global state + 4s sync loop + penalties
  data/seed.ts         → default shield apps list

modules/bt-lockdown-native/
  android/src/main/java/com/btsoftware/lockdown/
    LockdownAccessibilityService.kt → intercepts blocked app launches
    LockdownOverlayService.kt       → foreground watchdog, polls /current every 5s, heartbeats 20s
```

---

## 10) Common Issues & Fixes

**1. "Set your BT LEARNING URL first"**
→ You didn't set URL. Set `EXPO_PUBLIC_API_URL` in `.env` or type it on auth screen.

**2. SYNC DOWN / http_... error**
→ TEACHING backend is sleeping (Render free tier) or `teaching_mobile.py` missing. Check backend logs on Render.

**3. `401 unauthorized` or `device_expired`**
→ Token expired after 14 days idle. Just sign in again on phone.

**4. `429 too_many_attempts`**
→ 8 failed logins in 15 min. Wait.

**5. Build fails with strings.xml error**
→ Already fixed in `plugins/withBTLockdown.js` — it appends instead of overwriting. If you modified plugin, revert.

**6. App not blocking on Expo Go**
→ Expected. Expo Go cannot run native modules. Need `npx expo run:android` or EAS dev build.

**7. Overlay permission denied**
→ On Android 14+, must grant "Display over other apps" manually in Settings → Apps → BT LOCKDOWN → Display over other apps.

**8A. `expo start` / `npm run web` exits instantly with `TypeError: fetch failed`**
→ Expo CLI's dependency check (`Check that packages match versions required by the installed Expo SDK`) tries to call Expo's API to compare your package versions. If that network call is blocked or times out, Metro never starts and the terminal just quits. Your versions already match SDK 52, so it's safe to skip that check:
1. Create a `.env` file in the project root (already gitignored):
   ```
   EXPO_NO_DEPENDENCY_VALIDATION=1
   ```
2. Run `npx expo start` / `npm run web` again — it starts normally.

**8. Clock tamper penalties when clock is correct**
→ Fixed in v2: server now sends explicit UTC with Z suffix. Make sure TEACHING repo has latest `teaching_mobile.py` and `TZ=Africa/Harare` env.

**9. EAS build fails right after**
```
Setting the update request headers in 'AndroidManifest.xml' to '{"expo-channel-name":"preview"}'
Invalid manifest found at: .../android/app/src/main/AndroidManifest.xml
```
→ The generated `AndroidManifest.xml` is wrapped in a bogus `<root>` tag, so Expo's
reader cannot find the `<manifest>` element. This was caused by `plugins/withBTLockdown.js`
adding `RECEIVE_BOOT_COMPLETED` to `cfg.modResults` instead of `cfg.modResults.manifest`
(a second element next to `<manifest>` makes the XML writer add the `<root>` wrapper).
Fixed in the plugin, and guarded twice: `__tests__/withBTLockdown.test.js` (the mod in
isolation) and `npm run test:manifest` (the generated file, i.e. every plugin together).
Both run in CI — `.github/workflows/ci.yml`, kept identical to `.ci-template/ci.yml`.
If it comes back after you edit a plugin, run:

```bash
npx expo prebuild -p android --no-install --clean && npm run test:manifest
```

**10. `eas build --local` fails with `Unsupported class file major version 69`**
→ Your terminal's default Java is **JDK 25** (class file major version 69). Expo SDK 52's
Gradle 8.10.2 cannot run on JDK 25, so the build dies before it even compiles. This is a
**toolchain version mismatch — nothing wrong with the app code.**

Switch to **JDK 17** (what Expo SDK 52 / React Native 0.76 expects) and rebuild:

```bash
# 1. Confirm the problem — this must print 17.x, not 25.x
java -version

# 2. Find installed JDKs (GitHub Codespaces usually has several)
ls /usr/lib/jvm

# 3A. If SDKMAN is installed (default in GitHub Codespaces):
sdk list java
sdk install java 17.0.13-tem
sdk use java 17.0.13-tem          # this terminal only
sdk default java 17.0.13-tem      # every new terminal (recommended)

# 3B. Or point JAVA_HOME straight at an installed JDK 17:
export JAVA_HOME=/usr/lib/jvm/msopenjdk-17-amd64   # adjust path to your JDK 17
export PATH="$JAVA_HOME/bin:$PATH"

# 4. Verify before rebuilding
java -version          # must show 17.x
echo "$JAVA_HOME"      # must not be empty

# 5. Kill any old Gradle daemon, then rebuild
pkill -f gradle || true
eas build --local --platform android
```

Shortcut to skip the whole problem: use a cloud build instead —
`eas build --platform android --profile production` (EAS runs it in its own
container with the correct JDK). Local builds are the only ones affected by your
machine's Java version.

Note: the `ANDROID_NDK_HOME environment variable was not specified` and `npm
warn deprecated ...` lines earlier in the log are harmless — ignore them. The
build only fails because of the Java version.

**11. `eas build --local` fails with `SDK location not found` and `Could not get
unknown property 'release'`**

> ⚠️ **On Windows**, `eas build --local` aborts immediately with "Unsupported platform, macOS or
> Linux is required to build apps for Android." EAS only supports local Android builds on
> macOS/Linux. Use the **Windows + Android Studio → Gradle** path in Section 8 (build APK locally)
> instead. The rest of this issue is for Linux/macOS local builds.

→ The `release` error is just a **follow-on** of the first one: your machine has
no Android SDK path configured, so Expo's native modules can't configure and
Gradle aborts. Fix by pointing `ANDROID_HOME` at the Android SDK:

```bash
# 1. Find an existing SDK (one of these usually exists in Codespaces):
ls -d /usr/local/lib/android/sdk /usr/local/android-sdk /opt/android-sdk \
  /usr/lib/android-sdk ~/Android/Sdk "$HOME/android-sdk" 2>/dev/null
find /usr /opt /home -maxdepth 5 -name sdkmanager -type f 2>/dev/null | head

# 2. If one exists, point the build at it:
export ANDROID_HOME=/usr/local/lib/android/sdk      # <-- use the path you found
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"

# 3. Verify it has what SDK 52 needs (compileSdk 35, build-tools 35, NDK 26):
ls "$ANDROID_HOME/platforms" "$ANDROID_HOME/build-tools" "$ANDROID_HOME/ndk" 2>/dev/null

# 4. Rebuild — env vars are inherited by the EAS local build:
eas build --local --platform android
```

**If no SDK exists, install one (run in GitHub Codespaces / any Linux):**

```bash
# ~/.android-sdk/cmdline-tools/latest
mkdir -p "$HOME/android-sdk/cmdline-tools"
cd "$HOME/android-sdk/cmdline-tools"
curl -fsSL -o tools.zip \
  https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip
unzip -q tools.zip && rm tools.zip && mv cmdline-tools latest

export ANDROID_HOME="$HOME/android-sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"

# Accept licenses and install what React Native 0.76 / Expo SDK 52 needs:
yes | sdkmanager --licenses
sdkmanager "platform-tools" \
  "platforms;android-35" \
  "build-tools;35.0.0" \
  "ndk;26.1.10909125"   # ~700 MB, this is the slow step

eas build --local --platform android
```

To make the SDK + JDK sticky for every new terminal, append to `~/.bashrc`:

```bash
export JAVA_HOME="$HOME/.sdkman/candidates/java/17.0.13-tem"
export ANDROID_HOME="$HOME/android-sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"
```

then open a **new terminal** and confirm:
`java -version` → 17.x, `echo $ANDROID_HOME` → your SDK path.

---

## 11) Quick Command Cheat Sheet

```bash
# First time setup
npm install
# copy .env
echo "EXPO_PUBLIC_API_URL=https://your-teaching.onrender.com" > .env

# Development
npm run web              # web UI test
npx expo start           # Expo Go QR
npm run android          # full native test (needs Android Studio)

# Checks
npm run lint             # tsc --noEmit
npm test                 # unit tests (+ config-plugin manifest tests)
npm run test:contract    # phone <-> TEACHING route shapes
# AndroidManifest exactly as the EAS build step will read it:
npx expo prebuild -p android --no-install --clean && npm run test:manifest

# Build
eas login
eas build --platform android --profile preview   # APK (cloud)
eas build --platform android --profile production # AAB (cloud)

# Local APK on Windows (no cloud / no EAS) — see Section 8
npx expo prebuild --platform android --no-install
cd android
.\gradlew.bat assembleRelease
# APK -> android\app\build\outputs\apk\release\app-release.apk

# Clean if something broken
npx expo prebuild --clean
rm -rf node_modules && npm install
```

---

## 12) What to use (Tools Summary)

| Tool | Purpose | Install |
|------|---------|---------|
| Node.js 18/20 | Run JS, npm | nodejs.org |
| npm | Package manager | comes with Node |
| Expo CLI | Start app | `npx expo` (auto) |
| EAS CLI | Build APK | `npm i -g eas-cli` |
| Android Studio | Emulator + SDK for `run:android` | developer.android.com |
| VS Code | Edit code | code.visualstudio.com |
| Git | Push to GitHub | git-scm.com |
| Expo Go app | Quick phone preview (UI only) | Play Store |

You do NOT need: MongoDB, Firebase, etc. — phone talks directly to TEACHING's PostgreSQL via Flask API.

---

Done! If you follow 1→8, you'll have APK on phone sealing during Deep Work.
