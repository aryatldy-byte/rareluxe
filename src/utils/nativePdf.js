import { Capacitor } from "@capacitor/core";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";

// True only inside the installed Capacitor Android/iOS app (not in a normal browser).
export const isNativeApp = () => Capacitor.isNativePlatform();

const blobToBase64 = (blob) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onloadend = () => resolve(String(r.result).split(",")[1]);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

// Writes the PDF to the app's cache and opens the system share sheet
// (Save to Drive / WhatsApp / Gmail / Files, etc.).
// Throws if the native plugins are missing from the installed APK (old build).
export async function saveAndSharePdfNative(blob, filename) {
  const data = await blobToBase64(blob);
  const file = await Filesystem.writeFile({ path: filename, data, directory: Directory.Cache });
  try {
    await Share.share({ title: filename, text: "Rare Luxe invoice", url: file.uri, dialogTitle: "Save or share invoice" });
  } catch (e) {
    // User closing the share sheet is not an error.
    if (!/cancel/i.test(String(e?.message || e))) throw e;
  }
}
