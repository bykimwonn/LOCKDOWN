# BT LOCKDOWN ↔ TEACHING — do not overwrite this

Another chat may rewrite files. **Keep this contract.** If you replace `app.py` or the phone API layer, put these pieces back or the phone will not talk to the website.

Two products:

| Product | Repo / folder | Job |
| --- | --- | --- |
| Website | https://github.com/bykimwonn/-TEACHING | BT LEARNING. Owns users, timetable, ELO, lockdown sessions |
| Phone | `bt-lockdown` | BT LOCKDOWN. Seals the phone when the website says Deep Work is on |

They talk over **HTTPS JSON**. No MongoDB. Same PostgreSQL as TEACHING.

---

## 1. Website — file that must exist

**Path (next to `app.py`):** `teaching_mobile.py`

Full source lives in:

- `bt-lockdown/learning-bridge/teaching_mobile.py`
- `bt-lockdown/FOR_TEACHING/teaching_mobile.py`
- already on GitHub: `https://github.com/bykimwonn/-TEACHING/blob/main/teaching_mobile.py`

If another chat deletes this file, copy it back from one of those places.

What it adds:

- `POST /api/lockdown/login` — student ID or email + password → device token
- `GET  /api/lockdown/me` — profile + penalties
- `GET  /api/lockdown/schedule` — timetable as sessions
- `Authorization: Bearer <device_id>` on every existing `/api/lockdown/*` route
- CORS for the phone

---

## 2. Website — two lines that must stay in `app.py`

Near the other imports (after `import pdfgen`):

```python
from teaching_mobile import install_mobile_lockdown
```

Right after the Flask app is created:

```python
app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "bt-learning-demo-secret")
install_mobile_lockdown(app)
```

If another chat rewrites `app.py` and drops these two lines, the phone login dies even if `teaching_mobile.py` is still there.

These lines are already on GitHub (`6639c2e`). Confirm with:

```
from teaching_mobile import install_mobile_lockdown
install_mobile_lockdown(app)
```

---

## 3. Website — routes already in TEACHING (do not remove)

These were already in `app.py`. The phone uses them after login.

| Method | Path | Phone uses it for |
| --- | --- | --- |
| POST | `/api/lockdown/login` | Sign in (from `teaching_mobile.py`) |
| GET  | `/api/lockdown/me` | Profile (from `teaching_mobile.py`) |
| GET  | `/api/lockdown/schedule` | Timetable (from `teaching_mobile.py`) |
| GET  | `/api/lockdown/current` | Is Deep Work on? Seal the phone |
| POST | `/api/lockdown/heartbeat` | Server clock + drift check |
| POST | `/api/lockdown/event` | Blocked app / force-quit / tamper |
| POST | `/api/lockdown/complete` | Session finished |
| POST | `/api/lockdown/create` | Manual 25/50 minute focus |
| GET  | `/api/lockdown/history` | Past sessions |
| POST | `/api/lockdown/register-device` | Bind phone (called inside login) |

Auth: website cookie **or** header

```
Authorization: Bearer <device_id>
```

`device_id` is returned as `token` from `/api/lockdown/login` and stored in `device_bindings`.

---

## 4. Login request / response (must stay this shape)

**Request**

```http
POST /api/lockdown/login
Content-Type: application/json

{
  "id": "student-id-or-email",
  "password": "same-as-website",
  "device_id": "optional-existing-token",
  "platform": "android"
}
```

**Success**

```json
{
  "ok": true,
  "token": "hex-device-id",
  "user": {
    "id": "12",
    "name": "…",
    "email": "…",
    "studentId": "…",
    "elo": 1200,
    "streak": 3
  }
}
```

**Current session**

```http
GET /api/lockdown/current
Authorization: Bearer <token>
```

```json
{
  "active": true,
  "session_id": 44,
  "subject": "Mathematics",
  "end_time": "2026-08-23 16:00:00",
  "remaining_seconds": 1200,
  "server_time": "2026-08-23 15:40:00"
}
```

When `active` is true, the phone seals.

**Violation**

```http
POST /api/lockdown/event
Authorization: Bearer <token>
Content-Type: application/json

{
  "session_id": 44,
  "event_type": "block_attempt",
  "app_name": "TikTok",
  "device_platform": "android"
}
```

`event_type` must be one of: `block_attempt`, `force_quit`, `tamper_detected`.

---

## 5. Phone app — files that must stay

Do not replace these with demo/fake versions.

| File | Must do |
| --- | --- |
| `src/services/api.ts` | Call the TEACHING paths above. No demo user. |
| `src/store/AppState.tsx` | `login()` hits `/api/lockdown/login`. Poll `/api/lockdown/current` every 4s. |
| `src/config.ts` | Saves API URL + token. |
| `app/auth.tsx` | Three fields only: website URL, student ID/email, password. **No demo button.** |

Phone default block list (`src/data/seed.ts`) is the real shield list, not a demo account.

---

## 6. Environment

On Render, TEACHING service:

```
TZ=Africa/Harare
```

Without this, study hours run on UTC and the phone locks at the wrong time.

---

## 7. If another chat rewrites TEACHING

After any rewrite, check all three:

1. File `teaching_mobile.py` still sits next to `app.py`
2. `app.py` still has the two lines in section 2
3. `GET /api/lockdown/current` still exists

Then:

```
git add app.py teaching_mobile.py
git commit -m "Keep BT LOCKDOWN link"
git push
```

Wait for Render **Live**. Do **not** commit the phone folders (`app/`, `src/`, `package.json`) into the TEACHING repo.

---

## 8. Phone build (after website is live)

From the **phone** folder only:

```
cd "C:\Users\BT_ COMPANY\Desktop\teaching\workplace\bt-lockdown"
eas build --platform android --profile preview
```

On the Redmi:

- **BT LEARNING URL** = `https://YOUR-TEACHING.onrender.com`
- same student ID/email + password as the website

---

## 9. Phone ↔ website contract (v2 — do not overwrite this)

### Time rule
Every server time the phone receives is **explicit UTC with a `Z` suffix**
(e.g. `2026-08-23T16:00:00Z`). Timetable block times are local wall-clock
(TZ=Africa/Harare on Render) converted to UTC by `teaching_mobile.py`.
The phone parses naive strings as UTC too — never as device-local.
(Before this rule, a Harare device saw a 2-hour "clock drift" and collected
fake clock-manipulation penalties.)

### Endpoints used by the phone
| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/lockdown/sync` | **primary 4s poll**: current session + timetable + user in one round-trip |
| GET | `/api/lockdown/current` | fallback (old shape) if `/sync` returns 404 |
| GET | `/api/lockdown/me` | profile + real stats + violations + bound device |
| GET | `/api/lockdown/schedule` | timetable only |
| POST | `/api/lockdown/heartbeat` | `client_time` = TRUE device UTC time (server drift check, 120s) |
| POST | `/api/lockdown/event` | `block_attempt` / `force_quit` / `tamper_detected` |
| POST | `/api/lockdown/complete` | `violations` = real count for the session |
| POST | `/api/lockdown/logout` | unbind this device |

### Device binding
One device per student. `device_bindings.last_heartbeat` refreshed on
heartbeat + login; a binding idle **14+ days** gets `401 device_expired`
(login route stays open so the device can re-pair). Login is rate limited
(8 attempts / 15 min per id+ip → `429 too_many_attempts`).

### Phone-side enforcement (Android only in this build)
- `modules/bt-lockdown-native` — accessibility service intercepts blocked
  app launches (HOME + full-screen overlay barrier), `LockdownOverlayService`
  is the foreground watchdog: polls `/current` every 5s, heartbeats every
  20s, cleans itself up at session end even if the app is killed.
- JS (`AppState.tsx`) keeps the 4s `/sync` loop, offline outbox for
  violations/completion, and session-start local notifications.
- iOS: sync works, enforcement is intentionally reported as unavailable.

### Penalty numbers (client preview mirrors the server)
blocked app: 1st = warning, 2nd = -10, 3rd+ = -25 + streak ·
force quit / emergency unlock: -25 + streak ·
permission revoked / clock tamper: -50 + streak.

---

## 10. Network shield + seal health (do not overwrite)

Added 2026-09-04. Full design in `NETWORK_SHIELD.md`. If another chat "simplifies"
the native module, these are the pieces that must stay, and the rules they exist
for.

**Files that must stay** (`modules/bt-lockdown-native/android/src/main/java/com/btsoftware/lockdown/`):

| File | Job — deleting it silently removes a protection layer |
| --- | --- |
| `LockdownVpnService.kt` | blackhole `VpnService` tunnel (kernel-enforced Internet block) |
| `NetworkProtectionManager.kt` | modes + consent + verify/repair/report + all Device Owner calls |
| `AccessibilityHealth.kt` | sub-second seal-loss detection, kill-cause classification, DO accessibility allowlist |
| `WatchdogAlarmReceiver.kt` | 15-min idle-allowed keep-alive tick |
| `plugins/withBTLockdown.js` | must keep declaring the VpnService with `android:permission="android.permission.BIND_VPN_SERVICE"` + the `android.net.VpnService` action, or `establish()` returns null forever |
| `src/services/protection.ts` | the only place the verified state becomes words; unit-tested |

**Rules:**

1. Never report a stronger state than the device verified. `STATE_ACTIVE` (and the
   `Full Protection` label) requires tunnel up **and** a `TRANSPORT_VPN` network in
   `ConnectivityManager` **and** our own network excluded **and** a server
   round-trip inside 150 s. Do not "fix" a red notification by relaxing this.
2. Do not add accessibility auto-rebind, `WRITE_SECURE_SETTINGS` writes, or any
   loop that fights the system VPN/Accessibility UI. It is impossible from an app
   and it is what Play's Accessibility API and platform-security policies exist to
   stop. The supported equivalents are: sub-second detection → hard seal → network
   block, and Device Owner `setAlwaysOnVpnPackage(..., lockdown = true, ...)`.
3. Every release path (`expired`, `serverInactive`, `unauthorized`, `deactivate`,
   sign-out, the 8 h ceiling) must keep calling `NetworkProtectionManager.release()`
   — that call is what stops the app from stranding a phone without Internet.
4. BT LOCKDOWN's own package must stay excluded from the tunnel
   (`addDisallowedApplication`, or the lockdown allowlist on API 29+), otherwise the
   4 s `/sync`, the heartbeat and the violation outbox die with the student's apps
   and the teacher can no longer release the session remotely.
5. `network_shield_off` is a client-side violation type that maps to the existing
   server `event_type: "tamper_detected"`. Do not invent new `/api/lockdown/*`
   routes or new `event_type` values — the server rejects unknown types and the
   event is dropped.
