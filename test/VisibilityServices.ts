import { expect } from 'chai'
import { ContractTransactionResponse, parseEther, ZeroAddress } from 'ethers'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { VisibilityCredits, VisibilityServices } from '../typechain-types'
import {
  deployProxyContract,
  getWallets,
  getProvider,
  upgradeProxyContract
} from '../utils'
import { Provider, Wallet } from 'zksync-ethers'
import { getImplementationAddress } from '@openzeppelin/upgrades-core/dist/eip-1967'

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

  let serviceNoncePaymentVisibilityCredits: number
  let serviceNoncePaymentVisibilityETH: number

  let newServiceNonce: number

  let executionNonceServiceVisibilityCredits: number
  let executionNonceServiceVisibilityETH: number

  const creditsCostAmount: number = 50

  const initialCreditsBalanceUser1 = creditsCostAmount * 5

  const buybackShare: number = 500_000 // 50%
  const weiCostAmount: bigint = parseEther('0.01')

  const adminDelay: number = 60 * 60 * 24 * 3 // 3 days
  const serviceTypeVC = 'x-post'
  const serviceTypeETH = 'x-post-eth'

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

  async function deployFixture() {
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

    // Authorize visibilityServices to manage credits
    tx = await visibilityCredits
      .connect(admin)
      .grantCreatorTransferRole(await visibilityServices.getAddress())
    await tx.wait()

    // User1 gets visbility credits
    tx = await visibilityCredits
      .connect(user1)
      .buyCredits(visibilityId1, initialCreditsBalanceUser1, ZeroAddress, {
        value: parseEther('1')
      })
    await tx.wait()

    // Creator creates a service, paymentType = ETH
    tx = await visibilityServices
      .connect(creator)
      .createServiceWithETH(
        serviceTypeETH,
        visibilityId1,
        buybackShare,
        weiCostAmount
      )
    await tx.wait()

    serviceNoncePaymentVisibilityETH = 0

    // Creator creates a service, paymentType = Visibility credits
    tx = await visibilityServices
      .connect(creator)
      .createService(serviceTypeVC, visibilityId1, creditsCostAmount)
    await tx.wait()

    serviceNoncePaymentVisibilityCredits = 1

    newServiceNonce = 2

    executionNonceServiceVisibilityCredits = 0
    executionNonceServiceVisibilityETH = 0
  }

  async function deployAcceptedEthServiceFixture() {
    await loadFixture(deployFixture)
    tx = await visibilityServices
      .connect(user1)
      .requestServiceExecution(
        serviceNoncePaymentVisibilityETH,
        'Request Data',
        { value: weiCostAmount }
      )
    await tx.wait()

    tx = await visibilityServices
      .connect(creator)
      .acceptServiceExecution(
        serviceNoncePaymentVisibilityETH,
        executionNonceServiceVisibilityETH,
        'Response Data'
      )
    await tx.wait()
  }

  async function deployValidatedEthServiceFixture() {
    await loadFixture(deployAcceptedEthServiceFixture)

    tx = await visibilityServices
      .connect(user1)
      .validateServiceExecution(
        serviceNoncePaymentVisibilityETH,
        executionNonceServiceVisibilityETH
      )
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
    it('Should create a service with payment type Visibility Credits successfully', async function () {
      await loadFixture(deployFixture)

      const [
        _enabled,
        _serviceType,
        _visibilityId,
        _creditsCostAmount,
        _executionsNonce,
        _originator,
        _weiCostAmount,
        _buyBackCreditsShare,
        _paymentType
      ] = await visibilityServices.getService(
        serviceNoncePaymentVisibilityCredits
      )

      expect(_enabled).to.equal(true)
      expect(_serviceType).to.equal(serviceTypeVC)
      expect(_visibilityId).to.equal(visibilityId1)
      expect(_creditsCostAmount).to.equal(creditsCostAmount)
      expect(_executionsNonce).to.equal(executionNonceServiceVisibilityCredits)
      expect(_originator).to.equal(creator.address)
      expect(_weiCostAmount).to.equal(0)
      expect(_buyBackCreditsShare).to.equal(0)
      expect(_paymentType).to.equal(0)
    })

    it('Should create a service with payment type ETH successfully', async function () {
      await loadFixture(deployFixture)

      const [
        _enabled,
        _serviceType,
        _visibilityId,
        _creditsCostAmount,
        _executionsNonce,
        _originator,
        _weiCostAmount,
        _buyBackCreditsShare,
        _paymentType
      ] = await visibilityServices.getService(serviceNoncePaymentVisibilityETH)

      expect(_enabled).to.equal(true)
      expect(_serviceType).to.equal(serviceTypeETH)
      expect(_visibilityId).to.equal(visibilityId1)
      expect(_creditsCostAmount).to.equal(0)
      expect(_executionsNonce).to.equal(executionNonceServiceVisibilityETH)
      expect(_originator).to.equal(creator.address)
      expect(_weiCostAmount).to.equal(weiCostAmount)
      expect(_buyBackCreditsShare).to.equal(buybackShare)
      expect(_paymentType).to.equal(1)

      tx = await visibilityServices
        .connect(creator)
        .createServiceWithETH(
          serviceTypeETH,
          visibilityId1,
          buybackShare,
          weiCostAmount
        )
      await tx.wait()

      await expect(tx)
        .to.emit(visibilityServices, 'ServiceWithETHCreated')
        .withArgs(
          creator.address,
          newServiceNonce,
          serviceTypeETH,
          visibilityId1,
          buybackShare,
          weiCostAmount
        )
    })

    it('Should allow anyone to create any service', async function () {
      await loadFixture(deployFixture)

      tx = await visibilityServices
        .connect(user1)
        .createService('test', visibilityId1, creditsCostAmount)

      await tx.wait()

      await expect(tx)
        .to.emit(visibilityServices, 'ServiceCreated')
        .withArgs(
          user1,
          newServiceNonce,
          'test',
          visibilityId1,
          creditsCostAmount
        )
    })

    it('Should revert if trying to create a service (ETH payment) with invalid buy back share value', async function () {
      await loadFixture(deployFixture)

      await expect(
        visibilityServices
          .connect(user1)
          .createServiceWithETH(
            serviceTypeETH,
            visibilityId1,
            999_999,
            weiCostAmount
          )
      ).to.be.revertedWithCustomError(
        visibilityServices,
        'InvalidBuyBackCreditsShare'
      )
    })

    it('Should update a service successfully', async function () {
      await loadFixture(deployFixture)

      tx = await visibilityServices
        .connect(creator)
        .updateService(serviceNoncePaymentVisibilityCredits, false)
      await tx.wait()
      const [enabledVC] = await visibilityServices.getService(
        serviceNoncePaymentVisibilityCredits
      )

      tx = await visibilityServices
        .connect(creator)
        .updateService(serviceNoncePaymentVisibilityETH, false)
      await tx.wait()
      const [enabledETH] = await visibilityServices.getService(
        serviceNoncePaymentVisibilityETH
      )

      await expect(tx)
        .to.emit(visibilityServices, 'ServiceUpdated')
        .withArgs(serviceNoncePaymentVisibilityETH, false)

      expect(enabledETH).to.equal(false)
    })

    it('Should create and update from an existing service (payment type Visibility Credits)', async function () {
      await loadFixture(deployFixture)

      const newCreditsCostAmount = 55

      tx = await visibilityServices
        .connect(creator)
        .createAndUpdateFromService(
          serviceNoncePaymentVisibilityCredits,
          newCreditsCostAmount
        )
      await tx.wait()

      const [enabledAfter] = await visibilityServices.getService(
        serviceNoncePaymentVisibilityCredits
      )
      expect(enabledAfter).to.equal(false)

      const [
        _enabled,
        _serviceType,
        _visibilityId,
        _creditsCostAmount,
        _executionsNonce,
        _originator,
        _weiCostAmount,
        _buyBackCreditsShare,
        _paymentType
      ] = await visibilityServices.getService(newServiceNonce)

      expect(_enabled).to.equal(true)
      expect(_serviceType).to.equal(serviceTypeVC)
      expect(_visibilityId).to.equal(visibilityId1)
      expect(_creditsCostAmount).to.equal(newCreditsCostAmount)
      expect(_executionsNonce).to.equal(0)
      expect(_originator).to.equal(creator.address)
      expect(_weiCostAmount).to.equal(0)
      expect(_buyBackCreditsShare).to.equal(0)
      expect(_paymentType).to.equal(0)
    })

    it('Should create and update from an existing service (payment type ETH)', async function () {
      await loadFixture(deployFixture)

      const newWeiAmount = parseEther('0.02')

      tx = await visibilityServices
        .connect(creator)
        .createAndUpdateFromService(
          serviceNoncePaymentVisibilityETH,
          newWeiAmount
        )
      await tx.wait()

      const [enabledAfter] = await visibilityServices.getService(
        serviceNoncePaymentVisibilityETH
      )
      expect(enabledAfter).to.equal(false)

      const [
        _enabled,
        _serviceType,
        _visibilityId,
        _creditsCostAmount,
        _executionsNonce,
        _originator,
        _weiCostAmount,
        _buyBackCreditsShare,
        _paymentType
      ] = await visibilityServices.getService(newServiceNonce)

      expect(_enabled).to.equal(true)
      expect(_serviceType).to.equal(serviceTypeETH)
      expect(_visibilityId).to.equal(visibilityId1)
      expect(_creditsCostAmount).to.equal(0)
      expect(_executionsNonce).to.equal(0)
      expect(_originator).to.equal(creator.address)
      expect(_weiCostAmount).to.equal(newWeiAmount)
      expect(_buyBackCreditsShare).to.equal(buybackShare)
      expect(_paymentType).to.equal(1)
    })

    it('Should revert if non-originator tries to update a service', async function () {
      await loadFixture(deployFixture)

      tx = await visibilityServices
        .connect(user1)
        .createService('test', visibilityId1, creditsCostAmount)

      await tx.wait()

      tx = await visibilityServices
        .connect(user1)
        .updateService(newServiceNonce, false)

      await tx.wait()

      await expect(
        visibilityServices.connect(user2).updateService(newServiceNonce, false)
      ).to.be.revertedWithCustomError(visibilityServices, 'InvalidOriginator')
    })

    it('Should revert if non-originator tries to create and update from a service', async function () {
      await loadFixture(deployFixture)

      tx = await visibilityServices
        .connect(user1)
        .createService('test', visibilityId1, creditsCostAmount)

      await tx.wait()

      tx = await visibilityServices
        .connect(user1)
        .updateService(newServiceNonce, false)

      await tx.wait()

      await expect(
        visibilityServices
          .connect(user2)
          .createAndUpdateFromService(newServiceNonce, 55)
      ).to.be.revertedWithCustomError(visibilityServices, 'InvalidOriginator')
    })

    it('Should revert if update with invalid service nonce', async function () {
      await loadFixture(deployFixture)

      await expect(
        visibilityServices
          .connect(creator)
          .updateService(newServiceNonce, false)
      ).to.be.revertedWithCustomError(visibilityServices, 'InvalidOriginator')
    })

    it('Should allow creator to update buyback share value', async function () {
      await loadFixture(deployFixture)

      const newBuyBackShare = 600_000 // 60%

      tx = await visibilityServices
        .connect(creator)
        .updateBuyBackCreditsShare(
          serviceNoncePaymentVisibilityETH,
          newBuyBackShare
        )
      await tx.wait()

      await expect(tx)
        .to.emit(visibilityServices, 'ServiceBuyBackUpdated')
        .withArgs(serviceNoncePaymentVisibilityETH, newBuyBackShare)

      const _newBuyBackShare = (
        await visibilityServices.getService(serviceNoncePaymentVisibilityETH)
      )[7]
      expect(_newBuyBackShare).to.equal(newBuyBackShare)
    })

    it('Should revert if creator tries to update with invalid buyback share value', async function () {
      await loadFixture(deployFixture)

      tx = await visibilityServices
        .connect(user1)
        .createServiceWithETH(
          serviceTypeETH,
          visibilityId1,
          buybackShare,
          weiCostAmount
        )
      await tx.wait()

      await expect(
        visibilityServices
          .connect(user1)
          .updateBuyBackCreditsShare(newServiceNonce, 999_999)
      ).to.be.revertedWithCustomError(
        visibilityServices,
        'InvalidBuyBackCreditsShare'
      )
    })

    it('Should revert if non-creator tries to update buyback share value', async function () {
      await loadFixture(deployFixture)

      tx = await visibilityServices
        .connect(user1)
        .createServiceWithETH(
          serviceTypeETH,
          visibilityId1,
          buybackShare,
          weiCostAmount
        )
      await tx.wait()

      expect(
        (await visibilityServices.getService(newServiceNonce))[5]
      ).to.equal(user1.address)

      await expect(
        visibilityServices
          .connect(user1)
          .updateBuyBackCreditsShare(newServiceNonce, 600_000)
      ).to.be.revertedWithCustomError(visibilityServices, 'InvalidCreator')
    })

    it('Should revert if trying to update buyback share value with invalid service nonce', async function () {
      await loadFixture(deployFixture)

      await expect(
        visibilityServices
          .connect(creator)
          .updateBuyBackCreditsShare(newServiceNonce, 600_000)
      ).to.be.revertedWithCustomError(visibilityServices, 'InvalidCreator')
    })

    it('Should revert if trying to update buyback share value for service with Visibility Credits payments', async function () {
      await loadFixture(deployFixture)

      await expect(
        visibilityServices
          .connect(creator)
          .updateBuyBackCreditsShare(
            serviceNoncePaymentVisibilityCredits,
            600_000
          )
      ).to.be.revertedWithCustomError(visibilityServices, 'InvalidPaymentType')
    })
  })

  describe('Service Execution Flow (Generic / Visibility Credits Payments)', function () {
    it('Should request service execution successfully', async function () {
      await loadFixture(deployFixture)

      tx = await visibilityServices
        .connect(user1)
        .requestServiceExecution(
          serviceNoncePaymentVisibilityCredits,
          'Request Data'
        )
      await tx.wait()

      await expect(tx)
        .emit(visibilityServices, 'ServiceExecutionRequested')
        .withArgs(
          serviceNoncePaymentVisibilityCredits,
          executionNonceServiceVisibilityCredits,
          user1.address,
          'Request Data'
        )

      const [state, requester] = await visibilityServices.getServiceExecution(
        serviceNoncePaymentVisibilityCredits,
        executionNonceServiceVisibilityCredits
      )

      expect(state).to.equal(1) // REQUESTED
      expect(requester).to.equal(user1.address)

      const user1BalanceAfter =
        await visibilityCredits.getVisibilityCreditBalance(
          visibilityId1,
          user1.address
        )
      expect(user1BalanceAfter).to.be.equal(
        initialCreditsBalanceUser1 - creditsCostAmount
      )
    })

    it('Should not allow requesting execution on a disabled service', async function () {
      await loadFixture(deployFixture)
      tx = await visibilityServices
        .connect(creator)
        .updateService(serviceNoncePaymentVisibilityCredits, false)
      await tx.wait()
      await expect(
        visibilityServices
          .connect(user1)
          .requestServiceExecution(
            serviceNoncePaymentVisibilityCredits,
            'Request Data'
          )
      ).to.be.revertedWithCustomError(visibilityServices, 'DisabledService')
    })

    it('Should revert if the user does not have enough credits for execution', async function () {
      await loadFixture(deployFixture)

      const insufficientCreditsAmount = creditsCostAmount - 1

      tx = await visibilityCredits
        .connect(user2)
        .buyCredits(visibilityId1, insufficientCreditsAmount, ZeroAddress, {
          value: parseEther('1')
        })
      await tx.wait()
      await expect(
        visibilityServices
          .connect(user2)
          .requestServiceExecution(
            serviceNoncePaymentVisibilityCredits,
            'Request Data'
          )
      ).to.be.revertedWithCustomError(
        visibilityCredits,
        'NotEnoughCreditsOwned'
      )
    })

    it('Should allow creator or requester to cancel', async function () {
      await loadFixture(deployFixture)

      tx = await visibilityServices
        .connect(user1)
        .requestServiceExecution(
          serviceNoncePaymentVisibilityCredits,
          'Request Data'
        )
      await tx.wait()

      expect(
        await visibilityCredits.getVisibilityCreditBalance(
          visibilityId1,
          user1.address
        )
      ).to.be.equal(initialCreditsBalanceUser1 - creditsCostAmount)

      tx = await visibilityServices
        .connect(creator)
        .cancelServiceExecution(
          serviceNoncePaymentVisibilityCredits,
          executionNonceServiceVisibilityCredits,
          'Cancel Data'
        )
      await tx.wait()

      await expect(tx)
        .to.emit(visibilityServices, 'ServiceExecutionCanceled')
        .withArgs(
          serviceNoncePaymentVisibilityCredits,
          executionNonceServiceVisibilityCredits,
          creator.address,
          'Cancel Data'
        )

      const [state] = await visibilityServices.getServiceExecution(
        serviceNoncePaymentVisibilityCredits,
        executionNonceServiceVisibilityCredits
      )

      expect(state).to.equal(4) // CANCELED

      expect(
        await visibilityCredits.getVisibilityCreditBalance(
          visibilityId1,
          user1.address
        )
      ).to.be.equal(initialCreditsBalanceUser1)

      tx = await visibilityServices
        .connect(user1)
        .requestServiceExecution(
          serviceNoncePaymentVisibilityCredits,
          'Request Data'
        )
      await tx.wait()

      expect(
        await visibilityCredits.getVisibilityCreditBalance(
          visibilityId1,
          user1.address
        )
      ).to.be.equal(initialCreditsBalanceUser1 - creditsCostAmount)

      tx = await visibilityServices
        .connect(user1)
        .cancelServiceExecution(
          serviceNoncePaymentVisibilityCredits,
          executionNonceServiceVisibilityCredits + 1,
          'Cancel Data'
        )
      await tx.wait()

      await expect(tx)
        .to.emit(visibilityServices, 'ServiceExecutionCanceled')
        .withArgs(
          serviceNoncePaymentVisibilityCredits,
          executionNonceServiceVisibilityCredits + 1,
          user1.address,
          'Cancel Data'
        )

      expect(
        (
          await visibilityServices.getServiceExecution(
            serviceNoncePaymentVisibilityCredits,
            executionNonceServiceVisibilityCredits + 1
          )
        )[0]
      ).to.equal(4) // CANCELED

      expect(
        await visibilityCredits.getVisibilityCreditBalance(
          visibilityId1,
          user1.address
        )
      ).to.be.equal(initialCreditsBalanceUser1)
    })

    it('Should allow creator, dispute resolver or requester to add information context', async function () {
      await loadFixture(deployFixture)
      tx = await visibilityServices
        .connect(user1)
        .requestServiceExecution(
          serviceNoncePaymentVisibilityCredits,
          'Request Data'
        )
      await tx.wait()

      tx = await visibilityServices
        .connect(creator)
        .addInformationForServiceExecution(
          serviceNoncePaymentVisibilityCredits,
          executionNonceServiceVisibilityCredits,
          'info Data1'
        )
      await tx.wait()
      tx = await visibilityServices
        .connect(disputeResolver)
        .addInformationForServiceExecution(
          serviceNoncePaymentVisibilityCredits,
          executionNonceServiceVisibilityCredits,
          'info Data2'
        )
      await tx.wait()
      tx = await visibilityServices
        .connect(user1)
        .addInformationForServiceExecution(
          serviceNoncePaymentVisibilityCredits,
          executionNonceServiceVisibilityCredits,
          'info Data3'
        )

      await expect(tx)
        .to.emit(visibilityServices, 'ServiceExecutionInformation')
        .withArgs(
          serviceNoncePaymentVisibilityCredits,
          executionNonceServiceVisibilityCredits,
          user1.address,
          false,
          true,
          false,
          'info Data3'
        )
    })

    it('Should revert on adding information context if execution is not initiated', async function () {
      await loadFixture(deployFixture)
      await expect(
        visibilityServices
          .connect(user1)
          .addInformationForServiceExecution(
            serviceNoncePaymentVisibilityCredits,
            executionNonceServiceVisibilityCredits + 1,
            'info Data'
          )
      ).to.be.revertedWithCustomError(
        visibilityServices,
        'InvalidExecutionNonce'
      )
    })

    it('Should revert if adding information request is not executed by creator, dispute resolver nor requester', async function () {
      await loadFixture(deployFixture)
      tx = await visibilityServices
        .connect(user1)
        .requestServiceExecution(
          serviceNoncePaymentVisibilityCredits,
          'Request Data'
        )
      await tx.wait()

      await expect(
        visibilityServices
          .connect(user2)
          .addInformationForServiceExecution(
            serviceNoncePaymentVisibilityCredits,
            executionNonceServiceVisibilityCredits,
            'info Data'
          )
      ).to.be.revertedWithCustomError(
        visibilityServices,
        'UnauthorizedExecutionAction'
      )
    })

    it('Should accept a service execution correctly', async function () {
      await loadFixture(deployFixture)
      tx = await visibilityServices
        .connect(user1)
        .requestServiceExecution(
          serviceNoncePaymentVisibilityCredits,
          'Request Data'
        )
      await tx.wait()

      tx = await visibilityServices
        .connect(creator)
        .acceptServiceExecution(
          serviceNoncePaymentVisibilityCredits,
          executionNonceServiceVisibilityCredits,
          'Response Data'
        )
      await tx.wait()

      await expect(tx)
        .to.emit(visibilityServices, 'ServiceExecutionAccepted')
        .withArgs(
          serviceNoncePaymentVisibilityCredits,
          executionNonceServiceVisibilityCredits,
          'Response Data'
        )

      const [state] = await visibilityServices.getServiceExecution(
        serviceNoncePaymentVisibilityCredits,
        executionNonceServiceVisibilityCredits
      )

      expect(state).to.equal(2) // ACCEPTED
    })

    it('Should revert if a non-creator tries to accept execution', async function () {
      await loadFixture(deployFixture)
      tx = await visibilityServices
        .connect(user1)
        .requestServiceExecution(
          serviceNoncePaymentVisibilityCredits,
          'Request Data'
        )
      await tx.wait()

      await expect(
        visibilityServices
          .connect(user2)
          .acceptServiceExecution(
            serviceNoncePaymentVisibilityCredits,
            executionNonceServiceVisibilityCredits,
            'Response Data'
          )
      ).to.be.revertedWithCustomError(
        visibilityServices,
        'UnauthorizedExecutionAction'
      )
    })

    it('Should revert if someone tries to accept/cancel/dispute an already VALIDATED execution', async () => {
      await loadFixture(deployFixture)

      // user1 requests
      await visibilityServices
        .connect(user1)
        .requestServiceExecution(
          serviceNoncePaymentVisibilityCredits,
          'Request Data'
        )
      // creator accepts
      await visibilityServices
        .connect(creator)
        .acceptServiceExecution(
          serviceNoncePaymentVisibilityCredits,
          executionNonceServiceVisibilityCredits,
          'Response Data'
        )
      // user1 validates
      await visibilityServices
        .connect(user1)
        .validateServiceExecution(
          serviceNoncePaymentVisibilityCredits,
          executionNonceServiceVisibilityCredits
        )

      // Now it's VALIDATED => no further accept/cancel/dispute
      await expect(
        visibilityServices
          .connect(creator)
          .acceptServiceExecution(
            serviceNoncePaymentVisibilityCredits,
            executionNonceServiceVisibilityCredits,
            'Try Accept Again'
          )
      ).to.be.revertedWithCustomError(
        visibilityServices,
        'InvalidExecutionState'
      )
      await expect(
        visibilityServices
          .connect(user1)
          .cancelServiceExecution(
            serviceNoncePaymentVisibilityCredits,
            executionNonceServiceVisibilityCredits,
            'Try Cancel'
          )
      ).to.be.revertedWithCustomError(
        visibilityServices,
        'InvalidExecutionState'
      )
      await expect(
        visibilityServices
          .connect(user1)
          .disputeServiceExecution(
            serviceNoncePaymentVisibilityCredits,
            executionNonceServiceVisibilityCredits,
            'Try Dispute'
          )
      ).to.be.revertedWithCustomError(
        visibilityServices,
        'InvalidExecutionState'
      )
    })

    it('Should validate a service execution correctly by the requester', async function () {
      await loadFixture(deployFixture)
      tx = await visibilityServices
        .connect(user1)
        .requestServiceExecution(
          serviceNoncePaymentVisibilityCredits,
          'Request Data'
        )
      await tx.wait()
      tx = await visibilityServices
        .connect(creator)
        .acceptServiceExecution(
          serviceNoncePaymentVisibilityCredits,
          executionNonceServiceVisibilityCredits,
          'Response Data'
        )
      await tx.wait()
      tx = await visibilityServices
        .connect(user1)
        .validateServiceExecution(
          serviceNoncePaymentVisibilityCredits,
          executionNonceServiceVisibilityCredits
        )
      await tx.wait()

      await expect(tx)
        .to.emit(visibilityServices, 'ServiceExecutionValidated')
        .withArgs(
          serviceNoncePaymentVisibilityCredits,
          executionNonceServiceVisibilityCredits
        )

      const [state] = await visibilityServices.getServiceExecution(
        serviceNoncePaymentVisibilityCredits,
        executionNonceServiceVisibilityCredits
      )

      expect(state).to.equal(5) // VALIDATED
    })

    it('Should validate a service after the delay', async function () {
      const contractBalanceBefore = await provider.getBalance(
        await visibilityServices.getAddress()
      )

      await loadFixture(deployFixture)
      tx = await visibilityServices
        .connect(user1)
        .requestServiceExecution(
          serviceNoncePaymentVisibilityCredits,
          'Request Data'
        )
      await tx.wait()

      tx = await visibilityServices
        .connect(creator)
        .acceptServiceExecution(
          serviceNoncePaymentVisibilityCredits,
          executionNonceServiceVisibilityCredits,
          'Response Data'
        )
      await tx.wait()

      // Simulate passing of AUTO_VALIDATION_DELAY
      await provider.send('evm_increaseTime', [5 * 24 * 60 * 60 + 1]) // 5 days + 1 second
      await provider.send('evm_mine', [])

      tx = await visibilityServices
        .connect(user2)
        .validateServiceExecution(
          serviceNoncePaymentVisibilityCredits,
          executionNonceServiceVisibilityCredits
        )
      await tx.wait()

      await expect(tx)
        .to.emit(visibilityServices, 'ServiceExecutionValidated')
        .withArgs(
          serviceNoncePaymentVisibilityCredits,
          executionNonceServiceVisibilityCredits
        )

      const [state] = await visibilityServices.getServiceExecution(
        serviceNoncePaymentVisibilityCredits,
        executionNonceServiceVisibilityCredits
      )

      expect(state).to.equal(5) // VALIDATED

      const creatorBalanceAfter =
        await visibilityCredits.getVisibilityCreditBalance(
          visibilityId1,
          creator.address
        )
      expect(creatorBalanceAfter).to.be.equal(creditsCostAmount) // Ensure user1 received the funds

      const contractBalanceAfter = await provider.getBalance(
        await visibilityServices.getAddress()
      )

      expect(contractBalanceAfter).to.be.equal(contractBalanceBefore) // Ensure the contract balance is the same
    })

    it('Should revert if someone tries to validate before 5 days has passed, and they are not the requester', async () => {
      await loadFixture(deployFixture)
      // user1 requests
      await visibilityServices
        .connect(user1)
        .requestServiceExecution(
          serviceNoncePaymentVisibilityCredits,
          'Request Data'
        )

      // creator accepts
      await visibilityServices
        .connect(creator)
        .acceptServiceExecution(
          serviceNoncePaymentVisibilityCredits,
          executionNonceServiceVisibilityCredits,
          'Response Data'
        )

      // user2 tries to validate immediately => revert
      await expect(
        visibilityServices
          .connect(user2)
          .validateServiceExecution(
            serviceNoncePaymentVisibilityCredits,
            executionNonceServiceVisibilityCredits
          )
      ).to.be.revertedWithCustomError(
        visibilityServices,
        'UnauthorizedExecutionAction'
      )
    })

    it('Should dispute a service execution correctly', async function () {
      await loadFixture(deployFixture)
      tx = await visibilityServices
        .connect(user1)
        .requestServiceExecution(
          serviceNoncePaymentVisibilityCredits,
          'Request Data'
        )
      await tx.wait()
      tx = await visibilityServices
        .connect(creator)
        .acceptServiceExecution(
          serviceNoncePaymentVisibilityCredits,
          executionNonceServiceVisibilityCredits,
          'Response Data'
        )
      await tx.wait()
      tx = await visibilityServices
        .connect(user1)
        .disputeServiceExecution(
          serviceNoncePaymentVisibilityCredits,
          executionNonceServiceVisibilityCredits,
          'Dispute Data'
        )
      await tx.wait()

      await expect(tx)
        .to.emit(visibilityServices, 'ServiceExecutionDisputed')
        .withArgs(
          serviceNoncePaymentVisibilityCredits,
          executionNonceServiceVisibilityCredits,
          'Dispute Data'
        )

      const [state] = await visibilityServices.getServiceExecution(
        serviceNoncePaymentVisibilityCredits,
        executionNonceServiceVisibilityCredits
      )

      expect(state).to.equal(3) // DISPUTED
    })

    it('Should revert if a non-requester tries to dispute an execution', async function () {
      await loadFixture(deployFixture)
      tx = await visibilityServices
        .connect(user1)
        .requestServiceExecution(
          serviceNoncePaymentVisibilityCredits,
          'Request Data'
        )
      await tx.wait()
      tx = await visibilityServices
        .connect(creator)
        .acceptServiceExecution(
          serviceNoncePaymentVisibilityCredits,
          executionNonceServiceVisibilityCredits,
          'Response Data'
        )
      await tx.wait()
      await expect(
        visibilityServices
          .connect(user2)
          .disputeServiceExecution(
            serviceNoncePaymentVisibilityCredits,
            executionNonceServiceVisibilityCredits,
            'Dispute Data'
          )
      ).to.be.revertedWithCustomError(
        visibilityServices,
        'UnauthorizedExecutionAction'
      )
    })

    it('Should resolve a dispute and refund correctly', async function () {
      await loadFixture(deployFixture)
      tx = await visibilityServices
        .connect(user1)
        .requestServiceExecution(
          serviceNoncePaymentVisibilityCredits,
          'Request Data'
        )
      await tx.wait()

      tx = await visibilityServices
        .connect(creator)
        .acceptServiceExecution(
          serviceNoncePaymentVisibilityCredits,
          executionNonceServiceVisibilityCredits,
          'Response Data'
        )
      await tx.wait()
      tx = await visibilityServices
        .connect(user1)
        .disputeServiceExecution(
          serviceNoncePaymentVisibilityCredits,
          executionNonceServiceVisibilityCredits,
          'Dispute Data'
        )
      await tx.wait()
      tx = await visibilityServices
        .connect(disputeResolver)
        .resolveServiceExecution(
          serviceNoncePaymentVisibilityCredits,
          executionNonceServiceVisibilityCredits,
          true,
          'Resolved with Refund'
        )
      await tx.wait()

      await expect(tx)
        .to.emit(visibilityServices, 'ServiceExecutionResolved')
        .withArgs(
          serviceNoncePaymentVisibilityCredits,
          executionNonceServiceVisibilityCredits,
          true,
          'Resolved with Refund'
        )

      const [state] = await visibilityServices.getServiceExecution(
        serviceNoncePaymentVisibilityCredits,
        executionNonceServiceVisibilityCredits
      )
      expect(state).to.equal(4) // REFUNDED

      // Verify the refund process
      const user1BalanceAfter =
        await visibilityCredits.getVisibilityCreditBalance(
          visibilityId1,
          user1.address
        )
      expect(user1BalanceAfter).to.be.equal(initialCreditsBalanceUser1) // Ensure user1 received the refund
    })

    it('Should resolve a dispute with validation', async function () {
      await loadFixture(deployFixture)

      tx = await visibilityServices
        .connect(user1)
        .requestServiceExecution(
          serviceNoncePaymentVisibilityCredits,
          'Request Data'
        )
      await tx.wait()

      const user1BalanceBefore =
        await visibilityCredits.getVisibilityCreditBalance(
          visibilityId1,
          user1.address
        )

      tx = await visibilityServices
        .connect(creator)
        .acceptServiceExecution(
          serviceNoncePaymentVisibilityCredits,
          executionNonceServiceVisibilityCredits,
          'Response Data'
        )
      await tx.wait()

      tx = await visibilityServices
        .connect(user1)
        .disputeServiceExecution(
          serviceNoncePaymentVisibilityCredits,
          executionNonceServiceVisibilityCredits,
          'Dispute Data'
        )
      await tx.wait()

      tx = await visibilityServices
        .connect(disputeResolver)
        .resolveServiceExecution(
          serviceNoncePaymentVisibilityCredits,
          executionNonceServiceVisibilityCredits,
          false,
          'Resolved without Refund'
        )
      await tx.wait()

      await expect(tx)
        .to.emit(visibilityServices, 'ServiceExecutionResolved')
        .withArgs(
          serviceNoncePaymentVisibilityCredits,
          executionNonceServiceVisibilityCredits,
          false,
          'Resolved without Refund'
        )

      const [state] = await visibilityServices.getServiceExecution(
        serviceNoncePaymentVisibilityCredits,
        executionNonceServiceVisibilityCredits
      )

      expect(state).to.equal(5) // VALIDATED

      const creatorBalanceAfter =
        await visibilityCredits.getVisibilityCreditBalance(
          visibilityId1,
          creator.address
        )

      expect(creatorBalanceAfter).to.equal(creditsCostAmount)

      // Verify that credits were not returned to the user
      const user1BalanceAfter =
        await visibilityCredits.getVisibilityCreditBalance(
          visibilityId1,
          user1.address
        )
      expect(user1BalanceAfter).to.equal(user1BalanceBefore)
    })

    it('Should revert if non-resolver tries to resolve a dispute', async function () {
      await loadFixture(deployFixture)
      tx = await visibilityServices
        .connect(user1)
        .requestServiceExecution(
          serviceNoncePaymentVisibilityCredits,
          'Request Data'
        )
      await tx.wait()
      tx = await visibilityServices
        .connect(creator)
        .acceptServiceExecution(
          serviceNoncePaymentVisibilityCredits,
          executionNonceServiceVisibilityCredits,
          'Response Data'
        )
      await tx.wait()
      tx = await visibilityServices
        .connect(user1)
        .disputeServiceExecution(
          serviceNoncePaymentVisibilityCredits,
          executionNonceServiceVisibilityCredits,
          'Dispute Data'
        )
      await tx.wait()
      await expect(
        visibilityServices
          .connect(user2)
          .resolveServiceExecution(
            serviceNoncePaymentVisibilityCredits,
            executionNonceServiceVisibilityCredits,
            true,
            'Unauthorized resolution'
          )
      ).to.be.revertedWithCustomError(
        visibilityServices,
        'AccessControlUnauthorizedAccount'
      )
    })

    it('Should revert if someone tries to accept/cancel/dispute an already REFUNDED execution', async () => {
      await loadFixture(deployFixture)

      // user1 requests
      await visibilityServices
        .connect(user1)
        .requestServiceExecution(
          serviceNoncePaymentVisibilityCredits,
          'Request Data'
        )
      // creator accepts
      await visibilityServices
        .connect(creator)
        .acceptServiceExecution(
          serviceNoncePaymentVisibilityCredits,
          executionNonceServiceVisibilityCredits,
          'Response Data'
        )
      // user1 disputes
      await visibilityServices
        .connect(user1)
        .disputeServiceExecution(
          serviceNoncePaymentVisibilityCredits,
          executionNonceServiceVisibilityCredits,
          'Dispute Data'
        )

      // disputeResolver => refund
      await visibilityServices
        .connect(disputeResolver)
        .resolveServiceExecution(
          serviceNoncePaymentVisibilityCredits,
          executionNonceServiceVisibilityCredits,
          true,
          'Refunded'
        )
      // Now it's REFUNDED => no further accept/cancel/dispute
      await expect(
        visibilityServices
          .connect(creator)
          .acceptServiceExecution(
            serviceNoncePaymentVisibilityCredits,
            executionNonceServiceVisibilityCredits,
            'Try Accept Again'
          )
      ).to.be.revertedWithCustomError(
        visibilityServices,
        'InvalidExecutionState'
      )
      await expect(
        visibilityServices
          .connect(user1)
          .cancelServiceExecution(
            serviceNoncePaymentVisibilityCredits,
            executionNonceServiceVisibilityCredits,
            'Try Cancel'
          )
      ).to.be.revertedWithCustomError(
        visibilityServices,
        'InvalidExecutionState'
      )
      await expect(
        visibilityServices
          .connect(user1)
          .disputeServiceExecution(
            serviceNoncePaymentVisibilityCredits,
            executionNonceServiceVisibilityCredits,
            'Try Dispute'
          )
      ).to.be.revertedWithCustomError(
        visibilityServices,
        'InvalidExecutionState'
      )
    })
  })

  describe('Service Execution Flow (ETH Payments specific tests)', function () {
    it('Should request service execution successfully', async function () {
      await loadFixture(deployFixture)

      tx = await visibilityServices
        .connect(user1)
        .requestServiceExecution(
          serviceNoncePaymentVisibilityETH,
          'Request Data',
          { value: weiCostAmount }
        )
      await tx.wait()

      const [state, requester] = await visibilityServices.getServiceExecution(
        serviceNoncePaymentVisibilityETH,
        executionNonceServiceVisibilityETH
      )

      expect(state).to.equal(1) // REQUESTED
      expect(requester).to.equal(user1.address)

      // No Visibility Credits paid
      const user1BalanceAfter =
        await visibilityCredits.getVisibilityCreditBalance(
          visibilityId1,
          user1.address
        )
      expect(user1BalanceAfter).to.be.equal(initialCreditsBalanceUser1)
    })

    it('Should not allow requesting execution on a disabled service', async function () {
      await loadFixture(deployFixture)
      tx = await visibilityServices
        .connect(creator)
        .updateService(serviceNoncePaymentVisibilityETH, false)
      await tx.wait()
      await expect(
        visibilityServices
          .connect(user1)
          .requestServiceExecution(
            serviceNoncePaymentVisibilityETH,
            'Request Data',
            { value: weiCostAmount }
          )
      ).to.be.revertedWithCustomError(visibilityServices, 'DisabledService')
    })

    it('Should revert if the user does not have enough value for execution', async function () {
      await loadFixture(deployFixture)

      const insufficientValue = weiCostAmount - 1n

      await expect(
        visibilityServices
          .connect(user2)
          .requestServiceExecution(
            serviceNoncePaymentVisibilityETH,
            'Request Data',
            { value: insufficientValue }
          )
      ).to.be.revertedWithCustomError(visibilityServices, 'InsufficientValue')
    })

    it('Should allow creator to cancel', async function () {
      await loadFixture(deployFixture)

      tx = await visibilityServices
        .connect(user1)
        .requestServiceExecution(
          serviceNoncePaymentVisibilityETH,
          'Request Data',
          { value: weiCostAmount }
        )
      await tx.wait()

      const requesterBalanceBefore = await provider.getBalance(user1.address)

      tx = await visibilityServices
        .connect(creator)
        .cancelServiceExecution(
          serviceNoncePaymentVisibilityETH,
          executionNonceServiceVisibilityETH,
          'Cancel Data'
        )
      await tx.wait()

      await expect(tx)
        .to.emit(visibilityServices, 'ServiceExecutionCanceled')
        .withArgs(
          serviceNoncePaymentVisibilityETH,
          executionNonceServiceVisibilityETH,
          creator.address,
          'Cancel Data'
        )

      const [state] = await visibilityServices.getServiceExecution(
        serviceNoncePaymentVisibilityETH,
        executionNonceServiceVisibilityETH
      )

      expect(state).to.equal(4) // CANCELED

      const requesterBalanceAfter = await provider.getBalance(user1.address)

      expect(requesterBalanceAfter).to.be.equal(
        requesterBalanceBefore + weiCostAmount
      )
    })

    it('Should validate a service after the delay', async function () {
      await loadFixture(deployAcceptedEthServiceFixture)

      // Simulate passing of AUTO_VALIDATION_DELAY
      await provider.send('evm_increaseTime', [5 * 24 * 60 * 60 + 1]) // 5 days + 1 second
      await provider.send('evm_mine', [])

      const contractBalanceBefore = await provider.getBalance(
        await visibilityServices.getAddress()
      )
      const creatorBalanceBefore = await provider.getBalance(creator.address)
      const treasuryBalanceBefore = await provider.getBalance(treasury.address)
      const buyBackPoolBefore =
        await visibilityServices.getVisibilityBuyBackEthBalance(visibilityId1)
      const creditsCreatorBalanceBefore =
        await visibilityCredits.getVisibilityCreditBalance(
          visibilityId1,
          creator.address
        )

      tx = await visibilityServices
        .connect(user2)
        .validateServiceExecution(
          serviceNoncePaymentVisibilityETH,
          executionNonceServiceVisibilityETH
        )
      await tx.wait()

      await expect(tx)
        .to.emit(visibilityServices, 'ServiceExecutionValidated')
        .withArgs(
          serviceNoncePaymentVisibilityETH,
          executionNonceServiceVisibilityETH
        )

      const [state] = await visibilityServices.getServiceExecution(
        serviceNoncePaymentVisibilityETH,
        executionNonceServiceVisibilityETH
      )

      expect(state).to.equal(5) // VALIDATED

      const contractBalanceAfter = await provider.getBalance(
        await visibilityServices.getAddress()
      )
      const creatorBalanceAfter = await provider.getBalance(creator.address)
      const treasuryBalanceAfter = await provider.getBalance(treasury.address)
      const buyBackPoolAfter =
        await visibilityServices.getVisibilityBuyBackEthBalance(visibilityId1)
      const creditsCreatorBalanceAfter =
        await visibilityCredits.getVisibilityCreditBalance(
          visibilityId1,
          creator.address
        )

      const FEE_DENOMINATOR = await visibilityServices.FEE_DENOMINATOR()
      const PROTOCOL_FEE = await visibilityServices.PROTOCOL_FEE()
      const buyBackShare = (
        await visibilityServices.getService(serviceNoncePaymentVisibilityETH)
      )[7]
      const creatorShare = FEE_DENOMINATOR - PROTOCOL_FEE - buyBackShare

      const expectedProtocolFee =
        (weiCostAmount * PROTOCOL_FEE) / FEE_DENOMINATOR
      const expectedCreatorFee =
        (weiCostAmount * creatorShare) / FEE_DENOMINATOR
      const expectedBuyBackFee =
        (weiCostAmount * buyBackShare) / FEE_DENOMINATOR

      await expect(tx)
        .to.emit(visibilityServices, 'BuyBackPoolUpdated')
        .withArgs(visibilityId1, false, expectedBuyBackFee)

      expect(contractBalanceBefore - contractBalanceAfter).to.be.equal(
        weiCostAmount - expectedCreatorFee - expectedProtocolFee
      )
      expect(creatorBalanceAfter - creatorBalanceBefore).to.be.equal(
        expectedCreatorFee
      )
      expect(treasuryBalanceAfter - treasuryBalanceBefore).to.be.equal(
        expectedProtocolFee
      )
      expect(buyBackPoolAfter - buyBackPoolBefore).to.be.equal(
        expectedBuyBackFee
      )
      expect(
        creditsCreatorBalanceAfter - creditsCreatorBalanceBefore
      ).to.be.equal(0)
    })

    it('Should resolve a dispute and refund correctly', async function () {
      await loadFixture(deployAcceptedEthServiceFixture)

      const contractBalanceBefore = await provider.getBalance(
        await visibilityServices.getAddress()
      )
      const creatorBalanceBefore = await provider.getBalance(creator.address)
      const treasuryBalanceBefore = await provider.getBalance(treasury.address)
      const buyBackPoolBefore =
        await visibilityServices.getVisibilityBuyBackEthBalance(visibilityId1)

      const user1CreditsBalanceBefore =
        await visibilityCredits.getVisibilityCreditBalance(
          visibilityId1,
          user1.address
        )

      tx = await visibilityServices
        .connect(user1)
        .disputeServiceExecution(
          serviceNoncePaymentVisibilityETH,
          executionNonceServiceVisibilityETH,
          'Dispute Data'
        )
      await tx.wait()
      tx = await visibilityServices
        .connect(disputeResolver)
        .resolveServiceExecution(
          serviceNoncePaymentVisibilityETH,
          executionNonceServiceVisibilityETH,
          true,
          'Resolved with Refund'
        )
      await tx.wait()

      const [state] = await visibilityServices.getServiceExecution(
        serviceNoncePaymentVisibilityETH,
        executionNonceServiceVisibilityETH
      )
      expect(state).to.equal(4) // REFUNDED

      const user1CreditsBalanceAfter =
        await visibilityCredits.getVisibilityCreditBalance(
          visibilityId1,
          user1.address
        )

      const creatorBalanceAfter = await provider.getBalance(creator.address)
      const treasuryBalanceAfter = await provider.getBalance(treasury.address)
      const buyBackPoolAfter =
        await visibilityServices.getVisibilityBuyBackEthBalance(visibilityId1)
      const contractBalanceAfter = await provider.getBalance(
        await visibilityServices.getAddress()
      )

      expect(contractBalanceBefore - contractBalanceAfter).to.be.equal(
        weiCostAmount
      )
      expect(creatorBalanceAfter - creatorBalanceBefore).to.be.equal(0)
      expect(treasuryBalanceAfter - treasuryBalanceBefore).to.be.equal(0)
      expect(buyBackPoolAfter - buyBackPoolBefore).to.be.equal(0)
      expect(user1CreditsBalanceAfter - user1CreditsBalanceBefore).to.be.equal(
        0
      )
    })

    it('Should resolve a dispute with validation', async function () {
      await loadFixture(deployAcceptedEthServiceFixture)

      const contractBalanceBefore = await provider.getBalance(
        await visibilityServices.getAddress()
      )
      const creatorBalanceBefore = await provider.getBalance(creator.address)
      const treasuryBalanceBefore = await provider.getBalance(treasury.address)
      const buyBackPoolBefore =
        await visibilityServices.getVisibilityBuyBackEthBalance(visibilityId1)
      const creditsCreatorBalanceBefore =
        await visibilityCredits.getVisibilityCreditBalance(
          visibilityId1,
          creator.address
        )

      tx = await visibilityServices
        .connect(user1)
        .disputeServiceExecution(
          serviceNoncePaymentVisibilityETH,
          executionNonceServiceVisibilityETH,
          'Dispute Data'
        )
      await tx.wait()

      tx = await visibilityServices
        .connect(disputeResolver)
        .resolveServiceExecution(
          serviceNoncePaymentVisibilityETH,
          executionNonceServiceVisibilityETH,
          false,
          'Resolved without Refund'
        )
      await tx.wait()

      const [state] = await visibilityServices.getServiceExecution(
        serviceNoncePaymentVisibilityETH,
        executionNonceServiceVisibilityETH
      )

      expect(state).to.equal(5) // VALIDATED

      const contractBalanceAfter = await provider.getBalance(
        await visibilityServices.getAddress()
      )
      const creatorBalanceAfter = await provider.getBalance(creator.address)
      const treasuryBalanceAfter = await provider.getBalance(treasury.address)
      const buyBackPoolAfter =
        await visibilityServices.getVisibilityBuyBackEthBalance(visibilityId1)
      const creditsCreatorBalanceAfter =
        await visibilityCredits.getVisibilityCreditBalance(
          visibilityId1,
          creator.address
        )

      const FEE_DENOMINATOR = await visibilityServices.FEE_DENOMINATOR()
      const PROTOCOL_FEE = await visibilityServices.PROTOCOL_FEE()
      const buyBackShare = (
        await visibilityServices.getService(serviceNoncePaymentVisibilityETH)
      )[7]
      const creatorShare = FEE_DENOMINATOR - PROTOCOL_FEE - buyBackShare

      const expectedProtocolFee =
        (weiCostAmount * PROTOCOL_FEE) / FEE_DENOMINATOR
      const expectedCreatorFee =
        (weiCostAmount * creatorShare) / FEE_DENOMINATOR
      const expectedBuyBackFee =
        (weiCostAmount * buyBackShare) / FEE_DENOMINATOR

      await expect(tx)
        .to.emit(visibilityServices, 'BuyBackPoolUpdated')
        .withArgs(visibilityId1, false, expectedBuyBackFee)

      await expect(tx)
        .to.emit(visibilityServices, 'ServiceExecutionEthPayment')
        .withArgs(
          serviceNoncePaymentVisibilityETH,
          expectedProtocolFee,
          expectedCreatorFee,
          expectedBuyBackFee
        )

      expect(contractBalanceBefore - contractBalanceAfter).to.be.equal(
        weiCostAmount - expectedCreatorFee - expectedProtocolFee
      )
      expect(creatorBalanceAfter - creatorBalanceBefore).to.be.equal(
        expectedCreatorFee
      )
      expect(treasuryBalanceAfter - treasuryBalanceBefore).to.be.equal(
        expectedProtocolFee
      )
      expect(buyBackPoolAfter - buyBackPoolBefore).to.be.equal(
        expectedBuyBackFee
      )
      expect(
        creditsCreatorBalanceAfter - creditsCreatorBalanceBefore
      ).to.be.equal(0)
    })
  })

  describe('Buy back', function () {
    it('Should allow creator to buy back Visbility Credits', async function () {
      await loadFixture(deployValidatedEthServiceFixture)

      const boughtCreditsBefore =
        await visibilityCredits.getVisibilityCreditBalance(
          visibilityId1,
          await visibilityServices.getAddress()
        )
      const contractBalanceBefore = await provider.getBalance(
        await visibilityServices.getAddress()
      )

      const buyBackBalanceBefore =
        await visibilityServices.getVisibilityBuyBackEthBalance(visibilityId1)

      const creditsBuyBackAmount = 100

      const [totalCost] = await visibilityCredits.buyCostWithFees(
        visibilityId1,
        creditsBuyBackAmount,
        await visibilityServices.getAddress(),
        ZeroAddress
      )

      expect(totalCost).to.be.lessThan(buyBackBalanceBefore)

      tx = await visibilityServices
        .connect(creator)
        .buyBack(visibilityId1, creditsBuyBackAmount, totalCost)
      await tx.wait()

      await expect(tx)
        .to.emit(visibilityServices, 'BuyBack')
        .withArgs(visibilityId1, totalCost, creditsBuyBackAmount)

      await expect(tx)
        .to.emit(visibilityServices, 'BuyBackPoolUpdated')
        .withArgs(visibilityId1, true, totalCost)

      const boughtCreditsAfter =
        await visibilityCredits.getVisibilityCreditBalance(
          visibilityId1,
          await visibilityServices.getAddress()
        )
      const contractBalanceAfter = await provider.getBalance(
        await visibilityServices.getAddress()
      )
      const buyBackBalanceAfter =
        await visibilityServices.getVisibilityBuyBackEthBalance(visibilityId1)

      expect(boughtCreditsAfter - boughtCreditsBefore).to.be.equal(
        creditsBuyBackAmount
      )

      expect(contractBalanceBefore - contractBalanceAfter).to.be.equal(
        totalCost
      )

      expect(buyBackBalanceBefore - buyBackBalanceAfter).to.be.equal(totalCost)
    })

    it('Should revert on buy back front run', async function () {
      await loadFixture(deployValidatedEthServiceFixture)

      const creditsBuyBackAmount = 100

      const [totalCost] = await visibilityCredits.buyCostWithFees(
        visibilityId1,
        creditsBuyBackAmount,
        await visibilityServices.getAddress(),
        ZeroAddress
      )

      tx = await visibilityCredits
        .connect(user2)
        .buyCredits(visibilityId1, creditsBuyBackAmount, ZeroAddress, {
          value: totalCost
        })

      await tx.wait()

      await expect(
        visibilityServices
          .connect(creator)
          .buyBack(visibilityId1, creditsBuyBackAmount, totalCost)
      ).to.be.revertedWithCustomError(visibilityServices, 'QuoteSlippage')
    })

    it('Should revert on insufficient buy back balance', async function () {
      await loadFixture(deployValidatedEthServiceFixture)

      const creditsBuyBackAmount = 10000000

      const buybackBalance =
        await visibilityServices.getVisibilityBuyBackEthBalance(visibilityId1)

      const [totalCost] = await visibilityCredits.buyCostWithFees(
        visibilityId1,
        creditsBuyBackAmount,
        await visibilityServices.getAddress(),
        ZeroAddress
      )

      expect(buybackBalance).to.be.lessThan(totalCost)

      await expect(
        visibilityServices
          .connect(creator)
          .buyBack(visibilityId1, creditsBuyBackAmount, totalCost)
      ).to.be.revertedWithCustomError(visibilityServices, 'InsufficientValue')
    })

    it('Should revert if buy back is not requested by visibility creator', async function () {
      await loadFixture(deployValidatedEthServiceFixture)

      await expect(
        visibilityServices.connect(user1).buyBack(visibilityId1, 100, 100)
      ).to.be.revertedWithCustomError(visibilityServices, 'InvalidCreator')
    })
  })

  describe('Multiple Executions per Service', function () {
    it('Should allow user to create multiple requests, each with its own state', async () => {
      await loadFixture(deployFixture)

      // First request
      await visibilityServices
        .connect(user1)
        .requestServiceExecution(
          serviceNoncePaymentVisibilityCredits,
          'Request Data 1'
        )

      // Second request
      await visibilityServices
        .connect(user1)
        .requestServiceExecution(
          serviceNoncePaymentVisibilityCredits,
          'Request Data 2'
        )

      const nextExecutionNonceServiceVisibilityCredits = 1

      // Check that both requests exist
      const [state1] = await visibilityServices.getServiceExecution(
        serviceNoncePaymentVisibilityCredits,
        executionNonceServiceVisibilityCredits
      )
      const [state2] = await visibilityServices.getServiceExecution(
        serviceNoncePaymentVisibilityCredits,
        nextExecutionNonceServiceVisibilityCredits
      )
      expect(state1).to.equal(1) // REQUESTED
      expect(state2).to.equal(1) // REQUESTED

      // Accept the first, leave the second alone
      await visibilityServices
        .connect(creator)
        .acceptServiceExecution(
          serviceNoncePaymentVisibilityCredits,
          executionNonceServiceVisibilityCredits,
          'Response 1'
        )

      // The first is ACCEPTED, second is still REQUESTED
      const [st1After] = await visibilityServices.getServiceExecution(
        serviceNoncePaymentVisibilityCredits,
        executionNonceServiceVisibilityCredits
      )
      const [st2After] = await visibilityServices.getServiceExecution(
        serviceNoncePaymentVisibilityCredits,
        nextExecutionNonceServiceVisibilityCredits
      )
      expect(st1After).to.equal(2) // ACCEPTED
      expect(st2After).to.equal(1) // REQUESTED
    })
  })

  describe('Request data size limit', function () {
    it('Should revert if request data is too large', async () => {
      await loadFixture(deployFixture)

      const largeData = 'a'.repeat(2050)

      await expect(
        visibilityServices
          .connect(user1)
          .requestServiceExecution(
            serviceNoncePaymentVisibilityCredits,
            largeData
          )
      ).to.be.revertedWithCustomError(
        visibilityServices,
        'InvalidPayloadDataSize'
      )
    })
  })

  describe('Upgrade simulation', function () {
    it('Should succeed V1 to V2 upgrade', async () => {
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
        'VisibilityServicesV1',
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
        .createService(serviceTypeVC, visibilityId1, 10)
      await tx.wait()

      tx = await visibilityCredits
        .connect(admin)
        .grantCreatorTransferRole(await visibilityServices.getAddress())
      await tx.wait()

      const visibilityServicesProxyAddr = await visibilityServices.getAddress()

      await upgradeProxyContract(
        visibilityServicesProxyAddr,
        'VisibilityServices',
        { wallet: deployer, silent: true }
      )
    })
  })
})
