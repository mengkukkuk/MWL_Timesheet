USE MeterWorklog;
	SELECT name, type_desc 
	FROM sys.database_principals
	WHERE name = 'NT AUTHORITY\SYSTEM';