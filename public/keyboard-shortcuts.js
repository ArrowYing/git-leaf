export const KEYBOARD_SHORTCUT_GROUPS = [
  {
    title: "Repository",
    shortcuts: [
      { keys: "Command+O", action: "Open Git Repository" },
      { keys: "Command+Option+1..9", action: "Switch to Repository 1..9" },
      { keys: "Command+Option+Left", action: "Previous Repository" },
      { keys: "Command+Option+Right", action: "Next Repository" },
    ],
  },
  {
    title: "Documents",
    shortcuts: [
      { keys: "Command+1..8", action: "Switch to Tab 1..8" },
      { keys: "Command+9", action: "Switch to Last Tab" },
      { keys: "Command+Shift+[", action: "Previous Tab" },
      { keys: "Command+Shift+]", action: "Next Tab" },
      { keys: "Ctrl+Shift+Tab", action: "Previous Tab on Windows" },
      { keys: "Ctrl+Tab", action: "Next Tab on Windows" },
      { keys: "Command+W", action: "Close Current Tab" },
      { keys: "Command+F", action: "Find in Current Document" },
      { keys: "Command+Shift+C", action: "Copy Document Path" },
      { keys: "Command+Shift+L", action: "Copy Share Link" },
      { keys: "Command+Shift+G", action: "Open GitHub Link" },
      { keys: "Command+Shift+O", action: "Open Source File" },
      { keys: "Command+Shift+R", action: "Reveal in File Manager" },
      { keys: "Command+Click", action: "Open File in Background Tab" },
      { keys: "Shift+Click", action: "Open File in New Active Tab" },
    ],
  },
  {
    title: "View Modes",
    shortcuts: [
      { keys: "Command+P", action: "Preview" },
      { keys: "Command+S", action: "Source" },
      { keys: "Command+L", action: "Live" },
    ],
  },
  {
    title: "Navigation",
    shortcuts: [
      { keys: "Command+B", action: "Toggle Sidebar" },
      { keys: "Command+Shift+B", action: "Toggle Document Navigation" },
      { keys: "Command+[", action: "Back" },
      { keys: "Command+]", action: "Forward" },
      { keys: "Command+K", action: "Focus File Search" },
      { keys: "Command+Shift+E", action: "Focus File Tree" },
      { keys: "Escape", action: "Focus File Tree from Search" },
      { keys: "ArrowUp/Down", action: "Move in File Tree" },
      { keys: "ArrowLeft/Right", action: "Collapse or Expand Folder" },
      { keys: "Enter", action: "Open Selected File" },
    ],
  },
  {
    title: "Help",
    shortcuts: [
      { keys: "Command+,", action: "Open Settings" },
      { keys: "Command+/", action: "Open Keyboard Shortcuts" },
    ],
  },
];

export function keyboardShortcutsPlainText() {
  const rows = ["Keyboard Shortcuts", ""];
  for (const group of KEYBOARD_SHORTCUT_GROUPS) {
    rows.push(group.title);
    for (const shortcut of group.shortcuts) {
      const gap = " ".repeat(Math.max(2, 20 - shortcut.keys.length));
      rows.push(`${shortcut.keys}${gap}${shortcut.action}`);
    }
    rows.push("");
  }
  rows.push("Git Leaf auto-saves Source and Live edits.");
  return rows.join("\n").trim();
}
