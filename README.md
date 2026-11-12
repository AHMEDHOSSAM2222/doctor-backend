# doctor-backend

API for the clinic's patient file system. Staff manage patient files from the admin dashboard in
[doctor-frontend](https://github.com/AHMEDHOSSAM2222/doctor-frontend). Patients scan the clinic QR code with their
phone, enter their file number and phone number, and get their file back.

Built with Node.js, Express and **MySQL** (8.x or 5.7+; MariaDB 10.3+ also works). Patient files, visits and
the list of PDFs are stored in MySQL; the PDF files themselves are stored on disk in `data/uploads`.

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

Requires Node.js 22 or newer and a MySQL server.

**1. Create the database and a user** (in the MySQL client, e.g. `mysql -u root -p`; choose your own password):

```sql
CREATE DATABASE doctor_clinic CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'doctor'@'localhost' IDENTIFIED BY 'your-password';
GRANT ALL PRIVILEGES ON doctor_clinic.* TO 'doctor'@'localhost';
```

No MySQL installed? With Docker you can start one instead:

```bash
docker run -d --name clinic-mysql -p 3306:3306 -e MYSQL_ROOT_PASSWORD=root-pass -e MYSQL_DATABASE=doctor_clinic -e MYSQL_USER=doctor -e MYSQL_PASSWORD=your-password mysql:8.4
```

**2. Configure and start the API:**

```bash
npm install
```

```bash
cp .env.example .env
```

Put the MySQL password in `.env` (`MYSQL_PASSWORD=your-password`), then:

```bash
npm run dev
```

The API starts on http://localhost:4000. On startup it creates the tables if they do not exist (see
[`schema.sql`](schema.sql), which you can also run by hand). On the first start it creates the admin account from
`ADMIN_USERNAME` / `ADMIN_PASSWORD` (in development the default is `admin` / `admin123`). **Change that password
from the Account page after logging in.** If MySQL cannot be reached, the API stops with a message saying which
setting to check.

**Run the tests.** They create a temporary database for each test file and drop it afterwards, so the user needs
permission to create databases (the root user, or `GRANT ALL PRIVILEGES ON *.* TO ...` on a development machine):

```bash
TEST_DATABASE_URL=mysql://root:root-pass@127.0.0.1:3306 npm test
```

## Configuration

All settings are environment variables. See [`.env.example`](.env.example).

| Variable                 | Default                       | Purpose                                                                             |
| ------------------------ | ----------------------------- | ----------------------------------------------------------------------------------- |
| `PORT`                   | `4000`                        | Port the API listens on                                                             |
| `JWT_SECRET`             | (created)                     | Signs staff logins. Empty: a random secret is created once and kept in the database |
| `JWT_EXPIRES_IN`         | `12h`                         | How long an admin stays logged in                                                   |
| `DATABASE_URL`           | (empty)                       | MySQL connection as one URL: `mysql://user:password@host:3306/name`                 |
| `MYSQL_HOST`             | `127.0.0.1`                   | MySQL server (used when `DATABASE_URL` is empty)                                    |
| `MYSQL_PORT`             | `3306`                        | MySQL port                                                                          |
| `MYSQL_USER`             | `root`                        | MySQL user                                                                          |
| `MYSQL_PASSWORD`         | (empty)                       | MySQL password                                                                      |
| `MYSQL_DATABASE`         | `doctor_clinic`               | Database name (created on startup if the user is allowed to)                        |
| `UPLOAD_DIR`             | `data/uploads`                | Folder for uploaded patient PDFs                                                    |
| `MAX_UPLOAD_MB`          | `20`                          | Largest PDF accepted                                                                |
| `PATIENT_ACCESS_MINUTES` | `30`                          | How long a patient can open their PDFs after looking up their file                  |
| `ADMIN_USERNAME`         | `admin`                       | First admin account (created only if no admin exists)                               |
| `ADMIN_PASSWORD`         | `admin123` (development only) | Its password. Required in production                                                |
| `CORS_ORIGINS`           | `*`                           | Frontend address(es) allowed to call the API, comma separated                       |
| `TRUST_PROXY`            | off                           | Number of proxies in front of the API, e.g. `1`                                     |
| `LOOKUP_MAX_ATTEMPTS`    | `10`                          | Failed patient lookups allowed per visitor per window                               |
| `LOOKUP_WINDOW_MINUTES`  | `15`                          | Length of that window                                                               |

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

- **[RAILWAY.md](RAILWAY.md)**: run everything on Railway, with no server to manage. Set up once in the Railway
  dashboard; every push to GitHub deploys automatically.
- **[DEPLOY.md](DEPLOY.md)**: run everything on your own server with Docker (`deploy/docker-compose.yml`, with
  automatic HTTPS and `deploy/backup.sh` for backups).

If you host the parts separately instead:

- Set `NODE_ENV=production`, `ADMIN_PASSWORD` (required in production for the first staff login), and
  `CORS_ORIGINS` to your frontend address.
- Serve it over **HTTPS**. Patient data must not travel over plain HTTP.
- Behind a proxy or hosting platform, set `TRUST_PROXY=1` so rate limiting works per visitor.
- Use a MySQL server that is backed up (most hosts offer managed MySQL with daily backups), or back it up yourself
  with `mysqldump doctor_clinic > backup.sql`.
- The PDF files live in `UPLOAD_DIR` (`data/uploads`), not in MySQL. Put that folder on a **persistent disk** (on
  Render, Railway or Fly.io, attach a volume), or the PDFs are lost when the server restarts, and back it up
  together with the database.
- If Nginx sits in front of the API, raise its upload limit (`client_max_body_size 25m;`); the default of 1 MB
  rejects most PDFs.
