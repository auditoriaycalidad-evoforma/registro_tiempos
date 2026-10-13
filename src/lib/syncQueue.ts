/**
 * Cola de sincronización en segundo plano con Google Sheets.
 * 
 * Principio: CERO IMPACTO OPERATIVO.
 * 1. No bloquea el hilo HTTP ni las peticiones de los usuarios: la interfaz responde al instante.
 * 2. Serializa las llamadas a Google Sheets para evitar condiciones de carrera y límites de cuota (Rate Limits 429).
 * 3. Consolida cambios múltiples o concurrentes en ráfaga (debouncing) asegurando que Sheets
 *    siempre refleje fielmente el estado final de PostgreSQL.
 * 4. Aísla cualquier lentitud o fallo temporal de Google Sheets para que nunca afecte
 *    el flujo de trabajo de los colaboradores y auditores.
 */

class SheetsSyncQueue {
  private isProcessing = false;
  private pendingCargos = new Set<string>();
  private syncAllPending = false;

  public enqueue(targetCargos?: string[]) {
    // Si no están configuradas las credenciales, no hacer nada
    if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY) {
      return;
    }

    if (!targetCargos || targetCargos.length === 0) {
      this.syncAllPending = true;
    } else {
      targetCargos.forEach((c) => {
        if (c && c.trim()) this.pendingCargos.add(c.trim());
      });
    }

    // Delegar al event loop de Node.js en segundo plano sin retrasar la respuesta al usuario
    setImmediate(() => {
      this.processQueue().catch((err) => {
        console.error("[SheetsSyncQueue] Error en el procesamiento en segundo plano:", err);
      });
    });
  }

  private async processQueue() {
    if (this.isProcessing) {
      // Ya hay una tarea de sincronización ejecutándose; los cargos pendientes
      // acumulados se procesarán en la siguiente pasada del ciclo while.
      return;
    }

    this.isProcessing = true;

    try {
      while (this.syncAllPending || this.pendingCargos.size > 0) {
        const syncAll = this.syncAllPending;
        const cargos = Array.from(this.pendingCargos);

        // Reiniciar acumuladores para este lote
        this.syncAllPending = false;
        this.pendingCargos.clear();

        // Pequeño margen (300ms) para agrupar operaciones simultáneas de usuarios
        await new Promise((resolve) => setTimeout(resolve, 300));

        try {
          // Import dinámico para evitar dependencias circulares
          const { syncMinutasToSheets } = await import("@/app/actions/exportar");
          await syncMinutasToSheets({
            skipAuth: true,
            targetCargos: syncAll ? undefined : (cargos.length > 0 ? cargos : undefined),
          });
        } catch (syncErr) {
          console.error("[SheetsSyncQueue] Error al sincronizar cambios con Google Sheets:", syncErr);
        }
      }
    } finally {
      this.isProcessing = false;
    }
  }
}

// Mantener instancia singleton global en el servidor Node.js
const globalForQueue = globalThis as unknown as { sheetsSyncQueue?: SheetsSyncQueue };
export const sheetsSyncQueue = globalForQueue.sheetsSyncQueue ?? new SheetsSyncQueue();
if (process.env.NODE_ENV !== "production") {
  globalForQueue.sheetsSyncQueue = sheetsSyncQueue;
}
