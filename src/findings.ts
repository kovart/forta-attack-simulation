import { Finding, FindingSeverity, FindingType } from 'forta-agent';
import BigNumber from 'bignumber.js';
import { TokenInfo } from './types';

export const createExploitFunctionFinding = (
  sighash: string,
  calldata: string,
  fundedAddress: string,
  contractAddress: string,
  deployerAddress: string,
  balanceChanges: { [account: string]: TokenInfo[] },
  addresses: string[],
  developerAbbreviation: string,
) => {
  // normalize addresses
  fundedAddress = fundedAddress.toLowerCase();
  contractAddress = contractAddress.toLowerCase();
  deployerAddress = deployerAddress.toLowerCase();
  addresses = addresses.map((a) => a.toLowerCase());

  // we assume that deployer and transaction sender had the same address
  const attackerName =
    deployerAddress === fundedAddress ? 'contract deployer or function invoker' : fundedAddress;

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
      `leads to large balance increase in the ${attackerName} account. ` +
      `Tokens Received: ${formatTokens(balanceChanges[fundedAddress])}`,
    type: FindingType.Exploit,
    severity: FindingSeverity.Critical,
    addresses: addresses,
    metadata: {
      sighash,
      calldata,
      contractAddress,
      deployerAddress,
      fundedAddress,
      balanceChanges: JSON.stringify(balanceChanges),
    },
  });
};
