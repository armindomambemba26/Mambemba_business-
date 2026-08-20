import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import { uploadBuffer } from "./storage.js";

export async function makeReceipt(order) {
  const verifyUrl = `${process.env.PUBLIC_API_URL}/api/verify/${order.public_token}`;
  const qr = await QRCode.toDataURL(verifyUrl, { width: 180, margin: 1 });
  const doc = new PDFDocument({ size: "A4", margin: 42 });
  const chunks = [];
  doc.on("data", c => chunks.push(c));
  const done = new Promise((resolve, reject) => {
    doc.on("end", resolve);
    doc.on("error", reject);
  });

  doc.fontSize(20).font("Helvetica-Bold").text("MAMBEMBA BUSINESS");
  doc.moveDown(0.2).fontSize(11).font("Helvetica").text("Recibo / Comprovativo de encomenda");
  doc.moveDown();
  doc.fontSize(10).text(`ID: ${order.id}`);
  doc.text(`Data da entrega: ${order.delivery_date}`);
  doc.text(`Horário: ${String(order.delivery_time).slice(0,5)}`);
  doc.moveDown();

  doc.fontSize(12).font("Helvetica-Bold").text("Cliente");
  doc.fontSize(10).font("Helvetica").text(`Nome: ${order.name}`);
  doc.text(`Contacto: ${order.phone}`);
  if (order.whatsapp) doc.text(`WhatsApp: ${order.whatsapp}`);
  doc.text(`Local de entrega: ${order.delivery_location}`);
  doc.moveDown();

  doc.fontSize(12).font("Helvetica-Bold").text("Produto");
  doc.fontSize(10).font("Helvetica").text(`Categoria: ${order.category}`);
  doc.text(`Produto: ${order.product}`);
  if (order.color) doc.text(`Cor: ${order.color}`);
  if (order.size) doc.text(`Tamanho: ${order.size}`);
  doc.text(`Produtos: ${Number(order.cost).toLocaleString("pt-AO")} Kz`);
  doc.text(`Táxi: ${Number(order.taxi).toLocaleString("pt-AO")} Kz`);
  doc.font("Helvetica-Bold").text(`Total: ${(Number(order.cost)+Number(order.taxi)).toLocaleString("pt-AO")} Kz`);
  doc.font("Helvetica");
  if (order.notes) { doc.moveDown(); doc.text(`Observações: ${order.notes}`); }

  doc.moveDown(2);
  doc.fontSize(9).text("Validação online do recibo:");
  doc.image(qr, { fit: [130,130] });
  doc.moveDown();
  doc.fontSize(8).fillColor("#555").text(verifyUrl);
  doc.fillColor("#111");
  doc.end();
  await done;
  return uploadBuffer(Buffer.concat(chunks), "application/pdf", "receipts");
}
