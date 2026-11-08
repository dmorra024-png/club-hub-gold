import { requestMemberMail } from "./member-mail.functions";

export async function sendMemberQrEmail(opts: {
  memberId: string;
  memberNumber: string;
  fullName: string;
  email: string;
  clubName: string;
}) {
  return requestMemberMail({ data: { memberId: opts.memberId, retry: true } });
}
