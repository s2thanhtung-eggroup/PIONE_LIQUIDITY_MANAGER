// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract MockFactory {
    address public pairAddress;

    function setPair(address _pair) external {
        pairAddress = _pair;
    }

    function getPair(address tokenA, address tokenB) external view returns (address) {
        return pairAddress;
    }
}
