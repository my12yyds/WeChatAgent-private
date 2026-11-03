param(
 [Parameter(Mandatory=$true)][string]$TestSetup,
 [Parameter(Mandatory=$true)][string]$Launcher,
 [Parameter(Mandatory=$true)][string]$TestDirectory
)
$ErrorActionPreference='Stop'
$setup=(Resolve-Path -LiteralPath $TestSetup).Path
$launcherPath=(Resolve-Path -LiteralPath $Launcher).Path
if((Get-Item -LiteralPath $setup).VersionInfo.ProductName -ne 'WeChatGirl Installer Test'){throw 'Only an isolated InstallerTestMode setup may be used.'}
$testRoot=[IO.Path]::GetFullPath($TestDirectory).TrimEnd('\')
if(Test-Path -LiteralPath $testRoot){throw 'Use a new isolated test directory.'}
New-Item -ItemType Directory -Path $testRoot|Out-Null
$install=Join-Path $testRoot '中文安装目录'
$data=Join-Path $testRoot '独立数据'
function Invoke-Gui([string]$File,[string]$Arguments){
 if($Arguments){$process=Start-Process -FilePath $File -ArgumentList $Arguments -WindowStyle Hidden -Wait -PassThru}
 else {$process=Start-Process -FilePath $File -WindowStyle Hidden -Wait -PassThru}
 return $process.ExitCode
}
function Assert-GuiSubsystem([string]$File){
 $bytes=[IO.File]::ReadAllBytes($File)
 $pe=[BitConverter]::ToInt32($bytes,60)
 if([BitConverter]::ToUInt16($bytes,$pe+24+68) -ne 2){throw "Not a native Windows GUI executable: $File"}
}
Assert-GuiSubsystem $setup
Assert-GuiSubsystem $launcherPath
if((Invoke-Gui $setup "/S /D=$install") -ne 0){throw 'Fresh install failed.'}
$uninstaller=Join-Path $install 'app\Uninstall WeChatGirl.exe'
Assert-GuiSubsystem $uninstaller
foreach($name in @('config','plugins','roles','state')){
 New-Item -ItemType Directory -Path "$data\workspace\$name" -Force|Out-Null
 [IO.File]::WriteAllText("$data\workspace\$name\fixture.txt","fictional-$name")
}
[IO.File]::WriteAllText("$install\app\storage.ini","[Storage]`r`nlayoutVersion=1`r`ndataHome=$data`r`nmigrationSource=`r`n",[Text.Encoding]::Unicode)
[IO.File]::WriteAllText("$install\app\user-added.txt",'preserve')
if((Invoke-Gui $setup "/S /D=$install") -ne 0){throw 'Upgrade failed.'}
if(!(Get-Content "$install\app\storage.ini" -Raw).Contains("dataHome=$data")){throw 'Data location changed.'}
if(!(Test-Path "$install\app\user-added.txt")){throw 'Upgrade removed a user-added file.'}
$dummySource=Join-Path $testRoot 'fixture.cs'
$dummy=@'
using System;
using System.IO;
using System.Threading;
class Fixture {
 [STAThread] static void Main(string[] args) {
  if(args.Length==1 && args[0]=="--hold") {Thread.Sleep(Timeout.Infinite);return;}
  File.WriteAllLines(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"launch-result.txt"),new string[]{Environment.CurrentDirectory,Environment.GetEnvironmentVariable("ELECTRON_RUN_AS_NODE")??"absent"});
 }
}
'@
[IO.File]::WriteAllText($dummySource,$dummy)
$compiler=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$dummyExe=Join-Path $install 'app\WeChatGirl.exe'
& $compiler /nologo /target:winexe /out:$dummyExe $dummySource
if($LASTEXITCODE -ne 0){throw 'Fixture compilation failed.'}
Copy-Item -LiteralPath $launcherPath -Destination (Join-Path $install 'WeChatGirl.exe')
$oldElectronEnvironment=$env:ELECTRON_RUN_AS_NODE
try {
 $env:ELECTRON_RUN_AS_NODE='1'
 if((Invoke-Gui (Join-Path $install 'WeChatGirl.exe') '') -ne 0){throw 'GUI launcher failed.'}
} finally {$env:ELECTRON_RUN_AS_NODE=$oldElectronEnvironment}
$launchReport=Get-Content (Join-Path $install 'app\launch-result.txt')
if($launchReport[0] -ne (Join-Path $install 'app') -or $launchReport[1] -ne 'absent'){throw 'Incorrect launch working directory or inherited Electron environment.'}
$busy=Start-Process -FilePath $dummyExe -ArgumentList '--hold' -WindowStyle Hidden -PassThru
try {
 if((Invoke-Gui $launcherPath ('--check-running "'+(Join-Path $install 'app')+'"')) -ne 10){throw 'Busy process not detected.'}
 if((Invoke-Gui $setup "/S /D=$install") -eq 0){throw 'Installer modified a running application.'}
 $busyHash=(Get-FileHash -LiteralPath $dummyExe).Hash
 # NSIS restarts the uninstaller from TEMP; the outer process may report zero even when the child refuses removal.
 $null=Invoke-Gui $uninstaller '/S'
 if(!(Test-Path $dummyExe)){throw 'Busy application removed.'}
 if((Get-FileHash -LiteralPath $dummyExe).Hash -ne $busyHash -or !(Test-Path "$install\app\resources\app\main.cjs")){throw 'Busy application was modified.'}
} finally {
 if(!$busy.HasExited -and $busy.MainModule.FileName -eq $dummyExe){$busy.Kill();$busy.WaitForExit()}
}
if((Invoke-Gui $uninstaller '/S') -ne 0){throw 'Uninstall failed.'}
if(Test-Path $dummyExe){throw 'Installed application remains.'}
foreach($file in @('storage.ini','user-added.txt','launch-result.txt')){if(!(Test-Path "$install\app\$file")){throw "Preserved file deleted: $file"}}
foreach($name in @('config','plugins','roles','state')){if((Get-Content "$data\workspace\$name\fixture.txt" -Raw) -ne "fictional-$name"){throw 'User data changed.'}}
$result=[ordered]@{passed=$true;freshInstall=$true;upgrade=$true;chinesePaths=$true;customDataLocation=$true;uninstallRetention=$true;busyInstallRejected=$true;busyUninstallRejected=$true;guiSubsystem=$true;launcherEnvironment=$true;realChatMessagesSent=$false}
$result|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $testRoot 'RESULTS.json') -Encoding utf8
$result|ConvertTo-Json
