import { afterEach, describe, expect, it } from "vitest";

import { serializeEmbeddedJson } from "../src/lib/embedded-json.js";
import {
  clearTaintRegistryForTests,
  hasTaintedData,
  TaintedValueError,
  taintObject,
  taintValue,
  taintValueIfPossible,
} from "../src/lib/taint.js";

afterEach(() => {
  clearTaintRegistryForTests();
});

const SESSION_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload";

describe("taintObject", () => {
  it("stops a marked object from reaching the document", () => {
    const profile = taintObject("gateway profile — per visitor, never shared HTML", {
      displayName: "Ayşe",
      customerId: 4711,
    });

    expect(() => serializeEmbeddedJson({ profile }, "island props")).toThrow(TaintedValueError);
  });

  it("names the data and the boundary so the message is actionable", () => {
    const session = taintObject("session record; render from the defer island instead", {
      id: "s-1",
    });

    expect(() => serializeEmbeddedJson(session, 'island "account-panel" props')).toThrow(
      /island "account-panel" props.*defer island instead/s,
    );
  });

  it("catches a marked object nested anywhere in the payload", () => {
    const profile = taintObject("profile", { name: "Ayşe" });

    expect(() =>
      serializeEmbeddedJson({ page: { sections: [{ widgets: [{ profile }] }] } }),
    ).toThrow(TaintedValueError);
  });

  /**
   * The limit worth stating out loud: a copy is a different object and carries
   * none of the mark. This is why the doc says filter first and taint second.
   */
  it("does not follow the data into a copy", () => {
    const profile = taintObject("profile", { name: "Ayşe", ssn: "12345678901" });

    expect(() => serializeEmbeddedJson({ ...profile })).not.toThrow();
  });

  it("leaves untainted payloads alone", () => {
    taintObject("profile", { name: "Ayşe" });

    expect(serializeEmbeddedJson({ title: "Kasko" })).toContain("Kasko");
  });
});

describe("taintValue", () => {
  it("stops the exact string even when it is rebuilt into a fresh object", () => {
    const session = { token: SESSION_TOKEN };
    taintValue("access token", session, SESSION_TOKEN);

    // A copy defeats object tainting; the value mark is what survives it.
    expect(() => serializeEmbeddedJson({ auth: { bearer: session.token } })).toThrow(
      TaintedValueError,
    );
  });

  it("refuses a value too short to be told apart from ordinary content", () => {
    const lifetime = {};

    expect(() => taintValue("locale", lifetime, "tr")).toThrow(TypeError);
    expect(() => taintValue("flag", lifetime, "1")).toThrow(TypeError);
  });

  it("does not match a string that merely contains the marked value", () => {
    const lifetime = {};
    taintValue("token", lifetime, SESSION_TOKEN);

    // Matching substrings would make the guard fire on unrelated prose; the
    // check is deliberately exact.
    expect(() => serializeEmbeddedJson({ note: `prefix ${SESSION_TOKEN}` })).not.toThrow();
  });
});

describe("hasTaintedData", () => {
  /** The fast path: with nothing marked, serialization skips the walk entirely. */
  it("is false on a clean registry and true once something is marked", () => {
    expect(hasTaintedData()).toBe(false);

    taintValue("token", {}, SESSION_TOKEN);

    expect(hasTaintedData()).toBe(true);
  });
});

describe("serializeEmbeddedJson", () => {
  it("still escapes HTML-significant characters while the guard is active", () => {
    taintValue("token", {}, SESSION_TOKEN);

    const json = serializeEmbeddedJson({ html: "<script>alert(1)</script>" });

    expect(json).not.toContain("<script>");
    expect(json).toContain("\\u003c");
  });
});

describe("taintValueIfPossible", () => {
  /**
   * Cookie values come from the browser. A malformed one must not take the
   * request down — that would turn a leak guard into a denial of service.
   */
  it("skips a value too short to mark instead of throwing", () => {
    const lifetime = {};

    expect(() => taintValueIfPossible("access token", lifetime, "x")).not.toThrow();
    expect(hasTaintedData()).toBe(false);
  });

  it("marks a value that is long enough", () => {
    const lifetime = {};
    taintValueIfPossible("access token", lifetime, SESSION_TOKEN);

    expect(() => serializeEmbeddedJson({ t: SESSION_TOKEN })).toThrow(TaintedValueError);
  });
});

describe("registry bound", () => {
  /**
   * FinalizationRegistry retires entries eventually, not promptly. Under load
   * the map must not outgrow the process, so the oldest mark is dropped first —
   * the one least likely to be serialized right now.
   */
  it("keeps the newest marks when the ceiling is reached", () => {
    const lifetime = {};
    for (let i = 0; i < 2_100; i += 1) {
      taintValue("bulk token", lifetime, `token-value-${String(i).padStart(6, "0")}`);
    }

    expect(() => serializeEmbeddedJson({ t: "token-value-002099" })).toThrow(TaintedValueError);
    expect(() => serializeEmbeddedJson({ t: "token-value-000000" })).not.toThrow();
  });
});
