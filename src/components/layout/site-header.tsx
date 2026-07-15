import { Island } from "../../lib/island";

export function SiteHeader() {
  return (
    <header>
      <a href="/">ssr-kit</a>
      <Island name="user-badge" mode="defer" eager>
        <span>&nbsp;</span>
      </Island>
    </header>
  );
}
