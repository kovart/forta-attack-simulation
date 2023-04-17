const mockEthersProvider = jest.fn();

jest.mock('forta-agent', () => ({
  ...jest.requireActual('forta-agent'),
  getEthersProvider: mockEthersProvider,
}));

import { BotAnalytics, InMemoryBotStorage } from 'forta-bot-analytics';
import {
  Alert,
  AlertEvent,
  Finding,
  FindingSeverity,
  FindingType,
  HandleAlert,
  HandleTransaction,
  Network,
} from 'forta-agent';
import { TestTransactionEvent } from 'forta-agent-tools/lib/tests';
import BigNumber from 'bignumber.js';
import Ganache, { EthereumProvider } from 'ganache';
import { ethers } from 'ethers';

import { compile, CompilerArtifact } from './utils/compiler';
import {
  BotConfig,
  BotEnv,
  CreatedContract,
  DataContainer,
  HandleContract,
  TokenInfo,
  TokenInterface,
} from '../types';
import * as botUtils from '../utils';
import { Logger, LoggerLevel } from '../logger';
import agent from '../agent';

const { provideInitialize, provideHandleContract, provideHandleTransaction, provideHandleAlert } =
  agent;

const nominator = (decimals: number) => new BigNumber(10).pow(decimals);

describe('attack simulation', () => {
  describe('handleContract', () => {
    jest.setTimeout(5 * 60 * 1000);

    type WithAddress = {
      address: string;
    };

    type MockNativeToken = WithAddress & {
      name: string;
      decimals: number;
      price: number;
    };

    type MockErc20Token = WithAddress & {
      symbol?: string;
      name?: string;
      decimals: number;
      price: number;
    };

    type MockErc721Token = WithAddress & {
      name: string;
    };

    type MockErc1155Token = WithAddress & {
      name: string;
    };

    enum ExploitVaraint {
      ExploitNoParams = 'ExploitNoParams.sol',
      ExploitMultipleParams = 'ExploitMultipleParams.sol',
      ExploitPayable = 'ExploitPayable.sol',
      ExploitSelfFunded = 'ExploitSelfFunded.sol',
    }

    const testNetwork: Network = Network.POLYGON;

    const customERC20Artifact = compile('CustomERC20.sol');
    const customERC721Artifact = compile('CustomERC721.sol');
    const customERC1155Artifact = compile('CustomERC1155.sol');
    const exploitedProtocolArtifact = compile('ExploitedProtocol.sol');

    let handleContract: HandleContract;
    let ganacheProvider: EthereumProvider;
    let web3Provider: ethers.providers.Web3Provider;
    let attackerSigner: ethers.providers.JsonRpcSigner;
    let protocolOwnerSigner: ethers.providers.JsonRpcSigner;

    const mockGetNativeTokenPrice = jest.fn();
    const mockGetErc20TokenPrice = jest.fn();

    let mockData: DataContainer;

    // tokens are deployed before each test
    let mockNativeToken: MockNativeToken;
    let mockErc20Token1: MockErc20Token;
    let mockErc20Token2: MockErc20Token;
    let mockErc721Token1: MockErc721Token;
    let mockErc721Token2: MockErc721Token;
    let mockErc1155Token1: MockErc1155Token;
    let mockErc1155Token2: MockErc1155Token;

    beforeAll(async () => {
      // set up blockchain environment
      ganacheProvider = Ganache.provider({
        logging: { quiet: true },
        chainId: testNetwork,
        wallet: {
          defaultBalance: 100_000_000_000,
        },
      });
      web3Provider = new ethers.providers.Web3Provider(ganacheProvider as any);
      const accounts = await web3Provider.listAccounts();
      protocolOwnerSigner = web3Provider.getSigner(accounts[0]);
      attackerSigner = web3Provider.getSigner(accounts[1]);

      // mock data container
      mockData = {} as any;
      mockData.totalUsdTransferThreshold = new BigNumber(4000);
      mockData.developerAbbreviation = 'AK';
      mockData.payableFunctionEtherValue = 10;
      mockData.chainId = testNetwork;
      mockData.logger = new Logger(LoggerLevel.DEBUG);
      mockData.analytics = new BotAnalytics(new InMemoryBotStorage(), {
        defaultAnomalyScore: { [BotAnalytics.GeneralAlertId]: 0.123 },
        syncTimeout: 60 * 60,
        maxSyncDelay: 31 * 24 * 60 * 60,
        observableInterval: 14 * 24 * 60 * 60,
      });
      mockData.provider = web3Provider;
      mockData.isDevelopment = true;
      mockData.isDebug = false;
      mockData.isInitialized = true;

      // mock price providers
      mockGetNativeTokenPrice.mockImplementation((network: Network) => {
        if (network !== testNetwork) throw new Error('Not testing network ' + network);
        return mockNativeToken.price;
      });
      mockGetErc20TokenPrice.mockImplementation((network: Network, addr: string) => {
        if (network !== testNetwork) throw new Error('Not testing network ' + network);
        if (mockErc20Token1.address === addr) return mockErc20Token1.price;
        if (mockErc20Token2.address === addr) return mockErc20Token2.price;
        return null;
      });

      // inject mocks to functions that use third-party services
      handleContract = provideHandleContract(mockData, {
        ...botUtils,
        getEthersForkProvider: () => web3Provider,
        getNativeTokenPrice: mockGetNativeTokenPrice,
        getErc20TokenPrice: mockGetErc20TokenPrice,
      });
    });

    beforeEach(async () => {
      // since the the agent is async, it pushes findings to the data container
      mockData.findings = [];
      // re-deploy tokens to local blockchain
      await deployTokens();
    });

    afterEach(async () => {
      // since we don't reinitialize Ganache before each test,
      // we return the ether we sent to the attacker
      const balance = await attackerSigner.getBalance();
      if (balance.gte(ethers.utils.parseEther('1'))) {
        await attackerSigner.sendTransaction({
          to: protocolOwnerSigner._address,
          value: balance.sub(ethers.utils.parseEther('0.001')),
        });
      }
    });

    afterAll(() => {
      ganacheProvider.disconnect();
    });

    const deployContract = async (
      artifact: CompilerArtifact,
      constructorParams: any[],
      signer: ethers.providers.JsonRpcSigner,
      value: string | number | BigNumber = 0,
    ) => {
      const factory = new ethers.ContractFactory(
        artifact.abi,
        artifact.evm.bytecode.object,
        signer,
      );
      const contract = await factory.deploy(...constructorParams, { value: value.toString() });
      await contract.deployed();
      return contract;
    };

    const deployTokens = async () => {
      // initialize and deploy tokens
      mockNativeToken = {
        name: 'MATIC',
        decimals: 18,
        price: 2,
        address: 'native',
      };
      mockErc20Token1 = {
        name: 'TKN20-1',
        address: (
          await deployContract(customERC20Artifact, ['', 'TKN20-1', 14], protocolOwnerSigner)
        ).address.toLowerCase(),
        decimals: 14,
        price: 2,
      };
      mockErc20Token2 = {
        symbol: 'TKN20-2',
        address: (
          await deployContract(customERC20Artifact, ['TKN20-2', '', 16], protocolOwnerSigner)
        ).address.toLowerCase(),
        decimals: 16,
        price: 10,
      };
      mockErc721Token1 = {
        name: 'TKN721-1',
        address: (
          await deployContract(customERC721Artifact, ['TKN721-1', ''], protocolOwnerSigner)
        ).address.toLowerCase(),
      };
      mockErc721Token2 = {
        name: 'TKN721-2',
        address: (
          await deployContract(customERC721Artifact, ['TKN721-2', ''], protocolOwnerSigner)
        ).address.toLowerCase(),
      };
      mockErc1155Token1 = {
        name: 'TKN1155-1',
        address: (
          await deployContract(customERC1155Artifact, [], protocolOwnerSigner)
        ).address.toLowerCase(),
      };
      mockErc1155Token2 = {
        name: 'TKN1155-2',
        address: (
          await deployContract(customERC1155Artifact, [], protocolOwnerSigner)
        ).address.toLowerCase(),
      };

      // mock thresholds for erc721 and erc1155 tokens
      mockData.totalTokensThresholdsByAddress = {
        [mockErc721Token1.address]: {
          name: mockErc721Token1.name,
          threshold: new BigNumber(10),
        },
        [mockErc721Token2.address]: {
          name: mockErc721Token2.name,
          threshold: new BigNumber(20),
        },
        [mockErc1155Token1.address]: {
          name: mockErc1155Token1.name,
          threshold: new BigNumber(40),
        },
        [mockErc1155Token2.address]: {
          name: mockErc1155Token2.name,
          threshold: new BigNumber(80),
        },
      };
    };

    const deployExploitedProtocol = async (
      deployerSigner: ethers.providers.JsonRpcSigner,
      balance: {
        native?: string | number | BigNumber;
        erc20?: {
          [address: string]: string | number | BigNumber;
        };
        erc721?: {
          [address: string]: string | number | BigNumber;
        };
        erc1155?: {
          [address: string]: (string | number | BigNumber)[];
        };
      },
    ) => {
      // Since this is a test smart-contracts, all deployed tokens contain mint() function that allows to mint tokens without restriction.
      // This contract mints balance of passed tokens in the constructor (see ExploitedProtocol.sol).
      const normalize = (v: string | number | BigNumber) => new BigNumber(v).toFixed();
      return await deployContract(
        exploitedProtocolArtifact,
        [
          Object.keys(balance.erc20 || {}),
          Object.values(balance.erc20 || {}).map(normalize),
          Object.keys(balance.erc721 || {}),
          Object.values(balance.erc721 || {}).map(normalize),
          Object.keys(balance.erc1155 || {}),
          Object.values(balance.erc1155 || {}).map((arr) => arr.map(normalize)),
        ],
        deployerSigner,
        new BigNumber(balance.native || 0).toFixed(),
      );
    };

    const deployExploit = async (
      attackerSigner: ethers.providers.JsonRpcSigner,
      variant: ExploitVaraint,
      protocolAddress: string,
      fundingAddress?: string,
    ) => {
      const params = [protocolAddress];

      if (variant !== ExploitVaraint.ExploitSelfFunded) {
        params.push(fundingAddress || (await attackerSigner.getAddress()));
      }

      const exploitArtifact = await compile(variant);
      return await deployContract(exploitArtifact, params, attackerSigner);
    };

    function testFinding(
      finding: Finding,
      params: {
        attackerAddress: string;
        fundedAddress: string;
        protocolAddress: string;
        exploitContract: ethers.Contract;
        exploitFunctionParamsNumber?: number;
        transferredTokens: {
          native?: { name: string; decimals: number; value: BigNumber };
          erc20?: { name?: string; address: string; decimals: number; value: BigNumber }[];
          erc721?: { name: string; address: string; value: BigNumber }[];
          erc1155?: { name: string; address: string; value: BigNumber }[];
        };
      },
    ) {
      const {
        attackerAddress,
        fundedAddress,
        protocolAddress,
        exploitContract,
        exploitFunctionParamsNumber = 0,
        transferredTokens,
      } = params;

      expect(finding).toBeDefined();
      expect(finding.metadata.sighash).toStrictEqual(
        exploitContract.interface.getSighash('attack'),
      );
      if (exploitFunctionParamsNumber > 0) {
        expect(finding.metadata.calldata).toHaveLength(
          32 /* bytes */ * 2 /* symbols per byte */ * exploitFunctionParamsNumber /* params */,
        );
      } else {
        expect(finding.metadata.calldata).toStrictEqual('');
      }
      expect(finding.metadata.contractAddress).toStrictEqual(exploitContract.address.toLowerCase());
      expect(finding.metadata.fundedAddress).toStrictEqual(fundedAddress.toLowerCase());
      expect(finding.metadata.deployerAddress).toStrictEqual(
        exploitContract.deployTransaction.from.toLowerCase(),
      );

      const addresses = new Set([
        attackerAddress.toLowerCase(),
        exploitContract.address.toLowerCase(),
        ...(transferredTokens.erc20 || []).map((t) => t.address.toLowerCase()),
        ...(transferredTokens.erc721 || []).map((t) => t.address.toLowerCase()),
        ...(transferredTokens.erc1155 || []).map((t) => t.address.toLowerCase()),
      ]);

      // check whether we can indentify affected protocol by token events
      if (
        [transferredTokens.erc20, transferredTokens.erc721, transferredTokens.erc1155].find(
          (v) => v && v.length > 0,
        )
      ) {
        addresses.add(protocolAddress.toLowerCase());
      }

      expect(finding.addresses).toEqual(expect.arrayContaining([...addresses]));

      const balanceChanges: TokenInfo[] = [
        ...(transferredTokens.erc20 || []).map((t) => ({ ...t, type: TokenInterface.ERC20 })),
        ...(transferredTokens.erc721 || []).map((t) => ({ ...t, type: TokenInterface.ERC721 })),
        ...(transferredTokens.erc1155 || []).map((t) => ({ ...t, type: TokenInterface.ERC1155 })),
      ];

      if (transferredTokens.native) {
        balanceChanges.push({
          ...transferredTokens.native,
          type: TokenInterface.NATIVE,
          address: mockNativeToken.address,
        });
      }

      // compare with type normalization (e.g. BigNumber -> string)
      expect(JSON.parse(finding.metadata.balanceChanges)[fundedAddress.toLowerCase()]).toEqual(
        expect.arrayContaining(JSON.parse(JSON.stringify(balanceChanges))),
      );
    }

    it("should push nothing if contract doesn't transfer tokens", async () => {
      const regularArtifact = await compile('RegularContract.sol');
      const regularContract = await deployContract(regularArtifact, [], protocolOwnerSigner);

      const createdContract: CreatedContract = {
        address: await regularContract.resolvedAddress,
        deployer: await protocolOwnerSigner.getAddress(),
        blockNumber: regularContract.deployTransaction.blockNumber!,
        timestamp: regularContract.deployTransaction.timestamp!,
        txHash: regularContract.deployTransaction.hash,
      };

      await handleContract(createdContract);

      expect(mockData.findings).toStrictEqual([]);
    });

    it('should push nothing if attack function transfers tokens not exceeding threshold', async () => {
      // deploy contract of the victim and mint the balance that will be transferred to the attacker's address
      const protocolContract = await deployExploitedProtocol(protocolOwnerSigner, {
        native: new BigNumber(mockData.totalUsdTransferThreshold)
          .div(2)
          .decimalPlaces(0)
          .div(mockNativeToken.price)
          .multipliedBy(nominator(mockNativeToken.decimals)),
        erc20: {
          [mockErc20Token1.address]: new BigNumber(mockData.totalUsdTransferThreshold)
            .div(2)
            .decimalPlaces(0)
            .div(mockErc20Token1.price)
            .multipliedBy(nominator(mockErc20Token1.decimals)),
        },
        erc721: {
          [mockErc721Token1.address]:
            mockData.totalTokensThresholdsByAddress[mockErc721Token1.address].threshold,
        },
        erc1155: {
          [mockErc1155Token1.address]: [
            mockData.totalTokensThresholdsByAddress[mockErc1155Token1.address].threshold,
          ],
        },
      });

      // deploy exploit contract
      const exploitContract = await deployExploit(
        attackerSigner,
        ExploitVaraint.ExploitNoParams,
        protocolContract.address,
      );

      await handleContract({
        address: exploitContract.address,
        deployer: exploitContract.deployTransaction.from,
        blockNumber: exploitContract.deployTransaction.blockNumber!,
        timestamp: exploitContract.deployTransaction.timestamp!,
        txHash: exploitContract.deployTransaction.hash,
      });

      // should not fire alert because we haven't exceeded the threshold
      expect(mockData.findings).toStrictEqual([]);
    });

    it('should push nothing if erc20 token price is unknown', async () => {
      const newTokenContract = await deployContract(
        customERC20Artifact,
        ['', '', 18],
        protocolOwnerSigner,
      );

      // deploy contract of the victim and mint the balance that will be transferred to the attacker's address
      const protocolContract = await deployExploitedProtocol(protocolOwnerSigner, {
        erc20: {
          [newTokenContract.address]: new BigNumber(1e10),
        },
      });

      // deploy exploit contract
      const exploitContract = await deployExploit(
        attackerSigner,
        ExploitVaraint.ExploitNoParams,
        protocolContract.address,
      );

      await handleContract({
        address: exploitContract.address,
        deployer: exploitContract.deployTransaction.from,
        blockNumber: exploitContract.deployTransaction.blockNumber!,
        timestamp: exploitContract.deployTransaction.timestamp!,
        txHash: exploitContract.deployTransaction.hash,
      });

      // should not fire alert because the price of the transferred token is unknown
      expect(mockData.findings).toStrictEqual([]);
    });

    it('should push nothing if function transfers unknown erc721 and erc1155 tokens', async () => {
      const newErc721TokenContract = await deployContract(
        customERC721Artifact,
        ['', ''],
        protocolOwnerSigner,
      );
      const newErc1155TokenContract = await deployContract(
        customERC1155Artifact,
        [],
        protocolOwnerSigner,
      );

      // deploy contract of the victim and mint the balance that will be transferred to the attacker's address
      const protocolContract = await deployExploitedProtocol(protocolOwnerSigner, {
        erc721: {
          [newErc721TokenContract.address]: new BigNumber(10),
        },
        erc1155: {
          [newErc1155TokenContract.address]: [new BigNumber(20)],
        },
      });

      // deploy exploit contract
      const exploitContract = await deployExploit(
        attackerSigner,
        ExploitVaraint.ExploitNoParams,
        protocolContract.address,
      );

      await handleContract({
        address: exploitContract.address,
        deployer: exploitContract.deployTransaction.from,
        blockNumber: exploitContract.deployTransaction.blockNumber!,
        timestamp: exploitContract.deployTransaction.timestamp!,
        txHash: exploitContract.deployTransaction.hash,
      });

      // should not fire alert because the price of the transferred tokens is unknown
      expect(mockData.findings).toStrictEqual([]);
    });

    it('should push a finding if value of transferred native token exceeds threshold value', async () => {
      const nativeTokenTransferValue = new BigNumber(mockData.totalUsdTransferThreshold)
        .div(mockNativeToken.price)
        .multipliedBy(nominator(mockNativeToken.decimals))
        .plus(1)
        .decimalPlaces(0);

      // deploy contract of the victim and mint the balance that will be transferred to the attacker's address
      const protocolContract = await deployExploitedProtocol(protocolOwnerSigner, {
        native: nativeTokenTransferValue,
      });

      // deploy exploit contract
      const exploitContract = await deployExploit(
        attackerSigner,
        ExploitVaraint.ExploitNoParams,
        protocolContract.address,
      );

      // handle transaction
      await handleContract({
        address: exploitContract.address.toLowerCase(),
        deployer: exploitContract.deployTransaction.from.toLowerCase(),
        blockNumber: exploitContract.deployTransaction.blockNumber!,
        timestamp: exploitContract.deployTransaction.timestamp!,
        txHash: exploitContract.deployTransaction.hash,
      });

      // test finding
      testFinding(mockData.findings[0], {
        attackerAddress: await attackerSigner.getAddress(),
        fundedAddress: await attackerSigner.getAddress(),
        protocolAddress: protocolContract.address,
        exploitContract: exploitContract,
        transferredTokens: {
          native: {
            name: mockNativeToken.name,
            decimals: mockNativeToken.decimals,
            value: nativeTokenTransferValue,
          },
        },
      });
    });

    it('should push a finding if total value of transferred erc20 tokens exceed threshold value', async () => {
      const token1Value = new BigNumber(mockData.totalUsdTransferThreshold)
        .div(2)
        .decimalPlaces(0)
        .div(mockErc20Token1.price)
        .multipliedBy(nominator(mockErc20Token1.decimals));
      const token2Value = new BigNumber(mockData.totalUsdTransferThreshold)
        .div(2)
        .decimalPlaces(0)
        .div(mockErc20Token2.price)
        .multipliedBy(nominator(mockErc20Token2.decimals))
        .plus(1);

      // deploy contract of the victim and mint the balance that will be transferred to the attacker's address
      const protocolContract = await deployExploitedProtocol(protocolOwnerSigner, {
        erc20: {
          [mockErc20Token1.address]: token1Value,
          [mockErc20Token2.address]: token2Value,
        },
      });

      // deploy exploit contract
      const exploitContract = await deployExploit(
        attackerSigner,
        ExploitVaraint.ExploitNoParams,
        protocolContract.address,
      );

      // handle transaction
      await handleContract({
        address: exploitContract.address.toLowerCase(),
        deployer: exploitContract.deployTransaction.from.toLowerCase(),
        blockNumber: exploitContract.deployTransaction.blockNumber!,
        timestamp: exploitContract.deployTransaction.timestamp!,
        txHash: exploitContract.deployTransaction.hash,
      });

      // test finding
      testFinding(mockData.findings[0], {
        attackerAddress: await attackerSigner.getAddress(),
        fundedAddress: await attackerSigner.getAddress(),
        protocolAddress: protocolContract.address,
        exploitContract: exploitContract,
        transferredTokens: {
          erc20: [
            {
              name: mockErc20Token1.symbol || mockErc20Token1.name,
              decimals: mockErc20Token1.decimals,
              address: mockErc20Token1.address,
              value: token1Value,
            },
            {
              name: mockErc20Token2.symbol || mockErc20Token2.name,
              decimals: mockErc20Token2.decimals,
              address: mockErc20Token2.address,
              value: token2Value,
            },
          ],
        },
      });
    });

    it('should push a finding if transferred erc721 tokens exceeds threshold value', async () => {
      const token1Value =
        mockData.totalTokensThresholdsByAddress[mockErc721Token1.address].threshold.plus(1);

      // deploy contract of the victim and mint the balance that will be transferred to the attacker's address
      const protocolContract = await deployExploitedProtocol(protocolOwnerSigner, {
        erc721: {
          [mockErc721Token1.address]: token1Value,
        },
      });

      // deploy exploit contract
      const exploitContract = await deployExploit(
        attackerSigner,
        ExploitVaraint.ExploitNoParams,
        protocolContract.address,
      );

      // handle transaction
      await handleContract({
        address: exploitContract.address.toLowerCase(),
        deployer: exploitContract.deployTransaction.from.toLowerCase(),
        blockNumber: exploitContract.deployTransaction.blockNumber!,
        timestamp: exploitContract.deployTransaction.timestamp!,
        txHash: exploitContract.deployTransaction.hash,
      });

      // test finding
      testFinding(mockData.findings[0], {
        attackerAddress: await attackerSigner.getAddress(),
        fundedAddress: await attackerSigner.getAddress(),
        protocolAddress: protocolContract.address,
        exploitContract: exploitContract,
        transferredTokens: {
          erc721: [
            {
              name: mockErc721Token1.name,
              address: mockErc721Token1.address,
              value: token1Value,
            },
          ],
        },
      });
    });

    it('should push a finding if sum of transferred erc1155 tokens exceeds threshold value', async () => {
      const tokenValue =
        mockData.totalTokensThresholdsByAddress[mockErc1155Token1.address].threshold.plus(2);
      const subToken1Value = tokenValue.div(2).decimalPlaces(0);
      const subToken2Value = tokenValue.minus(subToken1Value);

      // deploy contract of the victim and mint the balance that will be transferred to the attacker's address
      const protocolContract = await deployExploitedProtocol(protocolOwnerSigner, {
        erc1155: {
          [mockErc1155Token1.address]: [subToken1Value, subToken2Value],
        },
      });

      // deploy exploit contract
      const exploitContract = await deployExploit(
        attackerSigner,
        ExploitVaraint.ExploitNoParams,
        protocolContract.address,
      );

      // handle transaction
      await handleContract({
        address: exploitContract.address.toLowerCase(),
        deployer: exploitContract.deployTransaction.from.toLowerCase(),
        blockNumber: exploitContract.deployTransaction.blockNumber!,
        timestamp: exploitContract.deployTransaction.timestamp!,
        txHash: exploitContract.deployTransaction.hash,
      });

      // test finding
      testFinding(mockData.findings[0], {
        attackerAddress: await attackerSigner.getAddress(),
        fundedAddress: await attackerSigner.getAddress(),
        protocolAddress: protocolContract.address,
        exploitContract: exploitContract,
        transferredTokens: {
          erc1155: [
            {
              name: mockErc1155Token1.name,
              address: mockErc1155Token1.address,
              value: tokenValue,
            },
          ],
        },
      });
    });

    it('should push a finding if attack function has multiple parameters', async () => {
      const nativeTokenTransferValue = new BigNumber(mockData.totalUsdTransferThreshold)
        .div(mockNativeToken.price)
        .multipliedBy(nominator(mockNativeToken.decimals))
        .plus(1)
        .decimalPlaces(0);

      // deploy contract of the victim and mint the balance that will be transferred to the attacker's address
      const protocolContract = await deployExploitedProtocol(protocolOwnerSigner, {
        native: nativeTokenTransferValue,
      });

      // deploy exploit contract
      const exploitContract = await deployExploit(
        attackerSigner,
        ExploitVaraint.ExploitMultipleParams,
        protocolContract.address,
      );

      // handle transaction
      await handleContract({
        address: exploitContract.address.toLowerCase(),
        deployer: exploitContract.deployTransaction.from.toLowerCase(),
        blockNumber: exploitContract.deployTransaction.blockNumber!,
        timestamp: exploitContract.deployTransaction.timestamp!,
        txHash: exploitContract.deployTransaction.hash,
      });

      // test finding
      testFinding(mockData.findings[0], {
        attackerAddress: await attackerSigner.getAddress(),
        fundedAddress: await attackerSigner.getAddress(),
        protocolAddress: protocolContract.address,
        exploitContract: exploitContract,
        exploitFunctionParamsNumber: 5,
        transferredTokens: {
          native: {
            name: mockNativeToken.name,
            decimals: mockNativeToken.decimals,
            value: nativeTokenTransferValue,
          },
        },
      });
    });

    it('should push a finding if attack function is payable', async () => {
      const nativeTokenTransferValue = new BigNumber(mockData.totalUsdTransferThreshold)
        .div(mockNativeToken.price)
        .multipliedBy(nominator(mockNativeToken.decimals))
        .decimalPlaces(0)
        // since the attacker sends some ether when he calls the exploit function,
        // we should add this value to make so that the "net" profit exceeds the USD threshold
        .plus(
          new BigNumber(mockData.payableFunctionEtherValue).multipliedBy(
            nominator(mockNativeToken.decimals),
          ),
        )
        .plus(1);

      // deploy contract of the victim and mint the balance that will be transferred to the attacker's address
      const protocolContract = await deployExploitedProtocol(protocolOwnerSigner, {
        native: nativeTokenTransferValue,
      });

      // deploy exploit contract
      const exploitContract = await deployExploit(
        attackerSigner,
        ExploitVaraint.ExploitPayable,
        protocolContract.address,
      );

      // handle transaction
      await handleContract({
        address: exploitContract.address.toLowerCase(),
        deployer: exploitContract.deployTransaction.from.toLowerCase(),
        blockNumber: exploitContract.deployTransaction.blockNumber!,
        timestamp: exploitContract.deployTransaction.timestamp!,
        txHash: exploitContract.deployTransaction.hash,
      });

      // test finding
      testFinding(mockData.findings[0], {
        attackerAddress: await attackerSigner.getAddress(),
        fundedAddress: await attackerSigner.getAddress(),
        protocolAddress: protocolContract.address,
        exploitContract: exploitContract,
        exploitFunctionParamsNumber: 5,
        transferredTokens: {
          native: {
            name: mockNativeToken.name,
            decimals: mockNativeToken.decimals,
            // substitute the ether value we send to the payable function
            value: nativeTokenTransferValue.minus(
              new BigNumber(mockData.payableFunctionEtherValue).multipliedBy(
                nominator(mockNativeToken.decimals),
              ),
            ),
          },
        },
      });
    });

    it('should push a finding if tokens are transferred to exploit contract', async () => {
      const nativeTokenTransferValue = new BigNumber(mockData.totalUsdTransferThreshold)
        .div(mockNativeToken.price)
        .multipliedBy(nominator(mockNativeToken.decimals))
        .decimalPlaces(0)
        .plus(1);

      // deploy contract of the victim and mint the balance that will be transferred to the attacker's address
      const protocolContract = await deployExploitedProtocol(protocolOwnerSigner, {
        native: nativeTokenTransferValue,
      });

      // deploy exploit contract
      const exploitContract = await deployExploit(
        attackerSigner,
        ExploitVaraint.ExploitSelfFunded,
        protocolContract.address,
      );

      // handle transaction
      await handleContract({
        address: exploitContract.address.toLowerCase(),
        deployer: exploitContract.deployTransaction.from.toLowerCase(),
        blockNumber: exploitContract.deployTransaction.blockNumber!,
        timestamp: exploitContract.deployTransaction.timestamp!,
        txHash: exploitContract.deployTransaction.hash,
      });

      // test finding
      testFinding(mockData.findings[0], {
        attackerAddress: await attackerSigner.getAddress(),
        fundedAddress: exploitContract.address,
        protocolAddress: protocolContract.address,
        exploitContract: exploitContract,
        transferredTokens: {
          native: {
            name: mockNativeToken.name,
            decimals: mockNativeToken.decimals,
            value: nativeTokenTransferValue,
          },
        },
      });
    });

    // TODO Unfortunately, I haven't found a way to get transaction trances in the Ganache yet
    it.todo('should push a finding if tokens are transferred to unknown EOA');

    // it('should push a finding if tokens are transferred to unknown EOA', async () => {
    //   const unknownEOA = createAddress('0x123456789');
    //   const nativeTokenTransferValue = new BigNumber(mockData.totalUsdTransferThreshold)
    //     .div(mockNativeToken.price)
    //     .multipliedBy(nominator(mockNativeToken.decimals))
    //     .decimalPlaces(0)
    //     .plus(1);
    //
    //   // deploy contract of the victim and mint the balance that will be transferred to the attacker's address
    //   const protocolContract = await deployExploitedProtocol(protocolOwnerSigner, {
    //     native: nativeTokenTransferValue,
    //   });
    //
    //   // deploy exploit contract
    //   const exploitContract = await deployExploit(
    //     attackerSigner,
    //     ExploitVaraint.ExploitNoParams,
    //     protocolContract.address,
    //     unknownEOA,
    //   );
    //
    //   // handle transaction
    //   await handleContract({
    //     address: exploitContract.address.toLowerCase(),
    //     blockNumber: exploitContract.deployTransaction.blockNumber!,
    //     deployer: exploitContract.deployTransaction.from.toLowerCase(),
    //   });
    //
    //   // test finding
    //   testFinding(mockData.findings[0], {
    //     attackerAddress: await attackerSigner.getAddress(),
    //     fundedAddress: unknownEOA,
    //     protocolAddress: protocolContract.address,
    //     exploitContract: exploitContract,
    //     transferredTokens: {
    //       native: {
    //         name: mockNativeToken.name,
    //         decimals: mockNativeToken.decimals,
    //         value: nativeTokenTransferValue,
    //       },
    //     },
    //   });
    // });

    it.todo(
      'should push nothing if tokens are transferred to the owner because of withdraw() function',
    );
  });

  describe('handleTransaction', () => {
    let mockData: DataContainer;
    let mockTxEvent: TestTransactionEvent;
    const mockQueue = {
      push: jest.fn(),
      length: jest.fn().mockReturnValue(0),
      workersList: jest.fn().mockReturnValue([]),
    };
    const mockBotUtils = {
      ...botUtils,
      getCreatedContracts: jest.fn(),
    };
    const mockEnv: BotEnv = {};
    const mockHandleContract = jest.fn();
    const mockChainId = 1;

    let handleTransaction: HandleTransaction;

    beforeAll(() => {
      mockEthersProvider.mockReturnValue({
        getNetwork() {
          return { chainId: mockChainId };
        },
      });
    });

    beforeEach(async () => {
      mockData = {} as DataContainer;
      mockTxEvent = new TestTransactionEvent();

      const initialize = provideInitialize(
        mockData,
        {
          developerAbbreviation: 'TEST',
          payableFunctionEtherValue: 123456,
          totalUsdTransferThreshold: 123456789,
          maliciousContractMLBotId:
            '0x0b241032ca430d9c02eaa6a52d217bbff046f0d1b3f3d2aa928e42a97150ec91',
          defaultAnomalyScore: {
            [mockChainId]: 0.123,
          },
          totalTokensThresholdsByChain: {
            '1': {
              '0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85': {
                name: 'ENS',
                threshold: 25,
              },
            },
          },
        },
        mockEnv,
        mockHandleContract,
      );

      await initialize();

      handleTransaction = provideHandleTransaction(mockData, mockBotUtils, initialize);

      mockData.queue = mockQueue as any;
      mockHandleContract.mockReset();
      mockQueue.push.mockClear();
      mockQueue.length.mockClear();
      mockQueue.workersList.mockClear();

      mockBotUtils.getCreatedContracts.mockImplementation(() => []);
    });

    afterAll(() => {
      mockEthersProvider.mockReset();
    });

    it('should re-initialize if it has not been initialized yet', async () => {
      const data = {} as DataContainer;
      const initialize = provideInitialize(
        data,
        {
          developerAbbreviation: 'TEST',
          payableFunctionEtherValue: 123456,
          totalUsdTransferThreshold: 123456789,
          maliciousContractMLBotId:
            '0x0b241032ca430d9c02eaa6a52d217bbff046f0d1b3f3d2aa928e42a97150ec91',
          defaultAnomalyScore: {
            [mockChainId]: 0.123,
          },
          totalTokensThresholdsByChain: {
            '1': {
              '0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85': {
                name: 'ENS',
                threshold: 25,
              },
            },
          },
        },
        mockEnv,
        mockHandleContract,
      );
      handleTransaction = provideHandleTransaction(data, botUtils, initialize);

      expect(!!data.isInitialized).toBe(false);

      await handleTransaction(mockTxEvent);

      expect(data.isInitialized).toBe(true);
    });

    it('should return empty findings if there are no new findings in data container', async () => {
      const findings = await handleTransaction(mockTxEvent);
      expect(findings).toStrictEqual([]);
    });

    it('should return and clear findings when handleContract push them to data container', async () => {
      let findings = await handleTransaction(mockTxEvent);
      expect(findings).toStrictEqual([]);
      const expectedFindings = [
        Finding.from({
          alertId: '1',
          name: 'Name 1',
          description: 'Description 1',
          type: FindingType.Unknown,
          severity: FindingSeverity.Unknown,
        }),
        Finding.from({
          alertId: '2',
          name: 'Name 2',
          description: 'Description 2',
          type: FindingType.Unknown,
          severity: FindingSeverity.Unknown,
        }),
      ];
      mockData.findings.push(...expectedFindings);
      findings = await handleTransaction(mockTxEvent);
      expect(findings).toStrictEqual(expectedFindings);
      expect(mockData.findings).toStrictEqual([]);
    });

    it('should push all detected contracts to queue if isTargetMode is disabled', async () => {
      const createdContracts: CreatedContract[] = [
        {
          address: '0x1',
          deployer: '0x2',
          timestamp: 1000,
          blockNumber: 1234,
          txHash: '0xHASH',
        },
        {
          address: '0x3',
          deployer: '0x4',
          timestamp: 1000,
          blockNumber: 1234,
          txHash: '0xHASH',
        },
      ];

      mockData.isTargetMode = false;
      mockBotUtils.getCreatedContracts.mockReset().mockReturnValue( createdContracts);

      await handleTransaction(mockTxEvent);

      expect(mockQueue.push).toBeCalledTimes(createdContracts.length);
    });

    it('should push only suspicious contracts to queue if isTargetMode is enabled', async () => {
      const createdContracts: CreatedContract[] = [
        {
          address: '0x1',
          deployer: '0x2',
          timestamp: 1000,
          blockNumber: 1234,
          txHash: '0xHASH',
        },
        {
          address: '0x3',
          deployer: '0x4',
          timestamp: 1000,
          blockNumber: 1234,
          txHash: '0xHASH',
        },
      ];

      mockData.isTargetMode = true;
      mockBotUtils.getCreatedContracts.mockImplementation(() => createdContracts);

      await handleTransaction(mockTxEvent);

      // should push to detected contracts
      expect(mockData.detectedContractByAddress.size).toStrictEqual(createdContracts.length);
      expect(mockQueue.push).not.toBeCalled();

      // simulating result of the handleAlert()
      mockData.suspiciousContractByAddress.set(createdContracts[1].address, createdContracts[1]);

      await handleTransaction(mockTxEvent);

      expect(mockQueue.push).toBeCalledTimes(1);
      expect(mockQueue.push.mock.calls[0][0]).toBe(createdContracts[1]);
    });

    it('should clear detected and suspicious contracts if they are outdated', async () => {
      const interval = 1000;

      const contract1: CreatedContract = {
        address: '0x1',
        deployer: '0x2',
        timestamp: interval,
        blockNumber: 100,
        txHash: '0xHASH1',
      };
      const contract2: CreatedContract = {
        address: '0x3',
        deployer: '0x4',
        timestamp: interval,
        blockNumber: 1234,
        txHash: '0xHASH2',
      };
      const contract3: CreatedContract = {
        address: '0x5',
        deployer: '0x6',
        timestamp: interval * 2,
        blockNumber: 200,
        txHash: '0xHASH3',
      };
      const contract4: CreatedContract = {
        address: '0x7',
        deployer: '0x8',
        timestamp: interval * 3,
        blockNumber: 300,
        txHash: '0xHASH4',
      };

      mockData.contractWaitingTime = interval;

      mockData.detectedContractByAddress.set(contract1.address, contract1);
      mockData.detectedContractByAddress.set(contract2.address, contract2);
      mockData.detectedContractByAddress.set(contract3.address, contract3);
      mockData.detectedContractByAddress.set(contract4.address, contract4);
      mockData.suspiciousContractByAddress.set(contract1.address, contract1);
      mockData.suspiciousContractByAddress.set(contract2.address, contract2);
      mockData.suspiciousContractByAddress.set(contract3.address, contract3);
      mockData.suspiciousContractByAddress.set(contract4.address, contract4);

      mockTxEvent.setTimestamp(contract1.timestamp);

      await handleTransaction(mockTxEvent);

      expect(mockData.detectedContractByAddress.size).toStrictEqual(4);
      expect(mockData.suspiciousContractByAddress.size).toStrictEqual(4);

      // ---------

      mockTxEvent.setTimestamp(contract1.timestamp + mockData.contractWaitingTime + 1);

      await handleTransaction(mockTxEvent);

      expect(mockData.detectedContractByAddress.size).toStrictEqual(2);
      expect(mockData.detectedContractByAddress.has(contract3.address));
      expect(mockData.detectedContractByAddress.has(contract4.address));
      expect(mockData.suspiciousContractByAddress.size).toStrictEqual(2);
      expect(mockData.suspiciousContractByAddress.has(contract3.address));
      expect(mockData.suspiciousContractByAddress.has(contract4.address));

      // ---------

      mockTxEvent.setTimestamp(contract1.timestamp + mockData.contractWaitingTime * 2 + 1);

      await handleTransaction(mockTxEvent);

      expect(mockData.detectedContractByAddress.size).toStrictEqual(1);
      expect(mockData.detectedContractByAddress.has(contract4.address));
      expect(mockData.suspiciousContractByAddress.size).toStrictEqual(1);
      expect(mockData.suspiciousContractByAddress.has(contract4.address));

      // ---------

      mockTxEvent.setTimestamp(contract1.timestamp + mockData.contractWaitingTime * 3 + 1);

      await handleTransaction(mockTxEvent);

      expect(mockData.detectedContractByAddress.size).toStrictEqual(0);
      expect(mockData.suspiciousContractByAddress.size).toStrictEqual(0);
    });
  });

  describe('handleAlert', () => {
    let mockData: DataContainer;
    const mockChainId = 56;
    const mockEnv: BotEnv = {};
    const mockConfig: BotConfig = {
      developerAbbreviation: 'TEST',
      payableFunctionEtherValue: 123456,
      totalUsdTransferThreshold: 123456789,
      maliciousContractMLBotId:
        '0x0b241032ca430d9c02eaa6a52d217bbff046f0d1b3f3d2aa928e42a97150ec91',
      defaultAnomalyScore: {
        ['1']: 0.123,
      },
      totalTokensThresholdsByChain: {},
    };
    const mockHandleContract = jest.fn().mockImplementation(async () => []);

    let handleAlert: HandleAlert;

    beforeAll(() => {
      mockEthersProvider.mockReturnValue({
        getNetwork() {
          return { chainId: mockChainId };
        },
      });
    });

    beforeEach(() => {
      mockData = {} as DataContainer;
      handleAlert = provideHandleAlert(mockData, mockConfig);
      provideInitialize(mockData, mockConfig, mockEnv, mockHandleContract)();
      mockHandleContract.mockClear();
    });

    afterAll(() => {
      mockEthersProvider.mockReset();
    });

    it('should return alertConfig from initialize()', async () => {
      const result = await provideInitialize(mockData, mockConfig, mockEnv, mockHandleContract)();

      expect(result).toMatchObject({
        alertConfig: {
          subscriptions: [
            {
              botId: mockConfig.maliciousContractMLBotId,
              alertIds: ['SUSPICIOUS-CONTRACT-CREATION'],
              chainId: mockChainId,
            },
          ],
        },
      });
    });

    it('should add suspicious contract to data provider', async () => {
      const contract = '0x5cbb4eb2cbf21d09afe117cf5dd61b3c1aa87cf9'.toUpperCase();

      await handleAlert(
        new AlertEvent(
          Alert.fromObject({
            alertId: 'SUSPICIOUS-CONTRACT-CREATION',
            description: `0xd2db126090d3ab52a39b40632059d509aa50aca6 created contract ${contract}`,
            source: {
              bot: { id: mockConfig.maliciousContractMLBotId },
            },
          }),
        ),
      );

      mockData.suspiciousContractByAddress.has(contract.toLowerCase());
    });

    it('should prioritize suspicious contract in queue', async () => {
      const createdContract: CreatedContract = {
        address: '0x5cbb4eb2cbf21d09afe117cf5dd61b3c1aa87cf9',
        timestamp: 1234,
        deployer: '0x1',
        blockNumber: 1234,
        txHash: '0xHASH',
      };

      mockData.queue.pause();
      mockData.queue.push(createdContract, 9);

      await handleAlert(
        new AlertEvent(
          Alert.fromObject({
            alertId: 'SUSPICIOUS-CONTRACT-CREATION',
            description: `0xd2db126090d3ab52a39b40632059d509aa50aca6 created contract ${createdContract.address}`,
            source: {
              bot: { id: mockConfig.maliciousContractMLBotId },
            },
          }),
        ),
      );

      let node: { data: CreatedContract; priority: number;  } | undefined;
      mockData.queue.remove((_node) => {
        if (_node.data.address === createdContract.address) node = _node;
        return !!node
      });

      expect(node?.priority).toStrictEqual(1)
    });
  });
});
