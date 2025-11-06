// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IFactory {
    function getPair(address tokenA, address tokenB) external view returns (address);
}

contract MockPancakeRouter {
    address public factory;

    function setFactory(address _factory) external {
        factory = _factory;
    }

    function addLiquidity(
        address tokenA,
        address tokenB,
        uint amountADesired,
        uint amountBDesired,
        uint /* amountAMin */,
        uint /* amountBMin */,
        address to,
        uint /* deadline */
    ) external returns (uint amountA, uint amountB, uint liquidity) {
        // Transfer tokens from sender
        IERC20(tokenA).transferFrom(msg.sender, address(this), amountADesired);
        IERC20(tokenB).transferFrom(msg.sender, address(this), amountBDesired);

        // Mock return values (95% of desired amounts for testing slippage)
        amountA = amountADesired * 95 / 100;
        amountB = amountBDesired * 95 / 100;
        liquidity = (amountA + amountB) / 2; // Simple mock calculation

        // Get LP token address from factory
        address lpToken = IFactory(factory).getPair(tokenA, tokenB);
        IERC20(lpToken).transfer(to, liquidity);

        return (amountA, amountB, liquidity);
    }

    function quote(uint amountA, uint reserveA, uint reserveB) external pure returns (uint amountB) {
        require(amountA > 0, "INSUFFICIENT_AMOUNT");
        require(reserveA > 0 && reserveB > 0, "INSUFFICIENT_LIQUIDITY");
        amountB = (amountA * reserveB) / reserveA;
    }
}