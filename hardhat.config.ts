import * as dotenv from 'dotenv'
import { HardhatUserConfig } from 'hardhat/config'
import '@matterlabs/hardhat-zksync' // to uncomment if you have trouble with Solidity VSCode extension
import '@matterlabs/hardhat-zksync-node/dist/type-extensions'
import '@nomicfoundation/hardhat-toolbox'
import '@nomicfoundation/hardhat-chai-matchers'

dotenv.config()

const config: HardhatUserConfig = {
  zksolc: {
    version: '1.5.8',
    settings: {
      // Note: This must be true to call NonceHolder & ContractDeployer system contracts
      enableEraVMExtensions: true
    }
  },

  networks: {
    abstractTestnet: {
      // chainId: 11124,
      url: 'https://api.testnet.abs.xyz',
      ethNetwork: 'sepolia',
      zksync: true,
      verifyURL:
        'https://api-explorer-verify.testnet.abs.xyz/contract_verification'
    },
    localhost: {
      // chainId: 11124,
      url: 'http://127.0.0.1:8011',
      ethNetwork: 'localhost', // in-memory node doesn't support eth node; removing this line will cause an error
      zksync: true
    },
    hardhat: {
      zksync: true
    }
  },
  solidity: {
    version: '0.8.20'
  }
}

export default config
