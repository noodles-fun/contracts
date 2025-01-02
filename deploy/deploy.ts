import { Wallet } from 'zksync-ethers'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { formatEther } from 'ethers'
import { deployContract, getProvider, verifyContract } from '../utils'

export default async function (hre: HardhatRuntimeEnvironment) {
  if (!process.env.DEPLOYER_PRIVATE_KEY) {
    throw new Error('Please set your DEPLOYER_PRIVATE_KEY in a .env file')
  }
  if (!process.env.CREATORS_LINKER_ADDRESS) {
    throw new Error('Please set your CREATORS_LINKER_ADDRESS in a .env file')
  }
  if (!process.env.DISPUTE_RESOLVER_ADDRESS) {
    throw new Error('Please set your DISPUTE_RESOLVER_ADDRESS in a .env file')
  }
  if (!process.env.PARTNERS_LINKER_ADDRESS) {
    throw new Error('Please set your PARTNERS_LINKER_ADDRESS in a .env file')
  }
  if (!process.env.TREASURY_ADDRESS) {
    throw new Error('Please set your TREASURY_ADDRESS in a .env file')
  }

  const wallet = new Wallet(process.env.DEPLOYER_PRIVATE_KEY)
  const provider = getProvider()

  const deployerAddr = wallet.address
  const deployerBalance = await provider.getBalance(deployerAddr)

  console.log(
    `Ready to deploy to ${hre.network.name}
    -------------------------------
    Deployer: ${deployerAddr} (balance = ${formatEther(deployerBalance.toString())} ETH) 
    Creators linker: ${process.env.CREATORS_LINKER_ADDRESS}
    Dispute resolver: ${process.env.DISPUTE_RESOLVER_ADDRESS}
    Partners linker: ${process.env.PARTNERS_LINKER_ADDRESS}
    Treasury: ${process.env.TREASURY_ADDRESS}
    
    `
  )

  const creditsConstructorArguments = [
    process.env.TREASURY_ADDRESS,
    process.env.CREATORS_LINKER_ADDRESS,
    process.env.PARTNERS_LINKER_ADDRESS
  ]
  const creditsContract = await deployContract(
    'VisibilityCredits',
    creditsConstructorArguments,
    {
      silent: false,
      noVerify: false,
      wallet
    }
  )
  const creditsContractAddr = await creditsContract.getAddress()

  const servicesConstructorArguments = [
    creditsContractAddr,
    process.env.DISPUTE_RESOLVER_ADDRESS
  ]
  const servicesContract = await deployContract(
    'VisibilityServices',
    servicesConstructorArguments,
    {
      silent: false,
      noVerify: false,
      wallet
    }
  )
  const servicesContractAddr = await servicesContract.getAddress()

  console.log('Authorizing services contract to transfer credits...')
  const tx =
    await creditsContract.grantCreatorTransferRole(servicesContractAddr)
  await tx.wait()
  console.log('🥳 Done', {
    creditsContractAddr,
    servicesContractAddr
  })
}
