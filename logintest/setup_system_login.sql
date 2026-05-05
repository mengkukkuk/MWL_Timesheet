-- Robust SQL Script for SYSTEM account access
-- Target Database: MeterWorklog

USE [master];
GO

-- 1. Create Login for SYSTEM if it doesn't exist
IF NOT EXISTS (SELECT * FROM sys.server_principals WHERE name = 'NT AUTHORITY\SYSTEM')
BEGIN
    PRINT 'Creating Login for NT AUTHORITY\SYSTEM...';
    CREATE LOGIN [NT AUTHORITY\SYSTEM] FROM WINDOWS WITH DEFAULT_DATABASE=[master];
END
ELSE
BEGIN
    PRINT 'Login for NT AUTHORITY\SYSTEM already exists.';
END
GO

-- 2. Switch to target database
-- Note: The script assumes MeterWorklog exists. 
IF DB_ID('MeterWorklog') IS NOT NULL
BEGIN
    USE [MeterWorklog];
    
    -- 3. Create User in the database if it doesn't exist
    IF NOT EXISTS (SELECT * FROM sys.database_principals WHERE name = 'NT AUTHORITY\SYSTEM')
    BEGIN
        PRINT 'Creating User for NT AUTHORITY\SYSTEM in MeterWorklog...';
        CREATE USER [NT AUTHORITY\SYSTEM] FOR LOGIN [NT AUTHORITY\SYSTEM];
    END
    ELSE
    BEGIN
        PRINT 'User for NT AUTHORITY\SYSTEM already exists in MeterWorklog.';
    END

    -- 4. Grant db_owner role
    PRINT 'Adding NT AUTHORITY\SYSTEM to db_owner role...';
    ALTER ROLE [db_owner] ADD MEMBER [NT AUTHORITY\SYSTEM];
END
ELSE
BEGIN
    PRINT 'Error: Database [MeterWorklog] does not exist on this server.';
END
GO
