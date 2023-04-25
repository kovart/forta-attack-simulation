/* eslint-disable no-console */
import sqlite3 from 'sqlite3';

import { CreatedContract } from './types';

type QueuedContract = CreatedContract & {
  priority: number;
};

export interface IDatabase {
  initialize: () => Promise<void>;
  addContract: (contract: CreatedContract, priority: number) => Promise<void>;
  deleteContract: (address: string) => Promise<void>;
  updatePriority: (address: string, priority: number) => Promise<void>;
  getContracts: () => Promise<QueuedContract[]>;
  clear: () => Promise<void>;
  close: (cb: ((err: Error | null) => void) | undefined) => void;
}

export class SqlDatabase implements IDatabase {
  private db: sqlite3.Database;

  private addStatement!: sqlite3.Statement;
  private updateStatement!: sqlite3.Statement;
  private deleteStatement!: sqlite3.Statement;

  constructor(filename = ':memory:') {
    this.db = new sqlite3.Database(filename, (err) => {
      if (err) return console.error(err.message);
      console.info('Connected to the SQlite database.');
    });

    this.db.on('error', (err) => console.error(err));

    // force execution to be serialized
    this.db.serialize();
  }

  async initialize(): Promise<void> {
    this.db.run(`CREATE TABLE IF NOT EXISTS contracts (
        contract_id INTEGER PRIMARY KEY AUTOINCREMENT,
        address CHARACTER(42) NOT NULL,
        deployer CHARACTER(42) NOT NULL,
        blockNumber INTEGER,
        timestamp INTEGER,
        txHash CHARACTER(66),
        priority INTEGER
    )`);

    this.db.run(`CREATE INDEX IF NOT EXISTS address_idx ON contracts(address)`);

    this.addStatement = this.db.prepare(
      'INSERT INTO contracts (address, deployer, blockNumber, timestamp, txHash, priority) VALUES (?, ?, ?, ?, ?, ?)',
    );

    this.updateStatement = this.db.prepare(
      'UPDATE contracts SET priority = ? WHERE address = ?',
    );

    this.deleteStatement = this.db.prepare(`DELETE FROM contracts WHERE contracts.address = ?`);
  }

  async addContract(contract: CreatedContract, priority: number) {
    this.addStatement.run(
      contract.address,
      contract.deployer,
      contract.blockNumber,
      contract.timestamp,
      contract.txHash,
      priority,
    );
  }

  async deleteContract(address: string) {
    this.deleteStatement.run(address);
  }

  async updatePriority(address: string, priority: number) {
    this.updateStatement.run(priority, address);
  }

  async getContracts() {
    return (await this.all<QueuedContract[]>(`SELECT * FROM contracts`)) || [];
  }

  async clear() {
    this.db.run(`DELETE FROM contracts`);
  }

  close(cb: ((err: Error | null) => void) | undefined) {
    this.db.close(cb);
  }

  private promisify<P extends never>(
    fn: (handler: (result: P, err: any) => void) => void,
  ): Promise<P> {
    return new Promise((res, rej) => {
      fn((result: P, err: any) => {
        if (err) return rej(err);
        return res(result);
      });
    });
  }

  private async run(query: string, ...params: any[]): Promise<void> {
    return new Promise((res, rej) => {
      this.db.run(query, ...params, (err: Error) => {
        if (err) return rej(err);
        return res();
      });
    });
  }

  private async get<P>(query: string, params: object = {}): Promise<P> {
    return new Promise((res, rej) => {
      this.db.get(query, params, (err: Error, result: P) => {
        if (err) return rej(err);
        return res(result);
      });
    });
  }

  private async all<P>(query: string, params: object = {}): Promise<P> {
    return new Promise((res, rej) => {
      this.db.all(query, params, (err: Error, result: P) => {
        if (err) return rej(err);
        return res(result);
      });
    });
  }
}

export class InMemoryDatabase implements IDatabase {
  private contractSet = new Set<QueuedContract>();

  async initialize() {
    // do nothing
  }

  close() {
    // do nothing
  }

  async addContract(contract: CreatedContract, priority: number) {
    this.contractSet.add({ ...contract, priority });
  }

  async updatePriority(address: string, priority: number) {
    for (const contract of this.contractSet) {
      if (contract.address === address) {
        contract.priority = priority;
        break;
      }
    }
  }

  async deleteContract(address: string) {
    for (const contract of this.contractSet) {
      if (contract.address === address) {
        this.contractSet.delete(contract);
        break;
      }
    }
  }

  async getContracts() {
    return [...this.contractSet];
  }

  async clear() {
    this.contractSet.clear();
  }
}
