-- Team Worklog Database Initialization
-- Run this against your MSSQL Server to create the database and tables

IF NOT EXISTS (SELECT name FROM sys.databases WHERE name = 'MeterWorklog')
    CREATE DATABASE MeterWorklog;
GO

USE MeterWorklog;
GO

-- Projects (from Config sheet)
-- Member assignments stored as delimited strings: "name1 #name2 #name3"
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'projects')
CREATE TABLE projects (
    id INT IDENTITY(1,1) PRIMARY KEY,
    name NVARCHAR(200) NOT NULL UNIQUE,
    main_members    NVARCHAR(MAX) NULL,      -- Delimited format: [ID1,ID2]
    support_members NVARCHAR(MAX) NULL       -- Delimited format: [ID1,ID2]
);

-- Migrate existing installs: add main_members and support_members if not present
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('projects') AND name = 'main_members')
    ALTER TABLE projects ADD main_members NVARCHAR(MAX) NULL;
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('projects') AND name = 'support_members')
    ALTER TABLE projects ADD support_members NVARCHAR(MAX) NULL;

-- Work log entries (the core monthly data)
-- 'hours' deducts lunch time (12:00-13:00) from the row span.
-- 'overtime_hours' tracks time worked before 08:30 or after 17:30.
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'worklogs')
CREATE TABLE worklogs (
    id INT IDENTITY(1,1) PRIMARY KEY,
    member_id INT NOT NULL FOREIGN KEY REFERENCES members(id),
    log_date DATE NOT NULL,
    project NVARCHAR(200),
    task NVARCHAR(500),
    start_time TIME,
    end_time TIME,
    hours AS (
        CASE WHEN start_time IS NOT NULL AND end_time IS NOT NULL
        THEN CAST((
            DATEDIFF(MINUTE, start_time, end_time) -
            CASE WHEN start_time < '13:00' AND end_time > '12:00' THEN
                DATEDIFF(MINUTE,
                    CASE WHEN start_time > '12:00' THEN start_time ELSE '12:00' END,
                    CASE WHEN end_time < '13:00' THEN end_time ELSE '13:00' END
                )
            ELSE 0 END
        ) / 60.0 AS DECIMAL(5,2))
        ELSE NULL END
    ) PERSISTED,
    overtime_hours AS (
        CASE WHEN start_time IS NOT NULL AND end_time IS NOT NULL
        THEN CAST((
            (CASE WHEN start_time < '08:30' THEN 
                DATEDIFF(MINUTE, start_time, CASE WHEN end_time < '08:30' THEN end_time ELSE '08:30' END) 
             ELSE 0 END) +
            (CASE WHEN end_time > '17:30' THEN 
                DATEDIFF(MINUTE, CASE WHEN start_time > '17:30' THEN start_time ELSE '17:30' END, end_time) 
             ELSE 0 END)
        ) / 60.0 AS DECIMAL(5,2))
        ELSE NULL END
    ) PERSISTED,
    status NVARCHAR(50) CHECK (status IN ('Done', 'In Progress', 'Pending', 'Man day')),
    note NVARCHAR(1000),
    created_at DATETIME2 DEFAULT GETDATE(),
    updated_at DATETIME2 DEFAULT GETDATE()
);

-- Index for fast monthly queries
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_worklogs_member_date')
    CREATE NONCLUSTERED INDEX IX_worklogs_member_date
    ON worklogs(member_id, log_date);

-- EmployeeID is the post-migration worklog owner key. Keep legacy member_id
-- only for old rows; it cannot store EmployeeID values because it references
-- the unrelated members.id surrogate key.
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('worklogs') AND name = 'EmployeeID')
    ALTER TABLE worklogs ADD EmployeeID INT NULL;

GO

-- Separate batch: SQL Server validates column refs at compile time.
-- The ALTER TABLE above must commit before any DML/DDL that names EmployeeID.
UPDATE w SET w.EmployeeID = TRY_CAST(m.staff_id AS INT)
FROM worklogs w
JOIN members m ON w.member_id = m.id
WHERE w.EmployeeID IS NULL
  AND m.staff_id IS NOT NULL
  AND TRY_CAST(m.staff_id AS INT) IS NOT NULL;

IF EXISTS (
    SELECT 1
    FROM sys.foreign_key_columns fkc
    JOIN sys.columns c ON fkc.parent_object_id = c.object_id
                      AND fkc.parent_column_id = c.column_id
    WHERE fkc.parent_object_id = OBJECT_ID('worklogs') AND c.name = 'member_id'
)
BEGIN
    DECLARE @fk_worklogs_member NVARCHAR(200);
    SELECT TOP 1 @fk_worklogs_member = fk.name
    FROM sys.foreign_key_columns fkc
    JOIN sys.foreign_keys fk ON fkc.constraint_object_id = fk.object_id
    JOIN sys.columns c ON fkc.parent_object_id = c.object_id
                      AND fkc.parent_column_id = c.column_id
    WHERE fkc.parent_object_id = OBJECT_ID('worklogs') AND c.name = 'member_id';
    IF @fk_worklogs_member IS NOT NULL
        EXEC('ALTER TABLE worklogs DROP CONSTRAINT [' + @fk_worklogs_member + ']');
END

IF EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('worklogs') AND name = 'member_id' AND is_nullable = 0
)
BEGIN
    IF EXISTS (SELECT * FROM sys.indexes WHERE object_id = OBJECT_ID('worklogs') AND name = 'IX_worklogs_member_date')
        DROP INDEX IX_worklogs_member_date ON worklogs;
    ALTER TABLE worklogs ALTER COLUMN member_id INT NULL;
END

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_worklogs_employee_date')
    CREATE NONCLUSTERED INDEX IX_worklogs_employee_date
    ON worklogs(EmployeeID, log_date);

-- Migrate existing installs: add overtime_hours and update hours logic
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('worklogs') AND name = 'overtime_hours')
BEGIN
    -- Drop old 'hours' if it doesn't have lunch logic (we check for overtime_hours as proxy for this migration)
    IF EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('worklogs') AND name = 'hours')
        ALTER TABLE worklogs DROP COLUMN hours;
    
    ALTER TABLE worklogs ADD hours AS (
        CASE WHEN start_time IS NOT NULL AND end_time IS NOT NULL
        THEN CAST((
            DATEDIFF(MINUTE, start_time, end_time) -
            CASE WHEN start_time < '13:00' AND end_time > '12:00' THEN
                DATEDIFF(MINUTE,
                    CASE WHEN start_time > '12:00' THEN start_time ELSE '12:00' END,
                    CASE WHEN end_time < '13:00' THEN end_time ELSE '13:00' END
                )
            ELSE 0 END
        ) / 60.0 AS DECIMAL(5,2))
        ELSE NULL END
    ) PERSISTED;

    ALTER TABLE worklogs ADD overtime_hours AS (
        CASE WHEN start_time IS NOT NULL AND end_time IS NOT NULL
        THEN CAST((
            (CASE WHEN start_time < '08:30' THEN 
                DATEDIFF(MINUTE, start_time, CASE WHEN end_time < '08:30' THEN end_time ELSE '08:30' END) 
             ELSE 0 END) +
            (CASE WHEN end_time > '17:30' THEN 
                DATEDIFF(MINUTE, CASE WHEN start_time > '17:30' THEN start_time ELSE '17:30' END, end_time) 
             ELSE 0 END)
        ) / 60.0 AS DECIMAL(5,2))
        ELSE NULL END
    ) PERSISTED;
END

-- Seed projects
IF NOT EXISTS (SELECT 1 FROM projects WHERE name = 'Warehouse')
    INSERT INTO projects (name) VALUES ('Warehouse');
IF NOT EXISTS (SELECT 1 FROM projects WHERE name = 'Production')
    INSERT INTO projects (name) VALUES ('Production');
IF NOT EXISTS (SELECT 1 FROM projects WHERE name = 'Maintenance')
    INSERT INTO projects (name) VALUES ('Maintenance');
IF NOT EXISTS (SELECT 1 FROM projects WHERE name = 'METER69')
    INSERT INTO projects (name) VALUES ('METER69');

-- Seed members (MUST be before users table creation due to FK constraint)
IF NOT EXISTS (SELECT 1 FROM members WHERE name = 'Boonyarith Akkarasongthum')
    INSERT INTO members (name, department) VALUES ('Boonyarith Akkarasongthum', 'Meter');

GO

-- Users (authentication & authorization) — separate batch with USE to ensure correct DB context
USE MeterWorklog;

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'users')
CREATE TABLE users (
    id INT IDENTITY(1,1) PRIMARY KEY,
    username NVARCHAR(100) NOT NULL UNIQUE,
    password_hash NVARCHAR(256) NOT NULL,
    role NVARCHAR(50) NOT NULL DEFAULT 'Staff'
        CONSTRAINT CK_users_role CHECK (role IN ('Staff', 'Leader', 'Admin', 'Super_Ultimate_ADMIN')),
    member_id INT NULL FOREIGN KEY REFERENCES members(id),
    created_at DATETIME2 DEFAULT GETDATE()
);

-- Migrate existing installs: add account-approval status column.
-- ADD column NOT NULL DEFAULT 'Active' backfills existing rows automatically;
-- DO NOT reference the new column elsewhere in the same batch (SQL Server
-- compiles the whole batch before executing → "Invalid column name").
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('users') AND name = 'status')
    ALTER TABLE users ADD status NVARCHAR(20) NOT NULL
        CONSTRAINT DF_users_status DEFAULT 'Active'
        CONSTRAINT CK_users_status CHECK (status IN ('Pending', 'Active', 'Declined'));

-- Optional: track who reviewed and when, for audit
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('users') AND name = 'reviewed_by')
    ALTER TABLE users ADD reviewed_by INT NULL FOREIGN KEY REFERENCES users(id);
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('users') AND name = 'reviewed_at')
    ALTER TABLE users ADD reviewed_at DATETIME2 NULL;

-- EmployeeID is the post-migration account owner key. The old users.member_id
-- remains nullable for rollback/reference only.
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('users') AND name = 'EmployeeID')
    ALTER TABLE users ADD EmployeeID INT NULL;

GO

-- Separate batch: EmployeeID must exist before any DML references it.
UPDATE u SET u.EmployeeID = TRY_CAST(m.staff_id AS INT)
FROM users u
JOIN members m ON u.member_id = m.id
WHERE u.EmployeeID IS NULL
  AND m.staff_id IS NOT NULL
  AND TRY_CAST(m.staff_id AS INT) IS NOT NULL;

-- Migrate existing installs: rename old 'staff' → 'Staff' and expand CHECK constraint
IF EXISTS (SELECT 1 FROM users WHERE role = 'staff')
    UPDATE users SET role = 'Staff' WHERE role = 'staff';

IF NOT EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE parent_object_id = OBJECT_ID('users')
    AND CAST(definition AS NVARCHAR(MAX)) LIKE '%Leader%'
)
BEGIN
    DECLARE @ckname NVARCHAR(200);
    SELECT @ckname = cc.name
    FROM sys.check_constraints cc
    JOIN sys.columns c ON fkc.parent_object_id = c.object_id
                      AND fkc.parent_column_id = c.column_id
    WHERE cc.parent_object_id = OBJECT_ID('users') AND c.name = 'role';
    IF @ckname IS NOT NULL
        EXEC('ALTER TABLE users DROP CONSTRAINT [' + @ckname + ']');
    ALTER TABLE users ADD CONSTRAINT CK_users_role
        CHECK (role IN ('Staff', 'Leader', 'Admin', 'Super_Ultimate_ADMIN'));
END

-- Seed users (with dynamic member_id lookup)
IF NOT EXISTS (SELECT 1 FROM users WHERE username = 'mengkukkuk')
    INSERT INTO users (username, password_hash, role, member_id)
    VALUES ('mengkukkuk', 'scrypt:32768:8:1$6BpoyyNeineDbHF7$ab9ef6ceb57ba1a3bebe67b798313a149be239686efbe3a622421b287884b61232151accc1ee2b30bed04b6a85e688ab65544354fb434bad28641d650e01145d'
           ,'Super_Ultimate_ADMIN', NULL);

-- App settings (key-value store)
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'settings')
BEGIN
    CREATE TABLE settings (
        [key]   NVARCHAR(100) PRIMARY KEY,
        value   NVARCHAR(MAX) NOT NULL
    );
    INSERT INTO settings ([key], value) VALUES ('worklog_open', '0');
END

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

-- Migrate existing installs: expand worklogs status CHECK to include 'Man day'
IF NOT EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE parent_object_id = OBJECT_ID('worklogs')
    AND CAST(definition AS NVARCHAR(MAX)) LIKE '%Man day%'
)
BEGIN
    DECLARE @ck NVARCHAR(200);
    SELECT @ck = cc.name
    FROM sys.check_constraints cc
    JOIN sys.columns c ON cc.parent_object_id = c.object_id
                      AND cc.parent_column_id = c.column_id
    WHERE cc.parent_object_id = OBJECT_ID('worklogs') AND c.name = 'status';
    IF @ck IS NOT NULL
        EXEC('ALTER TABLE worklogs DROP CONSTRAINT [' + @ck + ']');
    ALTER TABLE worklogs ADD CONSTRAINT CK_worklogs_status
        CHECK (status IN ('Done', 'In Progress', 'Pending', 'Man day'));
END

GO

-- Member skills (each member can have unlimited named skills, level 1–5)
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
    ALTER TABLE member_skills ADD EmployeeID INT NULL;

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

GO

-- Super Admin (and future per-user) security state
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'user_security_state')
CREATE TABLE user_security_state (
    user_id                   INT PRIMARY KEY REFERENCES users(id),
    failed_login_count        INT NOT NULL DEFAULT 0,
    failed_login_window_start DATETIME2 NULL,
    locked_until              DATETIME2 NULL,
    unlock_token_hash         NVARCHAR(256) NULL,
    unlock_token_expires_at   DATETIME2 NULL,
    last_unlock_email_sent_at DATETIME2 NULL,
    updated_at                DATETIME2 NOT NULL DEFAULT GETDATE()
);

-- Security event audit log
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'security_events')
CREATE TABLE security_events (
    id          INT IDENTITY(1,1) PRIMARY KEY,
    user_id     INT NULL REFERENCES users(id),
    username    NVARCHAR(100) NULL,
    event_type  NVARCHAR(100) NOT NULL,
    ip_address  NVARCHAR(100) NULL,
    user_agent  NVARCHAR(500) NULL,
    detail      NVARCHAR(MAX) NULL,
    created_at  DATETIME2 NOT NULL DEFAULT GETDATE()
);

-- Profile avatars on dbo.Employee (PDPA: only the employee themselves OR
-- Super_Ultimate_ADMIN may write; everyone logged-in can read).
-- AvatarPath stores the relative blob path under storage/avatars/, NEVER
-- a user-supplied filename — same defense as the file-share blob layout.
IF EXISTS (SELECT * FROM sys.tables WHERE name = 'Employee' AND SCHEMA_NAME(schema_id) = 'dbo')
BEGIN
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Employee') AND name = 'AvatarPath')
        ALTER TABLE dbo.Employee ADD AvatarPath NVARCHAR(300) NULL;
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Employee') AND name = 'AvatarMime')
        ALTER TABLE dbo.Employee ADD AvatarMime NVARCHAR(100) NULL;
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Employee') AND name = 'AvatarUpdatedAt')
        ALTER TABLE dbo.Employee ADD AvatarUpdatedAt DATETIME2 NULL;
END
