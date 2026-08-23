"""
BT LOCKDOWN mobile auth for the TEACHING repo.

Copy this file next to app.py in https://github.com/bykimwonn/-TEACHING
then add two lines to app.py (see INSTALL.md / DO_NOT_OVERWRITE.md).

What it adds, on top of the lockdown routes already in TEACHING:
  POST /api/lockdown/login      JSON login -> device token (rate limited)
  GET  /api/lockdown/me         profile + real stats + violations + bound device
  GET  /api/lockdown/schedule   weekly timetable as sessions (UTC ISO times)
  GET  /api/lockdown/sync       one round-trip: current session + timetable + user
  POST /api/lockdown/logout     unbind this device
  Bearer <device_id>            works on every existing /api/lockdown/* route
  Device expiry                 token inactive > 14 days -> 401 device_expired
  CORS                          so the phone can call the API

Time rule: every server time emitted to the phone is explicit UTC ISO-8601
with a "Z" suffix. The phone parses naive strings as UTC too, but explicit
is safer. Timetable block times are local wall-clock (TZ=Africa/Harare must
be set on Render) and are converted to UTC here.
"""
import datetime
import secrets
import time

from flask import jsonify, request, session
from werkzeug.security import check_password_hash

import db
import ai_engine as ai

# ---------------------------------------------------------------------------
# Time helpers
# ---------------------------------------------------------------------------

def _utcnow():
    return datetime.datetime.now(datetime.timezone.utc)


def _iso_utc(dt):
    """Explicit UTC ISO-8601 with Z suffix (what the phone expects)."""
    if dt.tzinfo is None:
        # naive: assume server-local wall-clock (TZ must be set on Render)
        dt = dt.replace(tzinfo=_local_tz())
    return dt.astimezone(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _local_tz():
    # System local tz (Africa/Harare on Render via TZ env var)
    return datetime.datetime.now().astimezone().tzinfo


def _parse_dt(value):
    """Parse server-stored naive-UTC datetime strings."""
    try:
        return datetime.datetime.fromisoformat(str(value)[:19])
    except (TypeError, ValueError):
        return None


# ---------------------------------------------------------------------------
# Login rate limiting (in-memory; fine for a single-service deployment)
# ---------------------------------------------------------------------------

_LOGIN_WINDOW_S = 15 * 60
_LOGIN_MAX_ATTEMPTS = 8
_login_attempts = {}  # key -> list of attempt timestamps


def _login_allowed(key):
    now = time.time()
    stamps = [t for t in _login_attempts.get(key, []) if now - t < _LOGIN_WINDOW_S]
    _login_attempts[key] = stamps
    if len(stamps) >= _LOGIN_MAX_ATTEMPTS:
        return False
    stamps.append(now)
    _login_attempts[key] = stamps
    return True


# ---------------------------------------------------------------------------
# Public user shape (real stats, not zeros)
# ---------------------------------------------------------------------------

def _user_stats(u):
    rows = db._fetch(
        "SELECT start_time, end_time FROM lockdown_sessions "
        "WHERE user_id=:u AND status='completed'",
        {"u": u["id"]},
    )
    completed = len(rows)
    minutes = 0
    for r in rows:
        s, e = _parse_dt(r["start_time"]), _parse_dt(r["end_time"])
        if s and e and e > s:
            minutes += max(0, int((e - s).total_seconds() // 60))
    return completed, minutes


def _public_user(u):
    completed, minutes = _user_stats(u)
    return {
        "id": str(u["id"]),
        "name": u["name"],
        "email": u.get("email") or "",
        "studentId": u.get("student_id") or "",
        "handle": "@" + (u["name"] or "student").split()[0].lower(),
        "role": u["role"],
        "elo": int(u["elo"] or 1200),
        "streak": int(u["streak"] or 0),
        "longestStreak": int(u["streak"] or 0),
        "sessionsCompleted": completed,
        "minutesLocked": minutes,
    }


def _current_binding(u):
    row = db.get_device_binding(u["id"])
    if not row:
        return None
    return {
        "device_id": row.get("device_id"),
        "platform": row.get("platform"),
        "registered_at": str(row.get("registered_at") or ""),
        "last_heartbeat": str(row.get("last_heartbeat") or ""),
    }


# ---------------------------------------------------------------------------
# Timetable -> sessions
# ---------------------------------------------------------------------------

def _schedule_sessions(u):
    now = _utcnow()
    wd = now.weekday()
    blocks = db.get_schedule(u["id"]) or []
    out = []
    if blocks:
        for b in blocks:
            offset = (int(b["day"]) - wd) % 7
            day = now + datetime.timedelta(days=offset)
            start = day.replace(hour=int(b["start_hour"]), minute=0, second=0, microsecond=0)
            end = day.replace(hour=int(b["end_hour"]), minute=0, second=0, microsecond=0)
            # block times are local wall-clock; convert to explicit UTC
            start = start.astimezone(datetime.timezone.utc)
            end = end.astimezone(datetime.timezone.utc)
            status = "scheduled"
            if offset == 0:
                if start <= now < end:
                    status = "active"
                elif now >= end:
                    status = "completed"
            out.append({
                "id": f"blk_{u['id']}_{b['day']}_{b['start_hour']}_{b.get('subject') or 'focus'}",
                "title": f"Deep Work · {b.get('subject') or 'Study'}",
                "subject": b.get("subject") or "Study",
                "startsAt": _iso_utc(start),
                "endsAt": _iso_utc(end),
                "status": status,
                "source": "timetable",
                "focusNote": "From your BT LEARNING AI timetable",
            })
        return out
    sh, eh = int(u.get("study_start_hour") or 0), int(u.get("study_end_hour") or 23)
    start = now.replace(hour=sh, minute=0, second=0, microsecond=0)
    end = now.replace(hour=eh, minute=0, second=0, microsecond=0)
    status = "active" if ai.is_study_time(now.hour, sh, eh) else (
        "completed" if sh <= eh and now.hour >= eh else "scheduled"
    )
    return [{
        "id": f"win_{u['id']}_{now.date()}",
        "title": "Study window",
        "subject": "Study",
        "startsAt": _iso_utc(start),
        "endsAt": _iso_utc(end),
        "status": status,
        "source": "study_window",
        "focusNote": "Daily study hours from BT LEARNING",
    }]


def _current_session(u):
    """Mirror of app.py /api/lockdown/current but explicit UTC times."""
    now_server = _utcnow()
    active = db.get_active_lockdown(u["id"])
    if not active:
        return {
            "active": False,
            "server_time": _iso_utc(now_server),
        }
    end_dt = _parse_dt(active["end_time"])  # stored naive UTC
    remaining = max(0, int((end_dt - now_server.replace(tzinfo=None)).total_seconds())) if end_dt else 0
    return {
        "active": True,
        "server_time": _iso_utc(now_server),
        "end_time": _iso_utc(end_dt.replace(tzinfo=datetime.timezone.utc)) if end_dt else None,
        "remaining_seconds": remaining,
        "subject": active.get("subject", ""),
        "session_id": active["id"],
        "session_type": active.get("session_type", "deep_work"),
    }


# ---------------------------------------------------------------------------
# Install
# ---------------------------------------------------------------------------

def install_mobile_lockdown(app):
    """Call once from app.py after `app = Flask(...)`."""

    @app.before_request
    def _lockdown_bearer():
        if not request.path.startswith("/api/lockdown/"):
            return
        if session.get("uid"):
            return
        header = request.headers.get("Authorization") or ""
        if not header.lower().startswith("bearer "):
            return
        device_id = header[7:].strip()
        if not device_id:
            return
        row = db._fetch_one(
            "SELECT user_id, last_heartbeat FROM device_bindings WHERE device_id=:d",
            {"d": device_id},
        )
        if not row:
            return
        # Inactivity expiry: a device silent for 14+ days must re-login.
        # (Login route is exempt below so a stale device can still pair again.)
        if not request.path.rstrip("/").endswith("/login"):
            hb = _parse_dt(row.get("last_heartbeat"))
            if hb is not None:
                age_s = (_utcnow().replace(tzinfo=None) - hb).total_seconds()
                if age_s > 14 * 24 * 3600:
                    return jsonify({"ok": False, "error": "device_expired",
                                    "message": "This device has been inactive for 14 days. Sign in again."}), 401
                # Keep the binding alive without a per-request write:
                # refresh only when the stored heartbeat is an hour old.
                if age_s > 3600:
                    db.update_heartbeat(row["user_id"])
        session["uid"] = row["user_id"]

    @app.after_request
    def _lockdown_cors(res):
        if request.path.startswith("/api/lockdown"):
            res.headers["Access-Control-Allow-Origin"] = "*"
            res.headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type"
            res.headers["Access-Control-Allow-Methods"] = "GET,POST,OPTIONS"
        return res

    def _authed_user():
        """Return the user for the current request, or a (payload, 401) tuple."""
        uid = session.get("uid")
        if not uid:
            return None, (jsonify({"ok": False, "error": "unauthorized"}), 401)
        u = db.get_user(uid)
        if not u:
            return None, (jsonify({"ok": False, "error": "unauthorized"}), 401)
        return u, None

    @app.route("/api/lockdown/login", methods=["POST", "OPTIONS"])
    def api_lockdown_login():
        if request.method == "OPTIONS":
            return ("", 204)
        data = request.get_json(silent=True) or {}
        ident = (data.get("id") or data.get("email") or data.get("student_id") or "").strip()
        pw = data.get("password") or ""
        device_id = (data.get("device_id") or "").strip() or secrets.token_hex(16)
        platform = (data.get("platform") or "android").strip().lower()
        if platform not in ("android", "ios", "web"):
            platform = "android"
        if not ident or not pw:
            return jsonify({"ok": False, "error": "id_and_password_required"}), 400

        rate_key = f"{ident.lower()}|{request.remote_addr or 'x'}"
        if not _login_allowed(rate_key):
            return jsonify({"ok": False, "error": "too_many_attempts",
                            "message": "Too many failed sign-ins. Try again in a few minutes."}), 429

        u = db.user_by_email(ident.lower()) if "@" in ident else None
        if not u:
            u = db.user_by_student_id(ident)
        if not u or u["role"] not in ("school_student", "independent"):
            return jsonify({"ok": False, "error": "invalid_credentials"}), 401
        if not check_password_hash(u["password_hash"], pw):
            return jsonify({"ok": False, "error": "invalid_credentials"}), 401

        session["uid"] = u["id"]
        db.register_device(u["id"], device_id, platform)
        return jsonify({
            "ok": True,
            "token": device_id,
            "user": _public_user(u),
            "serverNow": _iso_utc(_utcnow()),
        })

    @app.route("/api/lockdown/me", methods=["GET", "OPTIONS"])
    def api_lockdown_me():
        if request.method == "OPTIONS":
            return ("", 204)
        u, err = _authed_user()
        if err:
            return err
        # Apply pending penalties now so the phone sees fresh ELO immediately.
        try:
            from app import process_lockdown_penalties
            process_lockdown_penalties(u["id"])
            u = db.get_user(u["id"])
        except Exception:
            pass
        history = db.lockdown_history(u["id"], limit=40)
        penalties = db.unprocessed_penalties(u["id"])
        violations = []
        for p in penalties:
            violations.append({
                "id": str(p["id"]),
                "type": p.get("penalty_type") or "blocked_app",
                "at": str(p.get("created_at") or p.get("server_time") or ""),
                "sessionId": str(p.get("session_id") or ""),
                "eloDelta": int(p.get("elo_deduction") or 0),
                "streakBroken": bool(p.get("streak_broken")),
                "detail": p.get("reason") or "",
            })
        for h in history:
            if h.get("violations"):
                violations.append({
                    "id": f"ses_{h['id']}",
                    "type": "blocked_app",
                    "at": str(h.get("completed_at") or h.get("start_time") or ""),
                    "sessionId": str(h["id"]),
                    "eloDelta": 0,
                    "streakBroken": h.get("status") == "violated",
                    "detail": f"Session {h.get('status')} · {h.get('violations')} event(s)",
                })
        return jsonify({
            "ok": True,
            "user": _public_user(u),
            "violations": violations,
            "history": history,
            "device": _current_binding(u),
            "serverNow": _iso_utc(_utcnow()),
        })

    @app.route("/api/lockdown/schedule", methods=["GET", "OPTIONS"])
    def api_lockdown_schedule():
        if request.method == "OPTIONS":
            return ("", 204)
        u, err = _authed_user()
        if err:
            return err
        return jsonify({
            "ok": True,
            "sessions": _schedule_sessions(u),
            "serverNow": _iso_utc(_utcnow()),
        })

    @app.route("/api/lockdown/sync", methods=["GET", "OPTIONS"])
    def api_lockdown_sync():
        """One round-trip for the phone's 4s poll: current session + timetable + user."""
        if request.method == "OPTIONS":
            return ("", 204)
        u, err = _authed_user()
        if err:
            return err
        try:
            from app import process_lockdown_penalties
            process_lockdown_penalties(u["id"])
            u = db.get_user(u["id"])
        except Exception:
            pass
        return jsonify({
            "ok": True,
            **_current_session(u),
            "sessions": _schedule_sessions(u),
            "user": _public_user(u),
            "serverNow": _iso_utc(_utcnow()),
        })

    @app.route("/api/lockdown/logout", methods=["POST", "OPTIONS"])
    def api_lockdown_logout():
        if request.method == "OPTIONS":
            return ("", 204)
        u, err = _authed_user()
        if err:
            return err
        db._execute("DELETE FROM device_bindings WHERE user_id=:u", {"u": u["id"]})
        return jsonify({"ok": True})

    return app
