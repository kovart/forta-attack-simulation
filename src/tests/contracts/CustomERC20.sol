// SPDX-License-Identifier: UNLICENSED

pragma solidity ^0.8.0;

import '@openzeppelin/contracts/token/ERC20/ERC20.sol';

contract CustomERC20 is ERC20 {
  uint8 _decimals;

  constructor(string memory name, string memory symbol, uint8 decimals) public ERC20(name, symbol) {
    _decimals = decimals;
  }

  function mint(address account, uint256 supply) public {
    _mint(account, supply);
  }

  function decimals() public view override returns(uint8) {
    return _decimals;
  }
}
