-- Bound @reader parameter supplied from the selected book's saved credential. Metadata only.
SET NOCOUNT ON;

IF DB_NAME() COLLATE Latin1_General_100_BIN2 <> N'AED_TEST'
   OR ISNULL(CONVERT(nvarchar(128), SERVERPROPERTY('InstanceName')), N'') <> N'A2006'
   OR ISNULL(IS_SRVROLEMEMBER(N'sysadmin'), 0) <> 1
    THROW 51001, 'Run in AED_TEST on A2006 as the local SQL administrator.', 1;

IF @reader IS NULL OR LEN(@reader) <> 41 OR LEFT(@reader, 9) COLLATE Latin1_General_100_BIN2 <> N'feedx_ro_'
   OR SUBSTRING(@reader, 10, 32) COLLATE Latin1_General_100_BIN2 LIKE N'%[^a-f0-9]%'
    THROW 51002, 'Enter the exact local pending FeedX reader login name.', 1;

DECLARE @sid varbinary(16) = CONVERT(varbinary(16), N'0x'+SUBSTRING(@reader, 10, 32), 1);
DECLARE @loginId int, @userId int, @disabled bit, @schemaId int;
DECLARE @objectId int = OBJECT_ID(N'dbo.DeptChangeLog');
SELECT @loginId = principal_id, @disabled = is_disabled FROM sys.sql_logins WHERE name=@reader AND sid=@sid;
SELECT @userId = principal_id FROM sys.database_principals WHERE name=@reader AND sid=@sid AND type='S';
SELECT @schemaId = schema_id FROM sys.objects WHERE object_id=@objectId;
IF @loginId IS NULL OR @userId IS NULL OR @schemaId IS NULL
    THROW 51003, 'Pending login/user SID or dbo.DeptChangeLog could not be matched. Stop before any grant changes.', 1;

SELECT @objectId AS objectId,@userId AS userId,@loginId AS loginId, QUOTENAME(s.name)+N'.'+QUOTENAME(o.name) AS securable, o.type_desc, @disabled AS loginDisabled,
       CASE WHEN o.principal_id=@userId THEN N'dedicated reader' ELSE USER_NAME(o.principal_id) END AS explicitObjectOwner,
       CASE WHEN s.principal_id=@userId THEN N'dedicated reader' ELSE USER_NAME(s.principal_id) END AS schemaOwner,
       CASE WHEN d.owner_sid=@sid THEN 1 ELSE 0 END AS readerOwnsDatabase,
       CASE WHEN s.principal_id=@userId THEN 1 ELSE 0 END AS readerOwnsSchema,
       CASE WHEN COALESCE(o.principal_id,s.principal_id)=@userId THEN 1 ELSE 0 END AS readerOwnsObject,
       CASE WHEN EXISTS (
           SELECT 1 FROM sys.triggers t JOIN sys.trigger_events e ON e.object_id=t.object_id
           WHERE t.parent_class=0 AND t.is_disabled=0 AND e.type_desc LIKE N'REVOKE[_]%'
       ) OR EXISTS (
           SELECT 1 FROM sys.server_triggers t JOIN sys.server_trigger_events e ON e.object_id=t.object_id
           WHERE t.is_disabled=0 AND e.type_desc LIKE N'REVOKE[_]%'
       ) THEN 1 ELSE 0 END AS revokeTrigger
FROM sys.objects o JOIN sys.schemas s ON s.schema_id=o.schema_id
JOIN sys.databases d ON d.database_id=DB_ID()
WHERE o.object_id=@objectId;

;WITH roles AS (
    SELECT principal_id FROM sys.database_principals WHERE principal_id=@userId OR name=N'public'
    UNION ALL
    SELECT m.role_principal_id FROM sys.database_role_members m JOIN roles r ON m.member_principal_id=r.principal_id
), members AS (SELECT DISTINCT principal_id FROM roles)
SELECT CASE WHEN g.principal_id=@userId THEN N'dedicated reader' ELSE g.name END AS principal,
       g.type_desc, g.is_fixed_role,
       CASE WHEN p.grantor_principal_id=DATABASE_PRINCIPAL_ID(N'dbo') THEN N'dbo' WHEN p.grantor_principal_id IS NOT NULL THEN N'other' END AS grantor,
       CASE WHEN p.class=0 THEN N'DATABASE' WHEN p.class=3 THEN N'SCHEMA'
            WHEN p.minor_id=0 THEN N'OBJECT' WHEN p.minor_id>0 THEN N'COLUMN' END AS grantScope,
       CASE WHEN p.class=1 AND p.minor_id>0 THEN COL_NAME(@objectId,p.minor_id) END AS columnName, p.permission_name, p.state_desc
FROM members m JOIN sys.database_principals g ON g.principal_id=m.principal_id
LEFT JOIN sys.database_permissions p ON p.grantee_principal_id=m.principal_id
 AND (p.class=0 OR (p.class=3 AND p.major_id=@schemaId) OR (p.class=1 AND p.major_id=@objectId))
 AND p.permission_name IN ('SELECT','CONTROL')
ORDER BY principal, grantScope, columnName, p.permission_name;

;WITH roles AS (
    SELECT principal_id FROM sys.server_principals WHERE principal_id=@loginId OR (type='R' AND name=N'public')
    UNION ALL
    SELECT m.role_principal_id FROM sys.server_role_members m JOIN roles r ON m.member_principal_id=r.principal_id
), members AS (SELECT DISTINCT principal_id FROM roles)
SELECT CASE WHEN g.principal_id=@loginId THEN N'dedicated reader' ELSE g.name END AS principal,
       g.type_desc, g.is_fixed_role, p.permission_name, p.state_desc
FROM members m JOIN sys.server_principals g ON g.principal_id=m.principal_id
LEFT JOIN sys.server_permissions p ON p.grantee_principal_id=m.principal_id
 AND p.class=100 AND p.permission_name IN ('SELECT ALL USER SECURABLES','CONTROL SERVER')
ORDER BY principal, p.permission_name;

-- Take the effective snapshot under the pending login without enabling it or using its password.
DECLARE @inspect nvarchar(max) = N'EXECUTE AS LOGIN = '+QUOTENAME(@reader,'''')+N';
BEGIN TRY
    IF DB_NAME() <> N''AED_TEST''
        THROW 51004, ''Impersonated database context did not match AED_TEST.'', 1;
    SELECT CASE WHEN USER_ID()=@expectedUser THEN 1 ELSE 0 END AS readerMappingMatches,
           HAS_PERMS_BY_NAME(N''dbo.DeptChangeLog'',N''OBJECT'',N''SELECT'') AS objectSelect,
           HAS_PERMS_BY_NAME(N''dbo'',N''SCHEMA'',N''SELECT'') AS schemaSelect,
           HAS_PERMS_BY_NAME(DB_NAME(),N''DATABASE'',N''SELECT'') AS databaseSelect;
    SELECT permission_name, subentity_name AS columnName
    FROM sys.fn_my_permissions(N''[dbo].[DeptChangeLog]'',N''OBJECT'')
    ORDER BY permission_name, subentity_name;
    SELECT name AS columnName, HAS_PERMS_BY_NAME(N''dbo.DeptChangeLog'',N''OBJECT'',N''SELECT'',name,N''COLUMN'') AS columnSelect
    FROM sys.columns WHERE object_id=@target ORDER BY column_id;
    REVERT;
END TRY
BEGIN CATCH
    REVERT;
    THROW;
END CATCH;';
EXEC sys.sp_executesql @inspect, N'@expectedUser int, @target int', @expectedUser=@userId, @target=@objectId;
