# Santa Soirée 2026 — Event Portal (Node.js + Firebase, no React)

Student sign-up, event registration, "For You" suggestions and an organizer admin panel.
All data is stored in **Firebase** (Authentication + Cloud Firestore), so every student's registration reaches you, on any device.

## Run it on your computer (Node.js)
Needs [Node.js](https://nodejs.org) 18 or newer. No `npm install` is required — the server has zero dependencies.
```bash
npm start          # → open http://localhost:3000
npm run dev        # same, restarts automatically when server.js changes
```
Admin panel: `http://localhost:3000/#/admin`

> Coming from the old React/Vite project? Delete these leftovers from that folder: `vite.config.js`, `eslint.config.js`, `package-lock.json`, `node_modules/`, `src/` and `public/` (if present), then use this `package.json`.

## Files
| File | What it is |
|---|---|
| `server.js`, `package.json` | Node.js server (`npm start`) |
| `index.html`, `style.css` | The website |
| `app.js` | All logic (accounts, registration, admin panel) |
| `firebase-config.js` | **You edit this:** your Firebase config + organizer email |
| `firestore.rules` | **You edit this:** security rules (organizer email again) |
| `firebase.json`, `.firebaserc`, `firestore.indexes.json` | Firebase Hosting / CLI settings |

---

## Step 1 — Set up Firebase (console.firebase.google.com)
1. **Open your project** (or *Add project* → name it → create).
2. **Register a web app:** ⚙️ *Project settings* → *General* → *Your apps* → click **`</>`** → give it a name → *Register app*. Copy the `firebaseConfig` values shown.
3. **Turn on sign-in:** *Build → Authentication* → *Get started* → *Sign-in method* →
   - enable **Email/Password** (students use this)
   - enable **Google** (easiest way for you, the organizer, to sign in)
4. **Create the database:** *Build → Firestore Database* → *Create database* → location **asia-south1 (Mumbai)** → start in **production mode**.

## Step 2 — Edit two files
1. **`firebase-config.js`** — paste your config values, and replace `your.admin.email@example.com` with **your** email (lowercase). Add more organizer emails if needed.
2. **`firestore.rules`** — in `adminEmails()`, put the **same** email(s).

## Step 3 — Publish the security rules
Firebase console → *Firestore Database* → **Rules** tab → delete what's there → paste the whole of `firestore.rules` → **Publish**.
*(If you use the Firebase CLI in Step 4 Option A, `firebase deploy` does this for you.)*

## Step 4 — Put the website online (choose one)

### Option A — Firebase Hosting (recommended)
On a laptop with [Node.js](https://nodejs.org) installed, open a terminal in this folder:
```bash
npm install -g firebase-tools
firebase login
firebase use --add          # pick your project, alias: default
firebase deploy
```
Your site is live at **`https://YOUR-PROJECT-ID.web.app`**. Run `firebase deploy` again after any change.

### Option B — Any Node.js host (Render, Railway, etc.)
Push this folder to GitHub, create a new **Web Service** on the host, set *Start command* to `npm start`. The server reads the `PORT` the host provides. Then add your site's domain under Firebase → *Authentication → Settings → Authorized domains*.

### Option C — GitHub Pages
1. Create a public repo and upload **all** files (`index.html`, `style.css`, `app.js`, `firebase-config.js`, …).
2. Repo *Settings → Pages* → *Deploy from a branch* → `main` / `(root)` → Save.
3. **Important:** Firebase console → *Authentication → Settings → Authorized domains* → *Add domain* → `YOUR-USERNAME.github.io`.
4. Live at `https://YOUR-USERNAME.github.io/REPO-NAME/`.

## Step 5 — First admin login (one time)
1. Open your live site → footer **🔐 Organizers** (or add `#/admin` to the URL).
2. Tap **Continue with Google** with your organizer Gmail.
   *(Or type your organizer email + a password → "Create organizer account" → open the verification email → "I've verified".)*
3. Tap **Initialize site**.
4. In **Settings**, enter your institutional email domain (e.g. `college.edu.in`) → *Save*.
5. Test it: on your phone, create a student account and register for an event. It appears instantly in the admin panel.

---

## What the admin panel does
| Tab | |
|---|---|
| Overview | Live totals, students per year, event fill rates |
| Registrations | Search, filter by event/year, delete, **export CSV** |
| Students | Department, year, interests; ⚠️ flags duplicate enrollment/roll numbers; send password reset; delete; **export CSV** |
| Events | Seats, team size, eligible years, open/close each event |
| Settings | Email domain rule, 1st-year personal email toggle, sign-ups on/off, registrations on/off, deadline, JSON backup |

## Rules built in (enforced by Firestore, not just the website)
- Only organizer emails (verified) can see student data or change settings.
- Students can only read/edit their own profile and registrations.
- 2nd–4th years must use the institutional email domain; 1st years may use personal email (if enabled).
- One registration per student per event; registration only when open, before the deadline, and if their year is eligible.

## Good to know
- **Free plan is enough** for a college fest (Firebase Spark plan).
- **Testing on your computer:** use `npm start`. Firebase sign-in needs the site to be opened from `http://localhost`, not by double-clicking `index.html`.
- **Authorized domains:** `localhost` is allowed by default; add every live domain (e.g. `yourname.github.io`, your Render URL) in *Authentication → Settings → Authorized domains*.
- **Deleting a student** in the admin panel removes their profile and registrations; their login remains in *Authentication → Users* (delete it there if needed).
- **Emails** (verification, password reset) come from Firebase and can land in spam. Customise them in *Authentication → Templates*.
- **Seat limits** are checked when registering; if two students grab the very last seat at the same instant, one extra may get through. Adjust seats in the Events tab if that happens.
- **Changing events** (names, times, descriptions, keywords): edit `BASE_EVENTS` at the top of `app.js`.
