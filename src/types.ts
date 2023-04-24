import BigNumber from 'bignumber.js';
import { Finding } from 'forta-agent';
import { providers } from 'ethers';
import { AsyncPriorityQueue } from 'async';
import { BotAnalytics } from 'forta-bot-analytics';

import { Logger } from './logger';

export enum TokenInterface {
  NATIVE = 'native',
  ERC20 = 'ERC20',
  ERC721 = 'ERC721',
  ERC1155 = 'ERC1155',
}

export type TokenInfo = {
  name?: string;
  type: TokenInterface;
  address: string;
  decimals?: number;
  value: BigNumber;
};

export type CreatedContract = {
  address: string;
  deployer: string;
  blockNumber: number;
  timestamp: number;
  txHash: string;
};

export type HandleContract = (createdContract: CreatedContract) => Promise<void>;

export type BotEnv = {
  NODE_ENV?: 'production' | string;
  TARGET_MODE?: '1' | string;
  DEBUG?: '1' | string;
};

export type DataContainer = {
  logger: Logger;
  provider: providers.JsonRpcProvider;
  queue: AsyncPriorityQueue<CreatedContract>;
  detectedContractByAddress: Map<string, CreatedContract>;
  suspiciousContractByAddress: Map<string, { address: string; timestamp: number }>;
  contractWaitingTime: number;
  payableFunctionEtherValue: number;
  totalUsdTransferThreshold: BigNumber;
  totalTokensThresholdsByAddress: {
    [tokenAddress: string]: {
      name: string;
      threshold: BigNumber;
    };
  };
  findings: Finding[];
  chainId: number;
  analytics: BotAnalytics;
  developerAbbreviation: string;
  isDevelopment: boolean;
  isTargetMode: boolean;
  isDebug: boolean;
  isInitialized: boolean;
};

export type BotConfig = {
  developerAbbreviation: string;
  payableFunctionEtherValue: number;
  totalUsdTransferThreshold: number;
  defaultAnomalyScore: {
    [chainId: string]: number;
  };
  aztecContractBotId: string;
  maliciousContractMLBotId: string;
  tornadoCashContractBotId: string;
  flashloanContractBotId: string;
  totalTokensThresholdsByChain: {
    [chainId: string]: {
      [tokenAddr: string]: {
        name: string;
        threshold: number;
      };
    };
  };
};
