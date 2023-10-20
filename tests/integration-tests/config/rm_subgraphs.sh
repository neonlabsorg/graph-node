#!/bin/sh

TAG=$1
test_dir=./tests/integration-tests

echo "Removing subgraphs:"
for entry in "$test_directory/*"
do
  var=$(docker exec graph-node-$TAG bash -c "graphman --config /config.toml info $entry-$TAG")
  if [[ $var != "No matches" ]]; then
    echo "Removing subgraph: $entry-$TAG"
    docker exec graph-node-$TAG bash -c "yes | graphman --config config.toml drop $entry-$TAG"
  else
    echo "Can not find $entry-$TAG subgraph."
  fi
  
  var=$(docker exec graph-node-$TAG bash -c "graphman --config /config.toml info $entry-$TAG")
  if [[ $var =~ "No matches" ]]; then
    echo "$entry-$TAG subgraph was removed."
  else
    echo "Can not remove $entry-$TAG subgraph."
  fi
done