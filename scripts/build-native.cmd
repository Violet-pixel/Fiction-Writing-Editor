@echo off
rem build-native.cmd — compila os CLIs nativos do Serifa (contar e revisor) no Windows com MinGW-w64.
rem Copyright (c) 2026 Clara Portes
rem Requer gcc e g++ do MinGW-w64 no PATH. Saida em native\build\contar.exe e native\build\revisor.exe.
setlocal
chcp 65001 >nul
set "RAIZ=%~dp0.."
if "%CC%"=="" set "CC=gcc"
if "%CXX%"=="" set "CXX=g++"
set "SAIDA=%RAIZ%\native\build"
if not exist "%SAIDA%" mkdir "%SAIDA%"

where %CC% >nul 2>nul || (echo build-native: %CC% nao encontrado no PATH. Instale o MinGW-w64. & exit /b 1)
where %CXX% >nul 2>nul || (echo build-native: %CXX% nao encontrado no PATH. Instale o MinGW-w64. & exit /b 1)

%CC% -std=c11 -O2 -Wall -Wextra -D__USE_MINGW_ANSI_STDIO=1 -o "%SAIDA%\contar.exe" "%RAIZ%\native\c\contar.c" "%RAIZ%\native\c\textstats.c" || exit /b 1
%CC% -std=c11 -O2 -Wall -Wextra -D__USE_MINGW_ANSI_STDIO=1 -c -o "%SAIDA%\textstats.o" "%RAIZ%\native\c\textstats.c" || exit /b 1
%CXX% -std=c++17 -O2 -Wall -Wextra -D__USE_MINGW_ANSI_STDIO=1 -static -o "%SAIDA%\revisor.exe" "%RAIZ%\native\cpp\revisor\main.cpp" "%RAIZ%\native\cpp\revisor\hunspell_lite.cpp" "%SAIDA%\textstats.o" || exit /b 1
del "%SAIDA%\textstats.o" >nul 2>nul

echo Gerados: native\build\contar.exe e native\build\revisor.exe
endlocal
