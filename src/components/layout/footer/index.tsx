import type { DeviceType } from "../../../lib/device";
import { getDeviceShell } from "../../../lib/device";
import type { IMenuItems, MenuItem } from "../../../lib/menu/types";
import { footerNavItems, linkRel, sortFooterItems } from "../../../lib/menu/utils";

export function Footer({ menu, deviceType }: { menu: IMenuItems; deviceType: DeviceType }) {
  const shell = getDeviceShell(deviceType);
  const items = sortFooterItems(footerNavItems(menu.footerItems), shell);
  const isMobile = shell === "mobile";

  return (
    <footer
      style={{
        marginTop: "3rem",
        padding: "2rem 1rem",
        borderTop: "1px solid #e2e8f0",
        color: "#64748b",
      }}
      data-shell={shell}
    >
      <div style={{ maxWidth: 960, margin: "0 auto" }}>
        <a href="/" style={{ fontWeight: 700, color: "#0f172a", fontSize: isMobile ? "1rem" : "1.125rem" }}>
          Hangikredi
        </a>

        {isMobile ? (
          <div style={{ marginTop: "1rem" }}>
            {items.map((col) => (
              <details key={col.id} style={{ borderBottom: "1px solid #e2e8f0", padding: "0.5rem 0" }}>
                <summary style={{ cursor: "pointer", fontWeight: 600 }}>{col.name}</summary>
                <ul style={{ listStyle: "none", margin: "0.5rem 0 0", padding: 0 }}>
                  {col.subMenuItemList?.map((link) => (
                    <li key={link.id} style={{ margin: "0.25rem 0" }}>
                      <a href={link.url} rel={linkRel(link.url)}>
                        {link.name}
                      </a>
                    </li>
                  )) ?? (
                    <li>
                      <a href={col.url} rel={linkRel(col.url)}>
                        {col.name}
                      </a>
                    </li>
                  )}
                </ul>
              </details>
            ))}
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
              gap: "1.5rem",
              marginTop: "1.5rem",
            }}
          >
            {items.map((col) => (
              <div key={col.id}>
                <strong style={{ display: "block", marginBottom: "0.5rem", color: "#0f172a" }}>{col.name}</strong>
                <ul style={{ listStyle: "none", margin: 0, padding: 0, fontSize: "0.875rem" }}>
                  {col.subMenuItemList?.map((link) => (
                    <li key={link.id} style={{ margin: "0.25rem 0" }}>
                      <a href={link.url} rel={linkRel(link.url)}>
                        {link.name}
                      </a>
                    </li>
                  )) ?? (
                    <li>
                      <a href={col.url} rel={linkRel(col.url)}>
                        {col.name}
                      </a>
                    </li>
                  )}
                </ul>
              </div>
            ))}
          </div>
        )}

        <p style={{ margin: "2rem 0 0", fontSize: "0.75rem", textAlign: "center" }}>
          © Hangikredi — Bilgilendirme amaçlıdır.
        </p>
      </div>
    </footer>
  );
}
