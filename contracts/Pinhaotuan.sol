// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract Pinhaotuan is ReentrancyGuard {
    using SafeERC20 for IERC20;
    IERC20 public immutable asset;
    uint32 public constant policyVersion = 1;
    enum Status { OPEN, CANCELLED, FAILED, SETTLED }
    enum RefundKind { PRICE_REBATE, GROUP_CANCELLED, GROUP_FAILED }
    struct CreateParams { uint256 cost; uint8 minParticipants; uint8 capacity; uint64 deadline; uint64 startsAt; address payoutAddress; string metadataJson; }
    struct Member { uint256 paidTotal; uint256 returnedTotal; uint8 activeIndexPlusOne; uint64 joinedAt; }
    struct Group { address organizer; address payoutAddress; uint256 cost; uint8 minimum; uint8 capacity; uint64 deadline; uint64 startsAt; uint32 policyVersion; string metadataJson; bytes32 termsHash; bool funded; Status status; uint64 rosterVersion; address[] activeMembers; uint256 paidTotal; uint256 returnedTotal; uint256 revenueWithdrawn; }
    struct MemberView { uint256 paidTotal; uint256 returnedTotal; uint8 activeIndexPlusOne; uint64 joinedAt; uint256 share; uint256 claimable; }
    Group[] private groups;
    mapping(uint256 => mapping(address => Member)) private members;
    mapping(address => uint256[]) private organizerGroups;
    event GroupCreated(uint256 indexed groupId, address indexed organizer, bytes32 termsHash);
    event Joined(uint256 indexed groupId, address indexed actor, uint256 amount, uint256 count, uint64 rosterVersion);
    event LeftBeforeFunded(uint256 indexed groupId, address indexed actor, uint256 amount, uint256 count, uint64 rosterVersion);
    event FundingReached(uint256 indexed groupId, uint256 count);
    event PriceUpdated(uint256 indexed groupId, uint256 count, uint64 rosterVersion);
    event Claimed(uint256 indexed groupId, address indexed actor, uint256 amount, RefundKind refundKind);
    event Cancelled(uint256 indexed groupId, address indexed actor);
    event Finalized(uint256 indexed groupId, Status status);
    event OrganizerPaid(uint256 indexed groupId, address indexed actor, address payoutAddress, uint256 amount);

    constructor(address tokenAddress) {
        require(tokenAddress.code.length > 0, "ASSET_CODE");
        (bool ok, bytes memory data) = tokenAddress.staticcall(abi.encodeWithSignature("decimals()"));
        require(ok && data.length >= 32 && abi.decode(data, (uint256)) == 6, "ASSET_DECIMALS");
        asset = IERC20(tokenAddress);
    }
    function token() external view returns (address) { return address(asset); }
    function groupCount() external view returns (uint256) { return groups.length; }
    function createGroup(CreateParams calldata p) external returns (uint256 id) {
        require(p.cost >= 1e6 && p.cost <= 1000e6, "COST");
        require(p.minParticipants >= 2 && p.minParticipants <= p.capacity && p.capacity <= 12, "PARTICIPANTS");
        require(uint256(p.deadline) >= block.timestamp + 600 && uint256(p.startsAt) >= uint256(p.deadline) + 1800, "TIME");
        require(p.payoutAddress != address(0) && p.payoutAddress != address(this), "PAYOUT");
        require(bytes(p.metadataJson).length > 0 && bytes(p.metadataJson).length <= 2048, "METADATA");
        id = groups.length;
        Group storage g = groups.push();
        g.organizer = msg.sender; g.payoutAddress = p.payoutAddress; g.cost = p.cost;
        g.minimum = p.minParticipants; g.capacity = p.capacity; g.deadline = p.deadline; g.startsAt = p.startsAt;
        g.policyVersion = policyVersion; g.metadataJson = p.metadataJson;
        g.termsHash = keccak256(abi.encode(policyVersion, block.chainid, address(this), id, msg.sender, p.payoutAddress, address(asset), p.cost, p.minParticipants, p.capacity, p.deadline, p.startsAt, keccak256(bytes(p.metadataJson))));
        organizerGroups[msg.sender].push(id);
        emit GroupCreated(id, msg.sender, g.termsHash);
    }
    function _group(uint256 id) private view returns (Group storage g) { require(id < groups.length, "GROUP"); return groups[id]; }
    function _share(Group storage g, uint256 index) private view returns (uint256) {
        uint256 n = g.activeMembers.length;
        return g.cost / n + (index < g.cost % n ? 1 : 0);
    }
    function _quote(Group storage g) private view returns (uint256) {
        return g.funded ? g.cost / (g.activeMembers.length + 1) : (g.cost + g.minimum - 1) / g.minimum;
    }
    function _joinable(Group storage g) private view {
        require(g.status == Status.OPEN && block.timestamp < g.deadline, "CLOSED");
        require(g.activeMembers.length < g.capacity, "FULL");
    }
    function quoteJoin(uint256 id) external view returns (uint256 amount, uint64 rosterVersion, bytes32 termsHash) {
        Group storage g = _group(id); _joinable(g);
        return (_quote(g), g.rosterVersion, g.termsHash);
    }
    function join(uint256 id, uint64 expectedRosterVersion, uint256 maxAmount, uint64 quoteExpiry, bytes32 expectedTermsHash) external nonReentrant {
        Group storage g = _group(id); _joinable(g);
        require(g.rosterVersion == expectedRosterVersion, "STALE_QUOTE");
        require(g.termsHash == expectedTermsHash, "TERMS_HASH");
        require(block.timestamp <= quoteExpiry, "QUOTE_EXPIRED");
        Member storage m = members[id][msg.sender]; require(m.activeIndexPlusOne == 0, "ALREADY_JOINED");
        uint256 amount = _quote(g); require(amount <= maxAmount, "MAX_AMOUNT");
        uint256 beforeBalance = asset.balanceOf(address(this));
        m.paidTotal += amount; m.activeIndexPlusOne = uint8(g.activeMembers.length + 1); m.joinedAt = uint64(block.timestamp);
        g.activeMembers.push(msg.sender); g.paidTotal += amount; g.rosterVersion++;
        if (!g.funded && g.activeMembers.length >= g.minimum) { g.funded = true; emit FundingReached(id, g.activeMembers.length); }
        asset.safeTransferFrom(msg.sender, address(this), amount);
        require(asset.balanceOf(address(this)) == beforeBalance + amount, "UNSUPPORTED_TOKEN");
        emit Joined(id, msg.sender, amount, g.activeMembers.length, g.rosterVersion);
        emit PriceUpdated(id, g.activeMembers.length, g.rosterVersion);
    }
    function leaveBeforeFunded(uint256 id) external nonReentrant {
        Group storage g = _group(id);
        require(g.status == Status.OPEN && !g.funded && block.timestamp < g.deadline, "CANNOT_LEAVE");
        Member storage m = members[id][msg.sender]; require(m.activeIndexPlusOne > 0, "NOT_MEMBER");
        uint256 amount = m.paidTotal - m.returnedTotal;
        uint256 index = m.activeIndexPlusOne - 1;
        for (uint256 i = index; i + 1 < g.activeMembers.length; i++) { address next = g.activeMembers[i + 1]; g.activeMembers[i] = next; members[id][next].activeIndexPlusOne = uint8(i + 1); }
        g.activeMembers.pop(); m.activeIndexPlusOne = 0; m.returnedTotal += amount;
        g.returnedTotal += amount; g.rosterVersion++;
        _pay(msg.sender, amount);
        emit LeftBeforeFunded(id, msg.sender, amount, g.activeMembers.length, g.rosterVersion);
    }
    function _claimable(Group storage g, Member storage m) private view returns (uint256) {
        if (g.status == Status.CANCELLED || g.status == Status.FAILED || (!g.funded && block.timestamp >= g.deadline)) return m.paidTotal - m.returnedTotal;
        if (!g.funded || m.activeIndexPlusOne == 0) return 0;
        return m.paidTotal - m.returnedTotal - _share(g, m.activeIndexPlusOne - 1);
    }
    function _pay(address recipient, uint256 amount) private {
        uint256 beforeSelf = asset.balanceOf(address(this)); uint256 beforeRecipient = asset.balanceOf(recipient);
        asset.safeTransfer(recipient, amount);
        require(asset.balanceOf(address(this)) + amount == beforeSelf && asset.balanceOf(recipient) == beforeRecipient + amount, "UNSUPPORTED_TOKEN");
    }
    function claim(uint256 id) external nonReentrant {
        Group storage g = _group(id);
        if (g.status == Status.OPEN && !g.funded && block.timestamp >= g.deadline) _finalize(id, g);
        Member storage m = members[id][msg.sender]; uint256 amount = _claimable(g, m); require(amount > 0, "NOTHING_TO_CLAIM");
        m.returnedTotal += amount; g.returnedTotal += amount;
        _pay(msg.sender, amount);
        emit Claimed(id, msg.sender, amount, g.status == Status.CANCELLED ? RefundKind.GROUP_CANCELLED : g.status == Status.FAILED ? RefundKind.GROUP_FAILED : RefundKind.PRICE_REBATE);
    }
    function cancel(uint256 id) external {
        Group storage g = _group(id);
        require(msg.sender == g.organizer, "ORGANIZER_ONLY");
        require(g.status == Status.OPEN && block.timestamp < g.deadline, "CANNOT_CANCEL");
        g.status = Status.CANCELLED; emit Cancelled(id, msg.sender);
    }
    function _finalize(uint256 id, Group storage g) private {
        require(g.status == Status.OPEN && block.timestamp >= g.deadline, "CANNOT_FINALIZE");
        g.status = g.funded ? Status.SETTLED : Status.FAILED; emit Finalized(id, g.status);
    }
    function finalize(uint256 id) external { Group storage g = _group(id); _finalize(id, g); }
    function withdrawOrganizer(uint256 id) external nonReentrant {
        Group storage g = _group(id); require(msg.sender == g.organizer, "ORGANIZER_ONLY");
        if (g.status == Status.OPEN && g.funded && block.timestamp >= g.deadline) _finalize(id, g);
        require(g.status == Status.SETTLED && g.revenueWithdrawn == 0, "NOT_WITHDRAWABLE");
        g.revenueWithdrawn = g.cost; _pay(g.payoutAddress, g.cost);
        emit OrganizerPaid(id, msg.sender, g.payoutAddress, g.cost);
    }
    function getGroup(uint256 id) external view returns (Group memory) { return _group(id); }
    function getMember(uint256 id, address account) external view returns (MemberView memory v) {
        Group storage g = _group(id); Member storage m = members[id][account];
        v = MemberView(m.paidTotal, m.returnedTotal, m.activeIndexPlusOne, m.joinedAt, 0, _claimable(g, m));
        if (g.funded && g.status != Status.CANCELLED && g.status != Status.FAILED && m.activeIndexPlusOne > 0) v.share = _share(g, m.activeIndexPlusOne - 1);
        else if (!g.funded && g.status == Status.OPEN && block.timestamp < g.deadline && m.activeIndexPlusOne > 0) v.share = (g.cost + g.minimum - 1) / g.minimum;
    }
    function getOrganizerGroups(address organizer, uint256 cursor, uint256 limit) external view returns (uint256[] memory result) {
        uint256[] storage ids = organizerGroups[organizer];
        uint256 count = cursor >= ids.length ? 0 : ids.length - cursor;
        if (count > limit) count = limit;
        result = new uint256[](count);
        for (uint256 i; i < count; i++) result[i] = ids[cursor + i];
    }
}
