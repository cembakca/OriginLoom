/**
 * Third-party scripts that must run in a fixed order.
 *
 * Most of the time you do not need this. Classic scripts written in the head in
 * source order already execute in that order, and each one finishes before the
 * next begins — that is an HTML guarantee, not a trick. Write them in order and
 * do not set `async`, and the ordering is free.
 *
 * Two things break that, and they are why this exists:
 *
 *   - `async` makes execution order whatever the network returns first, and a
 *     single stray `async` silently reorders everything with no error anywhere.
 *   - "finished" is not always "executed". A consent tool or tag manager may
 *     execute immediately and become usable only after it has fetched its own
 *     configuration, and nothing in the document order can wait for that.
 *
 * The sequencer loads each step itself, in order, without blocking the parser,
 * and can wait for a step to announce readiness with an event before starting
 * the next one. Every step has a fail-open budget: a vendor that never loads
 * must not strand the steps behind it — the measurement is worth less than the
 * page, and analytics that blocks a site is a bug in the analytics.
 *
 * Waiting is for readiness, not for a person. A consent banner is answered when
 * the visitor gets around to it — immediately for someone who already decided,
 * ten seconds later on a first visit, never if they ignore it. A chain that
 * waits on that stops having an order: the same site produces one sequence in a
 * normal window and another in an incognito one. Load a consent tool in order
 * and let it announce itself whenever it does.
 */
export type HeadScript = {
  /** External script URL. The step finishes when it has loaded and executed. */
  src?: string;
  /** Inline code. Runs after the previous step finished, and finishes immediately. */
  code?: string;
  /**
   * Continue only once this event fires on `window` — for vendors that are
   * usable later than they are executed. The event must be dispatched after
   * this step starts, or the step falls through on its timeout.
   */
  awaitEvent?: string;
  /** Fail-open budget for this step. Defaults to the sequence's own. */
  timeoutMs?: number;
};

export type SequencedScriptOptions = {
  /** Fail-open budget applied to any step that does not set its own. */
  timeoutMs?: number;
};

/**
 * Builds the body of one inline script that runs `steps` in order.
 *
 * Render it as a classic inline script carrying the request nonce; the
 * sequencer reads that nonce off itself and puts it on every script it
 * injects, so the whole chain satisfies a nonce-based CSP.
 */
export function sequencedScript(
  steps: readonly HeadScript[],
  options: SequencedScriptOptions = {},
): string {
  for (const step of steps) {
    if (Boolean(step.src) === Boolean(step.code)) {
      throw new Error("A head script step needs exactly one of `src` or `code`");
    }
  }

  return `(function(){
var self=document.currentScript;
var nonce=self&&self.nonce?self.nonce:"";
var steps=${embed(steps)};
var budget=${Math.max(0, Math.trunc(options.timeoutMs ?? 5000))};
var i=0;
function next(){
  if(i>=steps.length)return;
  var step=steps[i++];
  var settled=false;
  var timer=setTimeout(done,typeof step.timeoutMs==="number"?step.timeoutMs:budget);
  function done(){
    if(settled)return;
    settled=true;
    clearTimeout(timer);
    next();
  }
  function executed(){
    if(!step.awaitEvent)return done();
    addEventListener(step.awaitEvent,done,{once:true});
  }
  var el=document.createElement("script");
  if(nonce)el.nonce=nonce;
  if(step.src){
    el.src=step.src;
    el.async=false;
    el.addEventListener("load",executed);
    el.addEventListener("error",done);
    document.head.appendChild(el);
  }else{
    el.text=step.code;
    document.head.appendChild(el);
    executed();
  }
}
next();
})();`;
}

/**
 * `</script>` inside the embedded data would end the surrounding element, and a
 * lone `<` is enough for a parser to start looking for one.
 */
function embed(steps: readonly HeadScript[]): string {
  return JSON.stringify(steps)
    .replaceAll("<", "\\u003c")
    .replaceAll(" ", "\\u2028")
    .replaceAll(" ", "\\u2029");
}
