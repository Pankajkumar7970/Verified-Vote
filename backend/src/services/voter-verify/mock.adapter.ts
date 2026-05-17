import fs from 'fs';
import path from 'path';

interface VoterData {
  voter_id: string;
  name: string;
  phone: string;
  constituency: string;
  state: string;
}

export class MockAdapter {
  private voters: Map<string, VoterData> = new Map();

  constructor() {
    try {
      const data = fs.readFileSync(path.join(process.cwd(), 'backend/src/db/seed/voter_roll.json'), 'utf8');
      const parsed = JSON.parse(data);
      parsed.voters.forEach((v: VoterData) => {
        this.voters.set(v.voter_id.toUpperCase(), v);
      });
    } catch (e) {
      console.warn('Could not load mock voter_roll.json', e);
    }
  }

  async verifyVoter(voterId: string): Promise<VoterData | null> {
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 500));
    return this.voters.get(voterId.toUpperCase()) || null;
  }
}

export const VoterVerificationService = new MockAdapter();
