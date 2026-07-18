import type React from "react";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "ssr-fragment": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & { name: string },
        HTMLElement
      >;
    }
  }
}
