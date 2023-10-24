#!/bin/bash
TAG=$1

declare -a arr=("api-version-v0-0-4" "block-handlers" "chain-reverts" "host-exports" "int8" "non-fatal-errors" "overloaded-contract-functions" "poi-for-failed-subgraph" "remove-then-update" "value-roundtrip")

echo "Removing subgraphs:"
for entry in "${arr[@]}"
do
    var=$(docker exec graph-node-$TAG bash -c "graphman --config /config.toml info $entry-$TAG")
    if [[ $var != "No matches" ]]; then
        echo "Removing subgraph: $entry-$TAG"
        echo "Graph info: $var"
        docker exec graph-node-$TAG bash -c "yes | graphman --config /config.toml drop $entry-$TAG"
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