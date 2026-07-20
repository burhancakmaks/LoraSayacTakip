"use client";

import React, { useEffect, useState } from "react";
import { Modal } from "@/components/ui/modal";

interface SelectedBuilding {
  id: number;
  value: string | null;
  layer: string | null;
  oda_id: number | null;
}

interface BuildingInfoModalProps {
  building: SelectedBuilding | null;
  onClose: () => void;
}

interface FormData {
  kat_sayisi: string;
  daire_sayisi: string;
  ortak_alan_sayisi: string;
  has_zemin: boolean;
  ada_parsel: string;
  sokak: string;
  dis_kapi_no: string;
}

export default function BuildingInfoModal({ building, onClose }: BuildingInfoModalProps) {
  const [form, setForm] = useState<FormData>({
    kat_sayisi: "",
    daire_sayisi: "",
    ortak_alan_sayisi: "",
    has_zemin: false,
    ada_parsel: "",
    sokak: "",
    dis_kapi_no: "",
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const kat = parseInt(form.kat_sayisi) || 0;
  const daire = parseInt(form.daire_sayisi) || 0;
  const ortak = parseInt(form.ortak_alan_sayisi) || 0;
  const toplam = daire + ortak;

  useEffect(() => {
    if (!building) return;
    setSaved(false);
    setError(null);
    setLoading(true);

    fetch(`/api/bina-bilgi?bina_id=${building.id}`)
      .then((r) => r.json())
      .then((data) => {
        if (data) {
          setForm({
            kat_sayisi: String(data.kat_sayisi || ""),
            daire_sayisi: String(data.daire_sayisi || ""),
            ortak_alan_sayisi: String(data.ortak_alan_sayisi || ""),
            has_zemin: data.has_zemin === 1,
            ada_parsel: data.ada_parsel || "",
            sokak: data.sokak || "",
            dis_kapi_no: data.dis_kapi_no || "",
          });
        } else {
          setForm({
            kat_sayisi: "",
            daire_sayisi: "",
            ortak_alan_sayisi: "",
            has_zemin: false,
            ada_parsel: "",
            sokak: "",
            dis_kapi_no: "",
          });
        }
      })
      .catch(() => setForm({
        kat_sayisi: "",
        daire_sayisi: "",
        ortak_alan_sayisi: "",
        has_zemin: false,
        ada_parsel: "",
        sokak: "",
        dis_kapi_no: "",
      }))
      .finally(() => setLoading(false));
  }, [building]);

  const handleSave = async () => {
    if (!building) return;
    setSaving(true);
    setError(null);

    try {
      const res = await fetch("/api/bina-bilgi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bina_id: building.id,
          kat_sayisi: kat,
          daire_sayisi: daire,
          ortak_alan_sayisi: ortak,
          has_zemin: form.has_zemin,
          ada_parsel: form.ada_parsel,
          sokak: form.sokak,
          dis_kapi_no: form.dis_kapi_no,
        }),
      });
      if (!res.ok) throw new Error("Kayıt sırasında hata oluştu.");
      setSaved(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={building !== null}
      onClose={onClose}
      className="max-w-md m-4"
    >
      {/* Header */}
      <div className="px-6 pt-6 pb-4 border-b border-gray-100 dark:border-gray-800 pr-12">
        <h2 className="text-gray-900 dark:text-white font-bold text-lg leading-tight">
          🏢 Bina Bilgileri
        </h2>
        <p className="text-gray-400 dark:text-gray-500 text-xs mt-1 truncate max-w-xs">
          {building?.value || "Bilinmeyen Bina"} — ODA #{building?.oda_id}
        </p>
      </div>

      {/* Body */}
      <div className="px-6 py-5">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-500 border-t-transparent"></div>
          </div>
        ) : (
          <>
            <p className="text-gray-500 dark:text-gray-400 text-sm mb-4">
              Bina kimlik bilgilerini ve kat yapısını girerek ortak yapıyı tanımlayın.
            </p>
            <div className="flex flex-col gap-4">
              {/* Ada Parsel & Dış Kapı No */}
              <div className="grid grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-200 mb-1.5">🗺️ Ada / Parsel</label>
                  <input
                    type="text" placeholder="Örn: 41-134"
                    value={form.ada_parsel}
                    onChange={(e) => { setForm((f) => ({ ...f, ada_parsel: e.target.value })); setSaved(false); }}
                    className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-4 py-2.5 text-gray-800 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 transition"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-200 mb-1.5">🚪 Dış Kapı No</label>
                  <input
                    type="text" placeholder="Örn: 2"
                    value={form.dis_kapi_no}
                    onChange={(e) => { setForm((f) => ({ ...f, dis_kapi_no: e.target.value })); setSaved(false); }}
                    className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-4 py-2.5 text-gray-800 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 transition"
                  />
                </div>
              </div>

              {/* Sokak / Cadde */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-200 mb-1.5">📍 Sokak / Cadde Adı</label>
                <input
                  type="text" placeholder="Örn: Kelam Sokak"
                  value={form.sokak}
                  onChange={(e) => { setForm((f) => ({ ...f, sokak: e.target.value })); setSaved(false); }}
                  className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-4 py-2.5 text-gray-800 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 transition"
                />
              </div>

              <hr className="border-gray-100 dark:border-gray-800 my-1" />

              {/* Kat Sayısı */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-200 mb-1.5">🏢 Kat Sayısı</label>
                <input
                  type="number" min={0} placeholder="Örn: 5"
                  value={form.kat_sayisi}
                  onChange={(e) => { setForm((f) => ({ ...f, kat_sayisi: e.target.value })); setSaved(false); }}
                  className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-4 py-2.5 text-gray-800 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 transition"
                />
              </div>

              {/* Zemin Kat Seçeneği */}
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="has_zemin"
                  checked={form.has_zemin}
                  onChange={(e) => { setForm((f) => ({ ...f, has_zemin: e.target.checked })); setSaved(false); }}
                  className="w-4.5 h-4.5 text-brand-500 border-gray-200 dark:border-gray-700 rounded-md focus:ring-brand-500 cursor-pointer"
                />
                <label htmlFor="has_zemin" className="text-sm font-medium text-gray-700 dark:text-gray-200 cursor-pointer select-none">
                  ➕ Zemin Kat Var mı? (Varsa listede "ZEMİN KAT" seçeneği belirir)
                </label>
              </div>

              {/* Toplam Daire Sayısı */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-200 mb-1.5">🚪 Toplam Daire Sayısı</label>
                <input
                  type="number" min={0} placeholder="Örn: 20"
                  value={form.daire_sayisi}
                  onChange={(e) => { setForm((f) => ({ ...f, daire_sayisi: e.target.value })); setSaved(false); }}
                  className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-4 py-2.5 text-gray-800 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 transition"
                />
              </div>

              {/* Ortak Alan */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-200 mb-1.5">
                  🏛️ Ortak Alan Sayısı
                  <span className="text-gray-400 font-normal ml-1">(WC, idare, mescid, dükkan vb.)</span>
                </label>
                <input
                  type="number" min={0} placeholder="Örn: 2"
                  value={form.ortak_alan_sayisi}
                  onChange={(e) => { setForm((f) => ({ ...f, ortak_alan_sayisi: e.target.value })); setSaved(false); }}
                  className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-4 py-2.5 text-gray-800 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 transition"
                />
              </div>
            </div>

            {/* Result */}
            <div className="mt-5 rounded-xl bg-brand-50 dark:bg-brand-950/20 border border-brand-100 dark:border-brand-900/30 px-5 py-4 flex items-center justify-between">
              <div>
                <div className="text-sm text-brand-600 dark:text-brand-300 font-medium">Toplam Bağımsız Bölüm</div>
                <div className="text-xs text-brand-400 dark:text-brand-500 mt-0.5">
                  {daire} daire + {ortak} ortak alan
                  {kat > 0 && (
                    <span className="ml-1 text-brand-300 dark:text-brand-600">
                      (Bina: {form.has_zemin ? "Zemin +" : ""} {kat} katlı)
                    </span>
                  )}
                </div>
              </div>
              <div className="text-4xl font-black text-brand-500">{toplam}</div>
            </div>

            {error && (
              <div className="mt-3 text-sm text-red-500 bg-red-50 dark:bg-red-900/20 rounded-lg px-4 py-2">{error}</div>
            )}
            {saved && (
              <div className="mt-3 text-sm text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg px-4 py-2 flex items-center gap-2">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Bina bilgileri başarıyla kaydedildi.
              </div>
            )}
          </>
        )}
      </div>

      {!loading && (
        <div className="px-6 pb-6 border-t border-gray-100 dark:border-gray-800 pt-4 flex gap-3 justify-end">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-semibold text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition">
            Kapat
          </button>
          <button
            onClick={handleSave}
            disabled={saving || (kat === 0 && daire === 0 && ortak === 0)}
            className="px-5 py-2 rounded-lg text-sm font-semibold text-white bg-brand-500 hover:bg-brand-600 disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center gap-2"
          >
            {saving && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent inline-block"></span>}
            Kaydet
          </button>
        </div>
      )}
    </Modal>
  );
}
