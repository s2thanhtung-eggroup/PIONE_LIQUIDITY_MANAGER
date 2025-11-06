// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract MockPioneChainBridge {
    mapping(bytes32 => bool) public processedTransactions;

    function setProcessedTransaction(bytes32 requestId, bool status) external {
        processedTransactions[requestId] = status;
    }

    function bridgeOut(address to, uint256 amount, uint256 chainId) external returns (bytes32) {
        // Mock implementation
        bytes32 requestId = keccak256(abi.encodePacked(to, amount, chainId, block.timestamp));
        processedTransactions[requestId] = true;
        return requestId;
    }
}