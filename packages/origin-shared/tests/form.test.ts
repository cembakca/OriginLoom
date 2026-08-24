import { describe, expect, it } from "vitest";

import { formChecked, FormParseError, formValue, readFormFields } from "../src/lib/form.js";

function submission(body: string, contentType = "application/x-www-form-urlencoded"): Request {
  return new Request("http://app.local/bulten", {
    method: "POST",
    headers: { "content-type": contentType },
    body,
  });
}

describe("readFormFields", () => {
  it("reads what a browser posts", async () => {
    const fields = await readFormFields(submission("ad=Cem&eposta=cem%40example.com&onay=on"));

    expect(fields).toEqual({ ad: "Cem", eposta: "cem@example.com", onay: "on" });
  });

  /** `name=a&name=b` has meant "the last one" since CGI; a hidden default relies on it. */
  it("keeps the last value of a repeated field", async () => {
    expect(await readFormFields(submission("onay=off&onay=on"))).toEqual({ onay: "on" });
  });

  // Truncating would store a value the visitor never typed.
  it("rejects an oversized value rather than trimming it", async () => {
    const long = "x".repeat(11);

    await expect(readFormFields(submission(`ad=${long}`), { maxValueLength: 10 })).rejects.toThrow(
      FormParseError,
    );
  });

  it("rejects a submission that invents more fields than the form has", async () => {
    const body = Array.from({ length: 5 }, (_, index) => `f${index}=1`).join("&");

    await expect(readFormFields(submission(body), { maxFields: 3 })).rejects.toThrow(
      FormParseError,
    );
    // A repeated name is one field, so the bound counts names and not pairs.
    await expect(readFormFields(submission("a=1&a=2&a=3"), { maxFields: 1 })).resolves.toEqual({
      a: "3",
    });
  });

  it("turns an unreadable body into a form error rather than an exception nobody expects", async () => {
    const request = new Request("http://app.local/bulten", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"ad":"Cem"}',
    });

    await expect(readFormFields(request)).rejects.toThrow(FormParseError);
  });
});

describe("field readers", () => {
  it("trims a value and never returns undefined", () => {
    expect(formValue({ ad: "  Cem  " }, "ad")).toBe("Cem");
    expect(formValue({}, "eposta")).toBe("");
  });

  /** An unticked checkbox sends nothing at all, so absence is the whole answer. */
  it("reads a checkbox by presence, not by value", () => {
    expect(formChecked({ onay: "on" }, "onay")).toBe(true);
    expect(formChecked({ onay: "" }, "onay")).toBe(true);
    expect(formChecked({}, "onay")).toBe(false);
  });
});
