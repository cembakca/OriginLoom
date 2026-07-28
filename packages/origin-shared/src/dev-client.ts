/**
 * Dev-only preamble, rendered immediately before `@vite/client`.
 *
 * These apps are multi-page: every navigation replaces the document, and the
 * browser keeps the outgoing one in the back/forward cache. A page cannot be
 * frozen while a WebSocket is live, so the browser severs Vite's HMR socket
 * itself and reports it as a failure:
 *
 *   WebSocket connection to 'ws://127.0.0.1:5010/?token=…' failed:
 *   Page entered Back-Forward Cache
 *
 * Closing the socket in `pagehide` leaves nothing to sever. By then Vite's own
 * `beforeunload` listener has already set its `willUnload` flag, so it treats
 * the close as expected — no "server connection lost" log, no restart polling.
 *
 * A restored page keeps that closed socket, which would leave HMR silently dead
 * on markup the server may have re-rendered while the page sat in the cache. So
 * a restore reloads instead.
 *
 * Only Vite's own sockets are touched — they are the ones that announce
 * themselves with a `vite-` subprotocol. Application sockets are left alone;
 * whether those survive a bfcache round trip is the application's decision.
 *
 * Emit it as a classic script: module scripts are deferred, and this has to run
 * before `@vite/client` opens the socket.
 */
export function devClientPreamble(): string {
  return DEV_CLIENT_PREAMBLE;
}

const DEV_CLIENT_PREAMBLE = `(() => {
  const NativeWebSocket = window.WebSocket;
  const viteSockets = new Set();
  window.WebSocket = class extends NativeWebSocket {
    constructor(url, protocols) {
      super(url, protocols);
      if (typeof protocols === "string" && protocols.startsWith("vite-")) {
        viteSockets.add(this);
        this.addEventListener("close", () => viteSockets.delete(this));
      }
    }
  };
  addEventListener("pagehide", () => {
    for (const socket of viteSockets) socket.close();
    viteSockets.clear();
  });
  addEventListener("pageshow", (event) => {
    if (event.persisted) location.reload();
  });
})();`;
