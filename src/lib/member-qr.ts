import { sendTransactionalEmail } from "@/lib/email/send";

export async function sendMemberQrEmail(opts: {
  memberId: string;
  memberNumber: string;
  fullName: string;
  email: string;
  clubName: string;
}) {
  return sendTransactionalEmail({
    templateName: "member-qr",
    recipientEmail: opts.email,
    idempotencyKey: `member-qr-${opts.memberId}-${Date.now()}`,
    templateData: {
      full_name: opts.fullName,
      member_number: opts.memberNumber,
      club_name: opts.clubName,
      member_id: opts.memberId,
      qr_url: "cid:member-card",
    },
  });
}
