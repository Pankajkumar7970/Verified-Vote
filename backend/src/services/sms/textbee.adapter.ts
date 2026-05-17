import { db } from '../../db/index';

export class TextBeeAdapter {
  async send(phone: string, message: string): Promise<void> {
    // In dev environment, we just log the SMS
    console.log(`[TextBee Mock SMS] To: ${phone} | message: ${message}`);
    // If we wanted to hit the real TextBee API:
    // await axios.post('https://textbee.dev/api/v1/gateway/devices/.../sendMessage', { phone, message }, { headers: { Authorization: process.env.TEXTBEE_API_KEY }});
  }
}

export const SMSService = new TextBeeAdapter();
