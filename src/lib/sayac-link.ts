/**
 * Paylaşılabilir harita linki: /map?bina_id=X&sayac=Y
 */
export type SayacDeepLink = { binaId: number; sayac: string };

export function parseSayacDeepLink(
  params: URLSearchParams | { get: (key: string) => string | null }
): SayacDeepLink | null {
  const binaId = parseInt(params.get("bina_id") || "", 10);
  if (!binaId) return null;
  return { binaId, sayac: (params.get("sayac") || "").trim() };
}

export function sayacDeepLinkKey(binaId: number, sayac: string) {
  return `${binaId}|${sayac}`;
}

export function buildSayacMapUrl(binaId: number, sayacId: string, origin?: string) {
  const base = origin ?? (typeof window !== "undefined" ? window.location.origin : "");
  const params = new URLSearchParams({ bina_id: String(binaId) });
  const sayac = String(sayacId ?? "").trim();
  if (sayac) params.set("sayac", sayac);
  return `${base}/map?${params.toString()}`;
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      /* fallback */
    }
  }

  if (typeof document === "undefined") return false;
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  document.body.removeChild(textarea);
  return ok;
}

export async function copySayacMapLink(binaId: number, sayacId: string): Promise<boolean> {
  return copyTextToClipboard(buildSayacMapUrl(binaId, sayacId));
}

export type ShareSayacResult = "shared" | "copied" | "cancelled" | "failed";

function canNativeShare(payload: { title: string; text: string; url: string }) {
  if (typeof navigator === "undefined" || !navigator.share) return false;
  try {
    return navigator.canShare ? navigator.canShare(payload) : false;
  } catch {
    return false;
  }
}

export async function shareSayacMapLink(
  binaId: number,
  sayacId: string,
  options?: { title?: string; text?: string }
): Promise<ShareSayacResult> {
  const url = buildSayacMapUrl(binaId, sayacId);
  const title = options?.title ?? `Sayaç ${sayacId}`;
  const text = options?.text ?? "Haritada konumu aç";
  const payload = { title, text, url };

  if (canNativeShare(payload)) {
    try {
      await navigator.share(payload);
      return "shared";
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return "cancelled";
    }
  }

  const copied = await copyTextToClipboard(url);
  return copied ? "copied" : "failed";
}

export function syncSayacUrlInBrowser(binaId: number, sayacId: string) {
  if (typeof window === "undefined") return;
  const url = `/map?${new URLSearchParams({
    bina_id: String(binaId),
    ...(sayacId.trim() ? { sayac: sayacId.trim() } : {}),
  }).toString()}`;
  window.history.replaceState({}, "", url);
}

export function clearSayacUrlInBrowser() {
  if (typeof window === "undefined") return;
  window.history.replaceState({}, "", "/map");
}
