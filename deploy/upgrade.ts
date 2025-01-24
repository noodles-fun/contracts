import { getImplementationAddress } from '@openzeppelin/upgrades-core'
import { Deployer } from '@matterlabs/hardhat-zksync'
import fs from 'fs'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { Wallet } from 'zksync-ethers'
import { getProvider, verifyContract } from '../utils'
import { deployments } from '../utils/deployments'

export default async function (hre: HardhatRuntimeEnvironment) {
  if (!process.env.ADMIN_PRIVATE_KEY) {
    throw new Error('Please set your ADMIN_PRIVATE_KEY in a .env file')
  }

  const provider = getProvider()

  const wallet = new Wallet(process.env.ADMIN_PRIVATE_KEY)
  const admin = new Deployer(hre, wallet)

  const chainId = (await getProvider().getNetwork()).chainId.toString()

  const pointsSBTContractProxyAddr = deployments[chainId].PointsSBT.proxy

  const PointsSBT = await admin.loadArtifact('PointsSBT')

  console.log('Upgrading PointsSBT...', {
    pointsSBTContractProxyAddr,
    chainId
  })

  const psUpgrade = await hre.zkUpgrades.upgradeProxy(
    admin.zkWallet,
    pointsSBTContractProxyAddr,
    PointsSBT
  )

  await psUpgrade.waitForDeployment()

  const psImplementationAddress = await getImplementationAddress(
    provider,
    pointsSBTContractProxyAddr
  )

  console.log('PointsSBT upgraded to ', psImplementationAddress)

  const visibilityCreditsProxyAddr =
    deployments[chainId].VisibilityCredits.proxy
  const VisibilityCredits = await admin.loadArtifact('VisibilityCredits')

  console.log('Upgrading VisibilityCredits...', {
    visibilityCreditsProxyAddr,
    chainId
  })

  const vcUpgrade = await hre.zkUpgrades.upgradeProxy(
    admin.zkWallet,
    visibilityCreditsProxyAddr,
    VisibilityCredits
  )

  await vcUpgrade.waitForDeployment()

  const vcImplementationAddress = await getImplementationAddress(
    provider,
    visibilityCreditsProxyAddr
  )

  console.log('VisibilityCredits upgraded to ', vcImplementationAddress)

  const visibilityServicesProxyAddr =
    deployments[chainId].VisibilityServices.proxy

  const VisibilityService = await admin.loadArtifact('VisibilityServices')

  console.log('Upgrading VisibilityServices...', {
    visibilityServicesProxyAddr,
    chainId
  })

  const vsUpgrade = await hre.zkUpgrades.upgradeProxy(
    admin.zkWallet,
    visibilityServicesProxyAddr,
    VisibilityService
  )

  await vsUpgrade.waitForDeployment()

  const vsImplementationAddress = await getImplementationAddress(
    provider,
    visibilityServicesProxyAddr
  )

  console.log('VisibilityServices upgraded to ', vsImplementationAddress)

  console.log('Verifying implementations contracts...')

  await verifyContract({
    address: psImplementationAddress
  })

  await verifyContract({
    address: vcImplementationAddress
  })

  await verifyContract({
    address: vsImplementationAddress
  })

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
  console.log('🥳 Done')
}
