import { extname } from "node:path";
import { consola } from "consola";
import type { AsyncSubscription } from "@parcel/watcher-wasm";
import type { ConsolaInstance } from "consola";
import type { Listener, ListenOptions } from "../types";
import { listen } from "../listen";
import { createDevServer, DevServerOptions } from "./dev";

export interface WatchOptions extends DevServerOptions {
  /**
   * The current working directory from which the server should run.
   * Inherits all the properties of {@link DevServerOptions}.
   * @optional
   */
  cwd?: string;

  /**
   * The logger instance to use for logging within the watch process.
   * @optional
   * See {@link ConsolaInstance}.
   */
  logger?: ConsolaInstance;

  /**
   * An array of glob patterns to specify files or directories to ignore during monitoring.
   * @optional
   */
  ignore?: string[];

  /**
   * An array of directories containing static files. These directories are served by the dev server.
   * @optional
   */
  publicDirs?: string[];
}

/**
 * Initialises a development server with file-watching capabilities, automatically reloading the server as files change.
 * This feature combines the setup of a development server with file monitoring to provide a live development environment.
 * 
 * @param entry The path to the server's entry file.
 * @param options Configuration options that combine {@link ListenOptions} and {@link WatchOptions} for server listening and file and
 * file-watching behaviour. This allows partial customisation by merging server and watcher configurations.
 * @returns a promise that resolves to an {@link listener} instance representing the launched server with attached file-watching capabilities.
 * This server will be reloaded on specified file changes.
 */
export async function listenAndWatch(
  entry: string,
  options: Partial<ListenOptions & WatchOptions>,
): Promise<Listener> {
  const logger = options.logger || consola.withTag("listhen");
  let watcher: AsyncSubscription;

  // Create dev server
  const devServer = await createDevServer(entry, {
    ...options,
    logger,
  });

  // Initialize listener
  const listener = await listen(devServer.nodeListener, {
    ...options,
    _entry: devServer._entry,
    ws: options.ws ? devServer._ws : undefined,
  });

  // Load dev server handler first time
  await devServer.reload(true);

  // Hook close event to stop watcher too
  const _close = listener.close;
  listener.close = async () => {
    if (watcher) {
      await watcher.unsubscribe().catch((error) => {
        logger.error(error);
      });
    }
    await _close();
  };

  // Start watcher
  try {
    // https://github.com/parcel-bundler/watcher
    const subscribe = await import("@parcel/watcher")
      .then((r) => r.subscribe)
      .catch(() => import("@parcel/watcher-wasm").then((r) => r.subscribe));

    const jsExts = new Set([".js", ".mjs", ".cjs", ".ts", ".mts", ".cts"]);

    watcher = await subscribe(
      devServer.cwd,
      (_error, events) => {
        const filteredEvents = events.filter((e) =>
          jsExts.has(extname(e.path)),
        );
        if (filteredEvents.length === 0) {
          return;
        }
        const eventsString = filteredEvents
          .map((e) => `${devServer.resolver.formatRelative(e.path)} ${e.type}d`)
          .join(", ");
        logger.log(`🔄 Reloading server (${eventsString})`);
        devServer.reload();
      },
      {
        ignore: options.ignore || [
          "**/.git/**",
          "**/node_modules/**",
          "**/dist/**",
        ],
      },
    );

    logger.log(
      `👀 Watching ${devServer.resolver.formatRelative(
        devServer.cwd,
      )} for changes`,
    );
  } catch (error) {
    logger.warn(
      "Cannot start the watcher!\n",
      error,
      "\n\n✔️ Your dev server is still running, but it won't reload automatically after changes. You need to restart it manually.",
    );
  }

  return listener;
}
