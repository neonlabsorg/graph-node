#!/bin/sh

test_dir=./tests/integration-tests

echo "Removing subgraphs:"
for entry in "$test_directory/*"
do
  echo "Removing subgraph: $entry-$GITHUB_SHA"
  docker exec graph-node-$GITHUB_SHA bash -c "yes | graphman --config config.toml drop $entry-$GITHUB_SHA"
  var=$(docker exec graph-node-$GITHUB_SHA bash -c "graphman --config /config.toml info $entry-$GITHUB_SHA")
  if [[ $var =~ "No matches" ]]; then
    echo "$entry-$GITHUB_SHA subgraph was removed."
  else
    echo "Can not remove $entry-$GITHUB_SHA subgraph."
  fi
done