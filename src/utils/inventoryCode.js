// Helpers for inventory item codes (unique, uppercase, required).

export const normalizeCode = (code) => String(code ?? "").trim().toUpperCase();

// Returns an error string, or "" when the code is valid.
// `excludeId` lets the Edit form ignore the item currently being edited.
export function validateCode(rawCode, inventory = [], excludeId = null) {
  const code = normalizeCode(rawCode);
  if (!code) return "Item code is required.";
  const clash = inventory.find(
    (i) => i.id !== excludeId && normalizeCode(i.code) === code
  );
  if (clash) return `Code "${code}" is already used by "${clash.name}". Codes must be unique.`;
  return "";
}

// Detects a Postgres unique-violation coming back from Supabase REST (HTTP 409 / code 23505).
export const isDuplicateError = (err) =>
  /duplicate key|unique constraint|23505|\(409\)/i.test(String(err?.message || ""));

// Matches an inventory item against a search string by code OR name.
export function matchesInventory(item, query) {
  const q = String(query ?? "").trim().toLowerCase();
  if (!q) return true;
  return (
    String(item.name || "").toLowerCase().includes(q) ||
    String(item.code || "").toLowerCase().includes(q)
  );
}

// Next automatic code in the RL001, RL002… sequence, based on the highest existing RL number.
export function nextCode(inventory = [], prefix = "RL") {
  const re = new RegExp(`^${prefix}(\\d+)$`);
  let max = 0;
  for (const i of inventory) {
    const m = re.exec(normalizeCode(i.code));
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  const n = max + 1;
  return prefix + String(n).padStart(3, "0");
}
