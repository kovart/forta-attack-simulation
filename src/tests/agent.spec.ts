const mockEthersProvider = jest.fn();

jest.mock('forta-agent', () => ({
  ...jest.requireActual('forta-agent'),
  getEthersProvider: mockEthersProvider,
}));

import { Finding, FindingSeverity, FindingType, HandleTransaction } from 'forta-agent';
import Ganache, { EthereumProvider } from 'ganache';
import BigNumber from 'bignumber.js';
import { ethers } from 'ethers';
import { TestTransactionEvent } from 'forta-agent-tools/lib/tests';
import { CreatedContract, DataContainer, HandleContract, TokenInterface } from '../types';
import { compile, CompilerArtifact } from './utils/compiler';
import { Logger, LoggerLevel } from '../logger';
import agent from '../agent';

const { provideInitialize, provideHandleContract, provideHandleTransaction } = agent;

describe('attack simulation', () => {
  describe('handleContract', () => {
    jest.setTimeout(5 * 60 * 1000);

    type TestTokensConfig = {
      native: { transferredValue: number };
      erc20: { name?: string; symbol?: string; decimals: number; transferredValue: number }[];
      erc721: { name?: string; symbol?: string; transferredTokens: number }[];
      erc1155: { name?: string; symbol?: string; transferredValues: number[] }[];
    };

    enum ExploitVaraint {
      ExploitNoParams = 'ExploitNoParams.sol',
      ExploitMultipleParams = 'ExploitMultipleParams.sol',
    }

    let data: DataContainer;
    let handleContract: HandleContract;
    let ganacheProvider: EthereumProvider;
    let web3Provider: ethers.providers.Web3Provider;
    let customERC20Artifact: CompilerArtifact;
    let customERC721Artifact: CompilerArtifact;
    let customERC1155Artifact: CompilerArtifact;
    let accounts: string[];

    beforeAll(async () => {
      customERC20Artifact = compile('CustomERC20.sol');
      customERC721Artifact = compile('CustomERC721.sol');
      customERC1155Artifact = compile('CustomERC1155.sol');
      ganacheProvider = Ganache.provider({
        logging: { quiet: true },
        wallet: {
          defaultBalance: 100000000,
        },
      });
      web3Provider = new ethers.providers.Web3Provider(ganacheProvider as any);
      accounts = await web3Provider.listAccounts();
    });

    beforeEach(() => {
      data = {} as any;
      data.findings = [];
      data.tokensConfig = {
        native: {
          name: 'ETH',
          decimals: 18,
          threshold: 10,
        },
      };
      data.developerAbbreviation = 'AK';
      data.logger = new Logger(LoggerLevel.DEBUG);
      data.isDevelopment = true;
      data.isInitialized = true;
      handleContract = provideHandleContract(data, () => web3Provider);
    });

    afterAll(() => {
      ganacheProvider.disconnect();
    });

    const deployContract = async (
      artifact: CompilerArtifact,
      constructorParams: any[],
      signer: ethers.providers.JsonRpcSigner,
      value = 0,
    ) => {
      const factory = new ethers.ContractFactory(
        artifact.abi,
        artifact.evm.bytecode.object,
        signer,
      );
      const contract = await factory.deploy(...constructorParams, {
        value: new BigNumber(value).multipliedBy(new BigNumber(10).pow(18)).toString(),
      });
      await contract.deployed();
      return contract;
    };

    const deployTokens = async (
      deployerSigner: ethers.providers.JsonRpcSigner,
      tokenDeployment: TestTokensConfig,
    ) => {
      const erc20Contracts = [];
      for (const token of tokenDeployment.erc20) {
        erc20Contracts.push(
          await deployContract(
            customERC20Artifact,
            [token.name || '', token.symbol || '', token.decimals],
            deployerSigner,
          ),
        );
      }

      const erc721Contracts = [];
      for (const token of tokenDeployment.erc721) {
        erc721Contracts.push(
          await deployContract(
            customERC721Artifact,
            [token.name || '', token.symbol || ''],
            deployerSigner,
          ),
        );
      }

      const erc1155Contracts: any[] = [];
      for (const token of tokenDeployment.erc1155) {
        erc1155Contracts.push(await deployContract(customERC1155Artifact, [], deployerSigner));
      }

      return { erc20Contracts, erc721Contracts, erc1155Contracts };
    };

    const deployExploitedProtocol = async (
      deployerSigner: ethers.providers.JsonRpcSigner,
      testTokensConfig: TestTokensConfig,
      deployedContracts: {
        erc20Contracts: ethers.Contract[];
        erc721Contracts: ethers.Contract[];
        erc1155Contracts: ethers.Contract[];
      },
    ) => {
      const exploitedProtocolArtifact = await compile('ExploitedProtocol.sol');
      return await deployContract(
        exploitedProtocolArtifact,
        [
          deployedContracts.erc20Contracts.map((c) => c.address),
          testTokensConfig.erc20.map((t) =>
            new BigNumber(t.transferredValue)
              .multipliedBy(new BigNumber(10).pow(t.decimals))
              .toString(),
          ),
          deployedContracts.erc721Contracts.map((c) => c.address),
          testTokensConfig.erc721.map((t) => t.transferredTokens),
          deployedContracts.erc1155Contracts.map((c) => c.address),
          testTokensConfig.erc1155.map((t) => t.transferredValues),
        ],
        deployerSigner,
        testTokensConfig.native.transferredValue,
      );
    };

    const deployExploit = async (
      attackerSigner: ethers.providers.JsonRpcSigner,
      variant: ExploitVaraint,
      protocolAddress: string,
    ) => {
      const exploitArtifact = await compile(variant);
      return await deployContract(
        exploitArtifact,
        [protocolAddress, await attackerSigner.getAddress()],
        attackerSigner,
      );
    };

    const testExploit = async (
      exploitVariant: ExploitVaraint,
      thresholdMultiplier = 1,
      attackerAddress: string,
      protocolOwnerAddress: string,
    ) => {
      attackerAddress = attackerAddress.toLowerCase();
      protocolOwnerAddress = protocolOwnerAddress.toLowerCase();
      const protocolOwnerSigner = web3Provider.getSigner(protocolOwnerAddress);
      const attackerSigner = web3Provider.getSigner(attackerAddress);

      const testTokensConfig: TestTokensConfig = {
        native: { transferredValue: 10 },
        erc20: [
          { name: 'TKN20-1', decimals: 16, transferredValue: 100 },
          { symbol: 'TKN20-2', decimals: 10, transferredValue: 200 },
        ],
        erc721: [
          { symbol: 'TKN721-1', transferredTokens: 10 },
          { name: 'TKN721-2', transferredTokens: 20 },
        ],
        erc1155: [
          { name: 'TKN1155-1', transferredValues: [25, 25, 50] },
          { name: 'TKN1155-2', transferredValues: [50, 50] },
        ],
      };

      const deployedContracts = await deployTokens(protocolOwnerSigner, testTokensConfig);
      const { erc20Contracts, erc721Contracts, erc1155Contracts } = deployedContracts;

      data.tokensConfig['native'].threshold =
        testTokensConfig.native.transferredValue * thresholdMultiplier;

      erc20Contracts.forEach((contract, i) => {
        data.tokensConfig[contract.address.toLowerCase()] = {
          decimals: testTokensConfig.erc20[i].decimals,
          threshold: testTokensConfig.erc20[i].transferredValue * thresholdMultiplier,
        };
      });
      erc721Contracts.forEach((contract, i) => {
        data.tokensConfig[contract.address.toLowerCase()] = {
          threshold: testTokensConfig.erc721[i].transferredTokens * thresholdMultiplier,
        };
      });
      erc1155Contracts.forEach((contract, i) => {
        data.tokensConfig[contract.address.toLowerCase()] = {
          name: testTokensConfig.erc1155[i].name,
          threshold:
            testTokensConfig.erc1155[i].transferredValues.reduce((a, b) => a + b, 0) *
            thresholdMultiplier,
        };
      });

      const exploitedProtocolContract = await deployExploitedProtocol(
        protocolOwnerSigner,
        testTokensConfig,
        deployedContracts,
      );

      const exploitContract = await deployExploit(
        attackerSigner,
        exploitVariant,
        exploitedProtocolContract.address,
      );

      const createdContract: CreatedContract = {
        blockNumber: exploitContract.deployTransaction.blockNumber!,
        address: exploitContract.address.toLowerCase(),
        deployer: attackerAddress,
      };

      await handleContract(createdContract);

      if (thresholdMultiplier >= 1) {
        expect(data.findings).toStrictEqual([]);
        return;
      }

      const finding = data.findings[0];

      expect(data.findings).toHaveLength(1);
      expect(finding.metadata.sighash).toStrictEqual(
        exploitContract.interface.getSighash('attack'),
      );
      if (exploitVariant === ExploitVaraint.ExploitNoParams) {
        expect(finding.metadata.calldata).toStrictEqual('');
      } else if (exploitVariant === ExploitVaraint.ExploitMultipleParams) {
        expect(finding.metadata.calldata).toHaveLength(
          32 /* bytes */ * 2 /* symbols per byte */ * 5 /* params */,
        );
      }
      expect(finding.metadata.contractAddress).toStrictEqual(createdContract.address);
      expect(finding.metadata.deployerAddress).toStrictEqual(createdContract.deployer);
      expect(finding.addresses).toEqual(
        expect.arrayContaining([
          ...new Set([
            attackerAddress,
            exploitContract.address.toLowerCase(),
            exploitedProtocolContract.address.toLowerCase(),
            ...erc20Contracts.map((c) => c.address.toLowerCase()),
            ...erc721Contracts.map((c) => c.address.toLowerCase()),
            ...erc1155Contracts.map((c) => c.address.toLowerCase()),
          ]),
        ]),
      );

      const attackerBalanceChanges: any[] = [
        {
          address: 'native',
          value: new BigNumber(testTokensConfig.native.transferredValue)
            .multipliedBy(new BigNumber(10).pow(data.tokensConfig.native.decimals!))
            .toString(),
          decimals: data.tokensConfig.native.decimals,
          name: data.tokensConfig.native.name,
          type: TokenInterface.NATIVE,
        },
      ];
      for (let i = 0; i < testTokensConfig.erc20.length; i++) {
        attackerBalanceChanges.push({
          address: erc20Contracts[i].address.toLowerCase(),
          type: TokenInterface.ERC20,
          name: testTokensConfig.erc20[i].symbol || testTokensConfig.erc20[i].name,
          decimals: testTokensConfig.erc20[i].decimals,
          value: new BigNumber(testTokensConfig.erc20[i].transferredValue)
            .multipliedBy(new BigNumber(10).pow(testTokensConfig.erc20[i].decimals))
            .toString(),
        });
      }
      for (let i = 0; i < testTokensConfig.erc721.length; i++) {
        attackerBalanceChanges.push({
          address: erc721Contracts[i].address.toLowerCase(),
          type: TokenInterface.ERC721,
          name: testTokensConfig.erc721[i].symbol || testTokensConfig.erc721[i].name,
          value: testTokensConfig.erc721[i].transferredTokens.toString(),
        });
      }
      for (let i = 0; i < testTokensConfig.erc1155.length; i++) {
        attackerBalanceChanges.push({
          address: erc1155Contracts[i].address.toLowerCase(),
          type: TokenInterface.ERC1155,
          name: testTokensConfig.erc1155[i].symbol || testTokensConfig.erc1155[i].name,
          value: testTokensConfig.erc1155[i].transferredValues
            .reduce((a, b) => a + b, 0)
            .toString(),
        });
      }
      expect(JSON.parse(finding.metadata.balanceChanges)[attackerAddress]).toEqual(
        expect.arrayContaining(attackerBalanceChanges),
      );
    };

    it("should push nothing if contract doesn't transfer tokens", async () => {
      const deployerSigner = web3Provider.getSigner(accounts[0]);
      const regularArtifact = await compile('RegularContract.sol');
      const regularContract = await deployContract(regularArtifact, [], deployerSigner);

      const createdContract: CreatedContract = {
        address: await regularContract.resolvedAddress,
        deployer: await deployerSigner.getAddress(),
        blockNumber: regularContract.deployTransaction.blockNumber!,
      };

      await handleContract(createdContract);

      expect(data.findings).toStrictEqual([]);
    });

    it('should push nothing if attack function transfers tokens less than threshold', async () => {
      await testExploit(
        ExploitVaraint.ExploitNoParams,
        1.0001,
        accounts[0],
        accounts[1],
      );
    });

    it('should push a finding if attack function has no parameters', async () => {
      await testExploit(
        ExploitVaraint.ExploitNoParams,
        0.999,
        accounts[0],
        accounts[1],
      );
    });

    it('should push a finding if attack function has multiple parameters', async () => {
      await testExploit(
        ExploitVaraint.ExploitMultipleParams,
        0.999,
        accounts[0],
        accounts[1]
      );
    });
  });

  describe('handleTransaction', () => {
    let mockTxEvent: TestTransactionEvent;
    let handleTransaction: HandleTransaction;
    let data: DataContainer;

    const chainId = 1;
    const mockHandleContract = jest.fn();

    beforeAll(() => {
      mockEthersProvider.mockReturnValue({
        getNetwork: () => ({
          chainId: chainId,
        }),
      });
    });

    beforeEach(async () => {
      data = {} as any;
      mockTxEvent = new TestTransactionEvent();
      handleTransaction = provideHandleTransaction(data);
      await provideInitialize(
        data,
        { chains: { [chainId]: {} }, developerAbbreviation: '' },
        mockHandleContract,
      )();
      mockHandleContract.mockReset();
    });

    afterAll(() => {
      mockEthersProvider.mockReset();
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
      data.findings.push(...expectedFindings);
      findings = await handleTransaction(mockTxEvent);
      expect(findings).toStrictEqual(expectedFindings);
      expect(data.findings).toStrictEqual([]);
    });
  });
});
