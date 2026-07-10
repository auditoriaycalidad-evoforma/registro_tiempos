self.addEventListener('install', (event) => {
  // Force active service worker immediately
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// A fetch handler is required for PWA installation
self.addEventListener('fetch', (event) => {
  // Passthrough to the network
});
