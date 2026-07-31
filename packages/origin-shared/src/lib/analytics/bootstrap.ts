/**
 * The two inline scripts that have to run before the tag manager does.
 *
 * They are built as strings because they belong in the head, ahead of React and
 * ahead of GTM — nothing that ships in a bundle can be early enough.
 */

/**
 * Pushes the visitor's tracking id, read from the cookie **in the browser**.
 *
 * Not rendered by the server, and this is the whole point: the document is
 * shared-cached, so an id written into the HTML would belong to whoever filled
 * the cache and would then be served to everybody else. Reading it here means
 * every visitor pushes their own — see docs/caching.md.
 *
 * A plain data push, with no `event` key: it is a value the tags read, not
 * something that happened.
 */
export function trackingIdPushScript(options: {
  trackingIdKey: string;
  extraCookies?: Readonly<Record<string, string>>;
}): string {
  const extras = Object.entries(options.extraCookies ?? {});
  return `(function(){
window.dataLayer=window.dataLayer||[];
function c(n){var m=document.cookie.match(new RegExp('(?:^|; )'+n.replace(/([.$?*|{}()[\\]\\\\/+^])/g,'\\\\$1')+'=([^;]*)'));return m?decodeURIComponent(m[1]):'';}
var id=c(${JSON.stringify("user_tracking_id")});
if(!id)return;
var payload={};
payload[${JSON.stringify(options.trackingIdKey)}]=id;
${extras
  .map(
    ([key, cookieName]) =>
      `var v_${sanitize(key)}=c(${JSON.stringify(cookieName)});if(v_${sanitize(key)})payload[${JSON.stringify(key)}]=v_${sanitize(key)};`,
  )
  .join("\n")}
window.dataLayer.push(payload);
})();`;
}

/**
 * Holds `gtm.dom` and `gtm.load` until the page view has been pushed.
 *
 * GTM fires those two on its own schedule, which is usually *before* React has
 * mounted and pushed the page view. Tags that read page dimensions then see a
 * dataLayer that does not have them yet, and the hit goes out wrong — silently,
 * because nothing errors.
 *
 * So the two events are queued and released once the page view lands. And they
 * are released anyway after `failOpenMs`, because a page whose React never
 * arrives should still report a visit: the measurement is worth less than the
 * page, and analytics that swallows a pageview is worse than analytics that is
 * slightly out of order.
 */
export function eventQueueScript(options: { failOpenMs?: number } = {}): string {
  const failOpen = Math.max(0, Math.trunc(options.failOpenMs ?? 5000));
  return `(function(){
window.dataLayer=window.dataLayer||[];
var held=[],ready=false,released=false;
var push=window.dataLayer.push.bind(window.dataLayer);
var timer=setTimeout(release,${failOpen});
function release(){
  if(released)return;
  released=true;
  clearTimeout(timer);
  for(var i=0;i<held.length;i++)push(held[i]);
  held.length=0;
}
window.dataLayer.push=function(){
  for(var i=0;i<arguments.length;i++){
    var p=arguments[i];
    var e=p&&p.event;
    if(!released&&(e==="gtm.dom"||e==="gtm.load")){held.push(p);continue;}
    push(p);
  }
  return window.dataLayer.length;
};
window.__originLoomSignalReactReady=function(){
  if(ready)return;
  ready=true;
  release();
};
})();`;
}

/** The container snippet's own push, kept separate so the order is readable. */
export function gtmStartScript(): string {
  return `window.dataLayer=window.dataLayer||[];window.dataLayer.push({"gtm.start":new Date().getTime(),event:"gtm.js"});`;
}

export function gtmContainerUrl(containerId: string): string {
  return `https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(containerId)}`;
}

function sanitize(key: string): string {
  return key.replace(/[^a-zA-Z0-9_]/g, "_");
}
