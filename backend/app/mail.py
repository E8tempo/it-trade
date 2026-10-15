"""Outgoing mail over SMTP (settings: SMTP_*, MAIL_FROM). Without SMTP_HOST a letter is written to the log
instead, so development needs no mail server: the code is in the API's output."""

import asyncio
import logging
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formataddr, make_msgid

from app.config import get_settings

log = logging.getLogger(__name__)


class MailError(Exception):
    """The letter was not accepted by the SMTP server."""


async def send_mail(to: str, subject: str, text: str, html: str | None = None) -> None:
    s = get_settings()
    if not s.smtp_host:
        log.warning("mail (SMTP_HOST is not set, not sent) to %s: %s\n%s", to, subject, text)
        return
    sender = s.mail_from or s.smtp_user
    msg = EmailMessage()
    msg["From"] = sender if "<" in sender else formataddr(("IT Trade", sender))
    msg["To"] = to
    msg["Subject"] = subject
    msg["Message-ID"] = make_msgid(domain=sender.rsplit("@", 1)[-1].strip("> "))
    msg.set_content(text)
    if html:
        msg.add_alternative(html, subtype="html")
    try:
        await asyncio.to_thread(_send, msg)
    except (smtplib.SMTPException, OSError) as e:
        log.error("mail to %s failed: %s", to, e)
        raise MailError(str(e)) from e


def _send(msg: EmailMessage) -> None:
    s = get_settings()
    context = ssl.create_default_context()
    password = s.smtp_password.get_secret_value()
    if s.smtp_port == 465:
        with smtplib.SMTP_SSL(s.smtp_host, s.smtp_port, context=context, timeout=20) as smtp:
            if s.smtp_user:
                smtp.login(s.smtp_user, password)
            smtp.send_message(msg)
    else:
        with smtplib.SMTP(s.smtp_host, s.smtp_port, timeout=20) as smtp:
            smtp.starttls(context=context)
            if s.smtp_user:
                smtp.login(s.smtp_user, password)
            smtp.send_message(msg)
