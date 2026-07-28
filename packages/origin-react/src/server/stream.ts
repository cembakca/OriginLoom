import { PassThrough, Readable } from "node:stream";

import { stripUndefined } from "@originloom/shared/lib/strip-undefined";
import type { DocumentStreamOptions, StreamResult } from "@originloom/shared/render";
import type { ReactElement } from "react";
import { renderToPipeableStream } from "react-dom/server";

/**
 * Streams a document tree, resolving once the shell is flushable so the caller
 * can start the response before deferred content is ready.
 */
export async function renderTreeToStream(
  tree: ReactElement,
  options: DocumentStreamOptions & { cspNonce?: string | undefined },
): Promise<StreamResult> {
  const passThrough = new PassThrough();
  passThrough.write("<!DOCTYPE html>");

  let shellReadyResolve: () => void;
  let shellReadyReject: (err: unknown) => void;
  const shellReadyPromise = new Promise<void>((resolve, reject) => {
    shellReadyResolve = resolve;
    shellReadyReject = reject;
  });

  let allReadyResolve: () => void;
  const allReadyPromise = new Promise<void>((resolve) => {
    allReadyResolve = resolve;
  });

  const rxStream = renderToPipeableStream(tree, {
    onShellReady() {
      rxStream.pipe(passThrough);
      shellReadyResolve();
    },
    onAllReady() {
      allReadyResolve();
    },
    onShellError(error) {
      passThrough.destroy(error as Error);
      shellReadyReject(error);
    },
    onError(error) {
      options.onError(error);
    },
    ...stripUndefined({ nonce: options.cspNonce }),
  });

  await shellReadyPromise;

  return {
    stream: Readable.toWeb(passThrough) as unknown as ReadableStream<Uint8Array>,
    abort: () => rxStream.abort(),
    allReady: allReadyPromise,
  };
}
