import { providers } from 'ethers';
import { queue } from 'async';
import { getEthersProvider, HandleTransaction, Initialize, TransactionEvent } from 'forta-agent';
import { Logger, LoggerLevel } from './logger';
import { CreatedContract, DataContainer, HandleContract } from './types';
import { createFinding } from './findings';

const data: DataContainer = {} as any;
const provider = getEthersProvider();
const isDevelopment = process.env.NODE_ENV !== 'production';
const logger = new Logger(isDevelopment ? LoggerLevel.DEBUG : LoggerLevel.WARN);
const botConfig = require('../bot-config.json');

const provideInitialize = (
  data: DataContainer,
  handleContract: HandleContract,
  provider: providers.JsonRpcProvider,
  logger: Logger,
  isDevelopment: boolean,
): Initialize => {
  return async function initialize() {
    data.logger = logger;
    data.provider = provider;
    data.queue = queue(handleContract, 1);
    data.isDevelopment = isDevelopment;
    data.isInitialized = true;

    logger.debug('Initialized');
  };
};

const provideHandleContract = (data: DataContainer): HandleContract => {
  return async function handleContract(deployedContract: CreatedContract) {
    // const code = await data.provider.getCode(deployedContract.address, deployedContract.blockNumber);
    // const functions = getFunctions(code);
    // data.findings.push(createFinding());
  };
};

const provideHandleTransaction = (data: DataContainer): HandleTransaction => {
  return async function handleTransaction(txEvent: TransactionEvent) {
    if (!data.isInitialized) throw new Error('DataContainer is not initialized');

    // TODO get created contracts
    const createdContracts: CreatedContract[] = [];

    data.queue.push(createdContracts);

    return data.findings.slice(0);
  };
};

export default {
  initialize: provideInitialize(data, provideHandleContract(data), provider, logger, isDevelopment),
  handleTransaction: provideHandleTransaction(data),

  provideInitialize,
  provideHandleTransaction,
  provideHandleContract,
};
