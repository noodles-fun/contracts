import { formatEther } from 'ethers'
import fs from 'fs'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { Deployer } from '@matterlabs/hardhat-zksync'
import { Wallet } from 'zksync-ethers'
import { deployProxyContract, getProvider } from '../utils'

export default async function (hre: HardhatRuntimeEnvironment) {
  if (!process.env.DEPLOYER_PRIVATE_KEY) {
    throw new Error('Please set your DEPLOYER_PRIVATE_KEY in a .env file')
  }
  if (!process.env.ADMIN_ADDRESS) {
    throw new Error('Please set your ADMIN_ADDRESS in a .env file')
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
    Creators linker: ${process.env.CREATORS_LINKER_ADDRESS}
    Dispute resolver: ${process.env.DISPUTE_RESOLVER_ADDRESS}
    Partners linker: ${process.env.PARTNERS_LINKER_ADDRESS}
    Treasury: ${process.env.TREASURY_ADDRESS}
    
    `
  )

  const creditsContract = await deployProxyContract(
    'VisibilityCredits',
    [
      0, // will change to adminDelay
      deployerAddr, // will change to admin address
      process.env.CREATORS_LINKER_ADDRESS,
      process.env.PARTNERS_LINKER_ADDRESS,
      process.env.TREASURY_ADDRESS
    ],
    {
      silent: false,
      noVerify: false,
      wallet
    }
  )
  const creditsContractAddr = await creditsContract.getAddress()

  const servicesContract = await deployProxyContract(
    'VisibilityServices',
    [
      creditsContractAddr,
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
  const servicesContractAddr = await servicesContract.getAddress()

  console.log('Authorizing services contract to transfer credits...')
  let tx = await creditsContract.grantCreatorTransferRole(servicesContractAddr)
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

  console.log('Changing proxy admin owner...')
  await hre.zkUpgrades.admin.transferProxyAdminOwnership(
    creditsContractAddr,
    process.env.ADMIN_ADDRESS,
    deployer.zkWallet
  )
  await hre.zkUpgrades.admin.transferProxyAdminOwnership(
    servicesContractAddr,
    process.env.ADMIN_ADDRESS,
    deployer.zkWallet
  )

  const deploymentsJSON = JSON.parse(
    fs.readFileSync('deployments.json', 'utf8')
  )
  deploymentsJSON[hre.network.config.chainId as number] = {
    VisibilityCredits: {
      proxy: creditsContractAddr
    },

    VisibilityServices: {
      proxy: servicesContractAddr
    }
  }
  fs.writeFileSync('deployments.json', JSON.stringify(deploymentsJSON, null, 2))
  console.log('🥳 Done')
}
