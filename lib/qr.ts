/** Server-only: renders the QR code as a small SVG. */
import QRCode from "qrcode";

export async function qrSvg(payload: string): Promise<string> {
  return QRCode.toString(payload, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#000000", light: "#ffffff" } });
}
