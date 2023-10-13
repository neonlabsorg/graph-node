#!/bin/sh

echo "Install dependencies"

cd ./tests/integration-tests
yarn

test_directory=.
exit_code=0
export SUBGRAPH_NAME="test-subgraph"

for entry in "$test_directory"
do
  echo "Running test in : $entry"
  cd $entry
  export SUBGRAPH_NAME="$TAG-$entry"
  yarn neon
  if [ $? -ne 0 ]; then
    exit_code=$?
  fi
  cd ..
  sleep 3
done

exit $exit_code