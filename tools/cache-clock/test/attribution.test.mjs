import { test } from "node:test";
import assert from "node:assert/strict";
import { attributeUsage } from "../extension/lib/attribution.mjs";

const NONE = {
  awaiting: false, inFlight: false, pingOwed: false, turnSource: null, promptSinceSend: false, hostReportsUserMessage: false,
};
const PING = { owner: "ping", spendsTypedPrompt: false };
const USER = { owner: "user", spendsTypedPrompt: false };
const USER_SPENDS = { owner: "user", spendsTypedPrompt: true };

// One row per branch of the attribution condition.
const ROWS = [
  ["nothing awaited and no turn source: the user's call", {}, USER],
  ["a ping message owes its record while a ping is awaited: the ping's", { pingOwed: true, awaiting: true }, PING],
  ["the ping's message beats a prompt typed after it", { pingOwed: true, awaiting: true, inFlight: true, hostReportsUserMessage: true, promptSinceSend: true }, PING],
  ["a ping message owed but nothing awaited: the user's call", { pingOwed: true }, USER],
  ["a turn the host says is the ping's: the ping's, awaited or not", { turnSource: "ping" }, PING],
  ["a ping's turn is not taken for a typed prompt's", { turnSource: "ping", awaiting: true, promptSinceSend: true }, PING],
  ["a ping awaited and the turn source unknown: the ping's", { awaiting: true }, PING],
  ["a ping awaited but the host says the turn is the user's: the user's", { awaiting: true, turnSource: "user" }, USER],
  ["a user turn with a typed prompt spends it", { turnSource: "user", promptSinceSend: true }, USER_SPENDS],
  ["a typed prompt and nothing awaited: the user's, and it spends the prompt", { promptSinceSend: true }, USER_SPENDS],
  ["a late reply awaited after a prompt was typed: the user's, spending the prompt", { awaiting: true, promptSinceSend: true }, USER_SPENDS],
  ["in flight on a host that reports user.message: a typed prompt proves nothing, the ping's", { awaiting: true, inFlight: true, hostReportsUserMessage: true, promptSinceSend: true }, PING],
  // Today's behavior, changed by the fix below.
  ["in flight on a host without user.message and a typed prompt: the user's (today)", { awaiting: true, inFlight: true, promptSinceSend: true }, USER_SPENDS],
];

for (const [name, facts, expected] of ROWS) {
  test(`attributeUsage: ${name}`, () => {
    assert.deepEqual(attributeUsage({ ...NONE, ...facts }), expected);
  });
}
