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

const waitForSubgraphToBeUnhealthy = async () =>
  new Promise((resolve, reject) => {
    // Wait for 600s
    let deadline = Date.now() + 600 * 1000;

    // Function to check if the subgraph is synced
    const checkSubgraphUnhealthy = async () => {
      try {
        let result = await fetchSubgraphIndexNode({
          query: `{
            indexingStatusForCurrentVersion(subgraphName: "${subgraphName}") {
              synced
              health
            }
          }`,
        });
        if (result.data.indexingStatusForCurrentVersion.health == "unhealthy") {
          resolve();
        } else if (health == "failed") {
          reject(new Error("Subgraph failed"));
        } else {
          throw new Error("reject or retry");
        }
      } catch (e) {
        if (Date.now() > deadline) {
          reject(new Error(`Timed out waiting for the subgraph to be unhealthy`));
        } else {
          setTimeout(checkSubgraphUnhealthy, 500);
        }
      }
    };

    // Periodically check whether the subgraph has synced
    setTimeout(checkSubgraphUnhealthy, 0);
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

    for (let i = 0; i < 2; i++) {
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
    }

    // Create and deploy the subgraph
    exec(`yarn codegen`);
    exec(`yarn create:test`);
    exec(`yarn deploy:test`);

    // Wait for the subgraph to be indexed
    await waitForSubgraphToBeUnhealthy();
  });

  it("only successful handler register changes", async () => {
    let result = await fetchSubgraph({
      query: `{ foos(orderBy: id, subgraphError: allow) { id } }`,
    });

    expect(result.errors).to.deep.equal([
      {
        message: "indexing_error",
      },
    ]);

    // Importantly, "1" and "11" are not present because their handlers errored.
    expect(result.data).to.deep.equal({
      foos: [
        {
          id: "0"
        },
        {
          id: "00"
        },
      ],
    });
  });
});
