// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/extensions/AccessControlDefaultAdminRulesUpgradeable.sol";
import "./interfaces/IVisibilityCredits.sol";
import "./interfaces/IVisibilityServices.sol";

/**
 * @title VisibilityServices
 * @notice Allows users to spend creator credits (from IVisibilityCredits), for ad purposes.
 */
contract VisibilityServices is
    AccessControlDefaultAdminRulesUpgradeable,
    IVisibilityServices
{
    uint256 public constant AUTO_VALIDATION_DELAY = 5 days;

    bytes32 public constant DISPUTE_RESOLVER_ROLE =
        keccak256("DISPUTE_RESOLVER_ROLE");

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
     * @notice Creates a new service.
     *
     * @param serviceType The type of the service.
     * @param visibilityId The visibility ID associated with the service.
     * @param creditsCostAmount The cost in credits for the service.
     */
    function createService(
        string memory serviceType,
        string memory visibilityId,
        uint256 creditsCostAmount
    ) external {
        VisibilityServicesStorage storage $ = _getVisibilityServicesStorage();
        (address creator, , ) = $.visibilityCredits.getVisibility(visibilityId);
        if (creator != msg.sender) revert InvalidCreator();

        uint256 nonce = $.servicesNonce;
        $.services[nonce].enabled = true;
        $.services[nonce].serviceType = serviceType;
        $.services[nonce].visibilityId = visibilityId;
        $.services[nonce].creditsCostAmount = creditsCostAmount;
        $.services[nonce].executionsNonce = 0;

        $.servicesNonce += 1;

        emit ServiceCreated(
            nonce,
            serviceType,
            visibilityId,
            creditsCostAmount
        );
    }

    /**
     * @notice Updates the status of an existing service. Can only be called by the creator linked to the visibility ID.
     *
     * @param serviceNonce The ID of the service to update.
     * @param enabled The new status of the service (true for enabled, false for disabled).
     */
    function updateService(uint256 serviceNonce, bool enabled) external {
        VisibilityServicesStorage storage $ = _getVisibilityServicesStorage();

        Service storage service = $.services[serviceNonce];
        string memory visibilityId = service.visibilityId;

        (address creator, , ) = $.visibilityCredits.getVisibility(visibilityId);
        if (creator != msg.sender) revert InvalidCreator();

        service.enabled = enabled;
        emit ServiceUpdated(serviceNonce, enabled);
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
    ) external {
        VisibilityServicesStorage storage $ = _getVisibilityServicesStorage();

        Service storage service = $.services[serviceNonce];
        if (!service.enabled) revert DisabledService();

        uint256 executionNonce = service.executionsNonce;
        service.executions[executionNonce].state = ExecutionState.REQUESTED;
        service.executions[executionNonce].requester = msg.sender;
        service.executions[executionNonce].lastUpdateTimestamp = block
            .timestamp;

        service.executionsNonce += 1;
        $.visibilityCredits.transferCredits(
            service.visibilityId,
            msg.sender,
            address(this),
            service.creditsCostAmount
        ); // revert if not enough credits

        emit ServiceExecutionRequested(
            serviceNonce,
            executionNonce,
            msg.sender,
            requestData
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

        $.visibilityCredits.transferCredits(
            visibilityId,
            address(this),
            requester,
            service.creditsCostAmount
        );

        emit ServiceExecutionCanceled(
            serviceNonce,
            executionNonce,
            msg.sender,
            cancelData
        );
    }

    /**
     * @notice Validates a service execution. Can only be called by the requester or by anyone after a delay.
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

        (address creator, , ) = $.visibilityCredits.getVisibility(
            service.visibilityId
        );

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
     * @notice Resolves a disputed service execution. Can only be called by the dispute resolver.
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

        if (execution.state != ExecutionState.DISPUTED)
            revert InvalidExecutionState();

        if (refund) {
            execution.state = ExecutionState.REFUNDED;
            $.visibilityCredits.transferCredits(
                service.visibilityId,
                address(this),
                execution.requester,
                service.creditsCostAmount
            );
        } else {
            execution.state = ExecutionState.VALIDATED;
            (address creator, , ) = $.visibilityCredits.getVisibility(
                service.visibilityId
            );
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
}
