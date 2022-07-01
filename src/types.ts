import { Finding } from 'forta-agent';
import { providers } from 'ethers';
import { QueueObject } from 'async';
import { Logger } from './logger';

export type CreatedContract = {
  address: string;
  deployer: string;
  blockNumber: number;
};

export type HandleContract = (createdContract: CreatedContract) => Promise<void>;

export type DataContainer = {
  logger: Logger;
  provider: providers.JsonRpcProvider;
  queue: QueueObject<CreatedContract>;
  findings: Finding[];
  isDevelopment: boolean;
  isInitialized: boolean;
};
