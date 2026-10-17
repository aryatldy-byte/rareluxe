import { useState } from "react";
import { normalizeCode, validateCode, isDuplicateError, nextCode } from "../utils/inventoryCode";

const C = {
  card: "#181e18", surface: "#131713", border: "#2a3328", gold: "#b8952a", goldLight: "#d4af5a",
  text: "#f0ece0", muted: "#7a8070", danger: "#c0614a",
};
const inp = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: "14px 16px", color: C.text, fontSize: 16, width: "100%", outline: "none", boxSizing: "border-box", fontFamily: "system-ui", WebkitAppearance: "none" };
const btnGold = { background: `linear-gradient(135deg, ${C.gold}, ${C.goldLight})`, color: "#0d0f0e", border: "none", borderRadius: 12, padding: "14px 22px", fontWeight: 800, cursor: "pointer", fontSize: 15, fontFamily: "system-ui", letterSpacing: "0.04em", touchAction: "manipulation" };
const btnGhost = { background: "transparent", color: C.muted, border: `1px solid ${C.border}`, borderRadius: 12, padding: "14px 18px", fontWeight: 600, cursor: "pointer", fontSize: 15, fontFamily: "system-ui", touchAction: "manipulation" };
const labelStyle = { display: "block", fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6, fontFamily: "system-ui" };

/**
 * Add / Edit inventory item modal.
 * Props:
 *  - item:      existing item when editing, or null/undefined when adding
 *  - inventory: full inventory list (used for duplicate-code check)
 *  - onSave(payload): async; should throw on failure. payload.code is already UPPERCASE.
 *  - onClose()
 */
export default function InventoryFormModal({ item, inventory, onSave, onClose }) {
  const editing = !!item;
  const [form, setForm] = useState({
    code: item?.code || nextCode(inventory), // new items get the next code automatically
    name: item?.name || "",
    category: item?.category || "",
    total: item?.total ?? "",
    pricePerDay: item?.pricePerDay ?? "",
  });
  const [error, setError] = useState("");
  const [codeError, setCodeError] = useState("");
  const [saving, setSaving] = useState(false);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const handleSave = async () => {
    setError("");
    const code = normalizeCode(form.code);
    const cErr = validateCode(code, inventory, item?.id ?? null);
    setCodeError(cErr);
    if (cErr) return;
    if (!form.name.trim() || !form.category.trim() || form.total === "" || Number(form.total) < 0) {
      setError("Item code, name, category and total quantity are required.");
      return;
    }
    setSaving(true);
    try {
      await onSave({
        code,
        name: form.name.trim(),
        category: form.category.trim(),
        total: Number(form.total),
        pricePerDay: Number(form.pricePerDay) || 0,
      });
    } catch (err) {
      if (isDuplicateError(err)) setCodeError(`Code "${code}" already exists. Codes must be unique.`);
      else setError(err.message || "Could not save this item. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.9)", zIndex: 200, overflowY: "auto" }}>
      <div style={{ background: C.card, minHeight: "100vh", padding: "24px 20px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <h3 style={{ margin: 0, fontWeight: 400, fontSize: 22, color: C.goldLight }}>{editing ? "Edit Inventory Item" : "Add Inventory Item"}</h3>
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: C.muted, fontSize: 28, cursor: "pointer" }}>✕</button>
        </div>
        {error && <div style={{ background: "#2a0e0e", border: `1px solid ${C.danger}`, borderRadius: 12, padding: "12px 14px", marginBottom: 16, color: C.danger, fontSize: 13, fontFamily: "system-ui" }}>⚠ {error}</div>}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <label style={labelStyle}>Item Code * {!editing && <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>(auto-generated — you can change it)</span>}</label>
            <input
              value={form.code}
              onChange={(e) => { set("code", e.target.value.toUpperCase()); setCodeError(""); }}
              placeholder="e.g. GWN-001"
              autoCapitalize="characters"
              autoComplete="off"
              required
              style={{ ...inp, textTransform: "uppercase", borderColor: codeError ? C.danger : C.border }}
            />
            {codeError && <div style={{ color: C.danger, fontSize: 12, marginTop: 6, fontFamily: "system-ui" }}>⚠ {codeError}</div>}
          </div>
          <div><label style={labelStyle}>Item Name</label><input value={form.name} onChange={(e) => set("name", e.target.value)} style={inp} /></div>
          <div><label style={labelStyle}>Category</label><input value={form.category} onChange={(e) => set("category", e.target.value)} style={inp} /></div>
          <div><label style={labelStyle}>Total Quantity</label><input type="number" min="0" value={form.total} onChange={(e) => set("total", e.target.value)} style={inp} /></div>
          <div><label style={labelStyle}>Price per Day (₹)</label><input type="number" min="0" value={form.pricePerDay} onChange={(e) => set("pricePerDay", e.target.value)} style={inp} /></div>
          <div style={{ display: "flex", gap: 12, paddingBottom: 20 }}>
            <button onClick={onClose} style={{ ...btnGhost, flex: 1 }}>Cancel</button>
            <button onClick={handleSave} disabled={saving} style={{ ...btnGold, flex: 2, opacity: saving ? 0.7 : 1 }}>{saving ? "Saving…" : editing ? "Save Changes" : "Add Item"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
