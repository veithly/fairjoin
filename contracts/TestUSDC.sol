// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
// Development/test fixture only; never represents Circle-issued USDC.
contract TestUSDC is ERC20 {
    mapping(address => bool) public blockedRecipient;
    bool public fee;
    constructor() ERC20("Local Test USDC", "TestUSDC") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 value) external { _mint(to, value); }
    function setBlockedRecipient(address to, bool value) external { blockedRecipient[to] = value; }
    function setFee(bool value) external { fee = value; }
    function _update(address from, address to, uint256 value) internal override {
        require(!blockedRecipient[to], "BLOCKED_RECIPIENT");
        if (fee && from != address(0) && to != address(0) && value > 0) { super._update(from, address(0), 1); super._update(from, to, value - 1); }
        else super._update(from, to, value);
    }
}
