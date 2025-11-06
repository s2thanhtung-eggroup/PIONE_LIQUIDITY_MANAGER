// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IPioneLiquidityManager {
    event UserDepositUSDT(bytes32 indexed requestId, address indexed user, uint256 amount);
    event BridgeCompleted(bytes32 indexed requestId, address indexed user, uint256 index);
    event ClaimedPIOtoPioneChain(bytes32 indexed requestId, address indexed user, uint256 amount);
    event ClaimedUSDT(address indexed account, uint256 amount);
    event LiquidityAdded(
        address indexed user,
        bytes32 indexed requestId,
        uint256 pioAmount,
        uint256 usdtAmount,
        uint256 liquidity,
        uint256 slippage
    );
    event LiquidityLocked(
        address indexed user,
        bytes32 indexed requestId,
        uint256 lockId,
        uint256 liquidity,
        uint256 unlockDate
    );
    event UpdatedMinClaimPIOAmount(uint256 oldAmount, uint256 newAmount);
    event PioneBridgeUpdated(address indexed oldAddress, address indexed newAddress);

    function handleBridgeCompleted(
        bytes32 requestId,
        address account,
        uint256 amountPIO,
        uint256 amountUSDT,
        uint256 lockMonths
    ) external;

    function depositUSDT(bytes32 requestId) external returns (bool);
    function addLiquidity(
        bytes32 requestId,
        uint256 slippagePercent
    ) external returns (bool);

    function claimUSDT(uint256 amount) external returns (bool);
    function claimPioToPioneChain(uint256 amount) external returns (bool);
    function getOptimalAmountUSDT(uint256 pioAmount) external view returns (uint256 optimalUsdtAmount);
    function getOptimalAmountPIO(uint256 usdtAmount) external view returns (uint256 optimalPioAmount);
    function setMinClaimPIOAmount(uint256 minAmount) external;
    function previewAddLiquidity(uint256 pioneAmount, uint256 usdtAmount)
        external
        view
        returns (
            uint256 actualPioAmount,
            uint256 actualUsdtAmount,
            uint256 estimatedLiquidity,
            uint256 refundPio,
            uint256 refundUsdt
        );
    function getReserves() external view returns (uint256 reserveUsdt, uint256 reservePione);
    function getTransactionInfo(bytes32 requestId)
        external
        view
        returns (
            uint256 pioAmount,
            uint256 usdtAmount,
            uint256 liquidityAmount,
            bool _depositUSDT,
            uint256 pinkLockId,
            uint256 lockMonths
        );
    function getUserBalances(address account) external view returns (uint256 pioBalance, uint256 usdtBalance);
    function getRequestIdOwner(bytes32 requestId) external view returns (address);
    function getMinClaimPIOAmount() external view returns (uint256);

    function MANAGER_ROLE() external view returns (bytes32);
    function PIONE_TOKEN() external view returns (address);
    function USDT_TOKEN() external view returns (address);
    function LP_PAIR() external view returns (address);
    function POOL_LOCK() external view returns (address);
    function pioneBridge() external view returns (address);
}
