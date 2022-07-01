import path from 'path';
import fs from 'fs';
// @ts-ignore
import solc from 'solc';

export const compile = (filename: string): any => {
  const sourcePath = path.join(__dirname, '../contracts', filename);

  const input = {
    sources: {
      [sourcePath]: {
        content: fs.readFileSync(sourcePath, { encoding: 'utf8' }),
      },
    },
    language: 'Solidity',
    settings: {
      outputSelection: {
        '*': {
          '*': ['*'],
        },
      },
    },
  };

  const output = JSON.parse(solc.compile(JSON.stringify(input)));

  const artifact = output.contracts[sourcePath];
  const key = Object.keys(artifact)[0];
  return artifact[key];
};
