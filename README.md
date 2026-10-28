# Lough Ree Farm app

A phone app for the farm: today's rota, jobs with owners and due dates, the yearly plan,
who owns what, and the weekly meeting. It installs to the home screen, works with no signal,
and syncs when the phone is back online.

- **No build step.** The `public/` folder is the whole app: plain HTML, CSS and JavaScript,
  loading Firebase's official browser modules from Google's CDN.
- **Firebase** does the rest: Hosting serves the app, Firestore holds the data,
  Authentication handles sign-in.
- **Free** on Firebase's Spark plan at this size.

---

## What's in the folder

| Path | What it is |
|---|---|
| `public/index.html` | The page, header and tab bar |
| `public/app.js` | All the screens and logic |
| `public/firebase.js` | Firebase imports (SDK version set here) |
| `public/config.js` | **Your project's web config. You fill this in.** |
| `public/style.css` | Design, light and dark |
| `public/sw.js` | Service worker: lets the app open with no signal |
| `public/manifest.webmanifest`, `public/icons/` | Home-screen name and icons |
| `firestore.rules` | Who can read and change what |
| `seed/farm-data.json` | Your current farm data, ready to import |
| `.github/workflows/deploy.yml` | Optional auto-deploy from GitHub |

---

## Setup (about an hour, once)

### 1. Install the tools on your laptop

- Node.js 20 or newer
- The Firebase CLI: `npm install -g firebase-tools`, then `firebase login`

### 2. Create the Firebase project

1. Go to <https://console.firebase.google.com> and click **Create a project**.
2. Pick a project ID, e.g. `loughree-farm`. Your app's address will be `https://<project-id>.web.app`.
3. You can turn Google Analytics off. The app doesn't use it.

### 3. Create the database

1. **Build › Firestore Database › Create database.**
2. Location: **europe-west1 (Belgium)** or the **eur3** multi-region. This can't be changed later.
3. Start in **production mode**. The rules in this folder replace the default ones in step 6.

### 4. Register the web app and fill in `public/config.js`

1. **Project settings** (gear icon) › **General** › **Your apps** › the **Web** icon (`</>`).
2. Give it a name ("Farm app"). Don't tick Firebase Hosting here; the CLI handles it.
3. Copy the values from the `firebaseConfig` it shows into `public/config.js`.
4. **Change `authDomain`** to `<project-id>.web.app` (not `...firebaseapp.com`).
   Google sign-in inside the installed iPhone app relies on this.

Also put your project ID in `.firebaserc` (and in `.github/workflows/deploy.yml` if you'll use step 11).

### 5. Turn on sign-in

1. **Build › Authentication › Get started.**
2. **Sign-in method** tab:
   - Enable **Google**. Pick your email as the support email.
   - Enable **Email/Password**. Leave "Email link (passwordless sign-in)" **off**. iPhone home-screen
     apps keep their storage separate from Safari, so a link tapped in an email would sign
     someone in to Safari, not to the installed app.
3. **Settings › Authorised domains**: check that `<project-id>.web.app` is listed. Add your own domain
   here too if you set one up later.
4. Because `authDomain` is now the `.web.app` address, allow it in Google's sign-in settings:
   - Open <https://console.cloud.google.com/apis/credentials> with the same project selected.
   - Under **OAuth 2.0 Client IDs**, open **Web client (auto created by Google Service)**.
   - Under **Authorised redirect URIs**, add `https://<project-id>.web.app/__/auth/handler` and save.
     It can take a few minutes to start working.

### 6. Deploy the app and the security rules

From this folder:

```bash
firebase deploy
```

This publishes `public/` to `https://<project-id>.web.app` and uploads `firestore.rules`.

### 7. Make yourself the first admin

The app only lets in people listed in a `members` collection, and only admins can add people.
So the very first admin is added by hand:

1. **Firestore Database › Data › Start collection.** Collection ID: `members`.
2. **Document ID:** your email address in **lower case**, exactly as you'll sign in with it.
3. Add two fields, both type **string**:
   - `person` = `David` (your name as it appears on the rota)
   - `role` = `admin`
4. Save.

### 8. Sign in and import your data

1. On your laptop, open `https://<project-id>.web.app` and **Continue with Google** with that email.
2. Tap your ear tag (top right) › **Import farm data from a file** › choose `seed/farm-data.json`.
3. You should see 14 records imported: 9 people, 1 job, last week's rota, Sunday's meeting,
   the year plan and who owns what.

### 9. Add the family

Tap your ear tag › **Who can use the app** › **Add someone**:

- Their **email address** (the Google account they'll use, or the email they'll create an account with)
- **Which person on the farm** they are, so the app shows their own jobs and duties
- **Access**: *Member* (jobs, rota, meetings) or *Admin* (also people, year plan, access)

If someone isn't in the people list yet (e.g. Dad), add them first with the team button (top bar).

Then send them the link. They sign in with Google, or tap **Create account** and confirm their
email. Anyone who signs in before being added sees a "Not on the list yet" screen that opens the
app by itself once they're added.

### 10. Install on phones

The app shows a "Put the farm on your home screen" banner with the right steps for each phone.

- **iPhone:** open the link in **Safari** › Share › **Add to Home Screen**, then open the
  **Farm** icon and sign in there. Signing in inside Safari doesn't carry over to the icon.
- **Android:** open in **Chrome** › **Install app** (or menu › Add to Home screen).

Each phone needs signal the first time it opens the app. After that it works offline.

### 11. Optional: deploy automatically from GitHub

1. Put this folder in a GitHub repository.
2. Run `firebase init hosting:github` and follow the prompts. It creates a deploy key
   and adds it to the repo as a secret.
3. Check the secret name it created and use it in `.github/workflows/deploy.yml`
   (`secrets.FIREBASE_SERVICE_ACCOUNT` by default). If the CLI wrote its own workflow
   files, you can keep those instead and delete this one.

Every push to `main` then publishes the app. **Security rules still deploy by hand:**
`firebase deploy --only firestore:rules`.

---

## Check the security rules (5 minutes)

**Firestore › Rules › Rules Playground** lets you try requests against the live rules.
Set **Authentication** to "Authenticated", provider `google.com`, and edit the token JSON
to include `"email": "<address>"` and `"email_verified": true`. Then check:

| Request | Signed in as | Expect |
|---|---|---|
| `get /members/<your email>` | you | Allowed |
| `get /jobs/salmonella-vacs` | an email not in `members` | **Denied** |
| `get /jobs/salmonella-vacs` | a member | Allowed |
| `create /people/test` with `{"name":"X","kind":"team"}` | a member (not admin) | **Denied** |
| `delete /members/<your email>` | you (admin) | **Denied** (can't lock yourself out) |
| any request | not signed in | **Denied** |

Writes in the playground fail the `updatedBy` / `updatedAt` checks unless you include them,
which is expected. The app always adds them.

---

## Day-to-day

- **Backups:** an admin can tap their ear tag › **Download a full backup** (JSON). Import the
  same file to restore. **Download jobs as a spreadsheet** gives a CSV that opens in Excel or
  Google Sheets.
- **Who changed what:** each job, meeting, rota week and the year plan records who last
  changed it and when. It shows at the bottom of the edit screen.
- **Someone leaves or loses their phone:** remove them under **Who can use the app**.
  They're locked out immediately.
- **Two people change the same thing offline:** the last change to reach the server wins.

## Changing the app

Edit the files in `public/` and run `firebase deploy --only hosting` (or push to GitHub).
Installed apps pick up the new version the next time they're opened with signal.

To upgrade Firebase, change the version number in the three URLs in `public/firebase.js`
and `FIREBASE_VERSION` in `public/sw.js`, then deploy.

## Data model

| Path | Contents | Who can change it |
|---|---|---|
| `members/{email}` | `person`, `role` (`admin` or `member`) | Admins |
| `people/{id}` | `name`, `role`, `phone`, `days`, `kind` (`team` / `contact`), `order` | Admins |
| `jobs/{id}` | `title`, `area`, `owner`, `due`, `priority`, `status`, `notes`, `doneOn`, `createdAt` | Members |
| `rota/{YYYY-MM-DD}` | `weekStart` (a Monday), `duties`: list of `{duty, notes, days[7]}` | Members (delete: admins) |
| `meetings/{id}` | `date`, `owner`, `done`, `next`, `decisions`, `followUp` | Members (delete: admins) |
| `config/calendar` | `items`: list of `{task, area, owner, months[], notes}` | Admins |
| `config/roles` | `areas`: list of `{area, owner, backup, decides, meeting, notes}` | Admins |

Every document written by the app also carries `updatedBy` (email) and `updatedAt` (server time).

## Troubleshooting

| You see | Fix |
|---|---|
| "Almost there… isn't connected to Firebase yet" | `public/config.js` still has placeholder values (step 4). |
| "This web address isn't allowed to sign in yet" | Add the address under Authentication › Settings › Authorised domains (step 5.3). |
| Google sign-in on iPhone goes round in a loop | Check `authDomain` is `<project-id>.web.app` (step 4) and the redirect URI is saved (step 5.4). |
| "Not on the list yet" for someone you added | The `members` document ID must be their email in lower case, exactly matching the account they signed in with. |
| A change says "wasn't saved: you don't have permission" | That person is a Member trying an admin-only change, or the rules haven't been deployed (step 6). |
| Header says "changes waiting to sync" for a long time | The phone has no signal. The changes send automatically when it's back. |

## Costs

On the free Spark plan, Firestore includes 1 GiB of storage and 50,000 reads, 20,000 writes and
20,000 deletes a day; Hosting includes 10 GB of storage and 360 MB of transfer a day. A handful
of people using this every day stays far below that. If a free limit were ever reached,
Firebase pauses that service until the next month rather than charging.
Check current figures at <https://firebase.google.com/pricing>.

## Phase 2 ideas (need the pay-as-you-go Blaze plan for Cloud Functions)

- Morning push notification: "You're on PM milking today", "2 jobs overdue"
- Sunday-evening reminder to set next week's rota
- Nightly copy into the Farm Planner Google Sheet for reporting
- Scheduled Firestore backups
