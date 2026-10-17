import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import QRCode from "qrcode";

// jsPDF's built-in fonts have no ₹ glyph, so amounts in the PDF use "Rs."
const money = (n) => "Rs. " + Number(n || 0).toLocaleString("en-IN");

/**
 * Builds the invoice PDF entirely in the browser and triggers a real file
 * download (works on desktop and mobile browsers).
 * `upi` = { link, id } — optional; adds a scannable UPI QR when balance is due.
 */
export async function buildInvoicePdf(booking, upi) {
  const items = Array.isArray(booking.items) ? booking.items : [];
  const subtotal = items.reduce((s, i) => s + Number(i.qty || 0) * Number(i.price || 0), 0);
  const total = Number(booking.total) > 0 ? Number(booking.total) : subtotal;
  const discount = Math.max(0, Number(booking.discount || 0));
  const advance = Number(booking.advance || 0);
  const balance = Math.max(0, total - advance);

  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const M = 40;
  const gold = [138, 109, 26];

  // Header
  doc.setFont("times", "bold").setFontSize(24).setTextColor(...gold);
  doc.text("RARE LUXE", W / 2, 56, { align: "center" });
  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(120);
  doc.text("PREMIUM RENTALS", W / 2, 72, { align: "center" });
  doc.setDrawColor(...gold).setLineWidth(1.5).line(M, 84, W - M, 84);

  // Bill-to / booking details
  doc.setFontSize(10).setTextColor(...gold).setFont("helvetica", "bold");
  doc.text("BILL TO", M, 108);
  doc.text("BOOKING", W - M, 108, { align: "right" });
  doc.setFont("helvetica", "normal").setTextColor(30);
  const left = [booking.customer, booking.phone, booking.email].filter(Boolean);
  left.forEach((t, i) => doc.text(String(t), M, 124 + i * 14));
  const right = [
    `Booking ID: ${booking.id ?? ""}`,
    `Event: ${booking.event || "-"}`,
    `Event Date: ${booking.date || "-"}`,
    `Return Date: ${booking.returnDate || "-"}`,
  ];
  right.forEach((t, i) => doc.text(t, W - M, 124 + i * 14, { align: "right" }));

  // Items table
  const body = items.map((i) => {
    const price = Number(i.price || 0);
    const qty = Number(i.qty || 0);
    return [
      i.code ? `${i.name}  (${i.code})` : String(i.name || ""),
      String(qty),
      price > 0 ? money(price) : "-",
      price > 0 ? money(price * qty) : "-",
    ];
  });
  const foot = [];
  if (discount > 0) {
    foot.push([{ content: "Subtotal", colSpan: 3, styles: { halign: "right" } }, { content: money(total + discount), styles: { halign: "right" } }]);
    foot.push([{ content: "Discount", colSpan: 3, styles: { halign: "right" } }, { content: "- " + money(discount), styles: { halign: "right" } }]);
  } else if (subtotal > 0) foot.push([{ content: "Items Subtotal", colSpan: 3, styles: { halign: "right" } }, { content: money(subtotal), styles: { halign: "right" } }]);
  foot.push([{ content: "Total Amount", colSpan: 3, styles: { halign: "right", fontStyle: "bold" } }, { content: money(total), styles: { halign: "right", fontStyle: "bold" } }]);
  if (advance > 0) {
    foot.push([{ content: "Advance Paid", colSpan: 3, styles: { halign: "right" } }, { content: "- " + money(advance), styles: { halign: "right" } }]);
    foot.push([{ content: "Balance Due", colSpan: 3, styles: { halign: "right", fontStyle: "bold" } }, { content: money(balance), styles: { halign: "right", fontStyle: "bold" } }]);
  }
  autoTable(doc, {
    startY: 190,
    head: [["Item", "Qty", "Rate", "Amount"]],
    body: body.length ? body : [[{ content: "No items listed", colSpan: 4 }]],
    foot,
    margin: { left: M, right: M },
    theme: "plain",
    styles: { fontSize: 10, cellPadding: 6, textColor: 30, lineColor: [221, 221, 221], lineWidth: { bottom: 0.5 } },
    headStyles: { textColor: 120, fontSize: 8, fontStyle: "bold" },
    footStyles: { textColor: 30, fillColor: false, lineWidth: 0 },
    columnStyles: { 1: { halign: "center", cellWidth: 50 }, 2: { halign: "right", cellWidth: 90 }, 3: { halign: "right", cellWidth: 100 } },
  });

  let y = doc.lastAutoTable.finalY + 24;
  const ensure = (h) => { if (y + h > doc.internal.pageSize.getHeight() - 50) { doc.addPage(); y = 50; } };

  // Payment status
  const status = balance <= 0 ? "PAID IN FULL" : advance > 0 ? "PARTIALLY PAID" : "PAYMENT PENDING";
  ensure(30);
  doc.setFont("helvetica", "bold").setFontSize(11).setTextColor(...(balance <= 0 ? [40, 130, 80] : [192, 128, 64]));
  doc.text(status, M, y);
  y += 22;

  // Notes
  if (booking.notes) {
    doc.setFont("helvetica", "normal").setFontSize(10).setTextColor(60);
    const lines = doc.splitTextToSize(`Notes: ${booking.notes}`, W - M * 2);
    ensure(lines.length * 13 + 10);
    doc.text(lines, M, y);
    y += lines.length * 13 + 14;
  }

  // UPI QR (generated locally — no network needed)
  if (balance > 0 && upi?.link) {
    try {
      const qr = await QRCode.toDataURL(upi.link, { margin: 1, width: 300 });
      ensure(170);
      doc.setFont("helvetica", "bold").setFontSize(9).setTextColor(...gold);
      doc.text(`SCAN TO PAY ${money(balance)}`, W / 2, y, { align: "center" });
      doc.addImage(qr, "PNG", W / 2 - 55, y + 8, 110, 110);
      doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(90);
      doc.text(`UPI ID: ${upi.id}`, W / 2, y + 132, { align: "center" });
      y += 150;
    } catch (e) { console.warn("QR generation failed", e); }
  }

  ensure(30);
  doc.setFont("times", "italic").setFontSize(12).setTextColor(...gold);
  doc.text("Thank you for choosing Rare Luxe Premium Rentals!", W / 2, y + 16, { align: "center" });

  const safe = String(booking.id ?? "invoice").replace(/[^\w-]+/g, "_");
  return { blob: doc.output("blob"), filename: `RareLuxe-Invoice-${safe}.pdf` };
}

// Desktop-style direct download (anchor + object URL).
export function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
