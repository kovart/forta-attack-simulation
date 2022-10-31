# Attack Simulation Bot

## Description

The agent detects deployment of smart contracts containing an exploit function.

Using a [simulation-based approach](https://forta.org/blog/attack-simulation/),
the bot predicts the result of function execution within a local blockchain fork
and tracks any changes in balances of EOAs and the attacker's contract, allowing it to detect a potential attack before it occurs.

---

This bot keeps track of all the changes in the balances of the native, ERC20, ERC721 and ERC1155 tokens that have left their traces in the transaction logs.
It also takes into account negative changes in balances, as they help detect attacked projects,
as well as include these addresses in the alert, which can notify projects before the exploit is used, keeping the assets intact.

> At the moment, due to Ganache limitations, the bot cannot track changes in the native balance of EOAs (e.g. ETH, MATIC),
> unless the EOAs were seen in ERC20, ERC721, ERC1155 token events.

---

The bot scans each transaction for contract creation (including contracts created by contracts).
As soon as new contracts are detected, their code is fetched and translated into OPCODE.
This instruction machine code allows to find possible function selectors (4bytes) without having the [contract ABI](https://docs.soliditylang.org/en/v0.8.13/abi-spec.html).

The bot then launches a local fork of the blockchain, within which it tries to mimic the execution of the functions observing changes in the token balances.
To bring the simulation closer to real life, the bot performs transactions on behalf of the account that deployed the contract.

While most exploit functions do not take any parameters, the bot tries to cover cases where the function can take up to 5 different parameters.
It uses a clever way of determining the number of parameters, after which it is fuzzing them, shuffling potential values in various quantities.

The bot also supports calling of `payable` functions, to which it sends the amount of ether specified in the [configuration file](./bot-config.json).

## Configuration

You can configure the agent in the [bot-config.json](./bot-config.json) file.
Supported token standards: native (e.g. ETH, MATIC), ERC20, ERC721, ERC1155.

For native and ers20 tokens, the threshold value is specified in dollars. 
As soon as the total amount of dollars exceeds the threshold, the bot fires an alert.
You can specify this threshold value in `totalUsdTransferThreshold` field.

To determine the USD value of tokens, the [DefiLlama Api](https://defillama.com/docs/api) is used.

For tokens ERC721, ERC1155, the bot uses a threshold based on the total number of transferred tokens.
For example, by setting `threshold` to `10` for an ERC721 token, the bot will fire an alert if it detects that an account has taken ownership of 11 different tokens (token IDs). 
For ERC1155 tokens, the bot also takes into account the value of each of the internal tokens, and sums them into one number.


#### Example

```json
{
  "developerAbbreviation": "AK",
  "payableFunctionEtherValue": "10",
  "totalUsdTransferThreshold": "30000",
  "totalTokensThresholdsByChain": {
    "1": {
      "0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85": {
        "name": "ENS",
        "threshold": 10
      },
      "0x495f947276749Ce646f68AC8c248420045cb7b5e": {
        "name": "OpenSea Shared Storefront",
        "threshold": 10
      }
    }
  }
}
```

## Supported Chains

Chains with support for [Trace API](https://openethereum.github.io/JSONRPC-trace-module).

- Ethereum (1)

## Alerts

- AK-ATTACK-SIMULATION-0
  - Fired when an invoking function causes a large balance increase in an EOA or the contract containing the invoked function
  - Severity is always set to `critical`
  - Type is always set to `exploit`
  - Metadata:
    - `sighash` - function selector
    - `calldata` - function calldata
    - `contractAddress` - address of the deployed contract
    - `deployerAddress` - address of the contract deployer
    - `fundedAddress` - address where the significant increase in the balance has been found
    - `balanceChanges` - map object with arrays of balance changes for each account

## Test Data

You can verify the work of the agent by running it with the following transactions:

```bash
$ npm run tx 0x494b578bce7572e4fb8b1357ddf12754a28eec3439a62f6b14432dacda9cbb76
```

The result should be a finding of the Saddle Finance attack.

```js
Finding {
  "name": "Potential Exploit Function",
  "description": "Invocation of the function 0xaf8271f7 of the created contract 0x7336f819775b1d31ea472681d70ce7a903482191 leads to large balance increase in the contract deployer or function invoker account. Tokens transferred: 3,375.538166306826437272 WETH",
  "alertId": "AK-ATTACK-SIMULATION-0",
  "protocol": "ethereum",
  "severity": "Critical",
  "type": "Exploit",
  "metadata": {
    "sighash": "0xaf8271f7",
    "calldata": "",
    "contractAddress": "0x7336f819775b1d31ea472681d70ce7a903482191",
    "deployerAddress": "0x63341ba917de90498f3903b199df5699b4a55ac0",
    "balanceChanges": "{\"0x27182842e098f60e3d576794a5bffb0777e025d3\":[{\"name\":\"USDC\",\"type\":\"ERC20\",\"decimals\":6,\"address\":\"0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48\",\"value\":\"0\"}],\"0x7336f819775b1d31ea472681d70ce7a903482191\":[{\"name\":\"WETH\",\"type\":\"ERC20\",\"decimals\":18,\"address\":\"0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2\",\"value\":\"0\"},{\"name\":\"USDT\",\"type\":\"ERC20\",\"decimals\":6,\"address\":\"0xdac17f958d2ee523a2206206994597c13d831ec7\",\"value\":\"0\"},{\"name\":\"DAI\",\"type\":\"ERC20\",\"decimals\":18,\"address\":\"0x6b175474e89094c44da98b954eedeac495271d0f\",\"value\":\"0\"},{\"name\":\"saddleUSD-V2\",\"type\":\"ERC20\",\"decimals\":18,\"address\":\"0x5f86558387293b6009d7896a61fcc86c17808d62\",\"value\":\"0\"},{\"name\":\"sUSD\",\"type\":\"ERC20\",\"decimals\":18,\"address\":\"0x57ab1ec28d129707052df4df418d58a2d46d5f51\",\"value\":\"0\"},{\"name\":\"dUSDC\",\"type\":\"ERC20\",\"decimals\":6,\"address\":\"0x84721a3db22eb852233aeae74f9bc8477f8bcc42\",\"value\":\"0\"},{\"name\":\"USDC\",\"type\":\"ERC20\",\"decimals\":6,\"address\":\"0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48\",\"value\":\"0\"}],\"0x0000000000000000000000000000000000000000\":[{\"name\":\"saddleUSD-V2\",\"type\":\"ERC20\",\"decimals\":18,\"address\":\"0x5f86558387293b6009d7896a61fcc86c17808d62\",\"value\":\"5.016537096730963109713838e+24\"},{\"name\":\"ETH\",\"type\":\"native\",\"decimals\":18,\"address\":\"native\",\"value\":\"1817975000000000\"},{\"name\":\"dUSDC\",\"type\":\"ERC20\",\"decimals\":6,\"address\":\"0x84721a3db22eb852233aeae74f9bc8477f8bcc42\",\"value\":\"0\"}],\"0xa5407eae9ba41422680e2e00537571bcc53efbfd\":[{\"name\":\"sUSD\",\"type\":\"ERC20\",\"decimals\":18,\"address\":\"0x57ab1ec28d129707052df4df418d58a2d46d5f51\",\"value\":\"5.288082139740971886935251e+24\"},{\"name\":\"DAI\",\"type\":\"ERC20\",\"decimals\":18,\"address\":\"0x6b175474e89094c44da98b954eedeac495271d0f\",\"value\":\"1.810723455638732389504479e+24\"},{\"name\":\"USDT\",\"type\":\"ERC20\",\"decimals\":6,\"address\":\"0xdac17f958d2ee523a2206206994597c13d831ec7\",\"value\":\"1530488975938\"},{\"name\":\"USDC\",\"type\":\"ERC20\",\"decimals\":6,\"address\":\"0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48\",\"value\":\"-8600828847387\"}],\"0x824dcd7b044d60df2e89b1bb888e66d8bcf41491\":[{\"name\":\"saddleUSD-V2\",\"type\":\"ERC20\",\"decimals\":18,\"address\":\"0x5f86558387293b6009d7896a61fcc86c17808d62\",\"value\":\"-5.016537096730963109713838e+24\"},{\"name\":\"sUSD\",\"type\":\"ERC20\",\"decimals\":18,\"address\":\"0x57ab1ec28d129707052df4df418d58a2d46d5f51\",\"value\":\"-5.288082139740971886935251e+24\"}],\"0xacb83e0633d6605c5001e2ab59ef3c745547c8c7\":[{\"name\":\"USDT\",\"type\":\"ERC20\",\"decimals\":6,\"address\":\"0xdac17f958d2ee523a2206206994597c13d831ec7\",\"value\":\"-1530488975938\"},{\"name\":\"USDC\",\"type\":\"ERC20\",\"decimals\":6,\"address\":\"0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48\",\"value\":\"-1691981791323\"},{\"name\":\"DAI\",\"type\":\"ERC20\",\"decimals\":18,\"address\":\"0x6b175474e89094c44da98b954eedeac495271d0f\",\"value\":\"-1.810723455638732389504479e+24\"}],\"0xb4e16d0168e52d35cacd2c6185b44281ec28c9dc\":[{\"name\":\"USDC\",\"type\":\"ERC20\",\"decimals\":6,\"address\":\"0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48\",\"value\":\"10292810638710\"},{\"name\":\"WETH\",\"type\":\"ERC20\",\"decimals\":18,\"address\":\"0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2\",\"value\":\"-3.375538166306826437272e+21\"}],\"0x63341ba917de90498f3903b199df5699b4a55ac0\":[{\"name\":\"WETH\",\"type\":\"ERC20\",\"decimals\":18,\"address\":\"0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2\",\"value\":\"3.375538166306826437272e+21\"}]}"
  },
  "addresses": [
    "0x63341ba917de90498f3903b199df5699b4a55ac0",
    "0x7336f819775b1d31ea472681d70ce7a903482191",
    "0x27182842e098f60e3d576794a5bffb0777e025d3",
    "0x0000000000000000000000000000000000000000",
    "0xa5407eae9ba41422680e2e00537571bcc53efbfd",
    "0x824dcd7b044d60df2e89b1bb888e66d8bcf41491",
    "0xacb83e0633d6605c5001e2ab59ef3c745547c8c7",
    "0xb4e16d0168e52d35cacd2c6185b44281ec28c9dc",
    "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    "0x84721a3db22eb852233aeae74f9bc8477f8bcc42",
    "0x57ab1ec28d129707052df4df418d58a2d46d5f51",
    "0xdac17f958d2ee523a2206206994597c13d831ec7",
    "0x6b175474e89094c44da98b954eedeac495271d0f",
    "0x5f86558387293b6009d7896a61fcc86c17808d62",
    "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"
  ]
}

```

---

```bash
$ npm run tx 0xb00e71f0e812d383b618cf316a9ccf30a0c9c7f0036a469a32e651aba591bd7d
```

The result should be a finding of the Devour attack.

```js
Finding {
  "name": "Potential Exploit Function",
  "description": "Invocation of the function 0x58581246 of the created contract 0x9e7f9123ce12060ec844ac56de047cc50a827201 leads to large balance increase in the contract deployer or function invoker account. Tokens transferred: 12.597815986560374826 ETH",
  "alertId": "AK-ATTACK-SIMULATION-0",
  "protocol": "ethereum",
  "severity": "Critical",
  "type": "Exploit",
  "metadata": {
    "sighash": "0x58581246",
    "calldata": "00000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000000",
    "contractAddress": "0x9e7f9123ce12060ec844ac56de047cc50a827201",
    "deployerAddress": "0x9448368ff76b6698c59ca940b1ee2bf7fba0bc21",
    "balanceChanges": "{\"0x7a250d5630b4cf539739df2c5dacb4c659f2488d\":[{\"name\":\"WETH\",\"type\":\"ERC20\",\"decimals\":18,\"address\":\"0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2\",\"value\":\"12597815986560374826\"}],\"0xf0fce5d65a42470a314fb440327cf564cca7c9d9\":[{\"name\":\"WETH\",\"type\":\"ERC20\",\"decimals\":18,\"address\":\"0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2\",\"value\":\"133700055419679093\"},{\"name\":\"RESTAURANTS\",\"type\":\"ERC20\",\"decimals\":18,\"address\":\"0xdffc63f92c939deb112d88735ade3b4d21b6d491\",\"value\":\"-9.7e+30\"}],\"0x9e7f9123ce12060ec844ac56de047cc50a827201\":[{\"name\":\"DPAY\",\"type\":\"ERC20\",\"decimals\":18,\"address\":\"0xe5a733681bbe6cd8c764bb8078ef8e13a576dd78\",\"value\":\"0\"},{\"name\":\"RESTAURANTS\",\"type\":\"ERC20\",\"decimals\":18,\"address\":\"0xdffc63f92c939deb112d88735ade3b4d21b6d491\",\"value\":\"-2.70081024307292187656296889e+27\"}],\"0xdffc63f92c939deb112d88735ade3b4d21b6d491\":[{\"name\":\"RESTAURANTS\",\"type\":\"ERC20\",\"decimals\":18,\"address\":\"0xdffc63f92c939deb112d88735ade3b4d21b6d491\",\"value\":\"5e+29\"}],\"0x000000000000000000000000000000000000dead\":[{\"name\":\"RESTAURANTS\",\"type\":\"ERC20\",\"decimals\":18,\"address\":\"0xdffc63f92c939deb112d88735ade3b4d21b6d491\",\"value\":\"2e+29\"}],\"0x308ad7d6e99a36a516ca311510f62052c336084d\":[{\"name\":\"RESTAURANTS\",\"type\":\"ERC20\",\"decimals\":18,\"address\":\"0xdffc63f92c939deb112d88735ade3b4d21b6d491\",\"value\":\"9.00270081024307292187656296889e+30\"},{\"name\":\"DPAY\",\"type\":\"ERC20\",\"decimals\":18,\"address\":\"0xe5a733681bbe6cd8c764bb8078ef8e13a576dd78\",\"value\":\"-9.002700810243072921876562e+24\"}],\"0x4cbcff3e46a106793a972ea7051dfd028f34517a\":[{\"name\":\"DPAY\",\"type\":\"ERC20\",\"decimals\":18,\"address\":\"0xe5a733681bbe6cd8c764bb8078ef8e13a576dd78\",\"value\":\"9.002700810243072921876562e+24\"},{\"name\":\"WETH\",\"type\":\"ERC20\",\"decimals\":18,\"address\":\"0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2\",\"value\":\"-12731516041980053919\"}],\"0x9448368ff76b6698c59ca940b1ee2bf7fba0bc21\":[{\"name\":\"ETH\",\"type\":\"native\",\"decimals\":18,\"address\":\"native\",\"value\":\"12597815986560374826\"}]}"
  },
  "addresses": [
    "0x9448368ff76b6698c59ca940b1ee2bf7fba0bc21",
    "0x9e7f9123ce12060ec844ac56de047cc50a827201",
    "0x7a250d5630b4cf539739df2c5dacb4c659f2488d",
    "0xf0fce5d65a42470a314fb440327cf564cca7c9d9",
    "0xdffc63f92c939deb112d88735ade3b4d21b6d491",
    "0x000000000000000000000000000000000000dead",
    "0x308ad7d6e99a36a516ca311510f62052c336084d",
    "0x4cbcff3e46a106793a972ea7051dfd028f34517a",
    "0xe5a733681bbe6cd8c764bb8078ef8e13a576dd78",
    "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"
  ]
}
```
