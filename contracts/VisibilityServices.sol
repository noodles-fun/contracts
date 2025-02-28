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
 * - Unlike VisibilityCredits, where 100% of the payment goes to the creator, ETH payments are distributed as follows:
 * - A portion, set first by the service creator and then by the visibility creator, is used to buy back credits from the visibility creator.
 *   As the smart contract "buys" credits and won't use it later it can be consired as "burning" credits.
 * - A fixed percentage goes to the protocol.
 * - The remaining funds go to the visibility creator.
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

    /// @notice To compute how much credits can be bought with a given amount of ETH, we need a maximum number of credits.
    uint32 public constant MAX_NB_CREDITS = 50_000_000; // arbitrary limit, should be enough for most use cases, and avoid too much loops to compute quote ({creditsQuoteFromWeiAmount})
    uint160 public constant MAX_WEI_COST = 658_000 * 1e18; // Minimum price for 50_000_000 credits is ≈ 656 283 ETH with current values in {VisibilityCredits}

    /// @custom:storage-location erc7201:noodles.VisibilityServices
    struct VisibilityServicesStorage {
        IVisibilityCredits visibilityCredits;
        uint256 servicesNonce; // Counter for service IDs
        mapping(uint256 => Service) services; // Mapping of services by nonce
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
     *
     * @param serviceType The type of the service.
     * @param visibilityId The visibility ID associated with the service.
     * @param buyBackCreditsShare The share in ppm of the ETH payment used to buy back credits.
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

        if (weiCostAmount > MAX_WEI_COST) revert InvalidWeiCost();

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
     * The existing service is disabled. The new service is created with the same parameters as the existing service, except for the cost in credits.
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

        if (paymentType == PaymentType.ETH && costAmount > MAX_WEI_COST)
            revert InvalidWeiCost();

        address originator = service.originator;
        if (originator != msg.sender) revert InvalidOriginator();

        uint256 nonce = $.servicesNonce;
        $.services[nonce].enabled = true;
        $.services[nonce].serviceType = serviceType;
        $.services[nonce].visibilityId = visibilityId;
        $.services[nonce].creditsCostAmount = paymentType ==
            PaymentType.VISIBILITY_CREDITS
            ? costAmount
            : 0;
        $.services[nonce].executionsNonce = 0;
        $.services[nonce].originator = msg.sender;

        $.services[nonce].paymentType = paymentType;
        $.services[nonce].buyBackCreditsShare = buyBackCreditsShare;
        $.services[nonce].weiCostAmount = paymentType == PaymentType.ETH
            ? costAmount
            : 0;

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
        } else {
            revert InvalidPaymentType();
        }

        service.enabled = false;
        emit ServiceUpdated(serviceNonce, false);
    }

    /**
     * @notice Updates the status of an existing service. Can only be called by the service originator.
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

        PaymentType paymentType = service.paymentType;
        if (paymentType != PaymentType.ETH) revert InvalidPaymentType();

        string memory visibilityId = service.visibilityId;
        (address creator, , ) = $.visibilityCredits.getVisibility(visibilityId);

        if (creator != msg.sender) revert InvalidCreator();

        service.buyBackCreditsShare = buyBackCreditsShare;

        emit ServiceBuyBackUpdated(serviceNonce, buyBackCreditsShare);
    }

    /**
     * @notice Requests execution of a service. Transfers credits from the requester to the contract.
     *
     * @param serviceNonce The ID of the service.
     * @param requestData The data related to the request.
     */
    function requestServiceExecution(
        uint256 serviceNonce,
        string calldata requestData
    ) external payable {
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
        VisibilityServicesStorage storage $ = _getVisibilityServicesStorage();

        Service storage service = $.services[serviceNonce];
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

        execution.state = ExecutionState.REFUNDED;
        execution.lastUpdateTimestamp = block.timestamp;

        /// @dev: We update state before refunding to prevent re-entrancy
        _proceedRefund(serviceNonce, executionNonce);

        emit ServiceExecutionCanceled(
            serviceNonce,
            executionNonce,
            msg.sender,
            cancelData
        );
    }

    /**
     * @notice Validates a service execution.
     * Can only be called by the requester or by anyone after a delay for service with VISIBILITY_CREDITS payment.
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

        PaymentType paymentType = service.paymentType;

        if (paymentType != PaymentType.VISIBILITY_CREDITS)
            revert InvalidPaymentType();

        if (execution.state != ExecutionState.ACCEPTED)
            revert InvalidExecutionState();

        (address creator, , ) = $.visibilityCredits.getVisibility(
            service.visibilityId
        );
        if (creator == address(0)) revert InvalidCreator();

        if (
            !(execution.requester == msg.sender ||
                (AUTO_VALIDATION_DELAY + execution.lastUpdateTimestamp <
                    block.timestamp))
        ) revert UnauthorizedExecutionAction();

        execution.state = ExecutionState.VALIDATED;
        execution.lastUpdateTimestamp = block.timestamp;

        $.visibilityCredits.transferCredits(
            service.visibilityId,
            address(this),
            creator,
            service.creditsCostAmount
        );

        emit ServiceExecutionValidated(serviceNonce, executionNonce);
    }

    /**
     * @notice Validates a service execution.
     * Can only be called by the requester or by anyone after a delay for service with ETH payment.
     *
     * @param serviceNonce The ID of the service.
     * @param executionNonce The ID of the execution.
     * @param expectedCreditsAmount Required if refund is false. The expected amount of credits to buy back (to prevent frontrun/slippage, to get previously with {buyBackCreditsQuote} ).
     */
    function validateServiceExecutionFromEthPayment(
        uint256 serviceNonce,
        uint256 executionNonce,
        uint256 expectedCreditsAmount
    ) external {
        VisibilityServicesStorage storage $ = _getVisibilityServicesStorage();

        Service storage service = $.services[serviceNonce];
        Execution storage execution = service.executions[executionNonce];

        PaymentType paymentType = service.paymentType;

        if (paymentType != PaymentType.ETH) revert InvalidPaymentType();

        if (execution.state != ExecutionState.ACCEPTED)
            revert InvalidExecutionState();

        (address creator, , ) = $.visibilityCredits.getVisibility(
            service.visibilityId
        );
        if (creator == address(0)) revert InvalidCreator();

        if (
            !(execution.requester == msg.sender ||
                (AUTO_VALIDATION_DELAY + execution.lastUpdateTimestamp <
                    block.timestamp))
        ) revert UnauthorizedExecutionAction();

        execution.state = ExecutionState.VALIDATED;
        execution.lastUpdateTimestamp = block.timestamp;

        _proceedBuyback(serviceNonce, executionNonce, expectedCreditsAmount);

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
     * @notice Resolves a disputed service execution. Can only be called by the dispute resolver and for service with ETH payment.
     *
     * @param serviceNonce The ID of the service.
     * @param executionNonce The ID of the execution.
     * @param refund Whether the resolution includes a refund.
     * @param resolveData The data related to the resolution.
     * @param expectedCreditsAmount Required if refund is false. The expected amount of credits to buy back (to prevent frontrun/slippage, to get previously with {buyBackCreditsQuote} ).
     */
    function resolveServiceExecutionFromEthPayment(
        uint256 serviceNonce,
        uint256 executionNonce,
        bool refund,
        string calldata resolveData,
        uint256 expectedCreditsAmount
    ) external onlyRole(DISPUTE_RESOLVER_ROLE) {
        VisibilityServicesStorage storage $ = _getVisibilityServicesStorage();

        Service storage service = $.services[serviceNonce];
        Execution storage execution = service.executions[executionNonce];

        PaymentType paymentType = service.paymentType;

        if (paymentType != PaymentType.ETH) revert InvalidPaymentType();

        if (execution.state != ExecutionState.DISPUTED)
            revert InvalidExecutionState();

        (address creator, , ) = $.visibilityCredits.getVisibility(
            service.visibilityId
        );

        if (creator == address(0)) revert InvalidCreator();

        if (refund) {
            /// @dev: We update state before refunding to prevent re-entrancy
            execution.state = ExecutionState.REFUNDED;
            _proceedRefund(serviceNonce, executionNonce);
        } else {
            /// @dev: We update state before payment to prevent re-entrancy
            execution.state = ExecutionState.VALIDATED;

            _proceedBuyback(
                serviceNonce,
                executionNonce,
                expectedCreditsAmount
            );
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
     * @notice Resolves a disputed service execution. Can only be called by the dispute resolver and for service with VISIBILITY_CREDITS payment.
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
        VisibilityServicesStorage storage $ = _getVisibilityServicesStorage();

        Service storage service = $.services[serviceNonce];
        Execution storage execution = service.executions[executionNonce];

        PaymentType paymentType = service.paymentType;

        if (paymentType != PaymentType.VISIBILITY_CREDITS)
            revert InvalidPaymentType();

        if (execution.state != ExecutionState.DISPUTED)
            revert InvalidExecutionState();

        (address creator, , ) = $.visibilityCredits.getVisibility(
            service.visibilityId
        );

        if (creator == address(0)) revert InvalidCreator();

        if (refund) {
            /// @dev: We update state before refunding to prevent re-entrancy
            execution.state = ExecutionState.REFUNDED;
            _proceedRefund(serviceNonce, executionNonce);
        } else {
            /// @dev: We update state before payment to prevent re-entrancy
            execution.state = ExecutionState.VALIDATED;
            $.visibilityCredits.transferCredits(
                service.visibilityId,
                address(this),
                creator,
                service.creditsCostAmount
            );
        }

        execution.lastUpdateTimestamp = block.timestamp;

        emit ServiceExecutionResolved(
            serviceNonce,
            executionNonce,
            refund,
            resolveData
        );
    }

    function buyBackCreditsQuote(
        uint256 serviceNonce
    )
        public
        view
        returns (
            uint256 protocolAmount,
            uint256 creatorAmount,
            uint256 creditsAmount,
            uint256 totalCost
        )
    {
        VisibilityServicesStorage storage $ = _getVisibilityServicesStorage();

        Service storage service = $.services[serviceNonce];
        string memory visibilityId = service.visibilityId;

        PaymentType paymentType = service.paymentType;

        if (paymentType == PaymentType.ETH) {
            uint256 buyBackCreditsShare = service.buyBackCreditsShare;
            uint256 weiCostAmount = service.weiCostAmount;

            protocolAmount = (weiCostAmount * PROTOCOL_FEE) / FEE_DENOMINATOR;

            uint256 buyBackAmount = (weiCostAmount * buyBackCreditsShare) /
                FEE_DENOMINATOR;

            uint256 low = 1;
            uint256 high = MAX_NB_CREDITS;

            while (low <= high) {
                uint256 mid = (low + high) / 2;
                (uint256 _totalCost, ) = $.visibilityCredits.buyCostWithFees(
                    visibilityId,
                    mid,
                    address(this),
                    address(0)
                );
                totalCost = _totalCost;

                if (totalCost > buyBackAmount) {
                    high = mid - 1;
                } else {
                    creditsAmount = mid;
                    low = mid + 1;
                }
            }

            creatorAmount = weiCostAmount - protocolAmount - totalCost;
        } else {
            revert InvalidPaymentType();
        }
    }

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
            uint256 executionsNonce
        )
    {
        VisibilityServicesStorage storage $ = _getVisibilityServicesStorage();
        Service storage service = $.services[serviceNonce];
        return (
            service.enabled,
            service.serviceType,
            service.visibilityId,
            service.creditsCostAmount,
            service.executionsNonce
        );
    }

    function getServiceWithEthPayment(
        uint256 serviceNonce
    )
        external
        view
        returns (
            bool enabled,
            string memory serviceType,
            string memory visibilityId,
            uint256 buyBackCreditsShare,
            uint256 weiCostAmount,
            uint256 executionsNonce
        )
    {
        VisibilityServicesStorage storage $ = _getVisibilityServicesStorage();
        Service storage service = $.services[serviceNonce];
        return (
            service.enabled,
            service.serviceType,
            service.visibilityId,
            service.buyBackCreditsShare,
            service.weiCostAmount,
            service.executionsNonce
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

    /***************
     * PRIVATE FUNCTIONS
     * ************/

    function _proceedRefund(
        uint256 serviceNonce,
        uint256 executionNonce
    ) private {
        VisibilityServicesStorage storage $ = _getVisibilityServicesStorage();

        Service storage service = $.services[serviceNonce];
        Execution storage execution = service.executions[executionNonce];

        PaymentType paymentType = service.paymentType;

        if (paymentType == PaymentType.VISIBILITY_CREDITS) {
            $.visibilityCredits.transferCredits(
                service.visibilityId,
                address(this),
                execution.requester,
                service.creditsCostAmount
            );
        } else if (paymentType == PaymentType.ETH) {
            Address.sendValue(
                payable(execution.requester),
                service.weiCostAmount
            );
        } else {
            revert InvalidPaymentType();
        }
    }

    function _proceedBuyback(
        uint256 serviceNonce,
        uint256 executionNonce,
        uint256 expectedCreditsAmount
    ) private {
        VisibilityServicesStorage storage $ = _getVisibilityServicesStorage();

        Service storage service = $.services[serviceNonce];

        (address creator, , ) = $.visibilityCredits.getVisibility(
            service.visibilityId
        );
        if (creator == address(0)) revert InvalidCreator();

        address protocolTreasury = $.visibilityCredits.getProtocolTreasury();
        if (protocolTreasury == address(0)) revert InvalidProtocolTreasury();

        string memory visibilityId = service.visibilityId;

        (
            uint256 protocolAmount,
            uint256 creatorAmount,
            uint256 creditsAmount,
            uint256 totalCost
        ) = buyBackCreditsQuote(serviceNonce);

        /// @dev: We check the expected amount of credits to prevent frontrun/slippage
        if (creditsAmount < expectedCreditsAmount) revert QuoteSlippage();

        if (creditsAmount > 0) {
            uint256 creditsAmountBefore = $
                .visibilityCredits
                .getVisibilityCreditBalance(visibilityId, address(this));

            $.visibilityCredits.buyCredits{value: totalCost}(
                visibilityId,
                creditsAmount,
                address(0)
            );

            uint256 creditsAmountAfter = $
                .visibilityCredits
                .getVisibilityCreditBalance(visibilityId, address(this));

            /// @dev: We check the expected amount of credits has been bought
            if (creditsAmountAfter - creditsAmountBefore != creditsAmount)
                revert QuoteSlippage();

            emit BuyBack(
                serviceNonce,
                executionNonce,
                visibilityId,
                totalCost,
                creditsAmount
            );
        }

        Address.sendValue(payable(protocolTreasury), protocolAmount);
        Address.sendValue(payable(creator), creatorAmount);
    }
}
