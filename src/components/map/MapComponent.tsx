"use client";

import React, { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import BuildingInfoModal from "./BuildingInfoModal";
import SayacModal from "./SayacModal";
import { useTheme } from "@/context/ThemeContext";

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

const TILE_LAYERS = {
  standard: {
    label: "🗺️ Standart",
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    isDark: false,
  },
  light: {
    label: "☁️ Açık",
    url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
    isDark: false,
  },
  dark: {
    label: "🌙 Gece Modu",
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
    isDark: true,
  },
  satellite: {
    label: "🛰️ Uydu",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: '&copy; <a href="https://www.esri.com/">Esri</a>, Maxar, GeoEye, Earthstar Geographics',
    isDark: false,
  },
  topo: {
    label: "🗾 Topoğrafik",
    url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://opentopomap.org/">OpenTopoMap</a>',
    isDark: false,
  },
} as const;

type TileKey = keyof typeof TILE_LAYERS;

export default function MapComponent() {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const activeTileRef = useRef<L.TileLayer | null>(null);
  const allBoundsRef = useRef<L.LatLngBounds | null>(null);
  const activeHighlightRef = useRef<L.Polygon | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState({ total: 0, activeSubscribers: 0 });

  // Layer switcher UI state
  const [activeLayer, setActiveLayer] = useState<TileKey>("standard");
  const [layerPickerOpen, setLayerPickerOpen] = useState(false);

  // Neighborhood UI state
  const [mahalleList, setMahalleList] = useState<MahalleListItem[]>([]);
  const [selectedMahalle, setSelectedMahalle] = useState<string>("🏘️ Mahalleler");
  const [mahallePickerOpen, setMahallePickerOpen] = useState(false);
  const [mahalleSearch, setMahalleSearch] = useState("");

  // Modals state
  const [selectedBuilding, setSelectedBuilding] = useState<SelectedBuilding | null>(null);
  const [infoModalOpen, setInfoModalOpen] = useState(false);
  const [sayacModalOpen, setSayacModalOpen] = useState(false);

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

    L.control.zoom({ position: "bottomright" }).addTo(map);

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

        let totalActive = 0;
        const boundsPoints: L.LatLng[] = [];

        data.forEach((building) => {
          totalActive += building.aktif_abone_sayisi || 0;

          // Configured buildings are highlighted in emerald green instead of standard blue
          const isConfigured = building.is_configured;
          const polyColor = isConfigured ? "#10b981" : "#465fff";
          const polyOpacity = isConfigured ? 0.38 : 0.25;
          const polyWeight = isConfigured ? 2.5 : 1.5;

          building.coordinates.forEach((polygonCoords) => {
            const polygon = L.polygon(polygonCoords, {
              color: polyColor,
              fillColor: polyColor,
              fillOpacity: polyOpacity,
              weight: polyWeight,
            }).addTo(map);

            polygonCoords.forEach(([lat, lng]) => {
              boundsPoints.push(L.latLng(lat, lng));
            });

            const escValue = (building.value || "").replace(/"/g, "&quot;");
            const escLayer = (building.layer || "").replace(/"/g, "&quot;");

            const popupContent = `
              <div style="font-family: Outfit, sans-serif; font-size: 13px; color: #1c2434; padding: 4px; min-width: 210px;">
                <h4 style="margin: 0 0 6px 0; font-size: 14px; font-weight: 700; color: ${isConfigured ? '#10b981' : '#465fff'}; padding-bottom: 5px; border-bottom: 1px solid #e5e7eb;">
                  ${building.value || "Bilinmeyen Bina"}
                </h4>
                <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                  <span style="color: #64748b;">Aktif Abone:</span>
                  <span style="font-weight: 600; color: #10b981;">${building.aktif_abone_sayisi}</span>
                </div>
                <div style="display: flex; justify-content: space-between; margin-bottom: 12px;">
                  <span style="color: #64748b;">Oda ID:</span>
                  <span style="font-weight: 500;">${building.oda_id || "-"}</span>
                </div>
                
                <div style="display: flex; flex-direction: column; gap: 6px;">
                  <button
                    class="bina-bilgi-btn"
                    data-bina-id="${building.id}"
                    data-value="${escValue}"
                    data-layer="${escLayer}"
                    data-oda-id="${building.oda_id ?? ""}"
                    style="width:100%;padding:8px 12px;background:${isConfigured ? '#10b981' : '#465fff'};color:white;border:none;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;font-family:Outfit,sans-serif;"
                  >
                    🏢 Bina Bilgileri Düzenle
                  </button>
                  
                  <button
                    class="bina-sayac-btn"
                    data-bina-id="${building.id}"
                    data-value="${escValue}"
                    data-layer="${escLayer}"
                    data-oda-id="${building.oda_id ?? ""}"
                    style="width:100%;padding:8px 12px;background:#10b981;color:white;border:none;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;font-family:Outfit,sans-serif;"
                  >
                    ⚡ Sayaç Ekle / Düzenle
                  </button>
                </div>
              </div>
            `;

            polygon.bindPopup(popupContent, { minWidth: 230 });

            polygon.on("mouseover", () => {
              polygon.setStyle({ fillColor: isConfigured ? "#059669" : "#3c50e0", fillOpacity: 0.45, weight: polyWeight + 0.5 });
            });
            polygon.on("mouseout", () => {
              polygon.setStyle({ fillColor: polyColor, fillOpacity: polyOpacity, weight: polyWeight });
            });
          });
        });

        if (cancelled || !mapRef.current) return;

        if (boundsPoints.length > 0) {
          const bounds = L.latLngBounds(boundsPoints);
          allBoundsRef.current = bounds;
          if (bounds.isValid()) map.fitBounds(bounds, { padding: [20, 20] });
        }

        setStats({ total: data.length, activeSubscribers: totalActive });
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message);
        setLoading(false);
      });

    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        activeTileRef.current = null;
        activeHighlightRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        setSelectedMahalle("🏘️ Mahalleler");
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

      {/* Stats Widget */}
      {!loading && !error && (
        <div className="absolute top-4 left-4 z-999 bg-white/95 dark:bg-gray-900/95 shadow-lg rounded-xl p-4 border border-gray-100 dark:border-gray-800 backdrop-blur-sm flex flex-col gap-2 min-w-48">
          <h3 className="font-bold text-gray-800 dark:text-white border-b border-gray-100 dark:border-gray-800 pb-2 flex items-center gap-2 text-sm">
            <span className="h-2 w-2 rounded-full bg-brand-500 animate-ping inline-block"></span>
            Malatya Bina Verileri
          </h3>
          <div className="grid grid-cols-2 gap-4 text-center text-xs mt-1">
            <div>
              <div className="font-bold text-xl text-brand-500">{stats.total.toLocaleString("tr-TR")}</div>
              <div className="text-gray-500 dark:text-gray-400 font-medium">Toplam Bina</div>
            </div>
            <div>
              <div className="font-bold text-xl text-emerald-500">{stats.activeSubscribers.toLocaleString("tr-TR")}</div>
              <div className="text-gray-500 dark:text-gray-400 font-medium">Aktif Abone</div>
            </div>
          </div>
        </div>
      )}

      {/* Controls Container */}
      {!loading && !error && (
        <div className="absolute top-4 right-4 z-999 flex flex-col gap-2.5 items-end">
          {/* Layer Switcher */}
          <div className="relative">
            <button
              onClick={() => {
                setLayerPickerOpen((v) => !v);
                setMahallePickerOpen(false);
              }}
              className="flex items-center gap-2 bg-white/95 dark:bg-gray-900/95 shadow-lg rounded-xl px-4 py-2.5 border border-gray-100 dark:border-gray-800 backdrop-blur-sm text-sm font-semibold text-gray-700 dark:text-gray-200 hover:bg-white dark:hover:bg-gray-800 transition"
              title="Katman Seç"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="12 2 2 7 12 12 22 7 12 2" />
                <polyline points="2 17 12 22 22 17" />
                <polyline points="2 12 12 17 22 12" />
              </svg>
              {TILE_LAYERS[activeLayer].label}
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={`transition-transform ${layerPickerOpen ? "rotate-180" : ""}`}>
                <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>

            {layerPickerOpen && (
              <div className="absolute right-0 mt-2 w-52 bg-white/98 dark:bg-gray-900/98 shadow-xl rounded-xl border border-gray-100 dark:border-gray-800 overflow-hidden backdrop-blur-sm z-999">
                {(Object.entries(TILE_LAYERS) as [TileKey, typeof TILE_LAYERS[TileKey]][]).map(([key, def]) => (
                  <button
                    key={key}
                    onClick={() => {
                      setActiveLayer(key);
                      setLayerPickerOpen(false);
                    }}
                    className={`w-full text-left px-4 py-3 text-sm flex items-center gap-3 transition hover:bg-gray-50 dark:hover:bg-gray-800 ${
                      activeLayer === key
                        ? "bg-brand-50 dark:bg-brand-950 text-brand-600 dark:text-brand-400 font-semibold"
                        : "text-gray-700 dark:text-gray-300"
                    }`}
                  >
                    <span className="text-base">{def.label.split(" ")[0]}</span>
                    <span>{def.label.split(" ").slice(1).join(" ")}</span>
                    {activeLayer === key && (
                      <svg className="ml-auto" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Neighborhood (Mahalle) Switcher */}
          <div className="relative">
            <button
              onClick={() => {
                setMahallePickerOpen((v) => !v);
                setLayerPickerOpen(false);
                setMahalleSearch(""); // Clear search when opening/closing
              }}
              className="flex items-center gap-2 bg-white/95 dark:bg-gray-900/95 shadow-lg rounded-xl px-4 py-2.5 border border-gray-100 dark:border-gray-800 backdrop-blur-sm text-sm font-semibold text-gray-700 dark:text-gray-200 hover:bg-white dark:hover:bg-gray-800 transition"
              title="Mahalleye Odaklan"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
              {selectedMahalle}
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={`transition-transform ${mahallePickerOpen ? "rotate-180" : ""}`}>
                <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>

            {mahallePickerOpen && (
              <div className="absolute right-0 mt-2 w-64 bg-white/98 dark:bg-gray-900/98 shadow-xl rounded-xl border border-gray-100 dark:border-gray-800 overflow-hidden backdrop-blur-sm z-999 flex flex-col">
                {/* Search Box */}
                <div className="p-2 border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/40">
                  <input
                    type="text"
                    placeholder="Mahalle ara..."
                    value={mahalleSearch}
                    onChange={(e) => setMahalleSearch(e.target.value)}
                    onClick={(e) => e.stopPropagation()} // Stop closing dropdown on click
                    className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-xs text-gray-800 dark:text-white focus:outline-none focus:ring-1 focus:ring-brand-500"
                  />
                </div>

                <div className="max-h-60 overflow-y-auto">
                  <button
                    onClick={() => handleMahalleSelect("🏘️ Mahalleler", null)}
                    className="w-full text-left px-4 py-2.5 text-sm flex items-center gap-2.5 transition hover:bg-gray-50 dark:hover:bg-gray-850 text-red-500 font-semibold border-b border-gray-100 dark:border-gray-800"
                  >
                    <span>❌</span>
                    <span>Odaklanmayı Temizle</span>
                  </button>
                  
                  {filteredMahalleList.length === 0 ? (
                    <div className="px-4 py-3 text-xs text-gray-400 dark:text-gray-500 text-center">
                      Eşleşen mahalle bulunamadı.
                    </div>
                  ) : (
                    filteredMahalleList.map((mahalle) => (
                      <button
                        key={mahalle.name}
                        onClick={() => handleMahalleSelect(mahalle.name, mahalle.center)}
                        className={`w-full text-left px-4 py-2.5 text-sm flex items-center gap-2.5 transition hover:bg-gray-50 dark:hover:bg-gray-800 ${
                          selectedMahalle === mahalle.name
                            ? "bg-brand-50 dark:bg-brand-950 text-brand-600 dark:text-brand-400 font-semibold"
                            : "text-gray-700 dark:text-gray-300"
                        }`}
                      >
                        <span className="text-sm">🏘️</span>
                        <span>{mahalle.name}</span>
                        {selectedMahalle === mahalle.name && (
                          <svg className="ml-auto text-brand-500" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
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
      )}

      {/* Map Container */}
      <div ref={mapContainerRef} className="w-full h-full" />

      {/* Building Info Modal */}
      {infoModalOpen && (
        <BuildingInfoModal
          building={selectedBuilding}
          onClose={() => { setInfoModalOpen(false); setSelectedBuilding(null); }}
        />
      )}

      {/* Sayac Modal */}
      {sayacModalOpen && (
        <SayacModal
          building={selectedBuilding}
          onClose={() => { setSayacModalOpen(false); setSelectedBuilding(null); }}
        />
      )}
    </div>
  );
}
