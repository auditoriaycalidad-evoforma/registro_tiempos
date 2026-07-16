"use client";

import React, { useState } from "react";
import { Trash2, AlertTriangle } from "lucide-react";
import { cleanDatabaseRecords } from "@/app/actions/admin";

export function CleanDatabaseButton() {
  const [isCleaning, setIsCleaning] = useState(false);
  const [cleanupDate, setCleanupDate] = useState("");
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);

  const handleCleanup = async () => {
    const targetDesc = cleanupDate 
      ? `anteriores al ${cleanupDate}` 
      : "TODOS los registros";
      
    const confirmMsg = `¿Está seguro de que desea eliminar permanentemente ${targetDesc} de la base de datos local de la aplicación?\n\nEsta acción NO afectará ni modificará los datos respaldados en Google Sheets.`;
    if (!window.confirm(confirmMsg)) return;

    setIsCleaning(true);
    setMessage(null);

    try {
      const res = await cleanDatabaseRecords(cleanupDate || undefined);
      setIsCleaning(false);

      if (res.error) {
        setMessage({ text: res.error, type: "error" });
      } else {
        setMessage({
          text: `Limpieza exitosa. Se eliminaron ${res.count} registros de la aplicación.`,
          type: "success",
        });
        setTimeout(() => {
          window.location.reload();
        }, 1500);
      }
    } catch (err) {
      setIsCleaning(false);
      setMessage({ text: "Error de red al ejecutar la limpieza.", type: "error" });
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-red-200 overflow-hidden">
      <div className="p-6 border-b border-red-100 bg-red-50/50 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-red-600 animate-pulse" />
          <h2 className="text-lg font-bold text-red-800">Limpieza de Registros de la Aplicación</h2>
        </div>
        <span className="text-[10px] uppercase font-extrabold bg-red-100 text-red-800 px-2.5 py-0.5 rounded-full border border-red-200">
          Solo Administrador
        </span>
      </div>
      <div className="p-6 space-y-4">
        <p className="text-sm text-brand-dark/80 leading-relaxed font-medium">
          Elimina los registros locales de la base de datos de la aplicación para iniciar un nuevo período de trabajo.
          La información en **Google Sheets** permanecerá intacta y a salvo.
        </p>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-end gap-4 pt-2">
          <div className="flex-1">
            <label className="block text-xs font-bold text-brand-dark/70 mb-1.5 uppercase">
              Rango de eliminación
            </label>
            <select
              value={cleanupDate ? "date" : "all"}
              onChange={(e) => {
                if (e.target.value === "all") {
                  setCleanupDate("");
                } else {
                  const today = new Date();
                  const year = today.getFullYear();
                  const month = String(today.getMonth() + 1).padStart(2, "0");
                  setCleanupDate(`${year}-${month}-01`);
                }
              }}
              className="px-3 py-2 w-full text-xs rounded-lg border border-brand-dark/20 text-brand-dark focus:outline-none focus:ring-2 focus:ring-red-500/50 focus:border-red-500 bg-white font-medium"
            >
              <option value="all">Eliminar todos los registros históricos de la app</option>
              <option value="date">Eliminar registros anteriores a una fecha</option>
            </select>
          </div>

          {cleanupDate !== "" && (
            <div className="flex-1">
              <label className="block text-xs font-bold text-brand-dark/70 mb-1.5 uppercase">
                Fecha límite
              </label>
              <input
                type="date"
                value={cleanupDate}
                onChange={(e) => setCleanupDate(e.target.value)}
                className="px-3 py-2 w-full text-xs rounded-lg border border-brand-dark/20 text-brand-dark focus:outline-none focus:ring-2 focus:ring-red-500/50 focus:border-red-500 bg-white font-medium"
              />
            </div>
          )}

          <div>
            <button
              type="button"
              onClick={handleCleanup}
              disabled={isCleaning}
              className="px-5 py-2.5 bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white font-bold text-sm rounded-lg shadow-md hover:shadow-lg transition-all active:scale-[0.98] w-full sm:w-auto flex items-center justify-center gap-2 whitespace-nowrap"
            >
              <Trash2 className="w-4 h-4" />
              {isCleaning ? "Limpiando..." : "Ejecutar Limpieza"}
            </button>
          </div>
        </div>

        {message && (
          <div className={`p-4 rounded-lg text-xs font-bold leading-normal flex items-start gap-2.5 animate-fadeIn ${
            message.type === "success" ? "bg-green-50 border-l-4 border-green-500 text-green-700" : "bg-red-50 border-l-4 border-red-500 text-red-700"
          }`}>
            <span>{message.text}</span>
          </div>
        )}
      </div>
    </div>
  );
}
