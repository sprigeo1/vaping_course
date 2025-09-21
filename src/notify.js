import nodemailer from 'nodemailer';

export function buildTransport() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, FROM_EMAIL } = process.env;
  if (SMTP_HOST && SMTP_PORT && SMTP_USER && SMTP_PASS && FROM_EMAIL) {
    return nodemailer.createTransport({
      host: SMTP_HOST, port: Number(SMTP_PORT), secure: false,
      auth: { user: SMTP_USER, pass: SMTP_PASS }
    });
  }
  return null; // console fallback
}

export function notifyAdminsForSchools(schoolIds, payload, db) {
  const admins = db.db.prepare(`
    SELECT DISTINCT a.email FROM admins a
    JOIN admin_schools ax ON ax.admin_id = a.id
    WHERE ax.school_id IN (${schoolIds.map(()=>'?').join(',') || 'NULL'})
  `).all(...schoolIds);
  const emails = admins.map(a => a.email).filter(Boolean);
  const transport = buildTransport();
  const subject = `[LMS] New submission: ${payload.assignmentTitle}`;
  const text = `${payload.learnerName} submitted '${payload.assignmentTitle}'.`;
  if (transport && emails.length) {
    transport.sendMail({
      from: process.env.FROM_EMAIL,
      to: emails.join(','),
      subject, text
    }).catch(()=>{});
  } else {
    console.log('Notify ->', emails, subject, text);
  }
}
