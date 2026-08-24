import { Container } from "~/components/ui/container";

/** What the visitor typed, echoed back so a rejected submission never loses it. */
export type NewsletterValues = { name: string; email: string; consent: boolean };

export type NewsletterErrors = Partial<Record<keyof NewsletterValues | "form", string>>;

export type NewsletterFormState = { values: NewsletterValues; errors: NewsletterErrors };

export const EMPTY_VALUES: NewsletterValues = { name: "", email: "", consent: false };

const FIELD = "mt-1 w-full rounded-lg border px-3 py-2 text-sm text-slate-900 outline-none";
const OK = "border-slate-300 focus:border-slate-500";
const BAD = "border-red-500 focus:border-red-600";

/**
 * A newsletter form that never needed JavaScript.
 *
 * Everything here is markup a browser already knows how to submit: a `method`,
 * an `action` pointing at the page itself, named inputs and a submit button.
 * That is the resilience argument — it works on the first paint, before any
 * bundle arrives, on a connection that drops the bundle entirely, and in a
 * client that never ran one.
 *
 * The accessibility argument is the same markup read twice. Every control has a
 * real `<label for>`, an invalid field carries `aria-invalid` and points at its
 * message with `aria-describedby`, and the error summary is a `role="alert"`
 * that a screen reader announces the moment the rejected page loads — because
 * the page *did* load, which is the part a fetch-and-swap has to reimplement.
 */
export function NewsletterForm({
  state,
  subscribed,
}: {
  state: NewsletterFormState;
  subscribed: boolean;
}) {
  const { values, errors } = state;
  return (
    <Container className="py-10">
      <h1 className="text-2xl font-semibold text-slate-900">Bültene abone ol</h1>

      {subscribed ? (
        // The success state is a fresh GET, so this is what a reload shows too.
        <p
          className="mt-6 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900"
          role="status"
          data-testid="newsletter-success"
        >
          Aboneliğin başladı. Teşekkürler!
        </p>
      ) : null}

      {errors.form ? (
        <p
          className="mt-6 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900"
          role="alert"
          data-testid="newsletter-form-error"
        >
          {errors.form}
        </p>
      ) : null}

      <form method="post" action="/bulten" className="mt-6 max-w-md space-y-4" noValidate>
        <div>
          <label htmlFor="newsletter-name" className="text-sm font-medium text-slate-700">
            Adın
          </label>
          <input
            id="newsletter-name"
            name="ad"
            type="text"
            required
            autoComplete="given-name"
            defaultValue={values.name}
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={errors.name ? "newsletter-name-error" : undefined}
            className={`${FIELD} ${errors.name ? BAD : OK}`}
          />
          {errors.name ? (
            <p id="newsletter-name-error" className="mt-1 text-xs text-red-700">
              {errors.name}
            </p>
          ) : null}
        </div>

        <div>
          <label htmlFor="newsletter-email" className="text-sm font-medium text-slate-700">
            E-posta adresin
          </label>
          <input
            id="newsletter-email"
            name="eposta"
            type="email"
            required
            autoComplete="email"
            defaultValue={values.email}
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={errors.email ? "newsletter-email-error" : undefined}
            className={`${FIELD} ${errors.email ? BAD : OK}`}
          />
          {errors.email ? (
            <p id="newsletter-email-error" className="mt-1 text-xs text-red-700">
              {errors.email}
            </p>
          ) : null}
        </div>

        <div className="flex items-start gap-2">
          <input
            id="newsletter-consent"
            name="onay"
            type="checkbox"
            defaultChecked={values.consent}
            aria-invalid={errors.consent ? true : undefined}
            aria-describedby={errors.consent ? "newsletter-consent-error" : undefined}
            className="mt-1"
          />
          <div>
            <label htmlFor="newsletter-consent" className="text-sm text-slate-700">
              E-posta almayı kabul ediyorum.
            </label>
            {errors.consent ? (
              <p id="newsletter-consent-error" className="mt-1 text-xs text-red-700">
                {errors.consent}
              </p>
            ) : null}
          </div>
        </div>

        <button
          type="submit"
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
          data-testid="newsletter-submit"
        >
          Abone ol
        </button>
      </form>
    </Container>
  );
}
