import { Finding } from 'forta-agent';
import { providers } from 'ethers';
import { QueueObject } from 'async';
import { Logger } from './logger';
import BigNumber from 'bignumber.js';

export enum TokenInterface {
  NATIVE = 'native',
  ERC20 = 'ERC20',
  ERC721 = 'ERC721',
  ERC1155 = 'ERC1155',
}

export type TokenInfo = {
  name: string;
  type: TokenInterface;
  address: string;
  decimals?: number;
  value: BigNumber;
};

export type TrackableToken = {
  threshold: number | string;
  name?: string;
  decimals?: number;
};

export type CreatedContract = {
  address: string;
  deployer: string;
  blockNumber: number;
};

export type HandleContract = (createdContract: CreatedContract) => Promise<void>;

export type TrackableTokensConfig = { [tokenAddress: string | 'native']: TrackableToken };

export type DataContainer = {
  logger: Logger;
  provider: providers.JsonRpcProvider;
  queue: QueueObject<CreatedContract>;
  tokensConfig: TrackableTokensConfig;
  findings: Finding[];
  developerAbbreviation: string;
  isDevelopment: boolean;
  isInitialized: boolean;
};
