export interface EmailTemplate {
  subject: string;
  html: string;
  text: string;
}

interface EmailLayoutOptions {
  heading: string;
  intro: string;
  actionLabel: string;
  actionUrl: string;
  outro: string;
  footer: string;
}

function renderEmailLayout(options: EmailLayoutOptions): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${options.heading}</title>
</head>
<body style="margin:0;padding:0;background-color:#f8f7f3;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f8f7f3;padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background-color:#ffffff;border-radius:16px;overflow:hidden;">
<tr><td style="background-color:#1c2022;padding:28px 32px;text-align:center;">
<span style="color:#ffffff;font-size:22px;font-weight:800;letter-spacing:0.04em;">zoppex<span style="color:#d8b15d;">.</span></span>
</td></tr>
<tr><td style="padding:36px 32px 8px;">
<h1 style="margin:0 0 14px;font-size:22px;line-height:1.25;color:#1c2022;font-weight:700;">${options.heading}</h1>
<p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#687074;">${options.intro}</p>
</td></tr>
<tr><td style="padding:0 32px;" align="center">
<a href="${options.actionUrl}" style="display:inline-block;background-color:#d8b15d;color:#1c2022;font-size:15px;font-weight:700;text-decoration:none;padding:13px 32px;border-radius:12px;">${options.actionLabel}</a>
</td></tr>
<tr><td style="padding:24px 32px 8px;">
<p style="margin:0;font-size:13px;line-height:1.6;color:#98a19c;word-break:break-all;">Or copy this link into your browser:<br>${options.actionUrl}</p>
</td></tr>
<tr><td style="padding:20px 32px 32px;">
<p style="margin:0;font-size:14px;line-height:1.6;color:#687074;">${options.outro}</p>
</td></tr>
<tr><td style="background-color:#f8f7f3;padding:20px 32px;border-top:1px solid #dfe1de;">
<p style="margin:0;font-size:12px;line-height:1.6;color:#98a19c;text-align:center;">${options.footer}</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

export function renderVerificationEmail(firstName: string, url: string): EmailTemplate {
  return {
    subject: 'Confirm your ZOPPEX account',
    html: renderEmailLayout({
      heading: `Welcome, ${firstName}.`,
      intro:
        'Your ZOPPEX account is almost ready. Confirm your email address to get started with beautifully simple digital queues.',
      actionLabel: 'Confirm email',
      actionUrl: url,
      outro:
        'This link expires in 24 hours. If you did not create a ZOPPEX account, you can safely ignore this email.',
      footer: 'ZOPPEX · Less waiting. More living.',
    }),
    text: `Welcome, ${firstName}.\n\nConfirm your email address to activate your ZOPPEX account:\n${url}\n\nThis link expires in 24 hours. If you did not create a ZOPPEX account, you can safely ignore this email.`,
  };
}

export function renderPasswordResetEmail(firstName: string, url: string): EmailTemplate {
  return {
    subject: 'Reset your ZOPPEX password',
    html: renderEmailLayout({
      heading: `Hello, ${firstName}.`,
      intro:
        'We received a request to reset the password for your ZOPPEX account. Follow the link below to choose a new one.',
      actionLabel: 'Reset password',
      actionUrl: url,
      outro:
        'This link expires in 1 hour and can be used only once. If you did not request a password reset, you can safely ignore this email.',
      footer: 'ZOPPEX · Less waiting. More living.',
    }),
    text: `Hello, ${firstName}.\n\nReset your ZOPPEX password using this link:\n${url}\n\nThis link expires in 1 hour and can be used only once. If you did not request a password reset, you can safely ignore this email.`,
  };
}
