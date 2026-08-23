# Start again from this ZIP + GitHub

This package is the **live** BT LOCKDOWN phone app.
No demo student. No pairing code. Sign in = real TEACHING account.

---

## A. Unzip

1. Unzip `BT-LOCKDOWN-DEPLOY.zip` onto the Desktop.
2. You get a folder `BT-LOCKDOWN-DEPLOY`.

---

## B. Put the phone app on GitHub

1. Open https://github.com/new
2. Name: `BT-LOCKDOWN`
3. Public. Do **not** add a README.
4. Create repository.

PowerShell (use quotes):

```
cd "C:\Users\BT_ COMPANY\Desktop\BT-LOCKDOWN-DEPLOY"
git init
git add .
git commit -m "BT LOCKDOWN live"
git branch -M main
git remote add origin https://github.com/bykimwonn/BT-LOCKDOWN.git
git push -u origin main
```

---

## C. Keep the website linked (TEACHING)

The phone talks to https://github.com/bykimwonn/-TEACHING

This ZIP includes `website/teaching_mobile.py`.

That file must sit **next to** `app.py` in TEACHING-REPO.

`app.py` must contain these two lines:

```
from teaching_mobile import install_mobile_lockdown
```

```
install_mobile_lockdown(app)
```

If another chat deleted them, copy `website/teaching_mobile.py` into TEACHING-REPO and put the two lines back, then:

```
cd "C:\Users\BT_ COMPANY\Desktop\TEACHING-REPO"
git add app.py teaching_mobile.py
git commit -m "Keep phone login"
git push
```

Wait for Render **Live**.

---

## D. Build the APK from Git

```
cd "C:\Users\BT_ COMPANY\Desktop\BT-LOCKDOWN-DEPLOY"
npm install
npm install -g eas-cli
eas login
eas init
eas build --platform android --profile preview
```

Or connect the `BT-LOCKDOWN` GitHub repo on https://expo.dev (project bt-lockdown → GitHub) and build from there.

---

## E. Sign in on the phone

- BT LEARNING URL = your TEACHING Render URL (`https://….onrender.com`)
- Student ID or email + password from the **website**

No demo button.
