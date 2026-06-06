import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
    // Try multiple candidate paths so this works in all environments:
    //   - Docker/production bundle: __dirname = backend/dist/ → ../../db/seed/ = project-root/db/seed/
    //   - Local npm start (bundle): __dirname = backend/dist/ → ../src/db/seed/ = backend/src/db/seed/
    //   - Dev (tsx): __dirname = backend/src/services/voter-verify/ → ../../db/seed/ = backend/src/db/seed/
    const candidates = [
      path.join(__dirname, '../../db/seed/voter_roll.json'),
      path.join(__dirname, '../src/db/seed/voter_roll.json'),
    ];
    for (const rollPath of candidates) {
      try {
        const data = fs.readFileSync(rollPath, 'utf8');
        const parsed = JSON.parse(data);
        parsed.voters.forEach((v: VoterData) => {
          this.voters.set(v.voter_id.toUpperCase(), v);
        });
        return; // loaded successfully
      } catch {
        // try next candidate
      }
    }
    console.warn('Could not load mock voter_roll.json — tried:', candidates);
  }

  async verifyVoter(voterId: string): Promise<VoterData | null> {
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 500));
    return this.voters.get(voterId.toUpperCase()) || null;
  }
}
