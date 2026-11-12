-- MySQL schema for doctor-backend (MySQL 5.7+ / 8.x, MariaDB 10.3+).
-- The backend runs this automatically on startup; every statement is safe to run again.
-- Dates and times are stored in UTC.

CREATE TABLE IF NOT EXISTS admins (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  username      VARCHAR(100) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_admins_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS patients (
  id                 INT UNSIGNED NOT NULL AUTO_INCREMENT,
  file_number        VARCHAR(50)  NOT NULL,
  full_name          VARCHAR(200) NOT NULL,
  phone              VARCHAR(30)  NOT NULL,
  date_of_birth      DATE         NULL,
  gender             VARCHAR(10)  NULL,
  blood_type         VARCHAR(5)   NULL,
  allergies          TEXT         NULL,
  chronic_conditions TEXT         NULL,
  notes              TEXT         NULL,
  created_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_patients_file_number (file_number),
  KEY idx_patients_updated_at (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS visits (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  patient_id   INT UNSIGNED NOT NULL,
  visit_date   DATE         NOT NULL,
  diagnosis    TEXT         NULL,
  prescription TEXT         NULL,
  notes        TEXT         NULL,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_visits_patient (patient_id, visit_date),
  CONSTRAINT fk_visits_patient FOREIGN KEY (patient_id) REFERENCES patients (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Values the system creates for itself, such as the secret that signs staff logins when JWT_SECRET is not set.
CREATE TABLE IF NOT EXISTS settings (
  name  VARCHAR(100) NOT NULL,
  value TEXT         NOT NULL,
  PRIMARY KEY (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- PDF files attached to a patient file. The PDF itself is stored on disk (UPLOAD_DIR) as stored_name.
CREATE TABLE IF NOT EXISTS documents (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  patient_id    INT UNSIGNED NOT NULL,
  title         VARCHAR(200) NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  stored_name   VARCHAR(64)  NOT NULL,
  size          INT UNSIGNED NOT NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_documents_stored_name (stored_name),
  KEY idx_documents_patient (patient_id, created_at),
  CONSTRAINT fk_documents_patient FOREIGN KEY (patient_id) REFERENCES patients (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
