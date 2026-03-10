Add-Type -AssemblyName Microsoft.VisualBasic
Add-Type -AssemblyName System.Windows.Forms
$wshell = New-Object -ComObject wscript.shell;
$success = $wshell.AppActivate('Login')
if ($success) {
    Start-Sleep -Milliseconds 500
    [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
    Write-Host "Sent ENTER to Login dialog."
} else {
    Write-Host "Could not find Login dialog."
}
