# PIONE Liquidity Manager

A smart contract system for managing cross-chain liquidity provision between PioneChain and BNB Smart Chain (BSC). This contract enables users to bridge PIONE tokens from PioneChain to BSC, pair them with USDT, provide liquidity on PancakeSwap, and lock the LP tokens using PinkLock.

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Architecture](#architecture)
- [Smart Contract Details](#smart-contract-details)
- [Installation](#installation)
- [Configuration](#configuration)
- [Deployment](#deployment)
- [Usage](#usage)
- [Testing](#testing)
- [Security](#security)
- [Contract Addresses](#contract-addresses)
- [License](#license)

## Overview

The PIONE Liquidity Manager is a sophisticated DeFi protocol designed to facilitate seamless liquidity provision for the PIONE token on BNB Smart Chain. It automates the process of:

1. Accepting bridged PIONE tokens from PioneChain
2. Collecting matching USDT from users
3. Adding liquidity to PancakeSwap (PIONE/USDT pair)
4. Locking LP tokens in PinkLock for a specified duration

This system ensures secure, transparent, and efficient liquidity management for the PIONE ecosystem.

## Features

### Core Functionality

- **Cross-Chain Integration**: Seamlessly integrates with PioneChain bridge to handle bridged tokens
- **Automated Liquidity Addition**: Automatically adds liquidity to PancakeSwap with optimal ratios
- **LP Token Locking**: Locks liquidity provider tokens in PinkLock with customizable lock periods
- **Slippage Protection**: Configurable slippage tolerance (up to 90%) for liquidity provision
- **Refund Mechanism**: Automatically refunds unused tokens when actual liquidity ratios differ from requested

### Security Features

- **Access Control**: Role-based permissions using OpenZeppelin's AccessControl
  - `DEFAULT_ADMIN_ROLE`: Contract owner with full administrative privileges
  - `MANAGER_ROLE`: Authorized managers who can process bridge completions
- **Pausable**: Emergency pause functionality to halt all operations if needed
- **Reentrancy Guard**: Protection against reentrancy attacks on critical functions
- **Request ID Validation**: Prevents double-spending and ensures transaction uniqueness

### User Operations

- **Deposit USDT**: Users deposit USDT to match their bridged PIONE tokens
- **Add Liquidity**: Executes liquidity addition with user-specified slippage tolerance
- **Claim USDT**: Withdraw unused or refunded USDT balances
- **Claim PIO**: Bridge PIONE tokens back to PioneChain with minimum threshold protection

### View Functions

- **Portfolio Tracking**: Check PIO and USDT balances for any user
- **Transaction Details**: View complete transaction information by request ID
- **Liquidity Preview**: Preview expected liquidity amounts and refunds before execution
- **Optimal Amounts**: Calculate optimal token ratios based on current pool reserves
- **Reserve Information**: Access current PancakeSwap pool reserves

## Architecture

### Contract Flow

```
┌─────────────────┐
│  PioneChain     │
│  User bridges   │
│  PIONE tokens   │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────┐
│  PioneChain Bridge Contract     │
│  (processedTransactions)        │
└────────┬────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│  PioneLiquidityManager          │
│  1. handleBridgeCompleted()     │
│     - Create liquidity request  │
│     - Track user balances       │
└────────┬────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│  User Actions                   │
│  2. depositUSDT()               │
│     - User provides USDT        │
└────────┬────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│  3. addLiquidity()              │
│     ├─> PancakeSwap Router      │
│     │   - Add PIONE/USDT pair   │
│     │   - Receive LP tokens     │
│     │                            │
│     └─> PinkLock                │
│         - Lock LP tokens        │
│         - Set unlock date       │
└─────────────────────────────────┘
```

### State Management

The contract uses a nested mapping structure to efficiently track user data:

```solidity
mapping(address => UserInfo) private _userData;

struct UserInfo {
    uint256 pioBalance;           // Available PIONE balance
    uint256 usdtBalance;          // Available USDT balance
    uint256 totalLiquidity;       // Total LP tokens provided
    Transaction[] transactions;   // Array of all transactions
    mapping(bytes32 => uint256) _positions; // RequestID to position mapping
}
```

## Smart Contract Details

### PioneLiquidityManager.sol

**Inheritance:**
- `AccessControl` - Role-based access control
- `Pausable` - Emergency pause mechanism
- `ReentrancyGuard` - Protection against reentrancy attacks

**Key Functions:**

#### Manager Functions

##### `handleBridgeCompleted`
```solidity
function handleBridgeCompleted(
    bytes32 requestId,
    address account,
    uint256 amountPIO,
    uint256 amountUSDT,
    uint256 lockMonths
) external onlyManager whenNotPaused
```
- **Purpose**: Creates a liquidity request after bridge completion
- **Access**: Only MANAGER_ROLE
- **Validations**:
  - Transaction must be processed on bridge
  - RequestId must be unique
  - Lock months must be > 0

##### `depositUSDT`
```solidity
function depositUSDT(bytes32 requestId)
    external
    nonReentrant
    whenNotPaused
    canDeposit(requestId)
    returns (bool)
```
- **Purpose**: User deposits required USDT for liquidity provision
- **Access**: Request owner only
- **Requirements**:
  - Valid request ID
  - USDT not already deposited
  - Sufficient USDT allowance

##### `addLiquidity`
```solidity
function addLiquidity(bytes32 requestId, uint256 slippagePercent)
    external
    whenNotPaused
    nonReentrant
    canExecuted(requestId, msg.sender)
    returns (bool)
```
- **Purpose**: Adds liquidity to PancakeSwap and locks LP tokens
- **Access**: Request owner only
- **Parameters**:
  - `slippagePercent`: Maximum allowed slippage (0-90%)
- **Actions**:
  1. Adds liquidity to PancakeSwap
  2. Refunds unused tokens
  3. Locks LP tokens in PinkLock

#### User Functions

##### `claimUSDT`
```solidity
function claimUSDT(uint256 amount)
    external
    nonReentrant
    whenNotPaused
    returns (bool)
```
- **Purpose**: Withdraw available USDT balance
- **Validations**: Sufficient balance

##### `claimPioToPioneChain`
```solidity
function claimPioToPioneChain(uint256 amount)
    external
    nonReentrant
    whenNotPaused
    returns (bool)
```
- **Purpose**: Bridge PIONE tokens back to PioneChain
- **Validations**:
  - Amount >= minimum claim amount (default: 1 PIO)
  - Sufficient PIO balance

#### View Functions

##### `getOptimalAmountUSDT`
```solidity
function getOptimalAmountUSDT(uint256 pioAmount)
    external
    view
    returns (uint256 optimalUsdtAmount)
```
- **Purpose**: Calculate optimal USDT amount for given PIO amount based on current pool ratio

##### `previewAddLiquidity`
```solidity
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
```
- **Purpose**: Preview liquidity addition before execution
- **Returns**: Actual amounts used, estimated LP tokens, and expected refunds

##### `getUserBalances`
```solidity
function getUserBalances(address account)
    external
    view
    returns (uint256 pioBalance, uint256 usdtBalance)
```

##### `getTransactionInfo`
```solidity
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
```

#### Admin Functions

##### `pause` / `unpause`
- **Access**: Only owner
- **Purpose**: Emergency pause/unpause contract operations

##### `setMinClaimPIOAmount`
```solidity
function setMinClaimPIOAmount(uint256 minAmount) external onlyOwner
```
- **Purpose**: Set minimum amount for PIO claims

##### `setPioneBridge`
```solidity
function setPioneBridge(address _pioneBridge) external onlyOwner
```
- **Purpose**: Update PioneChain bridge contract address

### Events

```solidity
event UserDepositUSDT(bytes32 indexed requestId, address indexed user, uint256 amount);
event LiquidityRequestCreated(bytes32 indexed requestId, address indexed user, uint256 amountPIO, uint256 amountUSDT, uint256 lockMonths);
event ClaimedPIOtoPioneChain(bytes32 indexed requestId, address indexed user, uint256 amount);
event ClaimedUSDT(address indexed account, uint256 amount);
event LiquidityAdded(address indexed user, bytes32 indexed requestId, uint256 pioAmount, uint256 usdtAmount, uint256 liquidity, uint256 slippage);
event LiquidityLocked(address indexed user, bytes32 indexed requestId, uint256 lockId, uint256 liquidity, uint256 unlockDate);
event UpdatedMinClaimPIOAmount(uint256 oldAmount, uint256 newAmount);
event PioneBridgeUpdated(address indexed oldAddress, address indexed newAddress);
```

## Installation

### Prerequisites

- Node.js >= 20.0.0
- npm or yarn
- Git

### Setup

1. Clone the repository:
```bash
git clone <repository-url>
cd PIONE-LIQUIDITY-MANAGER
```

2. Install dependencies:
```bash
npm install
```

3. Install Hardhat and required plugins:
```bash
npm install --save-dev hardhat @nomicfoundation/hardhat-toolbox hardhat-contract-sizer
```

4. Install OpenZeppelin contracts:
```bash
npm install @openzeppelin/contracts
```

## Configuration

### Environment Variables

Create a `.env` file in the project root:

```env
# Private key for deployment (without 0x prefix)
PRIVATE_KEY=your_private_key_here

# RPC endpoints
INFURA_KEY=your_infura_project_id

# Block explorer API key for contract verification
EXPLORER_API_KEY=your_bscscan_api_key

# Contract addresses for deployment
PIONE_TOKEN=0xB79c66fBB8BfE90a9E69D8250441c8DB363c40F2 # PIONE BEP20 token address on BSC
USDT_BEP20=0x55d398326f99059fF775485246999027B3197955 # USDT on BSC mainnet
PIONE_BRIDGE=0x5f101c442EE995Fb36725A043c82461aF34b2937 # PioneChain bridge contract address
PANCAKEROUTER=0x10ED43C718714eb63d5aA57B78B54704E256024E # PancakeSwap Router v2
PINKLOCK=0x407993575c91ce7643a4d4cCACc9A98c36eE1BBE # PinkLock contract address
PIONECHAIN_ID=5090 # Target chain ID for PioneChain
```

### Network Configuration

The project supports multiple networks configured in [hardhat.config.js](hardhat.config.js):

- **BSC Mainnet** (chainId: 56)
- **BSC Testnet** (chainId: 97)
- **PioneChain** (chainId: 5090)
- **PioneChain Zero** (chainId: 5080)
- **Ethereum Mainnet** (chainId: 1)
- **Sepolia Testnet** (chainId: 11155111)

## Deployment

### Deploy to BSC Testnet

```bash
npm run deploy:bscTestnet
```

This command:
1. Deploys the PioneLiquidityManager contract
2. Verifies the contract on BscScan automatically
3. Saves deployment artifacts to `./ignition/deployments/`

### Deploy to BSC Mainnet

```bash
npm run deploy:bsc
```

**Important:** Ensure all environment variables are correctly set before mainnet deployment.

### Manual Deployment

```bash
npx hardhat ignition deploy ./ignition/modules/PioneLiquidityManager.js --network <network-name> --verify
```

### Post-Deployment Steps

1. **Grant MANAGER_ROLE** to authorized addresses:
```javascript
await liquidityManager.grantRole(MANAGER_ROLE, managerAddress);
```

2. **Verify contract addresses**:
   - PIONE token
   - USDT token
   - PancakeSwap router
   - PinkLock
   - Bridge contract

3. **Set initial parameters**:
   - Minimum claim PIO amount
   - Bridge contract address (if not set in constructor)

## Usage

### For Users

#### 1. Bridge PIONE from PioneChain to BSC

First, bridge your PIONE tokens from PioneChain through the official bridge.

#### 2. Check Your Pending Request

```javascript
const balances = await liquidityManager.getUserBalances(userAddress);
console.log(`PIO Balance: ${ethers.formatEther(balances.pioBalance)}`);
console.log(`USDT Balance: ${ethers.formatEther(balances.usdtBalance)}`);
```

#### 3. Get Optimal USDT Amount

```javascript
const pioAmount = ethers.parseEther("1000");
const optimalUSDT = await liquidityManager.getOptimalAmountUSDT(pioAmount);
console.log(`Optimal USDT: ${ethers.formatEther(optimalUSDT)}`);
```

#### 4. Approve USDT

```javascript
const usdtContract = new ethers.Contract(USDT_ADDRESS, ERC20_ABI, signer);
await usdtContract.approve(liquidityManagerAddress, usdtAmount);
```

#### 5. Deposit USDT

```javascript
const tx = await liquidityManager.depositUSDT(requestId);
await tx.wait();
```

#### 6. Preview Liquidity Addition

```javascript
const preview = await liquidityManager.previewAddLiquidity(pioAmount, usdtAmount);
console.log(`Estimated LP tokens: ${ethers.formatEther(preview.estimatedLiquidity)}`);
console.log(`PIO refund: ${ethers.formatEther(preview.refundPio)}`);
console.log(`USDT refund: ${ethers.formatEther(preview.refundUsdt)}`);
```

#### 7. Add Liquidity with Slippage Protection

```javascript
const slippage = 5; // 5% slippage tolerance
const tx = await liquidityManager.addLiquidity(requestId, slippage);
await tx.wait();
```

#### 8. View Transaction Details

```javascript
const txInfo = await liquidityManager.getTransactionInfo(requestId);
console.log(`Liquidity Amount: ${ethers.formatEther(txInfo.liquidityAmount)}`);
console.log(`PinkLock ID: ${txInfo.pinkLockId}`);
console.log(`Lock Months: ${txInfo.lockMonths}`);
```

### For Managers

#### Process Bridge Completion

```javascript
await liquidityManager.handleBridgeCompleted(
    requestId,
    userAddress,
    pioAmount,
    usdtAmount,
    lockMonths
);
```

### For Administrators

#### Pause Contract (Emergency)

```javascript
await liquidityManager.pause();
```

#### Update Minimum Claim Amount

```javascript
const newMin = ethers.parseEther("10"); // 10 PIO minimum
await liquidityManager.setMinClaimPIOAmount(newMin);
```

## Testing

The project includes comprehensive test coverage with 100+ test cases covering:

- Core functionality
- Edge cases
- Security scenarios
- Access control
- Position 0 edge cases (critical for mapping validation)
- Reentrancy protection
- Pausable functionality

### Run Tests

```bash
npm test
```

Or with Hardhat:

```bash
npx hardhat test
```

### Test Coverage

```bash
npx hardhat coverage
```

### Key Test Scenarios

- ✅ Bridge completion handling
- ✅ USDT deposit flow
- ✅ Liquidity addition with various slippage settings
- ✅ Token refund mechanisms
- ✅ LP token locking
- ✅ Claim operations (USDT & PIO)
- ✅ Access control enforcement
- ✅ Pause/unpause functionality
- ✅ Request ID uniqueness validation
- ✅ Position 0 mapping edge cases
- ✅ Reentrancy attack prevention
- ✅ Multiple user interactions
- ✅ Sequential transaction handling

## Security

### Audited Patterns

- **OpenZeppelin Contracts**: Uses battle-tested OpenZeppelin libraries
- **ReentrancyGuard**: Protects against reentrancy attacks
- **AccessControl**: Role-based permission system
- **Pausable**: Emergency stop mechanism
- **SafeERC20**: Safe token transfer operations

### Security Considerations

1. **Request ID Validation**: Ensures each bridge transaction is processed only once
2. **Owner Verification**: All operations validate request ownership
3. **Balance Checks**: Validates sufficient balances before operations
4. **Slippage Protection**: User-configurable slippage tolerance
5. **Lock Period Validation**: Ensures minimum lock period > 0
6. **No Self-Destruct**: Contract cannot be destroyed
7. **Immutable Addresses**: Core token addresses are immutable

### Best Practices

- Always verify contract addresses before interaction
- Use appropriate slippage settings based on market conditions
- Monitor transaction events for unexpected behavior
- Keep private keys secure
- Test on testnet before mainnet deployment

## Contract Addresses

### BSC Mainnet

- **PIONE Token**: `0xB79c66fBB8BfE90a9E69D8250441c8DB363c40F2`
- **USDT (BEP20)**: `0x55d398326f99059fF775485246999027B3197955`
- **PancakeSwap Router v2**: `0x10ED43C718714eb63d5aA57B78B54704E256024E`
- **PinkLock**: `0x407993575c91ce7643a4d4cCACc9A98c36eE1BBE`
- **PioneLiquidityManager**: TBD

### PioneChain

- **PIONE Coin**: Native
- **Bridge Contract**: 0x5f101c442EE995Fb36725A043c82461aF34b2937

## Development

### Project Structure

```
PIONE-LIQUIDITY-MANAGER/
├── contracts/
│   ├── PioneLiquidityManager.sol      # Main contract
│   ├── interfaces/                     # Interface definitions
│   │   ├── IPancakeFactory.sol
│   │   ├── IPancakeRouter02.sol
│   │   ├── IPancakePair.sol
│   │   ├── IPioneChainBridge.sol
│   │   ├── IPinkLock.sol
│   │   └── IPioneLiquidityManager.sol
│   └── mocks/                          # Mock contracts for testing
│       ├── MockERC20.sol
│       ├── MockFactory.sol
│       ├── MockPancakeRouter.sol
│       ├── MockPancakePair.sol
│       ├── MockPioneChainBridge.sol
│       └── MockPinkLock.sol
├── test/
│   └── PioneLiquidityManager.js        # Comprehensive test suite
├── scripts/
│   └── action/
│       └── PIONE-token.js              # Utility scripts
├── ignition/
│   └── modules/
│       └── PioneLiquidityManager.js    # Deployment module
├── hardhat.config.js                   # Hardhat configuration
├── package.json
└── README.md
```

### Compile Contracts

```bash
npx hardhat compile
```

### Clean Build Artifacts

```bash
npx hardhat clean
```

## Troubleshooting

### Common Issues

**Issue: "Transaction not completed" error**
- **Solution**: Ensure the bridge transaction is processed before calling `handleBridgeCompleted`

**Issue: "RequestId already set"**
- **Solution**: Each requestId can only be used once. Use a unique requestId for each transaction

**Issue: "Insufficient balance"**
- **Solution**: Verify user has approved and has sufficient USDT/PIO balance

**Issue: "Slippage too high"**
- **Solution**: Reduce slippage percentage to <= 90%

**Issue: Deployment fails with "LP pair does not exist"**
- **Solution**: Ensure PIONE/USDT pair exists on PancakeSwap before deploying

## Contributing

Contributions are welcome! Please follow these guidelines:

1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Ensure all tests pass
5. Submit a pull request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Contact & Support

- **Project**: PIONE Liquidity Manager
- **Author**: Pione Labs
- **Documentation**: See inline code comments and test files
- **Issues**: Report bugs via GitHub Issues

## Acknowledgments

- OpenZeppelin for secure smart contract libraries
- PancakeSwap for DEX infrastructure
- PinkLock for liquidity locking mechanism
- Hardhat development environment

---

**⚠️ Disclaimer**: This software is provided "as is" without warranty of any kind. Users should conduct their own security audits before deploying to mainnet. Always test thoroughly on testnet first.
