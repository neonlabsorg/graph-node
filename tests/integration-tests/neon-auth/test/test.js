const path = require("path");
const execSync = require("child_process").execSync;
const child_process = require('child_process');
const { system, patching } = require("gluegun");
const { createApolloFetch } = require("apollo-fetch");

const assert = require("assert");
const Contract = artifacts.require("./Contract.sol");

const srcDir = path.join(__dirname, "..");
const subgraphName = process.env.SUBGRAPH_NAME || "subgraph_neon_auth";
const indexNodeUrl = process.env.INDEX_NODE_URL || "https://graph-secured.neontest.xyz/index-node/graphql";
const subgraphUrl = process.env.SUBGRAPH_URL || `https://graph-secured.neontest.xyz/subgraphs/name/${subgraphName}`;
const subgraphDeployUri = process.env.SECURED_GRAPH_NODE_ADMIN_URI || "https://graph-secured.neontest.xyz/deploy";
const ipfsUri = process.env.SECURED_IPFS_URI || "https://ipfs-secured.neontest.xyz";

const zeroAddress = "0x0000000000000000000000000000000000000000";
const templateBlock = 247101047;
const apikeyErrorMessage = "Sorry, you have supplied an invalid key";

let block = 0;
let contractInstance;

const fetchSubgraphIndexNode = createApolloFetch({
  uri: indexNodeUrl
});

fetchSubgraphIndexNode.use(({ request, options }, next) => {
  if (!options.headers) {
    options.headers = {};
  }
  options.headers['Authorization'] = `Bearer ${process.env.API_KEY}`;
  options.headers['Content-Type'] = 'application/json';
  next();
});

const fetchSubgraph = createApolloFetch({
  uri: subgraphUrl
});

fetchSubgraph.use(({ request, options }, next) => {
  if (!options.headers) {
    options.headers = {};
  }
  options.headers['Authorization'] = `Bearer ${process.env.API_KEY}`;
  options.headers['Content-Type'] = 'application/json';
  next();
});

const deployGraphBaseCmd = (name) => {
  createGraphCmd = `graph create ${name} --node ${subgraphDeployUri}`;
  execSync(createGraphCmd, { createGraphCmd: srcDir, stdio: "inherit" });
  return `graph deploy ${name} --version-label v0.0.1 --ipfs ${ipfsUri} --node ${subgraphDeployUri}`;
}

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
  contractInstance = new web3.eth.Contract(
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

    await generateBlocks(contract);

    // Authenticate with API key, create and deploy the subgraph
    exec(`yarn codegen`);
    exec(`yarn auth:test`);
    exec(`yarn create:test`);
    exec(`yarn deploy:test`);

    // Wait for the subgraph to be indexed
    await waitForSubgraphToBeSynced();
  });

  it("test query data of the subgraph deployed with auth", async () => {
    // Also test that multiple block constraints do not result in a graphql error.
    let result = await fetchSubgraph({
      query: `{
        foos(orderBy: value, skip: 1) { id value }
      }`,
    });

    expect(result.errors).to.be.undefined;
    const foos = [];
    for (let i = 1; i < 11; i++) {
      foos.push({ id: i.toString(), value: i });
    }

    expect(result.data).to.deep.equal({
      foos: foos,
    });
  });

  const headers = [
    undefined,
    `--headers='{"Authorization": "Bearer wrong-api-key"}'`,
    `--headers='{"Authorization": "Base ${process.env.API_KEY}"}'`,
    `--headers='{}'`,
    `--headers='{"X-API-Key": "${process.env.API_KEY}"}'`,
    `--headers='{"X-API-Key": "Bearer ${process.env.API_KEY}"}'`,
  ];

  headers.forEach((header) => {
    it("test deploy subgraph with invalid api key", async () => {
      let deployGraphCmd = deployGraphBaseCmd(`wrong-api-key-${subgraphName}`) + header;
      let output;
      try {
        child_process.execSync(deployGraphCmd).toString();
      } catch (error) {
        output = error.message.toString();
      }

      assert(output.includes(apikeyErrorMessage));
    });
  });

});
