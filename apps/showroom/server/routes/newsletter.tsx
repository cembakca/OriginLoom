import { boundedIdempotencyKey, newIdempotencyKey, runOnce } from "@originloom/core/idempotency";
import { redirect } from "@originloom/react/lib/types";
import { defineRoute } from "@originloom/react/lib/types";
import {
  formChecked,
  formValue,
  IDEMPOTENCY_FIELD,
  readFormFields,
} from "@originloom/shared/lib/form";
import { type SubscribeResult, subscribeToNewsletter } from "@server/services/newsletter";

import {
  EMPTY_VALUES,
  type NewsletterErrors,
  NewsletterForm,
  type NewsletterFormState,
  type NewsletterValues,
} from "~/features/newsletter/newsletter-form";
import { pageCache, PageCacheId } from "~/lib/cache-keys";
import { generateMetaDataForPageWithDummySeoInfo } from "~/lib/metadata/dummy-seo";
import { defaultPageMeta } from "~/lib/shell-data";

type NewsletterData = {
  state: NewsletterFormState;
  subscribed: boolean;
  submissionKey: string;
};

const EMPTY_STATE: NewsletterFormState = { values: EMPTY_VALUES, errors: {} };

/**
 * A shared, cacheable page that also accepts a submission.
 *
 * Nothing here arranges for the POST to skip the cache. The platform downgrades
 * the policy for any unsafe method before a key can exist, so the same route
 * that serves one cached document to everyone answers a submission privately,
 * with `no-store`, and never writes that answer anywhere. If bypassing were the
 * route's job, the first page that grew a form would eventually publish one
 * visitor's validation errors to the next thousand readers.
 */
export default defineRoute<NewsletterData, NewsletterFormState>({
  path: "/bulten",
  cache: pageCache(PageCacheId.newsletter),

  action: async (ctx) => {
    let fields;
    try {
      fields = await readFormFields(ctx.request, { maxFields: 8, maxValueLength: 320 });
    } catch {
      return {
        data: withFormError(EMPTY_STATE, "Form okunamadı. Lütfen tekrar dene."),
        status: 400,
      };
    }

    const values: NewsletterValues = {
      name: formValue(fields, "ad"),
      email: formValue(fields, "eposta"),
      consent: formChecked(fields, "onay"),
    };
    const errors = validate(values);
    // 422, not 200: the page comes back, but the submission did not succeed and
    // every client that is not a browser deserves to be told so.
    if (Object.keys(errors).length > 0) return { data: { values, errors }, status: 422 };

    // Post/Redirect/Get already stops a reload from re-posting. It does nothing
    // about the submissions it never sees — the impatient second click, the
    // retry after a connection drops — and those arrive as separate POSTs. The
    // key the form carries is the only thing that can tell them apart from two
    // people subscribing.
    const key = boundedIdempotencyKey(formValue(fields, IDEMPOTENCY_FIELD));
    const once = key
      ? await runOnce({
          namespace: "newsletter",
          key,
          work: () => subscribeToNewsletter(ctx.request, values.email, values.name),
          // An outage is not an outcome: the visitor has to be able to send the
          // same form again once the service is back.
          serialize: (value) => (value.kind === "unavailable" ? null : value.kind),
          parse: (raw) => ({ kind: raw }) as SubscribeResult,
        })
      : null;
    if (once?.kind === "in-flight") {
      return {
        data: withFormError({ values, errors: {} }, "Bu gönderim işleniyor, bir saniye."),
        status: 409,
      };
    }
    const result = once
      ? once.value
      : await subscribeToNewsletter(ctx.request, values.email, values.name);
    if (result.kind === "duplicate") {
      return { data: { values, errors: { email: "Bu adres zaten kayıtlı." } }, status: 409 };
    }
    if (result.kind === "unavailable") {
      return {
        data: withFormError({ values, errors: {} }, "Şu an kaydedemedik. Birazdan tekrar dene."),
        status: 503,
      };
    }

    // Post/Redirect/Get: a reload or a back button re-runs a GET, so the
    // browser never offers to re-submit and the success state is bookmarkable.
    return redirect("/bulten?durum=ok", 303);
  },

  loader: async (ctx) => ({
    data: {
      state: ctx.action ?? EMPTY_STATE,
      subscribed: ctx.url.searchParams.get("durum") === "ok",
      // Minted here, so every render — including the one that redraws a
      // rejected submission — hands the form a key of its own.
      submissionKey: newIdempotencyKey(),
    },
  }),

  generateMetadata: (_data, ctx) => generateMetaDataForPageWithDummySeoInfo("/bulten", ctx),
  pageMeta: (_data, ctx) => defaultPageMeta(ctx, "newsletter", { category: "demo" }),
  Component: ({ data }) => <NewsletterForm {...data} />,
});

function validate(values: NewsletterValues): NewsletterErrors {
  const errors: NewsletterErrors = {};
  if (values.name.length < 2) errors.name = "Adın en az iki karakter olmalı.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) {
    errors.email = "Geçerli bir e-posta adresi gir.";
  }
  if (!values.consent) errors.consent = "Devam etmek için onay kutusunu işaretle.";
  return errors;
}

function withFormError(state: NewsletterFormState, message: string): NewsletterFormState {
  return { values: state.values, errors: { ...state.errors, form: message } };
}
