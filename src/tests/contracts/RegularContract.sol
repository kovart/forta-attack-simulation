// SPDX-License-Identifier: UNLICENSED

pragma solidity ^0.8.0;

import '@openzeppelin/contracts/token/ERC20/ERC20.sol';

contract MyERC20Token is ERC20 {
  constructor() ERC20('Token20', 'T20') {
    _mint(msg.sender, 10000);
  }
}
