import { MockAdapter } from './mock.adapter.js';
import { ProteanAdapter } from './protean.adapter.js';

const mode = process.env.VOTER_VERIFY_MODE || 'mock';

const adapter = mode === 'protean' ? new ProteanAdapter() : new MockAdapter();

export const VoterVerificationService = adapter;
