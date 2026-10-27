# Proteccion temporal de los comandos de red de RetroArch mientras PokeOBS esta abierto.
#
# Lo lanza Iniciar-PokeOBS.bat con permisos de administrador (aviso de Windows).
# 1. Crea una regla del Firewall de Windows que bloquea la ENTRADA desde la red
#    al puerto UDP de los comandos de red de RetroArch (55355 por defecto).
#    El trafico interno del propio PC (127.0.0.1) no pasa por el firewall, asi
#    que PokeOBS sigue hablando con RetroArch.
# 2. Deja una tarea programada de limpieza por si el PC se apaga con PokeOBS
#    abierto: al arrancar Windows o al iniciar sesion borra la regla y se borra
#    a si misma.
# 3. Espera a que se cierre el servidor de PokeOBS (por su PID).
# 4. Borra la regla y la tarea: el equipo queda exactamente como estaba.
#
# Uso: firewall-guard.ps1 -DataDir <carpeta data> [-DryRun]
#      firewall-guard.ps1 -Remove     (borra la regla y la tarea, si quedo algo)
# -DryRun no toca el firewall y registra una tarea de prueba del usuario actual.
param(
  [string]$DataDir = '',
  [switch]$DryRun,
  [switch]$Remove
)

$RuleName = 'PokeOBS - Proteger comandos de red de RetroArch'
$TaskName = if ($DryRun) { 'PokeOBS - Prueba de limpieza' } else { 'PokeOBS - Limpiar proteccion de red' }
$PidFile = if ($DataDir) { Join-Path $DataDir 'pokeobs.pid' } else { '' }
$LogFile = if ($DataDir) { Join-Path $DataDir 'firewall-guard.log' } else { '' }

function Log([string]$msg) {
  $line = '{0} {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
  if ($LogFile) { Add-Content -Path $LogFile -Value $line -Encoding UTF8 }
  Write-Output $line
}

function Remove-Rule {
  if ($DryRun) { Log '[prueba] se borraria la regla'; return }
  Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  Log 'Regla borrada.'
}

function Remove-CleanupTask {
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Log 'Tarea de limpieza borrada.'
  }
}

# Tarea de un solo uso: borra la regla (si sigue) y despues se borra a si misma.
function Register-CleanupTask {
  $remove = if ($DryRun) {
    "Add-Content -Path '$LogFile' -Value ('{0} [prueba] limpieza de arranque ejecutada' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))"
  } else {
    "Get-NetFirewallRule -DisplayName '$RuleName' -ErrorAction SilentlyContinue | Remove-NetFirewallRule"
  }
  $script = "$remove; Unregister-ScheduledTask -TaskName '$TaskName' -Confirm:`$false -ErrorAction SilentlyContinue"
  $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($script))
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand $encoded"
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 5)
  if ($DryRun) {
    # Sin permisos de administrador: solo al iniciar sesion y como el usuario actual.
    $triggers = @(New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME)
    $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive
  } else {
    # Arranque de Windows (antes de iniciar sesion) e inicio de sesion: con el
    # "inicio rapido" de Windows el disparador de arranque no siempre se activa.
    $triggers = @((New-ScheduledTaskTrigger -AtStartup), (New-ScheduledTaskTrigger -AtLogOn))
    $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
  }
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $triggers -Principal $principal -Settings $settings `
    -Description 'Creada por PokeOBS. Si el PC se apago con PokeOBS abierto, quita su regla temporal del firewall y se borra a si misma.' `
    -Force | Out-Null
  Log 'Tarea de limpieza registrada (por si el PC se apaga con PokeOBS abierto).'
}

function Get-Port {
  $port = 55355
  $settings = if ($DataDir) { Join-Path $DataDir 'settings.json' } else { '' }
  if ($settings -and (Test-Path $settings)) {
    try {
      $p = (Get-Content $settings -Raw | ConvertFrom-Json).auto.port
      if ($p -is [int] -or $p -is [long]) { $port = [int]$p }
    } catch { }
  }
  return $port
}

if ($Remove) { Remove-Rule; Remove-CleanupTask; exit 0 }
if (-not $DataDir) { Write-Error 'Falta -DataDir'; exit 2 }

try {
  $port = Get-Port
  # Si quedo una regla de una sesion anterior, se sustituye.
  if (-not $DryRun) {
    Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    New-NetFirewallRule -DisplayName $RuleName `
      -Description 'Creada por PokeOBS mientras esta abierto; se borra sola al cerrarlo. Bloquea ordenes a RetroArch desde otros equipos de la red.' `
      -Direction Inbound -Protocol UDP -LocalPort $port -Action Block -Profile Any | Out-Null
  }
  Log "Regla creada: entrada UDP $port bloqueada desde la red."
  try {
    Register-CleanupTask
  } catch {
    Log "No se pudo registrar la tarea de limpieza: $($_.Exception.Message)"
  }

  # Esperar a que el servidor arranque y escriba su PID (como mucho 2 minutos).
  $deadline = (Get-Date).AddMinutes(2)
  while (-not (Test-Path $PidFile) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 500 }
  if (Test-Path $PidFile) {
    $serverPid = [int](Get-Content $PidFile -Raw).Trim()
    Log "Vigilando PokeOBS (PID $serverPid)."
    # Espera sin consumir CPU hasta que el proceso termina.
    Wait-Process -Id $serverPid -ErrorAction SilentlyContinue
    Log 'PokeOBS se ha cerrado.'
  } else {
    Log 'PokeOBS no llego a arrancar.'
  }
} catch {
  Log "Error: $($_.Exception.Message)"
} finally {
  Remove-Rule
  Remove-CleanupTask
}
