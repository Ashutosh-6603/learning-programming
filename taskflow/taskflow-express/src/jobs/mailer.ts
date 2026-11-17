import nodemailer, { type Transporter } from 'nodemailer';
import type { Config } from '../config.js';

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

export class Mailer {
  private readonly transport: Transporter;

  constructor(private readonly config: Pick<Config, 'SMTP_HOST' | 'SMTP_PORT' | 'MAIL_FROM'>) {
    this.transport = nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: false,
    });
  }

  async send(mail: Mail): Promise<void> {
    await this.transport.sendMail({ from: this.config.MAIL_FROM, ...mail });
  }

  close(): void {
    this.transport.close();
  }
}
