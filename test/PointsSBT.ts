import { expect } from 'chai'
import { ContractTransactionResponse, ZeroAddress } from 'ethers'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { Provider, Wallet } from 'zksync-ethers'
import { PointsSBT } from '../typechain-types'
import { deployProxyContract, getWallets, getProvider } from '../utils'

describe('PointsSBT', function () {
  let provider: Provider
  let tx: ContractTransactionResponse

  let PointsSBTContract: PointsSBT

  let deployer: Wallet
  let owner: Wallet
  let user1: Wallet
  let user2: Wallet

  let uri =
    'https://orange-elegant-swallow-161.mypinata.cloud/ipfs/bafkreigqcfvsozxhke7tp2f37xyqdn6hmvkz5x6ho5ybwwrsxm6kca5kny'

  async function deployFixture() {
    ;[deployer, owner, user1, user2] = getWallets()

    provider = await getProvider()

    PointsSBTContract = (await deployProxyContract(
      'PointsSBT',
      [await owner.getAddress()],
      { wallet: deployer, silent: true }
    )) as unknown as PointsSBT

    await PointsSBTContract.waitForDeployment()
  }

  it('Should set the correct URI after initialization', async function () {
    await loadFixture(deployFixture)
    expect(await PointsSBTContract.tokenURI(0)).to.be.equal(uri)
    expect(await PointsSBTContract.tokenURI(888)).to.be.equal(uri)
  })

  it('Should allow the owner to mint tokens', async function () {
    await loadFixture(deployFixture)

    tx = await PointsSBTContract.connect(owner).mint(user1.address)
    await tx.wait()

    expect(tx)
      .to.emit(PointsSBTContract, 'Transfer')
      .withArgs(ZeroAddress, user1.address, 0)

    tx = await PointsSBTContract.connect(owner).mint(user2.address)
    await tx.wait()

    expect(tx)
      .to.emit(PointsSBTContract, 'Transfer')
      .withArgs(ZeroAddress, user2.address, 1)

    expect(await PointsSBTContract.ownerOf(0)).to.equal(user1.address)
    expect(await PointsSBTContract.balanceOf(user1.address)).to.equal(1)
    expect(await PointsSBTContract.ownerOf(1)).to.equal(user2.address)
    expect(await PointsSBTContract.balanceOf(user1.address)).to.equal(1)
    expect(await PointsSBTContract.totalSupply()).to.equal(2)
  })

  it('Should allow the owner to update the URI', async function () {
    await loadFixture(deployFixture)

    uri = 'ipfs://new-uri'
    await PointsSBTContract.connect(owner).setURI(uri)

    expect(await PointsSBTContract.tokenURI(0)).to.equal(uri)
    expect(await PointsSBTContract.tokenURI(1)).to.equal(uri)
  })

  it('Should revert mints from non-owner', async function () {
    await loadFixture(deployFixture)

    await expect(PointsSBTContract.connect(user1).mint(user1.address))
      .to.be.revertedWithCustomError(
        PointsSBTContract,
        'OwnableUnauthorizedAccount'
      )
      .withArgs(user1.address)
  })

  it('Should revert uri updates from non-owner', async function () {
    await loadFixture(deployFixture)

    await expect(PointsSBTContract.connect(user1).setURI('new-uri'))
      .to.be.revertedWithCustomError(
        PointsSBTContract,
        'OwnableUnauthorizedAccount'
      )
      .withArgs(user1.address)
  })

  it('Should revert if owner want to mint another token to an address', async function () {
    await loadFixture(deployFixture)

    tx = await PointsSBTContract.connect(owner).mint(user1.address)
    await tx.wait()

    await expect(
      PointsSBTContract.connect(owner).mint(user1.address)
    ).to.be.revertedWithCustomError(PointsSBTContract, 'AlreadyTokenOwner')
  })

  it('Should revert on transfer', async function () {
    await loadFixture(deployFixture)

    tx = await PointsSBTContract.connect(owner).mint(user1.address)
    await tx.wait()

    await expect(
      PointsSBTContract.connect(user1).transferFrom(
        user1.address,
        user2.address,
        0
      )
    ).to.be.revertedWithCustomError(PointsSBTContract, 'NonTransferable')
  })
})
