#requires -Version 5.1
function New-AedReadConnectionString([bool]$WindowsAuthentication) {
    # PowerShell treats members on this builder as dictionary keys. Use SQL keywords explicitly.
    $builder=[Data.SqlClient.SqlConnectionStringBuilder]::new()
    $builder['Data Source']='lpc:(local)\A2006'
    $builder['Initial Catalog']='AED_TEST'
    $builder['Connect Timeout']=8
    $builder['Pooling']=$false
    $builder['Enlist']=$false
    $builder['Persist Security Info']=$false
    $builder['ConnectRetryCount']=0
    $builder['Application Name']='FeedX AutoCount Connector SQL'
    $builder['Integrated Security']=$WindowsAuthentication
    return $builder.ConnectionString
}
