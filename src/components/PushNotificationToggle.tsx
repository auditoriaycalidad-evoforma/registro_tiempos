"use client";

import { useEffect, useState, useCallback } from "react";
import { Bell, BellOff, BellRing, Loader2 } from "lucide-react";

type PushStatus =
  | "checking"
  | "unsupported"
  | "unconfigured"
  | "inactive_employee"
  | "denied"
  | "unsubscribed"
  | "subscribed";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function uint8ArraysEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function hasMatchingApplicationServerKey(
  sub: PushSubscription,
  vapidPublicKey: string
): boolean {
  const existingKey = sub.options?.applicationServerKey;
  if (!existingKey) return true;
  const expected = urlBase64ToUint8Array(vapidPublicKey);
  const actual = new Uint8Array(existingKey);
  return uint8ArraysEqual(actual, expected);
}

export function PushNotificationToggle({
  variant = "navbar",
}: {
  variant?: "navbar" | "pwa";
}) {
  const [status, setStatus] = useState<PushStatus>("checking");
  const [vapidPublicKey, setVapidPublicKey] = useState<string | null>(null);
  const [busy, setBusy] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const showTempFeedback = useCallback((msg: string) => {
    setFeedback(msg);
    setTimeout(() => {
      setFeedback((prev) => (prev === msg ? null : prev));
    }, 4500);
  }, []);

  const syncSubscriptionWithServer = useCallback(async (sub: PushSubscription) => {
    const json = sub.toJSON();
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
      throw new Error("Suscripción del navegador incompleta.");
    }
    const res = await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        endpoint: json.endpoint,
        keys: {
          p256dh: json.keys.p256dh,
          auth: json.keys.auth,
        },
      }),
    });
    if (res.status === 403) {
      return { ok: false, inactive: true };
    }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data?.error || "No se pudo registrar la suscripción.");
    }
    return { ok: true, inactive: false };
  }, []);

  useEffect(() => {
    let mounted = true;

    async function init() {
      if (
        typeof window === "undefined" ||
        !("serviceWorker" in navigator) ||
        !("PushManager" in window) ||
        !("Notification" in window)
      ) {
        if (mounted) setStatus("unsupported");
        return;
      }

      try {
        // 1. Asegurar registro de /sw.js tanto en Dashboard como en PWA
        const registration = await navigator.serviceWorker.register("/sw.js");
        await navigator.serviceWorker.ready;

        // 2. Consultar clave pública VAPID y estado de actividad del empleado
        const [vapidRes, stateRes] = await Promise.all([
          fetch("/api/push/vapid-public-key", { cache: "no-store" }),
          fetch("/api/push/subscribe", { cache: "no-store" }),
        ]);

        const vapidData = vapidRes.ok ? await vapidRes.json() : { configured: false };
        const stateData = stateRes.ok ? await stateRes.json() : { activo: true, subscribed: false };

        if (!mounted) return;

        if (!vapidData.configured || !vapidData.publicKey) {
          setStatus("unconfigured");
          return;
        }
        setVapidPublicKey(vapidData.publicKey);

        if (stateData.activo === false) {
          setStatus("inactive_employee");
          return;
        }

        if (Notification.permission === "denied") {
          setStatus("denied");
          return;
        }

        let existingSub = await registration.pushManager.getSubscription();
        if (existingSub && Notification.permission === "granted") {
          // Si la clave VAPID cambió, renovar suscripción automáticamente para evitar errores 401/403
          if (!hasMatchingApplicationServerKey(existingSub, vapidData.publicKey)) {
            await existingSub.unsubscribe().catch(() => {});
            existingSub = await registration.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey: urlBase64ToUint8Array(vapidData.publicKey) as BufferSource,
            });
          }

          // Resincronizar silenciosamente con el backend para mantener el endpoint vigente
          const synced = await syncSubscriptionWithServer(existingSub).catch(() => ({
            ok: false,
            inactive: false,
          }));
          if (!mounted) return;
          if (synced.inactive) {
            setStatus("inactive_employee");
            return;
          }
          setStatus(synced.ok ? "subscribed" : "unsubscribed");
        } else {
          setStatus("unsubscribed");
        }
      } catch (err) {
        console.warn("[PushToggle] Error inicializando Web Push:", err);
        if (mounted) setStatus("unsubscribed");
      }
    }

    init();
    return () => {
      mounted = false;
    };
  }, [syncSubscriptionWithServer]);

  const handleToggle = async () => {
    if (busy) return;
    if (status === "unsupported" || status === "unconfigured" || status === "inactive_employee") {
      return;
    }

    if (status === "denied") {
      showTempFeedback("Permiso bloqueado en el navegador. Habilítalo desde el ícono del candado.");
      return;
    }

    setBusy(true);
    try {
      const registration = await navigator.serviceWorker.ready;

      if (status === "subscribed") {
        const existingSub = await registration.pushManager.getSubscription();
        const endpoint = existingSub?.endpoint;
        if (existingSub) {
          await existingSub.unsubscribe();
        }
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint }),
        });
        setStatus("unsubscribed");
        showTempFeedback("Notificaciones de jornada desactivadas.");
        return;
      }

      // Activar suscripción push
      if (!vapidPublicKey) {
        setStatus("unconfigured");
        return;
      }

      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus(permission === "denied" ? "denied" : "unsubscribed");
        showTempFeedback("Debes permitir notificaciones en el navegador para recibir avisos.");
        return;
      }

      let sub = await registration.pushManager.getSubscription();
      if (sub && !hasMatchingApplicationServerKey(sub, vapidPublicKey)) {
        await sub.unsubscribe().catch(() => {});
        sub = null;
      }
      if (!sub) {
        sub = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
        });
      }

      const synced = await syncSubscriptionWithServer(sub);
      if (synced.inactive) {
        await sub.unsubscribe().catch(() => {});
        setStatus("inactive_employee");
        showTempFeedback("Tu usuario figura inactivo y no recibe notificaciones.");
        return;
      }

      setStatus("subscribed");
      showTempFeedback("Notificaciones activadas (avisos 5 min antes de entrada y salida).");
    } catch (err: any) {
      console.error("[PushToggle] Error al cambiar suscripción:", err);
      showTempFeedback(err?.message || "No se pudo actualizar la suscripción push.");
    } finally {
      setBusy(false);
    }
  };

  if (status === "checking" || status === "unsupported" || status === "unconfigured" || status === "inactive_employee") {
    return null;
  }

  const isSubscribed = status === "subscribed";
  const isDenied = status === "denied";

  const tooltip = isSubscribed
    ? "Notificaciones push activas (5 min antes de inicio y salida). Clic para desactivar."
    : isDenied
      ? "Notificaciones bloqueadas en el navegador. Habilítalas en la configuración del sitio."
      : "Activar notificaciones push (5 min antes de inicio y salida de jornada).";

  if (variant === "pwa") {
    return (
      <div className="relative">
        <button
          type="button"
          onClick={handleToggle}
          disabled={busy}
          title={tooltip}
          className={`w-9 h-9 rounded-xl flex items-center justify-center active:scale-90 transition-all duration-150 border ${
            isSubscribed
              ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border-emerald-200/70 dark:border-emerald-800/40"
              : isDenied
                ? "bg-red-50 dark:bg-red-950/30 text-red-500 border-red-200/60 dark:border-red-900/40"
                : "bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400 border-amber-200/60 dark:border-amber-800/40 hover:bg-amber-100"
          }`}
        >
          {busy ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : isSubscribed ? (
            <BellRing className="w-4 h-4" />
          ) : isDenied ? (
            <BellOff className="w-4 h-4" />
          ) : (
            <Bell className="w-4 h-4" />
          )}
        </button>

        {feedback && (
          <div className="absolute right-0 mt-2 w-64 p-2.5 rounded-xl bg-slate-900 text-white text-[11px] font-medium shadow-xl z-50 border border-slate-700">
            {feedback}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={handleToggle}
        disabled={busy}
        title={tooltip}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-colors border ${
          isSubscribed
            ? "bg-emerald-500/15 text-emerald-300 border-emerald-400/30 hover:bg-emerald-500/25"
            : isDenied
              ? "bg-red-500/15 text-red-300 border-red-400/30 hover:bg-red-500/25"
              : "bg-brand-primary/20 text-brand-light border-brand-primary/40 hover:bg-brand-primary/30"
        }`}
      >
        {busy ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : isSubscribed ? (
          <BellRing className="w-3.5 h-3.5" />
        ) : isDenied ? (
          <BellOff className="w-3.5 h-3.5" />
        ) : (
          <Bell className="w-3.5 h-3.5" />
        )}
        <span className="hidden md:inline">
          {isSubscribed ? "Avisos activos" : isDenied ? "Avisos bloqueados" : "Activar avisos"}
        </span>
      </button>

      {feedback && (
        <div className="absolute right-0 mt-2 w-72 p-2.5 rounded-lg bg-slate-900 text-white text-xs font-medium shadow-xl z-50 border border-slate-700">
          {feedback}
        </div>
      )}
    </div>
  );
}
