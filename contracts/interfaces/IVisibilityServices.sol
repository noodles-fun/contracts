// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IVisibilityServices {
    enum PaymentType {
        VISIBILITY_CREDITS, // Legacy => 0 (default)
        ETH
        // ERC20 => further implementation
    }

    enum ExecutionState {
        UNINITIALIZED,
        REQUESTED,
        ACCEPTED,
        DISPUTED,
        REFUNDED,
        VALIDATED
    }

    struct Execution {
        ExecutionState state; // Current state of the execution
        address requester; // Address that requested the service execution
        uint256 lastUpdateTimestamp; // Timestamp of the last state update
    }

    struct Service {
        bool enabled; // Indicates if the service is active, if it can be requested
        string serviceType; // Service type identifier (e.g., "x-post" for post publication)
        string visibilityId; // Visibility identifier (e.g., "x-807982663000674305" for specific accounts)
        uint256 creditsCostAmount; // Cost in credits for the service, if paymentType is VISIBILITY_CREDITS
        uint256 executionsNonce; // Counter for execution IDs
        mapping(uint256 => Execution) executions; // Mapping of executions by nonce
        address originator; // Address that created the service
        //
        /// @dev Added to support ETH payment, force to a new slot
        uint256 weiCostAmount; // Cost in WEI for the service, if paymentType is ETH
        uint256 buyBackCreditsShare; // How much of the ETH payment is used to buy back credits
        PaymentType paymentType; // Payment type for the service
    }

    struct BuyBackPools {
        mapping(string visibilityId => uint256) buyBackEthBalances; // ETH balance (in wei), added to support shares buy back
    }

    event BuyBack(
        string visibilityId,
        uint256 totalWeiCost,
        uint256 creditsAmount
    );

    event BuyBackPoolUpdated(
        string visibilityId,
        bool isBuyBack,
        uint256 weiAmount
    );

    event ServiceCreated(
        address indexed originator,
        uint256 indexed nonce,
        string serviceType,
        string visibilityId,
        uint256 creditsCostAmount
    );

    event ServiceWithETHCreated(
        address indexed originator,
        uint256 indexed nonce,
        string serviceType,
        string visibilityId,
        uint256 buyBackCreditsShare,
        uint256 weiCostAmount
    );

    event ServiceUpdated(uint256 indexed nonce, bool enabled);

    event ServiceBuyBackUpdated(
        uint256 indexed nonce,
        uint256 buyBackCreditsShare
    );

    event ServiceExecutionRequested(
        uint256 indexed serviceNonce,
        uint256 indexed executionNonce,
        address indexed requester,
        string requestData
    );

    event ServiceExecutionInformation(
        uint256 indexed serviceNonce,
        uint256 indexed executionNonce,
        address indexed user,
        bool fromCreator,
        bool fromRequester,
        bool fromDisputeResolver,
        string informationData
    );

    event ServiceExecutionCanceled(
        uint256 indexed serviceNonce,
        uint256 indexed executionNonce,
        address indexed from,
        string cancelData
    );

    event ServiceExecutionAccepted(
        uint256 indexed serviceNonce,
        uint256 indexed executionNonce,
        string responseData
    );

    event ServiceExecutionValidated(
        uint256 indexed serviceNonce,
        uint256 indexed executionNonce
    );

    event ServiceExecutionEthPayment(
        uint256 indexed serviceNonce,
        uint256 protocolAmount,
        uint256 creatorAmount,
        uint256 buyBackAmount
    );

    event ServiceExecutionDisputed(
        uint256 indexed serviceNonce,
        uint256 indexed executionNonce,
        string disputeData
    );

    event ServiceExecutionResolved(
        uint256 indexed serviceNonce,
        uint256 indexed executionNonce,
        bool refund,
        string resolveData
    );

    error DisabledService();
    error InvalidAddress();
    error InvalidBuyBackCreditsShare();
    error InvalidCreator();
    error InvalidExecutionNonce();
    error InvalidExecutionState();
    error InvalidOriginator();
    error InvalidPaymentType();
    error InvalidPayloadDataSize();
    error InvalidProtocolTreasury();
    error InsufficientValue();
    error QuoteSlippage();
    error UnauthorizedExecutionAction();

    function createService(
        string memory serviceType,
        string memory visibilityId,
        uint256 creditsCostAmount
    ) external;

    function createServiceWithETH(
        string memory serviceType,
        string memory visibilityId,
        uint256 buyBackCreditsShare,
        uint256 weiCostAmount
    ) external;

    function createAndUpdateFromService(
        uint256 serviceNonce,
        uint256 costAmount
    ) external;

    function requestServiceExecution(
        uint256 serviceNonce,
        string calldata requestData
    ) external payable;

    function addInformationForServiceExecution(
        uint256 serviceNonce,
        uint256 executionNonce,
        string calldata informationData
    ) external;

    function acceptServiceExecution(
        uint256 serviceNonce,
        uint256 executionNonce,
        string calldata responseData
    ) external;

    function cancelServiceExecution(
        uint256 serviceNonce,
        uint256 executionNonce,
        string calldata cancelData
    ) external;

    function validateServiceExecution(
        uint256 serviceNonce,
        uint256 executionNonce
    ) external;

    function disputeServiceExecution(
        uint256 serviceNonce,
        uint256 executionNonce,
        string calldata disputeData
    ) external;

    function resolveServiceExecution(
        uint256 serviceNonce,
        uint256 executionNonce,
        bool refund,
        string calldata resolveData
    ) external;

    function updateService(uint256 serviceNonce, bool enabled) external;

    function updateBuyBackCreditsShare(
        uint256 serviceNonce,
        uint256 buyBackCreditsShare
    ) external;

    function buyBack(
        string memory visibilityId,
        uint256 creditsAmount,
        uint256 maxWeiAmount
    ) external;

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
        );

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
        );

    function getVisibilityCreditsContract() external view returns (address);

    function getVisibilityBuyBackEthBalance(
        string calldata visibilityId
    ) external view returns (uint256);
}
