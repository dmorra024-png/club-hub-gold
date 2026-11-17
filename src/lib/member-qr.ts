import { sendTransactionalEmail } from "@/lib/email/send";

export async function sendMemberQrEmail(opts: {
  memberId: string;
  memberNumber: string;
  fullName: string;
  email: string;
  clubName: string;
}) {
  // Use a public QR image service so the code renders inline in any email client
  // (Gmail image proxy, Outlook, Apple Mail). Payload is only the member number,
  // meaningful only inside the club's own software.
  const payload = encodeURIComponent(`SNOOP:${opts.memberNumber}`);
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?data=${payload}&size=480x480&margin=8&format=png`;
  return sendTransactionalEmail({
    templateName: "member-qr",
    recipientEmail: opts.email,
    idempotencyKey: `member-qr-${opts.memberId}-${Date.now()}`,
    templateData: {
      full_name: opts.fullName,
      member_number: opts.memberNumber,
      club_name: opts.clubName,
      qr_url: qrUrl,
    },
  });
}
