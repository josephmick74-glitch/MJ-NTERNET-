# MJ Internet

Customers order **Halotel internet bundles** (GB 5 – GB 40), pay by Mix by Yas, and enter the payment
transaction ID. The owner gets an email for each order and marks it Completed or Rejected in the admin panel.
English and Kiswahili.

| Part | File | Runs on |
|---|---|---|
| Front end | `index.html` | GitHub Pages (`https://josephmick74-glitch.github.io/MJ-NTERNET-/`) |
| Back end | `backend/Code.gs` | Google Apps Script, attached to a Google Sheet |

The Google Sheet is the database: a **Users** tab (passwords are stored hashed, never in plain text)
and an **Orders** tab.

## Backend setup (one time)

Do this with the Google account that should send the emails (for example the shop's Gmail).

1. Create a new Google Sheet, for example "MJ Internet Data".
2. In the sheet: **Extensions → Apps Script**. Delete the sample code, paste all of `backend/Code.gs`, and save.
3. **Project Settings (⚙️) → Script properties → Add script property**:
   - `ADMIN_EMAILS` = the admin email(s), comma separated, e.g. `mjriganya@gmail.com`
   - `OWNER_EMAIL` (optional) = where new-order emails go. Default: the first admin email.
   - `LOGIN_OTP` (optional) = `on` to also email a code at **every** login. Default: off (a code is
     emailed only at sign-up and password reset). Turning it on uses one email per login; see the limits below.
4. Back in the editor, pick the function **`setup`** and press **Run**. Allow the permissions it asks for.
   This creates the Users and Orders tabs and a secret `PEPPER` script property.
   **Never change or delete `PEPPER`**: every existing password would stop working.
5. **Deploy → New deployment →** type **Web app**:
   - Execute as: **Me**
   - Who has access: **Anyone**
   Press **Deploy** and copy the **Web app URL** (it ends in `/exec`).
6. In `index.html`, set `API_URL` to that URL and commit.
7. Open the site and **Sign Up** with the admin email. After the code is confirmed you will see the Admin Panel.

### Changing the backend later

Paste the new code, save, then **Deploy → Manage deployments → ✏️ → Version: New version → Deploy**.
The URL stays the same, so `index.html` does not need to change.

## Installing on a phone

There is no App Store app. iPhones cannot install the Android APK, and a real App Store app needs a paid
Apple Developer account and Apple's review. Instead the portal is a web app that installs from the browser:

- **iPhone / iPad:** open the portal in **Safari**, tap **Share ⬆️ → Add to Home Screen**. It then opens
  full-screen with the MJ icon, like an app. The portal shows these steps to iPhone users automatically.
  Links opened inside Instagram/Facebook/TikTok must be opened in Safari first.
- **Android:** Chrome menu **⋮ → Add to Home screen / Install app** (or use the APK).

Files for this: `manifest.webmanifest` and `icons/`.

## Limits to know

- **Size:** built and tested for 5,000 users and 20,000+ orders. Customer actions (login, order, my orders)
  look up single rows with the sheet's own search, so they stay fast as the sheet grows. The admin panel
  loads 25 orders or users per page, with status filter and search.
- **Email is the real limit.** A normal Gmail account can send about **100 emails per day** from Apps Script;
  a Google Workspace account about **1,500**. Each sign-up, password reset and new-order notice uses one
  (and each login, if `LOGIN_OTP` is on). OTP emails stop when only 5 are left, so order notices still arrive;
  an order is saved even if its email fails, and always shows in the admin panel.
  With thousands of active customers, use a Google Workspace account for the script.
- A login lasts **7 days**. Logging out, or resetting the password, signs that user out on every device.
- After 5 wrong passwords an account is locked for 15 minutes. After 5 wrong codes the code is cancelled.
- Google allows about 30 requests to run at the same moment per script; more simply wait a moment.

## Moving from the old version

The old version kept accounts and orders only inside each visitor's browser, so they cannot be moved.
Customers sign up again once. The new page deletes the old browser data (it held plain-text passwords).
The old Google Sheet and Apps Script are not touched; keep them for your records.
