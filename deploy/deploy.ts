import {
  getAdminAddress,
  getImplementationAddress
} from '@openzeppelin/upgrades-core'
import { Deployer } from '@matterlabs/hardhat-zksync'
import { formatEther } from 'ethers'
import fs from 'fs'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { Wallet } from 'zksync-ethers'
import { deployProxyContract, getProvider } from '../utils'
import { deployments } from '../utils/deployments'

export default async function (hre: HardhatRuntimeEnvironment) {
  if (!process.env.DEPLOYER_PRIVATE_KEY) {
    throw new Error('Please set your DEPLOYER_PRIVATE_KEY in a .env file')
  }
  if (!process.env.ADMIN_ADDRESS) {
    throw new Error('Please set your ADMIN_ADDRESS in a .env file')
  }
  if (!process.env.BACKEND_ADDRESS) {
    throw new Error('Please set your BACKEND_ADDRESS in a .env file')
  }
  if (!process.env.DISPUTE_RESOLVER_ADDRESS) {
    throw new Error('Please set your DISPUTE_RESOLVER_ADDRESS in a .env file')
  }
  if (!process.env.TREASURY_ADDRESS) {
    throw new Error('Please set your TREASURY_ADDRESS in a .env file')
  }

  const adminDelay = 60 * 60 * 24 * 3 // 3 days

  const provider = getProvider()

  const wallet = new Wallet(process.env.DEPLOYER_PRIVATE_KEY)
  const deployer = new Deployer(hre, wallet)
  const deployerAddr = wallet.address
  const deployerBalance = await provider.getBalance(deployerAddr)

  console.log(
    `Ready to deploy to ${hre.network.name}
    -------------------------------
    Deployer: ${deployerAddr} (balance = ${formatEther(
      deployerBalance.toString()
    )} ETH) 
    Admin: ${process.env.ADMIN_ADDRESS}
    Backend address: ${process.env.BACKEND_ADDRESS}
    Dispute resolver: ${process.env.DISPUTE_RESOLVER_ADDRESS}
    Treasury: ${process.env.TREASURY_ADDRESS}
    
    `
  )

  const pointsSBTContract = await deployProxyContract(
    'PointsSBT',
    [
      process.env.BACKEND_ADDRESS // owner
    ],
    {
      silent: false,
      noVerify: false,
      wallet
    }
  )
  const pointsSBTProxyAddress = await pointsSBTContract.getAddress()
  const pointsSBTImplementationAddress = await getImplementationAddress(
    provider,
    pointsSBTProxyAddress
  )
  const pointsSBTProxyAdminAddress = await getAdminAddress(
    provider,
    pointsSBTProxyAddress
  )

  const creditsContract = await deployProxyContract(
    'VisibilityCredits',
    [
      0, // will change to adminDelay
      deployerAddr, // admin addr - will change to admin address
      process.env.BACKEND_ADDRESS, // creators linker
      process.env.BACKEND_ADDRESS, // partners linker
      process.env.TREASURY_ADDRESS
    ],
    {
      silent: false,
      noVerify: false,
      wallet
    }
  )
  const creditsProxyAddress = await creditsContract.getAddress()
  const creditsContractImplementationAddress = await getImplementationAddress(
    provider,
    creditsProxyAddress
  )
  const creditsContractProxyAdminAddress = await getAdminAddress(
    provider,
    creditsProxyAddress
  )

  const servicesContract = await deployProxyContract(
    'VisibilityServices',
    [
      creditsProxyAddress,
      0, // will change to adminDelay
      deployerAddr, // will change to admin address
      process.env.DISPUTE_RESOLVER_ADDRESS
    ],
    {
      silent: false,
      noVerify: false,
      wallet
    }
  )
  const servicesProxyAddress = await servicesContract.getAddress()
  const servicesContractImplementationAddress = await getImplementationAddress(
    provider,
    servicesProxyAddress
  )
  const servicesContractProxyAdminAddress = await getAdminAddress(
    provider,
    servicesProxyAddress
  )

  console.log('Authorizing services contract to transfer credits...')
  let tx = await creditsContract.grantCreatorTransferRole(servicesProxyAddress)
  await tx.wait()
  console.log('Services contract authorized !')

  console.log('Changing admin addresses...')
  tx = await creditsContract.beginDefaultAdminTransfer(
    process.env.ADMIN_ADDRESS
  )
  await tx.wait()
  tx = await servicesContract.beginDefaultAdminTransfer(
    process.env.ADMIN_ADDRESS
  )
  await tx.wait()
  console.log('Admin addresses changed !')

  console.log('Changing default admin delay...')
  tx = await creditsContract.changeDefaultAdminDelay(adminDelay)
  await tx.wait()
  tx = await servicesContract.changeDefaultAdminDelay(adminDelay)
  await tx.wait()

  console.log('Changing proxy admin owner...')
  await hre.zkUpgrades.admin.transferProxyAdminOwnership(
    pointsSBTProxyAddress,
    process.env.ADMIN_ADDRESS,
    deployer.zkWallet
  )
  await hre.zkUpgrades.admin.transferProxyAdminOwnership(
    creditsProxyAddress,
    process.env.ADMIN_ADDRESS,
    deployer.zkWallet
  )
  await hre.zkUpgrades.admin.transferProxyAdminOwnership(
    servicesProxyAddress,
    process.env.ADMIN_ADDRESS,
    deployer.zkWallet
  )

  deployments[hre.network.config.chainId as number] = {
    wallets: {
      deployer: deployerAddr,
      admin: process.env.ADMIN_ADDRESS,
      backend: process.env.BACKEND_ADDRESS,
      disputeResolver: process.env.DISPUTE_RESOLVER_ADDRESS,
      treasury: process.env.TREASURY_ADDRESS
    },
    PointsSBT: {
      implementation: pointsSBTImplementationAddress,
      proxyAdmin: pointsSBTProxyAdminAddress,
      proxy: pointsSBTProxyAddress
    },

    VisibilityCredits: {
      implementation: creditsContractImplementationAddress,
      proxyAdmin: creditsContractProxyAdminAddress,
      proxy: creditsProxyAddress
    },

    VisibilityServices: {
      implementation: servicesContractImplementationAddress,
      proxyAdmin: servicesContractProxyAdminAddress,
      proxy: servicesProxyAddress
    }
  }
  fs.writeFileSync('deployments.json', JSON.stringify(deployments, null, 2))
  console.log('🥳 Done')
}
