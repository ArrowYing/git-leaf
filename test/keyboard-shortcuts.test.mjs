import assert from "node:assert/strict";
import test from "node:test";

import {
  KEYBOARD_SHORTCUT_GROUPS,
  keyboardShortcutsPlainText,
} from "../public/keyboard-shortcuts.js";

test("keyboard shortcut help keeps the agreed Git Leaf shortcuts", () => {
  const text = keyboardShortcutsPlainText();

  assert.match(text, /Command\+O\s+Open Git Repository/);
  assert.match(text, /Command\+Option\+1\.\.9\s+Switch to Repository 1\.\.9/);
  assert.match(text, /Command\+Option\+Left\s+Previous Repository/);
  assert.match(text, /Command\+Option\+Right\s+Next Repository/);
  assert.match(text, /Command\+W\s+Close Current Tab/);
  assert.match(text, /Command\+F\s+Find in Current Document/);
  assert.match(text, /Command\+1\.\.8\s+Switch to Tab 1\.\.8/);
  assert.match(text, /Command\+9\s+Switch to Last Tab/);
  assert.match(text, /Command\+Shift\+\[\s+Previous Tab/);
  assert.match(text, /Command\+Shift\+\]\s+Next Tab/);
  assert.match(text, /Ctrl\+Shift\+Tab\s+Previous Tab on Windows/);
  assert.match(text, /Ctrl\+Tab\s+Next Tab on Windows/);
  assert.match(text, /Command\+P\s+Preview/);
  assert.match(text, /Command\+S\s+Source/);
  assert.match(text, /Command\+L\s+Live/);
  assert.match(text, /Command\+Shift\+C\s+Copy Document Path/);
  assert.match(text, /Command\+Shift\+L\s+Copy Share Link/);
  assert.match(text, /Command\+Shift\+G\s+Open GitHub Link/);
  assert.match(text, /Command\+Shift\+O\s+Open Source File/);
  assert.match(text, /Command\+Shift\+R\s+Reveal in File Manager/);
  assert.match(text, /Command\+B\s+Toggle Sidebar/);
  assert.match(text, /Command\+Shift\+B\s+Toggle Document Navigation/);
  assert.match(text, /Command\+\[\s+Back/);
  assert.match(text, /Command\+\]\s+Forward/);
  assert.match(text, /Command\+K\s+Focus File Search/);
  assert.match(text, /Command\+Shift\+E\s+Focus File Tree/);
  assert.match(text, /Escape\s+Focus File Tree from Search/);
  assert.match(text, /ArrowUp\/Down\s+Move in File Tree/);
  assert.match(text, /ArrowLeft\/Right\s+Collapse or Expand Folder/);
  assert.match(text, /Enter\s+Open Selected File/);
  assert.match(text, /Command\+,\s+Open Settings/);
  assert.match(text, /Command\+\/\s+Open Keyboard Shortcuts/);
});

test("keyboard shortcut help does not assign a shortcut to closing the repository", () => {
  const flatShortcuts = KEYBOARD_SHORTCUT_GROUPS.flatMap((group) => group.shortcuts);

  assert.equal(
    flatShortcuts.some((shortcut) => shortcut.action === "Close Repository"),
    false,
  );
});
