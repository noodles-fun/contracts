import { expect } from 'chai'
import { ContractTransactionResponse, parseEther, ZeroAddress } from 'ethers'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import {
  ProxyAdmin__factory,
  VisibilityCredits,
  VisibilityServices
} from '../typechain-types'
import { deployProxyContract, getWallets, getProvider } from '../utils'
import { Provider, Wallet } from 'zksync-ethers'

describe('VisibilityServices', function () {
  const visibilityId1 = 'x-807982663000674305' // @LucaNetz on X

  let provider: Provider
  let tx: ContractTransactionResponse

  let visibilityServices: VisibilityServices
  let visibilityCredits: VisibilityCredits

  let deployer: Wallet
  let admin: Wallet
  let creator: Wallet
  let disputeResolver: Wallet
  let user1: Wallet
  let user2: Wallet
  let creatorsLinker: Wallet
  let partnersLinker: Wallet
  let treasury: Wallet

  const adminDelay = 60 * 60 * 24 * 3 // 3 days

  async function deployFixture() {
    ;[
      deployer,
      admin,
      creator,
      disputeResolver,
      user1,
      user2,
      creatorsLinker,
      partnersLinker,
      treasury
    ] = getWallets()

    provider = await getProvider()

    visibilityCredits = (await deployProxyContract(
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

    await visibilityCredits.waitForDeployment()

    visibilityServices = (await deployProxyContract(
      'VisibilityServices',
      [
        await visibilityCredits.getAddress(),
        adminDelay,
        await admin.getAddress(),
        await disputeResolver.getAddress()
      ],
      { wallet: deployer, silent: true }
    )) as unknown as VisibilityServices

    await visibilityServices.waitForDeployment()

    // Grant creator role to `creator`
    tx = await visibilityCredits
      .connect(creatorsLinker)
      .setCreatorVisibility(
        visibilityId1,
        await creator.getAddress(),
        'LucaNetz'
      )
    await tx.wait()

    tx = await visibilityServices
      .connect(creator)
      .createService('x-post', visibilityId1, 10)
    await tx.wait()

    // Authorize visibilityServices to manage credits
    tx = await visibilityCredits
      .connect(admin)
      .grantCreatorTransferRole(await visibilityServices.getAddress())
    await tx.wait()
  }

  async function deploySEFFixture() {
    await loadFixture(deployFixture)

    tx = await visibilityCredits
      .connect(user1)
      .buyCredits(visibilityId1, 50, ZeroAddress, {
        value: parseEther('1')
      })
    await tx.wait()
  }

  describe('Deployment and Initial Setup', function () {
    it('Should deploy contracts correctly and set initial values', async function () {
      await loadFixture(deployFixture)

      expect(await visibilityServices.getVisibilityCreditsContract()).to.equal(
        await visibilityCredits.getAddress()
      )
    })

    it('Should grant dispute resolver role correctly', async function () {
      await loadFixture(deployFixture)

      const DISPUTE_RESOLVER_ROLE =
        await visibilityServices.DISPUTE_RESOLVER_ROLE()
      const hasRole = await visibilityServices.hasRole(
        DISPUTE_RESOLVER_ROLE,
        disputeResolver.address
      )
      expect(hasRole).to.equal(true)
    })
  })

  describe('Service Creation and Management', function () {
    it('Should create a service successfully', async function () {
      await loadFixture(deployFixture)

      const [enabled, serviceType, visibilityId, creditsCostAmount] =
        await visibilityServices.getService(0)

      expect(enabled).to.equal(true)
      expect(serviceType).to.equal('x-post')
      expect(visibilityId).to.equal(visibilityId1)
      expect(creditsCostAmount).to.equal(10)
    })

    it('Should update a service successfully', async function () {
      await loadFixture(deployFixture)

      tx = await visibilityServices.connect(creator).updateService(0, false)
      await tx.wait()
      const [enabled] = await visibilityServices.getService(0)

      expect(enabled).to.equal(false)
    })

    it('Should create and update from an existing service', async function () {
      await loadFixture(deployFixture)

      tx = await visibilityServices
        .connect(creator)
        .createAndUpdateFromService(0, 55)
      await tx.wait()

      const [enabledAfter] = await visibilityServices.getService(0)
      expect(enabledAfter).to.equal(false)

      const [enabled, serviceType, visibilityId, creditsCostAmount] =
        await visibilityServices.getService(1)

      expect(enabled).to.equal(true)
      expect(serviceType).to.equal('x-post')
      expect(visibilityId).to.equal(visibilityId1)
      expect(creditsCostAmount).to.equal(55)
    })

    it('Should revert if non-creator tries to create a service', async function () {
      await loadFixture(deployFixture)

      await expect(
        visibilityServices
          .connect(user1)
          .createService('x-post', visibilityId1, 10)
      ).to.be.revertedWithCustomError(visibilityServices, 'InvalidCreator')
    })

    it('Should revert if non-creator tries to update a service', async function () {
      await loadFixture(deployFixture)

      await expect(
        visibilityServices.connect(user1).updateService(0, false)
      ).to.be.revertedWithCustomError(visibilityServices, 'InvalidCreator')
    })

    it('Should revert if non-creator tries to create and update from a service', async function () {
      await loadFixture(deployFixture)

      await expect(
        visibilityServices.connect(user1).createAndUpdateFromService(0, 55)
      ).to.be.revertedWithCustomError(visibilityServices, 'InvalidCreator')
    })

    it('Should revert with invalid service nonce', async function () {
      await loadFixture(deployFixture)

      await expect(
        visibilityServices.connect(creator).updateService(1, false)
      ).to.be.revertedWithCustomError(visibilityServices, 'InvalidCreator')
    })
  })

  describe('Service Execution Flow', function () {
    it('Should request service execution successfully', async function () {
      await loadFixture(deploySEFFixture)

      tx = await visibilityServices
        .connect(user1)
        .requestServiceExecution(0, 'Request Data')
      await tx.wait()

      const [state, requester] = await visibilityServices.getServiceExecution(
        0,
        0
      )

      expect(state).to.equal(1) // REQUESTED
      expect(requester).to.equal(user1.address)

      const user1BalanceAfter =
        await visibilityCredits.getVisibilityCreditBalance(
          visibilityId1,
          user1.address
        )
      expect(user1BalanceAfter).to.be.equal(40) // Ensure user1 received the refund
    })

    it('Should not allow requesting execution on a disabled service', async function () {
      await loadFixture(deploySEFFixture)
      tx = await visibilityServices.connect(creator).updateService(0, false)
      await tx.wait()
      await expect(
        visibilityServices
          .connect(user1)
          .requestServiceExecution(0, 'Request Data')
      ).to.be.revertedWithCustomError(visibilityServices, 'DisabledService')
    })

    it('Should revert if the user does not have enough credits for execution', async function () {
      await loadFixture(deploySEFFixture)
      tx = await visibilityCredits
        .connect(user2)
        .buyCredits(visibilityId1, 1, ZeroAddress, {
          value: parseEther('1')
        })
      await tx.wait()
      await expect(
        visibilityServices
          .connect(user2)
          .requestServiceExecution(0, 'Request Data')
      ).to.be.revertedWithCustomError(
        visibilityCredits,
        'NotEnoughCreditsOwned'
      )
    })

    it('Should accept a service execution correctly', async function () {
      await loadFixture(deploySEFFixture)
      tx = await visibilityServices
        .connect(user1)
        .requestServiceExecution(0, 'Request Data')
      await tx.wait()

      tx = await visibilityServices
        .connect(creator)
        .acceptServiceExecution(0, 0, 'Response Data')
      await tx.wait()

      const [state] = await visibilityServices.getServiceExecution(0, 0)

      expect(state).to.equal(2) // ACCEPTED
    })

    it('Should revert if a non-creator tries to accept execution', async function () {
      await loadFixture(deploySEFFixture)
      tx = await visibilityServices
        .connect(user1)
        .requestServiceExecution(0, 'Request Data')
      await tx.wait()

      await expect(
        visibilityServices
          .connect(user2)
          .acceptServiceExecution(0, 0, 'Response Data')
      ).to.be.revertedWithCustomError(
        visibilityServices,
        'UnauthorizedExecutionAction'
      )
    })

    it('Should revert if someone tries to accept/cancel/dispute an already VALIDATED execution', async () => {
      await loadFixture(deploySEFFixture)

      // user1 requests
      await visibilityServices
        .connect(user1)
        .requestServiceExecution(0, 'Request Data')
      // creator accepts
      await visibilityServices
        .connect(creator)
        .acceptServiceExecution(0, 0, 'Response Data')
      // user1 validates
      await visibilityServices.connect(user1).validateServiceExecution(0, 0)

      // Now it's VALIDATED => no further accept/cancel/dispute
      await expect(
        visibilityServices
          .connect(creator)
          .acceptServiceExecution(0, 0, 'Try Accept Again')
      ).to.be.revertedWithCustomError(
        visibilityServices,
        'InvalidExecutionState'
      )
      await expect(
        visibilityServices
          .connect(user1)
          .cancelServiceExecution(0, 0, 'Try Cancel')
      ).to.be.revertedWithCustomError(
        visibilityServices,
        'InvalidExecutionState'
      )
      await expect(
        visibilityServices
          .connect(user1)
          .disputeServiceExecution(0, 0, 'Try Dispute')
      ).to.be.revertedWithCustomError(
        visibilityServices,
        'InvalidExecutionState'
      )
    })

    it('Should validate a service execution correctly by the requester', async function () {
      await loadFixture(deploySEFFixture)
      tx = await visibilityServices
        .connect(user1)
        .requestServiceExecution(0, 'Request Data')
      await tx.wait()
      tx = await visibilityServices
        .connect(creator)
        .acceptServiceExecution(0, 0, 'Response Data')
      await tx.wait()
      tx = await visibilityServices
        .connect(user1)
        .validateServiceExecution(0, 0)
      await tx.wait()

      const [state] = await visibilityServices.getServiceExecution(0, 0)

      expect(state).to.equal(5) // VALIDATED
    })

    it('Should validate a service after the delay', async function () {
      await loadFixture(deploySEFFixture)
      tx = await visibilityServices
        .connect(user1)
        .requestServiceExecution(0, 'Request Data')
      await tx.wait()

      tx = await visibilityServices
        .connect(creator)
        .acceptServiceExecution(0, 0, 'Response Data')
      await tx.wait()

      // Simulate passing of AUTO_VALIDATION_DELAY
      await provider.send('evm_increaseTime', [5 * 24 * 60 * 60 + 1]) // 5 days + 1 second
      await provider.send('evm_mine', [])

      tx = await visibilityServices
        .connect(user2)
        .validateServiceExecution(0, 0)
      await tx.wait()
      const [state] = await visibilityServices.getServiceExecution(0, 0)

      expect(state).to.equal(5) // VALIDATED

      const creatorBalanceAfter =
        await visibilityCredits.getVisibilityCreditBalance(
          visibilityId1,
          creator.address
        )
      expect(creatorBalanceAfter).to.be.equal(10) // Ensure user1 received the refund
    })

    it('Should revert if someone tries to validate before 5 days has passed, and they are not the requester', async () => {
      await loadFixture(deploySEFFixture)
      // user1 requests
      await visibilityServices
        .connect(user1)
        .requestServiceExecution(0, 'Request Data')

      // creator accepts
      await visibilityServices
        .connect(creator)
        .acceptServiceExecution(0, 0, 'Response Data')

      // user2 tries to validate immediately => revert
      await expect(
        visibilityServices.connect(user2).validateServiceExecution(0, 0)
      ).to.be.revertedWithCustomError(
        visibilityServices,
        'UnauthorizedExecutionAction'
      )
    })

    it('Should dispute a service execution correctly', async function () {
      await loadFixture(deploySEFFixture)
      tx = await visibilityServices
        .connect(user1)
        .requestServiceExecution(0, 'Request Data')
      await tx.wait()
      tx = await visibilityServices
        .connect(creator)
        .acceptServiceExecution(0, 0, 'Response Data')
      await tx.wait()
      tx = await visibilityServices
        .connect(user1)
        .disputeServiceExecution(0, 0, 'Dispute Data')
      await tx.wait()

      const [state] = await visibilityServices.getServiceExecution(0, 0)

      expect(state).to.equal(3) // DISPUTED
    })

    it('Should revert if a non-requester tries to dispute an execution', async function () {
      await loadFixture(deploySEFFixture)
      tx = await visibilityServices
        .connect(user1)
        .requestServiceExecution(0, 'Request Data')
      await tx.wait()
      tx = await visibilityServices
        .connect(creator)
        .acceptServiceExecution(0, 0, 'Response Data')
      await tx.wait()
      await expect(
        visibilityServices
          .connect(user2)
          .disputeServiceExecution(0, 0, 'Dispute Data')
      ).to.be.revertedWithCustomError(
        visibilityServices,
        'UnauthorizedExecutionAction'
      )
    })

    it('Should resolve a dispute and refund correctly', async function () {
      await loadFixture(deploySEFFixture)
      tx = await visibilityServices
        .connect(user1)
        .requestServiceExecution(0, 'Request Data')
      await tx.wait()

      tx = await visibilityServices
        .connect(creator)
        .acceptServiceExecution(0, 0, 'Response Data')
      await tx.wait()
      tx = await visibilityServices
        .connect(user1)
        .disputeServiceExecution(0, 0, 'Dispute Data')
      await tx.wait()
      tx = await visibilityServices
        .connect(disputeResolver)
        .resolveServiceExecution(0, 0, true, 'Resolved with Refund')
      await tx.wait()

      const [state] = await visibilityServices.getServiceExecution(0, 0)
      expect(state).to.equal(4) // REFUNDED

      // Verify the refund process
      const user1BalanceAfter =
        await visibilityCredits.getVisibilityCreditBalance(
          visibilityId1,
          user1.address
        )
      expect(user1BalanceAfter).to.be.equal(50) // Ensure user1 received the refund
    })

    it('Should resolve a dispute with validation', async function () {
      await loadFixture(deploySEFFixture)

      tx = await visibilityServices
        .connect(user1)
        .requestServiceExecution(0, 'Request Data')
      await tx.wait()

      const user1BalanceBefore =
        await visibilityCredits.getVisibilityCreditBalance(
          visibilityId1,
          user1.address
        )

      tx = await visibilityServices
        .connect(creator)
        .acceptServiceExecution(0, 0, 'Response Data')
      await tx.wait()

      tx = await visibilityServices
        .connect(user1)
        .disputeServiceExecution(0, 0, 'Dispute Data')
      await tx.wait()

      tx = await visibilityServices
        .connect(disputeResolver)
        .resolveServiceExecution(0, 0, false, 'Resolved without Refund')
      await tx.wait()

      const [state] = await visibilityServices.getServiceExecution(0, 0)

      expect(state).to.equal(5) // VALIDATED

      const creatorBalanceAfter =
        await visibilityCredits.getVisibilityCreditBalance(
          visibilityId1,
          creator.address
        )

      expect(creatorBalanceAfter).to.equal(10)

      // Verify that credits were not returned to the user
      const user1BalanceAfter =
        await visibilityCredits.getVisibilityCreditBalance(
          visibilityId1,
          user1.address
        )
      expect(user1BalanceAfter).to.equal(user1BalanceBefore)
    })

    it('Should revert if non-resolver tries to resolve a dispute', async function () {
      await loadFixture(deploySEFFixture)
      tx = await visibilityServices
        .connect(user1)
        .requestServiceExecution(0, 'Request Data')
      await tx.wait()
      tx = await visibilityServices
        .connect(creator)
        .acceptServiceExecution(0, 0, 'Response Data')
      await tx.wait()
      tx = await visibilityServices
        .connect(user1)
        .disputeServiceExecution(0, 0, 'Dispute Data')
      await tx.wait()
      await expect(
        visibilityServices
          .connect(user2)
          .resolveServiceExecution(0, 0, true, 'Unauthorized resolution')
      ).to.be.revertedWithCustomError(
        visibilityServices,
        'AccessControlUnauthorizedAccount'
      )
    })

    it('Should revert if someone tries to accept/cancel/dispute an already REFUNDED execution', async () => {
      await loadFixture(deploySEFFixture)

      // user1 requests
      await visibilityServices
        .connect(user1)
        .requestServiceExecution(0, 'Request Data')
      // creator accepts
      await visibilityServices
        .connect(creator)
        .acceptServiceExecution(0, 0, 'Response Data')
      // user1 disputes
      await visibilityServices
        .connect(user1)
        .disputeServiceExecution(0, 0, 'Dispute Data')

      // disputeResolver => refund
      await visibilityServices
        .connect(disputeResolver)
        .resolveServiceExecution(0, 0, true, 'Refunded')
      // Now it's REFUNDED => no further accept/cancel/dispute
      await expect(
        visibilityServices
          .connect(creator)
          .acceptServiceExecution(0, 0, 'Try Accept Again')
      ).to.be.revertedWithCustomError(
        visibilityServices,
        'InvalidExecutionState'
      )
      await expect(
        visibilityServices
          .connect(user1)
          .cancelServiceExecution(0, 0, 'Try Cancel')
      ).to.be.revertedWithCustomError(
        visibilityServices,
        'InvalidExecutionState'
      )
      await expect(
        visibilityServices
          .connect(user1)
          .disputeServiceExecution(0, 0, 'Try Dispute')
      ).to.be.revertedWithCustomError(
        visibilityServices,
        'InvalidExecutionState'
      )
    })
  })

  describe('Multiple Executions per Service', () => {
    it('Should allow user to create multiple requests, each with its own state', async () => {
      await loadFixture(deploySEFFixture)

      // First request
      await visibilityServices
        .connect(user1)
        .requestServiceExecution(0, 'Request Data 1')

      // Second request
      await visibilityServices
        .connect(user1)
        .requestServiceExecution(0, 'Request Data 2')

      // Check that both requests exist
      const [state1] = await visibilityServices.getServiceExecution(0, 0)
      const [state2] = await visibilityServices.getServiceExecution(0, 1)
      expect(state1).to.equal(1) // REQUESTED
      expect(state2).to.equal(1) // REQUESTED

      // Accept the first, leave the second alone
      await visibilityServices
        .connect(creator)
        .acceptServiceExecution(0, 0, 'Response 1')

      // The first is ACCEPTED, second is still REQUESTED
      const [st1After] = await visibilityServices.getServiceExecution(0, 0)
      const [st2After] = await visibilityServices.getServiceExecution(0, 1)
      expect(st1After).to.equal(2) // ACCEPTED
      expect(st2After).to.equal(1) // REQUESTED
    })
  })
})
