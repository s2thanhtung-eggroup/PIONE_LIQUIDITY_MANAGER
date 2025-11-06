// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockPancakePair is ERC20 {
    uint112 private reserve0;
    uint112 private reserve1;
    uint32 private blockTimestampLast;

    address private _token0;
    address private _token1;
    address private _factory;

    constructor(
        string memory name,
        string memory symbol,
        uint256 initialSupply
    ) ERC20(name, symbol) {
        _mint(msg.sender, initialSupply);
    }

    function setReserves(uint112 _reserve0, uint112 _reserve1) external {
        reserve0 = _reserve0;
        reserve1 = _reserve1;
        blockTimestampLast = uint32(block.timestamp);
    }

    function setTokens(address token0_, address token1_) external {
        _token0 = token0_;
        _token1 = token1_;
    }

    function setFactory(address factory_) external {
        _factory = factory_;
    }

    function getReserves() external view returns (uint112 _reserve0, uint112 _reserve1, uint32 _blockTimestampLast) {
        _reserve0 = reserve0;
        _reserve1 = reserve1;
        _blockTimestampLast = blockTimestampLast;
    }

    function token0() external view returns (address) {
        return _token0;
    }

    function token1() external view returns (address) {
        return _token1;
    }

    function factory() external view returns (address) {
        return _factory;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function MINIMUM_LIQUIDITY() external pure returns (uint) {
        return 1000;
    }

    function price0CumulativeLast() external pure returns (uint) {
        return 0;
    }

    function price1CumulativeLast() external pure returns (uint) {
        return 0;
    }

    function kLast() external pure returns (uint) {
        return 0;
    }
}
