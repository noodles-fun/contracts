// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IVisibilityCredits {
    struct CreditsTradeEvent {
        address from;
        string visibilityId;
        uint256 amount;
        bool isBuy;
        uint256 tradeCost;
        uint256 creatorFee;
        uint256 protocolFee;
        uint256 referrerFee;
        uint256 partnerFee;
        address referrer;
        address partner;
        uint256 newTotalSupply;
    }

    struct Trade {
        uint256 tradeCost;
        uint256 creatorFee;
        uint256 protocolFee;
        uint256 referrerFee;
        uint256 partnerFee;
        address referrer;
        address partner;
    }

    struct Visibility {
        address creator;
        uint256 totalSupply;
        uint256 claimableFeeBalance;
        mapping(address => uint256) creditBalances;
    }

    event CreatorFeeClaimed(address indexed creator, uint256 amount);
    event CreatorVisibilitySet(
        string visibilityId,
        address creator,
        string metadata
    );
    event CreditsTrade(CreditsTradeEvent tradeEvent);
    event CreditsTransfer(
        string visibilityId,
        address indexed from,
        address indexed to,
        uint256 amount
    );
    event ReferrerPartnerSet(address referrer, address partner);

    error InvalidAddress();
    error InvalidCreator();
    error InvalidAmount();
    error NotEnoughEthSent();
    error NotEnoughCreditsOwned();

    function buyCredits(
        string calldata visibilityId,
        uint256 amount,
        address inputReferrer
    ) external payable;

    function sellCredits(
        string calldata visibilityId,
        uint256 amount,
        address inputReferrer
    ) external;

    function claimCreatorFee(string calldata visibilityId) external;

    function setCreatorVisibility(
        string calldata visibilityId,
        address creator,
        string calldata metadata
    ) external;

    function setReferrerPartner(address referrer, address partner) external;

    function transferCredits(
        string calldata visibilityId,
        address from,
        address to,
        uint256 amount
    ) external;

    function updateTreasury(address treasury) external;

    function getProtocolTreasury() external view returns (address);

    function getReferrerPartner(
        address referrer
    ) external view returns (address);

    function getUserReferrer(address user) external view returns (address);

    function getVisibility(
        string calldata visibilityId
    )
        external
        view
        returns (
            address creator,
            uint256 totalSupply,
            uint256 claimableFeeBalance
        );

    function getVisibilityCreditBalance(
        string calldata visibilityId,
        address account
    ) external view returns (uint256);

    function getVisibilityKey(
        string calldata visibilityId
    ) external pure returns (bytes32);

    function buyCostWithFees(
        string calldata visibilityId,
        uint256 amount,
        address user,
        address inputReferrer
    ) external view returns (uint256 totalCost, Trade memory trade);

    function sellCostWithFees(
        string calldata visibilityId,
        uint256 amount,
        address user,
        address inputReferrer
    ) external view returns (uint256 reimbursement, Trade memory trade);
}
