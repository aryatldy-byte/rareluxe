import { useState, useEffect } from "react";
import { supabase } from "../supabaseClient";
import * as XLSX from "xlsx";
import InventoryFormModal from "./components/InventoryFormModal";
import { buildInvoicePdf, triggerDownload } from "./utils/invoicePdf";
import { isNativeApp, saveAndSharePdfNative } from "./utils/nativePdf";
import { normalizeCode, validateCode, isDuplicateError, matchesInventory, nextCode } from "./utils/inventoryCode";

// Read from environment (.env / Vercel project env vars) instead of being
// hardcoded here, so no Supabase key ever lives in source control.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

// ---------------------------------------------------------------------------
// api(): now throws a descriptive error on any failed request instead of
// silently returning as if it worked. This is what makes save/load failures
// visible instead of the form just closing and nothing happening.
// ---------------------------------------------------------------------------
const api = async (table, method = "GET", body = null, params = "") => {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${params}`, {
    method,
    headers: {
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": method === "POST" ? "return=representation" : method === "PATCH" ? "return=representation" : "",
    },
    body: body ? JSON.stringify(body) : null,
  });

  if (!res.ok) {
    let detail = "";
    try {
      const errJson = await res.json();
      detail = errJson.message || errJson.hint || errJson.details || JSON.stringify(errJson);
    } catch {
      detail = await res.text();
    }
    throw new Error(`${table} ${method} failed (${res.status}): ${detail || "Unknown error"}`);
  }

  if (method === "DELETE") return;
  const text = await res.text();
  return text ? JSON.parse(text) : [];
};

// Only these accounts may see the Collected / Pending figures on the dashboard.
// Comma-separated emails in VITE_COLLECTION_VIEWER_EMAILS (e.g. "ashna@rareluxe.com").
const COLLECTION_VIEWERS = String(import.meta.env.VITE_COLLECTION_VIEWER_EMAILS || "")
  .split(",").map(e => e.trim().toLowerCase()).filter(Boolean);
const bookingCollected = b => Math.min(Number(b.total || 0), Number(b.advance || 0)) + (b.paid ? Math.max(0, Number(b.total || 0) - Number(b.advance || 0)) : 0);
const bookingPending = b => (b.paid ? 0 : getBalanceDue(b));

// Authentication now handled by Supabase - no hardcoded users

const fmt = n => "₹" + Number(n).toLocaleString("en-IN");
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

const C = {
  bg: "#0d0f0e", surface: "#131713", card: "#181e18", border: "#2a3328",
  gold: "#b8952a", goldLight: "#d4af5a", green: "#1e3a2a", greenText: "#4a7c5e",
  text: "#f0ece0", muted: "#7a8070", success: "#5aaa78", danger: "#c0614a",
  info: "#5a8aaa", orange: "#c08040",
};

const STATUS_COLORS = {
  Active: { bg: "#0e2a1a", text: "#5aaa78", border: "#1a4a2a" },
  Upcoming: { bg: "#0e1a2a", text: "#5a8aaa", border: "#1a2a4a" },
  Returned: { bg: "#1a1a1a", text: "#7a8070", border: "#2a2a2a" },
  Completed: { bg: "#2a2410", text: "#b8952a", border: "#4a3f1a" },
  Overdue: { bg: "#2a0e0e", text: "#c0614a", border: "#4a1a1a" },
};

// ---------------------------------------------------------------------------
// Booking Type: "rent_out" (existing/default) vs "event" (new). Events use a
// critical/red accent everywhere — badges, calendar cells, dashboard — so
// staff can't miss them at a glance.
// ---------------------------------------------------------------------------
const BOOKING_TYPES = [
  { key: "rent_out", label: "Rent Out", icon: "📦" },
  { key: "event", label: "Event", icon: "🎉" },
];
const CRITICAL = "#e5484d"; // critical/event red, distinct from the danger/delete red used elsewhere
const BOOKING_TYPE_COLORS = {
  rent_out: { bg: "#181e18", text: C.goldLight, border: C.border },
  event: { bg: "#2a0e10", text: "#ff8080", border: CRITICAL },
};
const isEvent = (b) => b?.booking_type === "event";

// ---------------------------------------------------------------------------
// Demo / view-only account. Create a user with this email (Supabase Dashboard →
// Authentication → Users → Add user) and anyone logged in as it can browse
// everything but cannot add, edit or delete. Set VITE_DEMO_EMAIL in .env /
// Vercel env vars to use a different address.
// ---------------------------------------------------------------------------
const DEMO_EMAIL = (import.meta.env.VITE_DEMO_EMAIL || "demo@rareluxe.com").toLowerCase();

// ---------------------------------------------------------------------------
// Booking totals, calculated in ONE place from the form's current values:
//   Subtotal     = sum of (qty x rate) for every item  (or a manually typed
//                  subtotal when no item rates were entered / legacy bookings)
//   Total Amount = Subtotal - Discount   (this is what gets saved as `total`)
// Nothing is stored/synced in state, so it can never lag behind the items.
// ---------------------------------------------------------------------------
const formTotals = (form) => {
  const itemsSubtotal = (form.items || []).reduce((s, it) => s + Number(it.qty || 0) * Number(it.price || 0), 0);
  const manual = form.manualSubtotal !== "" && form.manualSubtotal != null;
  const base = manual ? Math.max(0, Number(form.manualSubtotal) || 0) : itemsSubtotal;
  const rawDiscount = Math.max(0, Number(form.discount) || 0);
  const discount = Math.min(rawDiscount, base);
  return { itemsSubtotal, manual, base, discount, finalTotal: base - discount, overDiscount: rawDiscount > base };
};

const inp = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: "14px 16px", color: C.text, fontSize: 16, width: "100%", outline: "none", boxSizing: "border-box", fontFamily: "system-ui", WebkitAppearance: "none" };
const btnGold = { background: `linear-gradient(135deg, ${C.gold}, ${C.goldLight})`, color: "#0d0f0e", border: "none", borderRadius: 12, padding: "14px 22px", fontWeight: 800, cursor: "pointer", fontSize: 15, fontFamily: "system-ui", letterSpacing: "0.04em", touchAction: "manipulation" };
const btnGhost = { background: "transparent", color: C.muted, border: `1px solid ${C.border}`, borderRadius: 12, padding: "14px 18px", fontWeight: 600, cursor: "pointer", fontSize: 15, fontFamily: "system-ui", touchAction: "manipulation" };
const btnDanger = { background: "transparent", color: C.danger, border: `1px solid ${C.danger}`, borderRadius: 10, padding: "10px 16px", fontWeight: 700, cursor: "pointer", fontSize: 13, fontFamily: "system-ui", touchAction: "manipulation" };

function Label({ children }) {
  return <div style={{ fontSize: 11, color: C.muted, fontWeight: 700, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.1em", fontFamily: "system-ui" }}>{children}</div>;
}
function Card({ children, style = {}, onClick }) {
  return <div onClick={onClick} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: 20, position: "relative", overflow: "hidden", ...style }}>{children}</div>;
}
function StatusBadge({ status }) {
  const sc = STATUS_COLORS[status] || STATUS_COLORS.Upcoming;
  return <span style={{ background: sc.bg, color: sc.text, border: `1px solid ${sc.border}`, fontSize: 10, fontWeight: 700, borderRadius: 20, padding: "4px 12px", fontFamily: "system-ui", letterSpacing: "0.06em", whiteSpace: "nowrap" }}>{status?.toUpperCase()}</span>;
}
// Shows "🎉 EVENT" in critical red, or "📦 RENT OUT" in the normal gold tone.
// Defaults to rent_out for any booking saved before this field existed.
function BookingTypeBadge({ type }) {
  const t = type === "event" ? "event" : "rent_out";
  const meta = BOOKING_TYPES.find(bt => bt.key === t);
  const tc = BOOKING_TYPE_COLORS[t];
  return (
    <span style={{ background: tc.bg, color: tc.text, border: `1px solid ${tc.border}`, fontSize: 10, fontWeight: 800, borderRadius: 20, padding: "4px 12px", fontFamily: "system-ui", letterSpacing: "0.06em", whiteSpace: "nowrap" }}>
      {meta.icon} {meta.label.toUpperCase()}
    </span>
  );
}
function ConfirmModal({ message, onConfirm, onCancel }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.9)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 400, padding: 16 }}>
      <div style={{ background: C.card, border: `1px solid ${C.danger}`, borderRadius: 20, padding: 28, width: "100%", maxWidth: 480, textAlign: "center" }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>🗑️</div>
        <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 8, color: C.text, fontFamily: "system-ui" }}>{message}</div>
        <div style={{ color: C.muted, fontSize: 14, fontFamily: "system-ui", marginBottom: 24 }}>This action cannot be undone.</div>
        <div style={{ display: "flex", gap: 12 }}>
          <button onClick={onCancel} style={{ ...btnGhost, flex: 1 }}>Cancel</button>
          <button onClick={onConfirm} style={{ ...btnGold, flex: 1, background: C.danger, color: "#fff" }}>Delete</button>
        </div>
      </div>
    </div>
  );
}

function ErrorBanner({ message, onRetry, onDismiss }) {
  if (!message) return null;
  return (
    <div style={{ background: "#2a0e0e", border: `1px solid ${C.danger}`, borderRadius: 12, padding: "14px 16px", marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
      <div style={{ color: C.danger, fontSize: 13, fontFamily: "system-ui", flex: 1 }}>⚠ {message}</div>
      <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
        {onRetry && <button onClick={onRetry} style={{ ...btnGhost, padding: "6px 12px", fontSize: 12, color: C.danger, borderColor: C.danger }}>Retry</button>}
        {onDismiss && <button onClick={onDismiss} style={{ background: "transparent", border: "none", color: C.danger, fontSize: 16, cursor: "pointer" }}>✕</button>}
      </div>
    </div>
  );
}

// Shared helper: balance still owed on a booking = total - advance paid, floored at 0
const getBalanceDue = (b) => Math.max(0, Number(b?.total || 0) - Number(b?.advance || 0));

// ---------------------------------------------------------------------------
// UPI payment helpers
// ---------------------------------------------------------------------------
const UPI_ID = "rareluxe1qr@fbl";
const UPI_PAYEE_NAME = "Rareluxe Premium Rentals";

// Builds a standard UPI deep link. Tapping this on a phone opens any UPI app
// (Google Pay, PhonePe, Paytm, etc.) with the payee and amount pre-filled —
// this is what a WhatsApp message can actually carry, since it's just text.
function buildUpiLink(amount, note) {
  const params = new URLSearchParams({
    pa: UPI_ID,
    pn: UPI_PAYEE_NAME,
    am: Number(amount) > 0 ? Number(amount).toFixed(2) : "",
    cu: "INR",
    tn: note || "",
  });
  return `upi://pay?${params.toString()}`;
}

// Builds an <img> src that renders an actual scannable QR code for a UPI
// link, via a free QR-generation API. Used only in the downloadable/printable
// invoice (an HTML page can show images; a WhatsApp text message cannot).
function buildUpiQrImageUrl(amount, note) {
  const upiLink = buildUpiLink(amount, note);
  return `https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=8&data=${encodeURIComponent(upiLink)}`;
}

// WhatsApp Invoice Generator
function sendWhatsAppInvoice(booking) {
  const items = Array.isArray(booking.items) ? booking.items : [];
  const itemsSubtotal = items.reduce((s, i) => s + Number(i.qty || 0) * Number(i.price || 0), 0);
  const total = Number(booking.total) > 0 ? Number(booking.total) : itemsSubtotal;
  const advance = Number(booking.advance || 0);
  const balance = Math.max(0, total - advance);
  const discount = Math.max(0, Number(booking.discount || 0));
  const itemLines = items.map(i => {
    const price = Number(i.price || 0);
    const amount = price * Number(i.qty || 0);
    return `  • ${i.name} × ${i.qty}${price > 0 ? ` @ ${fmt(price)} = ${fmt(amount)}` : ""}`;
  }).join("\n");
  const message = `
╔══════════════════════╗
     🌟 RARE LUXE 🌟
   Premium Rental Invoice
╚══════════════════════╝

📋 *Booking ID:* ${booking.id}
👤 *Client:* ${booking.customer}
🎉 *Event:* ${booking.event}
📅 *Date:* ${booking.date}
↩️ *Return:* ${booking.returnDate}
📞 *Phone:* ${booking.phone}

──────────────────────
🛍️ *ITEMS RESERVED*
──────────────────────
${itemLines || "  • No items listed"}

──────────────────────
${discount > 0 ? `🧾 *Subtotal:* ${fmt(total + discount)}\n🏷️ *Discount:* - ${fmt(discount)}\n\n` : ""}💰 *TOTAL AMOUNT*
   ${fmt(total)}
${advance > 0 ? `💵 *Advance Paid:* ${fmt(advance)}\n📌 *Balance Due:* ${fmt(balance)}\n` : ""}──────────────────────
💳 *Payment Status:* ${booking.paid ? "✅ PAID" : balance <= 0 ? "✅ PAID" : advance > 0 ? "⏳ PARTIALLY PAID" : "⏳ PENDING"}
${!booking.paid && balance > 0 ? `
🔗 *Pay Now (UPI):*
${buildUpiLink(balance, `Invoice ${booking.id}`)}
📱 *UPI ID:* ${UPI_ID}
` : ""}
Thank you for choosing
*Rare Luxe Premium Rentals!* ✨

_For queries, contact us._
  `.trim();

  const phone = booking.phone?.replace(/\D/g, "");
  const url = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
  window.open(url, "_blank");
}

// Follow-up reminder message — a friendly nudge about a yearly repeat event,
// distinct from the transactional WhatsApp invoice above.
function sendFollowUpWhatsApp(booking) {
  const message = `
Hi ${booking.customer}! 👋

This is *Rare Luxe Premium Rentals*. Last year around this time, we had the pleasure of styling your *${booking.event}* (${booking.date}).

If you're planning the same event again this year, we'd love to help you again — just let us know a convenient date and we'll take care of the rest! ✨

Looking forward to hearing from you.
`.trim();
  const phone = booking.phone?.replace(/\D/g, "");
  const url = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
  window.open(url, "_blank");
}

// ---------------------------------------------------------------------------
// Downloadable invoice: opens a print-styled document in a new tab with the
// company name, client details, event date, items, and total. The browser's
// print dialog lets the user "Save as PDF" — no extra libraries required.
// A "Close" button (screen-only, hidden when printing) lets staff dismiss the
// tab/window directly instead of having to close the whole app.
// ---------------------------------------------------------------------------
const escapeHtml = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function downloadInvoice(booking) {
  const items = Array.isArray(booking.items) ? booking.items : [];
  const itemsSubtotal = items.reduce((s, i) => s + Number(i.qty || 0) * Number(i.price || 0), 0);
  const total = Number(booking.total) > 0 ? Number(booking.total) : itemsSubtotal;
  const advance = Number(booking.advance || 0);
  const balance = Math.max(0, total - advance);
  const discount = Math.max(0, Number(booking.discount || 0));
  const itemRows = items.map(i => {
    const price = Number(i.price || 0);
    const amount = price * Number(i.qty || 0);
    return `
    <tr>
      <td>${escapeHtml(i.name)}</td>
      <td style="text-align:center">${escapeHtml(i.qty)}</td>
      <td style="text-align:right">${price > 0 ? escapeHtml(fmt(price)) : "—"}</td>
      <td style="text-align:right">${price > 0 ? escapeHtml(fmt(amount)) : "—"}</td>
    </tr>`;
  }).join("");

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Invoice ${escapeHtml(booking.id)}</title>
<style>
  body { font-family: Georgia, 'Times New Roman', serif; background:#fff; color:#1a1a1a; padding:40px; max-width:720px; margin:0 auto; }
  .header { text-align:center; margin-bottom:32px; border-bottom:2px solid #b8952a; padding-bottom:20px; }
  .header h1 { margin:0; letter-spacing:3px; color:#8a6d1a; font-size:26px; }
  .header p { margin:6px 0 0; color:#777; font-size:12px; text-transform:uppercase; letter-spacing:2px; }
  .meta { display:flex; justify-content:space-between; margin-bottom:28px; font-size:14px; gap:24px; }
  .meta div { line-height:1.7; }
  .meta strong { color:#8a6d1a; }
  table { width:100%; border-collapse:collapse; margin-bottom:20px; }
  th, td { padding:10px 8px; border-bottom:1px solid #ddd; font-size:14px; text-align:left; }
  th { text-transform:uppercase; font-size:11px; letter-spacing:1px; color:#888; }
  tfoot td { font-weight:bold; font-size:17px; border-top:2px solid #8a6d1a; border-bottom:none; padding-top:14px; }
  tfoot tr.subline td { font-weight:normal; font-size:14px; color:#555; border-top:1px solid #ddd; padding-top:10px; }
  .status { display:inline-block; padding:4px 14px; border-radius:14px; font-size:12px; font-weight:bold; margin-top:6px; }
  .status.paid { background:#0e2a1a; color:#5aaa78; }
  .status.pending { background:#2a1a0e; color:#c08040; }
  .notes { margin-top:20px; font-size:13px; background:#faf8f2; border:1px solid #eee; border-radius:8px; padding:14px 16px; white-space:pre-wrap; }
  .footer { text-align:center; margin-top:44px; color:#8a6d1a; font-style:italic; font-size:15px; }
  .pay-box { margin-top:24px; text-align:center; border:1px solid #eee; border-radius:10px; padding:20px; background:#faf8f2; }
  .pay-box img { display:block; margin:0 auto 10px; border-radius:6px; }
  .pay-box .pay-label { font-size:11px; text-transform:uppercase; letter-spacing:1.5px; color:#8a6d1a; font-weight:bold; margin-bottom:8px; }
  .pay-box .upi-id { font-size:13px; color:#555; margin-top:4px; }
  .close-bar { max-width:720px; margin:0 auto 16px; text-align:right; }
  .close-btn {
    background:#1a1a1a; color:#fff; border:none; border-radius:8px;
    padding:10px 20px; font-size:14px; font-weight:bold; cursor:pointer;
    font-family: Georgia, 'Times New Roman', serif; letter-spacing:0.5px;
  }
  .close-btn:hover { background:#333; }
  @media print { body { padding:16px; } .close-bar { display:none; } }
</style>
</head>
<body>
  <div class="close-bar no-print">
    <button class="close-btn" onclick="window.close()">✕ Close Invoice</button>
  </div>
  <div class="header">
    <h1>RARE LUXE</h1>
    <p>Premium Rentals</p>
  </div>
  <div class="meta">
    <div>
      <strong>Bill To</strong><br/>
      ${escapeHtml(booking.customer)}<br/>
      ${escapeHtml(booking.phone)}<br/>
      ${escapeHtml(booking.email)}
    </div>
    <div style="text-align:right">
      <strong>Booking ID:</strong> ${escapeHtml(booking.id)}<br/>
      <strong>Event:</strong> ${escapeHtml(booking.event)}<br/>
      <strong>Event Date:</strong> ${escapeHtml(booking.date)}<br/>
      <strong>Return Date:</strong> ${escapeHtml(booking.returnDate) || "-"}
    </div>
  </div>
  <table>
    <thead><tr><th>Item</th><th style="text-align:center">Qty</th><th style="text-align:right">Rate</th><th style="text-align:right">Amount</th></tr></thead>
    <tbody>${itemRows || `<tr><td colspan="4">No items listed</td></tr>`}</tbody>
    <tfoot>
      ${itemsSubtotal > 0 ? `<tr><td colspan="3" style="font-weight:normal;color:#888;border-top:1px solid #ddd;">Items Subtotal</td><td style="text-align:right;font-weight:normal;color:#888;border-top:1px solid #ddd;">${escapeHtml(fmt(itemsSubtotal))}</td></tr>` : ""}
      ${discount > 0 ? `<tr class="subline"><td colspan="3">Subtotal</td><td style="text-align:right">${escapeHtml(fmt(total + discount))}</td></tr>
      <tr class="subline"><td colspan="3">Discount</td><td style="text-align:right">- ${escapeHtml(fmt(discount))}</td></tr>` : ""}
      <tr><td colspan="3">Total Amount</td><td style="text-align:right">${escapeHtml(fmt(total))}</td></tr>
      ${advance > 0 ? `<tr class="subline"><td colspan="3">Advance Paid</td><td style="text-align:right">- ${escapeHtml(fmt(advance))}</td></tr>
      <tr><td colspan="3">Balance Due</td><td style="text-align:right">${escapeHtml(fmt(balance))}</td></tr>` : ""}
    </tfoot>
  </table>
  <span class="status ${balance <= 0 ? "paid" : "pending"}">${balance <= 0 ? "PAID IN FULL" : advance > 0 ? "PARTIALLY PAID" : "PAYMENT PENDING"}</span>
  ${booking.notes ? `<div class="notes"><strong>Notes:</strong><br/>${escapeHtml(booking.notes)}</div>` : ""}
  ${balance > 0 ? `
  <div class="pay-box">
    <div class="pay-label">Scan to Pay ${escapeHtml(fmt(balance))}</div>
    <img src="${buildUpiQrImageUrl(balance, `Invoice ${booking.id}`)}" width="180" height="180" alt="UPI QR Code" />
    <div class="upi-id">UPI ID: ${escapeHtml(UPI_ID)}</div>
  </div>` : ""}
  <div class="footer">Thank you for choosing Rare Luxe Premium Rentals!</div>
  <div class="close-bar no-print" style="margin-top:20px;">
    <button class="close-btn" onclick="window.close()">✕ Close Invoice</button>
  </div>
  <script>window.onload = () => setTimeout(() => window.print(), 200);</script>
</body>
</html>`;

  const win = window.open("", "_blank");
  if (!win) { alert("Please allow pop-ups to download the invoice."); return; }
  win.document.write(html);
  win.document.close();
}

// ---------------------------------------------------------------------------
// ItemSearchPicker: now also offers "+ Add '<name>' to inventory" so staff can
// create a brand-new inventory item without leaving the booking form.
// ---------------------------------------------------------------------------
function ItemSearchPicker({ inventory, value, onSelect, onCreateNew }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value || "");

  useEffect(() => { setQuery(value || ""); }, [value]);

  const trimmed = query.trim();
  const matches = trimmed
    ? inventory.filter(inv => matchesInventory(inv, trimmed))
    : inventory;

  const exactMatch = trimmed && inventory.some(inv => inv.name.toLowerCase() === trimmed.toLowerCase() || normalizeCode(inv.code) === normalizeCode(trimmed));

  const pick = (name) => { onSelect(name); setQuery(name); setOpen(false); };

  const handleCreateNew = () => {
    setOpen(false);
    onCreateNew(trimmed);
  };

  return (
    <div style={{ position: "relative", flex: 2, minWidth: 0 }}>
      <div style={{ position: "relative" }}>
        <input
          value={query}
          onChange={e => { setQuery(e.target.value); onSelect(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="🔍 Search by code or name…"
          style={{ ...inp, paddingRight: 40 }}
        />
        <span style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", color: C.muted, fontSize: 15, pointerEvents: "none" }}>🔍</span>
      </div>
      {open && (matches.length > 0 || trimmed) && (
        <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, maxHeight: 260, overflowY: "auto", zIndex: 50, boxShadow: "0 8px 24px rgba(0,0,0,0.5)" }}>
          {matches.map(inv => {
            const avail = inv.total - inv.rented;
            return (
              <div
                key={inv.id}
                onMouseDown={() => pick(inv.name)}
                style={{ padding: "12px 14px", cursor: "pointer", borderBottom: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, fontFamily: "system-ui", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{inv.name}</div>
                  <div style={{ fontSize: 11, color: C.muted, fontFamily: "system-ui" }}>{inv.code ? <b style={{ color: C.goldLight }}>{inv.code}</b> : null}{inv.code ? " · " : ""}{inv.category} · {fmt(inv.pricePerDay)}/day</div>
                </div>
                <span style={{ fontSize: 11, color: avail === 0 ? C.danger : C.success, fontWeight: 700, fontFamily: "system-ui", flexShrink: 0 }}>{avail} left</span>
              </div>
            );
          })}
          {matches.length === 0 && trimmed && (
            <div style={{ padding: "12px 14px", color: C.muted, fontSize: 13, fontFamily: "system-ui" }}>
              No matching items
            </div>
          )}
          {trimmed && !exactMatch && (
            <div
              onMouseDown={handleCreateNew}
              style={{ padding: "12px 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 8, color: C.goldLight, fontSize: 13, fontFamily: "system-ui", fontWeight: 700 }}
            >
              ➕ Add "{trimmed}" to inventory
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function LoginScreen({ onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);

  const handleSignIn = async () => {
    if (!email || !password) {
      setError("Please enter email and password.");
      return;
    }
    setLoading(true);
    setError("");
    
    try {
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      
      if (signInError) throw signInError;
      
      if (data.user) {
        onLogin(data.user);
      }
    } catch (err) {
      setError(err.message || "Sign in failed. Please check your email and password.");
    } finally {
      setLoading(false);
    }
  };

  const handleSignUp = async () => {
    if (!email || !password || !confirmPassword) {
      setError("Please fill in all fields.");
      return;
    }
    
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    if (password.length < 6) {
      setError("Password must be at least 6 characters long.");
      return;
    }

    setLoading(true);
    setError("");
    
    try {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
      });
      
      if (signUpError) throw signUpError;
      
      if (data.user) {
        setError("Account created! Please check your email to confirm, then sign in.");
        setIsSignUp(false);
        setPassword("");
        setConfirmPassword("");
        setEmail("");
      }
    } catch (err) {
      setError(err.message || "Sign up failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ background: C.bg, minHeight: "100dvh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24, fontFamily: "'Georgia', serif" }}>
      <div style={{ width: "100%", maxWidth: 400 }}>
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <div style={{ fontSize: 56, color: C.goldLight, marginBottom: 12 }}>◈</div>
          <div style={{ fontWeight: 800, fontSize: 24, letterSpacing: "0.12em", color: C.goldLight, textTransform: "uppercase" }}>Rare Luxe</div>
          <div style={{ fontSize: 12, color: C.muted, letterSpacing: "0.16em", textTransform: "uppercase", fontFamily: "system-ui", marginTop: 4 }}>Premium Rentals</div>
        </div>
        <Card>
          <div style={{ height: 2, background: `linear-gradient(90deg, transparent, ${C.gold}, transparent)`, margin: "-20px -20px 24px" }} />
          
          {/* Tab Toggle */}
          <div style={{ display: "flex", gap: 8, marginBottom: 24, borderBottom: `1px solid ${C.border}`, paddingBottom: 12 }}>
            <button
              onClick={() => setIsSignUp(false)}
              style={{
                background: "transparent",
                border: "none",
                color: !isSignUp ? C.goldLight : C.muted,
                fontSize: 14,
                fontWeight: !isSignUp ? 700 : 500,
                cursor: "pointer",
                paddingBottom: 8,
                borderBottom: !isSignUp ? `2px solid ${C.goldLight}` : "none",
                fontFamily: "system-ui",
              }}
            >
              Sign In
            </button>
            <button
              onClick={() => setIsSignUp(true)}
              style={{
                background: "transparent",
                border: "none",
                color: isSignUp ? C.goldLight : C.muted,
                fontSize: 14,
                fontWeight: isSignUp ? 700 : 500,
                cursor: "pointer",
                paddingBottom: 8,
                borderBottom: isSignUp ? `2px solid ${C.goldLight}` : "none",
                fontFamily: "system-ui",
              }}
            >
              Sign Up
            </button>
          </div>

          {/* Email Input */}
          <div style={{ marginBottom: 18 }}>
            <Label>Email</Label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="Enter your email"
              style={inp}
              disabled={loading}
              autoCapitalize="none"
            />
          </div>

          {/* Password Input */}
          <div style={{ marginBottom: isSignUp ? 18 : 8, position: "relative" }}>
            <Label>Password</Label>
            <input
              type={showPass ? "text" : "password"}
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === "Enter" && !isSignUp && handleSignIn()}
              placeholder="Enter password"
              style={{ ...inp, paddingRight: 48 }}
              disabled={loading}
            />
            <span
              onClick={() => setShowPass(!showPass)}
              style={{
                position: "absolute",
                right: 16,
                top: 40,
                cursor: "pointer",
                color: C.muted,
                fontSize: 18,
                userSelect: "none",
              }}
            >
              {showPass ? "🙈" : "👁"}
            </span>
          </div>

          {/* Confirm Password Input (Sign Up only) */}
          {isSignUp && (
            <div style={{ marginBottom: 18, position: "relative" }}>
              <Label>Confirm Password</Label>
              <input
                type={showPass ? "text" : "password"}
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                placeholder="Confirm password"
                style={{ ...inp, paddingRight: 48 }}
                disabled={loading}
              />
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div style={{ background: "#2a0e0e", border: `1px solid ${C.danger}`, borderRadius: 8, padding: "10px 12px", marginBottom: 12, color: C.danger, fontSize: 12, fontFamily: "system-ui" }}>
              ⚠ {error}
            </div>
          )}

          {/* Submit Button */}
          <button
            onClick={isSignUp ? handleSignUp : handleSignIn}
            disabled={loading}
            style={{
              ...btnGold,
              width: "100%",
              marginTop: 12,
              fontSize: 16,
              padding: "16px",
              opacity: loading ? 0.6 : 1,
              cursor: loading ? "not-allowed" : "pointer",
            }}
          >
            {loading ? "Loading..." : isSignUp ? "Sign Up →" : "Sign In →"}
          </button>
        </Card>
      </div>
    </div>
  );
}

// ── CALENDAR VIEW ──
function CalendarView({ bookings }) {
  const today = new Date();
  const [viewDate, setViewDate] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [mode, setMode] = useState("month"); // "month" | "week"
  const [selected, setSelected] = useState(null);

  const getBookingsForDate = (dateStr) => bookings.filter(b => b.date === dateStr || b.returnDate === dateStr);
  const dateHasEvent = (dateStr) => getBookingsForDate(dateStr).some(isEvent);
  const toStr = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;

  // Monthly
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  // Weekly
  const getWeekStart = (d) => { const s = new Date(d); s.setDate(s.getDate() - s.getDay()); return s; };
  const [weekStart, setWeekStart] = useState(getWeekStart(today));
  const weekDays = Array.from({ length: 7 }, (_, i) => { const d = new Date(weekStart); d.setDate(d.getDate() + i); return d; });

  const prevMonth = () => setViewDate(new Date(year, month - 1, 1));
  const nextMonth = () => setViewDate(new Date(year, month + 1, 1));
  const prevWeek = () => setWeekStart(d => { const n = new Date(d); n.setDate(n.getDate()-7); return n; });
  const nextWeek = () => setWeekStart(d => { const n = new Date(d); n.setDate(n.getDate()+7); return n; });

  const todayStr = toStr(today);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: "0 0 2px", fontWeight: 400, fontSize: 22, color: C.goldLight }}>Calendar</h2>
          <div style={{ color: C.muted, fontSize: 13, fontFamily: "system-ui", display: "flex", alignItems: "center", gap: 6 }}>
            {bookings.length} bookings
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, marginLeft: 6, color: "#ff9797" }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: CRITICAL, display: "inline-block" }} /> = Event
            </span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setMode("month")} style={{ ...btnGhost, padding: "8px 14px", fontSize: 13, background: mode === "month" ? `linear-gradient(135deg, ${C.gold}, ${C.goldLight})` : "transparent", color: mode === "month" ? "#0d0f0e" : C.muted, border: `1px solid ${mode === "month" ? "transparent" : C.border}` }}>Month</button>
          <button onClick={() => setMode("week")} style={{ ...btnGhost, padding: "8px 14px", fontSize: 13, background: mode === "week" ? `linear-gradient(135deg, ${C.gold}, ${C.goldLight})` : "transparent", color: mode === "week" ? "#0d0f0e" : C.muted, border: `1px solid ${mode === "week" ? "transparent" : C.border}` }}>Week</button>
        </div>
      </div>

      {mode === "month" && (
        <Card style={{ padding: 16 }}>
          {/* Month nav */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <button onClick={prevMonth} style={{ ...btnGhost, padding: "8px 16px", fontSize: 18 }}>‹</button>
            <div style={{ fontWeight: 700, fontSize: 17, color: C.goldLight, fontFamily: "system-ui" }}>{MONTHS[month]} {year}</div>
            <button onClick={nextMonth} style={{ ...btnGhost, padding: "8px 16px", fontSize: 18 }}>›</button>
          </div>
          {/* Day headers */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2, marginBottom: 4 }}>
            {DAYS.map(d => <div key={d} style={{ textAlign: "center", fontSize: 10, color: C.muted, fontFamily: "system-ui", fontWeight: 700, padding: "4px 0" }}>{d}</div>)}
          </div>
          {/* Cells */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 3 }}>
            {cells.map((day, i) => {
              if (!day) return <div key={i} />;
              const dateStr = `${year}-${String(month+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
              const dayBookings = getBookingsForDate(dateStr);
              const hasEvent = dateHasEvent(dateStr);
              const isToday = dateStr === todayStr;
              const isSelected = selected === dateStr;
              // Events always win the cell's color, even over "today" / "selected",
              // so a critical date is never visually swallowed by another state.
              const cellBg = hasEvent ? "#3a1216" : isSelected ? C.gold : isToday ? C.green : dayBookings.length ? "#1a2a1a" : "transparent";
              const cellBorder = hasEvent ? CRITICAL : isSelected ? C.goldLight : isToday ? C.gold : dayBookings.length ? C.border : "transparent";
              return (
                <div key={i} onClick={() => setSelected(isSelected ? null : dateStr)} style={{ background: cellBg, border: `1px solid ${cellBorder}`, borderRadius: 8, padding: "6px 4px", textAlign: "center", cursor: dayBookings.length ? "pointer" : "default", minHeight: 44, boxShadow: hasEvent ? `0 0 0 1px ${CRITICAL}` : "none" }}>
                  <div style={{ fontSize: 13, fontWeight: isToday || hasEvent ? 800 : 400, color: hasEvent ? "#ff9797" : isSelected ? "#0d0f0e" : isToday ? C.goldLight : C.text, fontFamily: "system-ui" }}>{day}</div>
                  {dayBookings.length > 0 && <div style={{ fontSize: 9, background: hasEvent ? CRITICAL : isSelected ? "#0d0f0e" : C.gold, color: hasEvent ? "#fff" : isSelected ? C.goldLight : "#0d0f0e", borderRadius: 10, padding: "1px 4px", marginTop: 2, fontFamily: "system-ui", fontWeight: 700 }}>{hasEvent ? "🎉" : dayBookings.length}</div>}
                </div>
              );
            })}
          </div>

          {/* Selected day bookings */}
          {selected && getBookingsForDate(selected).length > 0 && (
            <div style={{ marginTop: 16, borderTop: `1px solid ${C.border}`, paddingTop: 16 }}>
              <div style={{ fontSize: 12, color: C.goldLight, fontWeight: 700, textTransform: "uppercase", fontFamily: "system-ui", marginBottom: 10 }}>
                {selected} — {getBookingsForDate(selected).length} booking(s)
              </div>
              {getBookingsForDate(selected).map(b => (
                <div key={b.id} style={{ background: isEvent(b) ? "#2a0e10" : C.surface, borderRadius: 10, padding: "12px 14px", marginBottom: 8, border: `1px solid ${isEvent(b) ? CRITICAL : C.border}` }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{b.customer}</div>
                      <div style={{ color: C.muted, fontSize: 12, fontFamily: "system-ui" }}>{b.event}</div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
                      <BookingTypeBadge type={b.booking_type} />
                      <StatusBadge status={b.status} />
                    </div>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, alignItems: "center" }}>
                    <span style={{ color: C.muted, fontSize: 12, fontFamily: "system-ui" }}>{b.date} → {b.returnDate}</span>
                    <span style={{ fontWeight: 700, color: getBalanceDue(b) <= 0 ? C.success : C.orange, fontFamily: "system-ui" }}>{fmt(b.total)}</span>
                  </div>
                  {getBalanceDue(b) > 0 && Number(b.advance) > 0 && (
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
                      <span style={{ color: C.muted, fontSize: 11, fontFamily: "system-ui" }}>Balance due</span>
                      <span style={{ color: C.orange, fontSize: 12, fontWeight: 700, fontFamily: "system-ui" }}>{fmt(getBalanceDue(b))}</span>
                    </div>
                  )}
                  <button onClick={() => sendWhatsAppInvoice(b)} style={{ ...btnGold, width: "100%", marginTop: 10, padding: "10px", fontSize: 13, background: "#25D366" }}>
                    📲 Send WhatsApp Invoice
                  </button>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {mode === "week" && (
        <Card style={{ padding: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <button onClick={prevWeek} style={{ ...btnGhost, padding: "8px 16px", fontSize: 18 }}>‹</button>
            <div style={{ fontWeight: 700, fontSize: 15, color: C.goldLight, fontFamily: "system-ui", textAlign: "center" }}>
              {weekDays[0].getDate()} {MONTHS[weekDays[0].getMonth()].slice(0,3)} — {weekDays[6].getDate()} {MONTHS[weekDays[6].getMonth()].slice(0,3)} {weekDays[6].getFullYear()}
            </div>
            <button onClick={nextWeek} style={{ ...btnGhost, padding: "8px 16px", fontSize: 18 }}>›</button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {weekDays.map(day => {
              const dateStr = toStr(day);
              const dayBookings = getBookingsForDate(dateStr);
              const hasEvent = dateHasEvent(dateStr);
              const isToday = dateStr === todayStr;
              return (
                <div key={dateStr} style={{ background: hasEvent ? "#2a0e10" : isToday ? C.green : C.surface, border: `1px solid ${hasEvent ? CRITICAL : isToday ? C.gold : C.border}`, borderRadius: 12, padding: "12px 14px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: dayBookings.length ? 10 : 0 }}>
                    <div style={{ fontFamily: "system-ui" }}>
                      <span style={{ fontWeight: 700, color: hasEvent ? "#ff9797" : isToday ? C.goldLight : C.text, fontSize: 15 }}>{DAYS[day.getDay()]}</span>
                      <span style={{ color: C.muted, fontSize: 13, marginLeft: 8 }}>{day.getDate()} {MONTHS[day.getMonth()].slice(0,3)}</span>
                    </div>
                    {dayBookings.length > 0 && <span style={{ background: hasEvent ? CRITICAL : C.gold, color: hasEvent ? "#fff" : "#0d0f0e", borderRadius: 20, padding: "2px 10px", fontSize: 11, fontWeight: 800, fontFamily: "system-ui" }}>{hasEvent ? "🎉 " : ""}{dayBookings.length} booking{dayBookings.length > 1 ? "s" : ""}</span>}
                  </div>
                  {dayBookings.map(b => (
                    <div key={b.id} style={{ background: C.card, borderRadius: 10, padding: "10px 12px", marginBottom: 6, border: `1px solid ${isEvent(b) ? CRITICAL : C.border}` }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 14 }}>{b.customer}</div>
                          <div style={{ color: C.muted, fontSize: 12, fontFamily: "system-ui" }}>{b.event}</div>
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
                          <BookingTypeBadge type={b.booking_type} />
                          <StatusBadge status={b.status} />
                        </div>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontWeight: 700, color: getBalanceDue(b) <= 0 ? C.success : C.orange, fontFamily: "system-ui" }}>{fmt(b.total)}</span>
                        <button onClick={() => sendWhatsAppInvoice(b)} style={{ background: "#25D366", color: "#fff", border: "none", borderRadius: 8, padding: "6px 14px", fontWeight: 700, cursor: "pointer", fontSize: 12, fontFamily: "system-ui" }}>
                          📲 WhatsApp
                        </button>
                      </div>
                    </div>
                  ))}
                  {dayBookings.length === 0 && <div style={{ color: C.muted, fontSize: 12, fontFamily: "system-ui" }}>No bookings</div>}
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}

const emptyQuickAdd = { code: "", name: "", category: "", total: "1", pricePerDay: "" };

export default function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [tab, setTab] = useState("dashboard");
  const [inventory, setInventory] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [selectedBooking, setSelectedBooking] = useState(null);
  // null = closed, {} = add, {item} = edit
  const [inventoryModal, setInventoryModal] = useState(null);
  const [inventorySearch, setInventorySearch] = useState("");
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfReady, setPdfReady] = useState(null); // { url, filename, file } — mobile "PDF ready" sheet
  const [collectionMonth, setCollectionMonth] = useState(new Date().toISOString().slice(0, 7)); // "YYYY-MM"
  const [showAddBooking, setShowAddBooking] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState("All");
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [saving, setSaving] = useState(false);
  const [newBooking, setNewBooking] = useState({ bookingType: "rent_out", customer: "", event: "", date: "", returnDate: "", phone: "", email: "", discount: "", manualSubtotal: "", advance: "", paid: false, status: "Upcoming", notes: "", items: [{ name: "", qty: 1, price: "" }] });

  // Errors shown inside specific modals
  const [bookingError, setBookingError] = useState("");
  // General error for quick actions taken outside a modal (mark paid, status change, delete)
  const [actionError, setActionError] = useState("");
  // Set to a booking's id while editing that booking; null means the modal is in "new booking" mode
  const [editingBookingId, setEditingBookingId] = useState(null);

  // Inline "add to inventory" flow launched from inside the booking form
  const [quickAddRow, setQuickAddRow] = useState(null); // index of the item row that triggered this, or null
  const [quickAddForm, setQuickAddForm] = useState(emptyQuickAdd);
  const [quickAddError, setQuickAddError] = useState("");
  const [quickAddSaving, setQuickAddSaving] = useState(false);

  // Export tab: what to export, what range, and status/errors for the export action
  const [exportType, setExportType] = useState("both"); // "both" | "bookings" | "inventory"
  const [exportRange, setExportRange] = useState("all"); // "all" | "month" | "date"
  const todayStr = new Date().toISOString().slice(0, 10);
  const [exportMonth, setExportMonth] = useState(todayStr.slice(0, 7)); // "YYYY-MM"
  const [exportDate, setExportDate] = useState(todayStr); // "YYYY-MM-DD"
  const [exportError, setExportError] = useState("");
  const [exportMsg, setExportMsg] = useState("");
  const [exporting, setExporting] = useState(false);

  // Follow-up tab: last year's events for a chosen month, so staff can call
  // clients about their yearly repeat orders before the date comes back around.
  const [followUpMonth, setFollowUpMonth] = useState(String(new Date().getMonth() + 1).padStart(2, "0")); // "01".."12"
  const [followUpEvents, setFollowUpEvents] = useState([]);
  const [followUpLoading, setFollowUpLoading] = useState(false);
  const [followUpError, setFollowUpError] = useState("");

  // Check for existing Supabase session on mount
  useEffect(() => {
    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        setCurrentUser(session.user);
      }
      setLoading(false);
    };
    
    checkSession();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session?.user) {
        setCurrentUser(session.user);
      } else {
        setCurrentUser(null);
      }
    });

    return () => subscription?.unsubscribe();
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setCurrentUser(null);
    setInventory([]);
    setBookings([]);
  };

  const fetchData = async () => {
    setLoading(true);
    setLoadError("");
    try {
      const [inv, bks] = await Promise.all([api("inventory", "GET", null, "?order=name.asc"), api("bookings", "GET", null, "?order=date.desc")]);
      setInventory(inv || []); setBookings(bks || []);
    } catch (e) {
      console.error(e);
      setLoadError(e.message || "Failed to load data from the server.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (currentUser) fetchData(); }, [currentUser]);

  // Follow-up query: last year's events for the selected month, fetched
  // straight from Supabase filtered by booking_type + date range (see the
  // matching v_followup_last_year_events view in the SQL migration for the
  // same query, usable directly from the Supabase SQL editor/reports).
  const fetchFollowUpEvents = async (monthStr) => {
    setFollowUpLoading(true);
    setFollowUpError("");
    try {
      const now = new Date();
      const lastYear = now.getFullYear() - 1;
      const monthNum = Number(monthStr);
      const start = `${lastYear}-${monthStr}-01`;
      const lastDay = new Date(lastYear, monthNum, 0).getDate(); // day 0 of next month = last day of this month
      const end = `${lastYear}-${monthStr}-${String(lastDay).padStart(2, "0")}`;
      const rows = await api(
        "bookings",
        "GET",
        null,
        `?booking_type=eq.event&date=gte.${start}&date=lte.${end}&order=date.asc`
      );
      setFollowUpEvents(rows || []);
    } catch (e) {
      console.error(e);
      setFollowUpError(e.message || "Failed to load last year's events.");
    } finally {
      setFollowUpLoading(false);
    }
  };

  useEffect(() => {
    if (currentUser && tab === "followup") fetchFollowUpEvents(followUpMonth);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser, tab, followUpMonth]);

  if (!currentUser) return <LoginScreen onLogin={setCurrentUser} />;

  // PDF invoice. Desktop: downloads straight away. Mobile browsers often block downloads that
  // start after async work (they need a fresh tap), so on phones/tablets we show a "PDF ready"
  // sheet with Share / Download / Open buttons — each is a real tap, which always works.
  const handleDownloadPdf = async (booking) => {
    if (pdfBusy) return;
    setPdfBusy(true);
    try {
      const balance = Math.max(0, (Number(booking.total) || 0) - Number(booking.advance || 0));
      const { blob, filename } = await buildInvoicePdf(booking, { link: buildUpiLink(balance, `Invoice ${booking.id}`), id: UPI_ID });
      // Installed Android app (Capacitor): WebViews can't download blobs, so save + share natively.
      // If this APK was built before the plugins were added, fall through to the web sheet below.
      if (isNativeApp()) {
        try { await saveAndSharePdfNative(blob, filename); return; }
        catch (e) { console.warn("Native PDF share failed, using web fallback", e); }
      }
      const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform));
      if (!isMobile) { triggerDownload(blob, filename); return; }
      setPdfReady({ url: URL.createObjectURL(blob), filename, file: new File([blob], filename, { type: "application/pdf" }) });
    } catch (err) {
      console.error(err);
      setActionError("Could not generate the PDF: " + (err.message || "unknown error"));
    } finally {
      setPdfBusy(false);
    }
  };
  const closePdfReady = () => { if (pdfReady) URL.revokeObjectURL(pdfReady.url); setPdfReady(null); };
  const sharePdf = async () => {
    try { await navigator.share({ files: [pdfReady.file], title: pdfReady.filename }); }
    catch (e) { if (e?.name !== "AbortError") console.error(e); }
  };
  const canSharePdf = !!(pdfReady && navigator.canShare && navigator.canShare({ files: [pdfReady.file] }));

  // View-only demo account: write controls are hidden AND every write function
  // below refuses to run (two independent layers).
  const isDemoUser = currentUser.email?.toLowerCase() === DEMO_EMAIL;
  const DEMO_MSG = "This is a view-only demo account — adding, editing and deleting is disabled.";

  const canViewCollections = COLLECTION_VIEWERS.includes(String(currentUser.email || "").toLowerCase());
  const monthBookings = bookings.filter(b => b.date && b.date.slice(0, 7) === collectionMonth);
  const totalRevenue = bookings.reduce((s, b) => s + bookingCollected(b), 0);
  const pendingPayments = bookings.reduce((s, b) => s + bookingPending(b), 0);
  const monthRevenue = monthBookings.reduce((s, b) => s + bookingCollected(b), 0);
  const monthPending = monthBookings.reduce((s, b) => s + bookingPending(b), 0);
  const activeBookings = bookings.filter(b => b.status === "Active").length;
  const availableItems = inventory.reduce((s, i) => s + (i.total - i.rented), 0);

  // Dashboard highlight: all Events booked for the current calendar month,
  // filtered by booking_type and this-month's date, soonest first.
  const currentMonthKey = new Date().toISOString().slice(0, 7); // "YYYY-MM"
  const upcomingEventsThisMonth = bookings
    .filter(b => isEvent(b) && b.date && b.date.slice(0, 7) === currentMonthKey)
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""));

  const filteredBookings = bookings.filter(b => {
    const matchSearch = b.customer?.toLowerCase().includes(searchTerm.toLowerCase()) || b.event?.toLowerCase().includes(searchTerm.toLowerCase()) || b.id?.includes(searchTerm);
    return matchSearch && (filterStatus === "All" || b.status === filterStatus);
  });

  // Shared helper: sum of qty*price across a booking-form items array
  const computeItemsSubtotal = (items) => items.reduce((s, it) => s + Number(it.qty || 0) * Number(it.price || 0), 0);

  const addItemRow = () => setNewBooking(p => { return { ...p, items: [...p.items, { name: "", qty: 1, price: "" }] }; });
  const removeItemRow = i => setNewBooking(p => { return { ...p, items: p.items.filter((_, idx) => idx !== i) }; });
  const updateItemRow = (i, field, val) => setNewBooking(p => { const items = [...p.items]; items[i] = { ...items[i], [field]: val }; return { ...p, items }; });
  // Selecting an item from inventory also auto-fills its per-day rate (still editable by staff)
  const selectItemRow = (i, name) => setNewBooking(p => {
    const items = [...p.items];
    const inv = inventory.find(x => x.name.toLowerCase() === name.toLowerCase());
    items[i] = { ...items[i], name, ...(inv ? { price: inv.pricePerDay } : {}) };
    return { ...p, items };
  });

  const emptyBookingForm = { bookingType: "rent_out", customer: "", event: "", date: "", returnDate: "", phone: "", email: "", discount: "", manualSubtotal: "", advance: "", paid: false, status: "Upcoming", notes: "", items: [{ name: "", qty: 1, price: "" }] };

  const openNewBooking = () => {
    if (isDemoUser) { setActionError(DEMO_MSG); return; }
    setBookingError("");
    setEditingBookingId(null);
    setNewBooking(emptyBookingForm);
    setShowAddBooking(true);
  };

  const openEditBooking = (b) => {
    if (isDemoUser) { setActionError(DEMO_MSG); return; }
    setBookingError("");
    setEditingBookingId(b.id);
    const items = Array.isArray(b.items) && b.items.length ? b.items.map(i => ({ name: i.name, qty: i.qty, price: i.price ?? "" })) : [{ name: "", qty: 1, price: "" }];
    // Rebuild Subtotal / Discount from what was saved. Bookings made before the
    // Discount field existed only have `total`, so any gap below the items
    // subtotal is shown as a discount (the final total stays exactly as saved).
    const savedTotal = Number(b.total) || 0;
    const itemsSub = computeItemsSubtotal(items);
    let discountForForm = b.discount != null && b.discount !== "" ? Number(b.discount) || 0 : Math.max(0, itemsSub - savedTotal);
    let manualSubtotal = "";
    if (itemsSub === 0) manualSubtotal = savedTotal + discountForForm > 0 ? String(savedTotal + discountForForm) : "";
    else if (b.discount == null && savedTotal > itemsSub) { manualSubtotal = String(savedTotal); discountForForm = 0; }
    setNewBooking({
      bookingType: b.booking_type === "event" ? "event" : "rent_out",
      customer: b.customer || "",
      event: b.event || "",
      date: b.date || "",
      returnDate: b.returnDate || "",
      phone: b.phone || "",
      email: b.email || "",
      discount: discountForForm ? String(discountForForm) : "",
      manualSubtotal,
      advance: b.advance ?? "",
      paid: !!b.paid,
      status: b.status || "Upcoming",
      notes: b.notes || "",
      items,
    });
    setShowAddBooking(true);
  };

  const closeBookingModal = () => {
    setShowAddBooking(false);
    setEditingBookingId(null);
  };

  const handleSaveBooking = async () => {
    if (isDemoUser) { setBookingError(DEMO_MSG); return; }
    if (!newBooking.customer || !newBooking.event || !newBooking.date) return;
    setSaving(true);
    setBookingError("");
    try {
      // Total Amount = Subtotal (all items) - Discount, computed fresh at save time.
      const totals = formTotals(newBooking);
      const resolvedTotal = totals.finalTotal;
      const resolvedAdvance = Math.max(0, Math.min(Number(newBooking.advance) || 0, resolvedTotal));
      const payload = {
        booking_type: newBooking.bookingType === "event" ? "event" : "rent_out",
        customer: newBooking.customer,
        event: newBooking.event,
        date: newBooking.date,
        returnDate: newBooking.returnDate,
        phone: newBooking.phone,
        email: newBooking.email,
        items: newBooking.items.filter(i => i.name),
        total: resolvedTotal,
        discount: totals.discount,
        advance: resolvedAdvance,
        status: newBooking.status,
        paid: newBooking.paid,
        notes: newBooking.notes,
      };
      if (editingBookingId) {
        await api("bookings", "PATCH", payload, `?id=eq.${editingBookingId}`);
        if (selectedBooking?.id === editingBookingId) setSelectedBooking(p => ({ ...p, ...payload }));
      } else {
        const nextIdNumber = bookings.reduce((max, b) => {
          const match = /^RL-(\d+)$/.exec(b.id);
          return match ? Math.max(max, parseInt(match[1], 10)) : max;
        }, 0) + 1;
        const id = `RL-${String(nextIdNumber).padStart(3, "0")}`;
        await api("bookings", "POST", { id, ...payload });
      }
      await fetchData();
      setNewBooking(emptyBookingForm);
      setEditingBookingId(null);
      setShowAddBooking(false);
    } catch (err) {
      console.error(err);
      setBookingError(/discount/i.test(err.message || "")
        ? "The database is missing the 'discount' column. Run supabase/discount_migration.sql in the Supabase SQL editor, then try again."
        : (err.message || "Could not save this booking. Please try again."));
    } finally {
      setSaving(false);
    }
  };

  // Add or edit an inventory item. Throws on failure so the modal can show the error.
  const saveInventoryItem = async (payload) => {
    if (isDemoUser) throw new Error(DEMO_MSG);
    const editingItem = inventoryModal?.item;
    const err = validateCode(payload.code, inventory, editingItem?.id ?? null);
    if (err) throw new Error(err);
    if (editingItem) {
      await api("inventory", "PATCH", payload, `?id=eq.${editingItem.id}`);
    } else {
      await api("inventory", "POST", { ...payload, rented: 0 });
    }
    await fetchData();
    setInventoryModal(null);
  };

  // ---- Quick-add-to-inventory flow, launched from the item picker inside the booking form ----
  const openQuickAdd = (rowIndex, name) => {
    if (isDemoUser) { setBookingError(DEMO_MSG); return; }
    setQuickAddRow(rowIndex);
    setQuickAddForm({ ...emptyQuickAdd, name, code: nextCode(inventory) });
    setQuickAddError("");
  };
  const closeQuickAdd = () => { setQuickAddRow(null); setQuickAddForm(emptyQuickAdd); setQuickAddError(""); };

  const handleQuickAddSave = async () => {
    if (isDemoUser) { setQuickAddError(DEMO_MSG); return; }
    if (!quickAddForm.name.trim() || !quickAddForm.category.trim() || !quickAddForm.total) {
      setQuickAddError("Code, name, category, and total quantity are required.");
      return;
    }
    const codeErr = validateCode(quickAddForm.code, inventory);
    if (codeErr) { setQuickAddError(codeErr); return; }
    setQuickAddSaving(true);
    setQuickAddError("");
    try {
      const created = await api("inventory", "POST", {
        code: normalizeCode(quickAddForm.code),
        name: quickAddForm.name.trim(),
        category: quickAddForm.category.trim(),
        total: Number(quickAddForm.total),
        pricePerDay: Number(quickAddForm.pricePerDay) || 0,
        rented: 0,
      });
      const createdItem = Array.isArray(created) ? created[0] : created;
      await fetchData();
      if (quickAddRow !== null) updateItemRow(quickAddRow, "name", createdItem?.name || quickAddForm.name.trim());
      closeQuickAdd();
    } catch (err) {
      console.error(err);
      setQuickAddError(isDuplicateError(err) ? `Code "${normalizeCode(quickAddForm.code)}" already exists. Codes must be unique.` : (err.message || "Could not add this item. Please try again."));
    } finally {
      setQuickAddSaving(false);
    }
  };

  const markPaid = async id => {
    if (isDemoUser) { setActionError(DEMO_MSG); return; }
    setActionError("");
    try {
      const b = bookings.find(x => x.id === id);
      // Marking as fully settled also brings the advance up to the full total,
      // so the balance-due figure stays consistent everywhere.
      await api("bookings", "PATCH", { paid: true, advance: Number(b?.total || 0) }, `?id=eq.${id}`);
      setBookings(p => p.map(x => x.id === id ? { ...x, paid: true, advance: Number(x.total || 0) } : x));
      if (selectedBooking?.id === id) setSelectedBooking(p => ({ ...p, paid: true, advance: Number(p.total || 0) }));
    } catch (err) {
      console.error(err);
      setActionError(err.message || "Could not update payment status.");
    }
  };

  // Reserves (direction=1) or releases (direction=-1) a booking's items against
  // inventory's "rented" counts, keeping the Inventory tab's availability figures
  // accurate as bookings move through their lifecycle.
  const adjustInventoryForBooking = async (booking, direction) => {
    const items = Array.isArray(booking.items) ? booking.items : [];
    for (const it of items) {
      const invItem = inventory.find(x => x.name.toLowerCase() === (it.name || "").toLowerCase());
      if (!invItem) continue;
      const qty = Number(it.qty) || 0;
      if (!qty) continue;
      const newRented = Math.max(0, Number(invItem.rented || 0) + direction * qty);
      try {
        await api("inventory", "PATCH", { rented: newRented }, `?id=eq.${invItem.id}`);
        setInventory(p => p.map(x => x.id === invItem.id ? { ...x, rented: newRented } : x));
      } catch (err) {
        console.error(err);
        setActionError(err.message || "Could not update inventory availability.");
      }
    }
  };

  const updateStatus = async (id, status) => {
    if (isDemoUser) { setActionError(DEMO_MSG); return; }
    setActionError("");
    try {
      const booking = bookings.find(b => b.id === id);
      await api("bookings", "PATCH", { status }, `?id=eq.${id}`);
      setBookings(p => p.map(b => b.id === id ? { ...b, status } : b));
      if (selectedBooking?.id === id) setSelectedBooking(p => ({ ...p, status }));
      // Moving into Active reserves the booked items out of inventory; moving into
      // Completed releases them back so they show up as available again.
      if (booking && booking.status !== status) {
        if (status === "Active") await adjustInventoryForBooking(booking, 1);
        else if (status === "Completed") await adjustInventoryForBooking(booking, -1);
      }
    } catch (err) {
      console.error(err);
      setActionError(err.message || "Could not update booking status.");
    }
  };

  const handleConfirmDelete = async () => {
    if (isDemoUser) { setActionError(DEMO_MSG); setConfirmDelete(null); return; }
    if (!confirmDelete) return;
    setSaving(true);
    setActionError("");
    try {
      if (confirmDelete.type === "booking") {
        await api("bookings", "DELETE", null, `?id=eq.${confirmDelete.id}`);
        setBookings(p => p.filter(b => b.id !== confirmDelete.id));
        if (selectedBooking?.id === confirmDelete.id) setSelectedBooking(null);
      } else {
        await api("inventory", "DELETE", null, `?id=eq.${confirmDelete.id}`);
        setInventory(p => p.filter(i => i.id !== confirmDelete.id));
      }
      setConfirmDelete(null);
    } catch (err) {
      console.error(err);
      setActionError(err.message || "Could not delete. Please try again.");
      setConfirmDelete(null);
    } finally {
      setSaving(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Export: builds an .xlsx workbook (SheetJS) from bookings/inventory, filtered
  // by "All Time" / a chosen month / a specific date, and downloads it.
  // ---------------------------------------------------------------------------
  const handleExport = () => {
    setExportError("");
    setExportMsg("");

    const includeBookings = exportType === "bookings" || exportType === "both";
    const includeInventory = exportType === "inventory" || exportType === "both";

    // Bookings always carry a date, so the filter applies strictly.
    const bookingInRange = (b) => {
      if (exportRange === "all") return true;
      if (!b.date) return false;
      if (exportRange === "month") return b.date.slice(0, 7) === exportMonth;
      if (exportRange === "date") return b.date === exportDate;
      return true;
    };

    // Inventory is a live stock count, not inherently date-bound. If an item
    // has a created_at (Supabase adds this by default), use it for filtering;
    // otherwise keep the item in the export regardless of range so results
    // are never unexpectedly empty.
    const inventoryInRange = (item) => {
      if (exportRange === "all") return true;
      const addedOn = item.created_at ? String(item.created_at).slice(0, 10) : null;
      if (!addedOn) return true;
      if (exportRange === "month") return addedOn.slice(0, 7) === exportMonth;
      if (exportRange === "date") return addedOn === exportDate;
      return true;
    };

    try {
      const wb = XLSX.utils.book_new();

      if (includeBookings) {
        const rows = bookings.filter(bookingInRange).map(b => ({
          "Booking ID": b.id,
          "Booking Type": isEvent(b) ? "Event" : "Rent Out",
          "Customer": b.customer,
          "Event": b.event,
          "Phone": b.phone || "",
          "Email": b.email || "",
          "Booking Date": b.date || "",
          "Return Date": b.returnDate || "",
          "Status": b.status,
          "Subtotal (₹)": (Number(b.total) || 0) + (Number(b.discount) || 0),
          "Discount (₹)": Number(b.discount) || 0,
          "Total (₹)": Number(b.total) || 0,
          "Advance Paid (₹)": Number(b.advance) || 0,
          "Balance Due (₹)": getBalanceDue(b),
          "Fully Paid": b.paid ? "Yes" : "No",
          "Items": Array.isArray(b.items) ? b.items.map(it => `${it.name} x${it.qty}`).join(", ") : "",
          "Notes": b.notes || "",
        }));
        const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ "Note": "No bookings found for the selected range" }]);
        XLSX.utils.book_append_sheet(wb, ws, "Bookings");
      }

      if (includeInventory) {
        const rows = inventory.filter(inventoryInRange).map(item => ({
          "Code": item.code || "",
          "Item Name": item.name,
          "Category": item.category,
          "Total Qty": item.total,
          "Rented Out": item.rented,
          "Available": Number(item.total || 0) - Number(item.rented || 0),
          "Price / Day (₹)": Number(item.pricePerDay) || 0,
          "Added On": item.created_at ? String(item.created_at).slice(0, 10) : "—",
        }));
        const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ "Note": "No inventory found for the selected range" }]);
        XLSX.utils.book_append_sheet(wb, ws, "Inventory");
      }

      const rangeLabel = exportRange === "all" ? "All" : exportRange === "month" ? exportMonth : exportDate;
      const typeLabel = exportType === "both" ? "Bookings_Inventory" : exportType === "bookings" ? "Bookings" : "Inventory";
      const filename = `RareLuxe_${typeLabel}_${rangeLabel}.xlsx`;

      setExporting(true);
      XLSX.writeFile(wb, filename);
      setExportMsg(`Downloaded ${filename}`);
    } catch (err) {
      console.error(err);
      setExportError(err.message || "Export failed. Please try again.");
    } finally {
      setExporting(false);
    }
  };

  const TABS = [
    { key: "dashboard", label: "Home", icon: "◈" },
    { key: "bookings", label: "Bookings", icon: "◉" },
    { key: "calendar", label: "Calendar", icon: "📅" },
    { key: "followup", label: "Follow-up", icon: "☎" },
    { key: "inventory", label: "Inventory", icon: "◎" },
    { key: "customers", label: "Clients", icon: "◇" },
    { key: "export", label: "Export", icon: "⬇" },
  ];

  return (
    <div style={{ background: C.bg, minHeight: "100dvh", color: C.text, fontFamily: "'Georgia', serif" }}>
      {confirmDelete && <ConfirmModal message={`Delete "${confirmDelete.label}"?`} onConfirm={handleConfirmDelete} onCancel={() => setConfirmDelete(null)} />}

      {/* Header */}
      <div style={{ background: C.surface, borderBottom: `1px solid ${C.border}`, position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 22, color: C.goldLight }}>◈</span>
            <div>
              <div style={{ fontWeight: 800, fontSize: 15, letterSpacing: "0.1em", color: C.goldLight, textTransform: "uppercase" }}>Rare Luxe</div>
              <div style={{ fontSize: 9, color: C.muted, letterSpacing: "0.14em", textTransform: "uppercase", fontFamily: "system-ui" }}>Premium Rentals</div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 12, color: C.goldLight, fontFamily: "system-ui", fontWeight: 700 }}>{currentUser.email?.split('@')[0]}</div>
              <div style={{ fontSize: 9, color: isDemoUser ? C.orange : C.muted, fontFamily: "system-ui", fontWeight: isDemoUser ? 800 : 400 }}>{isDemoUser ? "DEMO · VIEW ONLY" : "ACTIVE"}</div>
            </div>
            <button onClick={handleLogout} style={{ background: "transparent", color: C.danger, border: `1px solid ${C.danger}`, borderRadius: 8, padding: "6px 12px", fontWeight: 700, cursor: "pointer", fontSize: 12, fontFamily: "system-ui" }}>Out</button>
          </div>
        </div>
        <div style={{ display: "flex", overflowX: "auto", scrollbarWidth: "none", WebkitOverflowScrolling: "touch", padding: "0 12px 12px", gap: 8 }}>
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)} style={{ background: tab === t.key ? `linear-gradient(135deg, ${C.gold}, ${C.goldLight})` : C.card, color: tab === t.key ? "#0d0f0e" : C.muted, border: `1px solid ${tab === t.key ? "transparent" : C.border}`, borderRadius: 10, padding: "8px 16px", fontWeight: tab === t.key ? 800 : 500, cursor: "pointer", fontSize: 13, textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: "system-ui", whiteSpace: "nowrap", flexShrink: 0 }}>{t.icon} {t.label}</button>
          ))}
        </div>
      </div>

      {pdfReady && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 500, display: "flex", alignItems: "flex-end", justifyContent: "center", padding: 16 }}>
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 20, padding: 24, width: "100%", maxWidth: 480 }}>
            <div style={{ fontSize: 18, color: C.goldLight, marginBottom: 6 }}>📄 Invoice PDF ready</div>
            <div style={{ fontSize: 12, color: C.muted, fontFamily: "system-ui", marginBottom: 18, wordBreak: "break-all" }}>{pdfReady.filename}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {canSharePdf && <button onClick={sharePdf} style={{ ...btnGold, width: "100%" }}>📤 Share / Save to Files</button>}
              <a href={pdfReady.url} download={pdfReady.filename} style={{ ...btnGold, width: "100%", boxSizing: "border-box", textAlign: "center", textDecoration: "none", display: "block" }}>⬇️ Download PDF</a>
              <a href={pdfReady.url} target="_blank" rel="noopener noreferrer" style={{ ...btnGhost, width: "100%", boxSizing: "border-box", textAlign: "center", textDecoration: "none", display: "block", color: C.goldLight, borderColor: C.gold }}>👁 Open PDF</a>
              <button onClick={closePdfReady} style={{ ...btnGhost, width: "100%" }}>Close</button>
            </div>
          </div>
        </div>
      )}
      {isDemoUser && (
        <div style={{ background: "#2a2410", borderBottom: `1px solid ${C.gold}`, color: C.goldLight, fontSize: 12, fontFamily: "system-ui", fontWeight: 700, textAlign: "center", padding: "8px 12px", letterSpacing: "0.04em" }}>
          👁 Demo account — you can view everything, but adding, editing and deleting is turned off.
        </div>
      )}
      <div style={{ padding: "20px 16px", maxWidth: 700, margin: "0 auto" }}>
        {loadError && <ErrorBanner message={loadError} onRetry={fetchData} />}
        {actionError && <ErrorBanner message={actionError} onDismiss={() => setActionError("")} />}

        {loading && <div style={{ textAlign: "center", color: C.muted, padding: 60, fontFamily: "system-ui" }}><div style={{ fontSize: 32, marginBottom: 12 }}>⏳</div>Loading...</div>}

        {/* DASHBOARD */}
        {!loading && tab === "dashboard" && (
          <div>
            <div style={{ marginBottom: 20 }}>
              <h2 style={{ margin: "0 0 4px", fontWeight: 400, fontSize: 22, color: C.goldLight }}>Good day, {currentUser.email?.split('@')[0]} 👋</h2>
              <div style={{ color: C.muted, fontSize: 13, fontFamily: "system-ui" }}>Rare Luxe overview</div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
              {[{ label: "Active", value: activeBookings, icon: "◉", color: C.success }, { label: "Available", value: availableItems, icon: "◎", color: C.info }].map(k => (
                <Card key={k.label} style={{ padding: 16 }}>
                  <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: `linear-gradient(90deg, ${k.color}, transparent)`, borderRadius: "16px 16px 0 0" }} />
                  <div style={{ color: C.muted, fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", fontFamily: "system-ui", marginBottom: 6 }}>{k.label}</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: k.color, fontFamily: "system-ui" }}>{k.value}</div>
                </Card>
              ))}
            </div>

            {/* Collections — visible only to accounts listed in VITE_COLLECTION_VIEWER_EMAILS (Ashna) */}
            {canViewCollections && (
              <Card style={{ marginBottom: 20 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 14 }}>
                  <div style={{ fontWeight: 700, fontSize: 12, color: C.goldLight, letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: "system-ui" }}>Collections</div>
                  <input type="month" value={collectionMonth} onChange={e => e.target.value && setCollectionMonth(e.target.value)} style={{ ...inp, width: "auto", padding: "8px 10px", fontSize: 13 }} />
                </div>
                {[[`${MONTHS[Number(collectionMonth.slice(5, 7)) - 1]} ${collectionMonth.slice(0, 4)}`, monthRevenue, monthPending], ["All Time", totalRevenue, pendingPayments]].map(([label, col, pend]) => (
                  <div key={label} style={{ marginBottom: label === "All Time" ? 0 : 14 }}>
                    <div style={{ color: C.muted, fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", fontFamily: "system-ui", marginBottom: 6 }}>{label}</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: "12px 14px" }}>
                        <div style={{ color: C.muted, fontSize: 10, fontWeight: 700, textTransform: "uppercase", fontFamily: "system-ui" }}>Collected</div>
                        <div style={{ fontSize: 20, fontWeight: 800, color: C.goldLight, fontFamily: "system-ui" }}>{fmt(col)}</div>
                      </div>
                      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: "12px 14px" }}>
                        <div style={{ color: C.muted, fontSize: 10, fontWeight: 700, textTransform: "uppercase", fontFamily: "system-ui" }}>Pending</div>
                        <div style={{ fontSize: 20, fontWeight: 800, color: C.orange, fontFamily: "system-ui" }}>{fmt(pend)}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </Card>
            )}

            {/* Highlighted: Events happening this month — always visible even when the list is empty, so staff know at a glance whether anything critical is coming up */}
            <Card style={{ marginBottom: 16, background: "#2a0e10", border: `1px solid ${CRITICAL}`, boxShadow: `0 0 0 1px ${CRITICAL}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
                <span style={{ fontSize: 16 }}>🎉</span>
                <div style={{ fontWeight: 800, fontSize: 12, color: "#ff9797", letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: "system-ui" }}>
                  Upcoming Events — {MONTHS[new Date().getMonth()]}
                </div>
                {upcomingEventsThisMonth.length > 0 && (
                  <span style={{ background: CRITICAL, color: "#fff", borderRadius: 20, padding: "2px 10px", fontSize: 11, fontWeight: 800, fontFamily: "system-ui", marginLeft: "auto" }}>{upcomingEventsThisMonth.length}</span>
                )}
              </div>
              {upcomingEventsThisMonth.length === 0 && (
                <div style={{ color: "#e0b0b0", fontSize: 13, fontFamily: "system-ui" }}>No events booked for this month.</div>
              )}
              {upcomingEventsThisMonth.map(b => (
                <div key={b.id} onClick={() => { setSelectedBooking(b); setTab("bookings"); }} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 0", borderBottom: `1px solid ${CRITICAL}44`, cursor: "pointer", gap: 10 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 15, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.event}</div>
                    <div style={{ color: "#e0b0b0", fontSize: 12, fontFamily: "system-ui", marginTop: 2 }}>{b.customer} · {b.date}</div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
                    <StatusBadge status={b.status} />
                    <span style={{ fontWeight: 700, color: "#fff", fontFamily: "system-ui", fontSize: 13 }}>{fmt(b.total)}</span>
                  </div>
                </div>
              ))}
            </Card>

            <Card style={{ marginBottom: 16 }}>
              <div style={{ fontWeight: 700, marginBottom: 14, fontSize: 12, color: C.goldLight, letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: "system-ui" }}>Recent Bookings</div>
              {bookings.filter(b => b.status !== "Completed").slice(0, 5).map(b => (
                <div key={b.id} onClick={() => { setSelectedBooking(b); setTab("bookings"); }} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 0", borderBottom: `1px solid ${C.border}`, cursor: "pointer", gap: 10 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.customer}</div>
                    <div style={{ color: C.muted, fontSize: 12, fontFamily: "system-ui", marginTop: 2 }}>{b.event} · {b.date}</div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
                    {isEvent(b) && <BookingTypeBadge type={b.booking_type} />}
                    <StatusBadge status={b.status} />
                    <span style={{ fontWeight: 700, color: b.paid ? C.success : C.orange, fontFamily: "system-ui", fontSize: 13 }}>{fmt(b.total)}</span>
                    {!b.paid && getBalanceDue(b) < Number(b.total) && getBalanceDue(b) > 0 && (
                      <span style={{ fontSize: 10, color: C.muted, fontFamily: "system-ui" }}>Due {fmt(getBalanceDue(b))}</span>
                    )}
                  </div>
                </div>
              ))}
              {bookings.length === 0 && <div style={{ color: C.muted, fontSize: 13, fontFamily: "system-ui" }}>No bookings yet.</div>}
            </Card>
            <Card>
              <div style={{ fontWeight: 700, marginBottom: 14, fontSize: 12, color: C.goldLight, letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: "system-ui" }}>Inventory Snapshot</div>
              {inventory.slice(0, 6).map(item => {
                const pct = item.total > 0 ? Math.round((item.rented / item.total) * 100) : 0;
                const barColor = pct > 80 ? C.danger : pct > 50 ? C.orange : C.success;
                return (
                  <div key={item.id} style={{ marginBottom: 14 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 6, fontFamily: "system-ui" }}>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{item.name}</span>
                      <span style={{ color: C.muted, flexShrink: 0, marginLeft: 8 }}>{item.rented}/{item.total}</span>
                    </div>
                    <div style={{ background: C.border, borderRadius: 4, height: 6 }}><div style={{ width: `${pct}%`, background: barColor, height: 6, borderRadius: 4 }} /></div>
                  </div>
                );
              })}
              {inventory.length === 0 && <div style={{ color: C.muted, fontSize: 13, fontFamily: "system-ui" }}>No inventory yet.</div>}
            </Card>
          </div>
        )}

        {/* CALENDAR TAB */}
        {!loading && tab === "calendar" && <CalendarView bookings={bookings} />}

        {/* FOLLOW-UP */}
        {!loading && tab === "followup" && (
          <div>
            <div style={{ marginBottom: 16 }}>
              <h2 style={{ margin: "0 0 2px", fontWeight: 400, fontSize: 22, color: C.goldLight }}>Follow-up</h2>
              <div style={{ color: C.muted, fontSize: 13, fontFamily: "system-ui" }}>Last year's events — call clients about repeat orders</div>
            </div>

            <Card style={{ marginBottom: 16 }}>
              <Label>Month (last year)</Label>
              <select value={followUpMonth} onChange={e => setFollowUpMonth(e.target.value)} style={inp}>
                {MONTHS.map((m, i) => {
                  const val = String(i + 1).padStart(2, "0");
                  return <option key={val} value={val}>{m} {new Date().getFullYear() - 1}</option>;
                })}
              </select>
            </Card>

            {followUpError && <ErrorBanner message={followUpError} onRetry={() => fetchFollowUpEvents(followUpMonth)} onDismiss={() => setFollowUpError("")} />}
            {followUpLoading && <div style={{ textAlign: "center", color: C.muted, padding: 40, fontFamily: "system-ui" }}><div style={{ fontSize: 28, marginBottom: 10 }}>⏳</div>Loading last year's events…</div>}

            {!followUpLoading && !followUpError && followUpEvents.length === 0 && (
              <div style={{ textAlign: "center", color: C.muted, padding: 40, fontFamily: "system-ui" }}>
                No events found for {MONTHS[Number(followUpMonth) - 1]} {new Date().getFullYear() - 1}.
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {followUpEvents.map(b => (
                <Card key={b.id} style={{ border: `1px solid ${CRITICAL}` }}>
                  <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: `linear-gradient(90deg, ${CRITICAL}, transparent)`, borderRadius: "16px 16px 0 0" }} />
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 17 }}>{b.event}</div>
                      <div style={{ color: C.muted, fontSize: 13, marginTop: 2, fontFamily: "system-ui" }}>{b.customer}</div>
                    </div>
                    <BookingTypeBadge type={b.booking_type} />
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
                    {[["🗓", `Event date: ${b.date}`], ["📞", b.phone || "—"], ["✉", b.email || "—"]].map(([icon, val]) => (
                      <div key={icon} style={{ display: "flex", gap: 10, fontSize: 13, fontFamily: "system-ui", alignItems: "center" }}>
                        <span style={{ color: CRITICAL, width: 18, textAlign: "center" }}>{icon}</span>
                        <span style={{ color: C.muted }}>{val}</span>
                      </div>
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: 10 }}>
                    {b.phone && (
                      <a href={`tel:${b.phone.replace(/\s+/g, "")}`} style={{ ...btnGhost, flex: 1, textAlign: "center", textDecoration: "none", color: C.goldLight, borderColor: C.gold, display: "block" }}>
                        📞 Call
                      </a>
                    )}
                    {b.phone && (
                      <button onClick={() => sendFollowUpWhatsApp(b)} style={{ ...btnGold, flex: 1, background: "#25D366" }}>
                        📲 WhatsApp
                      </button>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* BOOKINGS */}
        {!loading && tab === "bookings" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div><h2 style={{ margin: "0 0 2px", fontWeight: 400, fontSize: 22, color: C.goldLight }}>Bookings</h2><div style={{ color: C.muted, fontSize: 13, fontFamily: "system-ui" }}>{bookings.length} reservations</div></div>
              {!isDemoUser && <button onClick={openNewBooking} style={{ ...btnGold, padding: "12px 18px", fontSize: 14 }}>+ New</button>}
            </div>
            <input placeholder="🔍  Search client, event, ID…" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} style={{ ...inp, marginBottom: 12 }} />
            <div style={{ display: "flex", gap: 8, overflowX: "auto", scrollbarWidth: "none", paddingBottom: 4, marginBottom: 16 }}>
              {["All", "Active", "Upcoming", "Returned", "Completed"].map(s => (
                <button key={s} onClick={() => setFilterStatus(s)} style={{ ...btnGhost, background: filterStatus === s ? `linear-gradient(135deg, ${C.gold}, ${C.goldLight})` : C.card, color: filterStatus === s ? "#0d0f0e" : C.muted, padding: "10px 18px", fontSize: 13, whiteSpace: "nowrap", flexShrink: 0, border: `1px solid ${filterStatus === s ? "transparent" : C.border}` }}>{s}</button>
              ))}
            </div>
            {filteredBookings.length === 0 && <div style={{ textAlign: "center", color: C.muted, padding: 40, fontFamily: "system-ui" }}>No bookings found</div>}
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {filteredBookings.map(b => {
                const items = Array.isArray(b.items) ? b.items : [];
                const isOpen = selectedBooking?.id === b.id;
                const balance = getBalanceDue(b);
                return (
                  <Card key={b.id} style={isEvent(b) ? { border: `1px solid ${CRITICAL}` } : {}}>
                    <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: isEvent(b) ? `linear-gradient(90deg, ${CRITICAL}, transparent)` : `linear-gradient(90deg, ${C.gold}, transparent)`, borderRadius: "16px 16px 0 0" }} />
                    <div onClick={() => setSelectedBooking(isOpen ? null : b)}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 2 }}>{b.customer}</div>
                          <div style={{ color: C.muted, fontSize: 13, fontFamily: "system-ui" }}>{b.event}</div>
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
                          <BookingTypeBadge type={b.booking_type} />
                          <StatusBadge status={b.status} />
                        </div>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: (items.length || Number(b.advance) > 0) ? 10 : 0 }}>
                        <div style={{ fontFamily: "system-ui", fontSize: 13, color: C.muted }}>{b.date} → {b.returnDate}</div>
                        <div style={{ textAlign: "right" }}>
                          <div style={{ fontWeight: 800, fontSize: 16, color: b.paid ? C.success : C.orange, fontFamily: "system-ui" }}>{fmt(b.total)}</div>
                          {!b.paid && Number(b.advance) > 0 && (
                            <div style={{ fontSize: 11, color: C.muted, fontFamily: "system-ui" }}>Advance {fmt(b.advance)} · Due {fmt(balance)}</div>
                          )}
                        </div>
                      </div>
                      {items.length > 0 && (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                          {items.map((item, i) => <span key={i} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: "4px 10px", fontSize: 11, color: C.muted, fontFamily: "system-ui" }}>{item.name} ×{item.qty}{Number(item.price) > 0 ? ` (${fmt(Number(item.price) * Number(item.qty))})` : ""}</span>)}
                        </div>
                      )}
                    </div>
                    {isOpen && (
                      <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 16, marginTop: 12 }}>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
                          {[["📞 Phone", b.phone], ["✉ Email", b.email], ["Ref ID", b.id], ["Paid", b.paid ? "✓ Settled" : "✗ Unpaid"]].map(([l, v]) => (
                            <div key={l} style={{ background: C.surface, borderRadius: 10, padding: "12px 14px", border: `1px solid ${C.border}` }}>
                              <div style={{ color: C.muted, fontSize: 10, fontWeight: 700, marginBottom: 4, fontFamily: "system-ui", textTransform: "uppercase" }}>{l}</div>
                              <div style={{ fontWeight: 600, fontSize: 13, fontFamily: "system-ui", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v}</div>
                            </div>
                          ))}
                        </div>
                        <div style={{ background: C.surface, borderRadius: 10, padding: "14px", border: `1px solid ${C.border}`, marginBottom: 16 }}>
                          {Number(b.discount) > 0 && (
                            <>
                              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontFamily: "system-ui", marginBottom: 6 }}>
                                <span style={{ color: C.muted }}>Subtotal</span>
                                <span style={{ fontWeight: 700 }}>{fmt(Number(b.total || 0) + Number(b.discount))}</span>
                              </div>
                              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontFamily: "system-ui", marginBottom: 6 }}>
                                <span style={{ color: C.muted }}>Discount</span>
                                <span style={{ fontWeight: 700, color: C.success }}>- {fmt(b.discount)}</span>
                              </div>
                            </>
                          )}
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontFamily: "system-ui", marginBottom: 6 }}>
                            <span style={{ color: C.muted }}>Total Amount</span>
                            <span style={{ fontWeight: 700 }}>{fmt(b.total)}</span>
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontFamily: "system-ui", marginBottom: 6 }}>
                            <span style={{ color: C.muted }}>Advance Paid</span>
                            <span style={{ fontWeight: 700, color: C.success }}>- {fmt(b.advance || 0)}</span>
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, fontFamily: "system-ui", paddingTop: 8, borderTop: `1px solid ${C.border}` }}>
                            <span style={{ fontWeight: 700 }}>Balance Due</span>
                            <span style={{ fontWeight: 800, color: balance <= 0 ? C.success : C.orange }}>{fmt(balance)}</span>
                          </div>
                        </div>
                        {b.notes && (
                          <div style={{ background: C.surface, borderRadius: 10, padding: "12px 14px", border: `1px solid ${C.border}`, marginBottom: 16 }}>
                            <div style={{ color: C.muted, fontSize: 10, fontWeight: 700, marginBottom: 6, fontFamily: "system-ui", textTransform: "uppercase" }}>💬 Notes</div>
                            <div style={{ fontSize: 13, fontFamily: "system-ui", color: C.text, whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{b.notes}</div>
                          </div>
                        )}
                        {/* WhatsApp Invoice Button */}
                        <button onClick={() => sendWhatsAppInvoice(b)} style={{ ...btnGold, width: "100%", marginBottom: 10, background: "#25D366", fontSize: 15 }}>
                          📲 Send WhatsApp Invoice
                        </button>
                        <button onClick={() => downloadInvoice(b)} style={{ ...btnGhost, width: "100%", marginBottom: 10, color: C.goldLight, borderColor: C.gold, fontSize: 15 }}>
                          🖨 Print Invoice
                        </button>
                        <button onClick={() => handleDownloadPdf(b)} disabled={pdfBusy} style={{ ...btnGold, width: "100%", marginBottom: 10, fontSize: 15, opacity: pdfBusy ? 0.7 : 1 }}>
                          {pdfBusy ? "Preparing PDF…" : "📄 Download PDF"}
                        </button>
                        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                          {!isDemoUser && !b.paid && <button onClick={() => markPaid(b.id)} style={{ ...btnGold, width: "100%" }}>✓ Mark as Settled</button>}
                          {!isDemoUser && b.status === "Upcoming" && <button onClick={() => updateStatus(b.id, "Active")} style={{ ...btnGhost, width: "100%", color: C.info, borderColor: C.info }}>Activate Rental</button>}
                          {!isDemoUser && b.status === "Active" && <button onClick={() => updateStatus(b.id, "Returned")} style={{ ...btnGhost, width: "100%", color: C.success, borderColor: C.success }}>Mark Returned</button>}
                          {!isDemoUser && b.status === "Returned" && <button onClick={() => updateStatus(b.id, "Completed")} style={{ ...btnGhost, width: "100%", color: C.gold, borderColor: C.gold }}>Mark Completed</button>}
                          {!isDemoUser && <button onClick={() => openEditBooking(b)} style={{ ...btnGhost, width: "100%", color: C.goldLight, borderColor: C.gold }}>✏️ Edit Booking</button>}
                          {!isDemoUser && <button onClick={() => setConfirmDelete({ type: "booking", id: b.id, label: `${b.id} — ${b.customer}` })} style={{ ...btnDanger, width: "100%" }}>🗑 Delete Booking</button>}
                        </div>
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>

            {showAddBooking && (
              <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.9)", zIndex: 200, overflowY: "auto" }}>
                <div style={{ background: C.card, minHeight: "100vh", padding: "24px 20px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
                    <h3 style={{ margin: 0, fontWeight: 400, fontSize: 22, color: C.goldLight }}>{editingBookingId ? `Edit Booking — ${editingBookingId}` : "New Reservation"}</h3>
                    <button onClick={closeBookingModal} style={{ background: "transparent", border: "none", color: C.muted, fontSize: 28, cursor: "pointer" }}>✕</button>
                  </div>
                  {bookingError && <div style={{ background: "#2a0e0e", border: `1px solid ${C.danger}`, borderRadius: 12, padding: "12px 14px", marginBottom: 16, color: C.danger, fontSize: 13, fontFamily: "system-ui" }}>⚠ {bookingError}</div>}
                  <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                    <div>
                      <Label>Booking Type</Label>
                      <div style={{ display: "flex", gap: 8 }}>
                        {BOOKING_TYPES.map(bt => {
                          const active = newBooking.bookingType === bt.key;
                          const tc = BOOKING_TYPE_COLORS[bt.key];
                          return (
                            <button
                              key={bt.key}
                              onClick={() => setNewBooking({ ...newBooking, bookingType: bt.key })}
                              style={{
                                ...btnGhost,
                                flex: 1,
                                background: active ? (bt.key === "event" ? CRITICAL : `linear-gradient(135deg, ${C.gold}, ${C.goldLight})`) : C.card,
                                color: active ? (bt.key === "event" ? "#fff" : "#0d0f0e") : tc.text,
                                border: `1px solid ${active ? "transparent" : tc.border}`,
                                fontWeight: 800,
                              }}
                            >
                              {bt.icon} {bt.label}
                            </button>
                          );
                        })}
                      </div>
                      {newBooking.bookingType === "event" && (
                        <div style={{ marginTop: 8, fontSize: 12, color: "#ff9797", fontFamily: "system-ui" }}>
                          Events are highlighted in red on the dashboard and calendar for visibility.
                        </div>
                      )}
                    </div>
                    {[["Client Name","customer","text"],["Event Name","event","text"],["Phone","phone","tel"],["Email","email","email"],["Event Date","date","date"],["Return Date","returnDate","date"]].map(([label, key, type]) => (
                      <div key={key}><Label>{label}</Label><input type={type} value={newBooking[key]} onChange={e => setNewBooking({ ...newBooking, [key]: e.target.value })} style={inp} /></div>
                    ))}
                    <div><Label>Status</Label><select value={newBooking.status} onChange={e => setNewBooking({ ...newBooking, status: e.target.value })} style={inp}>{["Upcoming","Active","Returned","Completed"].map(s => <option key={s} value={s}>{s}</option>)}</select></div>
                    <div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}><Label>Items</Label><button onClick={addItemRow} style={{ ...btnGold, padding: "8px 14px", fontSize: 12 }}>+ Add</button></div>
                      {newBooking.items.map((item, i) => {
                        const lineAmount = Number(item.qty || 0) * Number(item.price || 0);
                        return (
                          <div key={i} style={{ marginBottom: 12 }}>
                            <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                              <ItemSearchPicker
                                inventory={inventory}
                                value={item.name}
                                onSelect={name => selectItemRow(i, name)}
                                onCreateNew={name => openQuickAdd(i, name)}
                              />
                              <input type="number" min="1" value={item.qty} onChange={e => updateItemRow(i, "qty", +e.target.value)} style={{ ...inp, flex: 1, minWidth: 0 }} placeholder="Qty" />
                              {newBooking.items.length > 1 && <button onClick={() => removeItemRow(i)} style={{ ...btnDanger, padding: "12px", flexShrink: 0 }}>✕</button>}
                            </div>
                            <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6 }}>
                              <input type="number" min="0" value={item.price} onChange={e => updateItemRow(i, "price", e.target.value)} style={{ ...inp, flex: 1, minWidth: 0 }} placeholder="Rate per item (₹)" />
                              <div style={{ flex: 1, fontSize: 13, color: C.goldLight, fontWeight: 700, fontFamily: "system-ui", textAlign: "right", paddingRight: 4 }}>{lineAmount > 0 ? fmt(lineAmount) : "—"}</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Totals — always the LAST money section of the form:
                        Subtotal (all items) → Discount → Total Amount → Advance → Balance */}
                    {(() => {
                      const t = formTotals(newBooking);
                      const showManual = t.itemsSubtotal === 0 || t.manual;
                      const advanceNum = Math.max(0, Number(newBooking.advance) || 0);
                      const bal = Math.max(0, t.finalTotal - advanceNum);
                      const rowStyle = { display: "flex", justifyContent: "space-between", alignItems: "center", fontFamily: "system-ui" };
                      return (
                        <>
                          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14, display: "flex", flexDirection: "column", gap: 14 }}>
                            <div>
                              <div style={{ ...rowStyle, fontSize: 14 }}>
                                <span style={{ color: C.muted }}>Subtotal (all items)</span>
                                {!showManual && <span style={{ color: C.text, fontWeight: 700 }}>{fmt(t.base)}</span>}
                              </div>
                              {showManual && (
                                <div style={{ marginTop: 8 }}>
                                  <input type="number" min="0" value={newBooking.manualSubtotal} onChange={e => setNewBooking({ ...newBooking, manualSubtotal: e.target.value })} placeholder={t.itemsSubtotal === 0 ? "No item rates entered — type subtotal (₹)" : "Type subtotal (₹)"} style={inp} />
                                  {t.itemsSubtotal > 0 && (
                                    <button onClick={() => setNewBooking({ ...newBooking, manualSubtotal: "" })} style={{ background: "transparent", border: "none", color: C.goldLight, fontSize: 12, fontFamily: "system-ui", cursor: "pointer", padding: "6px 0 0" }}>↺ Use items total ({fmt(t.itemsSubtotal)})</button>
                                  )}
                                </div>
                              )}
                            </div>
                            <div>
                              <Label>Discount (₹)</Label>
                              <input type="number" min="0" value={newBooking.discount} onChange={e => setNewBooking({ ...newBooking, discount: e.target.value })} placeholder="0" style={inp} />
                              {t.overDiscount && <div style={{ fontSize: 12, color: C.orange, fontFamily: "system-ui", marginTop: 6 }}>Discount can't be more than the subtotal — capped at {fmt(t.base)}.</div>}
                            </div>
                            <div style={{ ...rowStyle, paddingTop: 12, borderTop: `1px solid ${C.border}` }}>
                              <div>
                                <div style={{ fontWeight: 800, fontSize: 15, color: C.text }}>Total Amount</div>
                                <div style={{ fontSize: 11, color: C.muted }}>Subtotal − Discount</div>
                              </div>
                              <span style={{ fontWeight: 800, fontSize: 22, color: C.goldLight }}>{fmt(t.finalTotal)}</span>
                            </div>
                          </div>
                          <div>
                            <Label>Advance Paid (₹)</Label>
                            <input type="number" min="0" value={newBooking.advance} onChange={e => setNewBooking({ ...newBooking, advance: e.target.value })} placeholder="Amount client paid while booking" style={inp} />
                            <div style={{ ...rowStyle, fontSize: 13, color: C.muted, marginTop: 8 }}>
                              <span>Balance Due</span>
                              <span style={{ color: bal <= 0 ? C.success : C.orange, fontWeight: 700 }}>{fmt(bal)}</span>
                            </div>
                          </div>
                        </>
                      );
                    })()}
                    <div>
                      <Label>Notes / Comments</Label>
                      <textarea value={newBooking.notes} onChange={e => setNewBooking({ ...newBooking, notes: e.target.value })} placeholder="Any special instructions, alterations, delivery notes…" rows={4} style={{ ...inp, resize: "vertical", lineHeight: 1.5, fontFamily: "system-ui" }} />
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", background: C.surface, borderRadius: 12, border: `1px solid ${C.border}` }}>
                      <input type="checkbox" checked={newBooking.paid} onChange={e => setNewBooking({ ...newBooking, paid: e.target.checked })} id="paidCheck" style={{ width: 20, height: 20, cursor: "pointer" }} />
                      <label htmlFor="paidCheck" style={{ fontSize: 15, color: C.muted, fontFamily: "system-ui", cursor: "pointer" }}>Payment already received</label>
                    </div>
                    <div style={{ display: "flex", gap: 12, paddingBottom: 20 }}>
                      <button onClick={closeBookingModal} style={{ ...btnGhost, flex: 1 }}>Cancel</button>
                      <button onClick={handleSaveBooking} disabled={saving} style={{ ...btnGold, flex: 2, opacity: saving ? 0.7 : 1 }}>{saving ? (editingBookingId ? "Saving…" : "Saving…") : (editingBookingId ? "Save Changes" : "Create Reservation")}</button>
                    </div>
                  </div>
                </div>

                {/* Quick-add-to-inventory nested modal */}
                {quickAddRow !== null && (
                  <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 300, display: "flex", alignItems: "flex-end", justifyContent: "center", padding: 16 }}>
                    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 20, padding: 24, width: "100%", maxWidth: 480 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
                        <h3 style={{ margin: 0, fontWeight: 400, fontSize: 19, color: C.goldLight }}>Add New Inventory Item</h3>
                        <button onClick={closeQuickAdd} style={{ background: "transparent", border: "none", color: C.muted, fontSize: 24, cursor: "pointer" }}>✕</button>
                      </div>
                      {quickAddError && <div style={{ background: "#2a0e0e", border: `1px solid ${C.danger}`, borderRadius: 12, padding: "12px 14px", marginBottom: 16, color: C.danger, fontSize: 13, fontFamily: "system-ui" }}>⚠ {quickAddError}</div>}
                      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                        <div><Label>Item Code *</Label><input value={quickAddForm.code} onChange={e => setQuickAddForm({ ...quickAddForm, code: e.target.value.toUpperCase() })} placeholder="e.g. GWN-001" autoCapitalize="characters" style={{ ...inp, textTransform: "uppercase" }} /></div>
                        <div><Label>Item Name</Label><input value={quickAddForm.name} onChange={e => setQuickAddForm({ ...quickAddForm, name: e.target.value })} style={inp} /></div>
                        <div><Label>Category</Label><input value={quickAddForm.category} onChange={e => setQuickAddForm({ ...quickAddForm, category: e.target.value })} placeholder="e.g. Gowns, Jewellery, Decor" style={inp} /></div>
                        <div style={{ display: "flex", gap: 10 }}>
                          <div style={{ flex: 1 }}><Label>Total Quantity</Label><input type="number" min="1" value={quickAddForm.total} onChange={e => setQuickAddForm({ ...quickAddForm, total: e.target.value })} style={inp} /></div>
                          <div style={{ flex: 1 }}><Label>Price/Day (₹)</Label><input type="number" min="0" value={quickAddForm.pricePerDay} onChange={e => setQuickAddForm({ ...quickAddForm, pricePerDay: e.target.value })} style={inp} /></div>
                        </div>
                        <div style={{ display: "flex", gap: 12, marginTop: 6 }}>
                          <button onClick={closeQuickAdd} style={{ ...btnGhost, flex: 1 }}>Cancel</button>
                          <button onClick={handleQuickAddSave} disabled={quickAddSaving} style={{ ...btnGold, flex: 2, opacity: quickAddSaving ? 0.7 : 1 }}>{quickAddSaving ? "Saving…" : "Add & Use in Booking"}</button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* INVENTORY */}
        {!loading && tab === "inventory" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div><h2 style={{ margin: "0 0 2px", fontWeight: 400, fontSize: 22, color: C.goldLight }}>Inventory</h2><div style={{ color: C.muted, fontSize: 13, fontFamily: "system-ui" }}>{inventory.length} categories</div></div>
              {!isDemoUser && <button onClick={() => setInventoryModal({})} style={{ ...btnGold, padding: "12px 18px", fontSize: 14 }}>+ Add</button>}
            </div>
            <input value={inventorySearch} onChange={e => setInventorySearch(e.target.value)} placeholder="🔍 Search by code or name…" style={{ ...inp, marginBottom: 16 }} />
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {inventory.filter(i => matchesInventory(i, inventorySearch)).map(item => {
                const avail = item.total - item.rented;
                const pct = item.total > 0 ? Math.round((item.rented / item.total) * 100) : 0;
                const barColor = pct > 80 ? C.danger : pct > 50 ? C.orange : C.success;
                return (
                  <Card key={item.id}>
                    <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: `linear-gradient(90deg, ${C.gold}, transparent)`, borderRadius: "16px 16px 0 0" }} />
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>{item.name}</div>
                        <div style={{ fontSize: 12, color: C.goldLight, fontWeight: 700, letterSpacing: "0.06em", marginBottom: 6, fontFamily: "system-ui" }}>{item.code || "NO CODE"}</div>
                        <span style={{ background: C.green, color: C.greenText, fontSize: 10, borderRadius: 8, padding: "4px 10px", fontWeight: 700, textTransform: "uppercase", fontFamily: "system-ui" }}>{item.category}</span>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ color: C.goldLight, fontWeight: 700, fontSize: 14, fontFamily: "system-ui", marginBottom: 8 }}>{fmt(item.pricePerDay)}/day</div>
                        {!isDemoUser && (
                          <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                            <button onClick={() => setInventoryModal({ item })} style={{ ...btnDanger, color: C.goldLight, borderColor: C.gold, padding: "6px 12px", fontSize: 12 }}>✎</button>
                            <button onClick={() => setConfirmDelete({ type: "inventory", id: item.id, label: item.name })} style={{ ...btnDanger, padding: "6px 12px", fontSize: 12 }}>🗑</button>
                          </div>
                        )}
                      </div>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 14 }}>
                      {[["Total", item.total, C.text], ["Out", item.rented, C.orange], ["Avail", avail, avail === 0 ? C.danger : C.success]].map(([l, v, c]) => (
                        <div key={l} style={{ background: C.surface, borderRadius: 10, padding: "12px 8px", textAlign: "center", border: `1px solid ${C.border}` }}>
                          <div style={{ fontSize: 24, fontWeight: 700, color: c, fontFamily: "system-ui" }}>{v}</div>
                          <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, textTransform: "uppercase", fontFamily: "system-ui" }}>{l}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{ background: C.border, borderRadius: 4, height: 6 }}><div style={{ width: `${pct}%`, background: barColor, height: 6, borderRadius: 4 }} /></div>
                    <div style={{ fontSize: 11, color: C.muted, marginTop: 6, textAlign: "right", fontFamily: "system-ui" }}>{pct}% deployed</div>
                  </Card>
                );
              })}
              {inventory.length === 0 && <div style={{ textAlign: "center", color: C.muted, padding: 40, fontFamily: "system-ui" }}>No inventory yet — add an item to get started.</div>}
              {inventory.length > 0 && !inventory.some(i => matchesInventory(i, inventorySearch)) && <div style={{ textAlign: "center", color: C.muted, padding: 40, fontFamily: "system-ui" }}>No items match "{inventorySearch}".</div>}
            </div>
            {inventoryModal && !isDemoUser && (
              <InventoryFormModal
                key={inventoryModal.item?.id ?? "new"}
                item={inventoryModal.item}
                inventory={inventory}
                onSave={saveInventoryItem}
                onClose={() => setInventoryModal(null)}
              />
            )}
          </div>
        )}

        {/* EXPORT */}
        {!loading && tab === "export" && (
          <div>
            <div style={{ marginBottom: 20 }}>
              <h2 style={{ margin: "0 0 4px", fontWeight: 400, fontSize: 22, color: C.goldLight }}>Export Data</h2>
              <div style={{ color: C.muted, fontSize: 13, fontFamily: "system-ui" }}>Download bookings & inventory as an Excel file</div>
            </div>

            {exportMsg && <div style={{ background: "#0e2a1a", border: `1px solid ${C.success}`, borderRadius: 12, padding: "12px 14px", marginBottom: 16, color: C.success, fontSize: 13, fontFamily: "system-ui" }}>✓ {exportMsg}</div>}
            {exportError && <div style={{ background: "#2a0e0e", border: `1px solid ${C.danger}`, borderRadius: 12, padding: "12px 14px", marginBottom: 16, color: C.danger, fontSize: 13, fontFamily: "system-ui" }}>⚠ {exportError}</div>}

            <Card style={{ marginBottom: 16 }}>
              <Label>What to Export</Label>
              <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                {[["both", "Both"], ["bookings", "Bookings"], ["inventory", "Inventory"]].map(([key, label]) => (
                  <button key={key} onClick={() => setExportType(key)} style={{ ...btnGhost, flex: "1 1 auto", background: exportType === key ? `linear-gradient(135deg, ${C.gold}, ${C.goldLight})` : C.card, color: exportType === key ? "#0d0f0e" : C.muted, border: `1px solid ${exportType === key ? "transparent" : C.border}`, padding: "10px 14px", fontSize: 13 }}>{label}</button>
                ))}
              </div>
            </Card>

            <Card style={{ marginBottom: 16 }}>
              <Label>Date Range</Label>
              <div style={{ display: "flex", gap: 8, marginTop: 10, marginBottom: exportRange !== "all" ? 16 : 0, flexWrap: "wrap" }}>
                {[["all", "All Time"], ["month", "Monthly"], ["date", "Specific Date"]].map(([key, label]) => (
                  <button key={key} onClick={() => setExportRange(key)} style={{ ...btnGhost, flex: "1 1 auto", background: exportRange === key ? `linear-gradient(135deg, ${C.gold}, ${C.goldLight})` : C.card, color: exportRange === key ? "#0d0f0e" : C.muted, border: `1px solid ${exportRange === key ? "transparent" : C.border}`, padding: "10px 14px", fontSize: 13 }}>{label}</button>
                ))}
              </div>

              {exportRange === "month" && (
                <div>
                  <Label>Select Month</Label>
                  <input type="month" value={exportMonth} onChange={e => setExportMonth(e.target.value)} style={inp} />
                </div>
              )}
              {exportRange === "date" && (
                <div>
                  <Label>Select Date</Label>
                  <input type="date" value={exportDate} onChange={e => setExportDate(e.target.value)} style={inp} />
                </div>
              )}
            </Card>

            <Card style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 12, color: C.muted, fontFamily: "system-ui", lineHeight: 1.7 }}>
                {exportType !== "inventory" && <div>📋 Bookings are filtered by their <b style={{ color: C.text }}>booking date</b>.</div>}
                {exportType !== "bookings" && <div>📦 Inventory reflects <b style={{ color: C.text }}>current stock levels</b>{exportRange !== "all" ? ", filtered by the item's added-on date where available." : "."}</div>}
              </div>
            </Card>

            <button onClick={handleExport} disabled={exporting} style={{ ...btnGold, width: "100%", padding: "16px", fontSize: 15, opacity: exporting ? 0.7 : 1 }}>{exporting ? "Preparing…" : "⬇️  Download Excel File"}</button>
          </div>
        )}

        {/* CUSTOMERS */}
        {!loading && tab === "customers" && (
          <div>
            <div style={{ marginBottom: 16 }}><h2 style={{ margin: "0 0 2px", fontWeight: 400, fontSize: 22, color: C.goldLight }}>Clientele</h2><div style={{ color: C.muted, fontSize: 13, fontFamily: "system-ui" }}>{bookings.length} clients</div></div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {bookings.map(b => {
                const items = Array.isArray(b.items) ? b.items : [];
                const balance = getBalanceDue(b);
                return (
                  <Card key={b.id} style={isEvent(b) ? { border: `1px solid ${CRITICAL}` } : {}}>
                    <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: isEvent(b) ? `linear-gradient(90deg, ${CRITICAL}, transparent)` : `linear-gradient(90deg, ${C.gold}, transparent)`, borderRadius: "16px 16px 0 0" }} />
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
                      <div><div style={{ fontWeight: 700, fontSize: 17 }}>{b.customer}</div><div style={{ color: C.muted, fontSize: 13, marginTop: 2, fontFamily: "system-ui" }}>{b.event}</div></div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
                        <BookingTypeBadge type={b.booking_type} />
                        <StatusBadge status={b.status} />
                      </div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
                      {[["📞", b.phone], ["✉", b.email], ["🗓", `${b.date} → ${b.returnDate}`], ["#", b.id]].map(([icon, val]) => (
                        <div key={icon} style={{ display: "flex", gap: 10, fontSize: 13, fontFamily: "system-ui", alignItems: "center" }}>
                          <span style={{ color: C.gold, width: 18, textAlign: "center" }}>{icon}</span>
                          <span style={{ color: C.muted }}>{val}</span>
                        </div>
                      ))}
                    </div>
                    {items.length > 0 && (
                      <div style={{ marginBottom: 14 }}>
                        <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, textTransform: "uppercase", fontFamily: "system-ui", marginBottom: 8 }}>Items</div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                          {items.map((item, i) => <span key={i} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: "4px 10px", fontSize: 12, color: C.muted, fontFamily: "system-ui" }}>{item.name} ×{item.qty}{Number(item.price) > 0 ? ` (${fmt(Number(item.price) * Number(item.qty))})` : ""}</span>)}
                        </div>
                      </div>
                    )}
                    {Number(b.advance) > 0 && (
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: C.muted, fontFamily: "system-ui", marginBottom: 10 }}>
                        <span>Advance Paid: {fmt(b.advance)}</span>
                        <span style={{ color: balance <= 0 ? C.success : C.orange, fontWeight: 700 }}>Balance: {fmt(balance)}</span>
                      </div>
                    )}
                    <button onClick={() => sendWhatsAppInvoice(b)} style={{ ...btnGold, width: "100%", marginBottom: 10, background: "#25D366", fontSize: 14 }}>📲 Send WhatsApp Invoice</button>
                    <button onClick={() => downloadInvoice(b)} style={{ ...btnGhost, width: "100%", marginBottom: 12, color: C.goldLight, borderColor: C.gold, fontSize: 14 }}>🖨 Print Invoice</button>
                    <button onClick={() => handleDownloadPdf(b)} disabled={pdfBusy} style={{ ...btnGold, width: "100%", marginBottom: 12, fontSize: 14, opacity: pdfBusy ? 0.7 : 1 }}>{pdfBusy ? "Preparing PDF…" : "📄 Download PDF"}</button>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 14, borderTop: `1px solid ${C.border}` }}>
                      <div style={{ fontWeight: 800, color: b.paid ? C.success : C.orange, fontSize: 20, fontFamily: "system-ui" }}>{fmt(b.total)}</div>
                      <span style={{ background: b.paid ? "#0e2a1a" : "#2a1a0e", color: b.paid ? C.success : C.orange, border: `1px solid ${b.paid ? "#1a4a2a" : "#4a2a0e"}`, fontSize: 11, fontWeight: 700, borderRadius: 20, padding: "6px 14px", fontFamily: "system-ui" }}>{b.paid ? "SETTLED" : "PAYMENT DUE"}</span>
                    </div>
                  </Card>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
