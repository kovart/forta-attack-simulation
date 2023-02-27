import { EntityType, Finding, FindingSeverity, FindingType, Label } from 'forta-agent';
import BigNumber from 'bignumber.js';

import { TokenInfo } from './types';

// funding deployer
// funding the exploit contract
// funding some EOA
export const createExploitFunctionFinding = (
  sighash: string,
  calldata: string,
  contractAddress: string,
  deployerAddress: string,
  fundedAddress: string,
  balanceChanges: { [account: string]: TokenInfo[] },
  addresses: string[],
  anomalyScore: number,
  txHash: string,
  developerAbbreviation: string,
) => {
  // normalize addresses
  contractAddress = contractAddress.toLowerCase();
  deployerAddress = deployerAddress.toLowerCase();
  fundedAddress = fundedAddress.toLowerCase();
  addresses = addresses.map((a) => a.toLowerCase());

  const formatTokens = (tokens: TokenInfo[]) => {
    return tokens
      .map((token) => {
        const denominator = new BigNumber(10).pow(token.decimals || 0);
        return `${token.value.div(denominator).toFormat()} ${token.name}`;
      })
      .join(', ');
  };

  // generate description
  let description = `Invocation of the function ${sighash} of the created contract ${contractAddress} `;
  if (deployerAddress === fundedAddress) {
    description += `leads to large balance increase in the contract deployer or function invoker account. `;
  } else if (contractAddress === fundedAddress) {
    description += `leads to large balance increase in the deployed contract. `;
  } else {
    description += `leads to large balance increase in account ${fundedAddress}. `;
  }
  description += `Tokens transferred: ${formatTokens(balanceChanges[fundedAddress])}`;

  const labels: Label[] = [
    Label.fromObject({
      entityType: EntityType.Address,
      entity: deployerAddress,
      label: 'Attacker',
      confidence: 0.5,
      remove: false,
    }),
    Label.fromObject({
      entityType: EntityType.Address,
      entity: contractAddress,
      label: 'Exploit',
      confidence: 0.5,
      remove: false,
    }),
    Label.fromObject({
      entityType: EntityType.Transaction,
      entity: txHash,
      label: 'Exploit',
      confidence: 0.5,
      remove: false,
    }),
  ];

  if (fundedAddress !== deployerAddress && fundedAddress !== contractAddress) {
    labels.push(
      Label.fromObject({
        entityType: EntityType.Address,
        entity: fundedAddress,
        label: 'Attacker',
        confidence: 0.5,
        remove: false,
      }),
    );
  }

  return Finding.from({
    alertId: `${developerAbbreviation}-ATTACK-SIMULATION-0`,
    name: 'Potential Exploit Function',
    description: description,
    type: FindingType.Exploit,
    severity: FindingSeverity.Critical,
    addresses: addresses,
    labels: labels,
    metadata: {
      sighash,
      calldata,
      contractAddress,
      fundedAddress,
      deployerAddress,
      txHash: txHash,
      anomaly_score: anomalyScore.toString(),
      balanceChanges: JSON.stringify(balanceChanges),
    },
  });
};
