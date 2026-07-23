import assert from "node:assert/strict";
import test from "node:test";

import {
  adjacentRepository,
  repositoryAfterClose,
  repositoryAtIndex,
} from "../src/repository-navigation.mjs";

const REPOSITORIES = ["/repos/one", "/repos/two", "/repos/three"];

test("repositoryAtIndex resolves stable zero-based repository shortcuts", () => {
  assert.equal(repositoryAtIndex(REPOSITORIES, 0), "/repos/one");
  assert.equal(repositoryAtIndex(REPOSITORIES, 2), "/repos/three");
  assert.equal(repositoryAtIndex(REPOSITORIES, 3), "");
  assert.equal(repositoryAtIndex(REPOSITORIES, -1), "");
});

test("adjacentRepository follows stable order and wraps at both ends", () => {
  assert.equal(adjacentRepository(REPOSITORIES, "/repos/two", -1), "/repos/one");
  assert.equal(adjacentRepository(REPOSITORIES, "/repos/two", 1), "/repos/three");
  assert.equal(adjacentRepository(REPOSITORIES, "/repos/one", -1), "/repos/three");
  assert.equal(adjacentRepository(REPOSITORIES, "/repos/three", 1), "/repos/one");
});

test("adjacentRepository enters a list predictably without an active repository", () => {
  assert.equal(adjacentRepository(REPOSITORIES, "", 1), "/repos/one");
  assert.equal(adjacentRepository(REPOSITORIES, "", -1), "/repos/three");
  assert.equal(adjacentRepository([], "", 1), "");
});

test("repositoryAfterClose selects the next neighbor or falls back to the previous one", () => {
  assert.equal(repositoryAfterClose(REPOSITORIES, "/repos/one"), "/repos/two");
  assert.equal(repositoryAfterClose(REPOSITORIES, "/repos/two"), "/repos/three");
  assert.equal(repositoryAfterClose(REPOSITORIES, "/repos/three"), "/repos/two");
  assert.equal(repositoryAfterClose(["/repos/one"], "/repos/one"), "");
});
