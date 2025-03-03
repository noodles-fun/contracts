import { Provider, Wallet } from 'zksync-ethers'
import * as hre from 'hardhat'
import { Deployer } from '@matterlabs/hardhat-zksync-deploy'
import dotenv from 'dotenv'
import { ethers, getAddress } from 'ethers'
import { getImplementationAddress } from '@openzeppelin/upgrades-core'

import '@matterlabs/hardhat-zksync-node/dist/type-extensions'
import '@matterlabs/hardhat-zksync-verify/dist/src/type-extensions'

// Load env file
dotenv.config()

export const getProvider = () => {
  const rpcUrl = hre.network.config.url
  if (!rpcUrl)
    throw `⛔️ RPC URL wasn't found in "${hre.network.name}"! Please add a "url" field to the network config in hardhat.config.ts`

  // Initialize ZKsync Provider
  const provider = new Provider(rpcUrl)

  return provider
}

export const getWallet = (privateKey?: string) => {
  if (!privateKey) {
    // Get wallet private key from .env file
    if (!process.env.WALLET_PRIVATE_KEY)
      throw "⛔️ Wallet private key wasn't found in .env file!"
  }

  const provider = getProvider()

  // Initialize ZKsync Wallet
  const wallet = new Wallet(
    privateKey ?? process.env.WALLET_PRIVATE_KEY!,
    provider
  )

  return wallet
}

export const getWallets = () => {
  const wallets = LOCAL_RICH_WALLETS.map((richWallet) =>
    getWallet(richWallet.privateKey)
  )

  return wallets
}

export const verifyEnoughBalance = async (wallet: Wallet, amount: bigint) => {
  // Check if the wallet has enough balance
  const balance = await getProvider().getBalance(wallet.address)
  if (balance < amount)
    throw `⛔️ Wallet balance is too low! Required ${ethers.formatEther(
      amount
    )} ETH, but current ${wallet.address} balance is ${ethers.formatEther(
      balance
    )} ETH`
}

/**
 * @param {string} data.contract The contract's path and name. E.g., "contracts/Greeter.sol:Greeter"
 */
export const verifyContract = async (data: {
  address: string
  contract?: string
  constructorArguments?: string
  bytecode?: string
}) => {
  const verificationRequestId: number = await hre.run('verify:verify', {
    ...data,
    noCompile: true
  })
  return verificationRequestId
}

type DeployContractOptions = {
  /**
   * If true, the deployment process will not print any logs
   */
  silent?: boolean
  /**
   * If true, the contract will not be verified on Block Explorer
   */
  noVerify?: boolean
  /**
   * If specified, the contract will be deployed using this wallet
   */
  wallet?: Wallet
}
export const deployContract = async (
  contractArtifactName: string,
  constructorArguments?: any[],
  options?: DeployContractOptions
): Promise<ethers.Contract> => {
  const log = (message: string) => {
    if (!options?.silent) console.log(message)
  }

  log(`\nStarting deployment process of "${contractArtifactName}"...`)

  const wallet = options?.wallet ?? getWallet()
  const deployer = new Deployer(hre, wallet)

  const artifact = await deployer
    .loadArtifact(contractArtifactName)
    .catch((error) => {
      if (
        error?.message?.includes(
          `Artifact for contract "${contractArtifactName}" not found.`
        )
      ) {
        console.error(error.message)
        throw `⛔️ Please make sure you have compiled your contracts or specified the correct contract name!`
      } else {
        throw error
      }
    })

  // Estimate contract deployment fee
  const deploymentFee = await deployer.estimateDeployFee(
    artifact,
    constructorArguments || []
  )
  log(`Estimated deployment cost: ${ethers.formatEther(deploymentFee)} ETH`)

  // Check if the wallet has enough balance
  await verifyEnoughBalance(wallet, deploymentFee)

  // Deploy the contract to ZKsync
  const contract = await deployer.deploy(artifact, constructorArguments)
  const address = await contract.getAddress()
  const constructorArgs = contract.interface.encodeDeploy(constructorArguments)
  const fullContractSource = `${artifact.sourceName}:${artifact.contractName}`

  // Display contract deployment info
  log(`\n"${artifact.contractName}" was successfully deployed:`)
  log(` - Contract address: ${address}`)
  log(` - Contract source: ${fullContractSource}`)
  log(` - Encoded constructor arguments: ${constructorArgs}\n`)

  if (!options?.noVerify && hre.network.config.verifyURL) {
    log(`Requesting contract verification...`)
    try {
      await verifyContract({
        address,
        contract: fullContractSource,
        constructorArguments: constructorArgs,
        bytecode: artifact.bytecode
      })
    } catch (e) {
      console.log(`Error verifying contract: ${e}`)
    }
  }

  return contract
}

export const deployProxyContract = async (
  contractArtifactName: string,
  constructorArguments?: any[],
  options?: DeployContractOptions
): Promise<ethers.Contract> => {
  const log = (message: string) => {
    if (!options?.silent) console.log(message)
  }

  log(`\nStarting deployment process of "${contractArtifactName}"...`)

  const wallet = options?.wallet ?? getWallet()
  const deployer = new Deployer(hre, wallet)

  const artifact = await deployer
    .loadArtifact(contractArtifactName)
    .catch((error) => {
      if (
        error?.message?.includes(
          `Artifact for contract "${contractArtifactName}" not found.`
        )
      ) {
        console.error(error.message)
        throw `⛔️ Please make sure you have compiled your contracts or specified the correct contract name!`
      } else {
        throw error
      }
    })

  const contract = await hre.zkUpgrades.deployProxy(
    deployer.zkWallet,
    artifact,
    constructorArguments,
    {
      /* 
      deploymentTypeImpl: 'create2',
      deploymentTypeProxy: 'create2',
      saltImpl: id('1234'),
      saltProxy: id('1234'),
    */
      initializer: 'initialize'
    },
    options?.silent
  )

  await contract.waitForDeployment()

  const proxyAddress = await contract.getAddress()
  const implAddress = await getImplementationAddress(
    getProvider(),
    proxyAddress
  )

  // Display contract deployment info
  log(`\n"${artifact.contractName}" was successfully deployed !`)
  log(` - Proxy address: ${proxyAddress}`)
  log(` - Implementation address: ${implAddress}`)

  if (!options?.noVerify && hre.network.config.verifyURL) {
    log(`Requesting impl contract verification...`)
    try {
      await verifyContract({
        address: implAddress
      })
      console.log(`Requesting proxy contract verification...`)
      await verifyContract({
        address: proxyAddress
      })
    } catch (e) {
      console.log(`Error verifying contract: ${e}`)
    }
  }

  return contract
}

export const upgradeProxyContract = async (
  contractProxyAddress: string,
  contractUpgradedArtifactName: string,
  options?: DeployContractOptions
): Promise<string> => {
  const log = (message: string) => {
    if (!options?.silent) console.log(message)
  }

  const provider = getProvider()

  const wallet = options?.wallet ?? getWallet()
  const deployer = new Deployer(hre, wallet)

  const chainId = (await provider.getNetwork()).chainId.toString()

  log(
    `\n[chainId = ${chainId}] - Starting upgrade process to "${contractUpgradedArtifactName}" for proxy ${contractProxyAddress}...`
  )

  const artifact = await deployer.loadArtifact(contractUpgradedArtifactName)
  const upgrade = await hre.zkUpgrades.upgradeProxy(
    deployer.zkWallet,
    contractProxyAddress,
    artifact
  )

  await upgrade.waitForDeployment()

  const newImplementation = await getImplementationAddress(
    getProvider(),
    contractProxyAddress
  )

  log(
    `\n"${contractProxyAddress}" was successfully upgraded to ${newImplementation} with ${contractUpgradedArtifactName}  !`
  )

  if (!options?.noVerify && hre.network.config.verifyURL) {
    log(`Requesting contract verification...`)
    try {
      await verifyContract({
        address: newImplementation
      })
    } catch (e) {
      console.log(`Error verifying contract: ${e}`)
    }
  }

  return newImplementation
}

/**
 * Rich wallets can be used for testing purposes.
 * Available on ZKsync In-memory node and Dockerized node.
 */
export const LOCAL_RICH_WALLETS = [
  {
    address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    privateKey:
      '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
  },
  {
    address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    privateKey:
      '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'
  },
  {
    address: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
    privateKey:
      '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a'
  },
  {
    address: '0x90F79bf6EB2c4f870365E785982E1f101E93b906',
    privateKey:
      '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6'
  },
  {
    address: '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65',
    privateKey:
      '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a'
  },
  {
    address: '0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc',
    privateKey:
      '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba'
  },
  {
    address: '0x976EA74026E726554dB657fA54763abd0C3a0aa9',
    privateKey:
      '0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e'
  },
  {
    address: '0x14dC79964da2C08b23698B3D3cc7Ca32193d9955',
    privateKey:
      '0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356'
  },
  {
    address: '0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f',
    privateKey:
      '0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97'
  },
  {
    address: '0xa0Ee7A142d267C1f36714E4a8F75612F20a79720',
    privateKey:
      '0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6'
  }
]
