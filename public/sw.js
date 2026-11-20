self.addEventListener("install", () => {
  // Force active service worker immediately
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// A fetch handler is required for PWA installation
self.addEventListener("fetch", () => {
  // Passthrough to the network
});

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

// Web Push: mostrar notificación incluso con el navegador y la aplicación cerrados
self.addEventListener("push", (event) => {
  let payload = {
    title: "Evoforma - Recordatorio de jornada",
    body: "Recuerda registrar o cerrar tu actividad.",
    tag: "evoforma-recordatorio",
    url: "/pwa",
  };

  if (event.data) {
    try {
      const parsed = event.data.json();
      payload = {
        ...payload,
        ...parsed,
      };
    } catch {
      const text = event.data.text();
      if (text) {
        payload.body = text;
      }
    }
  }

  const options = {
    body: payload.body,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: payload.tag,
    vibrate: [200, 100, 200],
    renotify: false,
    requireInteraction: false,
    data: {
      url: payload.url || "/pwa",
      tipoEvento: payload.tipoEvento || null,
      fecha: payload.fecha || null,
      horaObjetivo: payload.horaObjetivo || null,
    },
  };

  event.waitUntil(self.registration.showNotification(payload.title, options));
});

// Si el navegador rota la suscripción en segundo plano, re-suscribir y sincronizar con el backend
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      try {
        let newSub = event.newSubscription;
        if (!newSub) {
          const vapidRes = await fetch("/api/push/vapid-public-key", { cache: "no-store" });
          if (!vapidRes.ok) return;
          const vapidData = await vapidRes.json();
          if (!vapidData?.configured || !vapidData?.publicKey) return;

          newSub = await self.registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(vapidData.publicKey),
          });
        }

        const json = newSub.toJSON();
        if (!json?.endpoint || !json?.keys?.p256dh || !json?.keys?.auth) return;

        await fetch("/api/push/subscribe", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            endpoint: json.endpoint,
            keys: {
              p256dh: json.keys.p256dh,
              auth: json.keys.auth,
            },
          }),
        });
      } catch (err) {
        console.error("[SW] Error renovando suscripción Web Push:", err);
      }
    })()
  );
});

// Al hacer clic en la notificación, enfocar ventana abierta o abrir la app
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl =
    (event.notification.data && event.notification.data.url) || "/pwa";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if (client.url.includes(self.location.origin) && "focus" in client) {
            return client.focus();
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
        return undefined;
      })
  );
});
