/** Shared helpers for coordinate-meter + LoRa device import. */

import { createHash } from "node:crypto";

export const REASON = {
  INVALID_COORDINATE: "INVALID_COORDINATE",
  UNKNOWN_CRS: "UNKNOWN_CRS",
  NO_BUILDING_CANDIDATE: "NO_BUILDING_CANDIDATE",
  AMBIGUOUS_BUILDING: "AMBIGUOUS_BUILDING",
  TOO_FAR_FROM_BUILDING: "TOO_FAR_FROM_BUILDING",
  EMPTY_METER_NUMBER: "EMPTY_METER_NUMBER",
  METER_NORMALIZATION_COLLISION: "METER_NORMALIZATION_COLLISION",
  METER_ALREADY_IN_OTHER_BUILDING: "METER_ALREADY_IN_OTHER_BUILDING",
  DUPLICATE_SOURCE_METER: "DUPLICATE_SOURCE_METER",
  NO_DETERMINISTIC_DEVICE_LINK: "NO_DETERMINISTIC_DEVICE_LINK",
  AMBIGUOUS_BLOCK_ALIAS: "AMBIGUOUS_BLOCK_ALIAS",
  TEST_OR_SUSPICIOUS_RECORD: "TEST_OR_SUSPICIOUS_RECORD",
  WOULD_OVERWRITE_HIGHER_QUALITY_DATA: "WOULD_OVERWRITE_HIGHER_QUALITY_DATA",
};

export const MATCH_METHOD = {
  INSIDE: "inside",
  NEAREST: "nearest",
  NONE: "none",
};

export const CONFIDENCE = {
  HIGH: "high",
  MEDIUM: "medium",
  SKIP: "skip",
};

/** TOKİ/İkizce (~38.16–38.36) + Battalgazi doğu kümesi (~38.61–38.68). */
export const EXPECTED_REGION = {
  minLat: 38.2,
  maxLat: 38.5,
  minLng: 38.05,
  maxLng: 38.75,
};

export const SKIP_BUILDING_LAYER = /KALDIRIM/i;
export const TEST_BLOCK_RE = /deneme|test\b|dummy|geçici|gecici/i;

export function cleanText(value) {
  if (value == null) return "";
  return String(value).replace(/\uFEFF/g, "").trim();
}

export function unicodeFold(value) {
  return cleanText(value).normalize("NFC");
}

export function asIdentityString(value) {
  if (value == null || value === "") return "";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "";
    if (Number.isInteger(value)) return String(Math.trunc(value));
    const asInt = Math.round(value);
    if (Math.abs(value - asInt) < 1e-9 && Math.abs(value) < 1e15) {
      return String(asInt);
    }
    return null;
  }
  const raw = cleanText(value);
  if (!raw) return "";
  if (/[eE][+-]?\d+$/.test(raw) && /[.,]/.test(raw)) return null;
  if (/^\d+\.0+$/.test(raw)) return raw.replace(/\.0+$/, "");
  return raw;
}

export function parseWktPoint(wkt) {
  const text = cleanText(wkt);
  const m = text.match(/^POINT\s*\(\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s+([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*\)$/i);
  if (!m) return null;
  const x = Number(m[1]);
  const y = Number(m[2]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y, wkt: text };
}

export function normalizeMeterNumber(value) {
  const identity = asIdentityString(value);
  if (identity == null) return { ok: false, reason: "scientific_or_fractional", raw: value, normalized: "" };
  const trimmed = identity;
  if (!trimmed) return { ok: false, reason: "empty", raw: value, normalized: "" };
  return { ok: true, reason: "", raw: value, normalized: trimmed };
}

export function meterDigits(value) {
  return String(value ?? "")
    .trim()
    .replace(/^2025-/i, "")
    .replace(/\D/g, "");
}

export function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

export function median(sorted) {
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
  return sorted[mid];
}

export function argValue(argv, flag) {
  const i = argv.indexOf(flag);
  if (i < 0) return null;
  return argv[i + 1] || null;
}

export function hasFlag(argv, flag) {
  return argv.includes(flag);
}

export function inExpectedRegion(lat, lng, region = EXPECTED_REGION) {
  return lat >= region.minLat && lat <= region.maxLat && lng >= region.minLng && lng <= region.maxLng;
}

export function fileSha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

export function stampIso() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}
