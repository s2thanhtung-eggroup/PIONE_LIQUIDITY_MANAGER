// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { IPancakeFactory } from "./interfaces/IPancakeFactory.sol";
import { IPancakeRouter02 } from "./interfaces/IPancakeRouter02.sol";
import { IPancakePair } from "./interfaces/IPancakePair.sol";
import { IPioneChainBridge } from "./interfaces/IPioneChainBridge.sol";
import { IPinkLock } from "./interfaces/IPinkLock.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";

contract PioneLiquidityManager is AccessControl, Pausable, ReentrancyGuard {
    
    using SafeERC20 for IERC20;
    IPancakeRouter02 public router;

    bytes32 public constant MANAGER_ROLE = keccak256("MANAGER_ROLE");
    address public immutable PIONE_TOKEN;
    address public immutable USDT_TOKEN;
    address public immutable LP_PAIR;
    address public immutable POOL_LOCK;
    uint256 public immutable PIONECHAIN_ID;
    address public pioneBridge;

    struct Transaction {
        uint256 pioAmount;
        uint256 usdtAmount;
        uint256 liquidityAmount;
        bool depositUSDT;
        uint256 pinkLockId;
        uint256 lockMonths;
    }
    
    struct UserInfo {
        uint256 pioBalance;          
        uint256 usdtBalance;            
        uint256 totalLiquidity;    
        Transaction[] transactions;
        mapping(bytes32 requestId => uint256) _positions;
    }

    uint256 private _minClaimPIOAmount;
    mapping(address => UserInfo) private _userData;
    mapping(bytes32 => address) private _usedRequestIds;

    event UserDepositUSDT(bytes32 indexed requestId, address indexed user, uint256 amount);
    event LiquidityRequestCreated(bytes32 indexed requestId, address indexed user, uint256 amountPIO, uint256 amountUSDT, uint256 lockMonths);
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
    
    modifier onlyOwner() {
        require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "Not owner");
        _;
    }

    modifier onlyManager() {
        require(hasRole(MANAGER_ROLE, msg.sender), "Not manager");
        _;
    }

    modifier canDeposit(bytes32 _requestId) {
        require(_usedRequestIds[_requestId] != address(0), "RequestId does not exist");
        require(_usedRequestIds[_requestId] == msg.sender, "Not the owner of this request");
        UserInfo storage user = _userData[msg.sender];
        uint256 position = user._positions[_requestId];
        require(position < user.transactions.length, "Invalid transaction");
        require(user.transactions[position].usdtAmount > 0, "Invalid transaction");
        require(!user.transactions[position].depositUSDT, "Already deposited USDT");
        _;
    }

    modifier canExecuted(bytes32 _requestId, address account) {
        require(_usedRequestIds[_requestId] != address(0), "RequestId does not exist");
        require(_usedRequestIds[_requestId] == account, "Not the owner of this request");
        UserInfo storage user = _userData[account];
        uint256 position = user._positions[_requestId];
        require(position < user.transactions.length, "Invalid transaction");
        require(user.transactions[position].usdtAmount > 0, "Invalid transaction");
        require(user.transactions[position].liquidityAmount == 0, "Additional liquidity request made");
        require(user.transactions[position].depositUSDT, "USDT not provided yet");
        _;
    }

    constructor(
        address _pioneToken,
        address _usdtToken,
        address _pioneBridge,
        address _router,
        address _pinklock,
        uint256 _targetChain
    ) {
        require(
            _pioneToken != address(0) && _usdtToken != address(0) &&
            _router != address(0) && _pinklock != address(0),
            "Invalid address"
        );
        PIONE_TOKEN = _pioneToken;
        USDT_TOKEN = _usdtToken;
        POOL_LOCK = _pinklock;
        router = IPancakeRouter02(_router);
        LP_PAIR = IPancakeFactory(router.factory()).getPair(PIONE_TOKEN, USDT_TOKEN);
        require(LP_PAIR != address(0), "LP pair does not exist");
        _approveRouter(_router, type(uint256).max);

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MANAGER_ROLE, msg.sender);
        PIONECHAIN_ID = _targetChain;
        pioneBridge = _pioneBridge;
        _minClaimPIOAmount = 1 * 10**18; // default 1 PIO
    }
    
    // Handle completed bridge transaction and create liquidity request
    function handleBridgeCompleted(
        bytes32 requestId,
        address account,
        uint256 amountPIO,
        uint256 amountUSDT,
        uint256 lockMonths
    )
        external
        onlyManager
        whenNotPaused
    {
        require(IPioneChainBridge(pioneBridge).processedTransactions(requestId), "Transaction not completed");
        require(_usedRequestIds[requestId] == address(0), "RequestId already set");
        require(lockMonths > 0, "Lock months must be greater than 0");

        UserInfo storage userInfo = _userData[account];
        Transaction memory newTransaction = Transaction({
            pioAmount: amountPIO,
            usdtAmount: amountUSDT,
            liquidityAmount: 0,
            depositUSDT: false,
            pinkLockId: 0,
            lockMonths: lockMonths
        });
        _usedRequestIds[requestId] = account;

        uint256 index = userInfo.transactions.length;
        userInfo._positions[requestId] = index;
        userInfo.transactions.push(newTransaction);
        userInfo.pioBalance += amountPIO;

        emit LiquidityRequestCreated(requestId, account, amountPIO, amountUSDT, lockMonths);
    }
    
    // Deposit USDT for a liquidity request
    function depositUSDT(bytes32 requestId)
        external
        nonReentrant
        whenNotPaused
        canDeposit(requestId)
        returns (bool)
    {
        UserInfo storage user = _userData[msg.sender];
        uint256 position = user._positions[requestId];
        uint256 usdtAmount = user.transactions[position].usdtAmount;

        IERC20(USDT_TOKEN).safeTransferFrom(msg.sender, address(this), usdtAmount);
        user.transactions[position].depositUSDT = true;
        user.usdtBalance += usdtAmount;

        emit UserDepositUSDT(requestId, msg.sender, usdtAmount);
        return true;
    }
    
    // Add liquidity to PancakeSwap and lock LP tokens
    function addLiquidity(bytes32 requestId, uint256 slippagePercent) 
        external 
        whenNotPaused 
        nonReentrant
        canExecuted(requestId, msg.sender) 
        returns (bool) 
    {
        require(slippagePercent <= 90, "Slippage too high");

        UserInfo storage user = _userData[msg.sender];
        uint256 position = user._positions[requestId];
        (uint256 pioAmount, uint256 usdtAmount) = _validateAndGetAmounts(user, position);
        uint256 liquidity = _executeAddLiquidity(
            user,
            position,
            pioAmount,
            usdtAmount,
            slippagePercent,
            msg.sender,
            requestId
        );

        _lockLPTokens(user, position, liquidity, msg.sender, requestId);
        return true;
    }
    
    // Claim USDT balance
    function claimUSDT(uint256 amount) external nonReentrant whenNotPaused returns (bool) {
        require(amount > 0, "invalid amount");
        UserInfo storage user = _userData[msg.sender];
        require(user.usdtBalance >= amount, "Insufficient balance USDT");
        user.usdtBalance -= amount;

        IERC20(USDT_TOKEN).safeTransfer(msg.sender, amount);

        emit ClaimedUSDT(msg.sender, amount);
        return true;
    }

    // Claim PIO balance and bridge back to Pione Chain
    function claimPioToPioneChain(uint256 amount) external nonReentrant whenNotPaused returns (bool) {
        require(amount > 0, "Amount PIO must be > 0");
        require(amount >= _minClaimPIOAmount, "Amount below minimum");
        UserInfo storage user = _userData[msg.sender];
        require(user.pioBalance >= amount, "Insufficient balance PIO");
        user.pioBalance -= amount;

        bytes32 requestId = IPioneChainBridge(pioneBridge).bridgeOut(msg.sender, amount, PIONECHAIN_ID);

        emit ClaimedPIOtoPioneChain(requestId, msg.sender, amount);
        return true;
    }

    // Calculate optimal USDT amount for given PIO amount
    function getOptimalAmountUSDT(uint256 pioAmount) external view returns (uint256 optimalUsdtAmount) {
        (uint256 reserveUsdt, uint256 reservePione) = getReserves();
        optimalUsdtAmount = router.quote(pioAmount, reservePione, reserveUsdt);
    }

    // Calculate optimal PIO amount for given USDT amount
    function getOptimalAmountPIO(uint256 usdtAmount) external view returns (uint256 optimalPioAmount) {
        (uint256 reserveUsdt, uint256 reservePione) = getReserves();
        optimalPioAmount = router.quote(usdtAmount, reserveUsdt, reservePione);
    }

    // Preview liquidity addition with refund amounts
    function previewAddLiquidity(uint256 pioneAmount, uint256 usdtAmount)
        external
        view
        returns (
            uint256 actualPioAmount,
            uint256 actualUsdtAmount,
            uint256 estimatedLiquidity,
            uint256 refundPio,
            uint256 refundUsdt
        )
    {
        (uint256 reserveUsdt, uint256 reservePione) = getReserves();
        uint256 optimalUsdt = router.quote(pioneAmount, reservePione, reserveUsdt);

        if (optimalUsdt <= usdtAmount) {
            actualPioAmount = pioneAmount;
            actualUsdtAmount = optimalUsdt;
            refundUsdt = usdtAmount - optimalUsdt;
            refundPio = 0;
        } else {
            uint256 optimalPio = router.quote(usdtAmount, reserveUsdt, reservePione);
            actualPioAmount = optimalPio;
            actualUsdtAmount = usdtAmount;
            refundPio = pioneAmount - optimalPio;
            refundUsdt = 0;
        }

        // Estimate liquidity tokens
        uint256 totalSupply = IPancakePair(LP_PAIR).totalSupply();
        estimatedLiquidity = (actualPioAmount * totalSupply) / reservePione;
    }

    // Get current LP reserves for USDT and PIO
    function getReserves() public view returns(uint256 reserveUsdt, uint256 reservePione) {
        (uint256 reserve0, uint256 reserve1,) = IPancakePair(LP_PAIR).getReserves();
        address token0 = IPancakePair(LP_PAIR).token0();
        (reserveUsdt, reservePione) = token0 == USDT_TOKEN
            ? (reserve0, reserve1)
            : (reserve1, reserve0);
    }

    // Execute liquidity addition to PancakeSwap
    function _executeAddLiquidity(
        UserInfo storage user,
        uint256 position,
        uint256 pioAmount,
        uint256 usdtAmount,
        uint256 slippagePercent,
        address account,
        bytes32 requestId
    ) private returns (uint256 liquidity) {
        uint256 amountPioMin = pioAmount * (100 - slippagePercent) / 100;
        uint256 amountUsdtMin = usdtAmount * (100 - slippagePercent) / 100;
        user.pioBalance -= pioAmount;
        user.usdtBalance -= usdtAmount;

        (uint amountA, uint amountB, uint liquidityAmount) = router.addLiquidity(
            PIONE_TOKEN,
            USDT_TOKEN,
            pioAmount,
            usdtAmount,
            amountPioMin,
            amountUsdtMin,
            address(this),
            block.timestamp + 300
        );

        // Update transaction and refund unused tokens
        user.transactions[position].liquidityAmount = liquidityAmount;
        user.totalLiquidity += liquidityAmount;

        if (pioAmount > amountA) user.pioBalance += (pioAmount - amountA);
        if (usdtAmount > amountB) user.usdtBalance += (usdtAmount - amountB);

        emit LiquidityAdded(account, requestId, amountA, amountB, liquidityAmount, slippagePercent);
        return liquidityAmount;
    }

    // Validate and get token amounts for transaction
    function _validateAndGetAmounts(UserInfo storage user, uint256 position)
        private
        view
        returns (uint256 pioAmount, uint256 usdtAmount)
    {
        pioAmount = user.transactions[position].pioAmount;
        usdtAmount = user.transactions[position].usdtAmount;
        
        require(user.pioBalance >= pioAmount, "Insufficient PIONE");
        require(user.usdtBalance >= usdtAmount, "Insufficient USDT");
    }

    // Lock LP tokens in PinkLock
    function _lockLPTokens(
        UserInfo storage user,
        uint256 position,
        uint256 liquidity,
        address account,
        bytes32 requestId
    ) private {
        IERC20(LP_PAIR).approve(POOL_LOCK, liquidity);

        uint256 unlockDate = block.timestamp + (30 days * user.transactions[position].lockMonths);
        string memory description = string(abi.encodePacked('{"l": "PIO LP Locker ', _getLastSixChars(account), '"}'));

        uint256 lockId = IPinkLock(POOL_LOCK).lock(
            account,
            LP_PAIR,
            true,
            liquidity,
            unlockDate,
            description
        );
        user.transactions[position].pinkLockId = lockId;

        emit LiquidityLocked(account, requestId, lockId, liquidity, unlockDate);
    }

    // Get last 6 hex characters of address
    function _getLastSixChars(address account) internal pure returns (string memory) {
        bytes memory hexChars = "0123456789abcdef";
        bytes memory result = new bytes(6);

        uint160 addr = uint160(account);
        for (uint i = 0; i < 3; i++) {
            uint8 byteValue = uint8(addr >> (8 * (2 - i)));
            result[i * 2] = hexChars[byteValue >> 4];
            result[i * 2 + 1] = hexChars[byteValue & 0x0f];
        }
        return string(result);
    }

    // Get transaction information by request ID
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
        )
    {
        require(_usedRequestIds[requestId] != address(0), "RequestId does not exist");
        address account = _usedRequestIds[requestId];
        UserInfo storage user = _userData[account];
        uint256 position = user._positions[requestId];

        require(position < user.transactions.length, "Invalid position");
        Transaction storage txn = user.transactions[position];

        return (
            txn.pioAmount,
            txn.usdtAmount,
            txn.liquidityAmount,
            txn.depositUSDT,
            txn.pinkLockId,
            txn.lockMonths
        );
    }

    // Get user's PIO and USDT balances
    function getUserBalances(address account) external view returns (uint256 pioBalance, uint256 usdtBalance) {
        UserInfo storage user = _userData[account];
        return (
            user.pioBalance,
            user.usdtBalance
        );
    }

    // Get the owner address of a requestId
    function getRequestIdOwner(bytes32 requestId) external view returns (address) {
        return _usedRequestIds[requestId];
    }

    // Set minimum claim PIO amount
    function setMinClaimPIOAmount(uint256 minAmount) external onlyOwner {
        require(minAmount > 0, "Min amount must be greater than 0");
        emit UpdatedMinClaimPIOAmount(_minClaimPIOAmount, minAmount);
        _minClaimPIOAmount = minAmount;
    }

    // Get minimum claim PIO amount
    function getMinClaimPIOAmount() external view returns (uint256) {
        return _minClaimPIOAmount;
    }

    // Set PioneBridge address
    function setPioneBridge(address _pioneBridge) public onlyOwner {
        require(_pioneBridge != address(0), "Invalid PioneBridge address");
        emit PioneBridgeUpdated(pioneBridge, _pioneBridge);
        pioneBridge = _pioneBridge;
    }

    // Approve router to spend PIONE and USDT tokens
    function _approveRouter(address _router, uint256 value) private returns (bool) {
        IERC20(PIONE_TOKEN).approve(_router, value);
        IERC20(USDT_TOKEN).approve(_router, value);
        return true;
    }

    // Pause contract
    function pause() external onlyOwner {
        _pause();
    }

    // Unpause contract
    function unpause() external onlyOwner {
        _unpause();
    }
}
