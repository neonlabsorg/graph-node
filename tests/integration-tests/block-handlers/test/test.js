const path = require("path");
const execSync = require("child_process").execSync;
const { system, patching } = require("gluegun");
const { createApolloFetch } = require("apollo-fetch");

const Web3 = require("web3");
const assert = require("assert");
const Contract = artifacts.require("./Contract.sol");

const srcDir = path.join(__dirname, "..");
const subgraphName = process.env.SUBGRAPH_NAME || "test/subgraph_block_handlers";

const neonDevnet = "https://devnet.neonevm.org";
const web3 = new Web3(neonDevnet);
let block = 0;

const fetchSubgraphIndexNode = createApolloFetch({
  uri: `https://ch2-graph.neontest.xyz/index-node/graphql`,
});
const fetchSubgraph = createApolloFetch({
  uri: `https://ch2-graph.neontest.xyz/subgraphs/name/test/block-handlers`,
});

const exec = (cmd) => {
  try {
    return execSync(cmd, { cwd: srcDir, stdio: "inherit" });
  } catch (e) {
    throw new Error(`Failed to run command \`${cmd}\``);
  }
};

const generateBlocks = async (contract) => {
  let accounts = await web3.eth.getAccounts();
  // connect to the contract and call the function trigger()
  const contractInstance = new web3.eth.Contract(
    Contract.abi,
    contract.address
  );
  // loop and call emitTrigger 10 times
  for (let i = 0; i < 10; i++) {
    await contractInstance.methods
      .emitTrigger(i + 1)
      .send({ from: accounts[0] });
  }
};

const waitForSubgraphToBeSynced = async () =>
  new Promise((resolve, reject) => {
    // Wait for 60s
    let deadline = Date.now() + 60 * 1000;

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

        if (result.data.indexingStatusForCurrentVersion[0].synced) {
          resolve();
        } else if (result.data.indexingStatusForCurrentVersion[0].health != "healthy") {
          reject(new Error(`Subgraph failed`));
        } else {
          throw new Error("reject or retry");
        }
      } catch (e) {
        if (Date.now() > deadline) {
          reject(new Error(`Timed out waiting for the subgraph to sync`));
        } else {
          setTimeout(checkSubgraphSynced, 1000);
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
    block = await web3.eth.getBlockNumber();

    console.log("srcDir", srcDir);
    console.log("contract address", contract.address);
    for (let i = 0; i < 2; i++) {
      await patching.replace(
        path.join(srcDir, "subgraph.yaml"),
        "0x0000000000000000000000000000000000000000",
        contract.address
      );

      console.log("block", block);
      await patching.replace(
        path.join(srcDir, "subgraph.yaml"),
        247101047,
        block
      );
    }

    await createBlocks(contract);

    // Create and deploy the subgraph
    exec(`yarn codegen`);
    exec(`yarn create:test`);
    exec(`yarn deploy:test`);

    // Wait for the subgraph to be indexed
    await waitForSubgraphToBeSynced();
  });

  it("test non-filtered blockHandler", async () => {
    // Also test that multiple block constraints do not result in a graphql error.
    let result = await fetchSubgraph({
      query: `{
        blocks(orderBy: number, first: 10) { id number }
      }`,
    });
    expect(result.errors).to.be.undefined;
    expect(result.data).to.deep.equal({
      blocks: [
        { id: block.toString(), number: block.toString() },
        { id: (block + 1).toString(), number: (block + 1).toString() },
        { id: (block + 2).toString(), number: (block + 2).toString() },
        { id: (block + 3).toString(), number: (block + 3).toString() },
        { id: (block + 4).toString(), number: (block + 4).toString() },
        { id: (block + 5).toString(), number: (block + 5).toString() },
        { id: (block + 6).toString(), number: (block + 6).toString() },
        { id: (block + 7).toString(), number: (block + 7).toString() },
        { id: (block + 8).toString(), number: (block + 8).toString() },
        { id: (block + 9).toString(), number: (block + 9).toString() },
      ],
    });
  });

  it("test query", async () => {
    // Also test that multiple block constraints do not result in a graphql error.
    let result = await fetchSubgraph({
      query: `{
        foos(orderBy: value, skip: 1) { id value }
      }`,
    });

    expect(result.errors).to.be.undefined;
    const foos = [];
    for (let i = 0; i < 11; i++) {
      foos.push({ id: (block + i).toString(), number: (block + i).toString() });
    }

    expect(result.data).to.deep.equal({
      foos: foos,
    });
  });

  it("should call initialization handler first", async () => {
    let result = await fetchSubgraph({
      query: ` `,
    });

    expect(result.errors).to.be.undefined;
    // This to test that the initialization handler is called first
    // if the value is -1 means a log handler has overwritten the value
    // meaning the initialization handler was called first
    // if the value is 0 means the log handler was called first
    expect(result.data).to.deep.equal({
      foo: { id: "initialize", value: "-1" },
    });
  });

  it("test blockHandler with polling filter", async () => {
    // Also test that multiple block constraints do not result in a graphql error.
    let result = await fetchSubgraph({
      query: `{
        blockFromPollingHandlers(orderBy: number, first: 3) { id number }
      }`,
    });
    expect(result.errors).to.be.undefined;
    expect(result.data).to.deep.equal({
      blockFromPollingHandlers: [
        { id: (block).toString(), number: (block).toString() },
        { id: (block + 3).toString(), number: (block + 3).toString() },
        { id: (block + 6).toString(), number: (block + 6).toString() },
      ],
    });
  });

  it("test other blockHandler with polling filter", async () => {
    // Also test that multiple block constraints do not result in a graphql error.
    let result = await fetchSubgraph({
      query: `{
        blockFromOtherPollingHandlers(orderBy: number, first: 3) { id number }
      }`,
    });
    expect(result.errors).to.be.undefined;
    expect(result.data).to.deep.equal({
      blockFromOtherPollingHandlers: [
        { id: (block + 1).toString(), number: (block + 1).toString() },
        { id: (block + 3).toString(), number: (block + 3).toString() },
        { id: (block + 5).toString(), number: (block + 5).toString() },
      ],
    });
  });

  it("test initialization handler", async () => {
    // Also test that multiple block constraints do not result in a graphql error.
    let result = await fetchSubgraph({
      query: `{
        initializes(orderBy: block,first:10) { id block }
      }`,
    });
    expect(result.errors).to.be.undefined;
    expect(result.data.initializes.length).to.equal(1);
    expect(result.data).to.deep.equal({
      initializes: [{ id: (block).toString(), number: (block).toString() }],
    });
  });

  it("test subgraphFeatures endpoint returns handlers correctly", async () => {
    let meta = await fetchSubgraph({
      query: `{ _meta { deployment } }`,
    });

    let deployment = meta.data._meta.deployment;
    console.log("deployment", deployment);

    let subgraph_features = await fetchSubgraphs({
      query: `query GetSubgraphFeatures($deployment: String!) {
        subgraphFeatures(subgraphId: $deployment) {
          specVersion
          apiVersion
          features
          dataSources
          network
          handlers
        }
      }`,
      variables: { deployment },
    });

    expect(subgraph_features.data.subgraphFeatures.handlers)
      .to.be.an("array")
      .that.include.members([
        "block_filter_polling",
        "block_filter_once",
        "block",
        "event",
      ]);
  });
});
