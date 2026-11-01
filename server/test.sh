#!/usr/bin/env bash
# Compila e roda os testes do servidor Java (mini framework próprio, sem JUnit).
set -euo pipefail
cd "$(dirname "$0")"
bash ./build.sh
rm -rf target/test-classes
mkdir -p target/test-classes
find src/test/java -name '*.java' > target/fontes-teste.txt
javac --release 21 -encoding UTF-8 -cp target/classes -d target/test-classes @target/fontes-teste.txt
SERIFA_WEB="${SERIFA_WEB:-../web}" java -cp target/classes:target/test-classes serifa.teste.TestRunner "$@"
