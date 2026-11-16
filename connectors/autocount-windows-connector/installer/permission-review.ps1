#requires -Version 5.1
function Get-DeptPermissionEvidence($Admin,[string]$Login,$Transaction=$null) {
    $command=$Admin.CreateCommand()
    try {
        if ($Transaction) { $command.Transaction=$Transaction }
        $command.CommandText=[IO.File]::ReadAllText((Join-Path $PSScriptRoot '../sql/review-deptchangelog-permissions.sql'))
        $command.Parameters.Add('@reader',[Data.SqlDbType]::NVarChar,128).Value=$Login
        $adapter=[Data.SqlClient.SqlDataAdapter]::new($command)
        $data=[Data.DataSet]::new()
        try {
            $null=$adapter.Fill($data)
            return Convert-DeptPermissionEvidence $data
        } finally { $data.Dispose(); $adapter.Dispose() }
    } finally { $command.Dispose() }
}

function Convert-DeptPermissionEvidence([Data.DataSet]$Data) {
    if ($data.Tables.Count -ne 6 -or $data.Tables[0].Rows.Count -ne 1 -or $data.Tables[3].Rows.Count -ne 1) {
        Stop-ReadPoc 'READER_REVIEW_INCOMPLETE'
    }
    $object=$data.Tables[0].Rows[0]
    $scopes=$data.Tables[3].Rows[0]
    $dbPermissions=@($data.Tables[1].Rows | Where-Object { [string]$_.permission_name })
    $serverPermissions=@($data.Tables[2].Rows | Where-Object { [string]$_.permission_name })
    $roles=@(@($data.Tables[1].Rows)+@($data.Tables[2].Rows) | Where-Object { $_.principal -notin @('public','dedicated reader') } |
        ForEach-Object { "$($_.type_desc): $($_.principal)" } | Sort-Object -Unique)
    $columns=@($data.Tables[5].Rows | Where-Object { $_.columnSelect -eq 1 } | ForEach-Object { [string]$_.columnName })
    $objectSelect=$scopes.objectSelect -eq 1
    $effective=@($data.Tables[4].Rows)
    $hasSelect=$objectSelect -or $columns.Count -gt 0 -or @($effective | Where-Object permission_name -EQ 'SELECT').Count -gt 0
    $broader=$scopes.schemaSelect -eq 1 -or $scopes.databaseSelect -eq 1
    $ownership=$object.readerOwnsDatabase -eq 1 -or $object.readerOwnsSchema -eq 1 -or $object.readerOwnsObject -eq 1 -or
        $object.explicitObjectOwner -ceq 'public' -or $object.schemaOwner -ceq 'public'
    $revokeTrigger=$object.revokeTrigger -eq 1
    # Only an isolated, plain grant from dbo can be revoked without altering shared access or cascading.
    $repairable=$objectSelect -and $scopes.readerMappingMatches -eq 1 -and $object.loginDisabled -and $object.type_desc -ceq 'USER_TABLE' -and $dbPermissions.Count -eq 1 -and
        $dbPermissions[0].principal -ceq 'dedicated reader' -and $dbPermissions[0].grantScope -ceq 'OBJECT' -and
        $dbPermissions[0].permission_name -ceq 'SELECT' -and $dbPermissions[0].state_desc -ceq 'GRANT' -and
        $dbPermissions[0].grantor -ceq 'dbo' -and -not ($ownership -or $broader -or $roles.Count -or $serverPermissions.Count -or $revokeTrigger)

    $triggerSelect=$objectSelect -and (Test-TriggerSelectMetadata $object.objectType 'SELECT' '')
    $otherEffective=@($effective | Where-Object {
        $_.permission_name -notin @('VIEW DEFINITION','VIEW SECURITY DEFINITION','VIEW PERFORMANCE DEFINITION') -and
            -not (Test-TriggerSelectMetadata $object.objectType $_.permission_name ([string]$_.columnName))
    })
    $lines=@("AED_TEST / [dbo].[DeptChangeLog] ($($object.type_desc))",
        "Effective SELECT: object $objectSelect; schema $($scopes.schemaSelect -eq 1); database $($scopes.databaseSelect -eq 1).")
    if ($triggerSelect) {
        $lines+='The object-level SELECT result describes a trigger and does not grant access to data rows.'
        if ($otherEffective.Count) { $lines+="Other effective permissions: $($otherEffective.permission_name -join ', ')." }
    }
    if ($columns.Count) { $lines+="Columns with SELECT: $($columns -join ', ')." }
    foreach ($grant in $dbPermissions) {
        $column=if ([string]$grant.columnName) { " ($($grant.columnName))" }
        $lines+="Database catalog: $($grant.principal) has $($grant.state_desc) $($grant.permission_name) at $($grant.grantScope) scope$column, from $($grant.grantor)."
    }
    foreach ($grant in $serverPermissions) { $lines+="Server catalog: $($grant.principal) has $($grant.state_desc) $($grant.permission_name)." }
    if ($scopes.readerMappingMatches -ne 1) { $lines+='SQL Server resolved this login to a different database security context.' }
    if ($roles.Count) { $lines+="Additional memberships: $($roles -join ', ')." }
    $owner=if ([string]$object.explicitObjectOwner) { $object.explicitObjectOwner } else { 'inherits schema owner' }
    $lines+="Ownership: object $owner; schema $($object.schemaOwner); dedicated reader owns database $($object.readerOwnsDatabase -eq 1)."
    if ($revokeTrigger) { $lines+='An enabled SQL permission-change trigger requires administrator review before a revoke.' }
    $recommendation=if ($repairable) { 'Review & Repair can revoke this one direct SELECT grant. It will then rerun book authorization.' }
        elseif ($triggerSelect -and -not ($columns.Count -or $otherEffective.Count -or $dbPermissions.Count -or $serverPermissions.Count -or $roles.Count -or $ownership -or $broader)) {
            'Retry book authorization. The standard checks still verify the reader and its remaining permissions.'
        } elseif ($hasSelect -and -not ($dbPermissions.Count -or $serverPermissions.Count -or $roles.Count -or $ownership -or $broader)) {
            'SQL reports SELECT but did not identify an attributable grant or ownership path. Ask your SQL administrator to investigate the effective security context.'
        } elseif ($hasSelect) { 'Ask your SQL administrator to review the reported grants, roles, and ownership for a restriction scoped to this reader.' }
        else { 'No effective SELECT was found for this object. Retry book authorization to check the rest of the reader permissions.' }
    return @{
        repairable=$repairable;hasSelect=$hasSelect;readerMappingMatches=($scopes.readerMappingMatches -eq 1);broader=$broader;ownership=$ownership
        grantCount=$dbPermissions.Count+$serverPermissions.Count;hasRoles=[bool]$roles.Count
        fingerprint="$($object.objectId):$($object.userId):$($object.loginId)"
        lines=@($lines+$recommendation | ForEach-Object { $_ -replace '[\p{C}]','?' })
    }
}

function Invoke-DeptPermissionReview([string]$Instance,[string]$Database,$ConfirmRepair=$null) {
    if ($Instance -ine 'A2006' -or $Database -cne 'AED_TEST') { Stop-ReadPoc 'READER_REVIEW_TARGET_UNSUPPORTED' }
    $admin=$null
    $lock=$null
    $credential=$null
    try {
        $admin=Open-LocalBook $Instance $Database
        $identity=Assert-ReadIdentity $admin $Database (Get-InstanceIdentity $Instance)
        if ($identity.sysadmin -ne 1) { Stop-ReadPoc 'AUTHORIZED_WINDOWS_SYSADMIN_REQUIRED' }
        $company=Read-BookCompany $admin $Database
        $directory=Get-RunLocalPath $company.key -BaseDirectory $deviceRoot
        $bookPath=Join-Path $directory 'book.json'
        $pendingPath=Join-Path $directory 'reader.pending.credential.xml'
        $activePath=Join-Path $directory 'reader.credential.xml'
        if (-not (Test-Path -LiteralPath $bookPath)) { Stop-ReadPoc 'READER_REVIEW_CREDENTIAL_MISSING' }
        $lock=[IO.File]::Open((Join-Path $directory 'authorization.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
        $book=[IO.File]::ReadAllText($bookPath) | ConvertFrom-Json
        if ($book.key -cne $company.key -or $book.database -cne $Database -or $book.instance -ine $Instance) {
            Stop-ReadPoc 'BOOK_COMPANY_IDENTITY_CHANGED'
        }
        $active=Test-Path -LiteralPath $activePath
        $pending=Test-Path -LiteralPath $pendingPath
        if (-not ($active -or $pending)) { Stop-ReadPoc 'READER_REVIEW_CREDENTIAL_MISSING' }
        if ($active -and $pending) { Stop-ReadPoc 'READER_REPAIR_STATE_CHANGED' }
        $credential=Import-Clixml -LiteralPath $(if ($active) { $activePath } else { $pendingPath })
        if ($credential -isnot [Management.Automation.PSCredential] -or $credential.UserName -cnotmatch '^feedx_ro_[a-f0-9]{32}$') {
            Stop-ReadPoc 'READER_CREDENTIAL_PRINCIPAL_MISMATCH'
        }
        $login=$credential.UserName
        $evidence=Get-DeptPermissionEvidence $admin $login
        if ($active -and $evidence.repairable) {
            $evidence.repairable=$false
            $evidence.lines[-1]='This reader is already installed. Ask your SQL administrator to review the direct grant before changing access.'
        }
        if (-not ($ConfirmRepair -and $evidence.repairable)) { return $evidence }

        $statement="REVOKE SELECT ON OBJECT::[dbo].[DeptChangeLog] FROM $(Quote-ReadIdentifier $login) AS [dbo];"
        if (-not (& $ConfirmRepair $statement)) { return $evidence }

        $transaction=$admin.BeginTransaction([Data.IsolationLevel]::Serializable)
        try {
            $current=Get-DeptPermissionEvidence $admin $login $transaction
            if (-not $current.repairable -or $current.fingerprint -cne $evidence.fingerprint) { Stop-ReadPoc 'READER_REPAIR_STATE_CHANGED' }
            Invoke-ReaderSecurityCommand $admin $transaction $statement $null
            $after=Get-DeptPermissionEvidence $admin $login $transaction
            if ($after.hasSelect -or -not $after.readerMappingMatches -or $after.broader -or $after.ownership -or $after.hasRoles -or $after.grantCount -or
                $after.fingerprint -cne $current.fingerprint) { Stop-ReadPoc 'READER_REPAIR_VERIFICATION_FAILED' }
            $transaction.Commit()
        } finally { $transaction.Dispose() }
        $after.lines[-1]='Direct SELECT removed and rechecked. The saved reader will now be tested through normal book authorization.'
        $after.repaired=$true
        $after.bookKey=$company.key
        $after.startDate=$book.startDate
        $after.reader=$login
        return $after
    } finally {
        if ($credential -is [Management.Automation.PSCredential]) { $credential.Password.Dispose() }
        if ($lock) { $lock.Dispose() }
        if ($admin) { $admin.Dispose() }
    }
}
