import { useLayoutEffect, useState } from "react";
import { SiteHeader } from "../components/layout/site-header";
import type { LayoutClientProps } from "../lib/shell-data";
import { hasAuthCookies, readCookie } from "../lib/client/cookies";
import { Cookie } from "../lib/cookies";
import { seedSession } from "../lib/stores/session-store";
import { seedUserInfo } from "../lib/stores/user-info-store";

function resolveDisplayName(): { displayName: string; initials: string } | null {
  if (!hasAuthCookies()) return null;
  const accountText = readCookie(Cookie.accountText);
  const label = accountText ?? "Hesabım";
  return { displayName: label, initials: label.slice(0, 2).toUpperCase() };
}

/** Client chrome + store bootstrap — mounts before page-analytics (DOM order). */
export default function LayoutClient(props: LayoutClientProps) {
  const [user, setUser] = useState<{ displayName: string; initials: string } | null>(null);

  useLayoutEffect(() => {
    seedSession({
      publicPath: props.publicPath,
      pathname: props.pathname,
      search: props.search,
      theme: props.theme,
      userAgent: navigator.userAgent,
    });

    const signedIn = hasAuthCookies();
    const profile = resolveDisplayName();
    seedUserInfo({ isSignedIn: signedIn, displayName: profile?.displayName, initials: profile?.initials });
    setUser(profile);
  }, [props.publicPath, props.pathname, props.search, props.theme]);

  if (props.minimalChrome) return null;

  return (
    <div id="layout-chrome">
      <SiteHeader user={user} />
    </div>
  );
}
