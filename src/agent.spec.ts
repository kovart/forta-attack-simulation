import { ethers } from 'ethers';
import agent from './agent';
import { DataContainer } from './types';
import { Logger } from './logger';

const { provideInitialize } = agent;

describe('Forta agent', () => {
  describe('initialize()', () => {
    it('should initialize properly', async () => {
      const data: DataContainer = {} as any;
      const provider = new ethers.providers.JsonRpcProvider();
      const logger = new Logger();
      const handleContract = () => Promise.resolve();
      const initialize = provideInitialize(data, handleContract, provider, logger, true);

      await initialize();

      expect(data.isInitialized).toStrictEqual(true);
      expect(data.isDevelopment).toStrictEqual(true);
      expect(data.logger).toStrictEqual(logger);
      expect(data.provider).toStrictEqual(provider);
    });
  });

  describe('handleTransaction()', () => {
    it.todo('should handle properly');
  });
});
