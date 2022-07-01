pragma solidity ^0.8.15;

contract SimpleStorage {
  uint256 storedData = 0;

  function set(uint256 x) public {
    storedData = x;
  }

  function get() public view returns (uint256) {
    return storedData;
  }
}
