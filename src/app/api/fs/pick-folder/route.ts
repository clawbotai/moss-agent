export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { execFile } from "node:child_process";
import { NextResponse, type NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  // Validate request origin to prevent external sites from triggering native dialogs
  const host = request.headers.get("host");
  if (!host || !(host.startsWith("localhost:") || host.startsWith("127.0.0.1:") || host === "[::1]:")) {
    return NextResponse.json({ path: null });
  }

  const platform = process.platform;
  let command: string;
  let args: string[];

  if (platform === "darwin") {
    command = "osascript";
    args = ["-e", 'tell app "Finder" to set folderPath to POSIX path of (choose folder)'];
  } else if (platform === "win32") {
    command = "powershell";
    args = [
      "-NoProfile", "-Command",
      "Add-Type -AssemblyName System.Windows.Forms; $dialog = New-Object System.Windows.Forms.FolderBrowserDialog; $dialog.Description = '选择项目目录'; $dialog.ShowNewFolderButton = $true; if ($dialog.ShowDialog() -eq 'OK') { $dialog.SelectedPath } else { exit 1 }",
    ];
  } else {
    command = "zenity";
    args = ["--file-selection", "--directory", "--title=选择项目目录"];
  }

  return new Promise<NextResponse>((resolve) => {
    execFile(command, args, { timeout: 120000 }, (error, stdout) => {
      if (error || !stdout.trim()) {
        resolve(NextResponse.json({ path: null }));
      } else {
        resolve(NextResponse.json({ path: stdout.trim() }));
      }
    });
  });
}
