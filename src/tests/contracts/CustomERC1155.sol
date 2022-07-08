// SPDX-License-Identifier: UNLICENSED

pragma solidity ^0.8.0;

import '@openzeppelin/contracts/token/ERC1155/ERC1155.sol';

contract CustomERC1155 is ERC1155 {
  constructor() public ERC1155('') {}

  function mint(address _account, uint256[] memory _supply) public {
    for (uint256 i = 0; i < _supply.length; i++) {
      _mint(_account, i, _supply[i], '');
    }
  }
}
