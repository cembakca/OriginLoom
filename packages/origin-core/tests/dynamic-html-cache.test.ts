import { describe, expect, it } from "vitest";

import {
  cachedHtmlDynamicValues,
  dynamicHtmlPlaceholders,
  hasUnsafeConcreteCachedHtmlValues,
  materializeCachedHtmlDynamicValues,
  normalizeCachedHtmlDynamicValues,
} from "../src/cache/dynamic-html.js";

describe("shared HTML dynamic values", () => {
  const fillValues = {
    cspNonce: "fill-nonce+safe=",
    pageRequestId: "fill-request-id",
    submissionKey: "fill-submission-key-0001",
  };
  const rendered =
    '<!DOCTYPE html><script nonce="fill-nonce+safe=">run()</script>' +
    '<script type="application/json">{"pageRequestId":"fill-request-id"}</script>';

  it("normalizes every registered request value and materializes the current response", () => {
    const cached = normalizeCachedHtmlDynamicValues(rendered, fillValues);
    const placeholders = dynamicHtmlPlaceholders();

    expect(cached).not.toContain(fillValues.cspNonce);
    expect(cached).not.toContain(fillValues.pageRequestId);
    expect(cached).toContain(placeholders.cspNonce);
    expect(cached).toContain(placeholders.pageRequestId);
    expect(hasUnsafeConcreteCachedHtmlValues(cached)).toBe(false);

    const response = materializeCachedHtmlDynamicValues(cached, {
      cspNonce: "response-nonce/safe=",
      pageRequestId: "response-request-id",
    });
    expect(response).toContain('nonce="response-nonce/safe="');
    expect(response).toContain('"pageRequestId":"response-request-id"');
    expect(response).not.toContain("__ORIGINLOOM_");
  });

  it("gives cache-fill renderers markers instead of concrete request values", () => {
    expect(cachedHtmlDynamicValues(fillValues)).toEqual(dynamicHtmlPlaceholders());
    expect(cachedHtmlDynamicValues({})).toEqual({});
  });

  /**
   * The slot exists because the page it sits on may be shared. Two visitors
   * served one cached body must not submit under one key, or the guard becomes
   * the bug: the second person's subscription replays as the first person's.
   */
  it("gives two visitors two submission keys out of one cached body", () => {
    const placeholders = dynamicHtmlPlaceholders();
    const cached = `<input name="_islem" value="${placeholders.submissionKey}">`;

    const first = materializeCachedHtmlDynamicValues(cached, {
      submissionKey: "aaaaaaaaaaaaaaaaaaaa",
    });
    const second = materializeCachedHtmlDynamicValues(cached, {
      submissionKey: "bbbbbbbbbbbbbbbbbbbb",
    });

    expect(first).toContain('value="aaaaaaaaaaaaaaaaaaaa"');
    expect(second).toContain('value="bbbbbbbbbbbbbbbbbbbb"');
  });

  /** The alphabet is checked, not escaped: a key needing escaping is not ours. */
  it("empties the submission slot rather than trusting a malformed key", () => {
    const cached = `<input value="${dynamicHtmlPlaceholders().submissionKey}">`;

    expect(
      materializeCachedHtmlDynamicValues(cached, { submissionKey: 'bad" onload="run()' }),
    ).toBe('<input value="">');
  });

  it("fails closed for missing, unsafe and unknown slot values", () => {
    const placeholders = dynamicHtmlPlaceholders();
    const cached =
      `<script nonce="${placeholders.cspNonce}">run()</script>` +
      `<script>{"pageRequestId":"${placeholders.pageRequestId}"}</script>` +
      "<p>__ORIGINLOOM_DYNAMIC_UNKNOWN_SLOT__</p>";

    const response = materializeCachedHtmlDynamicValues(cached, {
      cspNonce: 'bad" onload="run()',
      pageRequestId: "bad request id",
    });
    expect(response).toContain("<script>run()</script>");
    expect(response).toContain('"pageRequestId":""');
    expect(response).not.toContain("onload");
    expect(response).not.toContain("__ORIGINLOOM_");
  });

  it("identifies concrete values from cache entries written by older releases", () => {
    expect(hasUnsafeConcreteCachedHtmlValues(rendered)).toBe(true);
    expect(
      hasUnsafeConcreteCachedHtmlValues(
        '<!DOCTYPE html><script>{"pageRequestId":"concrete-request"}</script>',
      ),
    ).toBe(true);
  });
});
