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

/*

Deploy to abstractTestnet
    Deployer: 0x1B30bFa535f8c3eB6Ca66c63C6c0BE65c70A26BE (balance = 0.037031502651271449 ETH)
    Admin: 0x8811c5f40F1bF008c91e084BF4159b8cDEd2898B
    Creators linker: 0x8811c5f40F1bF008c91e084BF4159b8cDEd2898B
    Dispute resolver: 0x8811c5f40F1bF008c91e084BF4159b8cDEd2898B
    Partners linker: 0x8811c5f40F1bF008c91e084BF4159b8cDEd2898B
    Treasury: 0xda6bbE41370cA0c2b132ebe5FBeD4c0782E0eCB5
zksolc v1.5.8 and zkvm-solc v0.8.26-1.0.1

VisibilityCredits
Implementation: 0x153CD6a96a97e123C78162b9c9b4d26cf05A8136
Proxy admin: 0x44Fd48311ba9D395862C975c76b37F756F353cF3
Transparent proxy: 0x00fbeC67F05fc30898670BB7510863216E4d2C95

VisibilityServices
Implementation: 0x6D445b43c1D7B71957a8c7B7de82422580a04e7f
Proxy admin: 0x70CC66EA34533Aeb39D0eA136fa6ADA21bbB792d
Transparent proxy: 0xe9f915bE546BE513c880E39E515D52002ced7c7b

*/
