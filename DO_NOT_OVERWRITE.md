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
