import { useLayoutEffect } from "react";
import { seedSession } from "../lib/stores/session-store";
import { seedUserInfo } from "../lib/stores/user-info-store";
import { hasAuthCookies, readCookie } from "../lib/client/cookies";
import { Cookie } from "../lib/cookies";
import type { LayoutClientProps } from "../lib/shell-data";

/** Store bootstrap — Header/Footer SSR; burada sadece session + auth store. */
export default function LayoutClient(props: LayoutClientProps) {
  useLayoutEffect(() => {
    seedSession({
      publicPath: props.publicPath,
      pathname: props.pathname,
      search: props.search,
      theme: props.theme,
    });

    const signedIn = hasAuthCookies();
    const accountText = readCookie(Cookie.accountText);
    seedUserInfo({
      isSignedIn: signedIn,
      displayName: accountText ?? undefined,
      initials: accountText?.slice(0, 2).toUpperCase(),
    });
  }, [props.publicPath, props.pathname, props.search, props.theme]);

  return null;
}
