"use client";

import { Check, X, Trash2 } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function AdminActionButtons({ 
  id, 
  isAdmin = false,
  onDeleteClick
}: { 
  id: number; 
  isAdmin?: boolean;
  onDeleteClick?: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleAction = async (decision: "SI" | "RE") => {
    setLoading(true);
    try {
      const res = await fetch("/api/minuta/aprobar", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ id, decision }),
      });

      if (res.ok) {
        router.refresh();
      }
    } catch (err) {
      console.error("Error al aprobar/rechazar:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (onDeleteClick) {
      onDeleteClick();
      return;
    }

    if (!window.confirm("¿Estás seguro de que deseas eliminar este registro de tiempo de forma permanente?")) {
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/minuta/${id}`, {
        method: "DELETE",
      });

      if (res.ok) {
        router.refresh();
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data?.error || "Error al eliminar el registro.");
      }
    } catch (err) {
      console.error("Error al eliminar registro:", err);
      alert("Error de conexión al eliminar el registro.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex gap-1.5 justify-center items-center">
      <button
        onClick={() => handleAction("SI")}
        disabled={loading}
        title="Aprobar"
        className="p-1.5 bg-green-100 text-green-700 hover:bg-green-200 rounded-md transition-colors disabled:opacity-50"
      >
        <Check className="w-4 h-4" />
      </button>
      <button
        onClick={() => handleAction("RE")}
        disabled={loading}
        title="Rechazar"
        className="p-1.5 bg-red-100 text-red-700 hover:bg-red-200 rounded-md transition-colors disabled:opacity-50"
      >
        <X className="w-4 h-4" />
      </button>
      {isAdmin && (
        <button
          onClick={handleDelete}
          disabled={loading}
          title="Eliminar registro"
          className="p-1.5 bg-slate-100 text-slate-500 hover:bg-red-100 hover:text-red-700 rounded-md transition-colors disabled:opacity-50"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}
