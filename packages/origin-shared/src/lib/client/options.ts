/** Client-side features an OriginLoom application can opt into. */
export type OriginLoomClientOptions = {
  /**
   * Shows the compact OriginLoom inspector during development.
   *
   * The app entry guards the dynamic import with this value, so setting it to
   * false keeps the panel module out of both the page and its development
   * module graph. Production builds remove the import regardless of this value.
   *
   * @default true
   */
  devtools?: boolean;
};
