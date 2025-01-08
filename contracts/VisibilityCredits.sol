// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts-upgradeable/access/extensions/AccessControlDefaultAdminRulesUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "./interfaces/IVisibilityCredits.sol";

/**
 * @title VisibilityCredits
 * @notice Allows users to buy and sell visibility credits along a bonding curve.
 * @dev Users can spend these credits for ad purposes.
 */
contract VisibilityCredits is
    IVisibilityCredits,
    AccessControlDefaultAdminRulesUpgradeable,
    ReentrancyGuardUpgradeable
{
    /**
     * @notice Users can purchase and sell visibility credits according to a bonding curve.
     *
     * @dev The bonding curve is defined by the formula:
     *        PRICE = BASE_PRICE + A * totalSupply^2 + B * totalSupply
     *      - BASE_PRICE: The initial price when totalSupply is zero.
     *      - A: Bonding curve quadratic factor, a constant that determine the curvature of the price function
     *      - B: Bonding curve linear factor, a constant that determine the slope of the price function
     */
    uint64 public constant A = 15_000_000_000; // 0.000000015 ether;
    uint64 public constant B = 25_000_000_000_000; // 0.000025 ether;
    uint64 public constant BASE_PRICE = 10_000_000_000_000_000; // 0.01 ether;

    /// @dev to avoid overflow on bonding curve computations
    uint64 public constant MAX_TOTAL_SUPPLY = type(uint64).max; // 2^64 - 1 = 18_446_744_073_709_551_615

    /// @notice Fee percentages in ppm (parts per million).
    uint32 public constant FEE_DENOMINATOR = 1_000_000; // Using parts per million (ppm)
    uint16 public constant CREATOR_FEE = 20_000; // 2% fee to the creator for each trade
    uint16 public constant PROTOCOL_FEE = 30_000; // 3% base fee, should be higher than referrer fee + partner fee + referral bonus fee
    uint16 public constant REFERRER_FEE = 10_000; // 1% fee to the referrer (if any, deduced from protocol fee)
    uint8 public constant PARTNER_FEE = 250; // 0.25% bonus for the partner/marketing agency if linked to a referrer (deduced from protocol fee)
    uint8 public constant PARTNER_REFERRER_BONUS = 250; // 0.25% bonus for the referrer if linked to a partner (deduced from protocol fee)

    bytes32 public constant CREDITS_TRANSFER_ROLE =
        keccak256("CREDITS_TRANSFER_ROLE");
    bytes32 public constant CREATORS_LINKER_ROLE =
        keccak256("CREATORS_LINKER_ROLE");
    bytes32 public constant PARTNERS_LINKER_ROLE =
        keccak256("PARTNERS_LINKER_ROLE");

    /// @custom:storage-location erc7201:noodles.VisibilityCredits
    struct VisibilityCreditsStorage {
        address payable protocolTreasury;
        /**
         * @notice Referrers can be linked to partners/marketing agencies to receive a fee bonus.
         *         The bonus is a percentage of the trading cost, deducted from the protocol fee.
         *         The bonus is split between the referrer and the partner.
         * @dev referrer address => partner address
         */
        mapping(address => address) referrersToPartners;
        /**
         * @notice Record the last referral for each user. The referral still receives a bonus until the user trades with a new referrer.
         *         The bonus is a percentage of the trading cost, deducted from the protocol fee.
         * @dev user address => referrer address
         */
        mapping(address => address) usersToReferrers;
        /**
         * @notice This contract is agnostic to specific visibility interfaces.
         *         We define a naming convention for visibility IDs: `{platformPrefix}-{immutableId}`.
         *         For example, `x-807982663000674305` links visibility credits to Luca Netz's X (formerly Twitter, rest_id = 807982663000674305) account.
         *         This approach allows for easy extension to other platforms by using different prefixes.
         *
         * @dev Access a creator's visibility information using `visibilityCredits[visibilityId]`, where:
         *      `bytes32 visibilityId = keccak256(abi.encode(visibilityIdString));`
         */
        mapping(bytes32 => Visibility) visibilityCredits;
    }

    // keccak256(abi.encode(uint256(keccak256("noodles.VisibilityCredits")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant VisibilityCreditsStorageLocation =
        0x8b198ca743c7949447acc2a3ece04f744837fdfd02f0b1dab89bda5a49167b00;

    function _getVisibilityCreditsStorage()
        private
        pure
        returns (VisibilityCreditsStorage storage $)
    {
        assembly {
            $.slot := VisibilityCreditsStorageLocation
        }
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initializes the contract with the protocol treasury, a creators linker and a partners linker.
     * @param adminDelay The delay for admin role changes.
     * @param admin The address than can manage with admin role.
     * @param creatorsLinker The address that can set a creator address for a specific visibility ID.
     * @param partnersLinker The address that can set a partner address for a referrer address.
     * @param treasury The address of the protocol treasury.
     *
     * @dev Contract deployer is the default admin (`DEFAULT_ADMIN_ROLE`) at deployment.
     *      The `AccessControlDefaultAdminRules` contract manages admin access with a delay for changes.
     */
    function initialize(
        uint48 adminDelay,
        address admin,
        address creatorsLinker,
        address partnersLinker,
        address treasury
    ) public initializer {
        if (admin == address(0)) revert InvalidAddress();
        if (creatorsLinker == address(0)) revert InvalidAddress();
        if (partnersLinker == address(0)) revert InvalidAddress();
        if (treasury == address(0)) revert InvalidAddress();

        VisibilityCreditsStorage storage $ = _getVisibilityCreditsStorage();
        $.protocolTreasury = payable(treasury);

        __AccessControlDefaultAdminRules_init_unchained(adminDelay, admin);
        _grantRole(CREATORS_LINKER_ROLE, creatorsLinker);
        _grantRole(PARTNERS_LINKER_ROLE, partnersLinker);

        __ReentrancyGuard_init_unchained();
    }

    /**
     * @notice Buys a specified amount of visibility credits.
     * @dev Users must send sufficient Ether to cover the cost from bonding curve + fees.
     * @param visibilityId The ID representing the visibility credits.
     * @param amount The amount of credits to buy.
     * @param inputReferrer The address of the referrer (optional).
     */
    function buyCredits(
        string calldata visibilityId,
        uint256 amount,
        address inputReferrer
    ) external payable nonReentrant {
        VisibilityCreditsStorage storage $ = _getVisibilityCreditsStorage();

        Visibility storage visibility = $.visibilityCredits[
            getVisibilityKey(visibilityId)
        ];

        uint256 totalSupply = visibility.totalSupply;

        if (totalSupply + amount > MAX_TOTAL_SUPPLY) {
            revert InvalidAmount();
        }

        Trade memory trade = _tradeCostWithFees(
            totalSupply,
            amount,
            true,
            msg.sender,
            inputReferrer
        );

        uint256 totalCost = trade.tradeCost +
            trade.creatorFee +
            trade.protocolFee +
            trade.referrerFee +
            trade.partnerFee;

        if (msg.value < totalCost) {
            revert NotEnoughEthSent();
        }

        totalSupply += amount;

        visibility.totalSupply = totalSupply;
        visibility.claimableFeeBalance += trade.creatorFee;
        visibility.creditBalances[msg.sender] += amount;

        if (trade.referrer != $.usersToReferrers[msg.sender]) {
            $.usersToReferrers[msg.sender] = trade.referrer;
        }

        if (trade.referrerFee > 0) {
            Address.sendValue(payable(trade.referrer), trade.referrerFee);
        }

        if (trade.partnerFee > 0) {
            Address.sendValue(payable(trade.partner), trade.partnerFee);
        }

        Address.sendValue($.protocolTreasury, trade.protocolFee);

        // Refund excess Ether sent
        if (msg.value > totalCost) {
            Address.sendValue(payable(msg.sender), msg.value - totalCost);
        }

        CreditsTradeEvent memory tradeEvent = CreditsTradeEvent({
            from: msg.sender,
            visibilityId: visibilityId,
            amount: amount,
            isBuy: true,
            tradeCost: trade.tradeCost,
            creatorFee: trade.creatorFee,
            protocolFee: trade.protocolFee,
            referrerFee: trade.referrerFee,
            partnerFee: trade.partnerFee,
            referrer: trade.referrer,
            partner: trade.partner,
            newTotalSupply: totalSupply
        });

        emit CreditsTrade(tradeEvent);
    }

    /**
     * @notice Sells a specified amount of visibility credits.
     * @dev Users receive Ether minus applicable fees.
     * @param visibilityId The ID representing the visibility credits.
     * @param amount The amount of credits to sell.
     * @param inputReferrer The address of the referrer (optional).
     */
    function sellCredits(
        string calldata visibilityId,
        uint256 amount,
        address inputReferrer
    ) external nonReentrant {
        VisibilityCreditsStorage storage $ = _getVisibilityCreditsStorage();
        Visibility storage visibility = $.visibilityCredits[
            getVisibilityKey(visibilityId)
        ];

        if (visibility.creditBalances[msg.sender] < amount) {
            revert NotEnoughCreditsOwned();
        }

        uint256 totalSupply = visibility.totalSupply;

        Trade memory trade = _tradeCostWithFees(
            totalSupply,
            amount,
            false,
            msg.sender,
            inputReferrer
        );

        uint256 reimbursement = trade.tradeCost -
            trade.creatorFee -
            trade.protocolFee -
            trade.referrerFee -
            trade.partnerFee;

        totalSupply -= amount;

        visibility.totalSupply = totalSupply;
        visibility.claimableFeeBalance += trade.creatorFee;
        visibility.creditBalances[msg.sender] -= amount;

        if (trade.referrer != $.usersToReferrers[msg.sender]) {
            $.usersToReferrers[msg.sender] = trade.referrer;
        }

        if (trade.referrerFee > 0) {
            Address.sendValue(payable(trade.referrer), trade.referrerFee);
        }

        if (trade.partnerFee > 0) {
            Address.sendValue(payable(trade.partner), trade.partnerFee);
        }

        Address.sendValue($.protocolTreasury, trade.protocolFee);

        Address.sendValue(payable(msg.sender), reimbursement);

        CreditsTradeEvent memory tradeEvent = CreditsTradeEvent({
            from: msg.sender,
            visibilityId: visibilityId,
            amount: amount,
            isBuy: false,
            tradeCost: trade.tradeCost,
            creatorFee: trade.creatorFee,
            protocolFee: trade.protocolFee,
            referrerFee: trade.referrerFee,
            partnerFee: trade.partnerFee,
            referrer: trade.referrer,
            partner: trade.partner,
            newTotalSupply: totalSupply
        });

        emit CreditsTrade(tradeEvent);
    }

    /**
     * @notice Allows creators to claim their accumulated fees.
     * @param visibilityId The ID representing the visibility credits.
     */
    function claimCreatorFee(
        string calldata visibilityId
    ) external nonReentrant {
        VisibilityCreditsStorage storage $ = _getVisibilityCreditsStorage();
        Visibility storage visibility = $.visibilityCredits[
            getVisibilityKey(visibilityId)
        ];

        uint256 claimableFeeBalance = visibility.claimableFeeBalance;

        if (claimableFeeBalance == 0) {
            revert InvalidAmount();
        }

        address creator = visibility.creator;

        if (creator == address(0)) {
            revert InvalidCreator();
        }

        visibility.claimableFeeBalance = 0;

        Address.sendValue(payable(creator), claimableFeeBalance);

        emit CreatorFeeClaimed(creator, claimableFeeBalance);
    }

    /**
     * @notice Grants the `CREDITS_TRANSFER_ROLE` to a specified account.
     * @dev Only callable by an account with the `DEFAULT_ADMIN_ROLE`.
     * @param grantee The address to grant the role. *
     */
    function grantCreatorTransferRole(
        address grantee
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _grantRole(CREDITS_TRANSFER_ROLE, grantee);
    }

    /**
     * @notice Sets the creator for a specific visibility ID.
     * @dev Only callable by an account with the `CREATORS_LINKER_ROLE`.
     * @param visibilityId The ID representing the visibility credits.
     * @param creator The address of the creator, can be address(0).
     * @param metadata Additional metadata for the creator.
     */
    function setCreatorVisibility(
        string calldata visibilityId,
        address creator,
        string calldata metadata
    ) external onlyRole(CREATORS_LINKER_ROLE) {
        VisibilityCreditsStorage storage $ = _getVisibilityCreditsStorage();
        Visibility storage visibility = $.visibilityCredits[
            getVisibilityKey(visibilityId)
        ];
        visibility.creator = creator;

        emit CreatorVisibilitySet(visibilityId, creator, metadata);
    }

    /**
     * @notice Sets the partner for a referrer
     * @dev Only callable by an account with the `PARTNERS_LINKER_ROLE`.
     * @param referrer The address of the referrer, cannot be address(0).
     * @param partner The address of the partner/marketing agency, can be address(0).
     */
    function setReferrerPartner(
        address referrer,
        address partner
    ) external onlyRole(PARTNERS_LINKER_ROLE) {
        VisibilityCreditsStorage storage $ = _getVisibilityCreditsStorage();
        if (referrer == address(0)) {
            revert InvalidAddress();
        }
        $.referrersToPartners[referrer] = partner;

        emit ReferrerPartnerSet(referrer, partner);
    }

    /**
     * @notice Transfers visibility credits between users.
     * @dev Only callable by an account with the `CREDITS_TRANSFER_ROLE`.
     * @param visibilityId The ID representing the visibility credits.
     * @param from The address to transfer credits from.
     * @param to The address to transfer credits to.
     * @param amount The amount of credits to transfer.
     */
    function transferCredits(
        string calldata visibilityId,
        address from,
        address to,
        uint256 amount
    ) external onlyRole(CREDITS_TRANSFER_ROLE) {
        VisibilityCreditsStorage storage $ = _getVisibilityCreditsStorage();
        Visibility storage visibility = $.visibilityCredits[
            getVisibilityKey(visibilityId)
        ];

        if (visibility.creditBalances[from] < amount) {
            revert NotEnoughCreditsOwned();
        }

        visibility.creditBalances[from] -= amount;
        visibility.creditBalances[to] += amount;

        emit CreditsTransfer(visibilityId, from, to, amount);
    }

    /**
     * @notice Updates the protocol treasury address.
     * @dev Only callable by an account with the `DEFAULT_ADMIN_ROLE`.
     * @param treasury The address of the new protocol treasury (cannot be address(0)).
     */
    function updateTreasury(
        address treasury
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        VisibilityCreditsStorage storage $ = _getVisibilityCreditsStorage();
        if (treasury == address(0)) {
            revert InvalidAddress();
        }
        $.protocolTreasury = payable(treasury);
    }

    function getProtocolTreasury() external view returns (address) {
        VisibilityCreditsStorage storage $ = _getVisibilityCreditsStorage();
        return $.protocolTreasury;
    }

    function getReferrerPartner(
        address referrer
    ) external view returns (address) {
        VisibilityCreditsStorage storage $ = _getVisibilityCreditsStorage();
        return $.referrersToPartners[referrer];
    }

    function getUserReferrer(address user) external view returns (address) {
        VisibilityCreditsStorage storage $ = _getVisibilityCreditsStorage();
        return $.usersToReferrers[user];
    }

    function getVisibility(
        string calldata visibilityId
    )
        external
        view
        returns (
            address creator,
            uint256 totalSupply,
            uint256 claimableFeeBalance
        )
    {
        VisibilityCreditsStorage storage $ = _getVisibilityCreditsStorage();
        Visibility storage visibility = $.visibilityCredits[
            getVisibilityKey(visibilityId)
        ];
        return (
            visibility.creator,
            visibility.totalSupply,
            visibility.claimableFeeBalance
        );
    }

    function getVisibilityCreditBalance(
        string calldata visibilityId,
        address account
    ) external view returns (uint256) {
        VisibilityCreditsStorage storage $ = _getVisibilityCreditsStorage();

        return
            $.visibilityCredits[getVisibilityKey(visibilityId)].creditBalances[
                account
            ];
    }

    function buyCostWithFees(
        string calldata visibilityId,
        uint256 amount,
        address user,
        address inputReferrer
    ) external view returns (uint256 totalCost, Trade memory trade) {
        VisibilityCreditsStorage storage $ = _getVisibilityCreditsStorage();
        uint256 totalSupply = $
            .visibilityCredits[getVisibilityKey(visibilityId)]
            .totalSupply;
        trade = _tradeCostWithFees(
            totalSupply,
            amount,
            true,
            user,
            inputReferrer
        );
        totalCost =
            trade.tradeCost +
            trade.creatorFee +
            trade.protocolFee +
            trade.referrerFee +
            trade.partnerFee;
    }

    function sellCostWithFees(
        string calldata visibilityId,
        uint256 amount,
        address user,
        address inputReferrer
    ) external view returns (uint256 reimbursement, Trade memory trade) {
        VisibilityCreditsStorage storage $ = _getVisibilityCreditsStorage();
        uint256 totalSupply = $
            .visibilityCredits[getVisibilityKey(visibilityId)]
            .totalSupply;

        trade = _tradeCostWithFees(
            totalSupply,
            amount,
            false,
            user,
            inputReferrer
        );

        reimbursement =
            trade.tradeCost -
            trade.creatorFee -
            trade.protocolFee -
            trade.referrerFee -
            trade.partnerFee;
    }

    function getVisibilityKey(
        string calldata visibilityId
    ) public pure returns (bytes32) {
        return keccak256(abi.encode(visibilityId));
    }

    function _tradeCostWithFees(
        uint256 totalSupply,
        uint256 amount,
        bool isBuy,
        address user,
        address inputReferrer
    ) private view returns (Trade memory trade) {
        VisibilityCreditsStorage storage $ = _getVisibilityCreditsStorage();

        if (!isBuy) {
            if (totalSupply < amount) {
                revert InvalidAmount();
            }
        }

        if (user == address(0)) {
            revert InvalidAddress();
        }

        uint256 fromSupply = isBuy ? totalSupply : totalSupply - amount;

        trade.tradeCost = _tradeCost(fromSupply, amount);

        trade.creatorFee = (trade.tradeCost * CREATOR_FEE) / FEE_DENOMINATOR;

        trade.referrer = inputReferrer != address(0)
            ? inputReferrer
            : $.usersToReferrers[user];

        trade.partner = trade.referrer != address(0)
            ? $.referrersToPartners[trade.referrer]
            : address(0);

        if (trade.partner != address(0)) {
            trade.partnerFee =
                (trade.tradeCost * PARTNER_FEE) /
                FEE_DENOMINATOR;
        }

        if (trade.referrer != address(0)) {
            trade.referrerFee = trade.partner != address(0)
                ? (trade.tradeCost * (REFERRER_FEE + PARTNER_REFERRER_BONUS)) /
                    FEE_DENOMINATOR
                : (trade.tradeCost * REFERRER_FEE) / FEE_DENOMINATOR;
        }

        trade.protocolFee =
            ((trade.tradeCost * PROTOCOL_FEE) / FEE_DENOMINATOR) -
            trade.referrerFee -
            trade.partnerFee;
    }

    /**
     * @dev Calculates the current price per visibility credit based on the total supply.
     * @param totalSupply The current total supply of visibility credits.
     * @return The current price per credit in wei.
     
    function _getCurrentPrice(
        uint256 totalSupply
    ) private pure returns (uint256) {
        // Compute the current price using the bonding curve formula
        return BASE_PRICE + (A * (totalSupply ** 2)) + (B * totalSupply);
    }
    */

    /**
     * @dev Calculates the total cost for buying or selling a given amount of credits
     *      based on the bonding curve. The cost is determined by summing the prices
     *      along the curve from the starting supply to the ending supply.
     *
     *      The calculation uses mathematical formulas for the sum of squares and
     *      the sum of natural numbers to efficiently compute the total cost without
     *      looping over each credit unit price.
     *
     *      For buying:
     *        - fromSupply = current total supply
     *        - toSupply = current total supply + amount - 1 = fromSupply + amount - 1
     *
     *      For selling:
     *        - fromSupply = current total supply - amount
     *        - toSupply = current total supply - 1 = fromSupply + amount - 1
     *
     *      Edge Case Handling:
     *        - When fromSupply is zero (e.g., initial purchase or selling all credits),
     *          special care is taken to avoid underflow in calculations.
     *
     * @param fromSupply The total supply of visibility credits before the trade if buying, or after the trade if selling.
     * @param amount The amount of credits to buy or sell.
     * @return The total cost in wei for the transaction.
     */
    function _tradeCost(
        uint256 fromSupply,
        uint256 amount
    ) private pure returns (uint256) {
        if (amount == 0) {
            revert InvalidAmount();
        }

        //  The ending index of the credit unit being considered.
        uint256 toSupply = fromSupply + amount - 1;

        uint256 sumSquares;
        uint256 sumFirstN;

        if (fromSupply == 0) {
            // S2(n) calculates the cumulative sum of squares from k = 1 to n:
            //   S2(n) = ∑_{k=1}^{n} k² = n(n + 1)(2n + 1) / 6
            sumSquares = (toSupply * (toSupply + 1) * (2 * toSupply + 1)) / 6;

            // S1(n) calculates the cumulative sum from k = 1 to n:
            //   S1(n) = ∑_{k=1}^{n} k = n(n + 1) / 2
            sumFirstN = (toSupply * (toSupply + 1)) / 2;
        } else {
            //    S2(n) = ∑_{k=1}^{n} k² = S2(n) = ∑_{k=1}^{j-1} k² + ∑_{k=j}^{n} k²
            // Thus the sum of squares from fromSupply to toSupply is:
            //    ∑_{k=fromSupply}^{toSupply} k² = ∑_{k=1}^{toSupply} k² - ∑_{k=1}^{fromSupply - 1} k²
            //    ∑_{k=fromSupply}^{toSupply} k² =    S2(toSupply)    -        S2(fromSupply - 1)
            //    ∑_{k=fromSupply}^{toSupply} k² =    toSupply(toSupply + 1)(2*toSupply + 1) / 6 - ((fromSupply-1)((fromSupply -1) + 1)(2*(fromSupply -1) + 1)) / 6
            uint256 sumSquaresTo = (toSupply *
                (toSupply + 1) *
                (2 * toSupply + 1)) / 6;
            uint256 sumSquaresFrom = ((fromSupply - 1) *
                fromSupply *
                (2 * fromSupply - 1)) / 6;
            sumSquares = sumSquaresTo - sumSquaresFrom;

            // Similarly,
            //   S1(n) = ∑_{k=1}^{n} k = ∑_{k=1}^{j-1} k + ∑_{k=j}^{n} k
            // Thus the sum from fromSupply to toSupply is:
            //   ∑_{k=fromSupply}^{toSupply} k = ∑_{k=1}^{n} k  - ∑_{k=1}^{j-1} k
            //   ∑_{k=fromSupply}^{toSupply} k = S1(toSupply)   - S1(fromSupply - 1)
            //   ∑_{k=fromSupply}^{toSupply} k = toSupply(toSupply + 1) / 2 - (fromSupply - 1)((fromSupply - 1) + 1) / 2
            uint256 sumFirstNTo = (toSupply * (toSupply + 1)) / 2;
            uint256 sumFirstNFrom = ((fromSupply - 1) * fromSupply) / 2;
            sumFirstN = sumFirstNTo - sumFirstNFrom;
        }

        // Total cost is the sum of base prices and the bonding curve contributions
        return (BASE_PRICE * amount) + (A * sumSquares) + (B * sumFirstN);
    }
}
