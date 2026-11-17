import assert from "node:assert/strict";
import test from "node:test";
import { ONLINE_ACCESS_TOKEN_STORAGE_KEY, consumeOnlineAccessTokenFragment, readOnlineAccessTokenFragment } from "../src/online-access-token.js";

test("fragment access token is retained only in session storage and can reconnect", () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
  const first = consumeOnlineAccessTokenFragment({ hash: "#access_token=header.payload.signature", storage });
  assert.deepEqual(first, { token: "header.payload.signature", hadAccessTokenFragment: true });
  assert.equal(values.get(ONLINE_ACCESS_TOKEN_STORAGE_KEY), "header.payload.signature");
  assert.deepEqual(consumeOnlineAccessTokenFragment({ hash: "", storage }), { token: "header.payload.signature", hadAccessTokenFragment: false });
});

test("fragment parser ignores missing, empty, and duplicate access tokens", () => {
  assert.equal(readOnlineAccessTokenFragment("#room=local"), null);
  assert.equal(readOnlineAccessTokenFragment("#access_token="), null);
  assert.equal(readOnlineAccessTokenFragment("#access_token=a&access_token=b"), null);
});
