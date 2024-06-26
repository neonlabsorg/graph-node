const path = require("path");
const execSync = require("child_process").execSync;
const { system, patching } = require("gluegun");
const { createApolloFetch } = require("apollo-fetch");

const assert = require("assert");
const Contract = artifacts.require("./Contract.sol");

const srcDir = path.join(__dirname, "..");
const subgraphName = process.env.SUBGRAPH_NAME || "subgraph_block_handlers";
const indexNodeUrl = process.env.INDEX_NODE_URL || "https://ch2-graph.neontest.xyz/index-node/graphql";
const subgraphUrl = process.env.SUBGRAPH_URL || `https://ch2-graph.neontest.xyz/subgraphs/name/${subgraphName}`;

const zeroAddress = "0x0000000000000000000000000000000000000000";
const templateBlock = 247101047;

let block = 0;

const fetchSubgraphIndexNode = createApolloFetch({
  uri: indexNodeUrl,
});
const fetchSubgraph = createApolloFetch({
  uri: subgraphUrl,
});

const exec = (cmd) => {
  try {
    return execSync(cmd, { cwd: srcDir, stdio: "inherit" });
  } catch (e) {
    throw new Error(`Failed to run command \`${cmd}\``);
  }
};
const fetchIndexingStatuses = name => fetchSubgraphIndexNode({
  query: `{
    indexingStatusesForSubgraphName(subgraphName: "${name}") {
      subgraph
      health
      entityCount
      chains {
        network
        latestBlock { number hash }
      }
    }
  }`,
})

const fetchProofOfIndexing = ({ deploymentId, latestBlock }) => fetchSubgraphIndexNode({
  query: `{
    proofOfIndexing(
      subgraph: "${deploymentId}",
      blockNumber: ${latestBlock.number},
      blockHash: "${latestBlock.hash}"
    )
  }`,
})

const fetchEntityCalls = () => fetchSubgraph({
  query: `{
    calls {
      id
      value
    }
  }`,
})

const waitForSubgraphToFailWithError = async (blockNumber) =>
  new Promise((resolve, reject) => {
    let deadline = Date.now() + 600 * 1000;

    const checkSubgraphFailedWithPoI = async () => {
      try {
        // Step necessary to get:
        // - last block hash
        // - last block number
        // - subgraph deployment id
        // So we can query the PoI later.
        let statusesResult = await fetchIndexingStatuses(subgraphName);
        console.log("statusesResult", JSON.stringify(statusesResult))

        if (statusesResult.errors != null) {
          reject("query contains errors: " + JSON.stringify(statusesResult.errors));
        }

        let statuses = statusesResult.data.indexingStatusesForSubgraphName;

        assert(
          statuses.length === 1,
          `There should be only one subgraph with the provided name, found ${statuses.length} instead`
        )

        let status = statuses[0]

        // Get Calls that the mappings tried to save before the DeterministicError happened.
        let callsResult = await fetchEntityCalls()

        let callsCount = (callsResult.data && callsResult.data.calls && callsResult.data.calls.length) || 0

        if (callsCount !== 0) {
          return reject(new Error("No entity besides the Proof of Indexing should be able to be stored"));
        }

        // Need to have failed since mappings have an `assert(false)`.
        if (status.health === "failed") {
          // Find latest block for the correct chain (we only use one)
          let { latestBlock } = status.chains.find(({ network }) => network === "neonlabs")

          let poiResult = await fetchProofOfIndexing({
            deploymentId: status.subgraph,
            latestBlock,
          })

          let hasPoI = poiResult.data && poiResult.data.proofOfIndexing != null
          let hasOnlyOneEntityInTheDatabase = status.entityCount

          if (!hasPoI) {
            throw new Error("Failed subgraph should have Proof of Indexing for block");
          } else if (hasOnlyOneEntityInTheDatabase != 1) {
            // 1 instead of 3, which would happen if both 'Call' entities were saved in the database (look at src/mapping.ts)
            throw new Error("Proof of Indexing returned, but it's not saved into the database");
          } else {
            return resolve();
          }
        } else {
          throw new Error("reject or retry");
        }
      } catch (e) {
        if (Date.now() > deadline) {
          return reject(new Error(`Timed out waiting for the subgraph to fail`));
        } else {
          setTimeout(checkSubgraphFailedWithPoI, 10000);
        }
      }
    };

    setTimeout(checkSubgraphFailedWithPoI, 0);
  });

contract("Contract", (accounts) => {
  // Deploy the subgraph once before all tests
  before(async () => {
    // Deploy the contract
    const contract = await Contract.deployed();
    await contract.emitTrigger(1);

    // Insert its address into subgraph manifest
    txhash = Contract.transactionHash;
    block = (await web3.eth.getTransaction(txhash)).blockNumber;

    await patching.replace(
      path.join(srcDir, "subgraph.yaml"),
      zeroAddress,
      contract.address
    );

    await patching.replace(
      path.join(srcDir, "subgraph.yaml"),
      templateBlock,
      block
    );

    // Create and deploy the subgraph
    exec("yarn codegen");
    exec(`yarn create:test`);
    exec(`yarn deploy:test`);
  });

  it("subgraph fails with expected error", async () => {
    await waitForSubgraphToFailWithError(3);
  });
});
