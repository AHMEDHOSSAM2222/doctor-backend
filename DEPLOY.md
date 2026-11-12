# Deploying the clinic system

This puts the whole system on one server: MySQL, the API ([doctor-backend](https://github.com/AHMEDHOSSAM2222/doctor-backend))
and the website ([doctor-frontend](https://github.com/AHMEDHOSSAM2222/doctor-frontend)), with automatic HTTPS.
When it's done:

- `https://your-domain` opens the staff login and dashboard.
- `https://your-domain/patient` is the page the QR code opens for patients.

MySQL and the API are not reachable from the internet; only the website container (Caddy) is, and it forwards
`/api` requests to the API.

## What you need

- **A server** running Ubuntu 22.04 or 24.04 with at least **2 GB of memory** (MySQL needs about 1 GB) and 20 GB
  of disk. Any provider works, for example Hetzner, DigitalOcean, Contabo or Linode; this size costs about
  $5–12 a month.
- **A domain name** (for example `clinic-name.com` or a subdomain like `files.clinic-name.com`). HTTPS
  certificates are created for it automatically and for free.
- **Access to both GitHub repositories** (they are private, so you need a GitHub account with access).

## 1. Point the domain at the server

At the company where you bought the domain, open its DNS settings and add an **A record**:

| Type | Name                                 | Value                    |
| ---- | ------------------------------------ | ------------------------ |
| A    | `@` (or the subdomain, e.g. `files`) | your server's IP address |

It can take a few minutes to an hour to work. Check with `ping your-domain` from your computer: it should show the
server's IP.

## 2. Prepare the server

Log in to the server (`ssh root@SERVER_IP`) and run:

```bash
curl -fsSL https://get.docker.com | sh
```

Allow only SSH and web traffic through the firewall:

```bash
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable
```

## 3. Get the code

Clone both repositories **into the same folder**, next to each other. GitHub asks for your username and, as the
password, a [personal access token](https://github.com/settings/tokens) with read access to the repositories.

```bash
mkdir -p /opt/clinic && cd /opt/clinic
```

```bash
git clone https://github.com/AHMEDHOSSAM2222/doctor-backend.git
```

```bash
git clone https://github.com/AHMEDHOSSAM2222/doctor-frontend.git
```

Cloning gets each repository's default branch, which has this setup. If you later keep the code on another
branch, switch both folders to it with `git -C doctor-backend checkout <branch>` (and the same for
`doctor-frontend`).

## 4. Fill in the settings

```bash
cd /opt/clinic/doctor-backend/deploy && cp .env.example .env
```

Make three long random secrets (run it three times and copy each result):

```bash
openssl rand -hex 24
```

Then edit the file (`nano .env`; save with Ctrl+O, Enter, exit with Ctrl+X):

| Setting               | What to put                                                  |
| --------------------- | ------------------------------------------------------------ |
| `DOMAIN`              | your domain, e.g. `files.clinic-name.com` (no `https://`)    |
| `CLINIC_NAME`         | the name patients see on their page and the QR poster        |
| `ADMIN_PASSWORD`      | the first staff password (used only on the very first start) |
| `MYSQL_ROOT_PASSWORD` | secret 1                                                     |
| `MYSQL_PASSWORD`      | secret 2                                                     |
| `JWT_SECRET`          | secret 3                                                     |

Keep a copy of this file somewhere safe (for example a password manager). Without it you cannot restore backups.

## 5. Start everything

```bash
docker compose up -d --build
```

The first start takes a few minutes (it builds the website and starts MySQL). Check that all three parts run:

```bash
docker compose ps
```

`mysql`, `backend` and `web` should show `running` (MySQL and the API also show `healthy`). Then open
`https://your-domain` in a browser.

## 6. First login

1. Log in with `admin` and the `ADMIN_PASSWORD` you set.
2. Open **Account** and change the password.
3. Open **QR code**: the link must be `https://your-domain/patient`. Print the poster or download the image.
4. Create a test patient file, then scan the QR code with a phone and open that file with its file number and
   phone number. Delete the test file when you are happy.

## Updating to a new version

```bash
cd /opt/clinic && git -C doctor-backend pull && git -C doctor-frontend pull
```

```bash
cd /opt/clinic/doctor-backend/deploy && docker compose up -d --build
```

Patient data, PDFs and HTTPS certificates are kept in Docker volumes, so updates never touch them.

## Backups

The database and the uploaded PDFs are backed up together by `backup.sh`, into `deploy/backups/<date>/`. It keeps
the newest 14 backups.

```bash
/opt/clinic/doctor-backend/deploy/backup.sh
```

Run it every night at 02:30 by adding it to cron (`crontab -e`, then add this line):

```
30 2 * * * /opt/clinic/doctor-backend/deploy/backup.sh >> /var/log/clinic-backup.log 2>&1
```

**Copy the backups off the server regularly** (for example with `scp` to another computer, or your provider's
backup or snapshot feature). A backup that stays only on the server is lost with the server.

### Restoring a backup

Pick the backup folder, then load the database and the PDFs back:

```bash
cd /opt/clinic/doctor-backend/deploy && B=backups/2026-11-12_0230
```

```bash
gunzip -c $B/database.sql.gz | docker compose exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot --default-character-set=utf8mb4 doctor_clinic'
```

```bash
docker compose exec -T backend tar -C /app/data -xzf - < $B/uploads.tar.gz
```

## Useful commands

All from `/opt/clinic/doctor-backend/deploy`:

| Task                          | Command                       |
| ----------------------------- | ----------------------------- |
| See whether everything runs   | `docker compose ps`           |
| See the API's recent messages | `docker compose logs backend` |
| See the web server's messages | `docker compose logs web`     |
| Restart everything            | `docker compose restart`      |
| Stop everything               | `docker compose down`         |

`docker compose down` keeps all data. **Never add `-v`** to it: that deletes the database, the PDFs and the
certificates.

## When something is wrong

- **The site does not open or shows a certificate warning.** The domain must point at this server (step 1) and
  ports 80 and 443 must be open. `docker compose logs web` shows what the certificate request reported. Fix the DNS
  and run `docker compose restart web`.
- **"Cannot connect to MySQL" in `docker compose logs backend`.** MySQL may still be starting; the API retries by
  restarting. If it continues, check that `MYSQL_PASSWORD` in `.env` has not changed since the first start (MySQL
  keeps the password it was first given).
- **The admin password does not work.** `ADMIN_PASSWORD` is used only on the very first start; after that the
  password is the one set on the Account page.
- **Testing before you have a domain.** Set `DOMAIN=:80` and open `http://SERVER_IP`. This has no HTTPS, so use
  only test data, and switch to the real domain before entering real patient files.
