@echo off
rem Compila o servidor Java do Serifa (JDK 21 puro, sem Maven/Gradle).
setlocal
cd /d "%~dp0"
if exist target\classes rmdir /s /q target\classes
mkdir target\classes
dir /s /b src\main\java\*.java > target\fontes.txt
javac --release 21 -encoding UTF-8 -d target\classes @target\fontes.txt || exit /b 1
xcopy /e /i /y /q src\main\resources target\classes > nul
echo Main-Class: serifa.cli.Main> target\MANIFEST.MF
jar --create --file target\serifa.jar --manifest target\MANIFEST.MF -C target\classes . || exit /b 1
echo Gerado: server\target\serifa.jar
