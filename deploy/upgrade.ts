import { getImplementationAddress } from '@openzeppelin/upgrades-core'
import { Deployer } from '@matterlabs/hardhat-zksync'
import fs from 'fs'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { Wallet } from 'zksync-ethers'
import { getProvider, verifyContract } from '../utils'
import { deployments } from '../utils/deployments'

export default async function (hre: HardhatRuntimeEnvironment) {
  if (!process.env.DEPLOYER_PRIVATE_KEY) {
    throw new Error('Please set your DEPLOYER_PRIVATE_KEY in a .env file')
  }
  if (!process.env.ADMIN_ADDRESS) {
    throw new Error('Please set your ADMIN_ADDRESS in a .env file')
  }

  const provider = getProvider()
  const wallet = new Wallet(process.env.DEPLOYER_PRIVATE_KEY)
  const deployer = new Deployer(hre, wallet)
  const chainId = (await getProvider().getNetwork()).chainId.toString()

  const pointsSBTContractProxyAddr = deployments[chainId].PointsSBT.proxy
  const visibilityCreditsProxyAddr =
    deployments[chainId].VisibilityCredits.proxy
  const visibilityServicesProxyAddr =
    deployments[chainId].VisibilityServices.proxy

  /*
  const PointsSBT = await deployer.loadArtifact('PointsSBT')
  console.log('Upgrading PointsSBT...', {
    pointsSBTContractProxyAddr,
    chainId
  })
  const psUpgrade = await hre.zkUpgrades.upgradeProxy(
    deployer.zkWallet,
    pointsSBTContractProxyAddr,
    PointsSBT
  )
  await psUpgrade.waitForDeployment()
*/
  const VisibilityCredits = await deployer.loadArtifact('VisibilityCredits')
  console.log('Upgrading VisibilityCredits...', {
    visibilityCreditsProxyAddr,
    chainId
  })
  const vcUpgrade = await hre.zkUpgrades.upgradeProxy(
    deployer.zkWallet,
    visibilityCreditsProxyAddr,
    VisibilityCredits
  )
  await vcUpgrade.waitForDeployment()

  const VisibilityService = await deployer.loadArtifact('VisibilityServices')
  console.log('Upgrading VisibilityServices...', {
    visibilityServicesProxyAddr,
    chainId
  })
  const vsUpgrade = await hre.zkUpgrades.upgradeProxy(
    deployer.zkWallet,
    visibilityServicesProxyAddr,
    VisibilityService
  )
  await vsUpgrade.waitForDeployment()

  const psImplementationAddress = await getImplementationAddress(
    provider,
    pointsSBTContractProxyAddr
  )
  console.log('PointsSBT upgraded to ', psImplementationAddress)
  const vsImplementationAddress = await getImplementationAddress(
    provider,
    visibilityServicesProxyAddr
  )
  console.log('VisibilityServices upgraded to ', vsImplementationAddress)
  const vcImplementationAddress = await getImplementationAddress(
    provider,
    visibilityCreditsProxyAddr
  )
  console.log('VisibilityCredits upgraded to ', vcImplementationAddress)

  /*
  try {
    console.log('Verifying PointsSBT implementations contracts...')
    await verifyContract({
      address: psImplementationAddress
    })
  } catch (e) {
    console.log(`Error verifying PointsSBT contract: ${e}`)
  }
*/

  try {
    console.log('Verifying VisibilityCredits implementations contracts...')
    await verifyContract({
      address: vcImplementationAddress
    })
  } catch (e) {
    console.log(`Error verifying VisibilityCredits contract: ${e}`)
  }

  try {
    console.log('Verifying VisibilityServices implementations contracts...')
    await verifyContract({
      address: vsImplementationAddress
    })
  } catch (e) {
    console.log(`Error verifying VisibilityServices contract: ${e}`)
  }

  deployments[hre.network.config.chainId as number] = {
    wallets: deployments[hre.network.config.chainId as number].wallets,

    PointsSBT: {
      implementation: psImplementationAddress,
      proxyAdmin:
        deployments[hre.network.config.chainId as number].PointsSBT.proxyAdmin,
      proxy: pointsSBTContractProxyAddr
    },

    VisibilityCredits: {
      implementation: vcImplementationAddress,
      proxyAdmin:
        deployments[hre.network.config.chainId as number].VisibilityCredits
          .proxyAdmin,
      proxy: visibilityCreditsProxyAddr
    },

    VisibilityServices: {
      implementation: vsImplementationAddress,
      proxyAdmin:
        deployments[hre.network.config.chainId as number].VisibilityServices
          .proxyAdmin,
      proxy: visibilityServicesProxyAddr
    }
  }
  fs.writeFileSync('deployments.json', JSON.stringify(deployments, null, 2))

  console.log('Changing proxy admin owner...')
  /*
  await hre.zkUpgrades.admin.transferProxyAdminOwnership(
    pointsSBTContractProxyAddr,
    process.env.ADMIN_ADDRESS,
    deployer.zkWallet
  )
    */
  await hre.zkUpgrades.admin.transferProxyAdminOwnership(
    visibilityCreditsProxyAddr,
    process.env.ADMIN_ADDRESS,
    deployer.zkWallet
  )

  await hre.zkUpgrades.admin.transferProxyAdminOwnership(
    visibilityServicesProxyAddr,
    process.env.ADMIN_ADDRESS,
    deployer.zkWallet
  )

  console.log('🥳 Done')
}
