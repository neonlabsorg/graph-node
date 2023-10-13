#!/bin/sh

echo "Install dependencies"

cd ./tests/integration-tests
yarn

test_directory=./
exit_code=0
export SUBGRAPH_NAME="test-subgraph"

for entry in "$test_directory"/*/test/test.js
do
  echo "Running test: $entry"
  export SUBGRAPH_NAME="$GITHUB_SHA-$entry"
  yarn neon
  if [ $? -ne 0 ]; then
    exit_code=$?
  fi
  sleep 5
done

exit $exit_code