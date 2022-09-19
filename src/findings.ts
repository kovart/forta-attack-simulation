import { Finding, FindingSeverity, FindingType } from 'forta-agent';
import BigNumber from 'bignumber.js';
import { TokenInfo } from './types';

export const createExploitFunctionFinding = (
  sighash: string,
  calldata: string,
  contractAddress: string,
  deployerAddress: string,
  balanceChanges: { [account: string]: TokenInfo[] },
  addresses: string[],
  developerAbbreviation: string,
) => {
  contractAddress = contractAddress.toLowerCase();
  deployerAddress = deployerAddress.toLowerCase();
  addresses = addresses.map((a) => a.toLowerCase());

  const formatTokens = (tokens: TokenInfo[]) => {
    return tokens
      .map((token) => {
        const denominator = new BigNumber(10).pow(token.decimals || 0);
        return `${token.value.div(denominator).toFormat()} ${token.name}`;
      })
      .join(', ');
  };

  return Finding.from({
    alertId: `${developerAbbreviation}-ATTACK-SIMULATION-0`,
    name: 'Potential Exploit Function',
    description:
      `Invocation of the function ${sighash} of the created contract ${contractAddress} ` +
      `leads to large balance increase in the contract deployer or function invoker account. ` +
      `Tokens transferred: ${formatTokens(balanceChanges[deployerAddress])}`,
    type: FindingType.Exploit,
    severity: FindingSeverity.Critical,
    addresses: addresses,
    metadata: {
      sighash,
      calldata,
      contractAddress,
      deployerAddress,
      balanceChanges: JSON.stringify(balanceChanges),
    },
  });
};
