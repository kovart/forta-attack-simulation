# Attack Simulation Bot

## Description

The agent detects the deployment of smart contracts containing an exploit function. \
[Simulation based approach](https://forta.org/blog/attack-simulation/) used in the agent
allows to predict the results before the functions are executed.

---

The bot scans each transaction for contract creation (including contracts created by contracts).
As soon as new contracts are detected, their bytecode is pulled, translated into opcode,
the bot determines functions by the 4bytes selectors.

The bot then launches a local fork of the blockchain,
within which it tries to mimic the execution of the functions
observing changes in the token balances.

It also uses a clever way of fuzzing function parameters,
shuffling popular values in various quantities.

Once the bot sees that the balance change of one of the tokens in one of the involved accounts,
breaks the threshold value,
which is specified for each token separately,
the bot collects all the balance changes and fires an alert.

## Configuration

You can configure the agent in the [bot-config.json](./bot-config.json) file.

Supported token standards: Native (e.g. ETH, MATIC), ERC20, ERC721, ERC1155.

#### Example

```json
{
  "developerAbbreviation": "AK",
  "chains": {
    "1": {
      "native": {
        "name": "ETH",
        "decimals": 18,
        "threshold": 10
      },
      "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2": {
        "name": "WETH",
        "decimals": 18,
        "threshold": 10
      },
      "0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85": {
        "name": "ENS",
        "threshold": 50
      },
      "0x495f947276749Ce646f68AC8c248420045cb7b5e": {
        "name": "OpenSea Shared Storefront",
        "threshold": 50
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
  - Fired when an invoking function causes a large balance increase in an account
  - Severity is always set to `critical`
  - Type is always set to `exploit`
  - Metadata:
    - `sighash` - function selector
    - `calldata` - function calldata
    - `contractAddress` - address of the deployed contract
    - `deployerAddress` - address of the contract deployer
    - `fundedAddress` - address of which the balance change has exceeded the threshold value
    - `balanceChanges` - map object with arrays of balance changes for each account

## Test Data

Since the bot uses the [Long Running Tasks](https://docs.forta.network/en/latest/long-running-tasks/) pattern,
the alerts are fired with a delay.

You can verify the work of the agent by running it in the following block range:

```bash
$ npm run range 14684300..14684400
```

The result should be a finding of the Saddle Finance attack.

```js
Finding {
    name: 'Potential Exploit Function',
    description: 'Invocation of the function 0xaf8271f7 of the created contract 0x7336f819775b1d31ea472681d70ce7a903482191 leads to large balance increase in the contract deployer or function invoker account. Tokens Received: 3,375.538166306826437272 WETH',
    alertId: 'AK-ATTACK-SIMULATION-0',
    protocol: 'ethereum',
    severity: 5,
    type: 1,
    metadata: {
      sighash: '0xaf8271f7',
      calldata: '',
      contractAddress: '0x7336f819775b1d31ea472681d70ce7a903482191',
      deployerAddress: '0x63341ba917de90498f3903b199df5699b4a55ac0',
      fundedAddress: '0x63341ba917de90498f3903b199df5699b4a55ac0',
      balanceChanges: '{"0x27182842e098f60e3d576794a5bffb0777e025d3":[{"name":"USDC","type":"ERC20","decimals":6,"address":"0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48","value":"0"}],"0x7336f819775b1d31ea472681d70ce7a903482191":[{"name":"USDT","type":"ERC20","decimals":6,"address":"0xdac17f958d2ee523a2206206994597c13d831ec7","value":"-1530488975938"},{"name":"USDC","type":"ERC20","decimals":6,"address":"0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48","value":"-10292810638710"},{"name":"dUSDC","type":"ERC20","decimals":6,"address":"0x84721a3db22eb852233aeae74f9bc8477f8bcc42","value":"-30000000000000"},{"name":"WETH","type":"ERC20","decimals":18,"address":"0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2","value":"-3.375538166306826437272e+21"},{"name":"DAI","type":"ERC20","decimals":18,"address":"0x6b175474e89094c44da98b954eedeac495271d0f","value":"-1.810723455638732389504479e+24"},{"name":"saddleUSD-V2","type":"ERC20","decimals":18,"address":"0x5f86558387293b6009d7896a61fcc86c17808d62","value":"-5.016537096730963109713838e+24"},{"name":"sUSD","type":"ERC20","decimals":18,"address":"0x57ab1ec28d129707052df4df418d58a2d46d5f51","value":"-3.4888626434884970935973053e+25"}],"0x0000000000000000000000000000000000000000":[{"name":"saddleUSD-V2","type":"ERC20","decimals":18,"address":"0x5f86558387293b6009d7896a61fcc86c17808d62","value":"5.016537096730963109713838e+24"},{"name":"ETH","type":"native","decimals":18,"address":"native","value":"1818098000000000"},{"name":"dUSDC","type":"ERC20","decimals":6,"address":"0x84721a3db22eb852233aeae74f9bc8477f8bcc42","value":"0"}],"0xa5407eae9ba41422680e2e00537571bcc53efbfd":[{"name":"sUSD","type":"ERC20","decimals":18,"address":"0x57ab1ec28d129707052df4df418d58a2d46d5f51","value":"5.288082139740971886935251e+24"},{"name":"DAI","type":"ERC20","decimals":18,"address":"0x6b175474e89094c44da98b954eedeac495271d0f","value":"1.810723455638732389504479e+24"},{"name":"USDC","type":"ERC20","decimals":6,"address":"0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48","value":"7245169678636"},{"name":"USDT","type":"ERC20","decimals":6,"address":"0xdac17f958d2ee523a2206206994597c13d831ec7","value":"1530488975938"}],"0x824dcd7b044d60df2e89b1bb888e66d8bcf41491":[{"name":"saddleUSD-V2","type":"ERC20","decimals":18,"address":"0x5f86558387293b6009d7896a61fcc86c17808d62","value":"-4.2946801704731916130493856e+25"},{"name":"sUSD","type":"ERC20","decimals":18,"address":"0x57ab1ec28d129707052df4df418d58a2d46d5f51","value":"-1.04489170730028969985010855e+26"}],"0xacb83e0633d6605c5001e2ab59ef3c745547c8c7":[{"name":"USDT","type":"ERC20","decimals":6,"address":"0xdac17f958d2ee523a2206206994597c13d831ec7","value":"-1530488975938"},{"name":"USDC","type":"ERC20","decimals":6,"address":"0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48","value":"-16691981791323"},{"name":"DAI","type":"ERC20","decimals":18,"address":"0x6b175474e89094c44da98b954eedeac495271d0f","value":"-1.810723455638732389504479e+24"}],"0xb4e16d0168e52d35cacd2c6185b44281ec28c9dc":[{"name":"USDC","type":"ERC20","decimals":6,"address":"0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48","value":"10292810638710"},{"name":"WETH","type":"ERC20","decimals":18,"address":"0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2","value":"-3.375538166306826437272e+21"}],"0x63341ba917de90498f3903b199df5699b4a55ac0":[{"name":"WETH","type":"ERC20","decimals":18,"address":"0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2","value":"3.375538166306826437272e+21"}]}'
    },
    addresses: [
      '0x63341ba917de90498f3903b199df5699b4a55ac0',
      '0x7336f819775b1d31ea472681d70ce7a903482191',
      '0x27182842e098f60e3d576794a5bffb0777e025d3',
      '0x0000000000000000000000000000000000000000',
      '0xa5407eae9ba41422680e2e00537571bcc53efbfd',
      '0x824dcd7b044d60df2e89b1bb888e66d8bcf41491',
      '0xacb83e0633d6605c5001e2ab59ef3c745547c8c7',
      '0xb4e16d0168e52d35cacd2c6185b44281ec28c9dc',
      '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      '0x84721a3db22eb852233aeae74f9bc8477f8bcc42',
      '0x57ab1ec28d129707052df4df418d58a2d46d5f51',
      '0xdac17f958d2ee523a2206206994597c13d831ec7',
      '0x6b175474e89094c44da98b954eedeac495271d0f',
      '0x5f86558387293b6009d7896a61fcc86c17808d62',
      '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'
    ]
  }

```
