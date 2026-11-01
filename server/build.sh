#!/usr/bin/env bash
# Compila o servidor Java do Serifa (JDK 21 puro, sem Maven/Gradle).
# Saída: server/target/serifa.jar
set -euo pipefail
cd "$(dirname "$0")"
rm -rf target/classes
mkdir -p target/classes
find src/main/java -name '*.java' > target/fontes.txt
javac --release 21 -encoding UTF-8 -Xlint:all,-serial -d target/classes @target/fontes.txt
if [ -d src/main/resources ]; then cp -r src/main/resources/. target/classes/; fi
printf 'Main-Class: serifa.cli.Main\n' > target/MANIFEST.MF
jar --create --file target/serifa.jar --manifest target/MANIFEST.MF -C target/classes .
echo "Gerado: server/target/serifa.jar"
