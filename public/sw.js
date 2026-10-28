// Shows the banners the Mac pushes to this device, and opens the chat a
// banner is about when it is tapped. iOS revokes a subscription whose push
// shows nothing, so every push becomes a notification.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    closeTagged(Array.isArray(data.retire) ? data.retire : []).then(() =>
      self.registration.showNotification(data.title || "Irgatos", {
        body: data.body || "",
        tag: data.tag || undefined,
        icon: "/irgat.png",
        data: { url: data.url || "/" },
      }),
    ),
  );
});

// Banners for questions answered or expired since; the page also clears
// them when it opens, see web-access/page/push.ts.
function closeTagged(tags) {
  if (tags.length === 0) return Promise.resolve();
  const retired = new Set(tags);
  return self.registration
    .getNotifications()
    .then((shown) => {
      for (const notification of shown) {
        if (retired.has(notification.tag)) notification.close();
      }
    })
    .catch(() => {});
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/", self.location.origin)
    .href;
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windows) => {
        const open = windows.find((client) => "focus" in client);
        if (!open) return self.clients.openWindow(url);
        return open.focus().then((client) => client.navigate?.(url) ?? client);
      }),
  );
});
