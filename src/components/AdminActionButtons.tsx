"use client";

import { approveMinuta } from "@/app/actions/admin";
import { Check, X } from "lucide-react";
import { useState } from "react";

export function AdminActionButtons({ id }: { id: number }) {
  const [loading, setLoading] = useState(false);

  const handleAction = async (decision: "SI" | "RE") => {
    setLoading(true);
    await approveMinuta(id, decision);
    setLoading(false);
  };

  return (
    <div className="flex gap-2 justify-center">
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
    </div>
  );
}
