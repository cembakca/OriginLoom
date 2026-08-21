import { hasAuthCookies, readCookie } from "@originloom/shared/lib/client/cookies";
import { Cookie } from "@originloom/shared/lib/cookies";
import { seedSession } from "@originloom/shared/lib/stores/session-store";
import { seedUserInfo } from "@originloom/shared/lib/stores/user-info-store";
import { useLayoutEffect } from "react";

import type { LayoutClientProps } from "~/lib/shell-data";

/** Store bootstrap — Header/Footer SSR; burada sadece session + auth store. */
export default function LayoutClient(props: LayoutClientProps) {
  useLayoutEffect(() => {
    const theme = props.theme ?? readCookie(Cookie.theme);
    seedSession({
      publicPath: props.publicPath,
      pathname: props.pathname,
      search: window.location.search,
      ...(theme !== undefined ? { theme } : {}),
    });

    const signedIn = hasAuthCookies();
    const accountText = readCookie(Cookie.accountText);
    const initials = accountText?.slice(0, 2).toUpperCase();
    seedUserInfo({
      isSignedIn: signedIn,
      ...(accountText !== undefined ? { displayName: accountText } : {}),
      ...(initials !== undefined ? { initials } : {}),
    });
  }, [props.publicPath, props.pathname, props.theme]);

  return null;
}
