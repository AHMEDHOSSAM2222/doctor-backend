# doctor-backend

API for the clinic's patient file system. Staff manage patient files from the admin dashboard in
[doctor-frontend](https://github.com/AHMEDHOSSAM2222/doctor-frontend). Patients scan the clinic QR code with their
phone, enter their file number and phone number, and get their file back.

Built with Node.js, Express and SQLite (Node's built-in `node:sqlite`, so there is no database server to install).

## How a patient opens their file

1. The admin dashboard generates a QR code that links to the patient page of the frontend.
2. The patient scans it with their phone camera and the page opens.
3. They enter their **file number** and the **phone number** registered on the file.
4. The frontend calls `POST /api/public/lookup`. When both match, the API returns the file: details,
   allergies, chronic conditions, doctor's notes and all visits.

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

| Variable                | Default          | Purpose                                                       |
| ----------------------- | ---------------- | ------------------------------------------------------------- |
| `PORT`                  | `4000`           | Port the API listens on                                       |
| `JWT_SECRET`            | random (dev)     | Signs admin login tokens. **Required when `NODE_ENV=production`** |
| `JWT_EXPIRES_IN`        | `12h`            | How long an admin stays logged in                             |
| `DB_PATH`               | `data/clinic.db` | SQLite database file                                          |
| `ADMIN_USERNAME`        | `admin`          | First admin account (created only if no admin exists)         |
| `ADMIN_PASSWORD`        | `admin123`       | Its password                                                  |
| `CORS_ORIGINS`          | `*`              | Frontend address(es) allowed to call the API, comma separated |
| `TRUST_PROXY`           | off              | Number of proxies in front of the API, e.g. `1`               |
| `LOOKUP_MAX_ATTEMPTS`   | `10`             | Failed patient lookups allowed per visitor per window         |
| `LOOKUP_WINDOW_MINUTES` | `15`             | Length of that window                                         |

## API

Admin routes need an `Authorization: Bearer <token>` header with the token from `/api/auth/login`.

| Method   | Path                                  | Who    | Description                                     |
| -------- | ------------------------------------- | ------ | ----------------------------------------------- |
| `GET`    | `/api/health`                         | public | Health check                                    |
| `POST`   | `/api/public/lookup`                  | public | `{ fileNumber, phone }` → the patient's file    |
| `POST`   | `/api/auth/login`                     | public | `{ username, password }` → `{ token }`          |
| `GET`    | `/api/auth/me`                        | admin  | Current admin                                   |
| `POST`   | `/api/auth/change-password`           | admin  | `{ currentPassword, newPassword }`              |
| `GET`    | `/api/patients?search=&limit=&offset=` | admin  | List and search patient files                  |
| `GET`    | `/api/patients/next-file-number`      | admin  | Next free file number                           |
| `POST`   | `/api/patients`                       | admin  | Create a file (empty `fileNumber` = next number) |
| `GET`    | `/api/patients/:id`                   | admin  | A file with its visits                          |
| `PUT`    | `/api/patients/:id`                   | admin  | Update a file                                   |
| `DELETE` | `/api/patients/:id`                   | admin  | Delete a file and its visits                    |
| `POST`   | `/api/patients/:id/visits`            | admin  | Add a visit                                     |
| `PUT`    | `/api/patients/:id/visits/:visitId`   | admin  | Update a visit                                  |
| `DELETE` | `/api/patients/:id/visits/:visitId`   | admin  | Delete a visit                                  |

Patient fields: `fileNumber`, `fullName`, `phone`, `dateOfBirth` (YYYY-MM-DD), `gender` (`male`/`female`),
`bloodType`, `allergies`, `chronicConditions`, `notes`. Visit fields: `visitDate`, `diagnosis`, `prescription`,
`notes`.

The public lookup returns everything except the phone number and internal ids.

## Deploying

- Set `NODE_ENV=production`, a long random `JWT_SECRET`, and `CORS_ORIGINS` to your frontend address.
- Serve it over **HTTPS**. Patient data must not travel over plain HTTP.
- Behind a proxy or hosting platform, set `TRUST_PROXY=1` so rate limiting works per visitor.
- The database is a single file. Put `DB_PATH` on a **persistent disk** (on Render, Railway or Fly.io, attach a
  volume), or the data is lost when the server restarts. Back that file up regularly.
