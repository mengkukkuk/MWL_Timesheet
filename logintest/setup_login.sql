-- Step 1: Create a login for the SYSTEM account
USE master;
CREATE LOGIN [NT AUTHORITY\SYSTEM] FROM WINDOWS;

-- Step 2: Give it access to the MeterWorklog database
USE MeterWorklog;
CREATE USER [NT AUTHORITY\SYSTEM] FOR LOGIN [NT AUTHORITY\SYSTEM];

-- Step 3: Grant db_owner role (full access to that DB)
ALTER ROLE db_owner ADD MEMBER [NT AUTHORITY\SYSTEM];