// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IVisibilityServices {
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
        uint256 lastUpdateTimestamp;
    }

    struct Service {
        bool enabled; // Indicates if the service is active, if it can be requested
        string serviceType; // Service type identifier (e.g., "x-post" for post publication)
        string visibilityId; // Visibility identifier (e.g., "x-807982663000674305" for specific accounts)
        uint256 creditsCostAmount; // Cost in credits for the service
        uint256 executionsNonce; // Counter for execution IDs
        mapping(uint256 => Execution) executions; // Mapping of executions by nonce
    }

    event ServiceCreated(
        uint256 indexed nonce,
        string serviceType,
        string visibilityId,
        uint256 creditsCostAmount
    );
    event ServiceUpdated(uint256 indexed nonce, bool enabled);
    event ServiceExecutionRequested(
        uint256 indexed serviceNonce,
        uint256 indexed executionNonce,
        address indexed requester,
        string requestData
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
    error InvalidCreator();
    error InvalidExecutionState();
    error UnauthorizedExecutionAction();

    function createService(
        string memory serviceType,
        string memory visibilityId,
        uint256 creditsCostAmount
    ) external;

    function createAndUpdateFromService(
        uint256 serviceNonce,
        uint256 creditsCostAmount
    ) external;

    function updateService(uint256 serviceNonce, bool enabled) external;

    function requestServiceExecution(
        uint256 serviceNonce,
        string calldata requestData
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
}
