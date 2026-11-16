#requires -Version 5.1
function Get-StagingUploadErrorKind([string]$ResponseBody) {
    if (-not $ResponseBody -or $ResponseBody.Length -gt 8192) { return }
    try { $reply=ConvertFrom-Json -InputObject $ResponseBody -ErrorAction Stop } catch { return }
    switch -Regex ("$($reply.code)/$($reply.message)") {
        '^(22007|22P02)/invalid input syntax for type date:' { return 'upload_date_format' }
        '^PT422/Invalid accounting snapshot envelope$' { return 'upload_envelope' }
        '^PT422/Invalid accounting record shape$' { return 'upload_record_shape' }
        '^PT422/Invalid or duplicate accounting record$' { return 'upload_record_values' }
        '^PT409/Request identifier payload conflict$' { return 'upload_request_conflict' }
    }
}
function Stop-StagingRequest($ErrorRecord,[switch]$AccountingEndpoint) {
    $response=$ErrorRecord.Exception.Response
    if (-not $response) { Stop-ReadPoc 'STAGING_HTTPS_UNAVAILABLE' }
    $status=[int]$response.StatusCode
    $failure=[InvalidOperationException]::new("STAGING_HTTP_$status")
    if ($AccountingEndpoint -and $status -in @(400,409,422)) {
        $kind=Get-StagingUploadErrorKind $ErrorRecord.ErrorDetails.Message
        if (-not $kind -and $response -is [Net.HttpWebResponse]) {
            try {
                $stream=$response.GetResponseStream()
                if ($stream) {
                    $reader=[IO.StreamReader]::new($stream)
                    try {
                        $buffer=New-Object char[] 8193
                        $count=$reader.ReadBlock($buffer,0,$buffer.Length)
                        if ($count -gt 0 -and $count -lt $buffer.Length) { $kind=Get-StagingUploadErrorKind (-join $buffer[0..($count-1)]) }
                    } finally { $reader.Dispose() }
                }
            } catch {}
        }
        if ($kind) { $failure.Data['FeedXUploadErrorKind']=$kind }
    }
    throw $failure
}
