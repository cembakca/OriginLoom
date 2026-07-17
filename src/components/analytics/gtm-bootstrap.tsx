type GtmBootstrapProps = {
  containerId: string;
  isBot: boolean;
};

export const ANALYTICS_FAIL_OPEN_MS = 5_000;

/** Inline early tracking — runs in browser, reads cookies (cache-safe). */
const EARLY_TRACKING_SCRIPT = `
(function(){
  window.dataLayer=window.dataLayer||[];
  function c(n){var m=document.cookie.match(new RegExp('(?:^|; )'+n.replace(/([.$?*|{}()[\\]\\\\/+^])/g,'\\\\$1')+'=([^;]*)'));return m?decodeURIComponent(m[1]):'';}
  var id=c('user_tracking_id');
  if(!id)return;
  window.dataLayer.push({event:'hk.tracking',hkUserTrackingId:id,hkGclid:c('gclid')||undefined,hkUtmSource:c('utm_source')||undefined,hkUtmCampaign:c('utm_campaign')||undefined});
})();
`.trim();

/** EventQueue — holds gtm.dom / gtm.load until React pageview is ready, then fails open. */
export function buildEventQueueScript(failOpenMs = ANALYTICS_FAIL_OPEN_MS): string {
  return `
(function(){
  window.dataLayer=window.dataLayer||[];
  var domQ=[],loadQ=[],betweenQ=[],reactReady=false,domReleased=false,loadReleased=false;
  var orig=window.dataLayer.push.bind(window.dataLayer);
  var failOpenTimer;
  function flush(q){for(var i=0;i<q.length;i++)orig(q[i]);q.length=0;}
  function releaseDom(){if(domReleased)return;domReleased=true;flush(domQ);flush(betweenQ);}
  function releaseLoad(){if(loadReleased)return;loadReleased=true;flush(loadQ);}
  function signalReactReady(){
    if(reactReady)return;
    reactReady=true;
    if(failOpenTimer)clearTimeout(failOpenTimer);
    if(domQ.length||betweenQ.length)releaseDom();
    if(domReleased&&loadQ.length)releaseLoad();
  }
  window.dataLayer.push=function(){
    for(var i=0;i<arguments.length;i++){
      var p=arguments[i];
      if(p&&p.event==='gtm.dom'){
        if(domReleased){orig(p);continue;}
        domQ.push(p);if(reactReady)releaseDom();continue;
      }
      if(p&&p.event==='gtm.load'){
        if(loadReleased){orig(p);continue;}
        loadQ.push(p);if(domReleased)releaseLoad();continue;
      }
      orig(p);
    }
    return window.dataLayer.length;
  };
  window.__ssrKitSignalReactReady=signalReactReady;
  failOpenTimer=setTimeout(signalReactReady,${Math.max(0, Math.floor(failOpenMs))});
})();
`.trim();
}

export function GtmBootstrap({ containerId, isBot }: GtmBootstrapProps) {
  if (!containerId) return null;

  const gtmScript = `
(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});
var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';
j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','${containerId}');
`.trim();

  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: "window.dataLayer=window.dataLayer||[];" }} />
      <script dangerouslySetInnerHTML={{ __html: buildEventQueueScript() }} />
      <script dangerouslySetInnerHTML={{ __html: EARLY_TRACKING_SCRIPT }} />
      <script dangerouslySetInnerHTML={{ __html: gtmScript }} />
      {!isBot && (
        <noscript>
          <iframe
            src={`https://www.googletagmanager.com/ns.html?id=${containerId}`}
            height="0"
            width="0"
            style={{ display: "none", visibility: "hidden" }}
            title="gtm"
          />
        </noscript>
      )}
    </>
  );
}

export function isBotRequest(request: Request): boolean {
  const ua = request.headers.get("user-agent") ?? "";
  return /bot|crawl|spider|slurp|bingpreview/i.test(ua);
}
