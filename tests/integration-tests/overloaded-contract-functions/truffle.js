require("babel-register");
require("babel-polyfill");

const Web3 = require("web3");
const HDWalletProvider = require("@truffle/hdwallet-provider");

Web3.providers.HttpProvider.prototype.sendAsync = Web3.providers.HttpProvider.prototype.send
const neonDevnet = "https://devnet.neonevm.org"
const provider = new Web3.providers.HttpProvider(neonDevnet);
const privateKeys = process.env.NEON_ACCOUNTS.split(",");

module.exports = {
  contracts_build_directory: "./truffle_output",
  networks: {
    test: {
      host: "localhost",
      port: process.env.GANACHE_TEST_PORT || 18545,
      network_id: "*",
      gas: "100000000000",
      gasPrice: "1"
    },
    neonlabs: {
      provider: () => {
        return new HDWalletProvider(
          privateKeys,
          provider
        );
      },
      network_id: "*"
    },
    networkCheckTimeout: 60000
  },
  mocha: {
    timeout: 600000
  },
  compilers: {
    solc: {
      version: "0.8.2"
    }
  }
};
