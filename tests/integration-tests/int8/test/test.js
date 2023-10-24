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

const waitForSubgraphToBeSynced = async () =>
  new Promise((resolve, reject) => {
    // Wait for 600s
    let deadline = Date.now() + 600 * 1000;

    // Function to check if the subgraph is synced
    const checkSubgraphSynced = async () => {
      try {
        let result = await fetchSubgraphIndexNode({
          query: `{
            indexingStatusForCurrentVersion(subgraphName: "${subgraphName}") {
              synced
              health
            }
          }`,
        });
        if (result.data.indexingStatusForCurrentVersion.synced) {
          resolve();
        } else if (result.data.indexingStatusForCurrentVersion.health != "healthy") {
          reject(new Error("Subgraph is unhealthy"));
        } else {
          throw new Error("Reject or retry");
        }
      } catch (e) {
        if (Date.now() > deadline) {
          reject(new Error("Timed out waiting for the subgraph to be synced"));
        } else {
          console.log("Waiting for the subgraph to be synced...");
          setTimeout(checkSubgraphSynced, 10000);
        }
      }
    };

    // Periodically check whether the subgraph has synced
    setTimeout(checkSubgraphSynced, 0);
  });

contract("Contract", (accounts) => {
  // Deploy the subgraph once before all tests
  before(async () => {
    // Deploy the contract
    const contract = await Contract.deployed();

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
    exec(`yarn codegen`);
    exec(`yarn create:test`);
    exec(`yarn deploy:test`);

    // Wait for the subgraph to be indexed
    await waitForSubgraphToBeSynced();
  });

  it("test query", async () => {
    // Also test that multiple block constraints do not result in a graphql error.
    let result = await fetchSubgraph({
      query: `{
        foos_0: foos(orderBy: id, block: { number: ${block} }) { id }
        foos(orderBy: id) { id value }
      }`,
    });

    expect(result.errors).to.be.undefined;
    expect(result.data).to.deep.equal({
      foos_0: [
        {
          id: "0"
        },
      ],
      foos: [
        {
          id: "0",
          value: "9223372036854775807",
        },
      ],
    });
  });
});
