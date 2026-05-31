interface VoterData {
  voter_id: string;
  name: string;
  phone: string;
  constituency: string;
  state: string;
}

export class ProteanAdapter {
  async verifyVoter(voterId: string): Promise<VoterData | null> {
    const apiUrl = process.env.PROTEAN_API_URL;
    const apiKey = process.env.PROTEAN_API_KEY;
    if (!apiUrl || !apiKey) {
      throw new Error('protean_not_configured');
    }
    // Production integration point — returns same shape as MockAdapter.
    throw new Error('protean_adapter_not_implemented');
  }
}
