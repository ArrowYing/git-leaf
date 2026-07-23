import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import {
  bootstrapWindowsApp,
  confirmWindowsAppLaunch,
  persistWindowsInstalledVersion,
  shouldBootstrapWindowsApp,
  windowsAppBootstrapPlan,
  windowsBootstrapNeedsExclusiveLock,
  windowsInstallConfirmationPath,
  windowsInstalledAppPaths,
  waitForWindowsRelaunchConfirmation,
} from "../src/windows-app-install.mjs";

test("Windows Git Leaf uses a stable per-user executable path", () => {
  assert.deepEqual(
    windowsInstalledAppPaths({
      localAppData: "C:\\Users\\mango\\AppData\\Local",
    }),
    {
      installRoot: "C:\\Users\\mango\\AppData\\Local\\GitLeaf\\app",
      executable: "C:\\Users\\mango\\AppData\\Local\\GitLeaf\\app\\Git Leaf.exe",
      stateFile: "C:\\Users\\mango\\AppData\\Local\\GitLeaf\\install-state.json",
      shortcut: "C:\\Users\\mango\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Git Leaf.lnk",
    },
  );
});

test("packaged Windows apps bootstrap unless already running from the stable path", () => {
  const options = {
    platform: "win32",
    isPackaged: true,
    localAppData: "C:\\Users\\mango\\AppData\\Local",
  };

  assert.equal(shouldBootstrapWindowsApp({
    ...options,
    execPath: "D:\\Downloads\\Git Leaf-win32-x64\\Git Leaf.exe",
  }), true);
  assert.equal(shouldBootstrapWindowsApp({
    ...options,
    execPath: "C:\\Users\\mango\\AppData\\Local\\GitLeaf\\app\\Git Leaf.exe",
  }), false);
  assert.equal(shouldBootstrapWindowsApp({
    ...options,
    execPath: options.execPath,
    portable: true,
  }), false);
  assert.equal(shouldBootstrapWindowsApp({
    ...options,
    platform: "darwin",
    execPath: "/Applications/Git Leaf.app/Contents/MacOS/Git Leaf",
  }), false);
});

test("Windows bootstrap plan distinguishes first install from an update", () => {
  const options = {
    platform: "win32",
    isPackaged: true,
    execPath: "D:\\Downloads\\Git Leaf-win32-x64\\Git Leaf.exe",
    localAppData: "C:\\Users\\mango\\AppData\\Local",
    processId: 42,
    version: "1.4.0",
  };
  assert.equal(windowsAppBootstrapPlan({
    ...options,
    pathExists: () => false,
  }).status, "install");
  assert.equal(windowsAppBootstrapPlan({
    ...options,
    pathExists: () => true,
  }).status, "update");
  assert.equal(windowsAppBootstrapPlan({
    ...options,
    pathExists: () => true,
    readInstalledVersion: () => "1.4.0",
  }).status, "redirect");
  assert.equal(windowsAppBootstrapPlan({
    ...options,
    version: "1.3.0",
    pathExists: () => true,
    readInstalledVersion: () => "1.4.0",
  }).status, "outdated");
});

test("manual Windows installs require the app lock before touching the fixed directory", () => {
  assert.equal(windowsBootstrapNeedsExclusiveLock({ status: "install" }), true);
  assert.equal(windowsBootstrapNeedsExclusiveLock({ status: "update" }), true);
  assert.equal(windowsBootstrapNeedsExclusiveLock({ status: "update", waitForPid: 4321 }), false);
  assert.equal(windowsBootstrapNeedsExclusiveLock({ status: "redirect" }), false);
  assert.equal(windowsBootstrapNeedsExclusiveLock({ status: "outdated" }), false);
  assert.equal(windowsBootstrapNeedsExclusiveLock({ status: "current" }), false);
});

test("Windows launch confirmation accepts only installer-owned LOCALAPPDATA files", async () => {
  const localAppData = "C:\\Users\\mango\\AppData\\Local";
  const valid = "C:\\Users\\mango\\AppData\\Local\\GitLeaf\\.launch-confirm-42.json";
  const written = [];
  assert.equal(windowsInstallConfirmationPath([
    `--git-leaf-install-confirm=${valid}`,
  ], { localAppData }), valid);
  assert.equal(windowsInstallConfirmationPath([
    "--git-leaf-install-confirm=C:\\Users\\mango\\Desktop\\forged.json",
  ], { localAppData }), "");
  assert.equal(await confirmWindowsAppLaunch({
    args: [`--git-leaf-install-confirm=${valid}`],
    localAppData,
    async writeTextFile(filePath, contents) {
      written.push({ filePath, contents });
    },
  }), true);
  assert.equal(written[0].filePath, valid);
  assert.match(written[0].contents, /"confirmedAt"/);
});

test("Windows installed version state is replaced atomically", async () => {
  const operations = [];
  await persistWindowsInstalledVersion({
    stateFile: "C:\\Users\\mango\\AppData\\Local\\GitLeaf\\install-state.json",
    processId: 42,
    version: "1.7.1",
  }, {
    async writeTextFile(filePath, contents) {
      operations.push(["write", filePath, contents]);
    },
    async moveStateFile(source, destination) {
      operations.push(["move", source, destination]);
    },
    async removePath(filePath) {
      operations.push(["remove", filePath]);
    },
  });

  const tempFile = "C:\\Users\\mango\\AppData\\Local\\GitLeaf\\install-state.json.installing-42";
  assert.equal(operations[0][0], "write");
  assert.equal(operations[0][1], tempFile);
  assert.match(operations[0][2], /"version": "1\.7\.1"/);
  assert.deepEqual(operations[1], [
    "move",
    tempFile,
    "C:\\Users\\mango\\AppData\\Local\\GitLeaf\\install-state.json",
  ]);
  assert.deepEqual(operations[2], ["remove", tempFile]);
});

test("Windows launch confirmation fails immediately when the new executable cannot spawn", async () => {
  const child = new EventEmitter();
  child.pid = 9003;
  await assert.rejects(
    waitForWindowsRelaunchConfirmation("C:\\confirm.json", {
      child,
      pathExists: () => false,
      now: () => 0,
      async wait() {
        assert.ok(child.listenerCount("error") > 0);
        child.emit("error", Object.assign(new Error("blocked by security software"), {
          code: "EACCES",
        }));
      },
    }),
    /blocked by security software/,
  );
});

test("Windows update handoff waits for the old process without forwarding internal arguments", async () => {
  const plan = windowsAppBootstrapPlan({
    platform: "win32",
    isPackaged: true,
    execPath: "D:\\Updates\\Git Leaf-win32-x64\\Git Leaf.exe",
    args: [
      "--git-leaf-update-wait-pid=4321",
      "git-leaf://open?repo=owner%2Frepo&path=README.md",
    ],
    localAppData: "C:\\Users\\mango\\AppData\\Local",
    version: "1.7.0",
    pathExists: () => true,
    readInstalledVersion: () => "1.6.0",
  });
  const events = [];
  const existing = new Set([plan.installRoot]);

  assert.equal(plan.waitForPid, 4321);
  assert.deepEqual(plan.args, ["git-leaf://open?repo=owner%2Frepo&path=README.md"]);
  await bootstrapWindowsApp({
    plan,
    pathExists: (value) => existing.has(value),
    async waitForProcessExit(processId) {
      events.push(["wait-process", processId]);
    },
    async makeDirectory() {},
    async removePath(value) {
      existing.delete(value);
    },
    async copyDirectory(_source, destination) {
      existing.add(destination);
    },
    async movePath(source, destination) {
      existing.delete(source);
      existing.add(destination);
    },
    async writeTextFile() {},
    async moveStateFile() {},
    async onProgress(state) {
      events.push(["progress", state.phase]);
    },
    async wait() {},
    async waitForRelaunchConfirmation() {},
    spawnProcess() {
      return { unref() {} };
    },
  });

  assert.deepEqual(events.slice(0, 3), [
    ["progress", "waiting"],
    ["wait-process", 4321],
    ["progress", "copying"],
  ]);
});

test("Windows bootstrap reports visible progress before relaunching", async () => {
  const existing = new Set([
    "C:\\Users\\mango\\AppData\\Local\\GitLeaf\\app",
  ]);
  const moves = [];
  const copies = [];
  const removals = [];
  const launches = [];
  const events = [];
  const originalNoAsar = process.noAsar;

  const plan = windowsAppBootstrapPlan({
    platform: "win32",
    isPackaged: true,
    execPath: "D:\\Downloads\\Git Leaf-win32-x64\\Git Leaf.exe",
    args: ["git-leaf://open?repo=C%3A%5CProjects%5Cdocs&path=README.md"],
    localAppData: "C:\\Users\\mango\\AppData\\Local",
    processId: 42,
    version: "1.4.0",
    pathExists(value) {
      return existing.has(value);
    },
  });

  const result = await bootstrapWindowsApp({
    plan,
    async makeDirectory() {},
    pathExists(value) {
      return existing.has(value);
    },
    async copyDirectory(source, destination, options) {
      assert.equal(process.noAsar, true, "Electron ASAR interception must be disabled while copying app.asar");
      copies.push({ source, destination, options });
      existing.add(destination);
    },
    async movePath(source, destination) {
      moves.push([source, destination]);
      existing.delete(source);
      existing.add(destination);
    },
    async removePath(value, options) {
      removals.push({ value, options });
      existing.delete(value);
    },
    spawnProcess(executable, args, options) {
      launches.push({ executable, args, options });
      return { unref() {} };
    },
    async writeTextFile(filePath, contents) {
      assert.equal(filePath, "C:\\Users\\mango\\AppData\\Local\\GitLeaf\\install-state.json.installing-42");
      assert.match(contents, /"version": "1\.4\.0"/);
    },
    async moveStateFile(source, destination) {
      assert.equal(source, "C:\\Users\\mango\\AppData\\Local\\GitLeaf\\install-state.json.installing-42");
      assert.equal(destination, "C:\\Users\\mango\\AppData\\Local\\GitLeaf\\install-state.json");
    },
    async onProgress(state) {
      events.push(["progress", state]);
    },
    async wait(milliseconds) {
      events.push(["wait", milliseconds]);
    },
    async waitForRelaunchConfirmation(confirmFile) {
      assert.equal(confirmFile, plan.confirmFile);
      assert.equal(existing.has(plan.installRoot), true);
      assert.equal(existing.has(plan.previousRoot), true);
      events.push(["confirm", confirmFile]);
    },
  });

  assert.deepEqual(result, {
    status: "relaunch",
    executable: "C:\\Users\\mango\\AppData\\Local\\GitLeaf\\app\\Git Leaf.exe",
  });
  assert.deepEqual(copies, [{
    source: "D:\\Downloads\\Git Leaf-win32-x64",
    destination: "C:\\Users\\mango\\AppData\\Local\\GitLeaf\\.installing-42",
    options: { recursive: true },
  }]);
  assert.deepEqual(moves, [
    [
      "C:\\Users\\mango\\AppData\\Local\\GitLeaf\\app",
      "C:\\Users\\mango\\AppData\\Local\\GitLeaf\\.previous-42",
    ],
    [
      "C:\\Users\\mango\\AppData\\Local\\GitLeaf\\.installing-42",
      "C:\\Users\\mango\\AppData\\Local\\GitLeaf\\app",
    ],
  ]);
  assert.equal(removals.at(-1).value, "C:\\Users\\mango\\AppData\\Local\\GitLeaf\\.previous-42");
  assert.equal(launches[0].executable, result.executable);
  assert.deepEqual(launches[0].args, [
    `--git-leaf-install-confirm=${plan.confirmFile}`,
    "git-leaf://open?repo=C%3A%5CProjects%5Cdocs&path=README.md",
  ]);
  assert.deepEqual(events.map(([kind, value]) => [
    kind,
    kind === "progress" ? value.phase : value,
  ]), [
    ["progress", "copying"],
    ["progress", "switching"],
    ["progress", "starting"],
    ["confirm", plan.confirmFile],
    ["progress", "complete"],
    ["wait", 2_000],
  ]);
  assert.equal(events[4][1].percent, 100);
  assert.equal(events[4][1].title, "版本更新已完成");
  assert.match(events[4][1].message, /已启动更新后的 Git Leaf 1\.4\.0/);
  assert.match(events[4][1].detail, /以后请从开始菜单启动 Git Leaf/);
  assert.match(events[4][1].detail, /当前和旧版解压目录均可删除/);
  assert.equal(process.noAsar, originalNoAsar, "ASAR interception state must be restored after copying");
});

test("Windows update restores the fixed app even when rename rollback also fails", async () => {
  const plan = windowsAppBootstrapPlan({
    platform: "win32",
    isPackaged: true,
    execPath: "D:\\Downloads\\Git Leaf-win32-x64\\Git Leaf.exe",
    localAppData: "C:\\Users\\mango\\AppData\\Local",
    processId: 700,
    version: "1.7.1",
    pathExists: () => true,
    readInstalledVersion: () => "1.6.0",
  });
  const existing = new Set([plan.installRoot]);
  let moveCount = 0;

  await assert.rejects(
    bootstrapWindowsApp({
      plan,
      pathExists: (value) => existing.has(value),
      async makeDirectory() {},
      async removePath(value) {
        existing.delete(value);
      },
      async copyDirectory(source, destination) {
        assert.equal(process.noAsar, true);
        if (!existing.has(source) && source !== plan.sourceRoot) {
          throw new Error(`missing copy source: ${source}`);
        }
        existing.add(destination);
      },
      async movePath(source, destination) {
        moveCount += 1;
        if (moveCount === 2) {
          throw Object.assign(new Error("switch failed"), { code: "EPERM" });
        }
        if (moveCount === 3) {
          throw Object.assign(new Error("rename rollback failed"), { code: "EPERM" });
        }
        existing.delete(source);
        existing.add(destination);
      },
      async onProgress() {},
      async wait() {},
      spawnProcess() {
        assert.fail("a failed switch must not relaunch the app");
      },
    }),
    /switch failed/,
  );

  assert.equal(existing.has(plan.installRoot), true);
  assert.equal(existing.has(plan.previousRoot), true);
  assert.equal(existing.has(plan.stagingRoot), false);
});

test("Windows update rolls back when the relaunched app never confirms startup", async () => {
  const plan = windowsAppBootstrapPlan({
    platform: "win32",
    isPackaged: true,
    execPath: "D:\\Downloads\\Git Leaf-win32-x64\\Git Leaf.exe",
    localAppData: "C:\\Users\\mango\\AppData\\Local",
    processId: 701,
    version: "1.7.1",
    pathExists: () => true,
    readInstalledVersion: () => "1.6.0",
  });
  const existing = new Set([plan.installRoot]);
  let stopped = false;
  let wroteVersion = false;

  await assert.rejects(
    bootstrapWindowsApp({
      plan,
      pathExists: (value) => existing.has(value),
      async makeDirectory() {},
      async removePath(value) {
        existing.delete(value);
      },
      async copyDirectory(_source, destination) {
        existing.add(destination);
      },
      async movePath(source, destination) {
        existing.delete(source);
        existing.add(destination);
      },
      async waitForRelaunchConfirmation() {
        throw Object.assign(new Error("launch confirmation timed out"), {
          code: "WINDOWS_INSTALL_LAUNCH_TIMEOUT",
        });
      },
      async stopRelaunchedApp() {
        stopped = true;
      },
      async writeTextFile() {
        wroteVersion = true;
      },
      async onProgress() {},
      async wait() {},
      spawnProcess() {
        return { pid: 9001, unref() {} };
      },
    }),
    /launch confirmation timed out/,
  );

  assert.equal(stopped, true);
  assert.equal(wroteVersion, false);
  assert.equal(existing.has(plan.installRoot), true);
  assert.equal(existing.has(plan.previousRoot), false);
  assert.equal(existing.has(plan.stagingRoot), false);
});

test("Windows update preserves the backup when a failed new process still locks its files", async () => {
  const plan = windowsAppBootstrapPlan({
    platform: "win32",
    isPackaged: true,
    execPath: "D:\\Downloads\\Git Leaf-win32-x64\\Git Leaf.exe",
    localAppData: "C:\\Users\\mango\\AppData\\Local",
    processId: 702,
    version: "1.7.1",
    pathExists: () => true,
    readInstalledVersion: () => "1.6.0",
  });
  const existing = new Set([plan.installRoot]);

  await assert.rejects(
    bootstrapWindowsApp({
      plan,
      pathExists: (value) => existing.has(value),
      async makeDirectory() {},
      async removePath(value) {
        if (value === plan.installRoot) {
          throw Object.assign(new Error("new process still holds files"), { code: "EPERM" });
        }
        existing.delete(value);
      },
      async copyDirectory(_source, destination) {
        existing.add(destination);
      },
      async movePath(source, destination) {
        existing.delete(source);
        existing.add(destination);
      },
      async waitForRelaunchConfirmation() {
        throw new Error("launch confirmation timed out");
      },
      async stopRelaunchedApp() {},
      async onProgress() {},
      async wait() {},
      spawnProcess() {
        return { pid: 9002, unref() {} };
      },
    }),
    (error) => error?.code === "WINDOWS_INSTALL_RECOVERY_REQUIRED"
      && String(error.message).includes(plan.previousRoot),
  );

  assert.equal(existing.has(plan.previousRoot), true);
});

test("same-version packages redirect to the stable app without copying", async () => {
  const progress = [];
  const launches = [];
  const plan = windowsAppBootstrapPlan({
    platform: "win32",
    isPackaged: true,
    execPath: "D:\\Downloads\\Git Leaf-win32-x64\\Git Leaf.exe",
    localAppData: "C:\\Users\\mango\\AppData\\Local",
    version: "1.4.0",
    pathExists: () => true,
    readInstalledVersion: () => "1.4.0",
  });

  const result = await bootstrapWindowsApp({
    plan,
    async copyDirectory() {
      assert.fail("same-version redirect must not copy files");
    },
    async onProgress(state) {
      progress.push(state);
    },
    async wait() {},
    spawnProcess(executable, args, options) {
      launches.push({ executable, args, options });
      return { unref() {} };
    },
  });

  assert.equal(result.status, "relaunch");
  assert.equal(progress.length, 1);
  assert.equal(progress[0].phase, "redirect");
  assert.equal(progress[0].percent, 100);
  assert.match(progress[0].title, /1\.4\.0 已安装/);
  assert.match(progress[0].message, /正在从固定位置启动/);
  assert.match(progress[0].detail, /以后请从开始菜单启动 Git Leaf/);
  assert.match(progress[0].detail, /当前和旧版解压目录均可删除/);
  assert.equal(launches[0].executable, plan.executable);
});

test("older packages refuse to overwrite and launch the newer stable app", async () => {
  const progress = [];
  const launches = [];
  const plan = windowsAppBootstrapPlan({
    platform: "win32",
    isPackaged: true,
    execPath: "D:\\Downloads\\GitLeaf-1.3.0\\Git Leaf.exe",
    localAppData: "C:\\Users\\mango\\AppData\\Local",
    version: "1.3.0",
    pathExists: () => true,
    readInstalledVersion: () => "1.4.0",
  });

  const result = await bootstrapWindowsApp({
    plan,
    async copyDirectory() {
      assert.fail("an older package must not copy or downgrade files");
    },
    async onProgress(state) {
      progress.push(state);
    },
    async wait() {},
    spawnProcess(executable, args, options) {
      launches.push({ executable, args, options });
      return { unref() {} };
    },
  });

  assert.equal(plan.status, "outdated");
  assert.equal(result.status, "relaunch");
  assert.equal(progress[0].phase, "outdated");
  assert.match(progress[0].title, /这是旧版本的 Git Leaf 1\.3\.0/);
  assert.match(progress[0].message, /已安装更新的 Git Leaf 1\.4\.0/);
  assert.match(progress[0].message, /不会使用旧版本覆盖/);
  assert.match(progress[0].detail, /旧版解压目录可以删除/);
  assert.match(progress[0].detail, /从开始菜单启动 Git Leaf/);
  assert.equal(launches[0].executable, plan.executable);
});
