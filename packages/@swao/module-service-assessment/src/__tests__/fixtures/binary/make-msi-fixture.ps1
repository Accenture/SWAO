# Builds fixture.msi: a minimal real Windows Installer database with a Property table.
# Run on Windows (Windows Installer COM, no extra tools):
#   powershell -ExecutionPolicy Bypass -File make-msi-fixture.ps1
$ErrorActionPreference = 'Stop'
$path = Join-Path $PSScriptRoot 'fixture.msi'
if (Test-Path $path) { Remove-Item $path -Force }
$installer = New-Object -ComObject WindowsInstaller.Installer
$db = $installer.OpenDatabase([string]$path, [int]3)
function Invoke-Sql([string]$sql) { $view = $db.OpenView($sql); $view.Execute(); $view.Close() }
Invoke-Sql 'CREATE TABLE `Property` (`Property` CHAR(72) NOT NULL, `Value` LONGCHAR NOT NULL LOCALIZABLE PRIMARY KEY `Property`)'
Invoke-Sql "INSERT INTO ``Property`` (``Property``, ``Value``) VALUES ('ProductName', 'Example Imaging Suite')"
Invoke-Sql "INSERT INTO ``Property`` (``Property``, ``Value``) VALUES ('ProductVersion', '5.3.2.1')"
Invoke-Sql "INSERT INTO ``Property`` (``Property``, ``Value``) VALUES ('Manufacturer', 'Example Medical Systems GmbH')"
Invoke-Sql "INSERT INTO ``Property`` (``Property``, ``Value``) VALUES ('ProductCode', '{11111111-2222-3333-4444-555555555555}')"
Invoke-Sql "INSERT INTO ``Property`` (``Property``, ``Value``) VALUES ('INSTALLDIR', 'ProgramFilesFolder\ExampleImaging')"
$db.Commit()
[void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($db)
Write-Output "wrote $path ($((Get-Item $path).Length) bytes)"
