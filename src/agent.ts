import BigNumber from 'bignumber.js';
import { ethers } from 'ethers';
import { priorityQueue } from 'async';
import {
  getEthersProvider,
  HandleAlert,
  HandleTransaction,
  Initialize,
  Network,
  TransactionEvent,
} from 'forta-agent';
import { BotAnalytics, FortaBotStorage, InMemoryBotStorage } from 'forta-bot-analytics';

import * as botUtils from './utils';
import { Logger, LoggerLevel } from './logger';
import { createExploitFunctionFinding } from './findings';
import { BURN_ADDRESSES } from './contants';
import {
  BotConfig,
  BotEnv,
  CreatedContract,
  DataContainer,
  HandleContract,
  TokenInfo,
  TokenInterface,
} from './types';

const data = {} as DataContainer;
const botConfig: BotConfig = require('../bot-config.json');
const ENV = process.env as BotEnv;

const LOW_PRIORITY = 9;
const NORMAL_PRIORITY = 4;
const HIGH_PRIORITY = 1;

const provideInitialize = (
  data: DataContainer,
  config: BotConfig,
  env: BotEnv,
  handleContract: HandleContract,
): Initialize => {
  return async function initialize() {
    data.developerAbbreviation = config.developerAbbreviation;
    data.payableFunctionEtherValue = config.payableFunctionEtherValue;
    data.isDevelopment = env.NODE_ENV !== 'production';
    data.isTargetMode = env.TARGET_MODE === '1';
    data.isDebug = env.DEBUG === '1';

    data.provider = getEthersProvider();
    data.queue = priorityQueue(async (createdContract, cb) => {
      await handleContract(createdContract);
      cb();
    }, 1);
    data.findings = [];
    data.totalUsdTransferThreshold = new BigNumber(config.totalUsdTransferThreshold);
    data.totalTokensThresholdsByAddress = {};
    data.chainId = (await data.provider.getNetwork()).chainId;
    // normalize token addresses
    Object.keys(config.totalTokensThresholdsByChain[data.chainId] || {}).forEach((tokenAddress) => {
      const record = config.totalTokensThresholdsByChain[data.chainId][tokenAddress];
      data.totalTokensThresholdsByAddress[tokenAddress.toLowerCase()] = {
        name: record.name,
        threshold: new BigNumber(record.threshold),
      };
    });

    data.detectedContractByAddress = new Map();
    data.suspiciousContractByAddress = new Map();
    data.contractWaitingTime = 2 * 24 * 60 * 60; // 2d

    data.logger = new Logger(data.isDevelopment ? LoggerLevel.DEBUG : LoggerLevel.INFO);
    data.analytics = new BotAnalytics(
      data.isDevelopment
        ? new InMemoryBotStorage(data.logger.info)
        : new FortaBotStorage(data.logger.info),
      {
        key: data.chainId.toString(),
        defaultAnomalyScore: {
          [BotAnalytics.GeneralAlertId]:
            config.defaultAnomalyScore[data.chainId] ?? config.defaultAnomalyScore[Network.MAINNET],
        },
        syncTimeout: 60 * 60, // 1h
        maxSyncDelay: 60 * 24 * 60 * 60, // 60d
        observableInterval: 60 * 24 * 60 * 60, // 60d
        logFn: data.logger.info,
      },
    );
    data.isInitialized = true;
    data.logger.debug(
      `Initialized. Is Development: ${data.isDevelopment}. Is Target Mode: ${data.isTargetMode}.`,
    );

    return {
      alertConfig: {
        subscriptions: [
          {
            botId: config.maliciousContractMLBotId,
            alertIds: ['SUSPICIOUS-CONTRACT-CREATION'],
            chainId: data.chainId,
          },
          {
            botId: config.flashloanContractBotId,
            alertIds: ['SUSPICIOUS-FLASHLOAN-CONTRACT-CREATION', 'FLASHLOAN-CONTRACT-CREATION'],
            chainId: data.chainId,
          },
          {
            botId: config.tornadoCashContractBotId,
            alertIds: ['SUSPICIOUS-CONTRACT-CREATION-TORNADO-CASH'],
            chainId: data.chainId,
          },
        ],
      },
    };
  };
};

const provideHandleAlert = (data: DataContainer, config: BotConfig): HandleAlert => {
  return async (alertEvent) => {
    const handlers = {
      [config.tornadoCashContractBotId]: {
        getPriority: () => NORMAL_PRIORITY,
        getContractAddress: () => alertEvent.alert.description?.slice(0, 42).toLowerCase(),
      },
      [config.maliciousContractMLBotId]: {
        getPriority: () => HIGH_PRIORITY,
        getContractAddress: () => alertEvent.alert.description?.slice(-42).toLowerCase(),
      },
      [config.flashloanContractBotId]: {
        getPriority: () => HIGH_PRIORITY,
        getContractAddress: () => alertEvent.alert.name?.slice(-42).toLowerCase(),
      },
    };

    for (const [botId, handler] of Object.entries(handlers)) {
      if (alertEvent.botId?.toLowerCase() !== botId.toLowerCase()) continue;

      const contractAddress = handler.getContractAddress();

      if (!contractAddress) break;

      let queuedContract: CreatedContract | undefined;
      data.queue.remove((node) => {
        if (node.data.address === contractAddress) queuedContract = node.data;
        return !!queuedContract;
      });

      if (queuedContract) {
        data.queue.push(queuedContract, handler.getPriority());
      } else {
        data.logger.info(
          `Changed scan priority of ${contractAddress} due to alert "${alertEvent.alertId}"`,
        );
        data.suspiciousContractByAddress.set(contractAddress, {
          address: contractAddress,
          timestamp: Math.floor(
            new Date(alertEvent.alert.createdAt || Date.now()).valueOf() / 1000,
          ),
        });
      }
    }

    return [];
  };
};

const provideHandleContract = (
  data: DataContainer,
  utils: Pick<
    typeof botUtils,
    | 'generateCallData'
    | 'getTotalBalanceChanges'
    | 'getSighashes'
    | 'getTokenDecimals'
    | 'getTokenNames'
    | 'getEthersForkProvider'
    | 'getNativeTokenPrice'
    | 'getErc20TokenPrice'
  >,
): HandleContract => {
  return async function handleContract(createdContract: CreatedContract) {
    data.logger.debug('Contract', createdContract.address);

    const {
      generateCallData,
      getTotalBalanceChanges,
      getSighashes,
      getEthersForkProvider,
      getTokenDecimals,
      getTokenNames,
      getNativeTokenPrice,
      getErc20TokenPrice,
    } = utils;

    const provider = getEthersForkProvider(createdContract.blockNumber, [
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

    // some functions require sending a certain amount of ether,
    // e.g. https://etherscan.io/tx/0xaf961653906aa831fa1ff7876fa6eecc10e415c7c2bffec69ee26e02bde6f4fc
    // so we iterate value for payable and non-payable functions
    for (const value of [ethers.utils.parseEther(data.payableFunctionEtherValue.toString()), 0]) {
      data.logger.debug('Transaction value', value.toString());
      for (const sighash of sighashes) {
        data.logger.debug('Function', sighash);

        let programCounter = -1;
        let isSignatureFound = false;
        // iterate from 0 to 5 function parameters until we found that function is being executed
        for (let wordCount = 0; wordCount <= 5 && !isSignatureFound; wordCount++) {
          for await (const calldata of generateCallData({
            wordCount: wordCount,
            addresses: [createdContract.deployer],
          })) {
            try {
              // execute transaction
              const tx = await provider.getSigner(createdContract.deployer).sendTransaction({
                to: createdContract.address,
                data: sighash + calldata,
                value: value,
              });
              const receipt = await tx.wait();

              // if we are here, then we successfully completed the transaction
              if (!isSignatureFound) {
                isSignatureFound = true;
                data.logger.debug(
                  'Signature found by success transaction',
                  createdContract.address,
                  sighash,
                  calldata,
                );
              }

              // get all token transfers caused by the transaction (including native token)
              const { interfacesByTokenAddress, totalBalanceChangesByAddress } =
                await getTotalBalanceChanges({
                  tx,
                  receipt,
                  provider,
                });

              // skip if it is a refund
              if (
                Object.keys(totalBalanceChangesByAddress).length === 2 &&
                totalBalanceChangesByAddress[createdContract.address] &&
                totalBalanceChangesByAddress[createdContract.deployer]
              ) {
                const contractChanges = totalBalanceChangesByAddress[createdContract.address] || {};
                const deployerChanges =
                  totalBalanceChangesByAddress[createdContract.deployer] || {};

                // check if the same tokens have been transferred
                let isRefund =
                  Object.keys(deployerChanges).length === Object.keys(contractChanges).length;

                // check if the same amount of tokens have been transferred
                if (isRefund) {
                  for (const [token, balance] of Object.entries(deployerChanges)) {
                    if (!contractChanges[token]?.abs().eq(balance)) {
                      isRefund = false;
                      break;
                    }
                  }
                }

                if (isRefund) {
                  let isZeroBalance = false;
                  for (const balance of Object.values(deployerChanges)) {
                    if (!balance.isZero()) {
                      isZeroBalance = false;
                      break;
                    }
                  }

                  // we log only when more than 0 tokens are transferred
                  if (!isZeroBalance) {
                    data.logger.warn(
                      'Skip refund function',
                      sighash,
                      JSON.stringify(totalBalanceChangesByAddress),
                    );
                  }

                  break;
                }
              }

              const timestamp = (await data.provider.getBlock(createdContract.blockNumber))
                .timestamp;

              // get token prices
              const tokenPriceByAddress: { [address: string]: number | undefined } = {};
              for (const address of Object.keys(interfacesByTokenAddress)) {
                let price: number | undefined;
                if (interfacesByTokenAddress[address] === TokenInterface.NATIVE) {
                  price = await getNativeTokenPrice(data.chainId, data.logger, timestamp);
                } else if (interfacesByTokenAddress[address] === TokenInterface.ERC20) {
                  price = await getErc20TokenPrice(data.chainId, address, data.logger, timestamp);
                }
                tokenPriceByAddress[address] = price;
              }

              const decimalsByToken = await getTokenDecimals({
                addresses: Object.entries(interfacesByTokenAddress)
                  .filter(([, type]) =>
                    [TokenInterface.ERC20, TokenInterface.NATIVE].includes(type),
                  )
                  .map(([address]) => address),
                provider: provider,
              });

              let highlyFundedAccount: string | null = null;

              for (const [account, balanceByTokenAddress] of Object.entries(
                totalBalanceChangesByAddress,
              )) {
                // check if the account is a burn-address
                if (account.includes('000000000000') || BURN_ADDRESSES.includes(account)) {
                  continue;
                }

                // check whether the account is related to a potential exploiter
                // or it is an unknown EOA
                if (![createdContract.address, createdContract.deployer].includes(account)) {
                  const isEOA = (await provider.getCode(account)) === '0x';
                  if (!isEOA) continue;
                }

                let totalReceivedUsd = new BigNumber(0);
                for (const [tokenAddress, value] of Object.entries(balanceByTokenAddress)) {
                  let profitValue = value;
                  const tokenType = interfacesByTokenAddress[tokenAddress];

                  // check if threshold of erc721 and erc1155 tokens is exceeded
                  if (
                    data.totalTokensThresholdsByAddress[tokenAddress] &&
                    profitValue.isGreaterThan(
                      data.totalTokensThresholdsByAddress[tokenAddress].threshold,
                    )
                  ) {
                    highlyFundedAccount = account;
                    break;
                  }

                  // this helps to get rid of false positives on the deployment of contracts with withdraw() functions
                  if (tokenType === TokenInterface.NATIVE) {
                    const withdrawValue =
                      totalBalanceChangesByAddress[createdContract.address]?.[tokenAddress] ||
                      new BigNumber(0);

                    // check if the deployer withdraws his ethers back from the contract
                    if (withdrawValue.isNegative()) {
                      // if so, then subtract the ethers that come back
                      profitValue = profitValue.plus(withdrawValue);
                    }
                  }

                  if ([TokenInterface.ERC20, TokenInterface.NATIVE].includes(tokenType)) {
                    // add transferred value in USD
                    totalReceivedUsd = totalReceivedUsd.plus(
                      profitValue
                        .div(new BigNumber(10).pow(decimalsByToken[tokenAddress] || 0))
                        .multipliedBy(tokenPriceByAddress[tokenAddress] || 0),
                    );
                  }

                  // check USD threshold
                  if (totalReceivedUsd.isGreaterThan(data.totalUsdTransferThreshold)) {
                    highlyFundedAccount = account;
                    break;
                  }
                }
              }

              // check if we found account that exceeded threshold
              if (highlyFundedAccount) {
                const tokensByAccount: { [account: string]: TokenInfo[] } = {};
                const namesByToken = await getTokenNames({
                  addresses: Object.keys(interfacesByTokenAddress),
                  knownTokens: data.totalTokensThresholdsByAddress,
                  provider: provider,
                  chainId: data.chainId,
                });

                for (const account of Object.keys(totalBalanceChangesByAddress)) {
                  for (const tokenAddress of Object.keys(totalBalanceChangesByAddress[account])) {
                    const token: TokenInfo = {
                      name: namesByToken[tokenAddress],
                      type: interfacesByTokenAddress[tokenAddress],
                      decimals: decimalsByToken[tokenAddress],
                      address: tokenAddress,
                      value: totalBalanceChangesByAddress[account][tokenAddress],
                    };
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
                  ...Object.keys(totalBalanceChangesByAddress),
                  ...receipt.logs.map((l) => l.address.toLowerCase()),
                ]);

                data.analytics.incrementAlertTriggers(createdContract.timestamp);

                data.findings.push(
                  createExploitFunctionFinding(
                    sighash,
                    calldata,
                    createdContract.address,
                    createdContract.deployer,
                    highlyFundedAccount,
                    tokensByAccount,
                    [...involvedAddresses],
                    data.analytics.getAnomalyScore(),
                    createdContract.txHash,
                    data.developerAbbreviation,
                  ),
                );

                return;
              }
            } catch (e: any) {
              // if not a ganache error
              if (!e?.data?.programCounter) {
                data.logger.warn('handleContract error', e);
                return;
              }

              // check if we faced with error caused by function execution (inner error)
              if (!isSignatureFound && (e.data.reason || e.data.result?.length > 2)) {
                data.logger.debug(
                  'Signature found by changed revert',
                  createdContract.address,
                  sighash,
                  calldata,
                );
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
    }
  };
};

const provideHandleTransaction = (
  data: DataContainer,
  utils: Pick<typeof botUtils, 'getCreatedContracts'>,
  initialize: Initialize,
): HandleTransaction => {
  let loggedAt = 0;

  return async function handleTransaction(txEvent: TransactionEvent) {
    if (!data.isInitialized) {
      // eslint-disable-next-line no-console
      console.error('DataContainer is not initialized');
      await initialize();
    }

    await data.analytics.sync(txEvent.timestamp);

    const { getCreatedContracts } = utils;

    const createdContracts: CreatedContract[] = getCreatedContracts(txEvent);

    // update analytics data to calculate anomaly score
    for (const contract of createdContracts) {
      data.analytics.incrementBotTriggers(txEvent.timestamp);
      data.detectedContractByAddress.set(contract.address, contract);
    }

    // log scan queue every 10 minutes
    if (data.queue.length() >= 5 && Date.now() - loggedAt > 10 * 60 * 1000) {
      const workers = data.queue.workersList();
      data.logger.warn(
        `Scan queue: ${data.queue.length()}. ` +
          `Current block: ${txEvent.blockNumber}. ` +
          `Scanning block: ${workers[0].data.blockNumber}. ` +
          `Block delay: ${txEvent.blockNumber - workers[0].data.blockNumber}. ` +
          `Memory: ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1)}Mb`,
      );
      loggedAt = Date.now();
    }

    if (data.isTargetMode) {
      for (const contract of data.suspiciousContractByAddress.values()) {
        const detectedContract = data.detectedContractByAddress.get(contract.address);
        if (detectedContract) {
          data.logger.info(`Pushed suspicious contract: ${contract.address}`);
          data.queue.push(detectedContract);
          data.detectedContractByAddress.delete(contract.address);
          data.suspiciousContractByAddress.delete(contract.address);
        }
      }
    } else {
      for (const contract of createdContracts) {
        let priority = LOW_PRIORITY;
        if (data.suspiciousContractByAddress.has(contract.address)) {
          priority = HIGH_PRIORITY;
          data.suspiciousContractByAddress.delete(contract.address);
        }
        data.queue.push(contract, priority);
        data.detectedContractByAddress.delete(contract.address);
      }
    }

    // remove outdated detected contracts
    for (const contract of data.detectedContractByAddress.values()) {
      if (txEvent.timestamp - contract.timestamp > data.contractWaitingTime) {
        data.detectedContractByAddress.delete(contract.address);
      }
    }
    // remove outdated suspicious contracts
    for (const contract of data.suspiciousContractByAddress.values()) {
      if (txEvent.timestamp - contract.timestamp > data.contractWaitingTime) {
        data.suspiciousContractByAddress.delete(contract.address);
      }
    }

    if (data.isDebug) {
      await data.queue.drain();
    }

    return data.findings.splice(0);
  };
};

const initialize = provideInitialize(data, botConfig, ENV, provideHandleContract(data, botUtils));

export default {
  initialize: initialize,
  handleTransaction: provideHandleTransaction(data, botUtils, initialize),
  handleAlert: provideHandleAlert(data, botConfig),

  provideInitialize,
  provideHandleTransaction,
  provideHandleContract,
  provideHandleAlert,
};
