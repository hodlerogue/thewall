/*
 * A service worker that caches nothing, on purpose.
 *
 * It exists for one reason: Chrome's install criteria have historically wanted
 * a service worker with a fetch handler before it will offer to add a site to a
 * home screen. That requirement has moved around between versions, so this is
 * the cheap way to be eligible under all of them.
 *
 * What it deliberately does NOT do is cache. Every screen here is either live
 * (posts arriving on a channel) or a few hundred bytes of text, so there is
 * nothing worth storing — and a cache-first worker on a site like this trades a
 * saving nobody would notice for the classic failure where a deploy goes out
 * and people keep running last week's JavaScript against this week's database.
 * The fetch handler is present and does not call respondWith, so the browser
 * handles every request exactly as it would with no worker at all.
 *
 * skipWaiting + claim so that when this file itself changes, the change is
 * immediate rather than waiting for every tab to close.
 */

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', () => {
  // Intentionally empty. Present so the worker counts as having one; silent so
  // the network is left alone.
})
