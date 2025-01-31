import * as dotenv from 'dotenv'
import { HardhatUserConfig } from 'hardhat/config'
import '@matterlabs/hardhat-zksync-node/dist/type-extensions'
import '@nomicfoundation/hardhat-toolbox'
import '@nomicfoundation/hardhat-chai-matchers'

// Comment these lines if you have troubles with Solidity VSCode extension (uncomment then when you need to compile/run/test)
import '@matterlabs/hardhat-zksync'
import '@matterlabs/hardhat-zksync-upgradable'

dotenv.config()

const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.26'
  },
  zksolc: {
    version: '1.5.11',
    settings: {
      // Note: This must be true to call NonceHolder & ContractDeployer system contracts
      enableEraVMExtensions: true
    }
  },

  networks: {
    abstract: {
      chainId: 2741,
      url: 'https://api.mainnet.abs.xyz',
      ethNetwork: 'sepolia',
      zksync: true,
      verifyURL: 'https://api.abscan.org/api'
    },
    abstractTestnet: {
      chainId: 11124,
      url: 'https://api.testnet.abs.xyz',
      ethNetwork: 'sepolia',
      zksync: true,
      verifyURL: 'https://api-sepolia.abscan.org/api'
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

  etherscan: {
    apiKey: {
      abstractTestnet: process.env.EXPLORER_API_KEY as string
    },
    customChains: [
      {
        network: 'abstract',
        chainId: 2741,
        urls: {
          apiURL: 'https://api.abscan.org/api',
          browserURL: 'https://abscan.org'
        }
      },
      {
        network: 'abstractTestnet',
        chainId: 11124,
        urls: {
          apiURL: 'https://api-sepolia.abscan.org/api',
          browserURL: 'https://sepolia.abscan.org'
        }
      }
    ]
  },

  sourcify: {
    enabled: true
  }
}

export default config
