// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

/**
 * @title PointsSBT
 * @notice Non fongible and non transferable tokens sent to early users, which get rewards boost from it
 * @dev The owner can mint tokens and update the metadata URI
 */
contract PointsSBT is ERC721Upgradeable, OwnableUpgradeable {
    error AlreadyTokenOwner();
    error NonTransferable();

    /// @custom:storage-location erc7201:noodles.PointsSBT
    struct PointsSBTStorage {
        uint256 totalSupply;
        string uri;
    }

    // keccak256(abi.encode(uint256(keccak256("noodles.PointsSBT")) - 1)) & ~bytes32(uint256(0xff));
    bytes32 private constant PointsSBTStorageLocation =
        0x03223c981bbd6fc55d6fc29429d321676122827664909a380faf5cc6144a6500;

    function _getPointsSBTStorage()
        private
        pure
        returns (PointsSBTStorage storage $)
    {
        assembly {
            $.slot := PointsSBTStorageLocation
        }
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address initialOwner) public initializer {
        __ERC721_init_unchained("PointsSBT", "POINTS-SBT");
        __Ownable_init_unchained(initialOwner);

        PointsSBTStorage storage $ = _getPointsSBTStorage();
        $
            .uri = "ipfs://bafkreihawucpcz2gy2wp5mac3yqftl7et4y3pxqroees4mamlsflzisv7e";
    }

    // Owner can mint only if the recipient has no token yet
    function mint(address to) external onlyOwner {
        if (balanceOf(to) > 0) {
            revert AlreadyTokenOwner();
        }

        PointsSBTStorage storage $ = _getPointsSBTStorage();

        uint256 tokenId = $.totalSupply;
        $.totalSupply += 1;

        _safeMint(to, tokenId);
    }

    // Owner can update the metadata URI
    function setURI(string memory uri) external onlyOwner {
        PointsSBTStorage storage $ = _getPointsSBTStorage();
        $.uri = uri;
    }

    // Return the same metadata for every token
    function tokenURI(uint256) public view override returns (string memory) {
        PointsSBTStorage storage $ = _getPointsSBTStorage();
        return $.uri;
    }

    function totalSupply() public view returns (uint256) {
        PointsSBTStorage storage $ = _getPointsSBTStorage();
        return $.totalSupply;
    }

    // Block transfers to make it soulbound
    function _update(
        address to,
        uint256 tokenId,
        address auth
    ) internal virtual override returns (address) {
        if (auth != address(0)) {
            revert NonTransferable();
        }
        return super._update(to, tokenId, auth);
    }
}
