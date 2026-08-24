# BT LOCKDOWN - Complete Setup Guide (Download → Run → Build)

This is the live BT LOCKDOWN phone app. It connects to your TEACHING website (BT LEARNING) via HTTPS. No demo account — you sign in with a real student account from the website.

---

## 0) What you need BEFORE you start

### Required software:
1. **Node.js 18 or 20 LTS** - https://nodejs.org (check with `node -v`)
2. **Git** - https://git-scm.com (check with `git --version`)
3. **VS Code** or any code editor
4. For Android testing:
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

**Polling:** App hits `/api/lockdown/sync` every 4 seconds. When Deep Work is active on website, phone auto-seals (HOME + overlay barrier).

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

**8. Clock tamper penalties when clock is correct**
→ Fixed in v2: server now sends explicit UTC with Z suffix. Make sure TEACHING repo has latest `teaching_mobile.py` and `TZ=Africa/Harare` env.

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

# Build
eas login
eas build --platform android --profile preview   # APK
eas build --platform android --profile production # AAB

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
