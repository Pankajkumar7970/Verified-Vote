import axios from 'axios';
import { logger } from '../../utils/logger.js';

export class TextBeeAdapter {
  async send(phone: string, message: string): Promise<void> {
    const apiKey = process.env.TEXTBEE_API_KEY;
    const deviceId = process.env.TEXTBEE_DEVICE_ID;

    // Graceful fallback when keys are missing (dev / test mode)
    if (!apiKey || !deviceId) {
      logger.warn('TEXTBEE credentials not set – SMS mocked to console');
      console.log(`[MOCK SMS] To ${phone}: ${message}`);
      return;
    }

    try {
      const response = await axios.post(
        `https://api.textbee.dev/api/v1/gateway/devices/${deviceId}/sendSMS`,
        {
          receivers: [phone],
          smsBody: message,
        },
        {
          headers: {
            'x-api-key': apiKey,
            'Content-Type': 'application/json',
          },
          timeout: 10000,
        }
      );

      // Optional: handle success/failure flags from TextBee response
      if (response.data?.status !== 'accepted') {
        logger.error({
          action: 'textbee_sms_rejected',
          status: response.data?.status
        });
      }
    } catch (err: any) {
      logger.error({
        action: 'textbee_sms_failed',
        error: err.message
      });
      throw err;
    }
  }
}

export const SMSService = new TextBeeAdapter();
