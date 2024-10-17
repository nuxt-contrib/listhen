import type { IncomingMessage, Server } from "node:http";
import type { Server as HTTPServer } from "node:https";
import { AddressInfo } from "node:net";
import type { GetPortInput } from "get-port-please";
import type { NodeOptions } from "crossws/adapters/node";

export type CrossWSOptions = NodeOptions;

export interface Certificate {
  /**
   * Private key for HTTPS encryption.
   */
  key: string;

  /**
   * Certificate for HTTPS encryption.
   */
  cert: string;

  /**
   * Passphrase for accessing the private key, if required.
   * @optional
   */
  passphrase?: string;
}

export interface HTTPSOptions {
  /**
   * Path to the SSL certificate file.
   * @optional
   */
  cert?: string;
  
  /**
   * Path to the SSL key file.
   * @optional
   */
  key?: string;

  /**
   * Path to a PFX file containing the private key, certificate, and CA certificates.
   * @optional
   */
  pfx?: string;

  /**
   * Passphrase for accessing the private key or PFX file.
   * @optional
   */
  passphrase?: string;

  /**
   * Number of days the self-signed certificate is valid.
   * @optional
   * @default 1
   */
  validityDays?: number;

  /**
   * Array of domains to include in a self-signed certificate. Required when generating a self-signed certificate.
   * @optional
   */
  domains?: string[];
}

export interface ListenOptions {
  /**
   * Unique name for the listener, used for logging and identification purposes.
   * @default ""
   */
  name: string;

  /**
   * The port number or port discovery strategy to use for the server.
   * @default env.PORT || 3000
   */
  port: GetPortInput;

  /**
   * The hostname or IP address to bind the server to.
   * @default env.HOST || "localhost"
   */
  hostname: string;

  /**
   * Whether to display the base URL in logs.
   * @default true
   */
  showURL: boolean;
  
  /**
   * The base URL path to prepend to all routes.
   * @default "/"
   */
  baseURL: string;

  /**
   * Whether to automatically open the browser to the base URL when the server starts.
   * @default false
   */
  open: boolean;

  /**
   * Enable HTTPS. Can be a boolean flag or a detailed HTTPS configuration.
   * @default false
   */
  https: boolean | HTTPSOptions;

  /**
   * Whether to copy the base URL to the clipboard when the server starts.
   * @default false
   */
  clipboard: boolean;

  /**
   * Indicates whether the server is running in a test environment.
   * @default env.NODE_ENV === "test"
   */
  isTest: boolean;

  /**
   * Indicates whether the server is running in a production environment.
   * @default env.NODE_ENV === "production"
   */
  isProd: boolean;

 /**
   * Whether to automatically close the server on `SIGINT` and `SIGTERM` signals.
   * @default true
   */
  autoClose: boolean;

  /**
   * The entry point file path for the server, used internally.
   * @optional
   */
  _entry?: string;

  /**
   * Used as main public url to display
   * @default The first public IPV4 address listening to
   */
  publicURL?: string;
  /**
   * Print QR Code for public IPv4 address
   *
   * @default true
   */
  qr?: boolean;
  /**
   * When enabled, listhen tries to listen to all network interfaces
   *
   * @default `false` for development and `true` for production
   */
  public: boolean;
  /**
   * Open a tunnel using https://github.com/unjs/untun
   */
  tunnel?: boolean;
  /**
   * WebSocket Upgrade Handler
   *
   * Input can be an upgrade handler or CrossWS options
   *
   * @experimental CrossWS usage is subject to change
   * @see https://github.com/unjs/crossws
   */
  ws?:
    | boolean
    | CrossWSOptions
    | ((req: IncomingMessage, head: Buffer) => void);
}

export type GetURLOptions = Pick<
  Partial<ListenOptions>,
  "baseURL" | "publicURL"
>;

export type ShowURLOptions = Pick<
  Partial<ListenOptions>,
  "baseURL" | "name" | "publicURL" | "qr"
>;

export interface ListenURL {
  /**
   * The URL being listened to.
   */
  url: string;

  /**
   * The type of URL (local, network, or tunnel).
   */
  type: "local" | "network" | "tunnel";
}

export interface Listener {
  /**
   * The primary URL for accessing the server.
   */
  url: string;

  /**
   * The address information of the server. See {@link AddressInfo}.
   */
  address: AddressInfo;

  /**
   * The server instance can be either an HTTP or an HTTPS server. See {@link Server} and {@link HTTPServer}.
   */
  server: Server | HTTPServer;

  /**
   * Indicates whether HTTPS is enabled and, if so, the certificate details. See {@link Certificate}.
   */
  https: false | Certificate;

  /**
   * Closes the server and cleans up resources.
   */
  close: () => Promise<void>;

  /**
   * Opens the server URL in your default web browser.
   */
  open: () => Promise<void>;

  /**
   * Displays the server URL in the console, with optional appearance configuration.
   * 
   * @param options Configuration options for displaying the URL. See {@link ShowURLOptions}.
   */
  showURL: (options?: ShowURLOptions) => Promise<void>;

  /**
   * Gets an array of URLs where the server can be reached, based on the options provided.
   * 
   * @param options Configuration options for retrieving URLs. See {@link GetURLOptions}.
   * @returns a promise that resolves to an array of {@link ListenURL} objects.
   */
  getURLs: (options?: GetURLOptions) => Promise<ListenURL[]>;
}
