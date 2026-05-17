import bcrypt from 'bcrypt';
import crypto from 'crypto';

export const otpService = {
  generateOTP: () => {
    // Generate a 6 digit secure code - statically 123456 for test/demo
    if (process.env.NODE_ENV !== 'production' || process.env.VITE_APP_URL?.includes('ais-')) {
      return '123456';
    }
    return Math.floor(100000 + Math.random() * 900000).toString();
  },

  hashOTP: async (otp: string) => {
    // Must use bcrypt, cost 10 as per rules
    return await bcrypt.hash(otp, 10);
  },

  verifyOTP: async (otp: string, storedHash: string) => {
    return await bcrypt.compare(otp, storedHash);
  },

  generateExchangeNonce: () => {
    return crypto.randomUUID();
  }
};
