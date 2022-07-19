import { BigNumber as EtherBigNumber, ethers, utils } from 'ethers';
import { EVM } from 'evm';
import Ganache from 'ganache';
import { getJsonRpcUrl, TransactionEvent } from 'forta-agent';
import { BaseN } from 'js-combinatorics';
import { CreatedContract, TokenInterface } from './types';
import BigNumber from 'bignumber.js';
import { LogDescription } from 'ethers/lib/utils';
import Erc20Abi from './abi/erc20.json';
import Erc721Abi from './abi/erc721.json';
import Erc1155Abi from './abi/erc1155.json';

const erc20Iface = new ethers.utils.Interface(Erc20Abi);
const erc721Iface = new ethers.utils.Interface(Erc721Abi);
const erc1155Iface = new ethers.utils.Interface(Erc1155Abi);

export function getEthersForkProvider(blockNumber: number, unlockedAccounts: string[]) {
  return new ethers.providers.Web3Provider(
    Ganache.provider({
      logging: { quiet: true },
      fork: {
        url: getJsonRpcUrl(),
        blockNumber: blockNumber,
      },
      wallet: {
        totalAccounts: 1,
        defaultBalance: 100000,
        unlockedAccounts: unlockedAccounts,
      },
    }) as any,
  );
}

export function getSighashes(code: string) {
  const evm = new EVM(code);
  const opcodes = evm.getOpcodes();

  const sighashes: string[] = [];

  for (let i = 0; i < opcodes.length - 3; i++) {
    if (
      opcodes[i].name === 'PUSH4' &&
      opcodes[i + 1].name === 'EQ' &&
      opcodes[i + 2].name.indexOf('PUSH') === 0 &&
      opcodes[i + 3].name === 'JUMPI'
    ) {
      sighashes.push('0x' + opcodes[i].pushData.toString('hex'));
    }
  }

  return sighashes;
}

export function* generateCallData(opts: { words: number; addresses: string[] }) {
  const { words, addresses } = opts;

  if (words === 0) {
    yield '';
  } else {
    const params = [
      utils.defaultAbiCoder.encode(['uint256'], [0]),
      utils.defaultAbiCoder.encode(['uint256'], [1]),
      utils.defaultAbiCoder.encode(['uint256'], [EtherBigNumber.from(10).pow(18)]),
      utils.defaultAbiCoder.encode(['uint256'], [EtherBigNumber.from(10).pow(22)]),
      utils.defaultAbiCoder.encode(['uint256'], [ethers.constants.MaxUint256]),
      ...addresses.map((address) => utils.defaultAbiCoder.encode(['address'], [address])),
    ].map((v) => v.slice(2));

    const it = new BaseN(params, words);

    for (const group of it) {
      yield group.join('');
    }
  }
}

export async function getBalanceChanges(params: {
  tx: ethers.providers.TransactionResponse;
  receipt: ethers.providers.TransactionReceipt;
  provider: ethers.providers.Web3Provider;
}) {
  const { tx, receipt, provider } = params;
  // to unify data with different erc standards, native and erc20 tokens have their own token ID, which is always 0
  const generalTokenId = 0;

  const balanceChangesByAccount: {
    [account: string]: { [tokenAddress: string]: { [tokenId: string]: BigNumber } };
  } = {};
  const interfacesByToken: {
    [tokenAddress: string]: TokenInterface;
  } = {};

  const prepareLogs = (iface: ethers.utils.Interface, logs: ethers.providers.Log[]) =>
    logs
      .map((l) => {
        try {
          return {
            parsedLog: iface.parseLog(l),
            tokenAddress: l.address.toLowerCase(),
          };
        } catch (e) {
          return {};
        }
      })
      .filter((v) => v.parsedLog) as { parsedLog: LogDescription; tokenAddress: string }[];

  const erc20Logs = prepareLogs(erc20Iface, receipt.logs);
  const erc721Logs = prepareLogs(erc721Iface, receipt.logs);
  const erc1155Logs = prepareLogs(erc1155Iface, receipt.logs);

  for (const { parsedLog, tokenAddress } of erc20Logs) {
    if (parsedLog.name === 'Transfer') {
      const from = parsedLog.args.from.toLowerCase();
      const to = parsedLog.args.to.toLowerCase();
      const value = parsedLog.args.value.toString();
      interfacesByToken[tokenAddress] = TokenInterface.ERC20;
      balanceChangesByAccount[from] = balanceChangesByAccount[from] || {};
      balanceChangesByAccount[to] = balanceChangesByAccount[to] || {};
      balanceChangesByAccount[from][tokenAddress] = balanceChangesByAccount[from][tokenAddress] || {
        [generalTokenId]: new BigNumber(0),
      };
      balanceChangesByAccount[to][tokenAddress] = balanceChangesByAccount[to][tokenAddress] || {
        [generalTokenId]: new BigNumber(0),
      };
      // subtract transferred value
      balanceChangesByAccount[from][tokenAddress][generalTokenId] =
        balanceChangesByAccount[from][tokenAddress][generalTokenId].minus(value);
      // add transferred value
      balanceChangesByAccount[to][tokenAddress][generalTokenId] =
        balanceChangesByAccount[to][tokenAddress][generalTokenId].plus(value);
    }
  }

  for (const { parsedLog, tokenAddress } of erc721Logs) {
    if (parsedLog.name === 'Transfer') {
      const from = parsedLog.args.from.toLowerCase();
      const to = parsedLog.args.to.toLowerCase();
      const tokenId = parsedLog.args.tokenId.toString();
      interfacesByToken[tokenAddress] = TokenInterface.ERC721;
      balanceChangesByAccount[from] = balanceChangesByAccount[from] || {};
      balanceChangesByAccount[to] = balanceChangesByAccount[to] || {};
      balanceChangesByAccount[from][tokenAddress] =
        balanceChangesByAccount[from][tokenAddress] || {};
      balanceChangesByAccount[to][tokenAddress] = balanceChangesByAccount[to][tokenAddress] || {};
      balanceChangesByAccount[from][tokenAddress][tokenId] = new BigNumber(-1);
      balanceChangesByAccount[to][tokenAddress][tokenId] = new BigNumber(1);
    }
  }

  for (const { parsedLog, tokenAddress } of erc1155Logs) {
    if (!['TransferSingle', 'TransferBatch'].includes(parsedLog.name)) continue;

    const from = parsedLog.args.from.toLowerCase();
    const to = parsedLog.args.to.toLowerCase();
    interfacesByToken[tokenAddress] = TokenInterface.ERC1155;
    balanceChangesByAccount[to] = balanceChangesByAccount[to] || {};
    balanceChangesByAccount[from] = balanceChangesByAccount[from] || {};
    balanceChangesByAccount[from][tokenAddress] = balanceChangesByAccount[from][tokenAddress] || {};
    balanceChangesByAccount[to][tokenAddress] = balanceChangesByAccount[to][tokenAddress] || {};
    if (parsedLog.name === 'TransferSingle') {
      const tokenId = parsedLog.args.id.toString();
      const value = parsedLog.args.value.toString();
      // add value of transferred token
      balanceChangesByAccount[from][tokenAddress][tokenId] = (
        balanceChangesByAccount[from][tokenAddress][tokenId] || new BigNumber(0)
      ).minus(value);
      balanceChangesByAccount[to][tokenAddress][tokenId] = (
        balanceChangesByAccount[to][tokenAddress][tokenId] || new BigNumber(0)
      ).plus(value);
    } else if (parsedLog.name === 'TransferBatch') {
      const tokenIds = parsedLog.args.ids;
      const values = parsedLog.args[4]; // "values" is an already reserved word
      for (let i = 0; i < tokenIds.length; i++) {
        const tokenId = tokenIds[i].toString();
        const value = values[i].toString();
        // subtract value of transferred token
        balanceChangesByAccount[from][tokenAddress][tokenId] = (
          balanceChangesByAccount[from][tokenAddress][tokenId] || new BigNumber(0)
        ).minus(value);
        // add value of transferred token
        balanceChangesByAccount[to][tokenAddress][tokenId] = (
          balanceChangesByAccount[to][tokenAddress][tokenId] || new BigNumber(0)
        ).plus(value);
      }
    }
  }

  const sender = tx.from.toLowerCase();
  const destination = tx.to!.toLowerCase();
  interfacesByToken['native'] = TokenInterface.NATIVE;
  for (const account of new Set([...Object.keys(balanceChangesByAccount), sender, destination])) {
    const initialEthBalance = new BigNumber(
      (await provider.getBalance(account, tx.blockNumber! - 1)).toString(),
    );
    const finalEthBalance = new BigNumber(
      (await provider.getBalance(account, tx.blockNumber)).toString(),
    );

    // subtract transaction cost so that the sender has "pure" transferred value
    const gasCost = sender === account ? receipt.gasUsed.mul(tx.gasPrice!).toString() : 0;
    const diff = finalEthBalance.minus(initialEthBalance).plus(gasCost);
    if (!diff.isZero()) {
      balanceChangesByAccount[account] = balanceChangesByAccount[account] || {};
      balanceChangesByAccount[account]['native'] = {
        [generalTokenId]: diff,
      };
    }
  }

  return { balanceChangesByAccount, interfacesByToken };
}

export async function getTokenNames(params: {
  addresses: string[];
  knownTokens?: { [address: string]: { name?: string } };
  provider: ethers.providers.Web3Provider;
}) {
  const { addresses, knownTokens = {}, provider } = params;
  const map: { [address: string]: string } = {};

  await Promise.all(
    addresses.map(async (address) => {
      if (knownTokens[address]?.name) {
        map[address] = knownTokens[address].name!;
        return;
      }

      let symbol, name;
      const contract = new ethers.Contract(address, erc20Iface, provider);

      try {
        symbol = await contract.symbol();
        // eslint-disable-next-line no-empty
      } catch {}

      if (!symbol) {
        try {
          name = await contract.name();
          // eslint-disable-next-line no-empty
        } catch {}
      }

      if (symbol || name) {
        map[address] = symbol || name;
      }
    }),
  );

  return map;
}

export async function getTokenDecimals(params: {
  addresses: string[];
  knownTokens?: { [address: string]: { decimals?: number } };
  provider: ethers.providers.Web3Provider;
}) {
  const { addresses, knownTokens = {}, provider } = params;

  const map: { [address: string]: number } = {};

  await Promise.all(
    addresses.map(async (address) => {
      if (knownTokens[address]?.decimals != null) {
        map[address] = knownTokens[address].decimals!;
        return;
      }

      const contract = new ethers.Contract(address, erc20Iface, provider);

      try {
        const decimals = await contract.decimals();
        if (decimals != null) {
          map[address] = decimals;
        }
        // eslint-disable-next-line no-empty
      } catch {}
    }),
  );

  return map;
}

export function getCreatedContracts(txEvent: TransactionEvent): CreatedContract[] {
  const createdContracts: CreatedContract[] = [];
  const sender = txEvent.from.toLowerCase();

  // in our case, we assume that deployer is actually the person who initiated the deploy transaction
  // even if a contract is created by another contract

  for (const trace of txEvent.traces) {
    if (trace.type === 'create') {
      const deployer = trace.action.from.toLowerCase();

      // Parity/OpenEthereum trace format contains created address
      // https://github.com/NethermindEth/docs/blob/master/nethermind-utilities/cli/trace.md
      if (trace.result.address) {
        createdContracts.push({
          deployer: sender,
          address: trace.result.address.toLowerCase(),
          blockNumber: txEvent.blockNumber,
        });
        continue;
      }

      // fallback to more universal way
      if (sender === deployer || createdContracts.find((c) => c.address === deployer)) {
        // for contracts creating other contracts, the nonce would be 1
        const nonce = sender === deployer ? txEvent.transaction.nonce : 1;
        const createdContract = ethers.utils.getContractAddress({ from: deployer, nonce });
        createdContracts.push({
          deployer: sender,
          address: createdContract.toLowerCase(),
          blockNumber: txEvent.blockNumber,
        });
      }
    }
  }

  return createdContracts;
}
