import { expect } from 'chai'
import { ContractTransactionResponse, parseEther, ZeroAddress } from 'ethers'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { Provider, Wallet } from 'zksync-ethers'
import { VisibilityCredits } from '../typechain-types'
import { deployProxyContract, getWallets, getProvider } from '../utils'

describe('VisibilityCredits', function () {
  const visibilityId1 = 'x-807982663000674305' // @LucaNetz on X

  let provider: Provider
  let tx: ContractTransactionResponse

  let creditsContract: VisibilityCredits

  let deployer: Wallet
  let admin: Wallet
  let creator1: Wallet
  let user1: Wallet
  let user2: Wallet
  let creatorsLinker: Wallet
  let partnersLinker: Wallet
  let treasury: Wallet
  let referrer: Wallet
  let partner: Wallet

  const adminDelay = 60 * 60 * 24 * 3 // 3 days

  async function deployFixture() {
    ;[
      deployer,
      admin,
      creator1,
      user1,
      user2,
      creatorsLinker,
      partnersLinker,
      treasury,
      referrer,
      partner
    ] = getWallets()

    provider = await getProvider()

    creditsContract = (await deployProxyContract(
      'VisibilityCredits',
      [
        adminDelay,
        await admin.getAddress(),
        await creatorsLinker.getAddress(),
        await partnersLinker.getAddress(),
        await treasury.getAddress()
      ],
      { wallet: deployer, silent: true }
    )) as unknown as VisibilityCredits

    await creditsContract.waitForDeployment()

    tx = await creditsContract
      .connect(creatorsLinker)
      .setCreatorVisibility(visibilityId1, await creator1.getAddress())

    await tx.wait()
  }

  describe('Initial Setup', function () {
    it('Should set the correct protocol treasury', async function () {
      await loadFixture(deployFixture)
      await creditsContract.getProtocolTreasury()
      expect(await creditsContract.getProtocolTreasury()).to.be.equal(
        treasury.address
      )
    })

    it('Should assign creatorsLinker the CREATORS_LINKER_ROLE', async function () {
      await loadFixture(deployFixture)
      const role = await creditsContract.CREATORS_LINKER_ROLE()
      expect(
        await creditsContract.hasRole(role, creatorsLinker.address)
      ).to.be.equal(true)
    })
  })

  describe('Buying Credits', function () {
    it('Should allow users to buy credits and update their balance', async function () {
      await loadFixture(deployFixture)

      const amount = BigInt('1')
      const [buyCost] = await creditsContract.buyCostWithFees(
        visibilityId1,
        amount,
        user1,
        referrer
      )
      let tx = await creditsContract
        .connect(user1)
        .buyCredits(visibilityId1, amount, referrer, { value: buyCost })
      await tx.wait()

      const balance = await creditsContract.getVisibilityCreditBalance(
        visibilityId1,
        user1.address
      )

      expect(balance).to.be.equal(amount)
    })

    it('Should revert if insufficient Ether is sent', async function () {
      await loadFixture(deployFixture)

      const amount = BigInt('1')
      const [buyCost] = await creditsContract.buyCostWithFees(
        visibilityId1,
        amount,
        user1,
        referrer
      )

      await expect(
        creditsContract
          .connect(user1)
          .buyCredits(visibilityId1, amount, ZeroAddress, {
            value: buyCost - BigInt(1)
          })
      ).to.be.revertedWithCustomError(creditsContract, 'NotEnoughEthSent')
    })

    it('Should handle multiple purchases and update balances and protocol fees correctly', async function () {
      await loadFixture(deployFixture)

      const amounts = [BigInt('2'), BigInt('4'), BigInt('1')]

      for (const amount of amounts) {
        const [buyCost, { tradeCost, creatorFee, protocolFee, referrerFee }] =
          await creditsContract.buyCostWithFees(
            visibilityId1,
            amount,
            user1,
            referrer
          )

        const creditsContractBalanceBefore = await provider.getBalance(
          await creditsContract.getAddress()
        )
        const treasuryBalanceBefore = await treasury.getBalance()
        const referrerBalanceBefore = await referrer.getBalance()

        tx = await creditsContract
          .connect(user1)
          .buyCredits(visibilityId1, amount, referrer.address, {
            value: buyCost
          })
        await tx.wait()

        const creditsContractBalanceAfter = await provider.getBalance(
          await creditsContract.getAddress()
        )
        const treasuryBalanceAfter = await treasury.getBalance()
        const referrerBalanceAfter = await referrer.getBalance()

        expect(
          creditsContractBalanceAfter - creditsContractBalanceBefore
        ).to.be.equal(tradeCost + creatorFee)
        expect(treasuryBalanceAfter - treasuryBalanceBefore).to.be.equal(
          protocolFee
        )
        expect(referrerBalanceAfter - referrerBalanceBefore).to.be.equal(
          referrerFee
        )
      }
    })
  })

  describe('Selling Credits', function () {
    it('Should allow users to sell credits and receive Ether', async function () {
      await loadFixture(deployFixture)

      const amount = BigInt('1')
      const [buyCost] = await creditsContract.buyCostWithFees(
        visibilityId1,
        amount,
        user1,
        referrer
      )

      tx = await creditsContract
        .connect(user1)
        .buyCredits(visibilityId1, amount, referrer, { value: buyCost })
      await tx.wait()

      tx = await creditsContract
        .connect(user1)
        .sellCredits(visibilityId1, amount, referrer)
      await tx.wait()

      const balance = await creditsContract.getVisibilityCreditBalance(
        visibilityId1,
        user1.address
      )

      expect(balance).to.be.equal(0)
    })

    it('Should revert if user tries to sell more credits than they own', async function () {
      await loadFixture(deployFixture)

      await expect(
        creditsContract
          .connect(user1)
          .sellCredits(visibilityId1, parseEther('1'), ZeroAddress)
      ).to.be.revertedWithCustomError(creditsContract, 'NotEnoughCreditsOwned')
    })

    it('Should handle multiple sells and verify balances and fees are updated correctly', async function () {
      await loadFixture(deployFixture)

      const buyAmount = 6
      const [buyCost] = await creditsContract.buyCostWithFees(
        visibilityId1,
        buyAmount,
        user2,
        referrer
      )

      tx = await creditsContract
        .connect(user2)
        .buyCredits(visibilityId1, buyAmount, referrer, { value: buyCost })
      await tx.wait()

      const sellAmounts = [2, 1, 3]
      for (const amount of sellAmounts) {
        const [reimbursement, { protocolFee, referrerFee }] =
          await creditsContract.sellCostWithFees(
            visibilityId1,
            amount,
            user2,
            referrer
          )

        const user2BalanceBefore = await user2.getBalance()
        const creditsContractBalanceBefore = await provider.getBalance(
          await creditsContract.getAddress()
        )
        const treasuryBalanceBefore = await treasury.getBalance()
        const referrerBalanceBefore = await referrer.getBalance()

        tx = await creditsContract
          .connect(user2)
          .sellCredits(visibilityId1, amount, referrer.address)
        await tx.wait()

        const user2BalanceAfter = await user2.getBalance()
        const creditsContractBalanceAfter = await provider.getBalance(
          await creditsContract.getAddress()
        )
        const treasuryBalanceAfter = await treasury.getBalance()
        const referrerBalanceAfter = await referrer.getBalance()

        expect(user2BalanceAfter).to.be.greaterThan(user2BalanceBefore)
        expect(
          creditsContractBalanceAfter - creditsContractBalanceBefore
        ).to.be.equal(-reimbursement - protocolFee - referrerFee)
        expect(treasuryBalanceAfter - treasuryBalanceBefore).to.be.equal(
          protocolFee
        )
        expect(referrerBalanceAfter - referrerBalanceBefore).to.be.equal(
          referrerFee
        )
      }
    })
  })

  describe('Credits Transfer', function () {
    it('Should transfer credits only if caller has CREDITS_TRANSFER_ROLE', async function () {
      await loadFixture(deployFixture)

      // Give user1 some credits first
      const amount = 2n
      const [buyCost] = await creditsContract.buyCostWithFees(
        visibilityId1,
        amount,
        user1,
        ZeroAddress
      )
      await creditsContract
        .connect(user1)
        .buyCredits(visibilityId1, amount, ZeroAddress, { value: buyCost })

      // Try transfer without role => revert
      await expect(
        creditsContract
          .connect(user1)
          .transferCredits(visibilityId1, user1.address, user2.address, 1n)
      ).to.be.revertedWithCustomError(
        creditsContract,
        'AccessControlUnauthorizedAccount'
      )

      // Grant role
      tx = await creditsContract
        .connect(admin)
        .grantCreatorTransferRole(user1.address)
      await tx.wait()

      // Transfer works
      await creditsContract
        .connect(user1)
        .transferCredits(visibilityId1, user1.address, user2.address, 1n)

      const balance1 = await creditsContract.getVisibilityCreditBalance(
        visibilityId1,
        user1.address
      )
      const balance2 = await creditsContract.getVisibilityCreditBalance(
        visibilityId1,
        user2.address
      )

      expect(balance1).to.equal(1n)
      expect(balance2).to.equal(1n)

      // Transfer more than available => revert
      await expect(
        creditsContract
          .connect(user1)
          .transferCredits(visibilityId1, user1.address, user2.address, 999n)
      ).to.be.revertedWithCustomError(creditsContract, 'NotEnoughCreditsOwned')
    })
  })

  describe('Fees Calculation', function () {
    it('Should calculate fees correctly without referrer', async function () {
      await loadFixture(deployFixture)

      const referrer = ZeroAddress
      const buyAmount = 6
      const [
        buyCost,
        {
          tradeCost: tradeCostBuy,
          creatorFee: creatorFeeBuy,
          protocolFee: protocolFeeBuy,
          referrerFee: referrerFeeBuy,
          partnerFee: partnerFeeBuy,
          referrer: referrerBuy,
          partner: partnerBuy
        }
      ] = await creditsContract.buyCostWithFees(
        visibilityId1,
        buyAmount,
        user2,
        referrer
      )

      expect(buyCost).to.be.equal(
        tradeCostBuy +
          creatorFeeBuy +
          protocolFeeBuy +
          referrerFeeBuy +
          partnerFeeBuy
      )
      expect(creatorFeeBuy).to.be.equal(
        ((await creditsContract.CREATOR_FEE()) * tradeCostBuy) /
          (await creditsContract.FEE_DENOMINATOR())
      )
      expect(protocolFeeBuy).to.be.equal(
        ((await creditsContract.PROTOCOL_FEE()) * tradeCostBuy) /
          (await creditsContract.FEE_DENOMINATOR())
      )
      expect(referrerFeeBuy).to.be.equal(0)
      expect(partnerFeeBuy).to.be.equal(0)
      expect(referrerBuy).to.be.equal(ZeroAddress)
      expect(partnerBuy).to.be.equal(ZeroAddress)

      const contractBalanceBefore = await provider.getBalance(
        await creditsContract.getAddress()
      )
      const treasuryBalanceBefore = await provider.getBalance(
        await treasury.getAddress()
      )
      const [, , claimBalanceBefore] = await creditsContract.getVisibility(
        visibilityId1
      )
      const visibilityBalanceBefore =
        await creditsContract.getVisibilityCreditBalance(
          visibilityId1,
          user2.address
        )

      tx = await creditsContract
        .connect(user2)
        .buyCredits(visibilityId1, buyAmount, referrer, { value: buyCost })
      await tx.wait()

      const contractBalanceAfterBuy = await provider.getBalance(
        await creditsContract.getAddress()
      )
      const treasuryBalanceAfterBuy = await provider.getBalance(
        await treasury.getAddress()
      )
      const [, , claimBalanceAfterBuy] = await creditsContract.getVisibility(
        visibilityId1
      )
      const visibilityBalanceAfterBuy =
        await creditsContract.getVisibilityCreditBalance(
          visibilityId1,
          user2.address
        )

      expect(contractBalanceAfterBuy - contractBalanceBefore).to.be.equal(
        tradeCostBuy + creatorFeeBuy
      )
      expect(treasuryBalanceAfterBuy - treasuryBalanceBefore).to.be.equal(
        protocolFeeBuy
      )
      expect(claimBalanceAfterBuy - claimBalanceBefore).to.be.equal(
        creatorFeeBuy
      )
      expect(visibilityBalanceAfterBuy - visibilityBalanceBefore).to.be.equal(
        buyAmount
      )

      const sellAmount = 4
      const [
        reimbursement,
        {
          tradeCost: tradeCostSell,
          creatorFee: creatorFeeSell,
          protocolFee: protocolFeeSell,
          referrerFee: referrerFeeSell,
          partnerFee: partnerFeeSell,
          referrer: referrerSell,
          partner: partnerSell
        }
      ] = await creditsContract.sellCostWithFees(
        visibilityId1,
        sellAmount,
        user2,
        referrer
      )
      expect(tradeCostSell).to.be.equal(
        reimbursement +
          creatorFeeSell +
          protocolFeeSell +
          referrerFeeSell +
          partnerFeeSell
      )
      expect(creatorFeeSell).to.be.equal(
        ((await creditsContract.CREATOR_FEE()) * tradeCostSell) /
          (await creditsContract.FEE_DENOMINATOR())
      )
      expect(protocolFeeSell).to.be.equal(
        ((await creditsContract.PROTOCOL_FEE()) * tradeCostSell) /
          (await creditsContract.FEE_DENOMINATOR())
      )
      expect(referrerFeeSell).to.be.equal(0)
      expect(partnerFeeSell).to.be.equal(0)
      expect(referrerSell).to.be.equal(ZeroAddress)
      expect(partnerSell).to.be.equal(ZeroAddress)

      tx = await creditsContract
        .connect(user2)
        .sellCredits(visibilityId1, sellAmount, referrer)
      await tx.wait()

      const contractBalanceAfterSell = await provider.getBalance(
        await creditsContract.getAddress()
      )
      const treasuryBalanceAfterSell = await provider.getBalance(
        await treasury.getAddress()
      )
      const [, , claimBalanceAfterSell] = await creditsContract.getVisibility(
        visibilityId1
      )
      const visibilityBalanceAfterSell =
        await creditsContract.getVisibilityCreditBalance(
          visibilityId1,
          user2.address
        )

      expect(contractBalanceAfterSell - contractBalanceAfterBuy).to.be.equal(
        -(tradeCostSell - creatorFeeSell)
      )
      expect(treasuryBalanceAfterSell - treasuryBalanceAfterBuy).to.be.equal(
        protocolFeeSell
      )
      expect(claimBalanceAfterSell - claimBalanceAfterBuy).to.be.equal(
        creatorFeeSell
      )
      expect(visibilityBalanceAfterSell).to.be.equal(buyAmount - sellAmount)
    })

    it('Should calculate fees correctly with a referrer (not linked to a partner)', async function () {
      await loadFixture(deployFixture)

      const buyAmount = 6
      const [
        buyCost,
        {
          tradeCost: tradeCostBuy,
          creatorFee: creatorFeeBuy,
          protocolFee: protocolFeeBuy,
          referrerFee: referrerFeeBuy,
          partnerFee: partnerFeeBuy,
          referrer: referrerBuy,
          partner: partnerBuy
        }
      ] = await creditsContract.buyCostWithFees(
        visibilityId1,
        buyAmount,
        user2,
        referrer
      )

      expect(buyCost).to.be.equal(
        tradeCostBuy +
          creatorFeeBuy +
          protocolFeeBuy +
          referrerFeeBuy +
          partnerFeeBuy
      )
      expect(creatorFeeBuy).to.be.equal(
        ((await creditsContract.CREATOR_FEE()) * tradeCostBuy) /
          (await creditsContract.FEE_DENOMINATOR())
      )
      expect(protocolFeeBuy).to.be.equal(
        (((await creditsContract.PROTOCOL_FEE()) -
          (await creditsContract.REFERRER_FEE())) *
          tradeCostBuy) /
          (await creditsContract.FEE_DENOMINATOR())
      )
      expect(referrerFeeBuy).to.be.equal(
        ((await creditsContract.REFERRER_FEE()) * tradeCostBuy) /
          (await creditsContract.FEE_DENOMINATOR())
      )
      expect(partnerFeeBuy).to.be.equal(0)
      expect(referrerBuy).to.be.equal(referrer.address)
      expect(partnerBuy).to.be.equal(ZeroAddress)

      const contractBalanceBefore = await provider.getBalance(
        await creditsContract.getAddress()
      )
      const treasuryBalanceBefore = await provider.getBalance(
        await treasury.getAddress()
      )
      const referrerBalanceBefore = await provider.getBalance(
        await referrer.getAddress()
      )
      const [, , claimBalanceBefore] = await creditsContract.getVisibility(
        visibilityId1
      )
      const visibilityBalanceBefore =
        await creditsContract.getVisibilityCreditBalance(
          visibilityId1,
          user2.address
        )

      tx = await creditsContract
        .connect(user2)
        .buyCredits(visibilityId1, buyAmount, referrer, { value: buyCost })
      await tx.wait()

      const contractBalanceAfterBuy = await provider.getBalance(
        await creditsContract.getAddress()
      )
      const treasuryBalanceAfterBuy = await provider.getBalance(
        await treasury.getAddress()
      )
      const referrerBalanceAfterBuy = await provider.getBalance(
        await referrer.getAddress()
      )
      const [, , claimBalanceAfterBuy] = await creditsContract.getVisibility(
        visibilityId1
      )
      const visibilityBalanceAfterBuy =
        await creditsContract.getVisibilityCreditBalance(
          visibilityId1,
          user2.address
        )

      expect(contractBalanceAfterBuy - contractBalanceBefore).to.be.equal(
        tradeCostBuy + creatorFeeBuy
      )
      expect(treasuryBalanceAfterBuy - treasuryBalanceBefore).to.be.equal(
        protocolFeeBuy
      )
      expect(referrerBalanceAfterBuy - referrerBalanceBefore).to.be.equal(
        referrerFeeBuy
      )
      expect(claimBalanceAfterBuy - claimBalanceBefore).to.be.equal(
        creatorFeeBuy
      )
      expect(visibilityBalanceAfterBuy - visibilityBalanceBefore).to.be.equal(
        buyAmount
      )

      const sellAmount = 4
      const [
        reimbursement,
        {
          tradeCost: tradeCostSell,
          creatorFee: creatorFeeSell,
          protocolFee: protocolFeeSell,
          referrerFee: referrerFeeSell,
          partnerFee: partnerFeeSell,
          referrer: referrerSell,
          partner: partnerSell
        }
      ] = await creditsContract.sellCostWithFees(
        visibilityId1,
        sellAmount,
        user2,
        ZeroAddress // referrer is recorded
      )

      expect(tradeCostSell).to.be.equal(
        reimbursement +
          creatorFeeSell +
          protocolFeeSell +
          referrerFeeSell +
          partnerFeeSell
      )
      expect(creatorFeeSell).to.be.equal(
        ((await creditsContract.CREATOR_FEE()) * tradeCostSell) /
          (await creditsContract.FEE_DENOMINATOR())
      )
      expect(protocolFeeSell).to.be.equal(
        (((await creditsContract.PROTOCOL_FEE()) -
          (await creditsContract.REFERRER_FEE())) *
          tradeCostSell) /
          (await creditsContract.FEE_DENOMINATOR())
      )
      expect(referrerFeeSell).to.be.equal(
        ((await creditsContract.REFERRER_FEE()) * tradeCostSell) /
          (await creditsContract.FEE_DENOMINATOR())
      )
      expect(partnerFeeSell).to.be.equal(0)
      expect(referrerSell).to.be.equal(referrer.address)
      expect(partnerSell).to.be.equal(ZeroAddress)

      tx = await creditsContract
        .connect(user2)
        .sellCredits(visibilityId1, sellAmount, ZeroAddress)
      await tx.wait()

      const contractBalanceAfterSell = await provider.getBalance(
        await creditsContract.getAddress()
      )
      const treasuryBalanceAfterSell = await provider.getBalance(
        await treasury.getAddress()
      )
      const referrerBalanceAfterSell = await provider.getBalance(
        await referrer.getAddress()
      )
      const [, , claimBalanceAfterSell] = await creditsContract.getVisibility(
        visibilityId1
      )
      const visibilityBalanceAfterSell =
        await creditsContract.getVisibilityCreditBalance(
          visibilityId1,
          user2.address
        )

      expect(contractBalanceAfterSell - contractBalanceAfterBuy).to.be.equal(
        -(tradeCostSell - creatorFeeSell)
      )
      expect(treasuryBalanceAfterSell - treasuryBalanceAfterBuy).to.be.equal(
        protocolFeeSell
      )
      expect(referrerBalanceAfterSell - referrerBalanceAfterBuy).to.be.equal(
        referrerFeeSell
      )
      expect(claimBalanceAfterSell - claimBalanceAfterBuy).to.be.equal(
        creatorFeeSell
      )
      expect(visibilityBalanceAfterSell).to.be.equal(buyAmount - sellAmount)
    })

    it('Should calculate fees correctly with a referrer (linked to a partner)', async function () {
      await loadFixture(deployFixture)

      tx = await creditsContract
        .connect(partnersLinker)
        .setReferrerPartner(referrer.address, partner.address)
      await tx.wait()

      const buyAmount = 6

      const [
        buyCost,
        {
          tradeCost: tradeCostBuy,
          creatorFee: creatorFeeBuy,
          protocolFee: protocolFeeBuy,
          referrerFee: referrerFeeBuy,
          partnerFee: partnerFeeBuy,
          referrer: referrerBuy,
          partner: partnerBuy
        }
      ] = await creditsContract.buyCostWithFees(
        visibilityId1,
        buyAmount,
        user2,
        referrer
      )

      expect(buyCost).to.be.equal(
        tradeCostBuy +
          creatorFeeBuy +
          protocolFeeBuy +
          referrerFeeBuy +
          partnerFeeBuy
      )
      expect(creatorFeeBuy).to.be.equal(
        ((await creditsContract.CREATOR_FEE()) * tradeCostBuy) /
          (await creditsContract.FEE_DENOMINATOR())
      )
      expect(protocolFeeBuy).to.be.equal(
        (((await creditsContract.PROTOCOL_FEE()) -
          (await creditsContract.REFERRER_FEE()) -
          (await creditsContract.PARTNER_REFERRER_BONUS()) -
          (await creditsContract.PARTNER_FEE())) *
          tradeCostBuy) /
          (await creditsContract.FEE_DENOMINATOR())
      )
      expect(referrerFeeBuy).to.be.equal(
        (((await creditsContract.REFERRER_FEE()) +
          (await creditsContract.PARTNER_REFERRER_BONUS())) *
          tradeCostBuy) /
          (await creditsContract.FEE_DENOMINATOR())
      )
      expect(partnerFeeBuy).to.be.equal(
        ((await creditsContract.PARTNER_FEE()) * tradeCostBuy) /
          (await creditsContract.FEE_DENOMINATOR())
      )
      expect(referrerBuy).to.be.equal(referrer.address)
      expect(partnerBuy).to.be.equal(partner.address)

      const contractBalanceBefore = await provider.getBalance(
        await creditsContract.getAddress()
      )
      const treasuryBalanceBefore = await provider.getBalance(
        await treasury.getAddress()
      )
      const referrerBalanceBefore = await provider.getBalance(
        await referrer.getAddress()
      )
      const partnerBalanceBefore = await provider.getBalance(
        await partner.getAddress()
      )
      const [, , claimBalanceBefore] = await creditsContract.getVisibility(
        visibilityId1
      )
      const visibilityBalanceBefore =
        await creditsContract.getVisibilityCreditBalance(
          visibilityId1,
          user2.address
        )

      tx = await creditsContract
        .connect(user2)
        .buyCredits(visibilityId1, buyAmount, referrer, { value: buyCost })
      await tx.wait()

      const contractBalanceAfterBuy = await provider.getBalance(
        await creditsContract.getAddress()
      )
      const treasuryBalanceAfterBuy = await provider.getBalance(
        await treasury.getAddress()
      )
      const referrerBalanceAfterBuy = await provider.getBalance(
        await referrer.getAddress()
      )
      const partnerBalanceAfterBuy = await provider.getBalance(
        await partner.getAddress()
      )
      const [, , claimBalanceAfterBuy] = await creditsContract.getVisibility(
        visibilityId1
      )
      const visibilityBalanceAfterBuy =
        await creditsContract.getVisibilityCreditBalance(
          visibilityId1,
          user2.address
        )

      expect(contractBalanceAfterBuy - contractBalanceBefore).to.be.equal(
        tradeCostBuy + creatorFeeBuy
      )
      expect(treasuryBalanceAfterBuy - treasuryBalanceBefore).to.be.equal(
        protocolFeeBuy
      )
      expect(referrerBalanceAfterBuy - referrerBalanceBefore).to.be.equal(
        referrerFeeBuy
      )
      expect(partnerBalanceAfterBuy - partnerBalanceBefore).to.be.equal(
        partnerFeeBuy
      )
      expect(claimBalanceAfterBuy - claimBalanceBefore).to.be.equal(
        creatorFeeBuy
      )
      expect(visibilityBalanceAfterBuy - visibilityBalanceBefore).to.be.equal(
        buyAmount
      )

      const sellAmount = 4

      const [
        reimbursement,
        {
          tradeCost: tradeCostSell,
          creatorFee: creatorFeeSell,
          protocolFee: protocolFeeSell,
          referrerFee: referrerFeeSell,
          partnerFee: partnerFeeSell,
          referrer: referrerSell,
          partner: partnerSell
        }
      ] = await creditsContract.sellCostWithFees(
        visibilityId1,
        sellAmount,
        user2,
        ZeroAddress // referrer is recorded
      )

      expect(tradeCostSell).to.be.equal(
        reimbursement +
          creatorFeeSell +
          protocolFeeSell +
          referrerFeeSell +
          partnerFeeSell
      )
      expect(creatorFeeSell).to.be.equal(
        ((await creditsContract.CREATOR_FEE()) * tradeCostSell) /
          (await creditsContract.FEE_DENOMINATOR())
      )
      expect(protocolFeeSell).to.be.equal(
        (((await creditsContract.PROTOCOL_FEE()) -
          (await creditsContract.REFERRER_FEE()) -
          (await creditsContract.PARTNER_REFERRER_BONUS()) -
          (await creditsContract.PARTNER_FEE())) *
          tradeCostSell) /
          (await creditsContract.FEE_DENOMINATOR())
      )
      expect(referrerFeeSell).to.be.equal(
        (((await creditsContract.REFERRER_FEE()) +
          (await creditsContract.PARTNER_REFERRER_BONUS())) *
          tradeCostSell) /
          (await creditsContract.FEE_DENOMINATOR())
      )
      expect(partnerFeeSell).to.be.equal(
        ((await creditsContract.PARTNER_FEE()) * tradeCostSell) /
          (await creditsContract.FEE_DENOMINATOR())
      )
      expect(referrerSell).to.be.equal(referrer.address)
      expect(partnerSell).to.be.equal(partner.address)

      tx = await creditsContract
        .connect(user2)
        .sellCredits(visibilityId1, sellAmount, ZeroAddress)
      await tx.wait()

      const contractBalanceAfterSell = await provider.getBalance(
        await creditsContract.getAddress()
      )
      const treasuryBalanceAfterSell = await provider.getBalance(
        await treasury.getAddress()
      )
      const referrerBalanceAfterSell = await provider.getBalance(
        await referrer.getAddress()
      )
      const partnerBalanceAfterSell = await provider.getBalance(
        await partner.getAddress()
      )
      const [, , claimBalanceAfterSell] = await creditsContract.getVisibility(
        visibilityId1
      )
      const visibilityBalanceAfterSell =
        await creditsContract.getVisibilityCreditBalance(
          visibilityId1,
          user2.address
        )

      expect(contractBalanceAfterSell - contractBalanceAfterBuy).to.be.equal(
        -(tradeCostSell - creatorFeeSell)
      )
      expect(treasuryBalanceAfterSell - treasuryBalanceAfterBuy).to.be.equal(
        protocolFeeSell
      )
      expect(referrerBalanceAfterSell - referrerBalanceAfterBuy).to.be.equal(
        referrerFeeSell
      )
      expect(partnerBalanceAfterSell - partnerBalanceAfterBuy).to.be.equal(
        partnerFeeSell
      )
      expect(claimBalanceAfterSell - claimBalanceAfterBuy).to.be.equal(
        creatorFeeSell
      )
      expect(visibilityBalanceAfterSell).to.be.equal(buyAmount - sellAmount)
    })
  })

  describe('Fee Claiming and Treasury Update', function () {
    it('Should allow the creator to claim accumulated fees', async function () {
      await loadFixture(deployFixture)

      const amount = BigInt(3)
      const [buyCost] = await creditsContract.buyCostWithFees(
        visibilityId1,
        amount,
        user1,
        referrer
      )

      tx = await creditsContract
        .connect(user1)
        .buyCredits(visibilityId1, amount, referrer, { value: buyCost })
      await tx.wait()

      const initialCreatorBalance = await creator1.getBalance()

      tx = await creditsContract.connect(user1).claimCreatorFee(visibilityId1)
      await tx.wait()

      const finalCreatorBalanceee = await creator1.getBalance()

      expect(finalCreatorBalanceee).to.be.gt(initialCreatorBalance)
    })

    it('Should revert when claiming creator fee with no fees to claim', async function () {
      await loadFixture(deployFixture)

      // No buy => no fees
      await expect(
        creditsContract.connect(user1).claimCreatorFee(visibilityId1)
      ).to.be.revertedWithCustomError(creditsContract, 'InvalidAmount')
    })

    it('Should allow admin to update the protocol treasury', async function () {
      await loadFixture(deployFixture)

      // Non-admin tries => revert
      await expect(
        creditsContract.connect(user1).updateTreasury(user2.address)
      ).to.be.revertedWithCustomError(
        creditsContract,
        'AccessControlUnauthorizedAccount'
      )

      // Admin updates
      tx = await creditsContract.connect(admin).updateTreasury(user2.address)
      await tx.wait()

      expect(await creditsContract.getProtocolTreasury()).to.equal(
        user2.address
      )

      // Zero address => revert
      await expect(
        creditsContract.connect(admin).updateTreasury(ZeroAddress)
      ).to.be.revertedWithCustomError(creditsContract, 'InvalidAddress')
    })

    it('Should revert fee claiming if creator address is not provided', async function () {
      await loadFixture(deployFixture)

      const visibilityId2 = 'x-2222'
      tx = await creditsContract
        .connect(user1)
        .buyCredits(visibilityId2, 3, referrer, { value: parseEther('3') })
      await tx.wait()

      await expect(
        creditsContract.connect(user1).claimCreatorFee(visibilityId2)
      ).to.be.revertedWithCustomError(creditsContract, 'InvalidCreator')
    })
  })

  describe('Administration', function () {
    it('Should revert if new treasury is zero address', async function () {
      await loadFixture(deployFixture)

      // Only the admin (deployer) can call updateTreasury
      await expect(
        creditsContract.connect(admin).updateTreasury(ZeroAddress)
      ).to.be.revertedWithCustomError(creditsContract, 'InvalidAddress')
    })

    it('Should allow to update a new treasury address', async function () {
      await loadFixture(deployFixture)

      // Should succeed with a valid address
      await expect(
        creditsContract
          .connect(admin)
          .updateTreasury(await creatorsLinker.getAddress())
      ).not.to.be.reverted

      expect(await creditsContract.getProtocolTreasury()).to.be.equal(
        await creatorsLinker.getAddress()
      )
    })

    it('Should revert if referrer is zero address', async function () {
      await loadFixture(deployFixture)

      await expect(
        creditsContract
          .connect(partnersLinker)
          .setReferrerPartner(ZeroAddress, ZeroAddress)
      ).to.be.revertedWithCustomError(creditsContract, 'InvalidAddress')
    })
  })

  describe('Edge Cases', function () {
    it('Should handle zero and minimal buy/sell amounts appropriately', async function () {
      const zeroAmount = BigInt(0)

      await expect(
        creditsContract
          .connect(user1)
          .buyCredits(visibilityId1, zeroAmount, referrer.address, {
            value: parseEther('0.1')
          })
      ).to.be.revertedWithCustomError(creditsContract, 'InvalidAmount')

      const minimalAmount = 1
      const [buyCost, { tradeCost, creatorFee: creatorFee1 }] =
        await creditsContract.buyCostWithFees(
          visibilityId1,
          minimalAmount,
          user1,
          referrer
        )

      const contractBalanceBeforeBuy = await provider.getBalance(
        await creditsContract.getAddress()
      )

      tx = await creditsContract
        .connect(user1)
        .buyCredits(visibilityId1, minimalAmount, referrer.address, {
          value: buyCost
        })
      await tx.wait()

      const contractBalanceAfterBuy = await provider.getBalance(
        await creditsContract.getAddress()
      )

      expect(contractBalanceAfterBuy - contractBalanceBeforeBuy).to.be.equal(
        tradeCost + creatorFee1
      )

      const [
        reimbursement,
        { creatorFee: creatorFee2, protocolFee, referrerFee }
      ] = await creditsContract.sellCostWithFees(
        visibilityId1,
        minimalAmount,
        user1,
        referrer
      )

      const user1BalanceBefore = await user1.getBalance()
      const treasuryBalanceBefore = await treasury.getBalance()
      const referrerBalanceBefore = await referrer.getBalance()

      tx = await creditsContract
        .connect(user1)
        .sellCredits(visibilityId1, minimalAmount, referrer.address)
      await tx.wait()

      const user1BalanceAfter = await user1.getBalance()
      const treasuryBalanceAfter = await treasury.getBalance()
      const referrerBalanceAfter = await referrer.getBalance()
      const contractBalanceAfterSell = await provider.getBalance(
        await creditsContract.getAddress()
      )

      expect(user1BalanceAfter).to.be.greaterThan(user1BalanceBefore)
      expect(contractBalanceAfterSell - contractBalanceAfterBuy).to.be.equal(
        -reimbursement - protocolFee - referrerFee
      )
      expect(treasuryBalanceAfter - treasuryBalanceBefore).to.be.equal(
        protocolFee
      )
      expect(referrerBalanceAfter - referrerBalanceBefore).to.be.equal(
        referrerFee
      )

      expect(
        await creditsContract.getVisibilityCreditBalance(
          visibilityId1,
          user2.address
        )
      ).to.be.equal(0)

      const creator1BalanceBefore = await creator1.getBalance()

      tx = await creditsContract
        .connect(deployer)
        .claimCreatorFee(visibilityId1)
      await tx.wait()

      const creator1BalanceAfter = await creator1.getBalance()
      const contractBalanceAfterClaim = await provider.getBalance(
        await creditsContract.getAddress()
      )

      expect(creator1BalanceAfter - creator1BalanceBefore).to.be.equal(
        creatorFee1 + creatorFee2
      )
      expect(contractBalanceAfterClaim - contractBalanceAfterSell).to.be.equal(
        -creatorFee1 - creatorFee2
      )
    })

    it('Should revert if buying exceeds MAX_TOTAL_SUPPLY', async function () {
      await loadFixture(deployFixture)

      const almostMax = BigInt('18446744073709551615') // 2^64 - 1

      await creditsContract
        .connect(user1)
        .buyCredits(visibilityId1, 2, ZeroAddress, {
          value: parseEther('5')
        })

      // Attempt a buy that overflows
      await expect(
        creditsContract
          .connect(user1)
          .buyCredits(visibilityId1, almostMax, ZeroAddress, {
            value: parseEther('99')
          })
      ).to.be.revertedWithCustomError(creditsContract, 'InvalidAmount')
    })
  })

  describe('Role Management', function () {
    it('Should allow admin to grant and revoke roles', async function () {
      await loadFixture(deployFixture)

      tx = await creditsContract
        .connect(admin)
        .grantCreatorTransferRole(user1.address)
      await tx.wait()

      const role = await creditsContract.CREDITS_TRANSFER_ROLE()

      expect(await creditsContract.hasRole(role, user1.address)).to.be.equal(
        true
      )

      tx = await creditsContract.connect(admin).revokeRole(role, user1.address)
      await tx.wait()

      expect(await creditsContract.hasRole(role, user1.address)).to.be.equal(
        false
      )
    })
  })
})
