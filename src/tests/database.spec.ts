import { SqlDatabase } from '../database';
import { CreatedContract } from '../types';

describe('sql database', () => {
  let database: SqlDatabase;

  const contract: CreatedContract = {
    address: '0x77300C71071eCa35Cb673a0b7571B2907dEB7701',
    deployer: '0x77300C71071eCa35Cb673a0b7571B2907dEB7702',
    txHash: '0xc9ce00a6c9849da2084cba17f3fbaf49d0462779901fe8ea4c44889f00f4799e',
    timestamp: 123,
    blockNumber: 1234,
  };

  beforeEach(() => {
    database = new SqlDatabase(':memory:');
  });

  it('should initialize properly', async () => {
    await database.initialize();
  });

  it('should return empty array if there are no data', async () => {
    await database.initialize();

    const result = await database.getContracts();

    expect(result).toHaveLength(0);
  });

  it('should add contract', async () => {
    await database.initialize();

    await database.addContract(contract, 1);

    const result = await database.getContracts();

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject(contract);
  });

  it('should update contract', async () => {
    await database.initialize();
    await database.addContract(contract, 5);
    await database.updatePriority(contract.address, 7);

    const result = await database.getContracts();

    expect(result[0]).toMatchObject({ ...contract, priority: 7 });
  });

  it('should delete contract', async () => {
    await database.initialize();
    await database.addContract(contract, 1);

    expect(await database.getContracts()).toHaveLength(1)

    await database.deleteContract(contract.address);

    expect(await database.getContracts()).toHaveLength(0)

  });

  it('should clear contracts', async () => {
    await database.initialize();
    await database.addContract(contract, 1);

    expect(await database.getContracts()).toHaveLength(1)

    await database.clear();

    expect(await database.getContracts()).toHaveLength(0)
  });
});
