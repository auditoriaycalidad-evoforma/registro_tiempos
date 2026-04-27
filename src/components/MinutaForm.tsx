"use client";

import { useRef, useState } from "react";
import { createMinuta } from "@/app/actions/minuta";

export function MinutaForm({ proyectos, actividades }: { proyectos: any[]; actividades: any[] }) {
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  async function action(formData: FormData) {
    setLoading(true);
    setError(null);
    setSuccess(false);

    const res = await createMinuta(formData);
    
    if (res?.error) {
      setError(res.error);
    } else {
      setSuccess(true);
      formRef.current?.reset();
    }
    setLoading(false);
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-brand-dark/10 p-6">
      <h2 className="text-xl font-bold text-brand-dark mb-6 border-b pb-2">Nueva Actividad</h2>
      
      {error && <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-md text-sm">{error}</div>}
      {success && <div className="mb-4 p-3 bg-green-50 text-green-700 rounded-md text-sm">Actividad registrada correctamente</div>}

      <form ref={formRef} action={action} className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-brand-dark/90 mb-1">Tipo de Minuta</label>
            <select name="tipo" required className="w-full rounded-md border border-brand-dark/20 px-3 py-2 text-brand-dark focus:outline-none focus:ring-brand-primary focus:border-brand-primary">
              <option value="">Seleccione un tipo</option>
              <option value="A">Tipo A (Horario Habitual)</option>
              <option value="B">Tipo B (Horas Adicionales)</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-brand-dark/90 mb-1">Fecha</label>
            <input type="date" name="fecha" required className="w-full rounded-md border border-brand-dark/20 px-3 py-2 text-brand-dark focus:outline-none focus:ring-brand-primary focus:border-brand-primary" />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-brand-dark/90 mb-1">Cédula del Proyecto</label>
            <select name="proyecto" required className="w-full rounded-md border border-brand-dark/20 px-3 py-2 text-brand-dark focus:outline-none focus:ring-brand-primary focus:border-brand-primary">
              <option value="">Seleccione una cédula</option>
              {proyectos.map((p) => (
                <option key={p.code} value={p.code}>{p.code}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-brand-dark/90 mb-1">Actividad</label>
            <select name="actividad" required className="w-full rounded-md border border-brand-dark/20 px-3 py-2 text-brand-dark focus:outline-none focus:ring-brand-primary focus:border-brand-primary">
              <option value="">Seleccione una actividad</option>
              {actividades.map((a) => (
                <option key={a.code} value={a.code}>{a.nombre} {a.area ? `(${a.area})` : ''}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-brand-dark/90 mb-1">Hora de Inicio (Franja Militar)</label>
            <input type="text" name="horaInicio" placeholder="Ej: 0800" pattern="^([01]\d|2[0-3])[0-5]\d$" maxLength={4} required className="w-full rounded-md border border-brand-dark/20 px-3 py-2 text-brand-dark focus:outline-none focus:ring-brand-primary focus:border-brand-primary" />
          </div>
          <div>
            <label className="block text-sm font-medium text-brand-dark/90 mb-1">Hora de Fin (Franja Militar)</label>
            <input type="text" name="horaFin" placeholder="Ej: 1730" pattern="^([01]\d|2[0-3])[0-5]\d$" maxLength={4} required className="w-full rounded-md border border-brand-dark/20 px-3 py-2 text-brand-dark focus:outline-none focus:ring-brand-primary focus:border-brand-primary" />
          </div>
        </div>

        <div className="pt-2">
          <button 
            type="submit" 
            disabled={loading}
            className="w-full flex justify-center py-2.5 px-4 rounded-md shadow-sm text-sm font-medium text-white bg-brand-primary hover:bg-brand-primary/90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-primary disabled:opacity-50 transition-colors"
          >
            {loading ? "Guardando..." : "Registrar Actividad"}
          </button>
        </div>
      </form>
    </div>
  );
}
