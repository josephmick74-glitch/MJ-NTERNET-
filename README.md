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

## Error codes

Every error the app shows carries a label such as **MJ-202**, so a customer can read it out to support.

| Code | Meaning | What the customer is told to do |
|---|---|---|
| MJ-101 | Email missing or not valid | Type an email like name@example.com |
| MJ-102 | Name missing or too long/short | Use 2 to 60 characters |
| MJ-103 | Password missing or under 8 characters | Use at least 8 characters |
| MJ-104 | Email already has an account | Log in, or reset the password |
| MJ-105 | Wrong email or password | Check both, or reset the password |
| MJ-106 | Account locked after 5 wrong passwords | Wait 15 minutes, or reset the password |
| MJ-107 | Wrong or missing email code | Use the newest code from the email |
| MJ-108 | Email code expired (15 minutes) | Tap Resend code |
| MJ-109 | 5 wrong codes, code cancelled | Tap Resend code |
| MJ-110 | Asked for a new code too soon | Wait a minute |
| MJ-111 | The email could not be sent (daily limit) | Try again later |
| MJ-112 | Password-reset time ran out | Start again from Forgot password |
| MJ-113 | More than 6 codes asked for one email in 6 hours | Wait a few hours (stops reset codes being guessed) |
| MJ-201 | No bundle chosen | Choose a bundle in step 1 |
| MJ-202 | Not a Halotel number | Use a number starting 061 or 062 |
| MJ-203 | Transaction ID missing or malformed | Copy it exactly from the SMS |
| MJ-204 | Transaction ID already used | Check the SMS for the right ID |
| MJ-205 | Order no longer exists (admin) | Refresh the list |
| MJ-206 | Status not allowed (admin) | Refresh the list |
| MJ-301 | Could not reach the server | Check the connection, try again |
| MJ-302 | Phone is offline | Connect; the page reloads by itself |
| MJ-303 | Request timed out (slow network) | Try again or turn on data saver; a resent order is not duplicated |
| MJ-304 | Server answer could not be read | Try again in a minute |
| MJ-305 | `API_URL` not set in index.html | Owner: finish the setup steps |
| MJ-306 | `setup` not run in Apps Script | Owner: run `setup` |
| MJ-401 | Server error | Try again; owner: check Apps Script → Executions |
| MJ-402 | Request not understood | Reload the page |
| MJ-403 | Customer account opened the desk | Staff accounts are set in `ADMIN_EMAILS` |
| MJ-404 | Login expired (after 7 days) | Log in again; unsent order details are kept |

## How the app handles problems

- **Empty lists** say why they are empty and offer one next step.
- **Loading** shows placeholder rows and a thin progress bar; lists already seen show at once while they refresh.
- **Form mistakes** are flagged under the exact field, with how to fix them, before anything is sent.
- **No internet**: a banner appears at once, nothing waits for a timeout, and data reloads when the phone is back online.
- **Slow network**: after 5 seconds a banner offers **data saver** (plain fonts, 10 items per list). It is also on by
  default when the phone asks to save data. If an order times out, pressing Submit again shows the receipt if the
  first try had arrived, instead of a duplicate.
- **Searches with no results** (desk) suggest close spellings and the next search to try.
- **Expired login**: the order being filled in is saved as the customer types; after logging in again they return to it.
  Logging out on purpose clears it.

## Security notes

- The page sends a Content-Security-Policy: it may only load itself and Google Fonts, and only talk to Apps Script.
- It refuses to run inside another website's frame (so it cannot be overlaid to trick clicks).
- No passwords, keys or admin logins are in the page. Admins are set in the `ADMIN_EMAILS` script property.
- Everything typed by customers is shown as plain text, never as HTML.
- Passwords are stored hashed; sessions are signed and end on logout, password change or after 7 days.
- Wrong passwords lock an account for 15 minutes; email codes allow 5 guesses and at most 6 codes per 6 hours.
