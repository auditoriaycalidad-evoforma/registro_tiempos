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

// Web Push: mostrar notificación incluso con el navegador cerrado
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
