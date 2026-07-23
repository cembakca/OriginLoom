export type RewriteRule = {
  source: string;
  destination: string;
};

export type RedirectRule = {
  source: string;
  destination: string;
  status?: 301 | 302 | 307 | 308;
};

export type RouteResolution =
  | { kind: "none"; pathname: string; publicPath: string }
  | { kind: "rewrite"; pathname: string; search: string; publicPath: string }
  | { kind: "redirect"; url: string; status: number }
  | { kind: "proxy"; url: string };
