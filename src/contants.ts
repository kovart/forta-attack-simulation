// https://etherscan.io/accounts/label/burn?subcatid=1&size=100&start=0&col=1&order=asc
export const BURN_ADDRESSES = [
  '0x00000000000000000000045261d4ee77acdb3286',
  '0x0123456789012345678901234567890123456789',
  '0x1234567890123456789012345678901234567890',
  '0x1111111111111111111111111111111111111111',
  '0x2222222222222222222222222222222222222222',
  '0x3333333333333333333333333333333333333333',
  '0x4444444444444444444444444444444444444444',
  '0x5555555555555555555555555555555555555555',
  '0x6666666666666666666666666666666666666666',
  '0x7777777777777777777777777777777777777777',
  '0x8888888888888888888888888888888888888888',
  '0x9999999999999999999999999999999999999999',
  '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  '0xdead000000000000000042069420694206942069',
  '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
  '0xffffffffffffffffffffffffffffffffffffffff',
  '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  '0x000000000000000000000000000000000000dead',
];

export const BASE_SHARDING_CONFIG = {
  '1': {
    shards: 11,
    target: 2,
  },
  '10': {
    shards: 10,
    target: 2,
  },
  '56': {
    shards: 10,
    target: 2,
  },
  '137': {
    shards: 10,
    target: 2,
  },
  '250': {
    shards: 11,
    target: 2,
  },
  '42161': {
    shards: 11,
    target: 2,
  },
  '43114': {
    shards: 11,
    target: 2,
  },
  default: {
    shards: 10,
    target: 2,
  },
};

export const TARGETED_SHARDING_CONFIG = {
  default: {
    shards: 5,
    target: 2,
  },
};
