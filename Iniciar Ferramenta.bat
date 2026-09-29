@echo off
chcp 65001 >nul
title Excelencia - Orcamentos
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  O Node.js nao foi encontrado. Instale a versao LTS em https://nodejs.org e execute este arquivo novamente.
  echo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo  Instalando dependencias - somente na primeira vez, leva alguns minutos...
  call npm install
  if errorlevel 1 ( pause & exit /b 1 )
)

if not exist dist\index.html (
  echo  Preparando a interface...
  call npm run build
  if errorlevel 1 ( pause & exit /b 1 )
)

echo.
echo  Iniciando... o navegador abre sozinho em http://localhost:5180
echo  Para encerrar, feche esta janela.
set ABRIR_NAVEGADOR=1
call npx tsx server/index.ts
pause
