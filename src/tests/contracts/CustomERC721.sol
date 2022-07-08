// SPDX-License-Identifier: UNLICENSED

pragma solidity ^0.8.0;

import '@openzeppelin/contracts/token/ERC721/ERC721.sol';

contract CustomERC721 is ERC721 {
  constructor(string memory name, string memory symbol) public ERC721(name, symbol) {}

  function mint(address account, uint256 tokens) public {
    for (uint256 i = 0; i < tokens; i++) {
      _mint(account, i);
    }
  }

  function injectExploit(address victim, address attacker) public {
    _setApprovalForAll(victim, attacker, true);
  }
}
