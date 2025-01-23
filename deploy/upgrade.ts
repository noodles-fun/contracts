import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { Deployer } from '@matterlabs/hardhat-zksync'
import { Wallet } from 'zksync-ethers'
import { getImplementationAddress, getProvider, verifyContract } from '../utils'

import deploymentsJSON from '../deployments.json'

const deployments = deploymentsJSON as unknown as {
  [chainId: string]: {
    VisibilityCredits: { proxy: string }
    VisibilityServices: { proxy: string }
  }
}

export default async function (hre: HardhatRuntimeEnvironment) {
  if (!process.env.ADMIN_PRIVATE_KEY) {
    throw new Error('Please set your ADMIN_PRIVATE_KEY in a .env file')
  }

  const wallet = new Wallet(process.env.ADMIN_PRIVATE_KEY)
  const admin = new Deployer(hre, wallet)

  const chainId = (await getProvider().getNetwork()).chainId.toString()

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
    visibilityServicesProxyAddr
  )

  console.log('VisibilityServices upgraded to ', vsImplementationAddress)

  console.log('Verifying implementations contracts...')

  await verifyContract({
    address: vcImplementationAddress
  })

  await verifyContract({
    address: vsImplementationAddress
  })
}
