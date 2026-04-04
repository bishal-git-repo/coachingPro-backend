import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
dotenv.config();

let transporter;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT) || 587,
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
      tls: { rejectUnauthorized: false },
    });
  }
  return transporter;
}

const baseStyle = `
  font-family: 'Segoe UI', Arial, sans-serif;
  background: #f8fafc;
  color: #1e293b;
`;

export async function sendCredentialsEmail({ to, name, role, email, password, coachingName, loginUrl }) {
  const roleLabel = role === 'teacher' ? 'Teacher' : 'Student';
  const html = `
    <div style="${baseStyle} max-width:560px; margin:auto; padding:32px;">
      <div style="background:linear-gradient(135deg,#1e3a5f,#2563eb); padding:24px; border-radius:12px 12px 0 0; text-align:center;">
        <h1 style="color:#fff; margin:0; font-size:22px;">🎓 ${coachingName}</h1>
        <p style="color:#bfdbfe; margin:8px 0 0;">Your ${roleLabel} Account is Ready</p>
      </div>
      <div style="background:#fff; padding:32px; border-radius:0 0 12px 12px; box-shadow:0 4px 16px rgba(0,0,0,0.08);">
        <p style="font-size:16px;">Hi <strong>${name}</strong>,</p>
        <p>Welcome to <strong>${coachingName}</strong>! Your ${roleLabel.toLowerCase()} account has been created. Here are your login credentials:</p>
        
        <div style="background:#f1f5f9; border-left:4px solid #2563eb; padding:16px; border-radius:8px; margin:20px 0;">
          <p style="margin:0 0 8px;"><strong>🔗 Portal URL:</strong> <a href="${loginUrl}" style="color:#2563eb;">${loginUrl}</a></p>
          <p style="margin:0 0 8px;"><strong>📧 Email:</strong> ${email}</p>
          <p style="margin:0;"><strong>🔑 Password:</strong> <code style="background:#e2e8f0; padding:2px 6px; border-radius:4px;">${password}</code></p>
        </div>
        
        <p style="color:#ef4444; font-size:13px;">⚠️ Please change your password after your first login.</p>
        
        <div style="text-align:center; margin:24px 0;">
          <a href="${loginUrl}" style="background:linear-gradient(135deg,#1e3a5f,#2563eb); color:#fff; padding:12px 28px; border-radius:8px; text-decoration:none; font-weight:600; font-size:15px;">
            Login to Portal →
          </a>
        </div>
        
        <p style="color:#94a3b8; font-size:12px; text-align:center; margin-top:24px;">
          This is an automated message from ${coachingName}. Do not reply to this email.
        </p>
      </div>
    </div>
  `;

  return getTransporter().sendMail({
    from: process.env.SMTP_FROM || `"${coachingName}" <noreply@coachingpro.in>`,
    to,
    subject: `Your ${coachingName} ${roleLabel} Account Credentials`,
    html,
  });
}

export async function sendFeeSlipEmail({ to, name, coachingName, slipData, pdfBuffer }) {
  const statusColor = slipData.status === 'paid' ? '#16a34a' : '#ef4444';
  const html = `
    <div style="${baseStyle} max-width:560px; margin:auto; padding:32px;">
      <div style="background:linear-gradient(135deg,#1e3a5f,#2563eb); padding:24px; border-radius:12px 12px 0 0; text-align:center;">
        <h1 style="color:#fff; margin:0; font-size:22px;">🎓 ${coachingName}</h1>
        <p style="color:#bfdbfe; margin:8px 0 0;">Fee Receipt / Slip</p>
      </div>
      <div style="background:#fff; padding:32px; border-radius:0 0 12px 12px; box-shadow:0 4px 16px rgba(0,0,0,0.08);">
        <p>Hi <strong>${name}</strong>,</p>
        <p>Please find your fee details below. The receipt is also attached as a PDF.</p>
        
        <table style="width:100%; border-collapse:collapse; margin:20px 0;">
          <tr style="background:#f8fafc;"><td style="padding:10px; border:1px solid #e2e8f0; font-weight:600;">Receipt No.</td><td style="padding:10px; border:1px solid #e2e8f0;">${slipData.receiptNumber}</td></tr>
          <tr><td style="padding:10px; border:1px solid #e2e8f0; font-weight:600;">Batch</td><td style="padding:10px; border:1px solid #e2e8f0;">${slipData.batchName}</td></tr>
          <tr style="background:#f8fafc;"><td style="padding:10px; border:1px solid #e2e8f0; font-weight:600;">Period</td><td style="padding:10px; border:1px solid #e2e8f0;">${slipData.monthYear}</td></tr>
          <tr><td style="padding:10px; border:1px solid #e2e8f0; font-weight:600;">Amount</td><td style="padding:10px; border:1px solid #e2e8f0;">₹${slipData.amount}</td></tr>
          <tr style="background:#f8fafc;"><td style="padding:10px; border:1px solid #e2e8f0; font-weight:600;">Status</td><td style="padding:10px; border:1px solid #e2e8f0; color:${statusColor}; font-weight:700;">${slipData.status.toUpperCase()}</td></tr>
          ${slipData.paidDate ? `<tr><td style="padding:10px; border:1px solid #e2e8f0; font-weight:600;">Paid On</td><td style="padding:10px; border:1px solid #e2e8f0;">${slipData.paidDate}</td></tr>` : ''}
        </table>
        
        <p style="color:#94a3b8; font-size:12px; text-align:center; margin-top:24px;">
          This is an automated message from ${coachingName}.
        </p>
      </div>
    </div>
  `;

  const mailOptions = {
    from: process.env.SMTP_FROM || `"${coachingName}" <noreply@coachingpro.in>`,
    to,
    subject: `Fee Receipt - ${slipData.monthYear} | ${coachingName}`,
    html,
  };

  if (pdfBuffer) {
    mailOptions.attachments = [{
      filename: `fee-receipt-${slipData.receiptNumber}.pdf`,
      content: pdfBuffer,
      contentType: 'application/pdf',
    }];
  }

  return getTransporter().sendMail(mailOptions);
}

export async function sendWelcomeEmail({ to, name, coachingName }) {
  const html = `
    <div style="${baseStyle} max-width:560px; margin:auto; padding:32px;">
      <div style="background:linear-gradient(135deg,#1e3a5f,#2563eb); padding:24px; border-radius:12px 12px 0 0; text-align:center;">
        <h1 style="color:#fff; margin:0; font-size:24px;">🎉 Welcome to CoachingPro!</h1>
      </div>
      <div style="background:#fff; padding:32px; border-radius:0 0 12px 12px; box-shadow:0 4px 16px rgba(0,0,0,0.08);">
        <p>Hi <strong>${name}</strong>,</p>
        <p>Congratulations! Your coaching institute <strong>${coachingName}</strong> has been successfully registered on CoachingPro.</p>
        <p>You can now start managing your coaching with:</p>
        <ul>
          <li>📚 Classes & Batches</li>
          <li>👨‍🏫 Teachers & Students</li>
          <li>📅 Schedule & Attendance</li>
          <li>💰 Fees Management</li>
          <li>📁 Study Materials</li>
        </ul>
        <p>Upgrade to the <strong>Paid Plan (₹999)</strong> to unlock Razorpay payments, unlimited students & teachers.</p>
        <p style="color:#94a3b8; font-size:12px;">CoachingPro Team</p>
      </div>
    </div>
  `;

  return getTransporter().sendMail({
    from: process.env.SMTP_FROM || '"CoachingPro" <noreply@coachingpro.in>',
    to,
    subject: `Welcome to CoachingPro - ${coachingName} is live!`,
    html,
  });
}

export default { sendCredentialsEmail, sendFeeSlipEmail, sendWelcomeEmail };

// ─── Contact Form Notification to Admin ──────────────────────
export async function sendContactNotification({ id, name, email, subject, message }) {
  const adminEmail = process.env.SMTP_USER;
  if (!adminEmail) return;

  const html = `
    <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:560px;margin:auto;padding:32px;">
      <div style="background:linear-gradient(135deg,#1e3a5f,#2563eb);padding:24px;border-radius:12px 12px 0 0;text-align:center;">
        <h1 style="color:#fff;margin:0;font-size:20px;">📬 New Contact Form Submission</h1>
        <p style="color:#bfdbfe;margin:8px 0 0;">CoachingPro — Submission #${id}</p>
      </div>
      <div style="background:#fff;padding:28px;border-radius:0 0 12px 12px;box-shadow:0 4px 16px rgba(0,0,0,0.08);">
        <table style="width:100%;border-collapse:collapse;font-size:14px;">
          <tr><td style="padding:10px 0;color:#64748b;width:100px;border-bottom:1px solid #f1f5f9;">Name</td><td style="padding:10px 0;font-weight:600;border-bottom:1px solid #f1f5f9;">${name}</td></tr>
          <tr><td style="padding:10px 0;color:#64748b;border-bottom:1px solid #f1f5f9;">Email</td><td style="padding:10px 0;border-bottom:1px solid #f1f5f9;"><a href="mailto:${email}" style="color:#2563eb;">${email}</a></td></tr>
          <tr><td style="padding:10px 0;color:#64748b;border-bottom:1px solid #f1f5f9;">Subject</td><td style="padding:10px 0;font-weight:600;border-bottom:1px solid #f1f5f9;">${subject}</td></tr>
          <tr><td style="padding:10px 0;color:#64748b;vertical-align:top;">Message</td><td style="padding:10px 0;line-height:1.6;">${message.replace(/\n/g, '<br/>')}</td></tr>
        </table>
        <div style="margin-top:20px;padding:12px 16px;background:#f8fafc;border-radius:8px;font-size:12px;color:#94a3b8;">
          Reply directly to this email to respond to ${name}.
        </div>
      </div>
    </div>`;

  await getTransporter().sendMail({
    from:     process.env.SMTP_FROM,
    to:       adminEmail,
    replyTo:  email,           // clicking Reply goes to the user, not yourself
    subject:  `[CoachingPro Contact] ${subject}`,
    html,
  });
}
