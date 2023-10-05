require("babel-register");
require("babel-polyfill");

const Web3 = require("web3");
const HDWalletProvider = require("@truffle/hdwallet-provider");

Web3.providers.HttpProvider.prototype.sendAsync = Web3.providers.HttpProvider.prototype.send
const neonDevnet = "https://devnet.neonevm.org"
const provider = new Web3.providers.HttpProvider(neonDevnet);

const privateKeys = [
  '0x7efe7d68906dd6fb3487f411aafb8e558863bf1d2f60372a47186d151eae625a',
  '0x09fb68d632c2b227cc6da77696de362fa38cb94e1c62d8a07db82e7d5e754f10',
  '0x9b6007319e21225003fe120b4d7be1ee447d0fb29f52ca72914dad41fb47ddb9',
];

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
    }
  },
  compilers: {
    solc: {
      version: "0.8.2"
    }
  }
};
