"use client";

import React, { useState } from "react";
import { PlusCircle, History, Clock } from "lucide-react";
import { MinutaForm } from "@/components/MinutaForm";
import { HistorialTiempos } from "@/components/HistorialTiempos";

interface DashboardPanelsProps {
  proyectos: any[];
  actividades: any[];
  empleados: any[];
  defaultEmpleadoId: string;
  minutas: any[];
}

export function DashboardPanels({
  proyectos,
  actividades,
  empleados,
  defaultEmpleadoId,
  minutas,
}: DashboardPanelsProps) {
  const [activeTab, setActiveTab] = useState<"registro" | "historial">("historial");

  return (
    <div className="w-full space-y-6">
      {/* Selector Modular de Paneles */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white p-3 sm:p-4 rounded-2xl shadow-sm border border-brand-dark/10">
        <div className="flex items-center gap-2">
          <Clock className="w-6 h-6 text-brand-primary" />
          <div>
            <h2 className="text-lg font-extrabold text-brand-dark leading-tight">
              {activeTab === "registro" ? "Nuevo Registro de Tiempo" : "Historial de Registros"}
            </h2>
            <p className="text-xs text-brand-dark/60">
              {activeTab === "registro"
                ? "Ingresa y guarda horas y actividades para los colaboradores."
                : "Consulta, filtra y modifica los registros de tiempo almacenados."}
            </p>
          </div>
        </div>

        {/* Segmented Tab Controls */}
        <div className="flex p-1 bg-slate-100 rounded-xl w-full sm:w-auto self-stretch sm:self-auto border border-brand-dark/5">
          <button
            type="button"
            onClick={() => setActiveTab("historial")}
            className={`flex-1 sm:flex-initial inline-flex items-center justify-center gap-2 px-4 py-2 text-xs sm:text-sm font-bold rounded-lg transition-all ${
              activeTab === "historial"
                ? "bg-white text-brand-primary shadow-sm"
                : "text-brand-dark/60 hover:text-brand-dark hover:bg-white/50"
            }`}
          >
            <History className="w-4 h-4" />
            <span>Historial de Tiempos</span>
            <span
              className={`px-1.5 py-0.5 rounded-full text-[10px] font-extrabold ${
                activeTab === "historial"
                  ? "bg-brand-primary/10 text-brand-primary"
                  : "bg-brand-dark/10 text-brand-dark/70"
              }`}
            >
              {minutas.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("registro")}
            className={`flex-1 sm:flex-initial inline-flex items-center justify-center gap-2 px-4 py-2 text-xs sm:text-sm font-bold rounded-lg transition-all ${
              activeTab === "registro"
                ? "bg-white text-brand-primary shadow-sm"
                : "text-brand-dark/60 hover:text-brand-dark hover:bg-white/50"
            }`}
          >
            <PlusCircle className="w-4 h-4" />
            <span>Nuevo Registro</span>
          </button>
        </div>
      </div>

      {/* Contenido Modular del Panel Activo */}
      <div className="w-full">
        {activeTab === "registro" ? (
          <div className="max-w-4xl mx-auto w-full animate-fadeIn">
            <MinutaForm
              proyectos={proyectos}
              actividades={actividades}
              empleados={empleados}
              canSelectEmpleado={true}
              defaultEmpleadoId={defaultEmpleadoId}
            />
          </div>
        ) : (
          <div className="w-full animate-fadeIn">
            <HistorialTiempos
              tiempos={minutas}
              proyectos={proyectos}
              actividades={actividades}
              empleados={empleados}
            />
          </div>
        )}
      </div>
    </div>
  );
}
