import type { IncomingMessage, ServerResponse } from "node:http";
import { request } from "node:http";
import { request as httpsRequest } from "node:https";
import { platform } from "node:os";
import { resolve } from "pathe";
import { afterEach, describe, expect, test } from "vitest";
import { createApp, createRouter, eventHandler, toNodeListener } from "h3";
import { listen, Listener } from "../src";
import { getSocketPath } from "../src/_utils";

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

function getApp() {
  const app = createApp({});

  const router = createRouter()
    .get(
      "/",
      eventHandler(() => ({ hello: "world!" })),
    )
    .get(
      "/path",
      eventHandler(() => ({ hello: "path!" })),
    )
    .get(
      "/unix",
      eventHandler(() => ({ hello: "unix!" })),
    );

  app.use(router);

  return app;
}

// console.log = fn()

function handle(request: IncomingMessage, response: ServerResponse) {
  response.end(request.url);
}

function ipcRequest(ipcSocket: string, path: string, https = false) {
  return new Promise((resolve, reject) => {
    (https ? httpsRequest : request)(
      {
        socketPath: ipcSocket,
        path,
      },
      (res) => {
        const data: any[] = [];
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          data.push(chunk);
        });
        res.on("error", (e) => {
          reject(e);
        });
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve(data.join(""));
          }
        });
      },
    ).end();
  });
}

describe("listhen", () => {
  let listener: Listener | undefined;

  afterEach(async () => {
    if (listener) {
      await listener.close();
      listener = undefined;
    }
  });
  async function h3AppAssertions(ipcSocket: string, https: boolean) {
    expect(listener!.url).toBe(`unix+http${https ? "s" : ""}://${ipcSocket}`);

    await expect(ipcRequest(ipcSocket, "/", https)).resolves.toEqual({
      hello: "world!",
    });
    await expect(ipcRequest(ipcSocket, "/path", https)).resolves.toEqual({
      hello: "path!",
    });
    await expect(ipcRequest(ipcSocket, "/unix", https)).resolves.toEqual({
      hello: "unix!",
    });
    const response = await ipcRequest(ipcSocket, "/test", https);
    expect(response.statusCode).toEqual(404);
    expect(response.statusMessage).toEqual(
      "Cannot find any path matching /test.",
    );
  }

  async function handleAssertions(ipcSocket: string, https: boolean) {
    expect(listener!.url).toBe(`unix+http${https ? "s" : ""}://${ipcSocket}`);

    await expect(ipcRequest(ipcSocket, "/", https)).resolves.toEqual("/");
    await expect(ipcRequest(ipcSocket, "/path", https)).resolves.toEqual(
      "/path",
    );
  }

  test("should listen to the next port in range (3000 -> 31000)", async () => {
    listener = await listen(handle, {
      port: { port: 3000 },
    });
    expect(listener.url).toMatch(/:3000\/$/);
    const listener2 = await listen(handle, {
      port: { port: 3000 },
    });
    expect(listener2.url).toMatch(/:3001\/$/);
    await listener2.close();
  });
  test("listen (no args)", async () => {
    listener = await listen(handle);
    expect(listener.url.startsWith("http://")).toBe(true);
  });

  test("listen (http)", async () => {
    listener = await listen(handle, {
      isTest: false,
      autoClose: false,
      baseURL: "/foo/bar",
    });
    expect(listener.url.startsWith("http://")).toBe(true);
    expect(listener.url.endsWith("/foo/bar")).toBe(true);

    // expect(console.log).toHaveBeenCalledWith(expect.stringMatching('\n  > Local:    http://localhost:3000/foo/bar'))
  });

  test("listen on unix domain socket/windows named pipe (handle)", async () => {
    const ipcSocketName = "listhen";
    const ipcSocket = getSocketPath(ipcSocketName);

    listener = await listen(handle, {
      socket: ipcSocketName,
    });

    await handleAssertions(ipcSocket, false);
  });

  test("listen on unix domain socket/windows named pipe (h3 app)", async () => {
    const ipcSocketName = "listhen2";
    const ipcSocket = getSocketPath(ipcSocketName);

    listener = await listen(toNodeListener(getApp()), {
      socket: ipcSocketName,
    });

    expect(listener.url).toBe(`unix+http://${ipcSocket}`);

    await h3AppAssertions(ipcSocket, false);
  });

  describe("https", () => {
    test("listen (https - selfsigned)", async () => {
      listener = await listen(handle, { https: true, hostname: "localhost" });
      expect(listener.url.startsWith("https://")).toBe(true);
    });

    test("listen (https - custom)", async () => {
      listener = await listen(handle, {
        https: {
          key: resolve(__dirname, ".tmp/certs", "key.pem"),

          cert: resolve(__dirname, ".tmp/certs", "cert.pem"),
        },
        hostname: "localhost",
      });
      expect(listener.url.startsWith("https://")).toBe(true);
    });

    test("listen (https - unix domain socket/windows named pipe - handle)", async () => {
      const ipcSocketName = "listhen-https";
      const ipcSocket = getSocketPath(ipcSocketName);

      listener = await listen(handle, {
        socket: ipcSocketName,
        https: true,
      });

      expect(listener.url).toBe(`unix+https://${ipcSocket}`);

      await handleAssertions(ipcSocket, true);
    });

    test("listen (https - unix domain socket/windows named pipe - h3 app)", async () => {
      const ipcSocketName = "listhen-https";
      const ipcSocket = getSocketPath(ipcSocketName);

      listener = await listen(toNodeListener(getApp()), {
        socket: ipcSocketName,
        https: true,
      });

      await h3AppAssertions(ipcSocket, true);
    });

    test("listen (https - custom - with private key passphrase)", async () => {
      listener = await listen(handle, {
        https: {
          key: resolve(__dirname, ".tmp/certs", "encrypted-key.pem"),

          cert: resolve(__dirname, ".tmp/certs", "cert.pem"),
          passphrase: "cert-pw",
        },
        hostname: "localhost",
      });
      expect(listener.url.startsWith("https://")).toBe(true);
    });

    const nodeMajor = Number(process.version.slice(1).split(".")[0]);
    test.skipIf(nodeMajor < 18)(
      "listen (https - custom - with wrong private key passphrase)",
      () => {
        expect(() =>
          listen(handle, {
            https: {
              key: resolve(__dirname, ".tmp/certs", "encrypted-key.pem"),

              cert: resolve(__dirname, ".tmp/certs", "cert.pem"),
              passphrase: "wrong-pw",
            },
            hostname: "localhost",
          }),
        ).rejects.toThrowError("error:1C800064:Provider routines::bad decrypt");
      },
    );

    test("listen (https - PCKS#12/pfx/p12 - with store passphrase)", async () => {
      const listener = await listen(handle, {
        https: {
          pfx: resolve(__dirname, ".tmp/certs/keystore.p12"),
          passphrase: "store-pw",
        },
        hostname: "localhost",
      });
      expect(listener.url.startsWith("https://")).toBe(true);
    });

    test("listen (https - PCKS#12/pfx/p12 - without store passphrase)", () => {
      expect(() =>
        listen(handle, {
          https: {
            pfx: resolve(__dirname, ".tmp/certs/keystore.p12"),
          },
          hostname: "localhost",
        }),
      ).rejects.toThrowError(
        "PKCS#12 MAC could not be verified. Invalid password?",
      );
    });

    test("listen (https - PCKS#12/pfx/p12 - with wrong store passphrase)", () => {
      expect(() =>
        listen(handle, {
          https: {
            pfx: resolve(__dirname, ".tmp/certs/keystore.p12"),
            passphrase: "wrong-pw",
          },
          hostname: "localhost",
        }),
      ).rejects.toThrowError(
        "PKCS#12 MAC could not be verified. Invalid password?",
      );
    });
  });

  describe("close", () => {
    test("double close", async () => {
      listener = await listen(handle, { isTest: false });
      await listener.close();
      await listener.close();
    });

    test("autoClose", async () => {
      /* not passing close */ await listen(handle);
      // @ts-ignore
      process.emit("exit");
    });
  });

  describe("port", () => {
    test("pass hostname to get-port-please", async () => {
      listener = await listen(handle, { hostname: "127.0.0.1" });
      expect(listener.url.startsWith("http://127.0.0.1")).toBe(true);
    });

    test("pass port to get-port-please", async () => {
      listener = await listen(handle, { port: 40_000 });
      expect(listener.url.endsWith(":40000/")).toBe(true);
    });

    test("pass extended options to get-port-please", async () => {
      listener = await listen(handle, {
        port: { port: 50_000, portRange: [50_000, 59_999] },
      });
      expect(listener.url).toMatch(/:5\d{4}\/$/);
    });
  });

  describe("_utils", () => {
    describe.runIf(platform() !== "win32")(
      "socket path (on unixoid systems)",
      () => {
        test("empty ipcSocketName resolves to a 'listhen' named pipe/socket", () => {
          const socketPath = "listhen.sock";
          expect(getSocketPath(undefined!)).toEqual(socketPath);
          expect(getSocketPath("")).toEqual(socketPath);
        });

        test("some string as ipcSocketName resolves to a pipe/socket named as this string", () => {
          const socketPath = "listhen-https";
          expect(getSocketPath("listhen-https")).toEqual(socketPath);
        });

        test("absolute path (or full pipe path) resolves to the exact same path", () => {
          let socket = "/tmp/listhen.sock";
          expect(getSocketPath(socket)).toEqual(socket);
          socket = "/tmp/listhen.sock";
          expect(getSocketPath(socket)).toEqual(socket);
          socket = "/tmp/listhen";
          expect(getSocketPath(socket)).toEqual(socket);
        });

        test("relative path resolves to a socket named as this relative path", () => {
          const socketPath = "frontend_run/listhen.sock";
          expect(getSocketPath("./frontend_run/listhen.sock")).toEqual(
            "./" + socketPath,
          );
          expect(getSocketPath("frontend_run/listhen.sock")).toEqual(
            socketPath,
          );
        });
      },
    );

    describe.runIf(platform() === "win32")(
      "socket path (on windows systems)",
      () => {
        test("empty ipcSocketName resolves to a 'listhen' named pipe/socket", () => {
          expect(getSocketPath(undefined!)).toEqual("\\\\?\\pipe\\listhen");
          expect(getSocketPath("")).toEqual("\\\\?\\pipe\\listhen");
        });

        test("some string as ipcSocketName resolves to a pipe/socket named as this string", () => {
          expect(getSocketPath("listhen-https")).toEqual(
            "\\\\?\\pipe\\listhen-https",
          );
        });

        test("absolute path (or full pipe path) resolves to the exact same path", () => {
          const pipe = "\\\\?\\pipe\\listhen";
          expect(getSocketPath(pipe)).toEqual(pipe);
        });

        test("relative path resolves to a socket named as this relative path", () => {
          expect(getSocketPath("tmp\\listhen")).toEqual(
            "\\\\?\\pipe\\tmp\\listhen",
          );
        });
      },
    );
  });
});
