import QRCode from "qrcode";

export async function memberCardAttachment(memberNumber: string) {
  if (!/^\d{1,12}$/.test(memberNumber)) throw new Error("Número de socio no válido");
  const png = await QRCode.toBuffer(`SNOOP:${memberNumber}`, {
    type: "png",
    width: 480,
    margin: 8,
  });
  return { filename: "carnet.png", content: png.toString("base64"), content_id: "member-card" };
}
