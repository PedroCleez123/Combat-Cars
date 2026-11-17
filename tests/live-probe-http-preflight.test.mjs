import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { inspectRocketSimHostListeners } from "../tools/host-listener-status.mjs";
import { inspectLocalHttpEndpoint } from "../tools/live-probe-http-preflight.mjs";

test("live probe preflight distinguishes a responding local listener", async () => {
  const requestImpl = (_options, callback) => {
    const probe = new EventEmitter();
    probe.end = () => process.nextTick(() => {
      const response = new EventEmitter();
      response.statusCode = 200;
      response.headers = { "content-type": "text/plain" };
      response.resume = () => {};
      callback(response);
    });
    return probe;
  };
  const report = await inspectLocalHttpEndpoint({ port: 5298, requestImpl });
  assert.deepEqual(report, {
    host: "127.0.0.1",
    port: 5298,
    reachable: true,
    statusCode: 200,
    contentType: "text/plain",
  });
});

test("live probe preflight reports a missing listener without throwing", async () => {
  const requestImpl = () => {
    const probe = new EventEmitter();
    probe.end = () => process.nextTick(() => probe.emit("error", Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" })));
    return probe;
  };
  const report = await inspectLocalHttpEndpoint({ port: 5298, timeoutMs: 500, requestImpl });
  assert.equal(report.reachable, false);
  assert.equal(report.errorCode, "ECONNREFUSED");
  assert.equal(report.port, 5298);
});

test("host listener status reports both expected servers without opening a WebSocket", async () => {
  const seenPorts = [];
  const report = await inspectRocketSimHostListeners({
    combatPort: 5300,
    practicePort: 5298,
    inspectEndpoint: async ({ port }) => {
      seenPorts.push(port);
      return { host: "127.0.0.1", port, reachable: true, statusCode: 200, contentType: "text/html" };
    },
  });
  assert.deepEqual(seenPorts, [5300, 5298]);
  assert.equal(report.status, "ready");
  assert.deepEqual(report.hosts.map(host => host.status), ["ready", "ready"]);
});

test("host listener status keeps a missing listener distinct from a game-session failure", async () => {
  const report = await inspectRocketSimHostListeners({
    combatPort: 5300,
    practicePort: 5298,
    inspectEndpoint: async ({ port }) => port === 5300
      ? { host: "127.0.0.1", port, reachable: false, errorCode: "ECONNREFUSED", detail: "connect ECONNREFUSED" }
      : { host: "127.0.0.1", port, reachable: true, statusCode: 200, contentType: "text/html" },
  });
  assert.equal(report.status, "unavailable");
  assert.equal(report.hosts[0].status, "unavailable");
  assert.equal(report.hosts[0].httpPreflight.errorCode, "ECONNREFUSED");
  assert.equal(report.hosts[1].status, "ready");
});
