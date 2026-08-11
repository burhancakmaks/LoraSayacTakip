"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import BuildingInfoModal from "./BuildingInfoModal";
import SayacModal from "./SayacModal";
import SayacSorunPanel, { type SayacSorunListeItem, type SorunListeFilter } from "./SayacSorunPanel";
import { useTheme } from "@/context/ThemeContext";
import { getTarifeColor } from "@/lib/tarife";
import { getSorunMarkerColor, type SayacSorunSeverity } from "@/lib/sayac-durum";
import MapNotificationBell from "./MapNotificationBell";
import { useNotifications } from "@/context/NotificationContext";
import { useAuthUser } from "@/hooks/useAuthUser";
import { SAYAC_GUNCELLENDI, MAP_NAV_RESET } from "@/lib/sayac-events";
import { readSavedMapView, saveMapView } from "@/lib/map-view-storage";
import {
  buildSayacMapUrl,
  clearSayacUrlInBrowser,
  copySayacMapLink,
  copyTextToClipboard,
  parseSayacDeepLink,
  parseBinaFocusId,
  sayacDeepLinkKey,
  shareSayacMapLink,
  syncSayacUrlInBrowser,
} from "@/lib/sayac-link";
import { openGoogleMaps } from "@/lib/maps-link";
import {
  type UzaktanBinaEntry,
  type UzaktanTypeFilter,
  type UzaktanSozlesmeIndex,
  UZAKTAN_DIM_STYLE,
  UZAKTAN_MATCH_COLOR,
  binaMatchesUzaktanFilter,
  resolveUzaktanBuildingStyle,
} from "@/lib/uzaktan-sozlesme";

interface Building {
  id: number;
  oda_id: number | null;
  kml_id: number | null;
  id_2: number | null;
  value: string | null;
  layer: string | null;
  abone_sayisi: number;
  aktif_abone_sayisi: number;
  building_type_id: number | null;
  coordinates: [number, number][][];
  is_configured?: boolean;
  sayac_count?: number;
  sayac_kayit?: number;
  tarife_sinif?: string | null;
  tarife_etiket?: string | null;
  tarife_turu?: string | null;
  tarife_karma?: boolean;
  rezerv_abone_sayisi?: number;
  has_tarife?: boolean;
  dis_kapi_no?: string;
}

interface SelectedBuilding {
  id: number;
  value: string | null;
  layer: string | null;
  oda_id: number | null;
}

interface MahalleListItem {
  name: string;
  center: [number, number];
}

interface SayacSearchResult {
  bina_id: number;
  birim_no: number;
  blok_no: string;
  kat: string;
  kapi_no: string;
  sayac_id: string;
  abone_no: string;
  building_name: string;
  layer: string | null;
  oda_id: number | null;
  is_configured: boolean;
  coordinates: [number, number][][];
  lat?: number | null;
  lng?: number | null;
}

interface KapiSearchResult {
  bina_id: number;
  kapi_no: string;
  building_name: string;
  layer: string | null;
  oda_id: number | null;
  lat: number;
  lng: number;
  alignment: string;
  edge_distance_m: number | null;
}

interface SayacSorunBina {
  bina_id: number;
  value: string;
  okunmadi: number;
  eksik: number;
  hatali: number;
  gecerli: number;
  severity: SayacSorunSeverity;
  center: [number, number] | null;
}

interface SayacSorunOzet {
  okunmadi: number;
  eksik: number;
  hatali: number;
  bina_sayisi: number;
  kritik_bina: number;
  eksik_bina: number;
}

function createSorunIcon(severity: Exclude<SayacSorunSeverity, null>) {
  const color = getSorunMarkerColor(severity);
  const symbol = severity === "kritik" ? "!" : "?";
  return L.divIcon({
    className: "",
    html: `<div style="width:28px;height:28px;border-radius:50%;background:${color};color:white;font-weight:800;font-size:15px;display:flex;align-items:center;justify-content:center;border:2.5px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.35);font-family:Outfit,sans-serif;line-height:1">${symbol}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

interface BugunBina {
  bina_id: number;
  value: string;
  count: number;
  last_at: string;
  center: { lat: number; lng: number } | null;
  items: Array<{ sayac_id: string; kapi_no: string; blok_no: string; kat: string; updated_at: string }>;
}

interface BugunOzet {
  toplam: number;
  bina_sayisi: number;
}

function formatBugunTime(iso: string) {
  if (!iso) return "—";
  const d = new Date(iso.includes("T") ? iso : iso.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("tr-TR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function createBugunIcon(count: number) {
  const label = count.toLocaleString("tr-TR");
  const width = Math.min(96, Math.max(44, label.length * 8 + 24));
  const fontSize = count >= 1000 ? 10 : count >= 100 ? 11 : 12;
  return L.divIcon({
    className: "bugun-sayac-map-badge",
    html: `<div style="width:${width}px;display:flex;flex-direction:column;align-items:center;gap:2px;font-family:Outfit,sans-serif;pointer-events:auto;cursor:pointer">
      <div style="width:100%;padding:4px 6px;border-radius:10px;background:linear-gradient(135deg,#0ea5e9,#0284c7);color:#fff;font-weight:800;font-size:${fontSize}px;text-align:center;border:2px solid #fff;box-shadow:0 2px 10px rgba(2,132,199,.45);line-height:1.2">+${label}</div>
      <div style="font-size:8px;font-weight:700;color:#0369a1;background:rgba(255,255,255,.95);padding:2px 6px;border-radius:6px;border:1px solid #bae6fd">Bugün</div>
    </div>`,
    iconAnchor: [width / 2, 42],
    iconSize: [width, 42],
  });
}

interface PolySozlesmeBina {
  bina_id: number;
  value: string;
  count: number;
  sayac_sayisi: number;
  center: { lat: number; lng: number } | null;
}

interface PolySozlesmeOzet {
  sozlesme_sayisi: number;
  bina_sayisi: number;
  sayac_sayisi: number;
}

function createPolySozlesmeIcon(count: number) {
  const label = count.toLocaleString("tr-TR");
  const width = Math.min(100, Math.max(48, label.length * 8 + 28));
  const fontSize = count >= 1000 ? 10 : count >= 100 ? 11 : 12;
  return L.divIcon({
    className: "poly-sozlesme-map-badge",
    html: `<div style="width:${width}px;display:flex;flex-direction:column;align-items:center;gap:2px;font-family:Outfit,sans-serif;pointer-events:auto;cursor:pointer">
      <div style="width:100%;padding:4px 6px;border-radius:10px;background:linear-gradient(135deg,#f97316,#ea580c);color:#fff;font-weight:800;font-size:${fontSize}px;text-align:center;border:2px solid #fff;box-shadow:0 2px 10px rgba(234,88,12,.45);line-height:1.2">${label}</div>
      <div style="font-size:8px;font-weight:700;color:#c2410c;background:rgba(255,255,255,.95);padding:2px 6px;border-radius:6px;border:1px solid #fed7aa">Sözleşme</div>
    </div>`,
    iconAnchor: [width / 2, 42],
    iconSize: [width, 42],
  });
}

function createUzaktanCountIcon(count: number) {
  const label = count.toLocaleString("tr-TR");
  const width = Math.min(100, Math.max(48, label.length * 8 + 28));
  const fontSize = count >= 1000 ? 10 : count >= 100 ? 11 : 12;
  return L.divIcon({
    className: "uzaktan-count-map-badge",
    html: `<div style="width:${width}px;display:flex;flex-direction:column;align-items:center;gap:2px;font-family:Outfit,sans-serif;pointer-events:auto;cursor:pointer">
      <div style="width:100%;padding:4px 6px;border-radius:10px;background:linear-gradient(135deg,#8b5cf6,${UZAKTAN_MATCH_COLOR});color:#fff;font-weight:800;font-size:${fontSize}px;text-align:center;border:2px solid #fff;box-shadow:0 2px 10px rgba(124,58,237,.5);line-height:1.2">${label}</div>
      <div style="font-size:8px;font-weight:700;color:#6d28d9;background:rgba(255,255,255,.95);padding:2px 6px;border-radius:6px;border:1px solid #ddd6fe">Uzaktan</div>
    </div>`,
    iconAnchor: [width / 2, 42],
    iconSize: [width, 42],
  });
}

function normSayacDigits(value: string) {
  return value.trim().replace(/^2025-/i, "").replace(/\D/g, "");
}

function normKapiNo(value: string) {
  return value.trim().toLocaleUpperCase("tr-TR").replace(/\s+/g, "");
}

function escHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}

function ringArea(ring: [number, number][]) {
  let area = 0;
  for (let i = 0; i < ring.length; i++) {
    const [lat1, lng1] = ring[i];
    const [lat2, lng2] = ring[(i + 1) % ring.length];
    area += lng1 * lat2 - lng2 * lat1;
  }
  return Math.abs(area / 2);
}

function pointInRing(lat: number, lng: number, ring: [number, number][]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [latI, lngI] = ring[i];
    const [latJ, lngJ] = ring[j];
    const intersects =
      lngI > lng !== lngJ > lng &&
      lat < ((latJ - latI) * (lng - lngI)) / (lngJ - lngI || Number.EPSILON) + latI;
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointSegmentDistanceSquared(
  lat: number,
  lng: number,
  [latA, lngA]: [number, number],
  [latB, lngB]: [number, number]
) {
  const dx = lngB - lngA;
  const dy = latB - latA;
  if (dx === 0 && dy === 0) return (lng - lngA) ** 2 + (lat - latA) ** 2;
  const t = Math.max(0, Math.min(1, ((lng - lngA) * dx + (lat - latA) * dy) / (dx * dx + dy * dy)));
  const nearestLng = lngA + t * dx;
  const nearestLat = latA + t * dy;
  return (lng - nearestLng) ** 2 + (lat - nearestLat) ** 2;
}

function distanceFromRingSquared(lat: number, lng: number, ring: [number, number][]) {
  let minimum = Number.POSITIVE_INFINITY;
  for (let i = 0; i < ring.length; i++) {
    minimum = Math.min(
      minimum,
      pointSegmentDistanceSquared(lat, lng, ring[i], ring[(i + 1) % ring.length])
    );
  }
  return minimum;
}

function getBuildingCenter(coordinates?: [number, number][][]) {
  const validRings = coordinates?.filter((ring) => ring.length >= 3) ?? [];
  if (validRings.length === 0) return null;

  // Multi-poligonda sayaç etiketi en büyük bina parçasına yerleşir.
  const ring = [...validRings].sort((a, b) => ringArea(b) - ringArea(a))[0];
  const lats = ring.map(([lat]) => lat);
  const lngs = ring.map(([, lng]) => lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);

  // İçeride kalan adaylar arasından kenarlara en uzak olanı seçerek pinin
  // girintili/uzun binalarda komşu poligona taşmasını engeller.
  let best: { lat: number; lng: number; distance: number } | null = null;
  const gridSize = 24;
  for (let y = 0; y <= gridSize; y++) {
    const lat = minLat + ((maxLat - minLat) * y) / gridSize;
    for (let x = 0; x <= gridSize; x++) {
      const lng = minLng + ((maxLng - minLng) * x) / gridSize;
      if (!pointInRing(lat, lng, ring)) continue;
      const distance = distanceFromRingSquared(lat, lng, ring);
      if (!best || distance > best.distance) best = { lat, lng, distance };
    }
  }

  if (best) return L.latLng(best.lat, best.lng);
  const [fallbackLat, fallbackLng] = ring[0];
  return L.latLng(fallbackLat, fallbackLng);
}

function buildingHasSayacKaydi(building: Building | undefined): boolean {
  if (!building) return false;
  return resolveBuildingVisual(building).hasSayac;
}

function createSayacPinIcon(sayacId: string, opts?: { coordinated?: boolean }) {
  const label = escHtml(sayacId.trim() || "Sayaç");
  const coordinated = opts?.coordinated !== false;
  // Koordinatlı / kayıtlı sayaç pinleri yeşil (bina rengi ile uyumlu)
  const c1 = coordinated ? "#10b981" : "#0ba5ec";
  const c2 = coordinated ? "#059669" : "#026aa2";
  const glow = coordinated ? "16,185,129" : "2,106,162";
  const radar = coordinated ? "16,185,129" : "11,165,236";

  return L.divIcon({
    className: "sayac-pin-marker",
    html: `<div style="position:relative;width:160px;height:88px;display:flex;align-items:flex-end;justify-content:center;font-family:Outfit,sans-serif;pointer-events:none">
      <div style="position:absolute;bottom:12px;left:50%;width:54px;height:54px;margin-left:-27px;border-radius:50%;border:2px solid rgba(${radar},0.55);animation:sayacRadarPulse 2.2s ease-out infinite"></div>
      <div style="position:absolute;bottom:12px;left:50%;width:54px;height:54px;margin-left:-27px;border-radius:50%;border:2px solid rgba(${radar},0.35);animation:sayacRadarPulse 2.2s ease-out infinite;animation-delay:1.1s"></div>
      <div style="position:relative;z-index:2;display:flex;flex-direction:column;align-items:center">
        <div style="animation:sayacPinPulse 1.4s ease-in-out infinite;background:linear-gradient(135deg,${c1},${c2});color:#fff;font-weight:800;font-size:11px;padding:5px 10px;border-radius:10px;border:2.5px solid #fff;box-shadow:0 4px 14px rgba(${glow},.55);white-space:nowrap;max-width:150px;overflow:hidden;text-overflow:ellipsis;">${label}</div>
        <div style="width:0;height:0;border-left:9px solid transparent;border-right:9px solid transparent;border-top:13px solid ${c2};margin-top:-1px;filter:drop-shadow(0 2px 3px rgba(0,0,0,.35));"></div>
      </div>
    </div>`,
    iconSize: [160, 88],
    iconAnchor: [80, 88],
  });
}

function createKapiPinIcon(kapiNo: string) {
  const label = escHtml(kapiNo.trim() || "Kapı");
  return L.divIcon({
    className: "kapi-pin-marker",
    html: `<div style="position:relative;width:160px;height:88px;display:flex;align-items:flex-end;justify-content:center;font-family:Outfit,sans-serif;pointer-events:none">
      <div style="position:relative;z-index:2;display:flex;flex-direction:column;align-items:center">
        <div style="background:linear-gradient(135deg,#0ba5ec,#026aa2);color:#fff;font-weight:800;font-size:11px;padding:5px 10px;border-radius:10px;border:2.5px solid #fff;box-shadow:0 4px 14px rgba(2,106,162,.55);white-space:nowrap;max-width:150px;overflow:hidden;text-overflow:ellipsis;">No ${label}</div>
        <div style="width:0;height:0;border-left:9px solid transparent;border-right:9px solid transparent;border-top:13px solid #026aa2;margin-top:-1px;"></div>
      </div>
    </div>`,
    iconSize: [160, 88],
    iconAnchor: [80, 88],
  });
}

interface BuildingPolygonStyle {
  color: string;
  fillColor: string;
  fillOpacity: number;
  weight: number;
}

interface BuildingVisual extends BuildingPolygonStyle {
  headerColor: string;
  hasSayac: boolean;
  hasTarife: boolean;
}

function resolveBuildingVisual(building: Building): BuildingVisual {
  const hasSayac = (building.sayac_count ?? 0) > 0;
  const hasTarife = !!building.has_tarife && !!building.tarife_sinif;
  const isSynthetic = String(building.layer ?? "").includes("KOORDINAT_SENTETIK");
  const polyColor = hasSayac ? "#10b981" : "#465fff";

  return {
    color: polyColor,
    fillColor: polyColor,
    fillOpacity: hasSayac ? (isSynthetic ? 0.58 : 0.48) : 0.25,
    weight: hasSayac ? 2.5 : 1.5,
    headerColor: polyColor,
    hasSayac,
    hasTarife,
  };
}

const POPUP_BTN_ATTRS = (cls: string, building: Building, escValue: string, escLayer: string) =>
  `class="${cls} bina-map-popup-btn" data-bina-id="${building.id}" data-value="${escValue}" data-layer="${escLayer}" data-oda-id="${building.oda_id ?? ""}"`;

function buildPopupContent(building: Building, visual: BuildingVisual): string {
  const escValue = (building.value || "").replace(/"/g, "&quot;");
  const escLayer = (building.layer || "").replace(/"/g, "&quot;");
  const tarifeAccent = getTarifeColor(building.tarife_sinif);
  const sayacCount = building.sayac_count ?? building.aktif_abone_sayisi ?? 0;
  const statusLabel = visual.hasSayac ? `${sayacCount} Sayaç Kayıtlı` : "Sayaç Kaydı Yok";
  const statusBg = visual.hasSayac ? "#ecfdf3" : "#f0f9ff";
  const statusColor = visual.hasSayac ? "#027a48" : "#026aa2";
  const statusBorder = visual.hasSayac ? "#a6f4c5" : "#b9e6fe";

  const tarifeBlock = visual.hasTarife
    ? `<div style="margin-top:8px;overflow:hidden;border-radius:10px;border:1px solid ${tarifeAccent}55;background:linear-gradient(135deg,${tarifeAccent}12,transparent);">
        <div style="padding:6px 10px;background:${tarifeAccent}18;">
          <div style="font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;color:#475467;">Rezerv Alan Tarifesi</div>
        </div>
        <div style="padding:8px 10px;">
          <div style="font-weight:700;color:${tarifeAccent};font-size:12px;line-height:1.3;">${building.tarife_etiket || "—"}${building.tarife_karma ? " (Karma)" : ""}</div>
          ${building.tarife_turu ? `<div style="font-size:10px;color:#667085;margin-top:3px;line-height:1.35;">${building.tarife_turu.length > 70 ? building.tarife_turu.slice(0, 70) + "…" : building.tarife_turu}</div>` : ""}
          ${building.rezerv_abone_sayisi ? `<div style="font-size:10px;color:#667085;margin-top:4px;">Rezerv abone: <strong style="color:#344054;">${building.rezerv_abone_sayisi}</strong></div>` : ""}
        </div>
      </div>`
    : "";

  return `
    <div class="bina-map-popup" style="font-family:Outfit,sans-serif;font-size:13px;color:#101828;min-width:260px;">
      <div style="border-top:4px solid ${visual.headerColor};border-bottom:1px solid #e4e7ec;padding:10px 12px;">
        <div style="display:flex;align-items:flex-start;gap:10px;">
          <div style="display:flex;width:38px;height:38px;flex-shrink:0;align-items:center;justify-content:center;border-radius:10px;background:#f0f9ff;color:#026aa2;font-size:12px;font-weight:700;font-variant-numeric:tabular-nums;">
            ${building.oda_id ?? "—"}
          </div>
          <div style="display:flex;min-width:0;flex:1;flex-direction:column;gap:4px;">
            <div style="font-size:13px;font-weight:700;color:#101828;line-height:1.25;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:180px;" title="${escValue}">
              ${building.value || "Bilinmeyen Bina"}
            </div>
            ${building.layer ? `<span style="display:inline-flex;width:fit-content;border-radius:9999px;border:1px solid #7cd4fd99;background:#f0f9ff;padding:2px 8px;font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#026aa2;">${building.layer}</span>` : ""}
            <span style="display:inline-flex;width:fit-content;border-radius:9999px;border:1px solid ${statusBorder};background:${statusBg};padding:2px 8px;font-size:8px;font-weight:700;color:${statusColor};">${statusLabel}</span>
          </div>
        </div>
      </div>

      <div style="padding:10px 12px 12px;">
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;">
          <div style="border-radius:8px;border:1px solid #e4e7ec;background:#f9fafb;padding:7px 8px;">
            <div style="font-size:9px;font-weight:500;color:#667085;">Kayıtlı Sayaç</div>
            <div style="margin-top:2px;font-size:15px;font-weight:700;font-variant-numeric:tabular-nums;color:#101828;">${sayacCount}</div>
          </div>
          <div style="border-radius:8px;border:1px solid #e4e7ec;background:#f9fafb;padding:7px 8px;">
            <div style="font-size:9px;font-weight:500;color:#667085;">Aktif Abone</div>
            <div style="margin-top:2px;font-size:15px;font-weight:700;font-variant-numeric:tabular-nums;color:#101828;">${building.aktif_abone_sayisi}</div>
          </div>
          <div style="border-radius:8px;border:1px solid #e4e7ec;background:#f9fafb;padding:7px 8px;">
            <div style="font-size:9px;font-weight:500;color:#667085;">Dış Kapı No</div>
            <div style="margin-top:2px;font-size:13px;font-weight:700;color:#101828;line-height:1.2;">${building.dis_kapi_no ? escHtml(building.dis_kapi_no) : "—"}</div>
          </div>
        </div>

        ${tarifeBlock}

        <div style="display:flex;flex-direction:column;gap:6px;margin-top:10px;">
          <button
            ${POPUP_BTN_ATTRS("bina-bilgi-btn", building, escValue, escLayer)}
            style="width:100%;padding:8px 12px;background:linear-gradient(to right,#065986,#026aa2);color:#fff;border:none;border-radius:10px;font-size:11px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;font-family:Outfit,sans-serif;box-shadow:0 2px 6px rgba(2,106,162,0.25);"
          >
            <span style="font-size:13px;">🏢</span> Bina Bilgileri
          </button>
          <button
            ${POPUP_BTN_ATTRS("bina-sayac-btn", building, escValue, escLayer)}
            style="width:100%;padding:8px 12px;background:#f0f9ff;color:#026aa2;border:1.5px dashed #7cd4fd;border-radius:10px;font-size:11px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;font-family:Outfit,sans-serif;"
          >
            <span style="font-size:13px;">⚡</span> Sayaç Ekle / Düzenle
          </button>
        </div>
      </div>
    </div>
  `;
}

const TILE_LAYERS = {
  standard: {
    label: "Standart",
    shortLabel: "Standart",
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    isDark: false,
  },
  light: {
    label: "Açık",
    shortLabel: "Açık",
    url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
    isDark: false,
  },
  dark: {
    label: "Gece",
    shortLabel: "Gece",
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
    isDark: true,
  },
  satellite: {
    label: "Uydu",
    shortLabel: "Uydu",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: '&copy; <a href="https://www.esri.com/">Esri</a>, Maxar, GeoEye, Earthstar Geographics',
    isDark: false,
  },
  topo: {
    label: "Topoğrafik",
    shortLabel: "Topo",
    url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://opentopomap.org/">OpenTopoMap</a>',
    isDark: false,
  },
} as const;

const MAP_TOOLBAR_SURFACE =
  "rounded-xl border border-slate-200/80 bg-white/92 shadow-[0_8px_28px_rgba(15,23,42,0.08)] backdrop-blur-md dark:border-slate-700/70 dark:bg-slate-950/90 dark:shadow-[0_8px_28px_rgba(0,0,0,0.35)]";
const MAP_TOOLBAR_CARD = `${MAP_TOOLBAR_SURFACE} overflow-hidden`;
const MAP_DROPDOWN_PANEL = `${MAP_TOOLBAR_SURFACE} z-[1001]`;
const MAP_TOOLBAR_BTN =
  "flex items-center justify-center gap-1.5 rounded-lg border border-slate-200/90 bg-slate-50/90 px-2 py-2 text-[10px] font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-white dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-200 dark:hover:border-slate-600 dark:hover:bg-slate-800";
const MAP_SECTION_LABEL =
  "px-1 text-[9px] font-semibold uppercase tracking-[0.08em] text-slate-400 dark:text-slate-500";

type TileKey = keyof typeof TILE_LAYERS;

export default function MapComponent() {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const activeTileRef = useRef<L.TileLayer | null>(null);
  const allBoundsRef = useRef<L.LatLngBounds | null>(null);
  const activeHighlightRef = useRef<L.Polygon | null>(null);
  const sayacMarkerRef = useRef<L.Marker | null>(null);
  const sayacResultsRef = useRef<SayacSearchResult[]>([]);
  const buildingPolygonsRef = useRef<Map<number, L.Polygon[]>>(new Map());
  const buildingStylesRef = useRef<Map<number, BuildingPolygonStyle>>(new Map());
  const buildingsDataRef = useRef<Map<number, Building>>(new Map());
  const highlightedBinaIdRef = useRef<number | null>(null);
  const buildingAlarmIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sorunMarkersRef = useRef<L.Marker[]>([]);
  const bugunMarkersRef = useRef<L.Marker[]>([]);
  const polySozlesmeMarkersRef = useRef<L.Marker[]>([]);
  const polySozlesmeBinalarRef = useRef<PolySozlesmeBina[]>([]);
  const uzaktanCountMarkersRef = useRef<L.Marker[]>([]);
  const uzaktanBinalarRef = useRef<Map<number, UzaktanBinaEntry>>(new Map());
  const lastDeepLinkKeyRef = useRef<string | null>(null);
  const lastBinaFocusIdRef = useRef<number | null>(null);
  const applySayacDeepLinkRef = useRef<(binaId: number, sayacParam: string) => boolean>(() => false);
  const applyBinaFocusRef = useRef<(binaId: number) => boolean>(() => false);

  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState({ total: 0, rezervClassified: 0 });
  const [toplamSayac, setToplamSayac] = useState(0);
  const [koordinatliSayac, setKoordinatliSayac] = useState(0);
  const [sorunOzet, setSorunOzet] = useState<SayacSorunOzet | null>(null);
  const [bugunOzet, setBugunOzet] = useState<BugunOzet | null>(null);
  const [bugunLayerEnabled, setBugunLayerEnabled] = useState(false);
  const [bugunPanelOpen, setBugunPanelOpen] = useState(false);
  const [polySozlesmeOzet, setPolySozlesmeOzet] = useState<PolySozlesmeOzet | null>(null);
  const [polySozlesmeLayerEnabled, setPolySozlesmeLayerEnabled] = useState(false);
  const [polySozlesmePanelOpen, setPolySozlesmePanelOpen] = useState(false);
  const [leftDockOpen, setLeftDockOpen] = useState(true);
  const [sorunDockOpen, setSorunDockOpen] = useState(false);
  const [sorunLayerEnabled, setSorunLayerEnabled] = useState(false);
  const [uzaktanLayerEnabled, setUzaktanLayerEnabled] = useState(false);
  const [uzaktanTypeFilter, setUzaktanTypeFilter] = useState<UzaktanTypeFilter>("all");
  const [uzaktanStats, setUzaktanStats] = useState<UzaktanSozlesmeIndex["stats"] | null>(null);
  const [uzaktanTypeOptions, setUzaktanTypeOptions] = useState<
    Array<{ id: string; label: string; color: string; matched_count: number }>
  >([]);
  const [uzaktanDataReady, setUzaktanDataReady] = useState(false);

  // Layer switcher UI state
  const [activeLayer, setActiveLayer] = useState<TileKey>("standard");
  const [layerPickerOpen, setLayerPickerOpen] = useState(false);
  const [uzaktanPanelOpen, setUzaktanPanelOpen] = useState(false);

  // Neighborhood UI state
  const [mahalleList, setMahalleList] = useState<MahalleListItem[]>([]);
  const [selectedMahalle, setSelectedMahalle] = useState<string>("Mahalleler");
  const [mahallePickerOpen, setMahallePickerOpen] = useState(false);
  const [mahalleSearch, setMahalleSearch] = useState("");

  // Sayaç search state
  const [sayacSearch, setSayacSearch] = useState("");
  const [sayacResults, setSayacResults] = useState<SayacSearchResult[]>([]);
  const [sayacSearchOpen, setSayacSearchOpen] = useState(false);
  const [sayacSearching, setSayacSearching] = useState(false);
  const [selectedSayacLabel, setSelectedSayacLabel] = useState<string | null>(null);
  const [selectedSayacTarget, setSelectedSayacTarget] = useState<{
    bina_id: number;
    sayac_id: string;
    building_name?: string;
  } | null>(null);
  const [focusSayacId, setFocusSayacId] = useState<string | null>(null);
  const [sayacAlarmActive, setSayacAlarmActive] = useState(false);
  const [shareFeedback, setShareFeedback] = useState<string | null>(null);
  const [sharePanelOpen, setSharePanelOpen] = useState(false);
  const [sharePanelUrl, setSharePanelUrl] = useState<string | null>(null);
  const [jsonExporting, setJsonExporting] = useState(false);
  const [jsonExportError, setJsonExportError] = useState<string | null>(null);

  // Dış kapı arama (sayaç aramasından bağımsız)
  const [kapiSearch, setKapiSearch] = useState("");
  const [kapiResults, setKapiResults] = useState<KapiSearchResult[]>([]);
  const [kapiSearchOpen, setKapiSearchOpen] = useState(false);
  const [kapiSearching, setKapiSearching] = useState(false);
  const kapiResultsRef = useRef<KapiSearchResult[]>([]);
  const [selectedKapiLabel, setSelectedKapiLabel] = useState<string | null>(null);
  const [selectedKapiTarget, setSelectedKapiTarget] = useState<KapiSearchResult | null>(null);

  // Modals state
  const [selectedBuilding, setSelectedBuilding] = useState<SelectedBuilding | null>(null);
  const [infoModalOpen, setInfoModalOpen] = useState(false);
  const [sayacModalOpen, setSayacModalOpen] = useState(false);
  const [sorunPanelOpen, setSorunPanelOpen] = useState(false);
  const [sorunPanelFilter, setSorunPanelFilter] = useState<SorunListeFilter>("all");

  const { setPanelOpen: setNotifPanelOpen, refresh: refreshNotifications } = useNotifications();
  const { isAdmin } = useAuthUser();

  const { theme } = useTheme();

  // Stable callback refs for Leaflet events
  const openInfoModalRef = useRef<(b: SelectedBuilding) => void>(() => {});
  openInfoModalRef.current = (b: SelectedBuilding) => {
    setSelectedBuilding(b);
    setInfoModalOpen(true);
  };

  const openSayacModalRef = useRef<(b: SelectedBuilding) => void>(() => {});
  openSayacModalRef.current = (b: SelectedBuilding) => {
    setSelectedBuilding(b);
    setSayacModalOpen(true);
  };

  const applyBuildingStylesForLayer = useCallback(
    (uzaktanEnabled: boolean, filter: UzaktanTypeFilter) => {
      buildingPolygonsRef.current.forEach((polygons, binaId) => {
        const building = buildingsDataRef.current.get(binaId);
        if (!building) return;

        let style: BuildingPolygonStyle;
        if (uzaktanEnabled) {
          const entry = uzaktanBinalarRef.current.get(binaId);
          const uzaktanStyle = resolveUzaktanBuildingStyle(entry, filter, true);
          style = uzaktanStyle.visible
            ? {
                color: uzaktanStyle.color,
                fillColor: uzaktanStyle.fillColor,
                fillOpacity: uzaktanStyle.fillOpacity,
                weight: uzaktanStyle.weight,
              }
            : { ...UZAKTAN_DIM_STYLE };
        } else {
          const visual = resolveBuildingVisual(building);
          style = {
            color: visual.color,
            fillColor: visual.fillColor,
            fillOpacity: visual.fillOpacity,
            weight: visual.weight,
          };
        }

        buildingStylesRef.current.set(binaId, style);
        if (highlightedBinaIdRef.current === binaId) return;
        polygons.forEach((polygon) => polygon.setStyle(style));
      });

      if (uzaktanEnabled) {
        uzaktanBinalarRef.current.forEach((entry, binaId) => {
          if (!binaMatchesUzaktanFilter(entry, filter)) return;
          const polygons = buildingPolygonsRef.current.get(binaId);
          polygons?.forEach((polygon) => polygon.bringToFront());
        });
      } else {
        for (const building of buildingsDataRef.current.values()) {
          if (!resolveBuildingVisual(building).hasSayac) continue;
          const polygons = buildingPolygonsRef.current.get(building.id);
          polygons?.forEach((polygon) => polygon.bringToFront());
        }
      }
    },
    []
  );

  // Sync theme changes
  useEffect(() => {
    if (!mapRef.current) return;
    setActiveLayer((prev) => {
      if (prev === "standard" || prev === "light" || prev === "dark") {
        return theme === "dark" ? "dark" : "standard";
      }
      return prev;
    });
  }, [theme]);

  const renderBugunMarkers = (binalar: BugunBina[], enabled: boolean) => {
    const map = mapRef.current;
    if (!map) return;
    bugunMarkersRef.current.forEach((m) => map.removeLayer(m));
    bugunMarkersRef.current = [];
    if (!enabled) return;

    for (const b of binalar) {
      if (!b.center || b.count <= 0) continue;
      const marker = L.marker([b.center.lat, b.center.lng], {
        icon: createBugunIcon(b.count),
        zIndexOffset: 1100,
      });
      const list = b.items
        .slice(0, 8)
        .map((item) => {
          const label = [item.kapi_no, item.kat, item.blok_no].filter(Boolean).join(" · ");
          return `<div style="font-size:10px;padding:3px 0;border-bottom:1px solid #e0f2fe"><span style="font-weight:600;color:#0c4a6e">${escHtml(label || "—")}</span> · <span style="color:#0369a1">${escHtml(item.sayac_id)}</span></div>`;
        })
        .join("");
      const more = b.count > 8 ? `<div style="font-size:9px;color:#0284c7;margin-top:4px">+${b.count - 8} kayıt daha…</div>` : "";
      marker.bindPopup(`
        <div style="font-family:Outfit,sans-serif;font-size:13px;min-width:220px;max-width:280px">
          <div style="font-weight:700;color:#0c4a6e">${escHtml(b.value)}</div>
          <div style="font-size:10px;color:#0284c7;margin:4px 0 8px">Bugün eklenen/güncellenen: <strong>${b.count}</strong> sayaç</div>
          <div style="max-height:140px;overflow-y:auto">${list}${more}</div>
          <div style="margin-top:6px;font-size:9px;color:#64748b">Son: ${formatBugunTime(b.last_at)}</div>
        </div>
      `);
      marker.on("click", () => zoomToBuilding(b.bina_id));
      marker.addTo(map);
      bugunMarkersRef.current.push(marker);
    }
  };

  const renderPolySozlesmeMarkers = (binalar: PolySozlesmeBina[], enabled: boolean) => {
    const map = mapRef.current;
    if (!map) return;
    polySozlesmeMarkersRef.current.forEach((m) => map.removeLayer(m));
    polySozlesmeMarkersRef.current = [];
    if (!enabled) return;

    for (const b of binalar) {
      if (!b.center || b.count <= 0) continue;
      const marker = L.marker([b.center.lat, b.center.lng], {
        icon: createPolySozlesmeIcon(b.count),
        zIndexOffset: 1050,
      });
      marker.bindPopup(`
        <div style="font-family:Outfit,sans-serif;font-size:13px;min-width:200px">
          <div style="font-weight:700;color:#9a3412">${escHtml(b.value)}</div>
          <div style="font-size:11px;color:#c2410c;margin:6px 0 2px">
            <strong>${b.count.toLocaleString("tr-TR")}</strong> Polimeter sözleşme
          </div>
          <div style="font-size:10px;color:#78716c">${b.sayac_sayisi.toLocaleString("tr-TR")} sayaç kaydı</div>
        </div>
      `);
      marker.on("click", () => zoomToBuilding(b.bina_id));
      marker.addTo(map);
      polySozlesmeMarkersRef.current.push(marker);
    }
  };

  const renderUzaktanCountMarkers = (enabled: boolean, filter: UzaktanTypeFilter) => {
    const map = mapRef.current;
    if (!map) return;
    uzaktanCountMarkersRef.current.forEach((m) => map.removeLayer(m));
    uzaktanCountMarkersRef.current = [];
    if (!enabled) return;

    uzaktanBinalarRef.current.forEach((entry, binaId) => {
      if (!binaMatchesUzaktanFilter(entry, filter) || entry.sayac_count <= 0) return;
      const building = buildingsDataRef.current.get(binaId);
      const center = getBuildingCenter(building?.coordinates);
      if (!center) return;

      const count =
        filter === "all" ? entry.sayac_count : entry.by_type[filter] ?? 0;
      if (count <= 0) return;

      const marker = L.marker([center.lat, center.lng], {
        icon: createUzaktanCountIcon(count),
        zIndexOffset: 1060,
      });
      marker.bindPopup(`
        <div style="font-family:Outfit,sans-serif;font-size:13px;min-width:200px">
          <div style="font-weight:700;color:#5b21b6">${escHtml(building?.value || "Bina")}</div>
          <div style="font-size:11px;color:#6d28d9;margin:6px 0 2px">
            <strong>${count.toLocaleString("tr-TR")}</strong> Excel ile eşleşen sayaç
          </div>
          <div style="font-size:10px;color:#78716c">Uzaktan okuma · mor = uyuşan</div>
        </div>
      `);
      marker.on("click", () => zoomToBuilding(binaId));
      marker.addTo(map);
      uzaktanCountMarkersRef.current.push(marker);
    });
  };

  const renderSorunMarkers = (binalar: SayacSorunBina[], enabled: boolean) => {
    const map = mapRef.current;
    if (!map) return;
    sorunMarkersRef.current.forEach((m) => map.removeLayer(m));
    sorunMarkersRef.current = [];
    if (!enabled) return;

    for (const b of binalar) {
      if (!b.center || !b.severity) continue;
      const marker = L.marker(b.center, { icon: createSorunIcon(b.severity), zIndexOffset: 1000 });
      const lines = [
        b.okunmadi ? `<div>🔴 Okunmadı: <strong>${b.okunmadi}</strong></div>` : "",
        b.hatali ? `<div>🔴 Hatalı: <strong>${b.hatali}</strong></div>` : "",
        b.eksik ? `<div>🟡 Eksik: <strong>${b.eksik}</strong></div>` : "",
      ].filter(Boolean).join("");
      marker.bindPopup(`
        <div style="font-family:Outfit,sans-serif;font-size:13px;min-width:180px">
          <div style="font-weight:700;margin-bottom:6px">${b.value}</div>
          ${lines}
          <div style="margin-top:8px;font-size:11px;color:#64748b">Geçerli sayaç: ${b.gecerli}</div>
        </div>
      `);
      marker.on("click", () => zoomToBuilding(b.bina_id));
      marker.addTo(map);
      sorunMarkersRef.current.push(marker);
    }
  };

  const loadToplamSayac = useCallback(() => {
    fetch("/api/dashboard/ozet")
      .then((r) => r.json())
      .then((d) => {
        setToplamSayac(d.toplam_sayac ?? 0);
        setKoordinatliSayac(d.sayac_koordinatli ?? 0);
      })
      .catch(() => {});
  }, []);

  const refreshBugunData = useCallback(() => {
    fetch("/api/sayac/bugun")
      .then((r) => r.json())
      .then((data: { ozet: BugunOzet; binalar: BugunBina[] }) => {
        setBugunOzet(data.ozet);
        renderBugunMarkers(data.binalar, bugunLayerEnabled);
      })
      .catch(() => setBugunOzet(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bugunLayerEnabled]);

  const refreshPolySozlesmeData = useCallback(() => {
    fetch("/api/sayac/polimeter")
      .then((r) => r.json())
      .then((data: { ozet: PolySozlesmeOzet; binalar: PolySozlesmeBina[] }) => {
        setPolySozlesmeOzet(data.ozet);
        polySozlesmeBinalarRef.current = data.binalar ?? [];
        renderPolySozlesmeMarkers(polySozlesmeBinalarRef.current, polySozlesmeLayerEnabled);
      })
      .catch(() => setPolySozlesmeOzet(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [polySozlesmeLayerEnabled]);

  const refreshSorunData = useCallback(() => {
    fetch("/api/sayac/sorunlar")
      .then((r) => r.json())
      .then((data: { ozet: SayacSorunOzet; binalar: SayacSorunBina[] }) => {
        setSorunOzet(data.ozet);
        renderSorunMarkers(data.binalar, sorunLayerEnabled);
      })
      .catch(() => setSorunOzet(null));
    refreshNotifications();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sorunLayerEnabled, refreshNotifications]);

  const handleSayacSaved = useCallback(
    (savedStats: { sayac_count: number; sayac_kayit: number }) => {
      if (!selectedBuilding) return;
      const binaId = selectedBuilding.id;
      const building = buildingsDataRef.current.get(binaId);
      if (!building) return;

      const oldCount = building.aktif_abone_sayisi || 0;
      const newCount = savedStats.sayac_kayit > 0 ? savedStats.sayac_count : oldCount;
      building.aktif_abone_sayisi = newCount;
      building.sayac_count = savedStats.sayac_count;
      building.sayac_kayit = savedStats.sayac_kayit;
      if (savedStats.sayac_count > 0) building.is_configured = true;
      buildingsDataRef.current.set(binaId, building);

      const visual = resolveBuildingVisual(building);
      const polygons = buildingPolygonsRef.current.get(binaId) || [];
      const popupHtml = buildPopupContent(building, visual);
      polygons.forEach((polygon) => {
        polygon.setPopupContent(popupHtml);
      });

      if (uzaktanLayerEnabled) {
        applyBuildingStylesForLayer(true, uzaktanTypeFilter);
      } else {
        polygons.forEach((polygon) => {
          polygon.setStyle({
            color: visual.color,
            fillColor: visual.fillColor,
            fillOpacity: visual.fillOpacity,
            weight: visual.weight,
          });
        });
        buildingStylesRef.current.set(binaId, {
          color: visual.color,
          fillColor: visual.fillColor,
          fillOpacity: visual.fillOpacity,
          weight: visual.weight,
        });
      }

      refreshSorunData();
      refreshBugunData();
    },
    [selectedBuilding, refreshSorunData, refreshBugunData, uzaktanLayerEnabled, uzaktanTypeFilter, applyBuildingStylesForLayer]
  );

  useEffect(() => {
    if (loading || error) return;
    loadToplamSayac();
    window.addEventListener(SAYAC_GUNCELLENDI, loadToplamSayac);
    return () => window.removeEventListener(SAYAC_GUNCELLENDI, loadToplamSayac);
  }, [loading, error, loadToplamSayac]);

  const loadUzaktanData = useCallback(() => {
    fetch("/api/uzaktan-sozlesme")
      .then((r) => r.json())
      .then((data: {
        stats: UzaktanSozlesmeIndex["stats"];
        type_options: Array<{ id: string; label: string; color: string; matched_count: number }>;
        binalar: Record<string, UzaktanBinaEntry>;
      }) => {
        setUzaktanStats(data.stats);
        setUzaktanTypeOptions(data.type_options ?? []);
        const binaMap = new Map<number, UzaktanBinaEntry>();
        for (const [key, entry] of Object.entries(data.binalar ?? {})) {
          binaMap.set(Number(key), entry);
        }
        uzaktanBinalarRef.current = binaMap;
        setUzaktanDataReady(true);
        renderUzaktanCountMarkers(uzaktanLayerEnabled, uzaktanTypeFilter);
      })
      .catch(() => {
        setUzaktanStats(null);
        setUzaktanTypeOptions([]);
        uzaktanBinalarRef.current = new Map();
        setUzaktanDataReady(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uzaktanLayerEnabled, uzaktanTypeFilter]);

  useEffect(() => {
    if (loading || error) return;
    refreshSorunData();
    refreshBugunData();
    refreshPolySozlesmeData();
    window.addEventListener(SAYAC_GUNCELLENDI, refreshBugunData);
    window.addEventListener(SAYAC_GUNCELLENDI, refreshPolySozlesmeData);
    return () => {
      window.removeEventListener(SAYAC_GUNCELLENDI, refreshBugunData);
      window.removeEventListener(SAYAC_GUNCELLENDI, refreshPolySozlesmeData);
    };
  }, [loading, error, refreshSorunData, refreshBugunData, refreshPolySozlesmeData]);

  useEffect(() => {
    renderPolySozlesmeMarkers(polySozlesmeBinalarRef.current, polySozlesmeLayerEnabled);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [polySozlesmeLayerEnabled]);

  useEffect(() => {
    if (loading || error) return;
    loadUzaktanData();
    window.addEventListener(SAYAC_GUNCELLENDI, loadUzaktanData);
    return () => window.removeEventListener(SAYAC_GUNCELLENDI, loadUzaktanData);
  }, [loading, error, loadUzaktanData]);

  useEffect(() => {
    if (loading || error || !uzaktanDataReady) return;
    applyBuildingStylesForLayer(uzaktanLayerEnabled, uzaktanTypeFilter);
    renderUzaktanCountMarkers(uzaktanLayerEnabled, uzaktanTypeFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    loading,
    error,
    uzaktanDataReady,
    uzaktanLayerEnabled,
    uzaktanTypeFilter,
    applyBuildingStylesForLayer,
  ]);

  useEffect(() => {
    if (loading || error || !sorunOzet) return;
    fetch("/api/sayac/sorunlar")
      .then((r) => r.json())
      .then((data: { binalar: SayacSorunBina[] }) => renderSorunMarkers(data.binalar, sorunLayerEnabled))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sorunLayerEnabled]);

  // Switch tile layer
  useEffect(() => {
    if (!mapRef.current) return;
    const map = mapRef.current;
    const def = TILE_LAYERS[activeLayer];

    if (activeTileRef.current) {
      map.removeLayer(activeTileRef.current);
    }

    const newTile = L.tileLayer(def.url, {
      attribution: def.attribution,
      maxZoom: 19,
    });

    newTile.addTo(map);
    newTile.bringToBack();
    activeTileRef.current = newTile;
  }, [activeLayer]);

  // Load neighborhood list from database
  useEffect(() => {
    fetch("/api/mahalleler")
      .then((res) => {
        if (!res.ok) throw new Error("Mahalle listesi alınamadı.");
        return res.json();
      })
      .then((data: MahalleListItem[]) => {
        setMahalleList(data);
      })
      .catch((err) => {
        console.error("Error loading neighborhood list:", err);
      });
  }, []);

  const clearBuildingHighlight = () => {
    highlightedBinaIdRef.current = null;
    buildingPolygonsRef.current.forEach((polygons, binaId) => {
      const style = buildingStylesRef.current.get(binaId);
      if (!style) return;
      polygons.forEach((polygon) => {
        polygon.setStyle({
          color: style.color,
          fillColor: style.fillColor,
          fillOpacity: style.fillOpacity,
          weight: style.weight,
        });
      });
    });
  };

  const clearBuildingAlarm = useCallback(() => {
    if (buildingAlarmIntervalRef.current) {
      clearInterval(buildingAlarmIntervalRef.current);
      buildingAlarmIntervalRef.current = null;
    }
  }, []);

  const highlightBuildingAlarm = useCallback(
    (binaId: number) => {
      clearBuildingAlarm();
      clearBuildingHighlight();
      highlightedBinaIdRef.current = binaId;
      const polygons = buildingPolygonsRef.current.get(binaId) || [];
      let pulseOn = false;

      buildingAlarmIntervalRef.current = setInterval(() => {
        pulseOn = !pulseOn;
        polygons.forEach((polygon) => {
          polygon.setStyle({
            color: "#ef4444",
            fillColor: "#ef4444",
            fillOpacity: pulseOn ? 0.48 : 0.32,
            weight: pulseOn ? 5 : 3,
          });
          polygon.bringToFront();
        });
      }, 650);

      return polygons;
    },
    [clearBuildingAlarm]
  );

  const triggerSayacAlarm = useCallback(() => {
    setSayacAlarmActive(true);
  }, []);

  const stopSayacAlarm = useCallback(() => {
    setSayacAlarmActive(false);
    clearBuildingAlarm();
    clearBuildingHighlight();
  }, [clearBuildingAlarm]);

  const highlightBuildingForSayacSearch = useCallback(
    (binaId: number) => {
      const building = buildingsDataRef.current.get(binaId);
      const hasSayac = building ? resolveBuildingVisual(building).hasSayac : false;
      if (hasSayac) {
        clearBuildingAlarm();
        return highlightBuilding(binaId);
      }
      return highlightBuildingAlarm(binaId);
    },
    [clearBuildingAlarm]
  );

  const clearSayacMarker = useCallback(() => {
    if (mapRef.current && sayacMarkerRef.current) {
      mapRef.current.removeLayer(sayacMarkerRef.current);
      sayacMarkerRef.current = null;
    }
  }, []);

  const placeSayacMarker = useCallback(
    (binaId: number, sayacId: string, coordinates?: [number, number][][], point?: { lat: number; lng: number } | null) => {
      if (!mapRef.current || !sayacId.trim()) return;
      clearSayacMarker();
      const building = buildingsDataRef.current.get(binaId);
      if (!buildingHasSayacKaydi(building)) return;

      const exact =
        point &&
        Number.isFinite(point.lat) &&
        Number.isFinite(point.lng) &&
        Math.abs(point.lat) <= 90 &&
        Math.abs(point.lng) <= 180
          ? ([point.lat, point.lng] as [number, number])
          : null;
      const center = exact ?? getBuildingCenter(coordinates ?? building?.coordinates);
      if (!center) return;

      const marker = L.marker(center, {
        icon: createSayacPinIcon(sayacId),
        zIndexOffset: 2500,
      }).addTo(mapRef.current);

      sayacMarkerRef.current = marker;
    },
    [clearSayacMarker]
  );

  const placeKapiMarker = useCallback(
    (kapiNo: string, lat: number, lng: number) => {
      if (!mapRef.current || !kapiNo.trim()) return;
      clearSayacMarker();
      const marker = L.marker([lat, lng], {
        icon: createKapiPinIcon(kapiNo),
        zIndexOffset: 2500,
      }).addTo(mapRef.current);
      sayacMarkerRef.current = marker;
    },
    [clearSayacMarker]
  );

  const highlightBuilding = (binaId: number) => {
    clearBuildingHighlight();
    highlightedBinaIdRef.current = binaId;
    const building = buildingsDataRef.current.get(binaId);
    const visual = building ? resolveBuildingVisual(building) : null;
    const highlightStyle: BuildingPolygonStyle = visual?.hasSayac
      ? {
          color: "#10b981",
          fillColor: "#10b981",
          fillOpacity: 0.55,
          weight: 4,
        }
      : {
          color: "#f59e0b",
          fillColor: "#f59e0b",
          fillOpacity: 0.55,
          weight: 4,
        };
    const polygons = buildingPolygonsRef.current.get(binaId) || [];
    polygons.forEach((polygon) => {
      polygon.setStyle(highlightStyle);
      polygon.bringToFront();
    });
    return polygons;
  };

  useEffect(() => {
    sayacResultsRef.current = sayacResults;
  }, [sayacResults]);

  useEffect(() => {
    kapiResultsRef.current = kapiResults;
  }, [kapiResults]);

  // Debounced sayaç search (dropdown — not the sayaç modal)
  useEffect(() => {
    const q = sayacSearch.trim();
    if (q.length < 3) {
      setSayacResults([]);
      setSayacSearching(false);
      return;
    }

    if (sayacModalOpen || focusSayacId) {
      setSayacSearching(false);
      return;
    }

    setSayacSearching(true);
    const timer = setTimeout(() => {
      fetch(`/api/sayac/search?q=${encodeURIComponent(q)}`)
        .then((res) => {
          if (!res.ok) throw new Error("Arama başarısız");
          return res.json();
        })
        .then((data: SayacSearchResult[]) => {
          setSayacResults(data);
          setSayacSearchOpen(true);
        })
        .catch((err) => {
          console.error("Sayaç arama hatası:", err);
          setSayacResults([]);
        })
        .finally(() => setSayacSearching(false));
    }, 300);

    return () => clearTimeout(timer);
  }, [sayacSearch, sayacModalOpen, focusSayacId]);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    let cancelled = false;

    const map = L.map(mapContainerRef.current, {
      zoomControl: false,
    }).setView([38.3552, 38.3302], 14);

    mapRef.current = map;

    const initialLayerKey: TileKey = theme === "dark" ? "dark" : "standard";
    const initialDef = TILE_LAYERS[initialLayerKey];
    const initialTile = L.tileLayer(initialDef.url, {
      attribution: initialDef.attribution,
      maxZoom: 19,
    }).addTo(map);
    activeTileRef.current = initialTile;
    setActiveLayer(initialLayerKey);

    L.control.zoom({ position: "bottomleft" }).addTo(map);

    map.on("moveend", () => {
      if (!mapRef.current) return;
      const center = map.getCenter();
      saveMapView(center.lat, center.lng, map.getZoom());
    });

    // Listen for popup buttons
    map.on("popupopen", (e) => {
      const el = e.popup.getElement();
      if (!el) return;

      const infoBtn = el.querySelector<HTMLButtonElement>(".bina-bilgi-btn");
      if (infoBtn) {
        infoBtn.onclick = () => {
          const id = parseInt(infoBtn.dataset.binaId || "0");
          const value = infoBtn.dataset.value || null;
          const layer = infoBtn.dataset.layer || null;
          const odaId = infoBtn.dataset.odaId ? parseInt(infoBtn.dataset.odaId) : null;
          map.closePopup();
          openInfoModalRef.current({ id, value, layer, oda_id: odaId });
        };
      }

      const sayacBtn = el.querySelector<HTMLButtonElement>(".bina-sayac-btn");
      if (sayacBtn) {
        sayacBtn.onclick = () => {
          const id = parseInt(sayacBtn.dataset.binaId || "0");
          const value = sayacBtn.dataset.value || null;
          const layer = sayacBtn.dataset.layer || null;
          const odaId = sayacBtn.dataset.odaId ? parseInt(sayacBtn.dataset.odaId) : null;
          map.closePopup();
          openSayacModalRef.current({ id, value, layer, oda_id: odaId });
        };
      }
    });

    fetch("/api/binalar")
      .then((res) => {
        if (!res.ok) throw new Error("Veriler yüklenirken hata oluştu.");
        return res.json();
      })
      .then((data: Building[]) => {
        if (cancelled || !mapRef.current) return;

        let rezervClassified = 0;
        const boundsPoints: L.LatLng[] = [];

        data.forEach((building) => {
          buildingsDataRef.current.set(building.id, building);
          if (building.has_tarife) rezervClassified++;

          const visual = resolveBuildingVisual(building);

          buildingStylesRef.current.set(building.id, {
            color: visual.color,
            fillColor: visual.fillColor,
            fillOpacity: visual.fillOpacity,
            weight: visual.weight,
          });

          const buildingPolygons: L.Polygon[] = [];

          building.coordinates.forEach((polygonCoords) => {
            const polygon = L.polygon(polygonCoords, {
              color: visual.color,
              fillColor: visual.fillColor,
              fillOpacity: visual.fillOpacity,
              weight: visual.weight,
            }).addTo(map);

            polygonCoords.forEach(([lat, lng]) => {
              boundsPoints.push(L.latLng(lat, lng));
            });

            polygon.bindPopup(buildPopupContent(building, visual), {
              minWidth: 270,
              maxWidth: 300,
              className: "bina-map-popup-wrapper",
            });

            polygon.on("mouseover", () => {
              if (highlightedBinaIdRef.current === building.id) return;
              const style = buildingStylesRef.current.get(building.id);
              if (!style) return;
              polygon.setStyle({
                fillColor: style.fillColor,
                fillOpacity: Math.min(style.fillOpacity + 0.12, 0.55),
                weight: style.weight + 0.5,
              });
            });
            polygon.on("mouseout", () => {
              if (highlightedBinaIdRef.current === building.id) return;
              const style = buildingStylesRef.current.get(building.id);
              if (!style) return;
              polygon.setStyle({
                color: style.color,
                fillColor: style.fillColor,
                fillOpacity: style.fillOpacity,
                weight: style.weight,
              });
            });

            buildingPolygons.push(polygon);
          });

          if (buildingPolygons.length > 0) {
            buildingPolygonsRef.current.set(building.id, buildingPolygons);
          }
        });

        // Üst üste binen sayaçsız mavi poligonlar, sayaçlı yeşil binaları kapatmasın.
        for (const building of data) {
          if (!resolveBuildingVisual(building).hasSayac) continue;
          const polygons = buildingPolygonsRef.current.get(building.id);
          polygons?.forEach((polygon) => polygon.bringToFront());
        }

        if (cancelled || !mapRef.current) return;

        const initialDeepLink =
          typeof window !== "undefined"
            ? parseSayacDeepLink(new URLSearchParams(window.location.search))
            : null;
        const initialBinaFocus =
          typeof window !== "undefined"
            ? parseBinaFocusId(new URLSearchParams(window.location.search))
            : null;
        const savedMapView =
          typeof window !== "undefined" && !initialDeepLink && !initialBinaFocus
            ? readSavedMapView()
            : null;

        if (!initialDeepLink && !initialBinaFocus && savedMapView && mapRef.current) {
          mapRef.current.setView([savedMapView.lat, savedMapView.lng], savedMapView.zoom, {
            animate: false,
          });
        } else if (!initialDeepLink && !initialBinaFocus && boundsPoints.length > 0) {
          const bounds = L.latLngBounds(boundsPoints);
          allBoundsRef.current = bounds;
          if (bounds.isValid()) map.fitBounds(bounds, { padding: [20, 20] });
        }

        setStats({ total: data.length, rezervClassified });
        setLoading(false);

        if (initialDeepLink && mapRef.current) {
          const key = sayacDeepLinkKey(initialDeepLink.binaId, initialDeepLink.sayac);
          window.setTimeout(() => {
            if (cancelled || !mapRef.current) return;
            if (applySayacDeepLinkRef.current(initialDeepLink.binaId, initialDeepLink.sayac)) {
              lastDeepLinkKeyRef.current = key;
              clearSayacUrlInBrowser();
            }
          }, 0);
        } else if (initialBinaFocus && mapRef.current) {
          window.setTimeout(() => {
            if (cancelled || !mapRef.current) return;
            if (applyBinaFocusRef.current(initialBinaFocus)) {
              lastBinaFocusIdRef.current = initialBinaFocus;
            }
          }, 0);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message);
        setLoading(false);
      });

    return () => {
      cancelled = true;
      clearBuildingAlarm();
      if (mapRef.current) {
        const map = mapRef.current;
        sorunMarkersRef.current.forEach((m) => map.removeLayer(m));
        sorunMarkersRef.current = [];
        if (sayacMarkerRef.current) {
          map.removeLayer(sayacMarkerRef.current);
          sayacMarkerRef.current = null;
        }
        map.remove();
        mapRef.current = null;
        activeTileRef.current = null;
        activeHighlightRef.current = null;
        buildingPolygonsRef.current.clear();
        buildingStylesRef.current.clear();
        highlightedBinaIdRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const getBoundsFromCoords = (coordinates: [number, number][][]) => {
    const bounds = L.latLngBounds([]);
    coordinates.forEach((polygonCoords) => {
      polygonCoords.forEach(([lat, lng]) => bounds.extend([lat, lng]));
    });
    return bounds;
  };

  const zoomToBuilding = (
    binaId: number,
    coordinates?: [number, number][][],
    options?: { alarm?: boolean }
  ) => {
    if (!mapRef.current) return [];
    const map = mapRef.current;

    const polygons = options?.alarm ? highlightBuildingForSayacSearch(binaId) : highlightBuilding(binaId);
    let bounds: L.LatLngBounds | null = null;

    if (polygons.length > 0) {
      bounds = L.latLngBounds([]);
      polygons.forEach((polygon) => {
        const latLngs = polygon.getLatLngs();
        if (Array.isArray(latLngs[0])) {
          (latLngs as L.LatLng[][]).forEach((ring) => {
            ring.forEach((ll) => bounds!.extend(ll));
          });
        } else {
          (latLngs as L.LatLng[]).forEach((ll) => bounds!.extend(ll));
        }
      });
    } else if (coordinates?.length) {
      bounds = getBoundsFromCoords(coordinates);
    }

    if (bounds?.isValid()) {
      const center = bounds.getCenter();
      map.stop();
      map.setView(center, 19, { animate: false });
      window.setTimeout(() => {
        if (!mapRef.current) return;
        mapRef.current.flyTo(center, 19, { duration: 0.6, animate: true });
      }, 50);
    }

    const polygonsAfterZoom = buildingPolygonsRef.current.get(binaId) || [];
    polygonsAfterZoom.forEach((polygon) => polygon.bringToFront());

    if (polygons.length > 0 && !options?.alarm) {
      polygons[0].openPopup();
    }

    return polygons;
  };

  const navigateToSayac = useCallback(
    (result: SayacSearchResult, openModal = false) => {
      if (!mapRef.current) return;

      setSayacSearchOpen(false);
      setSayacSearch(result.sayac_id);
      setSelectedKapiLabel(null);
      setSelectedKapiTarget(null);
      setKapiSearchOpen(false);
      setSelectedSayacLabel(`${result.sayac_id} → ${result.building_name}`);
      setSelectedSayacTarget({
        bina_id: result.bina_id,
        sayac_id: result.sayac_id,
        building_name: result.building_name,
      });
      setFocusSayacId(result.sayac_id);
      setShareFeedback(null);
      triggerSayacAlarm();
      if (openModal) {
        syncSayacUrlInBrowser(result.bina_id, result.sayac_id);
        lastDeepLinkKeyRef.current = sayacDeepLinkKey(result.bina_id, result.sayac_id);
      }
      setLayerPickerOpen(false);
      setMahallePickerOpen(false);

      if (activeHighlightRef.current) {
        mapRef.current.removeLayer(activeHighlightRef.current);
        activeHighlightRef.current = null;
      }
      setSelectedMahalle("Mahalleler");

      zoomToBuilding(result.bina_id, result.coordinates, { alarm: true });
      placeSayacMarker(result.bina_id, result.sayac_id, result.coordinates, {
        lat: result.lat ?? NaN,
        lng: result.lng ?? NaN,
      });

      if (openModal) {
        setSelectedBuilding({
          id: result.bina_id,
          value: result.building_name,
          layer: result.layer,
          oda_id: result.oda_id,
        });
        setSayacModalOpen(true);
      }
    },
    [placeSayacMarker, triggerSayacAlarm]
  );

  const handleOpenDoorLocation = useCallback(
    async () => {
      if (!selectedBuilding) return;

      const building = buildingsDataRef.current.get(selectedBuilding.id);
      const buildingName = selectedBuilding.value || building?.value || "Bina";
      const disKapi = building?.dis_kapi_no?.trim() || "";

      let lat: number | null = null;
      let lng: number | null = null;
      let labelKapi = disKapi;

      try {
        const params = new URLSearchParams({ bina_id: String(selectedBuilding.id) });
        if (disKapi) params.set("kapi_no", disKapi);
        const res = await fetch(`/api/diskapi/location?${params}`);
        if (res.ok) {
          const data = (await res.json()) as { lat: number; lng: number; kapi_no?: string };
          if (Number.isFinite(data.lat) && Number.isFinite(data.lng)) {
            lat = data.lat;
            lng = data.lng;
            labelKapi = data.kapi_no || disKapi;
          }
        }
      } catch (err) {
        console.error("Kapı konumu alınamadı:", err);
      }

      if (lat == null || lng == null) {
        const center = getBuildingCenter(building?.coordinates);
        if (!center) {
          setShareFeedback("Bu bina için konum bulunamadı");
          window.setTimeout(() => setShareFeedback(null), 4000);
          return;
        }
        lat = center.lat;
        lng = center.lng;
      }

      const label = labelKapi ? `Kapı ${labelKapi} · ${buildingName}` : buildingName;
      openGoogleMaps(lat, lng, label);
    },
    [selectedBuilding]
  );

  const handleOpenKapiLocation = useCallback(
    (result: KapiSearchResult) => {
      const label = `Kapı ${result.kapi_no} · ${result.building_name}`;
      openGoogleMaps(result.lat, result.lng, label);
    },
    []
  );

  const submitSayacSearch = useCallback(() => {
    const q = sayacSearch.trim();
    if (q.length < 3) return;

    const digits = normSayacDigits(q);
    const pickMatch = (results: SayacSearchResult[]) => {
      const exact = results.find((r) => normSayacDigits(r.sayac_id) === digits);
      if (exact) return exact;
      if (results.length === 1) return results[0];
      return null;
    };

    const cached = pickMatch(sayacResultsRef.current);
    if (cached) {
      navigateToSayac(cached);
      return;
    }

    setSayacSearching(true);
    fetch(`/api/sayac/search?q=${encodeURIComponent(q)}`)
      .then((res) => {
        if (!res.ok) throw new Error("Arama başarısız");
        return res.json();
      })
      .then((data: SayacSearchResult[]) => {
        setSayacResults(data);
        const match = pickMatch(data);
        if (match) {
          navigateToSayac(match);
        } else {
          setSayacSearchOpen(true);
        }
      })
      .catch((err) => {
        console.error("Sayaç arama hatası:", err);
        setSayacResults([]);
        setSayacSearchOpen(true);
      })
      .finally(() => setSayacSearching(false));
  }, [navigateToSayac, sayacSearch]);

  const navigateToKapi = useCallback(
    (result: KapiSearchResult) => {
      if (!mapRef.current) return;

      setKapiSearchOpen(false);
      setKapiSearch(result.kapi_no);
      setSelectedKapiLabel(`${result.kapi_no} → ${result.building_name}`);
      setSelectedKapiTarget(result);
      setSayacSearchOpen(false);
      setLayerPickerOpen(false);
      setMahallePickerOpen(false);
      stopSayacAlarm();

      if (activeHighlightRef.current) {
        mapRef.current.removeLayer(activeHighlightRef.current);
        activeHighlightRef.current = null;
      }
      setSelectedMahalle("Mahalleler");

      highlightBuilding(result.bina_id);
      const map = mapRef.current;
      map.stop();
      map.flyTo([result.lat, result.lng], 19, { duration: 0.6, animate: true });
      placeKapiMarker(result.kapi_no, result.lat, result.lng);

      setSelectedBuilding({
        id: result.bina_id,
        value: result.building_name,
        layer: result.layer,
        oda_id: result.oda_id,
      });
    },
    [placeKapiMarker, stopSayacAlarm]
  );

  const submitKapiSearch = useCallback(() => {
    const q = kapiSearch.trim();
    if (q.length < 2) return;

    const normQ = normKapiNo(q);
    const pickMatch = (results: KapiSearchResult[]) => {
      const exact = results.find((r) => normKapiNo(r.kapi_no) === normQ);
      if (exact) return exact;
      if (results.length === 1) return results[0];
      return null;
    };

    const cached = pickMatch(kapiResultsRef.current);
    if (cached) {
      navigateToKapi(cached);
      return;
    }

    setKapiSearching(true);
    fetch(`/api/diskapi/search?q=${encodeURIComponent(q)}`)
      .then((res) => {
        if (!res.ok) throw new Error("Arama başarısız");
        return res.json();
      })
      .then((data: KapiSearchResult[]) => {
        setKapiResults(data);
        const match = pickMatch(data);
        if (match) {
          navigateToKapi(match);
        } else {
          setKapiSearchOpen(true);
        }
      })
      .catch((err) => {
        console.error("Kapı arama hatası:", err);
        setKapiResults([]);
        setKapiSearchOpen(true);
      })
      .finally(() => setKapiSearching(false));
  }, [kapiSearch, navigateToKapi]);

  // Debounced kapı arama (sayaç aramasından bağımsız)
  useEffect(() => {
    const q = kapiSearch.trim();
    if (q.length < 2) {
      setKapiResults([]);
      setKapiSearching(false);
      return;
    }

    setKapiSearching(true);
    const timer = setTimeout(() => {
      fetch(`/api/diskapi/search?q=${encodeURIComponent(q)}`)
        .then((res) => {
          if (!res.ok) throw new Error("Arama başarısız");
          return res.json();
        })
        .then((data: KapiSearchResult[]) => {
          setKapiResults(data);
          setKapiSearchOpen(true);
        })
        .catch((err) => {
          console.error("Kapı arama hatası:", err);
          setKapiResults([]);
          setKapiSearchOpen(true);
        })
        .finally(() => setKapiSearching(false));
    }, 300);

    return () => clearTimeout(timer);
  }, [kapiSearch]);

  const showShareFeedback = useCallback((msg: string) => {
    setShareFeedback(msg);
    window.setTimeout(() => setShareFeedback(null), 5000);
  }, []);

  const handleCopySayacLink = useCallback(
    async (binaId: number, sayacId: string) => {
      const ok = await copySayacMapLink(binaId, sayacId);
      showShareFeedback(ok ? "Link kopyalandı" : "Kopyalanamadı");
    },
    [showShareFeedback]
  );

  const handleShareSayacLink = useCallback(
    async (binaId: number, sayacId: string, buildingName?: string) => {
      const url = buildSayacMapUrl(binaId, sayacId);
      setSharePanelUrl(url);
      setSharePanelOpen(true);

      const result = await shareSayacMapLink(binaId, sayacId, {
        title: `Sayaç ${sayacId}`,
        text: buildingName ? `${buildingName} — haritada aç` : undefined,
      });

      if (result === "shared") {
        showShareFeedback("Paylaşım penceresi açıldı");
        setSharePanelOpen(false);
      } else if (result === "copied") {
        showShareFeedback("Link panoya kopyalandı — istediğiniz yere yapıştırın");
      } else if (result === "cancelled") {
        showShareFeedback("Linki aşağıdan kopyalayabilirsiniz");
      } else {
        showShareFeedback("Otomatik kopyalanamadı — linki seçip kopyalayın");
      }
    },
    [showShareFeedback]
  );

  const handleCopySharePanelUrl = useCallback(async () => {
    if (!sharePanelUrl) return;
    const ok = await copyTextToClipboard(sharePanelUrl);
    showShareFeedback(ok ? "Link kopyalandı" : "Kopyalanamadı");
  }, [sharePanelUrl, showShareFeedback]);

  const handleJsonExport = useCallback(async () => {
    setJsonExporting(true);
    setJsonExportError(null);
    try {
      const response = await fetch("/api/harita-export");
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error || "JSON dışa aktarımı başarısız");
      }

      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") ?? "";
      const filename =
        disposition.match(/filename="?([^";]+)"?/i)?.[1] ??
        `harita-verileri-${new Date().toISOString().slice(0, 10)}.json`;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (error: unknown) {
      setJsonExportError(error instanceof Error ? error.message : "JSON dışa aktarımı başarısız");
    } finally {
      setJsonExporting(false);
    }
  }, []);

  const resetMapViewState = useCallback(() => {
    lastDeepLinkKeyRef.current = null;
    lastBinaFocusIdRef.current = null;
    setSayacModalOpen(false);
    setInfoModalOpen(false);
    setSelectedBuilding(null);
    setFocusSayacId(null);
    setSayacSearch("");
    setSayacResults([]);
    setSayacSearchOpen(false);
    setSelectedSayacLabel(null);
    setSelectedSayacTarget(null);
    setShareFeedback(null);
    setSharePanelOpen(false);
    setSharePanelUrl(null);
    stopSayacAlarm();
    clearSayacMarker();
    clearBuildingHighlight();
  }, [clearSayacMarker, stopSayacAlarm]);

  const applyBinaFocus = useCallback(
    (binaId: number) => {
      if (!mapRef.current) return false;

      const building = buildingsDataRef.current.get(binaId);

      if (activeHighlightRef.current) {
        mapRef.current.removeLayer(activeHighlightRef.current);
        activeHighlightRef.current = null;
      }
      setSelectedMahalle("Mahalleler");
      setLayerPickerOpen(false);
      setMahallePickerOpen(false);
      setSayacSearchOpen(false);
      setSayacModalOpen(false);
      setInfoModalOpen(false);
      setSelectedBuilding(null);
      setFocusSayacId(null);
      setSayacSearch("");
      setSelectedSayacLabel(null);
      setSelectedSayacTarget(null);
      stopSayacAlarm();
      clearSayacMarker();
      lastDeepLinkKeyRef.current = null;

      zoomToBuilding(binaId, building?.coordinates);
      lastBinaFocusIdRef.current = binaId;

      return true;
    },
    [clearSayacMarker, stopSayacAlarm]
  );

  applyBinaFocusRef.current = applyBinaFocus;

  const applySayacDeepLink = useCallback(
    (binaId: number, sayacParam: string) => {
      if (!mapRef.current) return false;

      const building = buildingsDataRef.current.get(binaId);
      const buildingName = building?.value ?? "Bina";
      const sayac = sayacParam.trim();
      if (!sayac) return false;

      if (activeHighlightRef.current) {
        mapRef.current.removeLayer(activeHighlightRef.current);
        activeHighlightRef.current = null;
      }
      setSelectedMahalle("Mahalleler");
      setLayerPickerOpen(false);
      setMahallePickerOpen(false);
      setSayacSearchOpen(false);

      zoomToBuilding(binaId, building?.coordinates, { alarm: true });

      setSelectedBuilding({
        id: binaId,
        value: building?.value ?? null,
        layer: building?.layer ?? null,
        oda_id: building?.oda_id ?? null,
      });

      setSayacSearch(sayac);
      setSelectedSayacLabel(`${sayac} → ${buildingName}`);
      setSelectedSayacTarget({
        bina_id: binaId,
        sayac_id: sayac,
        building_name: building?.value ?? undefined,
      });
      setFocusSayacId(sayac);
      triggerSayacAlarm();
      // Exact meter coords when available
      fetch(`/api/sayac/konum?sayac_id=${encodeURIComponent(sayac)}`)
        .then((r) => r.json())
        .then((data: { lat?: number; lng?: number }) => {
          placeSayacMarker(binaId, sayac, building?.coordinates, {
            lat: data.lat ?? NaN,
            lng: data.lng ?? NaN,
          });
        })
        .catch(() => {
          placeSayacMarker(binaId, sayac, building?.coordinates);
        });
      setInfoModalOpen(false);
      setSayacModalOpen(true);
      lastBinaFocusIdRef.current = null;

      return true;
    },
    [placeSayacMarker, triggerSayacAlarm]
  );

  applySayacDeepLinkRef.current = applySayacDeepLink;

  useEffect(() => {
    if (loading || error) return;

    const sayacLink = parseSayacDeepLink(searchParams);
    if (sayacLink) {
      const key = sayacDeepLinkKey(sayacLink.binaId, sayacLink.sayac);
      if (lastDeepLinkKeyRef.current === key) return;

      let cancelled = false;
      const timer = window.setTimeout(() => {
        if (cancelled || !mapRef.current) return;

        if (applySayacDeepLinkRef.current(sayacLink.binaId, sayacLink.sayac)) {
          lastDeepLinkKeyRef.current = key;
          clearSayacUrlInBrowser();
        }
      }, 100);

      return () => {
        cancelled = true;
        window.clearTimeout(timer);
      };
    }

    const binaFocusId = parseBinaFocusId(searchParams);
    if (binaFocusId) {
      if (lastBinaFocusIdRef.current === binaFocusId) return;

      let cancelled = false;
      const timer = window.setTimeout(() => {
        if (cancelled || !mapRef.current) return;

        if (applyBinaFocusRef.current(binaFocusId)) {
          lastBinaFocusIdRef.current = binaFocusId;
        }
      }, 100);

      return () => {
        cancelled = true;
        window.clearTimeout(timer);
      };
    }

    const hasMapQuery =
      (searchParams.get("bina_id") || "").trim().length > 0 ||
      (searchParams.get("sayac") || "").trim().length > 0;

    if (!hasMapQuery && (lastDeepLinkKeyRef.current !== null || lastBinaFocusIdRef.current !== null)) {
      resetMapViewState();
    }
  }, [loading, error, searchParams, resetMapViewState]);

  useEffect(() => {
    if (loading || error) return;

    const onMapNavReset = () => {
      const params = new URLSearchParams(window.location.search);
      if (!parseSayacDeepLink(params) && !parseBinaFocusId(params)) {
        resetMapViewState();
      }
    };

    window.addEventListener(MAP_NAV_RESET, onMapNavReset);
    return () => window.removeEventListener(MAP_NAV_RESET, onMapNavReset);
  }, [loading, error, resetMapViewState]);

  const openSorunPanel = (filter: SorunListeFilter = "all") => {
    setSorunPanelFilter(filter);
    setSorunPanelOpen(true);
    setLayerPickerOpen(false);
    setMahallePickerOpen(false);
    setSayacSearchOpen(false);
  };

  const handleSorunListeSelect = (item: SayacSorunListeItem) => {
    if (!mapRef.current) return;
    setSorunPanelOpen(false);
    setLayerPickerOpen(false);
    setMahallePickerOpen(false);
    setSayacSearchOpen(false);

    if (activeHighlightRef.current) {
      mapRef.current.removeLayer(activeHighlightRef.current);
      activeHighlightRef.current = null;
    }
    setSelectedMahalle("Mahalleler");

    zoomToBuilding(item.bina_id, item.coordinates);
    setSelectedBuilding({
      id: item.bina_id,
      value: item.building_name,
      layer: item.layer,
      oda_id: item.oda_id,
    });
    setSayacModalOpen(true);
  };

  const handleSayacSelect = (result: SayacSearchResult) => {
    navigateToSayac(result, true);
  };

  const handleKapiSelect = (result: KapiSearchResult) => {
    navigateToKapi(result);
  };

  useEffect(() => {
    return () => {
      clearSayacUrlInBrowser();
    };
  }, []);

  const clearSayacSearch = () => {
    setSayacSearch("");
    setSayacResults([]);
    setSayacSearchOpen(false);
    setSelectedKapiLabel(null);
    setSelectedKapiTarget(null);
    setSelectedSayacLabel(null);
    setSelectedSayacTarget(null);
    setFocusSayacId(null);
    setShareFeedback(null);
    setSharePanelOpen(false);
    setSharePanelUrl(null);
    lastDeepLinkKeyRef.current = null;
    lastBinaFocusIdRef.current = null;
    stopSayacAlarm();
    clearSayacMarker();
    clearBuildingHighlight();
    clearSayacUrlInBrowser();
  };

  const clearKapiSearch = () => {
    setKapiSearch("");
    setKapiResults([]);
    setKapiSearchOpen(false);
    setSelectedKapiLabel(null);
    setSelectedKapiTarget(null);
    clearSayacMarker();
    clearBuildingHighlight();
  };

  const handleMahalleSelect = (name: string, center: [number, number] | null) => {
    if (mapRef.current) {
      const map = mapRef.current;
      setMahallePickerOpen(false);
      setMahalleSearch(""); // Clear search value when selected

      // Clean up previous highlight
      if (activeHighlightRef.current) {
        map.removeLayer(activeHighlightRef.current);
        activeHighlightRef.current = null;
      }

      // If "Clear" is clicked
      if (!center) {
        setSelectedMahalle("Mahalleler");
        if (allBoundsRef.current && allBoundsRef.current.isValid()) {
          map.fitBounds(allBoundsRef.current, { padding: [20, 20] });
        }
        return;
      }

      setSelectedMahalle(name);

      // Fetch dynamic neighborhood polygon from database API
      fetch(`/api/mahalleler?name=${encodeURIComponent(name)}`)
        .then((res) => {
          if (!res.ok) throw new Error("Mahalle sınırları yüklenemedi.");
          return res.json();
        })
        .then((data) => {
          if (!mapRef.current) return;

          map.setView(data.center, 16);

          // Draw official boundary polygon with click-through enabled (interactive: false)
          const highlight = L.polygon(data.coordinates, {
            color: "#f97316", // Orange boundary line
            fillColor: "#f97316",
            fillOpacity: 0.03, // Low opacity to keep building layers fully visible
            weight: 2.5,
            dashArray: "6, 10", // Dashed outline
            interactive: false, // Passes all clicks to underlying binalar
          }).addTo(mapRef.current);

          activeHighlightRef.current = highlight;
        })
        .catch((err) => {
          console.error(err);
        });
    }
  };

  // Filter neighborhood list dynamically based on search
  const filteredMahalleList = mahalleList.filter((m) =>
    m.name.toLocaleLowerCase("tr-TR").includes(mahalleSearch.toLocaleLowerCase("tr-TR"))
  );

  return (
    <div className="relative w-full h-full">
      {/* Loading */}
      {loading && (
        <div className="absolute inset-0 z-9999 flex flex-col items-center justify-center bg-white/80 dark:bg-gray-900/80 backdrop-blur-xs">
          <div className="h-12 w-12 animate-spin rounded-full border-4 border-brand-500 border-t-transparent"></div>
          <p className="mt-4 font-semibold text-gray-700 dark:text-gray-200">
            SQLite veritabanından binalar yükleniyor...
          </p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="absolute inset-0 z-9999 flex flex-col items-center justify-center bg-white dark:bg-gray-900 p-4 text-center">
          <div className="text-red-500 font-bold text-lg mb-2">Hata Oluştu</div>
          <p className="text-gray-600 dark:text-gray-400 mb-4">{error}</p>
          <button onClick={() => window.location.reload()} className="px-4 py-2 bg-brand-500 hover:bg-brand-600 text-white rounded-md font-semibold transition">
            Yeniden Dene
          </button>
        </div>
      )}

      {/* Sol özet doku — tek kabuk, haritayı boğmaz */}
      {!loading && !error && (
        <div className="pointer-events-none absolute left-3 top-3 z-[999] flex max-h-[calc(100dvh-5.5rem)] w-[min(17.5rem,calc(100vw-1.5rem))] flex-col sm:left-4 sm:top-4">
          <div className={`pointer-events-auto overflow-hidden ${MAP_TOOLBAR_SURFACE}`}>
            <button
              type="button"
              onClick={() => setLeftDockOpen((v) => !v)}
              className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-[11px] font-black tracking-tight text-emerald-700 dark:text-emerald-300">
                LS
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12px] font-bold text-slate-900 dark:text-white">Lora Sayaç</div>
                <div className="truncate text-[10px] text-slate-500 dark:text-slate-400">Malatya harita özeti</div>
              </div>
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                className={`shrink-0 text-slate-400 transition-transform ${leftDockOpen ? "rotate-180" : ""}`}
              >
                <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>

            {leftDockOpen && (
              <div className="max-h-[min(70dvh,34rem)] space-y-3 overflow-y-auto border-t border-slate-200/70 px-3 py-3 dark:border-slate-700/70">
                <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
                  <div>
                    <div className="text-[18px] font-black tabular-nums leading-none text-slate-900 dark:text-white">
                      {stats.total.toLocaleString("tr-TR")}
                    </div>
                    <div className="mt-1 text-[10px] text-slate-500 dark:text-slate-400">Bina</div>
                  </div>
                  <div>
                    <div className="text-[18px] font-black tabular-nums leading-none text-emerald-600 dark:text-emerald-400">
                      {toplamSayac.toLocaleString("tr-TR")}
                    </div>
                    <div className="mt-1 text-[10px] text-slate-500 dark:text-slate-400">Sayaç</div>
                  </div>
                  <div>
                    <div className="text-[15px] font-bold tabular-nums leading-none text-sky-600 dark:text-sky-400">
                      {koordinatliSayac.toLocaleString("tr-TR")}
                    </div>
                    <div className="mt-1 text-[10px] text-slate-500 dark:text-slate-400">Koordinatlı</div>
                  </div>
                  {stats.rezervClassified > 0 && (
                    <div>
                      <div className="text-[15px] font-bold tabular-nums leading-none text-slate-700 dark:text-slate-200">
                        {stats.rezervClassified.toLocaleString("tr-TR")}
                      </div>
                      <div className="mt-1 text-[10px] text-slate-500 dark:text-slate-400">Rezerv tarife</div>
                    </div>
                  )}
                </div>

                <div className="space-y-1.5 border-t border-slate-200/70 pt-2.5 dark:border-slate-700/70">
                  <div className={MAP_SECTION_LABEL}>Katmanlar</div>

                  {bugunOzet && bugunOzet.toplam > 0 && (
                    <div className="rounded-lg border border-slate-200/80 dark:border-slate-700/80">
                      <button
                        type="button"
                        onClick={() => setBugunPanelOpen((v) => !v)}
                        className="flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left"
                      >
                        <span className="text-[11px] font-semibold text-slate-800 dark:text-slate-100">Bugün</span>
                        <span className="text-[10px] font-bold tabular-nums text-sky-600 dark:text-sky-400">
                          {bugunOzet.toplam.toLocaleString("tr-TR")}
                        </span>
                      </button>
                      {bugunPanelOpen && (
                        <div className="space-y-1.5 border-t border-slate-200/70 px-2.5 py-2 dark:border-slate-700/70">
                          <div className="text-[10px] text-slate-500">{bugunOzet.bina_sayisi} bina · bugünkü kayıt</div>
                          <button
                            type="button"
                            onClick={() => setBugunLayerEnabled((v) => !v)}
                            className={`w-full rounded-md py-1.5 text-[10px] font-semibold transition ${
                              bugunLayerEnabled
                                ? "bg-sky-600 text-white"
                                : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200"
                            }`}
                          >
                            {bugunLayerEnabled ? "Haritada gizle" : "Haritada göster"}
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {polySozlesmeOzet && polySozlesmeOzet.sozlesme_sayisi > 0 && (
                    <div className="rounded-lg border border-slate-200/80 dark:border-slate-700/80">
                      <button
                        type="button"
                        onClick={() => setPolySozlesmePanelOpen((v) => !v)}
                        className="flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left"
                      >
                        <span className="text-[11px] font-semibold text-slate-800 dark:text-slate-100">Polimeter</span>
                        <span className="text-[10px] font-bold tabular-nums text-orange-600 dark:text-orange-400">
                          {polySozlesmeOzet.sozlesme_sayisi.toLocaleString("tr-TR")}
                        </span>
                      </button>
                      {polySozlesmePanelOpen && (
                        <div className="space-y-1.5 border-t border-slate-200/70 px-2.5 py-2 dark:border-slate-700/70">
                          <div className="text-[10px] text-slate-500">
                            {polySozlesmeOzet.bina_sayisi} bina · sözleşme sayısı
                          </div>
                          <button
                            type="button"
                            onClick={() => setPolySozlesmeLayerEnabled((v) => !v)}
                            className={`w-full rounded-md py-1.5 text-[10px] font-semibold transition ${
                              polySozlesmeLayerEnabled
                                ? "bg-orange-600 text-white"
                                : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200"
                            }`}
                          >
                            {polySozlesmeLayerEnabled ? "Sayıları gizle" : "Binalarda göster"}
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {sorunOzet && sorunOzet.bina_sayisi > 0 && (
                    <div className="rounded-lg border border-slate-200/80 dark:border-slate-700/80">
                      <button
                        type="button"
                        onClick={() => setSorunDockOpen((v) => !v)}
                        className="flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left"
                      >
                        <span className="text-[11px] font-semibold text-slate-800 dark:text-slate-100">Sorunlar</span>
                        <span className="text-[10px] font-bold tabular-nums text-rose-600 dark:text-rose-400">
                          {sorunOzet.bina_sayisi}
                        </span>
                      </button>
                      {sorunDockOpen && (
                        <div className="space-y-2 border-t border-slate-200/70 px-2.5 py-2 dark:border-slate-700/70">
                          <div className="grid grid-cols-2 gap-1.5">
                            <button
                              type="button"
                              onClick={() => openSorunPanel("okuma")}
                              className="rounded-md bg-rose-50 px-2 py-1.5 text-center dark:bg-rose-950/30"
                            >
                              <div className="text-[12px] font-bold tabular-nums text-rose-600">
                                {sorunOzet.okunmadi + sorunOzet.hatali}
                              </div>
                              <div className="text-[9px] text-slate-500">Hatalı</div>
                            </button>
                            <button
                              type="button"
                              onClick={() => openSorunPanel("eksik")}
                              className="rounded-md bg-amber-50 px-2 py-1.5 text-center dark:bg-amber-950/30"
                            >
                              <div className="text-[12px] font-bold tabular-nums text-amber-600">
                                {sorunOzet.eksik}
                              </div>
                              <div className="text-[9px] text-slate-500">Eksik</div>
                            </button>
                          </div>
                          <div className="flex gap-1.5">
                            <button
                              type="button"
                              onClick={() => setSorunLayerEnabled((v) => !v)}
                              className={`flex-1 rounded-md py-1.5 text-[10px] font-semibold transition ${
                                sorunLayerEnabled
                                  ? "bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900"
                                  : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200"
                              }`}
                            >
                              {sorunLayerEnabled ? "İşaret kapalı" : "İşaret aç"}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                if (sorunPanelOpen) setSorunPanelOpen(false);
                                else openSorunPanel("all");
                              }}
                              className={`flex-1 rounded-md py-1.5 text-[10px] font-semibold transition ${
                                sorunPanelOpen
                                  ? "bg-emerald-600 text-white"
                                  : "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                              }`}
                            >
                              Rapor
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Alt lejant */}
      {!loading && !error && (
        <div className="pointer-events-none absolute bottom-3 left-1/2 z-[998] w-[min(34rem,calc(100vw-7rem))] -translate-x-1/2 sm:bottom-4">
          <div className={`pointer-events-auto flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 px-3 py-2 ${MAP_TOOLBAR_SURFACE}`}>
            <span className="flex items-center gap-1.5 text-[10px] font-medium text-slate-600 dark:text-slate-300">
              <span className="h-2.5 w-2.5 rounded-sm bg-[#10b981]" /> Sayaçlı
            </span>
            <span className="flex items-center gap-1.5 text-[10px] font-medium text-slate-600 dark:text-slate-300">
              <span className="h-2.5 w-2.5 rounded-sm bg-[#465fff]" /> Sayaçsız
            </span>
            <span className="flex items-center gap-1.5 text-[10px] font-medium text-slate-600 dark:text-slate-300">
              <span className="h-2.5 w-2.5 rounded-sm bg-[#7c3aed]" /> Uzaktan eşleşen
            </span>
            <span className="hidden items-center gap-1.5 text-[10px] font-medium text-slate-600 sm:flex dark:text-slate-300">
              <span className="h-2.5 w-2.5 rounded-full bg-sky-500" /> Bugün
            </span>
          </div>
        </div>
      )}

      {/* Sorun raporu: küçük ekranlarda kaplama, geniş ekranda harita çekmecesi */}
      {!loading && !error && sorunPanelOpen && (
        <>
          <button
            type="button"
            aria-label="Sayaç sorun raporunu kapat"
            className="pointer-events-auto absolute inset-0 z-[1090] cursor-default bg-slate-950/30 backdrop-blur-[1px] xl:bg-black/10 xl:backdrop-blur-none"
            onClick={() => setSorunPanelOpen(false)}
          />
          <aside className="pointer-events-auto absolute inset-3 z-[1100] flex min-h-0 min-w-0 xl:bottom-4 xl:left-[19rem] xl:right-auto xl:top-4 xl:w-[28rem]">
            <SayacSorunPanel
              isOpen={sorunPanelOpen}
              onClose={() => setSorunPanelOpen(false)}
              initialFilter={sorunPanelFilter}
              onSelect={handleSorunListeSelect}
            />
          </aside>
        </>
      )}

      {/* Sağ araç çubuğu — arama + katmanlar */}
      {!loading && !error && (
        <div className="pointer-events-none absolute right-3 top-3 z-[1000] flex w-[min(19.5rem,calc(100vw-1.5rem))] flex-col items-end gap-2 overflow-visible sm:right-4 sm:top-4">
          <div className={MAP_SECTION_LABEL + " pointer-events-none w-full text-right pr-0.5"}>Arama</div>
          {/* Sayaç arama */}
          <div className="relative w-full pointer-events-auto">
            <div className={MAP_TOOLBAR_CARD}>
              <div className="flex items-center gap-2 px-3 py-2">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-slate-400">
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.3-4.3" />
                </svg>
                <input
                  type="text"
                  placeholder="Sayaç / abone no"
                  value={sayacSearch}
                  onChange={(e) => {
                    setSayacSearch(e.target.value);
                    setSelectedSayacLabel(null);
                    setSelectedSayacTarget(null);
                    if (e.target.value.trim().length >= 3) setSayacSearchOpen(true);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      submitSayacSearch();
                    }
                  }}
                  onFocus={() => {
                    setLayerPickerOpen(false);
                    setMahallePickerOpen(false);
                    setUzaktanPanelOpen(false);
                    setNotifPanelOpen(false);
                    if (sayacSearch.trim().length >= 3) setSayacSearchOpen(true);
                  }}
                  className="flex-1 bg-transparent text-sm font-medium text-gray-800 placeholder:text-gray-500 focus:outline-none dark:text-white dark:placeholder:text-gray-400"
                />
                {sayacSearching && (
                  <div className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-blue-light-500 border-t-transparent" />
                )}
                {(sayacSearch || selectedSayacLabel) && (
                  <button
                    onClick={clearSayacSearch}
                    className="shrink-0 rounded-md px-1 text-xs font-semibold text-gray-400 transition hover:bg-blue-light-50 hover:text-gray-600 dark:hover:bg-blue-light-950/40 dark:hover:text-gray-200"
                    title="Temizle"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>

            {shareFeedback && !selectedSayacTarget && (
              <div className="mt-1.5 rounded-xl border border-blue-light-200 bg-blue-light-50/80 px-3 py-1 text-[10px] font-medium text-blue-light-800 dark:border-blue-light-800 dark:bg-blue-light-950/40 dark:text-blue-light-300">
                {shareFeedback}
              </div>
            )}

            {selectedSayacLabel && selectedSayacTarget && (
              <div
                className={`mt-1.5 rounded-xl border px-3 py-1.5 ${
                  sayacAlarmActive
                    ? "sayac-alarm-strip border-red-300 bg-red-50/95 dark:border-red-800 dark:bg-red-950/40"
                    : "border-blue-light-200 bg-blue-light-50/80 dark:border-blue-light-800 dark:bg-blue-light-950/40"
                }`}
              >
                <div className="flex min-w-0 items-center gap-2">
                  {sayacAlarmActive && (
                    <span className="relative flex h-2 w-2 shrink-0">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-red-600" />
                    </span>
                  )}
                  <span
                    className={`flex-1 truncate text-[11px] font-semibold ${
                      sayacAlarmActive
                        ? "text-red-800 dark:text-red-200"
                        : "text-blue-light-900 dark:text-blue-light-200"
                    }`}
                  >
                    {selectedSayacLabel}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      handleCopySayacLink(selectedSayacTarget.bina_id, selectedSayacTarget.sayac_id)
                    }
                    className="shrink-0 rounded-lg border border-blue-light-300 bg-white/80 px-2 py-0.5 text-[10px] font-semibold text-blue-light-800 transition hover:bg-blue-light-100 dark:border-blue-light-700 dark:bg-gray-900/60 dark:text-blue-light-300 dark:hover:bg-blue-light-950/60"
                    title="Harita linkini kopyala"
                  >
                    Link
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      handleShareSayacLink(
                        selectedSayacTarget.bina_id,
                        selectedSayacTarget.sayac_id,
                        selectedSayacTarget.building_name
                      )
                    }
                    className={`shrink-0 rounded-lg border px-2 py-0.5 text-[10px] font-semibold transition ${
                      sharePanelOpen
                        ? "border-blue-light-600 bg-blue-light-600 text-white"
                        : "border-blue-light-300 bg-white/80 text-blue-light-800 hover:bg-blue-light-100 dark:border-blue-light-700 dark:bg-gray-900/60 dark:text-blue-light-300 dark:hover:bg-blue-light-950/60"
                    }`}
                    title="Paylaşım linkini göster"
                  >
                    Paylaş
                  </button>
                </div>
                {shareFeedback && (
                  <div className="mt-1.5 text-[11px] font-semibold text-blue-light-700 dark:text-blue-light-400">
                    {shareFeedback}
                  </div>
                )}
                {sharePanelOpen && sharePanelUrl && (
                  <div className="mt-2 space-y-2 rounded-xl border border-blue-light-200 bg-white p-2 dark:border-blue-light-800 dark:bg-gray-900">
                    <div className="text-[10px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                      Paylaşım linki
                    </div>
                    <input
                      type="text"
                      readOnly
                      value={sharePanelUrl}
                      onFocus={(e) => e.currentTarget.select()}
                      onClick={(e) => e.currentTarget.select()}
                      className="w-full rounded-lg border border-blue-light-200 bg-blue-light-50/50 px-2 py-1.5 text-[11px] font-mono text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-light-500/25 dark:border-blue-light-900 dark:bg-blue-light-950/30 dark:text-gray-100"
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={handleCopySharePanelUrl}
                        className="flex-1 rounded-lg bg-blue-light-600 px-2 py-1.5 text-[11px] font-semibold text-white transition hover:bg-blue-light-700"
                      >
                        Kopyala
                      </button>
                      <button
                        type="button"
                        onClick={() => setSharePanelOpen(false)}
                        className="rounded-lg border border-gray-200 px-2 py-1.5 text-[11px] font-semibold text-gray-600 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                      >
                        Kapat
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {sayacSearchOpen && sayacSearch.trim().length >= 3 && (
              <div className={`absolute right-0 z-[1001] mt-2 w-full ${MAP_DROPDOWN_PANEL}`}>
                <div className="max-h-72 overflow-y-auto">
                  {sayacResults.length === 0 && !sayacSearching ? (
                    <div className="px-4 py-3 text-center text-xs text-gray-500 dark:text-gray-400">
                      Eşleşen sayaç bulunamadı.
                    </div>
                  ) : (
                    sayacResults.map((result, idx) => (
                      <div
                        key={`${result.bina_id}-${result.birim_no}-${result.sayac_id}-${idx}`}
                        className="flex items-stretch border-b border-blue-light-100 transition last:border-0 hover:bg-blue-light-50/60 dark:border-blue-light-900/30 dark:hover:bg-blue-light-950/30"
                      >
                        <button
                          type="button"
                          onClick={() => handleSayacSelect(result)}
                          className="min-w-0 flex-1 px-4 py-3 text-left text-sm"
                        >
                          <div className="font-mono text-sm font-bold tracking-wide text-blue-light-700 dark:text-blue-light-400">
                            {result.sayac_id}
                          </div>
                          <div className="mt-0.5 truncate text-xs font-semibold text-gray-800 dark:text-gray-200">
                            {result.building_name}
                          </div>
                          <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-gray-500 dark:text-gray-400">
                            {result.blok_no && <span>Blok: {result.blok_no}</span>}
                            {result.kat && <span>Kat: {result.kat}</span>}
                            {result.kapi_no && <span>Kapı: {result.kapi_no}</span>}
                            {result.abone_no && <span>Abone: {result.abone_no}</span>}
                          </div>
                        </button>
                        <div className="mr-2 flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCopySayacLink(result.bina_id, result.sayac_id);
                            }}
                            className="rounded-lg border border-blue-light-200 px-2 py-1 text-[10px] font-semibold text-blue-light-700 transition hover:bg-blue-light-50 dark:border-blue-light-800 dark:text-blue-light-300 dark:hover:bg-blue-light-950/40"
                            title="Harita linkini kopyala"
                          >
                            Link
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleShareSayacLink(result.bina_id, result.sayac_id, result.building_name);
                            }}
                            className="rounded-lg border border-blue-light-200 px-2 py-1 text-[10px] font-semibold text-blue-light-700 transition hover:bg-blue-light-50 dark:border-blue-light-800 dark:text-blue-light-300 dark:hover:bg-blue-light-950/40"
                            title="Sayaç konumunu paylaş"
                          >
                            Paylaş
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Dış kapı arama — sayaç aramasından bağımsız */}
          <div className="relative w-full pointer-events-auto">
            <div className={MAP_TOOLBAR_CARD}>
              <div className="flex items-center gap-2 px-3 py-2.5">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-cyan-600">
                  <path d="M3 21h18" />
                  <path d="M5 21V7l7-4 7 4v14" />
                  <path d="M9 21v-6h6v6" />
                </svg>
                <input
                  type="text"
                  placeholder="Dış kapı no ara (örn. 70/1)..."
                  value={kapiSearch}
                  onChange={(e) => {
                    setKapiSearch(e.target.value);
                    setSelectedKapiLabel(null);
                    setSelectedKapiTarget(null);
                    if (e.target.value.trim().length >= 2) setKapiSearchOpen(true);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      submitKapiSearch();
                    }
                  }}
                  onFocus={() => {
                    setLayerPickerOpen(false);
                    setMahallePickerOpen(false);
                    setUzaktanPanelOpen(false);
                    setNotifPanelOpen(false);
                    setSayacSearchOpen(false);
                    if (kapiSearch.trim().length >= 2) setKapiSearchOpen(true);
                  }}
                  className="flex-1 bg-transparent text-sm font-medium text-gray-800 placeholder:text-gray-500 focus:outline-none dark:text-white dark:placeholder:text-gray-400"
                />
                {kapiSearching && (
                  <div className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-cyan-600 border-t-transparent" />
                )}
                {(kapiSearch || selectedKapiLabel) && (
                  <button
                    onClick={clearKapiSearch}
                    className="shrink-0 rounded-md px-1 text-xs font-semibold text-gray-400 transition hover:bg-cyan-50 hover:text-gray-600 dark:hover:bg-cyan-950/40 dark:hover:text-gray-200"
                    title="Temizle"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>

            {selectedKapiLabel && selectedKapiTarget && (
              <div className="mt-1.5 rounded-xl border border-cyan-200 bg-cyan-50/80 px-3 py-1.5 dark:border-cyan-800 dark:bg-cyan-950/40">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="flex-1 truncate text-[11px] font-semibold text-cyan-900 dark:text-cyan-200">
                    {selectedKapiLabel}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleOpenKapiLocation(selectedKapiTarget)}
                    className="shrink-0 rounded-lg border border-cyan-300 bg-white/80 px-2 py-0.5 text-[10px] font-semibold text-cyan-800 transition hover:bg-cyan-100 dark:border-cyan-700 dark:bg-gray-900/60 dark:text-cyan-300 dark:hover:bg-cyan-950/60"
                    title="Kapı konumunu Google Maps'te aç"
                  >
                    Maps
                  </button>
                </div>
              </div>
            )}

            {kapiSearchOpen && kapiSearch.trim().length >= 2 && (
              <div className={`absolute right-0 z-[1001] mt-2 w-full ${MAP_DROPDOWN_PANEL}`}>
                <div className="max-h-60 overflow-y-auto">
                  {kapiResults.length === 0 && !kapiSearching ? (
                    <div className="px-4 py-3 text-center text-xs text-gray-500 dark:text-gray-400">
                      Eşleşen kapı bulunamadı.
                    </div>
                  ) : (
                    kapiResults.map((result, idx) => (
                      <div
                        key={`${result.bina_id}-${result.kapi_no}-${idx}`}
                        className="flex items-stretch border-b border-cyan-100 transition last:border-0 hover:bg-cyan-50/60 dark:border-cyan-900/30 dark:hover:bg-cyan-950/30"
                      >
                        <button
                          type="button"
                          onClick={() => handleKapiSelect(result)}
                          className="min-w-0 flex-1 px-4 py-3 text-left text-sm"
                        >
                          <div className="text-sm font-bold text-cyan-700 dark:text-cyan-400">
                            No {result.kapi_no}
                          </div>
                          <div className="mt-0.5 truncate text-xs font-semibold text-gray-800 dark:text-gray-200">
                            {result.building_name}
                          </div>
                          {result.layer && (
                            <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">{result.layer}</div>
                          )}
                        </button>
                        <div className="mr-2 flex shrink-0 items-center">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenKapiLocation(result);
                            }}
                            className="rounded-lg border border-cyan-200 px-2 py-1 text-[10px] font-semibold text-cyan-700 transition hover:bg-cyan-50 dark:border-cyan-800 dark:text-cyan-300 dark:hover:bg-cyan-950/40"
                            title="Kapı konumunu Google Maps'te aç"
                          >
                            Maps
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          <div className={MAP_SECTION_LABEL + " pointer-events-none w-full text-right pr-0.5"}>Harita araçları</div>
          {/* Araç çubuğu */}
          <div className={`pointer-events-auto flex w-full flex-col gap-1.5 overflow-visible p-2 ${MAP_TOOLBAR_SURFACE}`}>
            <div className="flex w-full items-center gap-1.5">
              {isAdmin && (
                <button
                  type="button"
                  onClick={handleJsonExport}
                  disabled={jsonExporting}
                  className={`${MAP_TOOLBAR_BTN} min-w-0 flex-1 disabled:cursor-wait disabled:opacity-60`}
                  title="Harita, bina ve sayaç verilerini JSON olarak indir"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 3v12" strokeLinecap="round" />
                    <path d="m7 10 5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M5 20h14" strokeLinecap="round" />
                  </svg>
                  {jsonExporting ? "Hazırlanıyor" : "Export"}
                </button>
              )}
              {isAdmin && (
                <Link
                  href="/yonetici-raporu"
                  className={`${MAP_TOOLBAR_BTN} min-w-0 flex-1`}
                  title="Yönetici raporu"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M6 3h9l3 3v15H6V3z" strokeLinejoin="round" />
                    <path d="M9 11h6M9 15h4" strokeLinecap="round" />
                  </svg>
                  Rapor
                </Link>
              )}
              <Link
                href="/sayac-aktarim"
                className={`${MAP_TOOLBAR_BTN} min-w-0 flex-1`}
                title="Excel'den sayaç verisi aktar"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4 7h16v10H4z" />
                  <path d="M4 9h16M8 13h8M8 16h5" />
                </svg>
                Aktarım
              </Link>
              <MapNotificationBell
                onBinaClick={(binaId) => zoomToBuilding(binaId)}
                onToggle={(open) => {
                  if (open) {
                    setLayerPickerOpen(false);
                    setMahallePickerOpen(false);
                    setUzaktanPanelOpen(false);
                    setSayacSearchOpen(false);
                  }
                }}
              />
            </div>

            <div className="grid w-full grid-cols-2 gap-1.5">
            <div className="relative min-w-0 flex-1 overflow-visible">
            <button
              onClick={() => {
                setLayerPickerOpen((v) => !v);
                setMahallePickerOpen(false);
                setUzaktanPanelOpen(false);
                setSayacSearchOpen(false);
                setNotifPanelOpen(false);
              }}
              className={`${MAP_TOOLBAR_BTN} w-full ${layerPickerOpen ? "border-slate-800 bg-slate-800 text-white dark:border-slate-200 dark:bg-slate-200 dark:text-slate-900" : ""}`}
              title="Katman Seç"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                <polygon points="12 2 2 7 12 12 22 7 12 2" />
                <polyline points="2 17 12 22 22 17" />
                <polyline points="2 12 12 17 22 12" />
              </svg>
              <span className="truncate">{TILE_LAYERS[activeLayer].shortLabel}</span>
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={`ml-auto shrink-0 transition-transform ${layerPickerOpen ? "rotate-180" : ""}`}>
                <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>

            {layerPickerOpen && (
              <div className={`absolute right-0 z-[1001] mt-1.5 w-52 ${MAP_DROPDOWN_PANEL}`}>
                {(Object.entries(TILE_LAYERS) as [TileKey, typeof TILE_LAYERS[TileKey]][]).map(([key, def]) => (
                  <button
                    key={key}
                    onClick={() => {
                      setActiveLayer(key);
                      setLayerPickerOpen(false);
                    }}
                    className={`flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm transition hover:bg-blue-light-50/80 dark:hover:bg-blue-light-950/30 ${
                      activeLayer === key
                        ? "bg-blue-light-50 font-semibold text-blue-light-700 dark:bg-blue-light-950/40 dark:text-blue-light-300"
                        : "text-gray-700 dark:text-gray-300"
                    }`}
                  >
                    <span>{def.shortLabel}</span>
                    {activeLayer === key && (
                      <svg className="ml-auto text-blue-light-600" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </button>
                ))}
              </div>
            )}
            </div>

            <div className="relative min-w-0 flex-1 overflow-visible">
            <button
              onClick={() => {
                setMahallePickerOpen((v) => !v);
                setLayerPickerOpen(false);
                setUzaktanPanelOpen(false);
                setSayacSearchOpen(false);
                setMahalleSearch("");
                setNotifPanelOpen(false);
              }}
              className={`${MAP_TOOLBAR_BTN} w-full ${mahallePickerOpen ? "border-slate-800 bg-slate-800 text-white dark:border-slate-200 dark:bg-slate-200 dark:text-slate-900" : ""}`}
              title="Mahalleye Odaklan"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
              <span className="truncate">{selectedMahalle}</span>
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={`ml-auto shrink-0 transition-transform ${mahallePickerOpen ? "rotate-180" : ""}`}>
                <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>

            {mahallePickerOpen && (
              <div className={`absolute right-0 z-[1001] mt-1.5 flex w-64 flex-col ${MAP_DROPDOWN_PANEL}`}>
                <div className="border-b border-blue-light-100 bg-blue-light-50/50 p-2 dark:border-blue-light-900/30 dark:bg-blue-light-950/25">
                  <input
                    type="text"
                    placeholder="Mahalle ara..."
                    value={mahalleSearch}
                    onChange={(e) => setMahalleSearch(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    className="w-full rounded-lg border border-blue-light-200 bg-white px-3 py-1.5 text-xs text-gray-800 focus:border-blue-light-400 focus:outline-none focus:ring-2 focus:ring-blue-light-500/20 dark:border-blue-light-900 dark:bg-gray-900 dark:text-white"
                  />
                </div>

                <div className="max-h-60 overflow-y-auto">
                  <button
                    onClick={() => handleMahalleSelect("Mahalleler", null)}
                    className="flex w-full items-center gap-2 border-b border-blue-light-100 px-4 py-2.5 text-left text-sm font-semibold text-error-500 transition hover:bg-blue-light-50/60 dark:border-blue-light-900/30 dark:hover:bg-blue-light-950/30"
                  >
                    <span>Odaklanmayı Temizle</span>
                  </button>

                  {filteredMahalleList.length === 0 ? (
                    <div className="px-4 py-3 text-center text-xs text-gray-500 dark:text-gray-400">
                      Eşleşen mahalle bulunamadı.
                    </div>
                  ) : (
                    filteredMahalleList.map((mahalle) => (
                      <button
                        key={mahalle.name}
                        onClick={() => handleMahalleSelect(mahalle.name, mahalle.center)}
                        className={`flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm transition hover:bg-blue-light-50/60 dark:hover:bg-blue-light-950/30 ${
                          selectedMahalle === mahalle.name
                            ? "bg-blue-light-50 font-semibold text-blue-light-700 dark:bg-blue-light-950/40 dark:text-blue-light-300"
                            : "text-gray-700 dark:text-gray-300"
                        }`}
                      >
                        <span>{mahalle.name}</span>
                        {selectedMahalle === mahalle.name && (
                          <svg className="ml-auto text-blue-light-600" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
            </div>
            </div>

            {uzaktanStats && uzaktanStats.matched_bina > 0 && (
              <div className="relative w-full overflow-visible">
                <button
                  type="button"
                  onClick={() => {
                    setUzaktanPanelOpen((v) => !v);
                    setLayerPickerOpen(false);
                    setMahallePickerOpen(false);
                    setSayacSearchOpen(false);
                    setNotifPanelOpen(false);
                  }}
                  className={`${MAP_TOOLBAR_BTN} w-full ${
                    uzaktanPanelOpen || uzaktanLayerEnabled
                      ? "border-violet-600 bg-violet-600 text-white dark:border-violet-500 dark:bg-violet-600 dark:text-white"
                      : ""
                  }`}
                  title={`Uzaktan okuma: ${uzaktanStats.matched_sayac.toLocaleString("tr-TR")} eşleşen / ${uzaktanStats.excel_unique_meters.toLocaleString("tr-TR")} Excel toplam`}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0">
                    <path d="M5 12.5a7 7 0 0 1 14 0" strokeLinecap="round" />
                    <path d="M12 19.5v2" strokeLinecap="round" />
                    <circle cx="12" cy="12.5" r="2" />
                  </svg>
                  <span className="min-w-0 truncate">Uzaktan Okuma</span>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold tabular-nums whitespace-nowrap ${
                      uzaktanPanelOpen || uzaktanLayerEnabled
                        ? "bg-white/20 text-white"
                        : "bg-violet-100 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300"
                    }`}
                  >
                    {uzaktanStats.matched_sayac.toLocaleString("tr-TR")} /{" "}
                    {uzaktanStats.excel_unique_meters.toLocaleString("tr-TR")}
                  </span>
                  <svg
                    width="9"
                    height="9"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    className={`shrink-0 transition-transform ${uzaktanPanelOpen ? "rotate-180" : ""}`}
                  >
                    <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>

                {uzaktanPanelOpen && (
                  <div
                    className={`absolute right-0 z-[1001] mt-1.5 w-full max-h-[min(70vh,420px)] overflow-y-auto ${MAP_DROPDOWN_PANEL}`}
                  >
                    <div className="border-b border-violet-100/80 px-3 py-2.5 dark:border-violet-900/30">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-gray-900 dark:text-white">Uzaktan Okuma</span>
                        <span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[9px] font-semibold tabular-nums text-violet-700 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300">
                          {uzaktanStats.matched_bina} bina
                        </span>
                      </div>
                      <p className="mt-1 text-[10px] leading-snug text-gray-500 dark:text-gray-400">
                        Sözleşme dosyasındaki sayaçlar haritadaki binalarla eşleştirilir.
                      </p>
                    </div>

                    <div className="grid grid-cols-3 gap-2 p-3">
                      <div className="rounded-xl border border-gray-200 bg-gray-50/80 px-2 py-2 text-center dark:border-gray-700 dark:bg-gray-800/50">
                        <div className="text-sm font-black tabular-nums text-gray-700 dark:text-gray-300">
                          {uzaktanStats.excel_unique_meters.toLocaleString("tr-TR")}
                        </div>
                        <div className="mt-0.5 text-[9px] font-semibold text-gray-600 dark:text-gray-400">Excel toplam</div>
                      </div>
                      <div className="rounded-xl border border-violet-100 bg-violet-50/60 px-2 py-2 text-center dark:border-violet-900/30 dark:bg-violet-950/25">
                        <div className="text-sm font-black tabular-nums text-violet-700 dark:text-violet-400">
                          {uzaktanStats.matched_sayac.toLocaleString("tr-TR")}
                        </div>
                        <div className="mt-0.5 text-[9px] font-semibold text-gray-600 dark:text-gray-400">Eşleşen</div>
                      </div>
                      <div className="rounded-xl border border-gray-200 bg-gray-50/80 px-2 py-2 text-center dark:border-gray-700 dark:bg-gray-800/50">
                        <div className="text-sm font-black tabular-nums text-gray-600 dark:text-gray-300">
                          {uzaktanStats.unmatched_excel_meters.toLocaleString("tr-TR")}
                        </div>
                        <div className="mt-0.5 text-[9px] font-semibold text-gray-600 dark:text-gray-400">Eşleşmedi</div>
                      </div>
                    </div>

                    {uzaktanLayerEnabled && (
                      <div className="flex flex-wrap gap-1.5 px-3 pb-2">
                        <button
                          type="button"
                          onClick={() => setUzaktanTypeFilter("all")}
                          className={`rounded-lg border px-2 py-1 text-[9px] font-semibold transition ${
                            uzaktanTypeFilter === "all"
                              ? "border-violet-600 bg-violet-600 text-white"
                              : "border-gray-200 bg-white text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
                          }`}
                        >
                          Tümü
                        </button>
                        {uzaktanTypeOptions.map((opt) => (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => setUzaktanTypeFilter(opt.id as UzaktanTypeFilter)}
                            className={`rounded-lg border px-2 py-1 text-[9px] font-semibold transition ${
                              uzaktanTypeFilter === opt.id
                                ? "text-white"
                                : "border-gray-200 bg-white text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
                            }`}
                            style={
                              uzaktanTypeFilter === opt.id
                                ? { borderColor: opt.color, backgroundColor: opt.color }
                                : undefined
                            }
                          >
                            {opt.label} ({opt.matched_count})
                          </button>
                        ))}
                      </div>
                    )}

                    <div className="space-y-1 border-t border-violet-100/80 px-3 py-2 dark:border-violet-900/30">
                      {uzaktanTypeOptions.map((opt) => (
                        <div key={opt.id} className="flex items-center gap-2 text-[9px] text-gray-600 dark:text-gray-300">
                          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: opt.color }} />
                          {opt.label}
                        </div>
                      ))}
                      <div className="flex items-center gap-2 text-[9px] text-gray-500 dark:text-gray-400">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-slate-200 dark:bg-slate-600" />
                        Eşleşmeyen binalar soluk görünür
                      </div>
                    </div>

                    <div className="border-t border-violet-100/80 p-3 dark:border-violet-900/30">
                      <button
                        type="button"
                        onClick={() => {
                          setUzaktanLayerEnabled((v) => !v);
                          if (!uzaktanLayerEnabled) setUzaktanTypeFilter("all");
                        }}
                        className={`w-full rounded-xl border py-2 text-[10px] font-semibold transition ${
                          uzaktanLayerEnabled
                            ? "border-violet-600 bg-violet-600 text-white shadow-sm"
                            : "border-violet-300 bg-violet-50 text-violet-800 hover:bg-violet-100 dark:border-violet-700 dark:bg-violet-950/40 dark:text-violet-300"
                        }`}
                      >
                        {uzaktanLayerEnabled ? "Renklendirmeyi Kapat" : "Haritada Renklendir"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
          {jsonExportError && (
            <div className="pointer-events-auto w-full rounded-xl border border-error-200 bg-error-50 px-3 py-2 text-xs font-medium text-error-600 shadow-sm dark:border-error-500/30 dark:bg-error-500/10 dark:text-error-300">
              {jsonExportError}
            </div>
          )}
        </div>
      )}

      {/* Map Container */}
      <div ref={mapContainerRef} className="map-shell h-full w-full" />
      <style jsx global>{`
        .map-shell .leaflet-control-zoom {
          border: 0 !important;
          margin-left: 16px !important;
          margin-bottom: 64px !important;
          box-shadow: 0 8px 28px rgba(15, 23, 42, 0.1);
          border-radius: 12px;
          overflow: hidden;
        }
        .map-shell .leaflet-control-zoom a {
          width: 34px !important;
          height: 34px !important;
          line-height: 34px !important;
          color: #0f172a !important;
          background: rgba(255, 255, 255, 0.92) !important;
          border-bottom-color: #e2e8f0 !important;
        }
        .map-shell .leaflet-control-attribution {
          margin: 0 8px 8px 0 !important;
          border-radius: 8px;
          background: rgba(255, 255, 255, 0.78) !important;
          color: #64748b !important;
          font-size: 10px !important;
        }
      `}</style>

      {/* Building Info Modal */}
      {infoModalOpen && (
        <BuildingInfoModal
          building={selectedBuilding}
          onClose={() => {
            setInfoModalOpen(false);
            setSelectedBuilding(null);
            clearSayacUrlInBrowser();
          }}
          onOpenSayac={() => {
            setInfoModalOpen(false);
            setSayacModalOpen(true);
          }}
        />
      )}

      {/* Sayac Modal */}
      {sayacModalOpen && (
        <SayacModal
          building={selectedBuilding}
          highlightSayacId={focusSayacId}
          onClose={() => {
            setSayacModalOpen(false);
            setSelectedBuilding(null);
            setFocusSayacId(null);
            stopSayacAlarm();
            lastDeepLinkKeyRef.current = null;
            lastBinaFocusIdRef.current = null;
            clearSayacUrlInBrowser();
          }}
          onOpenBuildingInfo={() => {
            setSayacModalOpen(false);
            setFocusSayacId(null);
            stopSayacAlarm();
            setInfoModalOpen(true);
          }}
          onSaved={handleSayacSaved}
          onOpenDoorLocation={handleOpenDoorLocation}
        />
      )}

    </div>
  );
}
