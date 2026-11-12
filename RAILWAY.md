# Deploying on Railway

[Railway](https://railway.com) runs the system for you: no server to install, update or secure. You set it up once
in the Railway dashboard, and every change pushed to GitHub is deployed automatically.

The project has three parts:

| Part                | What it is                                                           | Comes from                 |
| ------------------- | -------------------------------------------------------------------- | -------------------------- |
| **MySQL**           | the database (patient files, visits, the list of PDFs)               | Railway's MySQL            |
| **doctor-backend**  | the API, with a volume (disk) for the PDF files                      | the `doctor-backend` repo  |
| **doctor-frontend** | the website: staff dashboard at `/admin`, patient page at `/patient` | the `doctor-frontend` repo |

Both repositories already contain a `railway.json` that tells Railway how to build and check them.

## Before you start

1. Create an account at [railway.com](https://railway.com), signing in with GitHub.
2. Choose a paid plan (the Hobby plan is enough for a clinic). The free trial stops after a while, and a clinic
   system must not stop. Railway charges for what the three parts use; see
   [railway.com/pricing](https://railway.com/pricing).
3. When Railway asks for access to GitHub, allow it to see **doctor-backend** and **doctor-frontend**.

## 1. Create the project and the database

1. In Railway, click **New Project** → **Deploy MySQL** (or **Database** → **MySQL**).
2. Wait until the MySQL box shows as active. Keep its name **MySQL**; the settings below refer to it by that name.

## 2. Add the backend

1. In the project, click **Create** (or **+ New**) → **GitHub Repo** → **doctor-backend**.
2. Open the new **doctor-backend** box → **Variables** → **Raw Editor**, paste this, put your own password on the
   `ADMIN_PASSWORD` line, and save:

   ```
   DATABASE_URL=${{MySQL.MYSQL_URL}}
   ADMIN_PASSWORD=choose-a-strong-password
   PORT=4000
   TRUST_PROXY=1
   RAILWAY_RUN_UID=0
   ```

   - `DATABASE_URL` connects to the MySQL box from step 1.
   - `ADMIN_PASSWORD` is the first staff password. It is used only on the very first start; change it later on the
     Account page.
   - `RAILWAY_RUN_UID=0` lets the API write PDFs to its volume.

3. Add the volume for PDFs: right-click the **doctor-backend** box (or use the **Create** menu) → **Volume**, attach
   it to **doctor-backend**, and set the mount path to:

   ```
   /app/data/uploads
   ```

4. Give it a web address: **doctor-backend** → **Settings** → **Networking** → **Generate Domain**, with port
   **4000**. You get an address like `doctor-backend-production-xxxx.up.railway.app`. Patients' PDF links use it.

## 3. Add the website

1. Click **Create** → **GitHub Repo** → **doctor-frontend**.
2. Open **doctor-frontend** → **Variables** → **Raw Editor**, paste this, put your clinic's name, and save:

   ```
   VITE_API_URL=https://${{doctor-backend.RAILWAY_PUBLIC_DOMAIN}}
   VITE_CLINIC_NAME=Your Clinic Name
   DOMAIN=:8080
   PORT=8080
   ```

   - `VITE_API_URL` points the website at the backend's address from step 2.4. If your backend box has a different
     name than `doctor-backend`, use that name inside `${{ }}`.
   - `VITE_CLINIC_NAME` is shown on the patient page and the QR poster.

3. **Settings** → **Networking** → **Generate Domain**, with port **8080**. This is the address of the clinic
   system, like `doctor-frontend-production-xxxx.up.railway.app`.

## 4. Deploy and check

1. If Railway shows **Deploy** or **Apply changes** at the top, click it. Each box shows **Active** when its
   deployment has finished (the first one takes a few minutes).
2. Open the website address from step 3.3. It opens the staff login.
3. Log in with `admin` and your `ADMIN_PASSWORD`, then open **Account** and change the password.
4. Open **QR code**. The link must be the website address followed by `/patient`. Print the poster or download
   the image.
5. Create a test patient file with a PDF, scan the QR code with a phone, and open the file with its file number
   and phone number. Delete the test file afterwards.

## Your own domain (optional)

To use an address like `files.your-clinic.com`:

1. **doctor-frontend** → **Settings** → **Networking** → **Custom Domain**, and type the domain.
2. Railway shows a DNS record (a CNAME). Add it at the company where you bought the domain, and wait until Railway
   shows the domain as active. HTTPS is set up automatically.
3. Open the system at the new address, go to **QR code**, check that the link uses the new domain, and print the
   poster again.

## Updates

Railway deploys again automatically when new code reaches the branch it watches (each box → **Settings** →
**Source** shows which branch). Patient data and PDFs are on the MySQL and backend volumes, so deploys never
touch them.

If you change a website variable (`VITE_...`), redeploy **doctor-frontend** (its box → **Deployments** → the
three dots → **Redeploy**): those values are built into the website.

## Backups

Turn on scheduled backups for **both** volumes, because the PDFs are not stored in MySQL:

1. **MySQL** box → **Backups** → set a daily schedule.
2. **doctor-backend** box → its volume → **Backups** → set a daily schedule.

Check on [railway.com/pricing](https://railway.com/pricing) which plans include backups.

## When something is wrong

Open the box → **Deployments** → **View logs**. The API says exactly what it needs:

| Message in the logs                | What to do                                                                                        |
| ---------------------------------- | ------------------------------------------------------------------------------------------------- |
| `Cannot connect to MySQL at …`     | Check `DATABASE_URL=${{MySQL.MYSQL_URL}}` on doctor-backend, and that the MySQL box is **Active** |
| `Cannot write to the PDF folder …` | Add `RAILWAY_RUN_UID=0` to doctor-backend's variables, and check the volume's mount path          |
| `Set ADMIN_PASSWORD …`             | Add `ADMIN_PASSWORD` to doctor-backend's variables                                                |

- **The login page says "Cannot reach the server".** The website does not have the right backend address.
  Check `VITE_API_URL` on doctor-frontend (its value must start with `https://` and show the backend's domain when
  you click the eye icon), then redeploy doctor-frontend.
- **The admin password does not work.** `ADMIN_PASSWORD` is used only on the very first start; after that the
  password is the one set on the Account page.
