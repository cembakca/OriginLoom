import { hasAuthCookies, readCookie } from "../lib/client/cookies";
import { Cookie } from "../lib/cookies";

/** Auth chrome — menü API'den gelmez; cookie/store'dan client okur. */
export default function UserChrome() {
  if (!hasAuthCookies()) {
    return <a href="/giris">Giriş yap</a>;
  }

  const accountText = readCookie(Cookie.accountText) ?? "Hesabım";
  const initials = accountText.slice(0, 2).toUpperCase();

  return (
    <a href="/hesabim" title={accountText} style={{ fontWeight: 600 }}>
      {initials}
    </a>
  );
}
