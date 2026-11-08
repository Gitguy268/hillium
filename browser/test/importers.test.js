import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { readChromiumBookmarks, readPlaces } from "../main/importers.js";

test("Chromium bookmarks keep their folders; the bar's own name is left out", () => {
  const json = {
    roots: {
      bookmark_bar: { name: "Bookmarks bar", type: "folder", children: [
        { type: "url", name: "Zen", url: "https://zen-browser.app/" },
        { type: "folder", name: "Reading", children: [{ type: "url", name: "Tor", url: "https://www.torproject.org/" }, { type: "url", name: "Bad", url: "javascript:void 0" }] },
      ] },
      other: { name: "Other bookmarks", type: "folder", children: [{ type: "url", name: "Brave", url: "https://brave.com/" }] },
      sync_transaction_version: "1",
    },
  };
  assert.deepEqual(readChromiumBookmarks(json), [
    { title: "Zen", url: "https://zen-browser.app/", folder: "" },
    { title: "Tor", url: "https://www.torproject.org/", folder: "Reading" },
    { title: "Brave", url: "https://brave.com/", folder: "Other bookmarks" },
  ]);
});

test("Firefox places.sqlite: bookmarks with folders, tags skipped", () => {
  const dir = mkdtempSync(join(tmpdir(), "hillium-places-"));
  try {
    const file = join(dir, "places.sqlite");
    const db = new DatabaseSync(file);
    db.exec(`CREATE TABLE moz_places (id INTEGER PRIMARY KEY, url TEXT, title TEXT);
      CREATE TABLE moz_bookmarks (id INTEGER PRIMARY KEY, type INTEGER, fk INTEGER, parent INTEGER, title TEXT, guid TEXT);
      INSERT INTO moz_places VALUES (1, 'https://www.mozilla.org/', 'Mozilla'), (2, 'https://www.waterfox.net/', 'Waterfox'), (3, 'https://tagged.example/', 'x');
      INSERT INTO moz_bookmarks VALUES (1, 2, NULL, 0, '', 'root________'), (2, 2, NULL, 1, 'menu', 'menu________'),
        (3, 2, NULL, 1, 'toolbar', 'toolbar_____'), (4, 2, NULL, 1, 'tags', 'tags________'),
        (5, 2, NULL, 3, 'Browsers', 'f1'), (6, 1, 1, 2, 'Mozilla', 'b1'), (7, 1, 2, 5, 'Waterfox', 'b2'),
        (8, 2, NULL, 4, 'sometag', 't1'), (9, 1, 3, 8, NULL, 'b3');`);
    db.close();
    assert.deepEqual(readPlaces(file), [
      { title: "Mozilla", url: "https://www.mozilla.org/", folder: "" },
      { title: "Waterfox", url: "https://www.waterfox.net/", folder: "Browsers" },
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
