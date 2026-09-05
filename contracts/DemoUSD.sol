// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
/// @notice Freely issued TEST fixture. Not money, USDC, a stablecoin, or membership rights.
contract DemoUSD is ERC20 {
    mapping(address => uint256) public nextClaimAt;
    constructor() ERC20("FAIRJOIN Demo USD - NO VALUE", "FJUSD") {
        require(block.chainid == 10143 || block.chainid == 31337, "TESTNET_ONLY");
    }
    function decimals() public pure override returns (uint8) { return 6; }
    function faucet() external {
        require(block.timestamp >= nextClaimAt[msg.sender], "TRY_TOMORROW");
        nextClaimAt[msg.sender] = block.timestamp + 1 days;
        _mint(msg.sender, 1000e6);
    }
}
