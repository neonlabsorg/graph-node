require("babel-register");
require("babel-polyfill");

const HDWalletProvider = require("@truffle/hdwallet-provider");

const neonDevnet = "https://graph-secured.neontest.xyz/solana";

const Web3HttpProvider = require('web3-providers-http');
const options = {
  headers: [
    {
      name: 'Content-Type',
      value: 'application/json'
    },
    {
      name: 'Authorization',
      value: 'Bearer riewikix7EoP5ieR2Rai9theeB6uv3ph'
    }
  ],
};

const provider = new Web3HttpProvider(neonDevnet, options);
const privateKeys = process.env.NEON_ACCOUNTS.split(",");

module.exports = {
  contracts_directory: "../../common",
  migrations_directory: "../../common",
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
    networkCheckTimeout: 120000
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
