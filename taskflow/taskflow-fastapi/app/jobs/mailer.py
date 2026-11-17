from email.message import EmailMessage

import aiosmtplib

from app.config import Settings


class Mailer:
    def __init__(self, settings: Settings) -> None:
        self.host = settings.smtp_host
        self.port = settings.smtp_port
        self.sender = settings.mail_from

    async def send(self, *, to: str, subject: str, text: str) -> None:
        message = EmailMessage()
        message["From"] = self.sender
        message["To"] = to
        message["Subject"] = subject
        message.set_content(text)
        # Mailpit speaks plain SMTP; a real provider would add start_tls and credentials.
        await aiosmtplib.send(message, hostname=self.host, port=self.port, start_tls=False)
