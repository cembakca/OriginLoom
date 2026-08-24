/**
 * Reading a browser form submission without trusting it.
 *
 * A form posted by a browser with no JavaScript arrives as
 * `application/x-www-form-urlencoded` (or `multipart/form-data` once there is a
 * file input). Both are attacker-shaped input: the field names, their count and
 * their length are whatever was sent, not whatever the page rendered. Bounding
 * all three here means an action never has to remember to.
 */
export type FormFields = Readonly<Record<string, string>>;

export type FormFieldLimits = {
  /** Distinct field names kept. Beyond this the submission is rejected. */
  maxFields?: number;
  /** Characters kept per value. A longer value rejects the submission. */
  maxValueLength?: number;
};

const DEFAULT_LIMITS = { maxFields: 64, maxValueLength: 4_096 } as const;

export class FormParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FormParseError";
  }
}

/**
 * Parses a submission into plain string fields.
 *
 * Repeated names keep their last value, which is what a server-side language
 * has always done with `name=a&name=b` and what a checkbox group's hidden
 * default relies on. File parts are dropped rather than stringified: an action
 * that wants uploads should read the `FormData` itself and say so.
 *
 * Rejects rather than truncates. A truncated value is a value the visitor did
 * not type, and quietly storing it is worse than telling them it was too long.
 */
export async function readFormFields(
  request: Request,
  limits: FormFieldLimits = {},
): Promise<FormFields> {
  const maxFields = limits.maxFields ?? DEFAULT_LIMITS.maxFields;
  const maxValueLength = limits.maxValueLength ?? DEFAULT_LIMITS.maxValueLength;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new FormParseError("Submission was not a readable form body");
  }

  const fields: Record<string, string> = {};
  for (const [name, value] of form.entries()) {
    if (typeof value !== "string") continue;
    if (value.length > maxValueLength) {
      throw new FormParseError(`Field ${name} exceeded ${maxValueLength} characters`);
    }
    if (!Object.hasOwn(fields, name) && Object.keys(fields).length >= maxFields) {
      throw new FormParseError(`Submission carried more than ${maxFields} fields`);
    }
    fields[name] = value;
  }
  return fields;
}

/** The trimmed value of a field, or "" — never undefined, so validators stay simple. */
export function formValue(fields: FormFields, name: string): string {
  return (fields[name] ?? "").trim();
}

/**
 * Whether a checkbox was ticked.
 *
 * An unticked checkbox sends nothing at all, so its absence is the answer; any
 * present value counts, because the browser sends `on` unless the markup names
 * something else.
 */
export function formChecked(fields: FormFields, name: string): boolean {
  return Object.hasOwn(fields, name);
}
