import { hasAuthCookies, readCookie } from "@originloom/react/lib/client/cookies";
import { Cookie } from "@originloom/react/lib/cookies";
import { seedSession } from "@originloom/react/lib/stores/session-store";
import { seedUserInfo } from "@originloom/react/lib/stores/user-info-store";
import { useLayoutEffect } from "react";

import type { LayoutClientProps } from "~/lib/shell-data";

/** Store bootstrap — Header/Footer SSR; burada sadece session + auth store. */
export default function LayoutClient(props: LayoutClientProps) {
  useLayoutEffect(() => {
    seedSession({
      publicPath: props.publicPath,
      pathname: props.pathname,
      search: window.location.search,
      ...(props.theme !== undefined ? { theme: props.theme } : {}),
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
