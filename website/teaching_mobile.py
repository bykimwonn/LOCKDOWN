"""
BT LOCKDOWN mobile auth for the TEACHING repo.

Copy this file next to app.py in https://github.com/bykimwonn/-TEACHING
then add two lines to app.py (see INSTALL.md).

What it adds, on top of the lockdown routes already in TEACHING:
  POST /api/lockdown/login      JSON login → device token
  GET  /api/lockdown/me         profile + penalties
  GET  /api/lockdown/schedule   weekly timetable as sessions
  Bearer <device_id>            works on every existing /api/lockdown/* route
  CORS                          so the phone can call the API
"""
import datetime
import secrets

from flask import jsonify, request, session
from werkzeug.security import check_password_hash

import db
import ai_engine as ai


def _now():
    return datetime.datetime.now()


def _public_user(u):
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
        "sessionsCompleted": 0,
        "minutesLocked": 0,
    }


def _schedule_sessions(u):
    now = _now()
    wd = now.weekday()
    blocks = db.get_schedule(u["id"]) or []
    out = []
    if blocks:
        for b in blocks:
            offset = (int(b["day"]) - wd) % 7
            day = now + datetime.timedelta(days=offset)
            start = day.replace(hour=int(b["start_hour"]), minute=0, second=0, microsecond=0)
            end = day.replace(hour=int(b["end_hour"]), minute=0, second=0, microsecond=0)
            status = "scheduled"
            if offset == 0:
                if b["start_hour"] <= now.hour < b["end_hour"]:
                    status = "active"
                elif now.hour >= b["end_hour"]:
                    status = "completed"
            out.append({
                "id": f"blk_{u['id']}_{b['day']}_{b['start_hour']}_{b.get('subject') or 'focus'}",
                "title": f"Deep Work · {b.get('subject') or 'Study'}",
                "subject": b.get("subject") or "Study",
                "startsAt": start.isoformat(),
                "endsAt": end.isoformat(),
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
        "startsAt": start.isoformat(),
        "endsAt": end.isoformat(),
        "status": status,
        "source": "timetable",
        "focusNote": "Daily study hours from BT LEARNING",
    }]


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
            "SELECT user_id FROM device_bindings WHERE device_id=:d",
            {"d": device_id},
        )
        if row:
            session["uid"] = row["user_id"]

    @app.after_request
    def _lockdown_cors(res):
        if request.path.startswith("/api/lockdown"):
            res.headers["Access-Control-Allow-Origin"] = "*"
            res.headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type"
            res.headers["Access-Control-Allow-Methods"] = "GET,POST,OPTIONS"
        return res

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
            return jsonify({"error": "id_and_password_required"}), 400

        u = db.user_by_email(ident.lower()) if "@" in ident else None
        if not u:
            u = db.user_by_student_id(ident)
        if not u or u["role"] not in ("school_student", "independent"):
            return jsonify({"error": "invalid_credentials"}), 401
        if not check_password_hash(u["password_hash"], pw):
            return jsonify({"error": "invalid_credentials"}), 401

        session["uid"] = u["id"]
        db.register_device(u["id"], device_id, platform)
        return jsonify({
            "ok": True,
            "token": device_id,
            "user": _public_user(u),
            "serverNow": _now().isoformat(),
        })

    @app.route("/api/lockdown/me", methods=["GET", "OPTIONS"])
    def api_lockdown_me():
        if request.method == "OPTIONS":
            return ("", 204)
        from flask import abort
        u = db.get_user(session["uid"]) if session.get("uid") else None
        if not u:
            return jsonify({"error": "unauthorized"}), 401
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
            "serverNow": _now().isoformat(),
        })

    @app.route("/api/lockdown/schedule", methods=["GET", "OPTIONS"])
    def api_lockdown_schedule():
        if request.method == "OPTIONS":
            return ("", 204)
        u = db.get_user(session["uid"]) if session.get("uid") else None
        if not u:
            return jsonify({"error": "unauthorized"}), 401
        return jsonify({
            "ok": True,
            "sessions": _schedule_sessions(u),
            "serverNow": _now().isoformat(),
        })

    return app
