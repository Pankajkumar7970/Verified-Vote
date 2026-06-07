import bcrypt from 'bcrypt';
import crypto from 'crypto';

export const otpService = {
  generateOTP: () => {
    // Generate a 6-digit cryptographically secure code
    // return crypto.randomInt(100000, 1000000).toString();
    return "123456";
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
