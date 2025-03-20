// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/extensions/AccessControlDefaultAdminRulesUpgradeable.sol";
import "./interfaces/IVisibilityCredits.sol";
import "./interfaces/IVisibilityServices.sol";
import "@openzeppelin/contracts/utils/Address.sol";

/**
 * @title VisibilityServices
 * @notice Allows users to spend creator credits (from IVisibilityCredits), for ad purposes.
 *
 * UPDATE V2:
 * - VisibilityServices can now be paid with ETH.
 *   When `paymentType` is Visibility Credits, 100% of the payment goes to the creator
 *   When `paymentType` is ETH, payments are distributed as follows:
 *   1. A portion, set initially by the service originator and then by the visibility creator, goes to a "buy back pool".
 *     Once validated, the creator from the visibility linked to the service can use it to buy back visibility credits.
 *     As the smart contract "buys" credits and won't use it later, it can be considered as "burning" credits.
 *   2. A fixed percentage goes to the protocol.
 *   3. The remaining funds go to the visibility creator.
 */
contract VisibilityServices is
    AccessControlDefaultAdminRulesUpgradeable,
    IVisibilityServices
{
    uint256 public constant AUTO_VALIDATION_DELAY = 5 days;

    bytes32 public constant DISPUTE_RESOLVER_ROLE =
        keccak256("DISPUTE_RESOLVER_ROLE");

    /// @notice Fee percentages in ppm (parts per million).
    uint32 public constant FEE_DENOMINATOR = 1_000_000; // Using parts per million (ppm)
    uint32 public constant PROTOCOL_FEE = 20_000; // 2% base fee (does not include protocol fee on buy back)

    uint256 constant MAX_STRING_SIZE = 2048; // 2KB max size for string payloads

    /// @custom:storage-location erc7201:noodles.VisibilityServices
    struct VisibilityServicesStorage {
        IVisibilityCredits visibilityCredits;
        uint256 servicesNonce; // Counter for service IDs
        mapping(uint256 => Service) services; // Mapping of services by nonce
        BuyBackPools buyBackPools; // Added: Buy back balances for each visibility
    }

    // keccak256(abi.encode(uint256(keccak256("noodles.VisibilityServices")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant VisibilityServicesStorageLocation =
        0x523cffa5e7f48f8e220488f534837697930b9986fe2a9046bebda6761fdc0000;

    function _getVisibilityServicesStorage()
        private
        pure
        returns (VisibilityServicesStorage storage $)
    {
        assembly {
            $.slot := VisibilityServicesStorageLocation
        }
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @dev Constructor to initialize the contract.
     *
     * @param visibilityCredits Address of the IVisibilityCredits contract.
     * @param adminDelay Delay for the admin role.
     * @param admin Address for the admin role.
     * @param disputeResolver Address for the dispute resolver role.
     */
    function initialize(
        address visibilityCredits,
        uint48 adminDelay,
        address admin,
        address disputeResolver
    ) public initializer {
        if (visibilityCredits == address(0)) revert InvalidAddress();

        VisibilityServicesStorage storage $ = _getVisibilityServicesStorage();
        $.visibilityCredits = IVisibilityCredits(visibilityCredits);

        __AccessControlDefaultAdminRules_init_unchained(adminDelay, admin);
        _grantRole(DISPUTE_RESOLVER_ROLE, disputeResolver);
    }

    /**
     * @notice Creates a new service with credits cost payment. Anyone can purpose a new service.
     * @dev `paymentType = VISIBILITY_CREDITS`
     *
     * @param serviceType The type of the service.
     * @param visibilityId The visibility ID associated with the service.
     * @param creditsCostAmount The cost in credits for the service. Can be 0 (free).
     */
    function createService(
        string memory serviceType,
        string memory visibilityId,
        uint256 creditsCostAmount
    ) external {
        VisibilityServicesStorage storage $ = _getVisibilityServicesStorage();

        uint256 nonce = $.servicesNonce;
        $.services[nonce].enabled = true;
        $.services[nonce].serviceType = serviceType;
        $.services[nonce].visibilityId = visibilityId;
        $.services[nonce].creditsCostAmount = creditsCostAmount;
        $.services[nonce].executionsNonce = 0;
        $.services[nonce].originator = msg.sender;

        // $.services[nonce].paymentType = PaymentType.VISIBILITY_CREDITS;
        // $.services[nonce].buyBackCreditsShare = 0;
        // $.services[nonce].weiCostAmount = weiCostAmount;

        $.servicesNonce += 1;

        emit ServiceCreated(
            msg.sender,
            nonce,
            serviceType,
            visibilityId,
            creditsCostAmount
        );
    }

    /**
     * @notice Creates a new service with ETH payment. Anyone can purpose a new service.
     * @dev `paymentType = ETH`
     *
     * @param serviceType The type of the service.
     * @param visibilityId The visibility ID associated with the service.
     * @param buyBackCreditsShare The share in ppm of the ETH payment used to buy back credits. Should be less than 98 % (`FEE_DENOMINATOR - PROTOCOL_FEE = 980_000`).
     * @param weiCostAmount The cost in WEI for the service. Can be 0 (free).
     */
    function createServiceWithETH(
        string memory serviceType,
        string memory visibilityId,
        uint256 buyBackCreditsShare,
        uint256 weiCostAmount
    ) external {
        if (buyBackCreditsShare > FEE_DENOMINATOR - PROTOCOL_FEE)
            revert InvalidBuyBackCreditsShare();

        VisibilityServicesStorage storage $ = _getVisibilityServicesStorage();

        uint256 nonce = $.servicesNonce;
        $.services[nonce].enabled = true;
        $.services[nonce].serviceType = serviceType;
        $.services[nonce].visibilityId = visibilityId;
        // $.services[nonce].creditsCostAmount = 0;
        $.services[nonce].executionsNonce = 0;
        $.services[nonce].originator = msg.sender;

        $.services[nonce].paymentType = PaymentType.ETH;
        $.services[nonce].buyBackCreditsShare = buyBackCreditsShare;
        $.services[nonce].weiCostAmount = weiCostAmount;

        $.servicesNonce += 1;

        emit ServiceWithETHCreated(
            msg.sender,
            nonce,
            serviceType,
            visibilityId,
            buyBackCreditsShare,
            weiCostAmount
        );
    }

    /**
     * @notice Creates a new service and updates an existing service. Can only be called by the service originator.
     * The existing service is disabled. The new service is created with the same parameters as the existing service, except for the cost.
     *
     * @param serviceNonce The ID of the existing service.
     * @param costAmount The cost (in credits or WEI) for the new service.
     */
    function createAndUpdateFromService(
        uint256 serviceNonce,
        uint256 costAmount
    ) external {
        VisibilityServicesStorage storage $ = _getVisibilityServicesStorage();

        Service storage service = $.services[serviceNonce];
        string memory serviceType = service.serviceType;
        string memory visibilityId = service.visibilityId;
        PaymentType paymentType = service.paymentType;
        uint256 buyBackCreditsShare = service.buyBackCreditsShare;

        address originator = service.originator;
        if (originator != msg.sender) revert InvalidOriginator();

        uint256 nonce = $.servicesNonce;
        $.services[nonce].enabled = true;
        $.services[nonce].serviceType = serviceType;
        $.services[nonce].visibilityId = visibilityId;

        $.services[nonce].executionsNonce = 0;
        $.services[nonce].originator = msg.sender;

        $.services[nonce].paymentType = paymentType;
        $.services[nonce].buyBackCreditsShare = buyBackCreditsShare;

        if (paymentType == PaymentType.VISIBILITY_CREDITS) {
            $.services[nonce].creditsCostAmount = costAmount;
        } else if (paymentType == PaymentType.ETH) {
            $.services[nonce].weiCostAmount = costAmount;
        } else {
            revert InvalidPaymentType();
        }

        $.servicesNonce += 1;

        if (paymentType == PaymentType.VISIBILITY_CREDITS) {
            emit ServiceCreated(
                msg.sender,
                nonce,
                serviceType,
                visibilityId,
                costAmount
            );
        } else if (paymentType == PaymentType.ETH) {
            emit ServiceWithETHCreated(
                msg.sender,
                nonce,
                serviceType,
                visibilityId,
                buyBackCreditsShare,
                costAmount
            );
        }

        service.enabled = false;
        emit ServiceUpdated(serviceNonce, false);
    }

    /**
     * @notice Requests execution of a service. Transfers payment (Visbility Credits or ETH) from the requester to the contract.
     *
     * @param serviceNonce The ID of the service.
     * @param requestData The data related to the request.
     */
    function requestServiceExecution(
        uint256 serviceNonce,
        string calldata requestData
    ) external payable {
        if (bytes(requestData).length > MAX_STRING_SIZE) {
            revert InvalidPayloadDataSize();
        }

        VisibilityServicesStorage storage $ = _getVisibilityServicesStorage();

        Service storage service = $.services[serviceNonce];

        if (!service.enabled) revert DisabledService();

        PaymentType paymentType = service.paymentType;

        uint256 executionNonce = service.executionsNonce;
        service.executions[executionNonce].state = ExecutionState.REQUESTED;
        service.executions[executionNonce].requester = msg.sender;
        service.executions[executionNonce].lastUpdateTimestamp = block
            .timestamp;

        service.executionsNonce += 1;

        if (paymentType == PaymentType.VISIBILITY_CREDITS) {
            // Ensure the user has not mistakenly sent ETH
            if (msg.value != 0) revert InvalidValue();

            /// @dev it reverts if not enough credits
            $.visibilityCredits.transferCredits(
                service.visibilityId,
                msg.sender,
                address(this),
                service.creditsCostAmount
            );
        } else if (paymentType == PaymentType.ETH) {
            uint256 weiCostAmount = service.weiCostAmount;
            if (msg.value < weiCostAmount) revert InsufficientValue();

            if (msg.value > weiCostAmount) {
                Address.sendValue(
                    payable(msg.sender),
                    msg.value - weiCostAmount
                );
            }
        } else {
            revert InvalidPaymentType();
        }

        emit ServiceExecutionRequested(
            serviceNonce,
            executionNonce,
            msg.sender,
            requestData
        );
    }

    /**
     * @notice Add information to agree about service execution details
     *
     * @param serviceNonce The ID of the service.
     * @param executionNonce The ID of the execution
     * @param informationData The data related to the information request.
     */
    function addInformationForServiceExecution(
        uint256 serviceNonce,
        uint256 executionNonce,
        string calldata informationData
    ) external {
        if (bytes(informationData).length > MAX_STRING_SIZE) {
            revert InvalidPayloadDataSize();
        }

        VisibilityServicesStorage storage $ = _getVisibilityServicesStorage();

        Service storage service = $.services[serviceNonce];

        // Validate that executionNonce exists
        if (executionNonce >= service.executionsNonce)
            revert InvalidExecutionNonce();

        Execution storage execution = service.executions[executionNonce];

        string memory visibilityId = service.visibilityId;
        (address creator, , ) = $.visibilityCredits.getVisibility(visibilityId);

        bool fromCreator = creator == msg.sender;
        bool fromRequester = execution.requester == msg.sender;
        bool fromDisputeResolver = hasRole(DISPUTE_RESOLVER_ROLE, msg.sender);

        bool canAddInformation = fromCreator ||
            fromRequester ||
            fromDisputeResolver;

        if (canAddInformation == false) revert UnauthorizedExecutionAction();

        emit ServiceExecutionInformation(
            serviceNonce,
            executionNonce,
            msg.sender,
            fromCreator,
            fromRequester,
            fromDisputeResolver,
            informationData
        );
    }

    /**
     * @notice Accepts a service execution request. Can only be called by the creator linked to the visibility ID.
     *
     * @param serviceNonce The ID of the service.
     * @param executionNonce The ID of the execution.
     * @param responseData The data related to the response.
     */
    function acceptServiceExecution(
        uint256 serviceNonce,
        uint256 executionNonce,
        string calldata responseData
    ) external {
        if (bytes(responseData).length > MAX_STRING_SIZE) {
            revert InvalidPayloadDataSize();
        }

        VisibilityServicesStorage storage $ = _getVisibilityServicesStorage();

        Service storage service = $.services[serviceNonce];
        Execution storage execution = service.executions[executionNonce];

        if (execution.state != ExecutionState.REQUESTED)
            revert InvalidExecutionState();

        string memory visibilityId = service.visibilityId;
        (address creator, , ) = $.visibilityCredits.getVisibility(visibilityId);
        if (creator != msg.sender) revert UnauthorizedExecutionAction();

        execution.state = ExecutionState.ACCEPTED;
        execution.lastUpdateTimestamp = block.timestamp;

        emit ServiceExecutionAccepted(
            serviceNonce,
            executionNonce,
            responseData
        );
    }

    /**
     * @notice Cancels a service execution. Can only be called by the requester or the creator linked to the visibility ID.
     *
     * @param serviceNonce The ID of the service.
     * @param executionNonce The ID of the execution.
     * @param cancelData The data related to the cancellation.
     */
    function cancelServiceExecution(
        uint256 serviceNonce,
        uint256 executionNonce,
        string calldata cancelData
    ) external {
        if (bytes(cancelData).length > MAX_STRING_SIZE) {
            revert InvalidPayloadDataSize();
        }

        VisibilityServicesStorage storage $ = _getVisibilityServicesStorage();

        Service storage service = $.services[serviceNonce];
        Execution storage execution = service.executions[executionNonce];

        if (execution.state != ExecutionState.REQUESTED)
            revert InvalidExecutionState();

        address requester = execution.requester;

        string memory visibilityId = service.visibilityId;
        (address creator, , ) = $.visibilityCredits.getVisibility(visibilityId);
        if (!(requester == msg.sender || creator == msg.sender))
            revert UnauthorizedExecutionAction();

        /// @dev: We update state before refunding to prevent re-entrancy
        execution.state = ExecutionState.REFUNDED;
        execution.lastUpdateTimestamp = block.timestamp;
        _proceedRefund(serviceNonce, requester);

        emit ServiceExecutionCanceled(
            serviceNonce,
            executionNonce,
            msg.sender,
            cancelData
        );
    }

    /**
     * @notice Validates a service execution.
     * Can only be called by the requester or by anyone after a delay.
     *
     * @param serviceNonce The ID of the service.
     * @param executionNonce The ID of the execution.
     */
    function validateServiceExecution(
        uint256 serviceNonce,
        uint256 executionNonce
    ) external {
        VisibilityServicesStorage storage $ = _getVisibilityServicesStorage();

        Service storage service = $.services[serviceNonce];
        Execution storage execution = service.executions[executionNonce];

        if (execution.state != ExecutionState.ACCEPTED)
            revert InvalidExecutionState();

        if (
            !(execution.requester == msg.sender ||
                (AUTO_VALIDATION_DELAY + execution.lastUpdateTimestamp <
                    block.timestamp))
        ) revert UnauthorizedExecutionAction();

        /// @dev: We update state before payment to prevent re-entrancy
        execution.state = ExecutionState.VALIDATED;
        execution.lastUpdateTimestamp = block.timestamp;

        _proceedValidation(serviceNonce, executionNonce);

        emit ServiceExecutionValidated(serviceNonce, executionNonce);
    }

    /**
     * @notice Disputes a service execution. Can only be called by the requester.
     *
     * @param serviceNonce The ID of the service.
     * @param executionNonce The ID of the execution.
     * @param disputeData The data related to the dispute.
     */
    function disputeServiceExecution(
        uint256 serviceNonce,
        uint256 executionNonce,
        string calldata disputeData
    ) external {
        if (bytes(disputeData).length > MAX_STRING_SIZE) {
            revert InvalidPayloadDataSize();
        }
        VisibilityServicesStorage storage $ = _getVisibilityServicesStorage();

        Service storage service = $.services[serviceNonce];
        Execution storage execution = service.executions[executionNonce];

        if (execution.state != ExecutionState.ACCEPTED)
            revert InvalidExecutionState();
        if (execution.requester != msg.sender)
            revert UnauthorizedExecutionAction();

        execution.state = ExecutionState.DISPUTED;
        execution.lastUpdateTimestamp = block.timestamp;

        emit ServiceExecutionDisputed(
            serviceNonce,
            executionNonce,
            disputeData
        );
    }

    /**
     * @notice Resolves a disputed service execution.
     *
     * @param serviceNonce The ID of the service.
     * @param executionNonce The ID of the execution.
     * @param refund Whether the resolution includes a refund.
     * @param resolveData The data related to the resolution.
     */
    function resolveServiceExecution(
        uint256 serviceNonce,
        uint256 executionNonce,
        bool refund,
        string calldata resolveData
    ) external onlyRole(DISPUTE_RESOLVER_ROLE) {
        if (bytes(resolveData).length > MAX_STRING_SIZE) {
            revert InvalidPayloadDataSize();
        }
        VisibilityServicesStorage storage $ = _getVisibilityServicesStorage();

        Service storage service = $.services[serviceNonce];
        Execution storage execution = service.executions[executionNonce];

        if (execution.state != ExecutionState.DISPUTED)
            revert InvalidExecutionState();

        /// @dev: We update state before refunding to prevent re-entrancy
        if (refund) {
            execution.state = ExecutionState.REFUNDED;
            _proceedRefund(serviceNonce, execution.requester);
        } else {
            execution.state = ExecutionState.VALIDATED;
            _proceedValidation(serviceNonce, executionNonce);
        }

        execution.lastUpdateTimestamp = block.timestamp;

        emit ServiceExecutionResolved(
            serviceNonce,
            executionNonce,
            refund,
            resolveData
        );
    }

    /**
     * @notice Updates the status of an existing service. Can only be called by the service originator.
     * @dev Disabling a service will prevent new executions but will not affect ongoing executions.
     *      A disabled service can be re-enabled.
     *
     * @param serviceNonce The ID of the service to update.
     * @param enabled The new status of the service (true for enabled, false for disabled).
     */
    function updateService(uint256 serviceNonce, bool enabled) external {
        VisibilityServicesStorage storage $ = _getVisibilityServicesStorage();

        Service storage service = $.services[serviceNonce];

        if (service.originator != msg.sender) revert InvalidOriginator();

        service.enabled = enabled;
        emit ServiceUpdated(serviceNonce, enabled);
    }

    /**
     * @notice Updates the buy back credits share of an existing service. Can only be called by the visibility creator.
     *
     * @param serviceNonce The ID of the service to update.
     * @param buyBackCreditsShare The new share in ppm of the ETH payment used to buy back credits.
     */
    function updateBuyBackCreditsShare(
        uint256 serviceNonce,
        uint256 buyBackCreditsShare
    ) external {
        if (buyBackCreditsShare > FEE_DENOMINATOR - PROTOCOL_FEE)
            revert InvalidBuyBackCreditsShare();

        VisibilityServicesStorage storage $ = _getVisibilityServicesStorage();
        Service storage service = $.services[serviceNonce];

        string memory visibilityId = service.visibilityId;
        (address creator, , ) = $.visibilityCredits.getVisibility(visibilityId);
        if (creator != msg.sender) revert InvalidCreator();

        PaymentType paymentType = service.paymentType;
        if (paymentType != PaymentType.ETH) revert InvalidPaymentType();

        service.buyBackCreditsShare = buyBackCreditsShare;
        emit ServiceBuyBackUpdated(serviceNonce, buyBackCreditsShare);
    }

    /**
     * @notice Allow a visibility creator to spend from its buy back pool, to buy credits from the visibility.
     * As the credits are sent to the smart contract, it can be considered as "burned".
     *
     * @dev Can only be called by the visibility creator.
     *
     * @param visibilityId The ID of the visibility.
     * @param creditsAmount The amount of credits to buy back.
     * @param maxWeiAmount The maximum amount of WEI to spend.
     */
    function buyBack(
        string memory visibilityId,
        uint256 creditsAmount,
        uint256 maxWeiAmount
    ) external {
        VisibilityServicesStorage storage $ = _getVisibilityServicesStorage();
        (address creator, , ) = $.visibilityCredits.getVisibility(visibilityId);
        if (creator != msg.sender) revert InvalidCreator();

        (uint256 totalCost, ) = $.visibilityCredits.buyCostWithFees(
            visibilityId,
            creditsAmount,
            address(this),
            address(0)
        );

        if (totalCost > maxWeiAmount) revert QuoteSlippage();

        if ($.buyBackPools.buyBackEthBalances[visibilityId] < totalCost)
            revert InsufficientValue();

        /// @dev: We update state before payment to prevent from re-entrancy
        $.buyBackPools.buyBackEthBalances[visibilityId] -= totalCost;

        $.visibilityCredits.buyCredits{value: totalCost}(
            visibilityId,
            creditsAmount,
            address(0)
        );

        emit BuyBackPoolUpdated(visibilityId, true, totalCost);
        emit BuyBack(visibilityId, totalCost, creditsAmount);
    }

    /***********************************
     * VIEW FUNCTIONS
     * *********************************/

    /**
     * @notice Returns the details of a service (legacy => Visbility Credits Payment).
     */
    function getService(
        uint256 serviceNonce
    )
        external
        view
        returns (
            bool enabled,
            string memory serviceType,
            string memory visibilityId,
            uint256 creditsCostAmount,
            uint256 executionsNonce,
            address originator,
            uint256 weiCostAmount,
            uint256 buyBackCreditsShare,
            PaymentType paymentType
        )
    {
        VisibilityServicesStorage storage $ = _getVisibilityServicesStorage();
        Service storage service = $.services[serviceNonce];

        return (
            service.enabled,
            service.serviceType,
            service.visibilityId,
            service.creditsCostAmount,
            service.executionsNonce,
            service.originator,
            service.weiCostAmount,
            service.buyBackCreditsShare,
            service.paymentType
        );
    }

    function getServiceExecution(
        uint256 serviceNonce,
        uint256 executionNonce
    )
        external
        view
        returns (
            ExecutionState state,
            address requester,
            uint256 lastUpdateTimestamp
        )
    {
        VisibilityServicesStorage storage $ = _getVisibilityServicesStorage();
        Execution storage execution = $.services[serviceNonce].executions[
            executionNonce
        ];
        return (
            execution.state,
            execution.requester,
            execution.lastUpdateTimestamp
        );
    }

    function getVisibilityCreditsContract() external view returns (address) {
        VisibilityServicesStorage storage $ = _getVisibilityServicesStorage();
        return address($.visibilityCredits);
    }

    function getVisibilityBuyBackEthBalance(
        string calldata visibilityId
    ) external view returns (uint256) {
        VisibilityServicesStorage storage $ = _getVisibilityServicesStorage();
        return $.buyBackPools.buyBackEthBalances[visibilityId];
    }

    /***************
     * PRIVATE FUNCTIONS
     * ************/

    function _proceedRefund(uint256 serviceNonce, address requester) private {
        VisibilityServicesStorage storage $ = _getVisibilityServicesStorage();

        Service storage service = $.services[serviceNonce];

        PaymentType paymentType = service.paymentType;

        if (paymentType == PaymentType.VISIBILITY_CREDITS) {
            $.visibilityCredits.transferCredits(
                service.visibilityId,
                address(this),
                requester,
                service.creditsCostAmount
            );
        } else if (paymentType == PaymentType.ETH) {
            Address.sendValue(payable(requester), service.weiCostAmount);
        } else {
            revert InvalidPaymentType();
        }
    }

    function _proceedValidation(
        uint256 serviceNonce,
        uint256 executionNonce
    ) private {
        VisibilityServicesStorage storage $ = _getVisibilityServicesStorage();

        Service storage service = $.services[serviceNonce];

        PaymentType paymentType = service.paymentType;
        string memory visibilityId = service.visibilityId;

        (address creator, , ) = $.visibilityCredits.getVisibility(visibilityId);

        if (creator == address(0)) revert InvalidCreator();

        if (paymentType == PaymentType.VISIBILITY_CREDITS) {
            $.visibilityCredits.transferCredits(
                visibilityId,
                address(this),
                creator,
                service.creditsCostAmount
            );
        } else if (paymentType == PaymentType.ETH) {
            address protocolTreasury = $
                .visibilityCredits
                .getProtocolTreasury();
            if (protocolTreasury == address(0))
                revert InvalidProtocolTreasury();

            uint256 buyBackCreditsShare = service.buyBackCreditsShare;
            uint256 weiCostAmount = service.weiCostAmount;

            uint256 protocolAmount = (weiCostAmount * PROTOCOL_FEE) /
                FEE_DENOMINATOR;

            uint256 buyBackAmount = (weiCostAmount * buyBackCreditsShare) /
                FEE_DENOMINATOR;

            uint256 creatorAmount = weiCostAmount -
                protocolAmount -
                buyBackAmount;

            Address.sendValue(payable(protocolTreasury), protocolAmount);
            Address.sendValue(payable(creator), creatorAmount);

            ////@dev We want the creator to wait the end of this execution before being able to buy back credits
            $.buyBackPools.buyBackEthBalances[visibilityId] += buyBackAmount;

            emit ServiceExecutionEthPayment(
                serviceNonce,
                executionNonce,
                protocolAmount,
                creatorAmount,
                buyBackAmount
            );
            emit BuyBackPoolUpdated(visibilityId, false, buyBackAmount);
        } else {
            revert InvalidPaymentType();
        }
    }
}
