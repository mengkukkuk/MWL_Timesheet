"""Outbound email — Brevo HTTPS API preferred, SMTP STARTTLS fallback.

Transport selection (see app/__init__.py config):
  * BREVO_API_KEY set   -> POST https://api.brevo.com/v3/smtp/email
  * otherwise           -> smtplib against SMTP_HOST:SMTP_PORT (Brevo relay)

Stdlib only — no new dependencies. Callers catch MailError; its message never
contains message bodies or tokens, only transport status.
"""
import html
import json
import smtplib
import ssl
import urllib.error
import urllib.request

from email.message import EmailMessage
from email.utils import parseaddr

from flask import current_app

BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email'
SEND_TIMEOUT = 10  # seconds, both transports


class MailError(Exception):
    """Raised when an email could not be handed off to the provider."""


def _sender():
    """Split MAIL_FROM ('"Name" <addr>' or bare addr) into (name, addr)."""
    name, addr = parseaddr(current_app.config.get('MAIL_FROM', ''))
    if not addr:
        raise MailError('MAIL_FROM / SMTP_FROM is not configured')
    return name, addr


def send_email(to_addr, subject, html_body, text_body):
    """Send one email. Raises MailError on any transport failure."""
    if current_app.config.get('BREVO_API_KEY'):
        _send_via_brevo_api(to_addr, subject, html_body, text_body)
    else:
        _send_via_smtp(to_addr, subject, html_body, text_body)


def _send_via_brevo_api(to_addr, subject, html_body, text_body):
    name, addr = _sender()
    sender = {'email': addr}
    if name:
        sender['name'] = name
    payload = {
        'sender': sender,
        'to': [{'email': to_addr}],
        'subject': subject,
        'htmlContent': html_body,
        'textContent': text_body,
    }
    req = urllib.request.Request(
        BREVO_API_URL,
        data=json.dumps(payload).encode('utf-8'),
        headers={
            'api-key': current_app.config['BREVO_API_KEY'],
            'content-type': 'application/json',
            'accept': 'application/json',
        },
        method='POST',
    )
    try:
        with urllib.request.urlopen(req, timeout=SEND_TIMEOUT) as resp:
            if resp.status not in (200, 201, 202):
                raise MailError(f'Brevo API returned HTTP {resp.status}')
    except urllib.error.HTTPError as exc:
        raise MailError(f'Brevo API returned HTTP {exc.code}') from exc
    except urllib.error.URLError as exc:
        raise MailError(f'Brevo API unreachable: {exc.reason}') from exc


def _send_via_smtp(to_addr, subject, html_body, text_body):
    cfg = current_app.config
    host = cfg.get('SMTP_HOST', '')
    if not host:
        raise MailError('No mail transport configured (BREVO_API_KEY and SMTP_HOST both empty)')
    name, addr = _sender()

    msg = EmailMessage()
    msg['Subject'] = subject
    msg['From'] = f'{name} <{addr}>' if name else addr
    msg['To'] = to_addr
    msg.set_content(text_body)
    msg.add_alternative(html_body, subtype='html')

    port = cfg.get('SMTP_PORT', 587)
    security = cfg.get('SMTP_SECURITY', 'starttls')
    username = cfg.get('SMTP_USERNAME', '')
    password = cfg.get('SMTP_PASSWORD', '')
    try:
        if security == 'ssl':
            server = smtplib.SMTP_SSL(host, port, timeout=SEND_TIMEOUT,
                                      context=ssl.create_default_context())
        else:
            server = smtplib.SMTP(host, port, timeout=SEND_TIMEOUT)
        with server:
            if security in ('starttls', ''):
                server.starttls(context=ssl.create_default_context())
            if username and password:
                server.login(username, password)
            server.send_message(msg)
    except (smtplib.SMTPException, OSError) as exc:
        raise MailError(f'SMTP send failed: {exc.__class__.__name__}') from exc


def build_reset_email(username, reset_url, ttl_minutes):
    """Compose the bilingual password-reset email. Returns (subject, html, text)."""
    subject = 'MeterWorklog — Password Reset / รีเซ็ตรหัสผ่าน'
    safe_username = html.escape(username)
    text = (
        f'Someone requested a password reset for the account "{username}".\n'
        f'Open this link to set a new password (expires in {ttl_minutes} minutes):\n\n'
        f'{reset_url}\n\n'
        'If you did not request this, you can safely ignore this email.\n\n'
        f'มีการขอรีเซ็ตรหัสผ่านสำหรับบัญชี "{username}"\n'
        f'เปิดลิงก์นี้เพื่อตั้งรหัสผ่านใหม่ (หมดอายุใน {ttl_minutes} นาที):\n'
        f'{reset_url}\n'
        'หากคุณไม่ได้เป็นผู้ขอ สามารถละเว้นอีเมลนี้ได้'
    )
    html_body = f"""\
<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#1f2937">
  <h2 style="color:#4f46e5">MeterWorklog</h2>
  <p>Someone requested a password reset for the account <strong>{safe_username}</strong>.</p>
  <p>Click the button below to set a new password.
     The link expires in <strong>{ttl_minutes} minutes</strong>.</p>
  <p style="margin:24px 0">
    <a href="{reset_url}"
       style="background:#4f46e5;color:#ffffff;padding:10px 24px;border-radius:8px;
              text-decoration:none;display:inline-block">Reset Password</a>
  </p>
  <p style="font-size:12px;color:#6b7280">If the button does not work, copy this link:<br>
     <a href="{reset_url}">{reset_url}</a></p>
  <p style="font-size:12px;color:#6b7280">If you did not request this, you can safely ignore this email.</p>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0">
  <p style="font-size:13px">มีการขอรีเซ็ตรหัสผ่านสำหรับบัญชี <strong>{safe_username}</strong>
     กดปุ่มด้านบนเพื่อตั้งรหัสผ่านใหม่ (ลิงก์หมดอายุใน {ttl_minutes} นาที)
     หากคุณไม่ได้เป็นผู้ขอ สามารถละเว้นอีเมลนี้ได้</p>
</div>
"""
    return subject, html_body, text
