"use client";

import { syncMinutasToSheets } from "@/app/actions/exportar";
import { RefreshCw } from "lucide-react";
import { useState, useTransition } from "react";

type SyncFile = {
  cargo: string;
  rows: number;
  fileName: string;
  url: string;
};

type SyncState = {
  success: boolean;
  year: number;
  totalRows: number;
  files: SyncFile[];
  syncedAt: string;
};

export function ExportSyncButton() {
  const [isPending, startTransition] = useTransition();
  const [syncState, setSyncState] = useState<SyncState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSync = () => {
    setError(null);
    startTransition(async () => {
      try {
        const result = await syncMinutasToSheets();
        setSyncState(result);
      } catch (syncError) {
        setError(syncError instanceof Error ? syncError.message : "No se pudo sincronizar la exportación.");
      }
    });
  };

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={handleSync}
        disabled={isPending}
        className="inline-flex items-center gap-2 rounded-md bg-brand-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <RefreshCw className={`h-4 w-4 ${isPending ? "animate-spin" : ""}`} />
        {isPending ? "Sincronizando" : "Sincronizar ahora"}
      </button>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {error}
        </div>
      )}

      {syncState && (
        <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          <p className="font-semibold">
            Exportación actualizada: {syncState.totalRows} registros en {syncState.files.length} archivos.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {syncState.files.map((file) => (
              <a
                key={file.url}
                href={file.url}
                target="_blank"
                rel="noreferrer"
                className="rounded-md bg-white px-3 py-1.5 font-medium text-green-700 underline-offset-2 hover:underline"
              >
                {file.cargo} ({file.rows})
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
