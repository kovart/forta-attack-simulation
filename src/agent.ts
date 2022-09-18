import BigNumber from 'bignumber.js';
import { ethers } from 'ethers';
import { queue } from 'async';
import { getEthersProvider, HandleTransaction, Initialize, TransactionEvent } from 'forta-agent';
import {
  generateCallData,
  getBalanceChanges,
  getCreatedContracts,
  getEthersForkProvider,
  getSighashes,
  getTokenDecimals,
  getTokenNames,
} from './utils';
import { Logger, LoggerLevel } from './logger';
import { CreatedContract, DataContainer, HandleContract, TokenInfo, TokenInterface } from './types';
import { createExploitFunctionFinding } from './findings';

const data: DataContainer = {} as any;
const botConfig = require('../bot-config.json');

const provideInitialize = (
  data: DataContainer,
  config: typeof botConfig,
  handleContract: HandleContract,
): Initialize => {
  return async function initialize() {
    data.developerAbbreviation = config.developerAbbreviation;
    data.isDevelopment = process.env.NODE_ENV !== 'production';
    data.isDebug = process.env.DEBUG === '1';
    data.provider = getEthersProvider();
    data.queue = queue(async (createdContract, cb) => {
      await handleContract(createdContract);
      cb();
    }, 1);
    data.findings = [];
    data.tokensConfig = {};
    const chainId = (await data.provider.getNetwork()).chainId;
    // normalize token addresses
    Object.keys(config.chains[chainId]).forEach((tokenAddress) => {
      data.tokensConfig[tokenAddress.toLowerCase()] = config.chains[chainId][tokenAddress];
    });
    data.logger = new Logger(data.isDevelopment ? LoggerLevel.DEBUG : LoggerLevel.WARN);
    data.isInitialized = true;

    data.logger.debug('Initialized');
  };
};

const provideHandleContract = (
  data: DataContainer,
  getForkedProvider: typeof getEthersForkProvider,
): HandleContract => {
  return async function handleContract(createdContract: CreatedContract) {
    data.logger.debug('Contract', createdContract.address);

    const provider = getForkedProvider(createdContract.blockNumber, [
      createdContract.deployer, // we use deployer address as a transaction sender
    ]);
    const contractCode = await provider.getCode(
      createdContract.address,
      createdContract.blockNumber,
    );
    const sighashes = getSighashes(contractCode);

    try {
      // send ethers to the sender's account
      // to make sure that the balance will be enough to call transactions
      const accounts = await provider.listAccounts();
      const tx = await provider.getSigner(accounts[0]).sendTransaction({
        to: createdContract.deployer,
        // substitute one ether to be able to complete this transaction
        value: (await provider.getBalance(accounts[0])).sub(ethers.utils.parseEther('1')),
      });
      await tx.wait();
    } catch (e) {
      data.logger.warn('error when trying to send ethers to the contract deployer', e);
    }

    for (const sighash of sighashes) {
      data.logger.debug('Function', sighash);

      let programCounter = -1;
      let isSignatureFound = false;

      // iterate from 0 to 5 function parameters until we found that function is being executed
      for (let words = 0; words <= 5 && !isSignatureFound; words++) {
        for await (const calldata of generateCallData({
          words,
          addresses: [createdContract.deployer],
        })) {
          try {
            const tx = await provider.getSigner(createdContract.deployer).sendTransaction({
              to: createdContract.address,
              data: sighash + calldata,
            });
            const receipt = await tx.wait();

            // if we are here, then we successfully completed the transaction
            if (!isSignatureFound) {
              isSignatureFound = true;
              data.logger.debug('Found signature', createdContract.address, sighash, calldata);
            }

            // get all token transfers caused by the transaction (including native ETH)
            const { interfacesByToken, balanceChangesByAccount } = await getBalanceChanges({
              tx,
              receipt,
              provider,
            });

            // simplify balances by summing values of the inner tokens (erc721, erc1155)
            const totalBalanceChangesByAccount: {
              [account: string]: { [tokenAddress: string]: BigNumber };
            } = {};
            for (const account of Object.keys(balanceChangesByAccount)) {
              totalBalanceChangesByAccount[account] = totalBalanceChangesByAccount[account] || {};
              for (const tokenAddress of Object.keys(balanceChangesByAccount[account])) {
                const getSum = (obj: { [x: string]: BigNumber }) =>
                  Object.values(obj).reduce((a, b) => a.plus(b), new BigNumber(0));
                totalBalanceChangesByAccount[account][tokenAddress] = getSum(
                  balanceChangesByAccount[account][tokenAddress],
                );
              }
            }

            for (const [tokenAddress, token] of Object.entries(data.tokensConfig)) {
              const numerator = new BigNumber(10).pow(token.decimals || 0);
              const threshold = new BigNumber(token.threshold).multipliedBy(numerator);
              const value =
                totalBalanceChangesByAccount[createdContract.deployer]?.[tokenAddress] ||
                new BigNumber(0);

              if (value.isGreaterThan(threshold)) {
                const tokensByAccount: { [account: string]: TokenInfo[] } = {};
                const namesByToken = await getTokenNames({
                  addresses: Object.keys(interfacesByToken),
                  knownTokens: data.tokensConfig,
                  provider: provider,
                });
                const decimalsByToken = await getTokenDecimals({
                  addresses: Object.entries(interfacesByToken)
                    .filter(([, type]) =>
                      [TokenInterface.ERC20, TokenInterface.NATIVE].includes(type),
                    )
                    .map(([address]) => address),
                  knownTokens: data.tokensConfig,
                  provider: provider,
                });

                const createTokenInfo = (address: string, value: BigNumber): TokenInfo => ({
                  name: namesByToken[address] || `Unknown (${address})`,
                  type: interfacesByToken[address],
                  decimals: decimalsByToken[address],
                  address: address,
                  value: value,
                });

                for (const account of Object.keys(totalBalanceChangesByAccount)) {
                  for (const tokenAddress of Object.keys(totalBalanceChangesByAccount[account])) {
                    const token = createTokenInfo(
                      tokenAddress,
                      totalBalanceChangesByAccount[account][tokenAddress],
                    );
                    tokensByAccount[account] = tokensByAccount[account] || [];
                    tokensByAccount[account].push(token);
                  }
                  tokensByAccount[account].sort((a, b) =>
                    b.value.isGreaterThan(a.value) ? 0 : -1,
                  );
                }

                const involvedAddresses = new Set([
                  createdContract.deployer,
                  createdContract.address,
                  ...Object.keys(totalBalanceChangesByAccount),
                  ...receipt.logs.map((l) => l.address.toLowerCase()),
                ]);

                data.findings.push(
                  createExploitFunctionFinding(
                    sighash,
                    calldata,
                    createdContract.address,
                    createdContract.deployer,
                    tokensByAccount,
                    [...involvedAddresses],
                    data.developerAbbreviation,
                  ),
                );

                return;
              }
            }
          } catch (e: any) {
            // if not a ganache error
            if (!e?.data?.programCounter) {
              data.logger.warn('handleContract error', e);
              return;
            }

            // check if we faced with error caused by function execution (inner error)
            if (!isSignatureFound && (e.data.reason || e.data.result?.length > 2)) {
              data.logger.debug('Found signature', createdContract.address, sighash, calldata);
              isSignatureFound = true;
            }

            if (isSignatureFound) {
              continue;
            }

            // the unchanged counter most likely means that we are facing the same error;
            // given that there is no "reason" for the error,
            // it is very likely a signature mismatch error.
            if (programCounter > -1 && programCounter === e.data.programCounter) {
              // increment word counter
              break;
            }

            // update current counter to see if it changes in the next iteration
            programCounter = e.data.programCounter;
          }
        }
      }
    }
  };
};

const provideHandleTransaction = (data: DataContainer): HandleTransaction => {
  return async function handleTransaction(txEvent: TransactionEvent) {
    if (!data.isInitialized) throw new Error('DataContainer is not initialized');

    const createdContracts: CreatedContract[] = getCreatedContracts(txEvent);

    data.queue.push(createdContracts);

    if (data.isDebug) {
      await data.queue.drain();
    }

    return data.findings.splice(0);
  };
};

export default {
  initialize: provideInitialize(
    data,
    botConfig,
    provideHandleContract(data, getEthersForkProvider),
  ),
  handleTransaction: provideHandleTransaction(data),

  provideInitialize,
  provideHandleTransaction,
  provideHandleContract,
};
