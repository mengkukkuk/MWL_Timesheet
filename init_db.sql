/* =========================
   DATABASE INIT
========================= */
IF NOT EXISTS (SELECT name FROM sys.databases WHERE name = 'MeterWorklog')
    CREATE DATABASE MeterWorklog;
GO

USE MeterWorklog;
GO

/* =========================
   MEMBERS (MUST EXIST FIRST)
========================= */
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'members')
CREATE TABLE members (
                         id INT IDENTITY(1,1) PRIMARY KEY,
                         name NVARCHAR(200) NOT NULL,
                         department NVARCHAR(100) NULL,
                         staff_id NVARCHAR(50) NULL
);

GO
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Employee')
CREATE TABLE Employee (
                          ID              int IDENTITY(1,1) PRIMARY KEY,
                          EmployeeID      NVARCHAR(5) NOT NULL,
                          EmployeeName    NVARCHAR(150) NOT NULL,
                          Department      NVARCHAR(100) NULL,
                          Position        NVARCHAR(100) NULL,
                          Level           NVARCHAR(10)  NULL,
                          JG              NVARCHAR(20)  NULL,
                          CreateAt        DATETIME2 NULL DEFAULT GETDATE(),
                          UpdateAt        DATETIME2 NULL DEFAULT GETDATE(),
                          AvatarPath      NVARCHAR(300) NULL,
                          AvatarMime      NVARCHAR(100) NULL,
                          AvatarUpdatedAt DATETIME2     NULL,

);
GO

/* =========================
   PROJECTS
========================= */
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'projects')
CREATE TABLE projects (
                          id INT IDENTITY(1,1) PRIMARY KEY,
                          name NVARCHAR(200) NOT NULL UNIQUE,
                          main_members NVARCHAR(MAX) NULL,
                          support_members NVARCHAR(MAX) NULL
);
GO

/* =========================
   WORKLOGS (FIXED COMPUTED)
========================= */
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'worklogs')
CREATE TABLE worklogs (
                          id INT IDENTITY(1,1) PRIMARY KEY,
                          member_id INT NULL FOREIGN KEY REFERENCES members(id),
                          EmployeeID NVARCHAR(5) NULL,

                          log_date DATE NOT NULL,
                          project NVARCHAR(200),
                          task NVARCHAR(500),

                          start_time TIME,
                          end_time TIME,

                          hours AS (
                              CASE
                                  WHEN start_time IS NOT NULL AND end_time IS NOT NULL AND end_time >= start_time
                                      THEN CAST((
                                                    DATEDIFF(MINUTE, start_time, end_time) -
                                                    CASE
                                                        WHEN start_time < TIMEFROMPARTS(13,0,0,0,0)
                                                            AND end_time   > TIMEFROMPARTS(12,0,0,0,0)
                                                            THEN DATEDIFF(
                                                                MINUTE,
                                                                CASE WHEN start_time > TIMEFROMPARTS(12,0,0,0,0)
                                                                         THEN start_time ELSE TIMEFROMPARTS(12,0,0,0,0) END,
                                                                CASE WHEN end_time < TIMEFROMPARTS(13,0,0,0,0)
                                                                         THEN end_time ELSE TIMEFROMPARTS(13,0,0,0,0) END
                                                                 )
                                                        ELSE 0
                                                        END
                                                    ) / 60.0 AS DECIMAL(5,2))
                                  ELSE NULL
                                  END
                              ) PERSISTED,

                          overtime_hours AS (
                              CASE
                                  WHEN start_time IS NOT NULL AND end_time IS NOT NULL AND end_time >= start_time
                                      THEN CAST((
                                                    (CASE
                                                         WHEN start_time < TIMEFROMPARTS(8,30,0,0,0)
                                                             THEN DATEDIFF(
                                                                 MINUTE,
                                                                 start_time,
                                                                 CASE WHEN end_time < TIMEFROMPARTS(8,30,0,0,0)
                                                                          THEN end_time ELSE TIMEFROMPARTS(8,30,0,0,0) END
                                                                  )
                                                         ELSE 0
                                                        END)
                                                        +
                                                    (CASE
                                                         WHEN end_time > TIMEFROMPARTS(17,30,0,0,0)
                                                             THEN DATEDIFF(
                                                                 MINUTE,
                                                                 CASE WHEN start_time > TIMEFROMPARTS(17,30,0,0,0)
                                                                          THEN start_time ELSE TIMEFROMPARTS(17,30,0,0,0) END,
                                                                 end_time
                                                                  )
                                                         ELSE 0
                                                        END)
                                                    ) / 60.0 AS DECIMAL(5,2))
                                  ELSE NULL
                                  END
                              ) PERSISTED,

                          -- regular_hours: portion of work inside 08:30-17:30 minus lunch overlap.
                          -- Pure function of start/end time (no holiday lookup needed).
                          regular_hours AS (
                              CASE
                                  WHEN start_time IS NOT NULL AND end_time IS NOT NULL
                                       AND end_time   > TIMEFROMPARTS(8,30,0,0,0)
                                       AND start_time < TIMEFROMPARTS(17,30,0,0,0)
                                      THEN CAST((
                                                    DATEDIFF(
                                                        MINUTE,
                                                        CASE WHEN start_time > TIMEFROMPARTS(8,30,0,0,0)
                                                                 THEN start_time ELSE TIMEFROMPARTS(8,30,0,0,0) END,
                                                        CASE WHEN end_time   < TIMEFROMPARTS(17,30,0,0,0)
                                                                 THEN end_time   ELSE TIMEFROMPARTS(17,30,0,0,0) END
                                                    )
                                                    -
                                                    CASE
                                                        WHEN start_time < TIMEFROMPARTS(13,0,0,0,0)
                                                            AND end_time   > TIMEFROMPARTS(12,0,0,0,0)
                                                            THEN DATEDIFF(
                                                                MINUTE,
                                                                CASE WHEN start_time > TIMEFROMPARTS(12,0,0,0,0)
                                                                         THEN start_time ELSE TIMEFROMPARTS(12,0,0,0,0) END,
                                                                CASE WHEN end_time < TIMEFROMPARTS(13,0,0,0,0)
                                                                         THEN end_time ELSE TIMEFROMPARTS(13,0,0,0,0) END
                                                                 )
                                                        ELSE 0
                                                        END
                                                    ) / 60.0 AS DECIMAL(5,2))
                                  ELSE 0
                                  END
                              ) PERSISTED,

                          status NVARCHAR(50) CHECK (status IN ('Done','In Progress','Pending','Man day')),
                          note NVARCHAR(1000),

                          created_at DATETIME2 DEFAULT GETDATE(),
                          updated_at DATETIME2 DEFAULT GETDATE()
);
GO

/* =========================
   INDEXES
========================= */
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_worklogs_employee_date')
CREATE NONCLUSTERED INDEX IX_worklogs_employee_date
    ON worklogs(EmployeeID, log_date);
GO

/* =========================
   HOLIDAY (referenced by app/worklogs.py for OT calculation)
========================= */
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'holiday')
CREATE TABLE dbo.holiday (
    id          INT IDENTITY(1,1) PRIMARY KEY,
    [date]      DATE NOT NULL UNIQUE,
    description NVARCHAR(500) NULL,
    created_at  DATETIME2 DEFAULT GETDATE()
);
GO

/* =========================
   USERS (MUST BEFORE SECURITY TABLES)
========================= */
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'users')
CREATE TABLE users (
                       id INT IDENTITY(1,1) PRIMARY KEY,
                       username NVARCHAR(100) NOT NULL UNIQUE,
                       password_hash NVARCHAR(256) NOT NULL,
                       role NVARCHAR(50) NOT NULL DEFAULT 'Staff'
                           CONSTRAINT CK_users_role CHECK (role IN ('Staff','Leader','Admin','Super_Ultimate_ADMIN')),
                       member_id INT NULL FOREIGN KEY REFERENCES members(id),
                       EmployeeID NVARCHAR(5) NULL,
                       status NVARCHAR(20) NOT NULL DEFAULT 'Active'
                           CONSTRAINT CK_users_status CHECK (status IN ('Pending','Active','Declined')),
                       reviewed_by INT NULL FOREIGN KEY REFERENCES users(id),
                       reviewed_at DATETIME2 DEFAULT GETDATE(),
                       created_at DATETIME2 DEFAULT GETDATE()
);
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('users') AND name = 'EmployeeID')
    ALTER TABLE users ADD EmployeeID NVARCHAR(5) NULL;
GO

/* =========================
   SECURITY TABLES (NOW SAFE)
========================= */
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'user_security_state')
CREATE TABLE user_security_state (
                                     user_id INT PRIMARY KEY REFERENCES users(id),
                                     failed_login_count INT NOT NULL DEFAULT 0,
                                     failed_login_window_start DATETIME2 NULL,
                                     locked_until DATETIME2 NULL,
                                     unlock_token_hash NVARCHAR(256) NULL,
                                     unlock_token_expires_at DATETIME2 NULL,
                                     last_unlock_email_sent_at DATETIME2 NULL,
                                     updated_at DATETIME2 NOT NULL DEFAULT GETDATE()
);
GO
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'security_events')
CREATE TABLE security_events (
                                 id INT IDENTITY(1,1) PRIMARY KEY,
                                 user_id INT NULL REFERENCES users(id),
                                 username NVARCHAR(100),
                                 event_type NVARCHAR(100) NOT NULL,
                                 ip_address NVARCHAR(100),
                                 user_agent NVARCHAR(500),
                                 detail NVARCHAR(MAX),
                                 created_at DATETIME2 DEFAULT GETDATE()
);

/* =========================
   MEMBER SKILLS (FIXED FK)
========================= */
-- Member skills (each member can have unlimited named skills, level 1–5)
GO
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'member_skills')
CREATE TABLE member_skills (
                               id          INT IDENTITY(1,1) PRIMARY KEY,
                               member_id   INT NOT NULL FOREIGN KEY REFERENCES members(id) ON DELETE CASCADE,
                               name        NVARCHAR(120) NOT NULL,
                               level       TINYINT NOT NULL
                                   CONSTRAINT CK_member_skills_level CHECK (level BETWEEN 1 AND 5),
                               created_at  DATETIME2 NOT NULL DEFAULT GETDATE(),
                               updated_at  DATETIME2 NOT NULL DEFAULT GETDATE(),
                               CONSTRAINT UQ_member_skills_member_name UNIQUE (member_id, name)
);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_member_skills_member')
    CREATE NONCLUSTERED INDEX IX_member_skills_member ON member_skills(member_id);

-- EmployeeID is the post-migration skill owner key. Keep legacy member_id
-- nullable so new Employee-backed users are not forced through members.id.
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('member_skills') AND name = 'EmployeeID')
    ALTER TABLE member_skills ADD EmployeeID NVARCHAR(5) NULL;

GO

-- Separate batch: EmployeeID must exist before any DML/DDL references it.
UPDATE ms SET ms.EmployeeID = TRY_CAST(m.staff_id AS INT)
FROM member_skills ms
         JOIN members m ON ms.member_id = m.id
WHERE ms.EmployeeID IS NULL
  AND m.staff_id IS NOT NULL
  AND TRY_CAST(m.staff_id AS INT) IS NOT NULL;

IF EXISTS (
    SELECT 1
    FROM sys.foreign_key_columns fkc
             JOIN sys.columns c ON fkc.parent_object_id = c.object_id
        AND fkc.parent_column_id = c.column_id
    WHERE fkc.parent_object_id = OBJECT_ID('member_skills') AND c.name = 'member_id'
)
    BEGIN
        DECLARE @fk_skills_member NVARCHAR(200);
        SELECT TOP 1 @fk_skills_member = fk.name
        FROM sys.foreign_key_columns fkc
                 JOIN sys.foreign_keys fk ON fkc.constraint_object_id = fk.object_id
                 JOIN sys.columns c ON fkc.parent_object_id = c.object_id
            AND fkc.parent_column_id = c.column_id
        WHERE fkc.parent_object_id = OBJECT_ID('member_skills') AND c.name = 'member_id';
        IF @fk_skills_member IS NOT NULL
            EXEC('ALTER TABLE member_skills DROP CONSTRAINT [' + @fk_skills_member + ']');
    END

IF EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('member_skills') AND name = 'member_id' AND is_nullable = 0
)
    BEGIN
        IF EXISTS (SELECT * FROM sys.indexes WHERE object_id = OBJECT_ID('member_skills') AND name = 'IX_member_skills_member')
            DROP INDEX IX_member_skills_member ON member_skills;
        IF EXISTS (
            SELECT 1 FROM sys.key_constraints
            WHERE parent_object_id = OBJECT_ID('member_skills')
              AND name = 'UQ_member_skills_member_name'
        )
        ALTER TABLE member_skills DROP CONSTRAINT UQ_member_skills_member_name;
        ALTER TABLE member_skills ALTER COLUMN member_id INT NULL;
    END

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_member_skills_employee')
    CREATE NONCLUSTERED INDEX IX_member_skills_employee ON member_skills(EmployeeID);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'UX_member_skills_employee_name')
    AND NOT EXISTS (
        SELECT 1
        FROM member_skills
        WHERE EmployeeID IS NOT NULL
        GROUP BY EmployeeID, name
        HAVING COUNT(*) > 1
    )
CREATE UNIQUE NONCLUSTERED INDEX UX_member_skills_employee_name
    ON member_skills(EmployeeID, name)
    WHERE EmployeeID IS NOT NULL;

/* =========================
   SETTINGS
========================= */
GO
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'settings')
    BEGIN
        CREATE TABLE settings (
                                  [key] NVARCHAR(100) PRIMARY KEY,
                                  value NVARCHAR(MAX) NOT NULL
        );

        INSERT INTO settings ([key], value)
        VALUES ('worklog_open', '0');
    END
GO

/* =========================
   SEED DATA
========================= */
IF NOT EXISTS (SELECT 1 FROM projects WHERE name = 'Warehouse')
    INSERT INTO projects (name) VALUES ('Warehouse');

IF NOT EXISTS (SELECT 1 FROM members WHERE name = 'Boonyarith Akkarasongthum')
    INSERT INTO members (name, department)
    VALUES ('Boonyarith Akkarasongthum', 'Meter');

IF NOT EXISTS (SELECT 1 FROM users WHERE username = 'sultadkukkuk')
    INSERT INTO users (username, password_hash, role, status, EmployeeID)
    VALUES (
               'sultadkukkuk',
               'scrypt:32768:8:1$6BpoyyNeineDbHF7$ab9ef6ceb57ba1a3bebe67b798313a149be239686efbe3a622421b287884b61232151accc1ee2b30bed04b6a85e688ab65544354fb434bad28641d650e01145d',
               'Super_Ultimate_ADMIN','Active','11111'
           );
GO


-- File Share: folders (self-referencing tree) and files (metadata only; blobs on disk)
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'file_folders')
CREATE TABLE file_folders (
                              id          INT IDENTITY(1,1) PRIMARY KEY,
                              name        NVARCHAR(200) NOT NULL,
                              parent_id   INT NULL FOREIGN KEY REFERENCES file_folders(id),
                              created_by  INT NULL FOREIGN KEY REFERENCES users(id),
                              created_at  DATETIME2 DEFAULT GETDATE(),
                              CONSTRAINT UQ_file_folders_parent_name UNIQUE (parent_id, name)
);

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'files')
CREATE TABLE files (
                       id              INT IDENTITY(1,1) PRIMARY KEY,
                       folder_id       INT NULL FOREIGN KEY REFERENCES file_folders(id),
                       original_name   NVARCHAR(400) NOT NULL,
                       stored_name     NVARCHAR(200) NOT NULL UNIQUE,  -- UUID-based; never user input
                       size_bytes      BIGINT NOT NULL,
                       mime_type       NVARCHAR(200) NULL,
                       sha256          CHAR(64) NULL,
                       uploaded_by     INT NULL FOREIGN KEY REFERENCES users(id),
                       uploaded_at     DATETIME2 DEFAULT GETDATE()
);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_files_folder')
CREATE NONCLUSTERED INDEX IX_files_folder ON files(folder_id);

-- Seed a root folder (parent_id = NULL is the implicit root; this is a convenient 'Shared' subfolder)
IF NOT EXISTS (SELECT 1 FROM file_folders WHERE parent_id IS NULL AND name = 'Shared')
    INSERT INTO file_folders (name, parent_id) VALUES ('Shared', NULL);

GO

-- ── P0 performance indexes (added 2026-05-12) ────────────────────────────────
-- Auto-applied by db.init_db() on first request. Idempotent via IF NOT EXISTS.

-- Speeds /api/projects-summary aggregation (filtered for non-null projects)
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_worklogs_project')
    CREATE NONCLUSTERED INDEX IX_worklogs_project
    ON worklogs(project)
    WHERE project IS NOT NULL;

GO

-- Speeds /api/users pending list and approval flow
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_users_status')
    CREATE NONCLUSTERED INDEX IX_users_status
    ON users(status);

GO

-- Speeds folder breadcrumb recursion and dedup checks
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_file_folders_parent_name')
    CREATE NONCLUSTERED INDEX IX_file_folders_parent_name
    ON file_folders(parent_id, name);

GO

-- Speeds /api/worklogs date-range scans without EmployeeID filter (admin views)
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_worklogs_log_date')
    CREATE NONCLUSTERED INDEX IX_worklogs_log_date
    ON worklogs(log_date)
    INCLUDE (EmployeeID, project, status);

GO

/* =========================
   EmployeeID whitespace backfill (one-time, idempotent)

   NVARCHAR EmployeeID values that picked up trailing whitespace at some
   point get URL-encoded to %20 by the SPA, which then fails to match
   trimmed values elsewhere in the app. Strip the spaces on every table
   that stores an EmployeeID.

   The WHERE clause uses DATALENGTH (which counts trailing spaces) rather
   than `=` (which ignores trailing spaces in NVARCHAR comparison under
   ANSI rules), so re-runs are true no-ops once data is clean.

   Going forward, db._rstrip_params() in db.py trims every string
   parameter before SQL binding, so this backfill only matters for rows
   written before that fix landed.
========================= */
UPDATE dbo.Employee
SET EmployeeID = RTRIM(EmployeeID)
WHERE DATALENGTH(EmployeeID) <> DATALENGTH(RTRIM(EmployeeID));
GO

UPDATE worklogs
SET EmployeeID = RTRIM(EmployeeID)
WHERE EmployeeID IS NOT NULL
  AND DATALENGTH(EmployeeID) <> DATALENGTH(RTRIM(EmployeeID));
GO

UPDATE users
SET EmployeeID = RTRIM(EmployeeID)
WHERE EmployeeID IS NOT NULL
  AND DATALENGTH(EmployeeID) <> DATALENGTH(RTRIM(EmployeeID));
GO

UPDATE member_skills
SET EmployeeID = RTRIM(EmployeeID)
WHERE EmployeeID IS NOT NULL
  AND DATALENGTH(EmployeeID) <> DATALENGTH(RTRIM(EmployeeID));
GO

UPDATE ProjectAndBudget
SET
    Description = RTRIM(Description),
    ProjectCode = RTRIM(ProjectCode)
WHERE
    (Description IS NOT NULL
        AND DATALENGTH(Description) <> DATALENGTH(RTRIM(Description)))
   OR
    (ProjectCode IS NOT NULL
        AND DATALENGTH(ProjectCode) <> DATALENGTH(RTRIM(ProjectCode)));
GO

-- ════════════════════════════════════════════════════════════════════════════
-- OT tier columns and regular_hours computed column (added 2026-05).
-- Idempotent — safe to re-run via init_db().
-- ════════════════════════════════════════════════════════════════════════════
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('worklogs') AND name = 'OT1')
    ALTER TABLE worklogs ADD OT1 DECIMAL(5,2) NULL;
GO
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('worklogs') AND name = 'OT1_5')
    ALTER TABLE worklogs ADD OT1_5 DECIMAL(5,2) NULL;
GO
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('worklogs') AND name = 'OT3')
    ALTER TABLE worklogs ADD OT3 DECIMAL(5,2) NULL;
GO

-- Use EXEC() so the IF NOT EXISTS wrapper does not interfere with
-- T-SQL parsing of the "AS (...) PERSISTED" computed-column expression.
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('worklogs') AND name = 'regular_hours')
    EXEC('ALTER TABLE worklogs ADD regular_hours AS (
        CASE
            WHEN start_time IS NOT NULL AND end_time IS NOT NULL
                 AND end_time   > TIMEFROMPARTS(8,30,0,0,0)
                 AND start_time < TIMEFROMPARTS(17,30,0,0,0)
                THEN CAST((
                    DATEDIFF(
                        MINUTE,
                        CASE WHEN start_time > TIMEFROMPARTS(8,30,0,0,0)
                                 THEN start_time ELSE TIMEFROMPARTS(8,30,0,0,0) END,
                        CASE WHEN end_time   < TIMEFROMPARTS(17,30,0,0,0)
                                 THEN end_time   ELSE TIMEFROMPARTS(17,30,0,0,0) END
                    )
                    -
                    CASE
                        WHEN start_time < TIMEFROMPARTS(13,0,0,0,0)
                             AND end_time > TIMEFROMPARTS(12,0,0,0,0)
                            THEN DATEDIFF(
                                MINUTE,
                                CASE WHEN start_time > TIMEFROMPARTS(12,0,0,0,0)
                                         THEN start_time ELSE TIMEFROMPARTS(12,0,0,0,0) END,
                                CASE WHEN end_time < TIMEFROMPARTS(13,0,0,0,0)
                                         THEN end_time ELSE TIMEFROMPARTS(13,0,0,0,0) END
                            )
                        ELSE 0
                    END
                ) / 60.0 AS DECIMAL(5,2))
            ELSE CAST(0 AS DECIMAL(5,2))
        END
    ) PERSISTED');
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'holiday' AND SCHEMA_NAME(schema_id) = 'dbo')
CREATE TABLE dbo.holiday (
    id          INT IDENTITY(1,1) PRIMARY KEY,
    [date]      DATE NOT NULL UNIQUE,
    description NVARCHAR(500) NULL,
    created_at  DATETIME2 DEFAULT GETDATE()
);
GO
