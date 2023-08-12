import { WatchOptions } from "node:fs";
import { defineCommand, runMain as _runMain } from "citty";
import { isAbsolute } from "pathe";
import { name, description, version } from "../package.json";
import { listen } from "./listen";
import { listenAndWatch, DevServerOptions, createDevServer } from "./server";
import type { HTTPSOptions, ListenOptions } from "./types";

export const main = defineCommand({
  meta: {
    name,
    description,
    version,
  },
  args: {
    cwd: {
      type: "string",
      description: "Current working directory",
    },
    entry: {
      type: "positional",
      description: "Listener entry file (./app.ts)",
      required: true,
    },
    port: {
      type: "string",
      description:
        "Port to listen on (use PORT environment variable to override)",
    },
    host: {
      type: "string",
      description:
        "Host to listen on (use HOST environment variable to override)",
    },
    clipboard: {
      type: "boolean",
      description: "Copy the URL to the clipboard",
      default: false,
    },
    open: {
      type: "boolean",
      description: "Open the URL in the browser",
      default: false,
    },
    baseURL: {
      type: "string",
      description: "Base URL to use",
    },
    name: {
      type: "string",
      description: "Name to use in the banner",
    },
    https: {
      type: "boolean",
      description: "Enable HTTPS",
      default: false,
    },
    "https.cert": {
      type: "string",
      description: "Path to TLS certificate used with HTTPS in PEM format",
    },
    "https.key": {
      type: "string",
      description: "Path to TLS key used with HTTPS in PEM format",
    },
    "kettps.pfx": {
      type: "string",
      description:
        "Path to PKCS#12 (.p12/.pfx) keystore containing a TLS certificate and Key",
    },
    "https.passphrase": {
      type: "string",
      description: "Passphrase used for TLS key or keystore",
    },
    "https.validityDays": {
      type: "string",
      description:
        "Validity in days of the autogenerated TLS certificate (https: true)",
    },
    "https.domains": {
      type: "string",
      description:
        "Comma seperated list of domains and IPs, the autogenerated certificate should be valid for (https: true)",
    },
    watch: {
      type: "boolean",
      description: "Watch for changes",
      alias: "w",
      default: false,
    },
    publicURL: {
      type: "string",
      description: "Displayed public URL (used for qr code)",
      required: false,
    },
    qr: {
      type: "boolean",
      description: "Display The QR code of public URL when available",
      required: false,
    },
    public: {
      type: "boolean",
      description: "Listen to all network interfaces",
      required: false,
    },
    tunnel: {
      type: "boolean",
      description: "Open a tunnel using cloudflared",
      required: false,
    },
  },
  async run({ args }) {
    const opts: Partial<ListenOptions & WatchOptions & DevServerOptions> = {
      ...args,
      port: args.port,
      hostname: args.host,
      clipboard: args.clipboard,
      open: args.open,
      baseURL: args.baseURL,
      name: args.name,
      qr: args.qr,
      publicURL: args.publicURL,
      public: args.public,
      https: args.https ? parseHTTPSArgs(args) : false,
    };

    const entry =
      isAbsolute(args.entry) || args.entry.startsWith(".")
        ? args.entry
        : `./${args.entry}`;

    if (args.watch) {
      await listenAndWatch(entry, opts);
    } else {
      const devServer = await createDevServer(entry, opts);
      await listen(devServer.nodeListener, {
        ...opts,
        _entry: devServer._entry,
      });
      await devServer.reload(true);
    }
  },
});

export const runMain = () => _runMain(main);

// --- utils ---

export function parseHTTPSArgs(args: Record<string, any>): HTTPSOptions {
  const https: HTTPSOptions = {};

  if (args["https.cert"]) {
    https.cert = args["https.cert"];
  }

  if (args["https.key"]) {
    https.key = args["https.key"];
  }

  if (args["https.pfx"]) {
    https.pfx = args["https.pfx"];
  }

  if (args["https.passphrase"]) {
    https.passphrase = args["https.passphrase"];
  }

  if (args["https.validityDays"]) {
    https.validityDays = args["https.validityDays"];
  }

  if (args["https.domains"]) {
    https.domains = args["https.domains"]
      .split(",")
      .map((s: string) => s.trim());
  }

  return https;
}
