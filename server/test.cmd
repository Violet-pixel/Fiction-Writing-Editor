@echo off
rem Compila e roda os testes do servidor Java (mini framework próprio, sem JUnit).
setlocal
cd /d "%~dp0"
call build.cmd || exit /b 1
if exist target\test-classes rmdir /s /q target\test-classes
mkdir target\test-classes
dir /s /b src\test\java\*.java > target\fontes-teste.txt
javac --release 21 -encoding UTF-8 -cp target\classes -d target\test-classes @target\fontes-teste.txt || exit /b 1
if "%SERIFA_WEB%"=="" set SERIFA_WEB=..\web
java -cp target\classes;target\test-classes serifa.teste.TestRunner %*
