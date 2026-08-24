# BT LOCKDOWN v2 — website changes (apply to -TEACHING)

The phone build on `arena/01a02fdb-lockdown` expects the website changes
in `bt-lockdown-mobile-v2.patch`. I (the Arena agent) had no push access
to `-TEACHING`, so apply it from your PC:

```
cd C:\Users\BT_ COMPANY\Desktop\teaching\workplace\-TEACHING
git am <path-to>\LOCKDOWN\FOR_TEACHING\bt-lockdown-mobile-v2.patch
git push
```

Then wait for Render **Live** — the phone works against the old server
too (it falls back from `/api/lockdown/sync` to `/current` + `/schedule`),
but the v2 fixes only count once this is deployed:

- all server times are explicit UTC `Z` (fixes the 2-hour "clock drift"
  penalties on Harare devices)
- one `/api/lockdown/sync` round-trip per 4s poll
- real `sessionsCompleted` / `minutesLocked` in `/me` + bound device
- `/api/lockdown/logout`, login rate limit, 14-day device expiry

`teaching_mobile.py` in this folder is the same file, if you prefer to
copy it over manually. `app.py` only changes the `/api/lockdown/current`
time format (7 lines).

After deploying, check the two contract lines are still there:

```
from teaching_mobile import install_mobile_lockdown
install_mobile_lockdown(app)
```
