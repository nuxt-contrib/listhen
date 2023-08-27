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
} from "./types";
import {
  formatURL,
  getNetworkInterfaces,
  isLocalhost,
  isAnyhost,
  getPublicURL,
  generateURL,
} from "./_utils";
import { resolveCertificate } from "./_cert";

export async function listen(
  handle: RequestListener,
  _options: Partial<ListenOptions> = {},
): Promise<Listener> {
  // --- Resolve Options ---
  const _isProd = _options.isProd ?? process.env.NODE_ENV === "production";
  const _isTest = _options.isTest ?? process.env.NODE_ENV === "test";
  const _hostname = process.env.HOST ?? _options.hostname;
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
    hostname: _hostname ?? (_public ? "" : "localhost"),
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
  const _localhost = isLocalhost(listhenOptions.hostname);
  const _anyhost = isAnyhost(listhenOptions.hostname);
  if (listhenOptions.public && _localhost) {
    consola.warn(
      `[listhen] Trying to listhen on private host ${JSON.stringify(
        listhenOptions.hostname,
      )} with public option disabled.`,
    );
    listhenOptions.public = false;
  } else if (!listhenOptions.public && _anyhost) {
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
    ...(typeof listhenOptions.port === "object" && listhenOptions.port),
  }));

  // --- Listen ---
  let server: Server | HTTPServer;
  let https: Listener["https"] = false;
  const httpsOptions = listhenOptions.https as HTTPSOptions;
  if (httpsOptions) {
    https = await resolveCertificate(httpsOptions);
    server = createHTTPSServer(https, handle);
    addShutdown(server);
    // @ts-ignore
    await promisify(server.listen.bind(server))(port, listhenOptions.hostname);
    const _addr = server.address() as AddressInfo;
    listhenOptions.port = _addr.port;
  } else {
    server = createServer(handle);
    addShutdown(server);
    // @ts-ignore
    await promisify(server.listen.bind(server))(port, listhenOptions.hostname);
    const _addr = server.address() as AddressInfo;
    listhenOptions.port = _addr.port;
  }

  // --- GetURL Utility ---
  const getURL = (host = "localhost", baseURL?: string) =>
    generateURL(host, listhenOptions, baseURL);

  // --- Start Tunnel ---
  let tunnel: Tunnel | undefined;
  if (listhenOptions.tunnel) {
    const { startTunnel } = await import("untun");
    tunnel = await startTunnel({
      url: getURL("localhost"),
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
      _addURL("local", getURL("localhost", getURLOptions.baseURL));
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

    const showQR = (showURLOptions.qr ?? listhenOptions.qr) !== false;

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
        suffix += colors.gray(" [QR code ⬇️ ]");
      }
      lines.push(`${label} ${formatURL(url.url)}${suffix}`);
    }

    if (!firstPublicUrl) {
      lines.push(
        colors.gray(`  ➜ Network:  use ${colors.white("--host")} to expose`),
      );
    }

    // Show QR code
    if (firstPublicUrl && showQR) {
      const space = " ".repeat(14);
      lines.push(" ");
      lines.push(
        ...renderQRCode(firstPublicUrl.url)
          .split("\n")
          .map((line) => space + line),
      );
    }

    // eslint-disable-next-line no-console
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
    process.on("exit", () => close());
  }

  return <Listener>{
    url: getURL(),
    https,
    server,
    open: _open,
    showURL,
    getURLs,
    close,
  };
}
