import path from 'path';
import fs from 'fs';
import { utils } from 'ethers';
// @ts-ignore
import solc from 'solc';

const IS_CACHE_ENABLED = false;

export type CompilerArtifact = { abi: any; evm: { bytecode: { object: any } } };

const fileExists = (filePath: string) => {
  try {
    if (fs.existsSync(filePath)) {
      return true;
    }
  } catch (err) {
    return false;
  }
};

function findImport(filePath: string) {
  try {
    let fullPath: string;

    const shouldUseNodeModules = filePath.indexOf('@') === 0;
    if (shouldUseNodeModules) {
      fullPath = path.resolve(__dirname, '../../../node_modules/', filePath);
    } else {
      fullPath = path.resolve(__dirname, '../contracts/', filePath);
    }

    const fileContent = fs.readFileSync(fullPath, { encoding: 'utf-8' });

    return {
      contents: fileContent,
    };
  } catch (e: any) {
    return { error: e?.message || e };
  }
}

export const compile = (filename: string): CompilerArtifact => {
  const fileFullPath = path.join(__dirname, '../contracts', filename);
  const fileContent = fs.readFileSync(fileFullPath, { encoding: 'utf8' });
  const fileHash = utils.id(fileContent).slice(2, 10);

  const { name, ext } = path.parse(fileFullPath);
  const cacheFileName = name + '_' + fileHash + ext;
  const cacheDir = path.resolve(__dirname, '../contracts/compiled/');
  const cacheFullPath = path.resolve(cacheDir, cacheFileName);

  let result: string;

  if (IS_CACHE_ENABLED && fileExists(cacheFullPath)) {
    result = fs.readFileSync(cacheFullPath, { encoding: 'utf-8' });
  } else {
    const input = {
      sources: {
        [fileFullPath]: {
          content: fileContent,
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

    result = solc.compile(JSON.stringify(input), { import: findImport });

    if (IS_CACHE_ENABLED) {
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      fs.mkdir(cacheDir, { recursive: true }, () => {});
      fs.writeFileSync(cacheFullPath, result, { encoding: 'utf-8' });
    }
  }

  const output = JSON.parse(result);
  if (!output.contracts) {
    throw output.errors;
  }

  const artifact = output.contracts[fileFullPath];
  const key = Object.keys(artifact)[0];
  return artifact[key];
};
