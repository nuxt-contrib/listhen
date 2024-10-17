import { createServer } from "node:http";
import type { Server as HTTPServer } from "node:https";
import { createServer as createHTTPSServer } from "node:https";
import { promisify } from "node:util";
import type { RequestListener, Server } from "node:http";
import type { AddressInfo } from "node:net";
import { getPort } from "get-port-please";
import addShutdown from "http-shutdown";
import consola from "consola";
import { defu } from "defu";
import { ColorName, getColor, colors } from "consola/utils";
import { renderUnicodeCompact as renderQRCode } from "uqr";
import type { Tunnel } from "untun";
import { open } from "./lib/open";
import type {
  ListenOptions,
  Listener,
  ShowURLOptions,
  HTTPSOptions,
  ListenURL,
  GetURLOptions,
  CrossWSOptions,
} from "./types";
import {
  formatURL,
  getNetworkInterfaces,
  isLocalhost,
  isAnyhost,
  getPublicURL,
  generateURL,
  getDefaultHost,
  validateHostname,
} from "./_utils";
import { resolveCertificate } from "./_cert";
import { isWsl } from "./lib/wsl";
import { isDocker } from "./lib/docker";

/**
 * Starts an HTTP or HTTPS server with the provided request handler and configuration options.
 * This function sets up the server, configures the port and hostname, enables HTTPS if specified, sets up
 * WebSocket support if required, handles tunneling for public access, and provides utilities for displaying URLs
 * and handling server shutdown.
 *
 * @param handle The request listener function for handling HTTP requests.
 * @param _options Partial configuration options for the server. Inherits from {@link ListenOptions}.
 * @returns a promise that resolves to a {@link Listener} object containing server details and utility functions.
 */
export async function listen(
  handle: RequestListener,
  _options: Partial<ListenOptions> = {},
): Promise<Listener> {
  // --- Resolve Options ---
  const _isProd = _options.isProd ?? process.env.NODE_ENV === "production";
  const _isTest = _options.isTest ?? process.env.NODE_ENV === "test";
  const _hostname = _options.hostname ?? process.env.HOST;
  const _public =
    _options.public ??
    (isLocalhost(_hostname) ? false : undefined) ??
    (isAnyhost(_hostname) ? true : undefined) ??
    (process.argv.includes("--host") ? true : undefined) ??
    _isProd;

  const listhenOptions = defu<ListenOptions, ListenOptions[]>(_options, {
    name: "",
    https: false,
    port: process.env.PORT || 3000,
    hostname: _hostname ?? getDefaultHost(_public),
    showURL: true,
    baseURL: "/",
    open: false,
    clipboard: false,
    isTest: _isTest,
    isProd: _isProd,
    public: _public,
    autoClose: true,
  });

  // --- Validate Options ---
  listhenOptions.hostname = validateHostname(
    listhenOptions.hostname,
    listhenOptions.public,
  );
  const _localhost = isLocalhost(listhenOptions.hostname);
  const _anyhost = isAnyhost(listhenOptions.hostname);
  if (listhenOptions.public && _localhost) {
    consola.warn(
      `[listhen] Trying to listhen on private host ${JSON.stringify(
        listhenOptions.hostname,
      )} with public option enabled.`,
    );
    listhenOptions.public = false;
  } else if (!listhenOptions.public && _anyhost && !(isWsl() || isDocker())) {
    consola.warn(
      `[listhen] Trying to listhen on public host ${JSON.stringify(
        listhenOptions.hostname,
      )} with public option disabled. Using "localhost".`,
    );
    listhenOptions.public = false;
    listhenOptions.hostname = "localhost";
  }

  if (listhenOptions.isTest) {
    listhenOptions.showURL = false;
  }

  if (listhenOptions.isProd || listhenOptions.isTest) {
    listhenOptions.open = false;
    listhenOptions.clipboard = false;
  }

  // --- Resolve Port ---
  const port = (listhenOptions.port = await getPort({
    port: Number(listhenOptions.port),
    verbose: !listhenOptions.isTest,
    host: listhenOptions.hostname,
    alternativePortRange: [3000, 3100],
    public: listhenOptions.public,
    ...(typeof listhenOptions.port === "object" && listhenOptions.port),
  }));

  // --- Listen ---
  let server: Server | HTTPServer;
  let https: Listener["https"] = false;
  const httpsOptions = listhenOptions.https as HTTPSOptions;
  let _addr: AddressInfo;
  if (httpsOptions) {
    https = await resolveCertificate(httpsOptions);
    server = createHTTPSServer(https, handle);
    addShutdown(server);
    // @ts-ignore
    await promisify(server.listen.bind(server))(port, listhenOptions.hostname);
    _addr = server.address() as AddressInfo;
    listhenOptions.port = _addr.port;
  } else {
    server = createServer(handle);
    addShutdown(server);
    // @ts-ignore
    await promisify(server.listen.bind(server))(port, listhenOptions.hostname);
    _addr = server.address() as AddressInfo;
    listhenOptions.port = _addr.port;
  }

  // --- WebSocket ---
  if (listhenOptions.ws) {
    if (typeof listhenOptions.ws === "function") {
      server.on("upgrade", listhenOptions.ws);
    } else {
      consola.warn(
        "[listhen] Using experimental websocket API. Learn more: `https://crossws.unjs.io`",
      );
      const nodeWSAdapter = await import("crossws/adapters/node").then(
        (r) => r.default || r,
      );
      const { handleUpgrade } = nodeWSAdapter({
        ...(listhenOptions.ws as CrossWSOptions),
      });
      server.on("upgrade", handleUpgrade);
    }
  }

  // --- GetURL Utility ---
  const getURL = (host = listhenOptions.hostname, baseURL?: string) =>
    generateURL(host, listhenOptions, baseURL);

  // --- Start Tunnel ---
  let tunnel: Tunnel | undefined;
  if (listhenOptions.tunnel) {
    const { startTunnel } = await import("untun");
    tunnel = await startTunnel({
      url: getURL(),
    });
  }

  // --- Close Utility ---
  let _closed = false;
  const close = async () => {
    if (_closed) {
      return;
    }
    _closed = true;
    await promisify((server as any).shutdown)().catch(() => {});
    await tunnel?.close().catch(() => {});
  };

  // --- Copy URL to Clipboard ---
  if (listhenOptions.clipboard) {
    const clipboardy = await import("clipboardy").then((r) => r.default || r);
    await clipboardy.write(getURL()).catch(() => {
      listhenOptions.clipboard = false;
    });
  }

  // --- GetURLs Utility ---
  const getURLs = async (getURLOptions: GetURLOptions = {}) => {
    const urls: ListenURL[] = [];

    const _addURL = (type: ListenURL["type"], url: string) => {
      if (!urls.some((u) => u.url === url)) {
        urls.push({
          url,
          type,
        });
      }
    };

    // Add public URL
    const publicURL =
      getURLOptions.publicURL ||
      getPublicURL(listhenOptions, getURLOptions.baseURL);
    if (publicURL) {
      _addURL("network", publicURL);
    }

    // Add localhost URL
    if (_localhost || _anyhost) {
      _addURL("local", getURL(listhenOptions.hostname, getURLOptions.baseURL));
    }

    // Add tunnel URL
    if (tunnel) {
      _addURL("tunnel", await tunnel.getURL());
    }

    // Add public network interface URLs
    if (listhenOptions.public) {
      const _ipv6Host = listhenOptions.hostname.includes(":");
      for (const addr of getNetworkInterfaces(_ipv6Host)) {
        if (addr === publicURL) {
          continue;
        }
        _addURL("network", getURL(addr, getURLOptions.baseURL));
      }
    }

    return urls;
  };

  const showURL = async (showURLOptions: ShowURLOptions = {}) => {
    const lines = [];

    const nameSuffix =
      showURLOptions.name || listhenOptions.name
        ? ` (${showURLOptions.name || listhenOptions.name})`
        : "";

    const urls = await getURLs(showURLOptions);

    const firstLocalUrl = urls.find((u) => u.type === "local");
    const firstPublicUrl = urls.find((u) => u.type !== "local");

    // QR Code
    const showQR = (showURLOptions.qr ?? listhenOptions.qr) !== false;
    if (firstPublicUrl && showQR) {
      const space = " ".repeat(14);
      lines.push(" ");
      lines.push(
        ...renderQRCode(firstPublicUrl.url)
          .split("\n")
          .map((line) => space + line),
      );
      lines.push(" ");
    }

    const typeMap: Record<ListenURL["type"], [string, ColorName]> = {
      local: ["Local", "green"],
      tunnel: ["Tunnel", "yellow"],
      network: ["Network", "magenta"],
    };

    for (const url of urls) {
      const type = typeMap[url.type];
      const label = getColor(type[1])(
        `  ➜ ${(type[0] + ":").padEnd(8, " ")}${nameSuffix} `,
      );
      let suffix = "";
      if (url === firstLocalUrl && listhenOptions.clipboard) {
        suffix += colors.gray(" [copied to clipboard]");
      }
      if (url === firstPublicUrl && showQR) {
        suffix += colors.gray(" [QR code]");
      }
      lines.push(`${label} ${formatURL(url.url)}${suffix}`);
    }

    if (!firstPublicUrl) {
      lines.push(
        colors.gray(`  ➜ Network:  use ${colors.white("--host")} to expose`),
      );
    }

    // Print lines
    console.log("\n" + lines.join("\n") + "\n");
  };

  if (listhenOptions.showURL) {
    showURL();
  }

  const _open = async () => {
    await open(getURL()).catch(() => {});
  };
  if (listhenOptions.open) {
    await _open();
  }

  if (listhenOptions.autoClose) {
    process.setMaxListeners(0);
    process.once("exit", () => close());
    process.once("SIGINT", () => process.exit(0)); // Ctrl + C
    process.once("SIGTERM", () => process.exit(0)); // Terminate
    process.once("SIGHUP", () => process.exit(0)); // Closed terminal
  }

  return <Listener>{
    url: getURL(),
    https,
    server,
    address: _addr,
    open: _open,
    showURL,
    getURLs,
    close,
  };
}
