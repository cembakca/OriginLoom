import type { CSSProperties } from "react";
import type { DeviceShell } from "../../../lib/device";
import type { MenuItem } from "../../../lib/menu/types";
import { navLabel } from "../../../lib/menu/utils";
import { Island } from "../../../lib/island";

const navStyle: CSSProperties = {
  display: "flex",
  gap: "1.25rem",
  listStyle: "none",
  margin: 0,
  padding: 0,
  alignItems: "center",
};

export function NavBar({ items, shell }: { items: MenuItem[]; shell: DeviceShell }) {
  return (
    <nav aria-label="Ana menü">
      <ul style={navStyle}>
        {items.map((item) => (
          <li key={item.id} style={{ position: "relative" }}>
            <a href={item.url}>{navLabel(item, shell)}</a>
            {item.subMenuItemList?.length ? (
              <ul
                style={{
                  ...navStyle,
                  flexDirection: "column",
                  alignItems: "flex-start",
                  position: "absolute",
                  top: "100%",
                  left: 0,
                  background: "#fff",
                  border: "1px solid #e2e8f0",
                  padding: "0.5rem 0.75rem",
                  minWidth: 180,
                  display: shell === "desktop" ? undefined : "none",
                }}
              >
                {item.subMenuItemList.map((sub) => (
                  <li key={sub.id}>
                    <a href={sub.url}>{navLabel(sub, shell)}</a>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function MobileNav({ items, shell }: { items: MenuItem[]; shell: DeviceShell }) {
  return (
    <nav aria-label="Mobil menü" style={{ padding: "1rem 0" }}>
      {items.map((item) => (
        <details key={item.id} style={{ borderBottom: "1px solid #e2e8f0", padding: "0.5rem 0" }}>
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>
            <a href={item.url} style={{ textDecoration: "none", color: "inherit" }}>
              {navLabel(item, shell)}
            </a>
          </summary>
          {item.subMenuItemList?.length ? (
            <ul style={{ listStyle: "none", margin: "0.5rem 0 0", padding: "0 0 0 1rem" }}>
              {item.subMenuItemList.map((sub) =>
                sub.menuDisplayType === 1 ? (
                  <li key={sub.id} style={{ margin: "0.5rem 0", padding: "0.75rem", background: "#f1f5f9" }}>
                    <strong>{navLabel(sub, shell)}</strong>
                    {sub.description ? <p style={{ margin: "0.25rem 0 0", fontSize: "0.875rem" }}>{sub.description}</p> : null}
                    {sub.url ? (
                      <a href={sub.url} style={{ display: "block", marginTop: "0.25rem" }}>
                        Devam
                      </a>
                    ) : null}
                  </li>
                ) : (
                  <li key={sub.id} style={{ margin: "0.35rem 0" }}>
                    <a href={sub.url}>{navLabel(sub, shell)}</a>
                  </li>
                ),
              )}
            </ul>
          ) : null}
        </details>
      ))}
      <div style={{ marginTop: "1rem", paddingTop: "1rem", borderTop: "1px solid #e2e8f0" }}>
        <a href="/hesabim">Hesabım</a>
        {" · "}
        <a href="/giris">Giriş yap</a>
      </div>
    </nav>
  );
}

export function UserChromeSlot() {
  return (
    <Island name="user-chrome" mode="defer" eager>
      <a href="/giris">Giriş yap</a>
    </Island>
  );
}
