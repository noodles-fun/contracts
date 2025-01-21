import { formatEther } from 'ethers'
import fs from 'fs'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { Deployer } from '@matterlabs/hardhat-zksync'
import { Wallet } from 'zksync-ethers'
import { getImplementationAddress } from '../utils'

export default async function (hre: HardhatRuntimeEnvironment) {
  if (!process.env.ADMIN_PRIVATE_KEY) {
    throw new Error('Please set your ADMIN_PRIVATE_KEY in a .env file')
  }

  const wallet = new Wallet(process.env.ADMIN_PRIVATE_KEY)
  const admin = new Deployer(hre, wallet)

  const visibilityServicesProxyAddr =
    '0xe9f915bE546BE513c880E39E515D52002ced7c7b'
  const VisibilityService = await admin.loadArtifact('VisibilityServices')

  await hre.zkUpgrades.upgradeProxy(
    admin.zkWallet,
    visibilityServicesProxyAddr,
    VisibilityService
  )
  const implementationAddress = await getImplementationAddress(
    visibilityServicesProxyAddr
  )

  console.log('VisibilityServices upgraded to ', implementationAddress)
}
