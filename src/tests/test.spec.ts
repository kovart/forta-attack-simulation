import Ganache, { EthereumProvider } from 'ganache';
import { ethers } from 'ethers';
import { compile } from './utils/compiler';

enum ContractFile {
  SimpleStorage = 'SimpleStorage.sol',
}

describe('test ganache', () => {
  jest.setTimeout(20 * 1000);

  let provider: EthereumProvider;

  const deployContract = async (fileName: ContractFile) => {
    const SimpleStorage = await compile(fileName);

    provider = Ganache.provider();
    const web3Provider = new ethers.providers.Web3Provider(provider as any);
    const accounts = await web3Provider.listAccounts();
    const signer = web3Provider.getSigner(accounts[0]);

    const factory = new ethers.ContractFactory(
      SimpleStorage.abi,
      SimpleStorage.evm.bytecode.object,
      signer,
    );

    const contract = await factory.deploy();
    await contract.deployed();

    return contract;
  };

  afterEach(() => {
    provider.disconnect();
  });

  it('should test contract', async () => {
    // get old value
    const contract = await deployContract(ContractFile.SimpleStorage);
    const oldVal = await contract.get();

    // set new value
    await contract.set(5);

    // get new value
    const newVal = await contract.get();

    // assert our expectations
    expect(oldVal.toString()).toBe('0');
    expect(newVal.toString()).toBe('5');
  });
});
