export function SiteFooter({ minimal }: { minimal?: boolean }) {
  if (minimal) {
    return (
      <footer style={{ padding: "1rem", textAlign: "center", color: "#94a3b8", fontSize: "0.875rem" }}>
        ssr-kit
      </footer>
    );
  }

  return (
    <footer style={{ marginTop: "3rem", padding: "2rem 1rem", borderTop: "1px solid #e2e8f0", color: "#64748b" }}>
      <p style={{ margin: 0, textAlign: "center" }}>© ssr-kit — SSR + island + GTM</p>
    </footer>
  );
}
