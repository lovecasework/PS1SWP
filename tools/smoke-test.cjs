const { execFile, spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);
const root = path.resolve(__dirname, "..");
const appPort = 4175;
const appUrl = `http://127.0.0.1:${appPort}/?local=1&smoke=1`;

const chromeCandidates = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
];

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  const browsers = chromeCandidates.filter((candidate) => fs.existsSync(candidate));
  if (!browsers.length) throw new Error("Chrome or Edge executable was not found.");

  const server = spawn(process.execPath, [path.join(__dirname, "local-server.cjs"), String(appPort)], {
    cwd: root,
    stdio: "ignore",
  });

  try {
    await waitForHttp(`http://127.0.0.1:${appPort}/`);
    const stdout = await dumpDomWithAvailableBrowser(browsers);

    const checks = {
      smokePass: stdout.includes("SMOKE_PASS"),
      loginTitle: stdout.includes("PS1SWP"),
      applicationGroups: stdout.includes("applicationGroupsBeforeDraw=1") && stdout.includes("applicationGroups=0"),
      applicationsReset: stdout.includes("applications=0") && stdout.includes("applicationsReset=true"),
      ladder: stdout.includes("사다리"),
      ladderZoom: stdout.includes("ladder-tools") && stdout.includes("축소") && stdout.includes("확대"),
      winner: stdout.includes("선정"),
      passwordRequest: stdout.includes("비번 요청"),
      messages: stdout.includes("messages=6"),
      messageUnreadBadge: stdout.includes("unreadBeforeOpen=1") && stdout.includes("unreadAfterOpen=0"),
      files: stdout.includes("files=1"),
      fileSettings: stdout.includes("fileSettings=true"),
      fileWorkflow: stdout.includes("fileWorkflow=true"),
      replyContext: stdout.includes("replyContext=true") && stdout.includes("답장 대상"),
      replies: stdout.includes("replies=1"),
      messageMenu: stdout.includes("쪽지"),
      fileMenu: stdout.includes("파일"),
      excelExport: stdout.includes("download-excel"),
      publishedDraw: stdout.includes("publishedDraws=1"),
      drawMessageImages: stdout.includes("drawMessageImages=3") && stdout.includes("message-draw-attachment"),
      replyForm: stdout.includes("답장 보내기"),
      deleteMessageButtons: (stdout.match(/delete-message/g) || []).length >= 2,
      uniqueChoices: stdout.includes("uniqueChoices=true"),
    };

    if (Object.values(checks).some((value) => !value)) {
      throw new Error(`Smoke checks failed: ${JSON.stringify(checks)}`);
    }

    console.log(JSON.stringify(checks, null, 2));
  } finally {
    server.kill();
  }
}

async function dumpDomWithAvailableBrowser(browsers) {
  const args = [
    "--headless=new",
    "--disable-gpu",
    "--disable-gpu-compositing",
    "--disable-software-rasterizer",
    "--disable-dev-shm-usage",
    "--disable-features=VizDisplayCompositor",
    "--no-sandbox",
    "--no-first-run",
    "--virtual-time-budget=12000",
    `--user-data-dir=${path.join(root, ".chrome-smoke")}`,
    "--dump-dom",
    appUrl,
  ];

  const errors = [];
  for (const browserPath of browsers) {
    try {
      const { stdout } = await execFileAsync(browserPath, args, {
        cwd: root,
        timeout: 30000,
        maxBuffer: 8 * 1024 * 1024,
      });
      return stdout;
    } catch (error) {
      errors.push(`${browserPath}: ${error.message}`);
    }
  }

  throw new Error(errors.join("\n"));
}

async function waitForHttp(url) {
  for (let index = 0; index < 80; index += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Wait for the server process.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${url}`);
}
