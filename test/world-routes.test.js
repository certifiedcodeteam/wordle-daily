import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_WORLD_PATH,
  PLAYER_PANELS,
  WORLD_MODES,
  buildPlayPath,
  buildPlayerPath,
  legacyWorldDestination,
  parseWorldPath,
  safeWorldDestination,
  worldTransitionKey,
} from "../src/lib/world-routes.js";

test("every game mode has a canonical route", () => {
  for (const mode of WORLD_MODES) {
    const path = `/play/${mode}`;
    assert.equal(buildPlayPath(mode), path);
    assert.deepEqual(parseWorldPath(path), {
      kind: "play",
      mode,
      path,
      requiresAuth: mode !== "daily",
    });
  }
});

test("every player panel has a canonical route", () => {
  for (const panel of PLAYER_PANELS) {
    const path = `/player/${panel}`;
    assert.equal(buildPlayerPath(panel), path);
    assert.deepEqual(parseWorldPath(path), {
      kind: "player",
      panel,
      path,
      requiresAuth: panel !== "settings",
    });
  }
});

test("invalid routes and destinations cannot escape the allowlist", () => {
  for (const path of ["/play", "/play/unknown", "/player", "/player/unknown", "/login", "https://example.com/play/daily", "//example.com"]) {
    assert.equal(parseWorldPath(path), null);
    assert.equal(safeWorldDestination(path), DEFAULT_WORLD_PATH);
  }
  assert.equal(buildPlayPath("unknown"), DEFAULT_WORLD_PATH);
  assert.equal(buildPlayerPath("unknown"), null);
});

test("party invite destinations preserve only a validated room code", () => {
  assert.equal(safeWorldDestination("/play/party?room=abc234"), "/play/party?room=ABC234");
  assert.equal(safeWorldDestination("/play/party?room=ABCI10"), "/play/party");
  assert.equal(safeWorldDestination("/play/party?room=ABC234&next=https://example.com"), "/play/party?room=ABC234");
  assert.equal(safeWorldDestination("//example.com/play/party?room=ABC234"), DEFAULT_WORLD_PATH);
});

test("trailing slashes normalize to canonical paths", () => {
  assert.equal(parseWorldPath("/play/rush/")?.path, "/play/rush");
  assert.equal(parseWorldPath("/player/settings/")?.path, "/player/settings");
});

test("legacy mode queries resolve to canonical routes", () => {
  assert.equal(legacyWorldDestination("?mode=endless"), "/play/endless");
  assert.equal(legacyWorldDestination("?mode=league&source=old-link"), "/play/league");
  assert.equal(legacyWorldDestination("?mode=unknown"), DEFAULT_WORLD_PATH);
  assert.equal(legacyWorldDestination(""), DEFAULT_WORLD_PATH);
});

test("all world destinations share a transition key", () => {
  assert.equal(worldTransitionKey("/play/daily"), "world");
  assert.equal(worldTransitionKey("/player/shop"), "world");
  assert.equal(worldTransitionKey("/login"), "/login");
});
