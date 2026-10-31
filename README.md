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

## Limits to know

- A normal Gmail account can send about **100 emails per day** from Apps Script. Every sign-up, login code,
  password reset and new order uses one. OTP emails stop when only 5 are left, so order emails still arrive.
- A login lasts up to **6 hours**, then the customer logs in again.
- After 5 wrong passwords an account is locked for 15 minutes. After 5 wrong codes the code is cancelled.

## Moving from the old version

The old version kept accounts and orders only inside each visitor's browser, so they cannot be moved.
Customers sign up again once. The new page deletes the old browser data (it held plain-text passwords).
The old Google Sheet and Apps Script are not touched; keep them for your records.
