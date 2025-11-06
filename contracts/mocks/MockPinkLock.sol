// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MockPinkLock {
    uint256 private lockIdCounter;

    struct Lock {
        address owner;
        address token;
        bool isLpToken;
        uint256 amount;
        uint256 unlockDate;
        string description;
    }

    mapping(uint256 => Lock) public locks;

    function lock(
        address owner,
        address token,
        bool isLpToken,
        uint256 amount,
        uint256 unlockDate,
        string memory description
    ) external returns (uint256 lockId) {
        // Transfer tokens to this contract
        IERC20(token).transferFrom(msg.sender, address(this), amount);

        lockIdCounter++;
        lockId = lockIdCounter;

        locks[lockId] = Lock({
            owner: owner,
            token: token,
            isLpToken: isLpToken,
            amount: amount,
            unlockDate: unlockDate,
            description: description
        });

        return lockId;
    }

    function getLock(uint256 lockId) external view returns (Lock memory) {
        return locks[lockId];
    }
}