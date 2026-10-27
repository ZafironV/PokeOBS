@echo off
setlocal
chcp 65001 >nul
title PokeOBS
cd /d "%~dp0"

rem --- Requisito: Node.js 20 o superior -------------------------------
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  No se ha encontrado Node.js.
  echo  Instala la version LTS desde https://nodejs.org/ y vuelve a abrir este archivo.
  echo.
  pause
  exit /b 1
)
for /f "tokens=1 delims=." %%v in ('node -p "process.versions.node"') do set NODE_MAJOR=%%v
if %NODE_MAJOR% LSS 20 (
  echo.
  echo  Se necesita Node.js 20 o superior. Version instalada:
  node -v
  echo  Descarga la version LTS desde https://nodejs.org/
  echo.
  pause
  exit /b 1
)

rem --- Dependencias (solo la primera vez) -----------------------------
if not exist "node_modules\" (
  echo Instalando dependencias, solo la primera vez...
  call npm ci --no-audit --no-fund
  if errorlevel 1 goto :error
)

rem --- Compilacion (rapida; asi se aplican los cambios en perfiles o codigo)
call npm run build --silent
if errorlevel 1 goto :error

if not defined POKEOBS_PORT set POKEOBS_PORT=4520

rem --- Si PokeOBS ya esta abierto, solo se abre el panel -----------------
curl -s -m 2 http://127.0.0.1:%POKEOBS_PORT%/api/health >nul 2>nul
if not errorlevel 1 (
  echo PokeOBS ya esta abierto en otra ventana. Abriendo el panel...
  start "" http://127.0.0.1:%POKEOBS_PORT%/control
  timeout /t 3 /nobreak >nul
  exit /b 0
)

rem --- Proteccion de red temporal -----------------------------------------
rem Windows pedira permiso. Mientras PokeOBS este abierto, otros equipos de la
rem red no podran enviar ordenes a RetroArch; al cerrarlo se deshace sola.
if not defined POKEOBS_DATA set "POKEOBS_GUARD_DATA=%~dp0data"
if defined POKEOBS_DATA set "POKEOBS_GUARD_DATA=%POKEOBS_DATA%"
set "POKEOBS_GUARD_SCRIPT=%~dp0scripts\firewall-guard.ps1"
if not exist "%POKEOBS_GUARD_DATA%\" mkdir "%POKEOBS_GUARD_DATA%"
if exist "%POKEOBS_GUARD_DATA%\pokeobs.pid" del "%POKEOBS_GUARD_DATA%\pokeobs.pid"
echo Activando la proteccion de red (Windows pedira permiso)...
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Start-Process powershell -Verb RunAs -WindowStyle Hidden -ErrorAction Stop -ArgumentList ('-NoProfile -ExecutionPolicy Bypass -File \"{0}\" -DataDir \"{1}\"' -f $env:POKEOBS_GUARD_SCRIPT, $env:POKEOBS_GUARD_DATA) } catch { exit 1 }"
if errorlevel 1 (
  echo.
  echo  Proteccion de red NO activada: no se concedio el permiso.
  echo  PokeOBS funciona igual, pero otros equipos de tu red podrian enviar
  echo  ordenes a RetroArch si tiene activados los comandos de red.
  echo.
)

rem Abrir el panel en el navegador salvo que se pida lo contrario.
if /i not "%~1"=="--sin-navegador" (
  start "" /b cmd /c "timeout /t 2 /nobreak >nul & start "" http://127.0.0.1:%POKEOBS_PORT%/control"
)

node dist\server.js
echo.
echo  El servidor se ha detenido.
pause
exit /b 0

:error
echo.
echo  Ha ocurrido un error. Revisa los mensajes anteriores.
pause
exit /b 1
