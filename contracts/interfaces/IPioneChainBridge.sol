// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IPioneChainBridge {

    struct BridgeRequest {
        address from;
        address to;
        uint amount;
        uint sourceChain;
        uint targetChain;
        uint nonce;
    }

    /**
     * @notice Initiate a cross-chain transfer
     * @param to Recipient address on target chain
     * @param amount Amount of tokens to bridge
     * @param targetChain Target chain ID
     * @return requestId Unique identifier for this bridge request
     */
    function bridgeOut(
        address to,
        uint amount,
        uint targetChain
    ) external returns (bytes32);
    function bridgeIn(
        BridgeRequest calldata request,
        bytes32 requestId
    ) external;

    /**
     * @notice Add or remove supported chain
     * @param chainId Chain ID to update
     * @param supported Whether the chain is supported
     */
    function setChainSupport(uint chainId, bool supported) external;

    /**
     * @notice Update transfer limits
     * @param _minAmount Minimum transfer amount
     * @param _maxAmount Maximum transfer amount
     * @param _dailyLimit Daily transfer limit
     */
    function setTransferLimits(
        uint _minAmount,
        uint _maxAmount,
        uint _dailyLimit
    ) external;

    /**
     * @notice Returns whether the transaction identified by the given request ID has been processed.
     * @param _requestId Request ID to check
     * @return Whether the request has been processed
     */
    function processedTransactions(bytes32 _requestId) external view returns (bool);

    /**
     * @notice Returns the remaining amount that may be bridged out today
     * @return Remaining daily limit
     */
    function getRemainingDailyLimit() external view returns (uint);

    /**
     * @notice Returns the total amount of tokens transferred during the current day via the bridge
     * @return Daily transferred amount
     */
    function getDailyTransferred() external view returns (uint);
}