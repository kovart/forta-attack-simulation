import { Finding, FindingSeverity, FindingType } from 'forta-agent';

const botConfig = require('../bot-config.json');

export const createFinding = () => {
  return Finding.from({
    alertId: `${botConfig.developerAbbreviation}-ALERT-0`,
    name: 'Forta Alert',
    description: 'Alert description',
    type: FindingType.Unknown,
    severity: FindingSeverity.Unknown,
    addresses: [],
    metadata: {},
  });
};
