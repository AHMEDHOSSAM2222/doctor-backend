# doctor-backend

API for the clinic's patient file system. Staff manage patient files from the admin dashboard in
[doctor-frontend](https://github.com/AHMEDHOSSAM2222/doctor-frontend). Patients scan the clinic QR code with their
phone, enter their file number and phone number, and get their file back.

Built with Node.js, Express and SQLite (Node's built-in `node:sqlite`, so there is no database server to install).
Uploaded PDFs are stored as files in `data/uploads`.

## How a patient opens their file

1. The admin dashboard generates a QR code that links to the patient page of the frontend.
2. The patient scans it with their phone camera and the page opens.
3. They enter their **file number** and the **phone number** registered on the file.
4. The frontend calls `POST /api/public/lookup`. When both match, the API returns the file: details,
   allergies, chronic conditions, doctor's notes, all visits, and the list of PDFs in the file.
5. The patient taps a PDF to open it in their phone's PDF viewer, or downloads it to their phone. The lookup
   returns a temporary access token (30 minutes by default) that only opens PDFs in that patient's own file.

The phone number works as a second check, so nobody can read someone else's file by guessing file numbers.
Failed lookups are rate limited per visitor (10 per 15 minutes by default). Phone numbers match with or without
the country code, spaces or dashes, and Arabic-Indic digits (٠١٢٣…) are accepted.

## Run locally

Requires Node.js 22.5 or newer.

```bash
npm install
```

```bash
cp .env.example .env
```

```bash
npm run dev
```

The API starts on http://localhost:4000. On the first start it creates the admin account from `ADMIN_USERNAME` /
`ADMIN_PASSWORD` (default `admin` / `admin123`). **Change that password from the Account page after logging in.**

Run the tests:

```bash
npm test
```

## Configuration

All settings are environment variables. See [`.env.example`](.env.example).

| Variable                 | Default          | Purpose                                                            |
| ------------------------ | ---------------- | ------------------------------------------------------------------ |
| `PORT`                   | `4000`           | Port the API listens on                                            |
| `JWT_SECRET`             | random (dev)     | Signs admin login tokens. **Required when `NODE_ENV=production`**  |
| `JWT_EXPIRES_IN`         | `12h`            | How long an admin stays logged in                                  |
| `DB_PATH`                | `data/clinic.db` | SQLite database file                                               |
| `UPLOAD_DIR`             | `data/uploads`   | Folder for uploaded patient PDFs                                   |
| `MAX_UPLOAD_MB`          | `20`             | Largest PDF accepted                                               |
| `PATIENT_ACCESS_MINUTES` | `30`             | How long a patient can open their PDFs after looking up their file |
| `ADMIN_USERNAME`         | `admin`          | First admin account (created only if no admin exists)              |
| `ADMIN_PASSWORD`         | `admin123`       | Its password                                                       |
| `CORS_ORIGINS`           | `*`              | Frontend address(es) allowed to call the API, comma separated      |
| `TRUST_PROXY`            | off              | Number of proxies in front of the API, e.g. `1`                    |
| `LOOKUP_MAX_ATTEMPTS`    | `10`             | Failed patient lookups allowed per visitor per window              |
| `LOOKUP_WINDOW_MINUTES`  | `15`             | Length of that window                                              |

## API

Admin routes need an `Authorization: Bearer <token>` header with the token from `/api/auth/login`.

| Method   | Path                                   | Who    | Description                                                                               |
| -------- | -------------------------------------- | ------ | ----------------------------------------------------------------------------------------- |
| `GET`    | `/api/health`                          | public | Health check                                                                              |
| `POST`   | `/api/public/lookup`                   | public | `{ fileNumber, phone }` → the patient's file, PDFs and an access token                    |
| `GET`    | `/api/public/documents/:id?token=`     | public | Opens one of the patient's PDFs (token from the lookup); add `&download=1` to download it |
| `POST`   | `/api/auth/login`                      | public | `{ username, password }` → `{ token }`                                                    |
| `GET`    | `/api/auth/me`                         | admin  | Current admin                                                                             |
| `POST`   | `/api/auth/change-password`            | admin  | `{ currentPassword, newPassword }`                                                        |
| `GET`    | `/api/patients?search=&limit=&offset=` | admin  | List and search patient files                                                             |
| `GET`    | `/api/patients/next-file-number`       | admin  | Next free file number                                                                     |
| `POST`   | `/api/patients`                        | admin  | Create a file (empty `fileNumber` = next number)                                          |
| `GET`    | `/api/patients/:id`                    | admin  | A file with its visits                                                                    |
| `PUT`    | `/api/patients/:id`                    | admin  | Update a file                                                                             |
| `DELETE` | `/api/patients/:id`                    | admin  | Delete a file and its visits                                                              |
| `POST`   | `/api/patients/:id/visits`             | admin  | Add a visit                                                                               |
| `PUT`    | `/api/patients/:id/visits/:visitId`    | admin  | Update a visit                                                                            |
| `DELETE` | `/api/patients/:id/visits/:visitId`    | admin  | Delete a visit                                                                            |
| `POST`   | `/api/patients/:id/documents`          | admin  | Upload PDFs (multipart: `files`, and `titles` in the same order)                          |
| `GET`    | `/api/patients/:id/documents/:docId`   | admin  | Open a PDF                                                                                |
| `DELETE` | `/api/patients/:id/documents/:docId`   | admin  | Delete a PDF                                                                              |

Patient fields: `fileNumber`, `fullName`, `phone`, `dateOfBirth` (YYYY-MM-DD), `gender` (`male`/`female`),
`bloodType`, `allergies`, `chronicConditions`, `notes`. Visit fields: `visitDate`, `diagnosis`, `prescription`,
`notes`.

The public lookup returns everything except the phone number and internal ids.

Uploads accept up to 10 PDFs at a time, up to `MAX_UPLOAD_MB` each. Files are checked to be real PDFs (not only
named `.pdf`) and saved under random names, so a stored file cannot be found by guessing.

## Deploying

- Set `NODE_ENV=production`, a long random `JWT_SECRET`, and `CORS_ORIGINS` to your frontend address.
- Serve it over **HTTPS**. Patient data must not travel over plain HTTP.
- Behind a proxy or hosting platform, set `TRUST_PROXY=1` so rate limiting works per visitor.
- The database and the PDFs live in the `data/` folder. Put it on a **persistent disk** (on Render, Railway or
  Fly.io, attach a volume), or all patient files and PDFs are lost when the server restarts. Back up the whole
  folder regularly.
- If Nginx sits in front of the API, raise its upload limit (`client_max_body_size 25m;`); the default of 1 MB
  rejects most PDFs.
