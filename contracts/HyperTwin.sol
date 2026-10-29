// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title HyperTwin: a pump.fun coin's twin on HyperEVM (Hyperliquid's EVM).
/// One billion tokens with the same 6 decimals as the pump.fun coin, all held by this contract at birth.
/// The creator posts ONE snapshot root (never changeable). Each holder who bound a HyperEVM address to their
/// Solana wallet claims exactly what the snapshot says. Nothing else can move the supply: there is no owner mint,
/// no pause, no fee, no upgrade. The twin is what a later HIP-1 deployment links to a HyperCore ticker.
contract HyperTwin {
    string public name;
    string public symbol;
    string public solMint;                                  // the pump.fun coin this twins (base58 mint address)
    uint8 public constant decimals = 6;
    uint256 public constant totalSupply = 1_000_000_000 * 1e6;
    address public immutable creator;
    bytes32 public root;                                    // snapshot: leaves keccak256(abi.encodePacked(account, amount)), sorted pairs

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => bool) public claimed;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event Snapshot(bytes32 root);
    event Claim(address indexed account, uint256 amount);

    constructor(string memory name_, string memory symbol_, string memory solMint_) {
        name = name_; symbol = symbol_; solMint = solMint_; creator = msg.sender;
        balanceOf[address(this)] = totalSupply;
        emit Transfer(address(0), address(this), totalSupply);
    }

    function setRoot(bytes32 r) external {
        require(msg.sender == creator, "creator only");
        require(root == bytes32(0) && r != bytes32(0), "snapshot already set");
        root = r;
        emit Snapshot(r);
    }

    function claim(uint256 amount, bytes32[] calldata proof) external {
        require(root != bytes32(0), "no snapshot yet");
        require(!claimed[msg.sender], "already claimed");
        bytes32 h = keccak256(abi.encodePacked(msg.sender, amount));
        for (uint256 i; i < proof.length; i++) {
            bytes32 p = proof[i];
            h = h < p ? keccak256(abi.encodePacked(h, p)) : keccak256(abi.encodePacked(p, h));
        }
        require(h == root, "not in the snapshot");
        claimed[msg.sender] = true;
        _move(address(this), msg.sender, amount);
        emit Claim(msg.sender, amount);
    }

    function transfer(address to, uint256 v) external returns (bool) { _move(msg.sender, to, v); return true; }
    function approve(address s, uint256 v) external returns (bool) { allowance[msg.sender][s] = v; emit Approval(msg.sender, s, v); return true; }
    function transferFrom(address f, address to, uint256 v) external returns (bool) {
        uint256 a = allowance[f][msg.sender];
        if (a != type(uint256).max) { require(a >= v, "allowance"); allowance[f][msg.sender] = a - v; }
        _move(f, to, v); return true;
    }
    function _move(address f, address to, uint256 v) private {
        require(to != address(0), "zero address");
        uint256 b = balanceOf[f]; require(b >= v, "balance");
        unchecked { balanceOf[f] = b - v; balanceOf[to] += v; }
        emit Transfer(f, to, v);
    }
}
