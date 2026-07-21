import { execFile } from "node:child_process";

function run(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { encoding: "utf-8" }, (error, stdout, stderr) => {
      if (error) {
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve(stdout.trim());
    });
  });
}

function isCancellation(error) {
  const message = `${error?.message || ""}\n${error?.stderr || ""}`;
  return /cancel|canceled|cancelled|user cancelled/i.test(message);
}

async function chooseLocalPath({ kind, platform = process.platform, execute = run }) {
  let command;
  if (platform === "darwin") {
    command = kind === "directory"
      ? {
          file: "osascript",
          args: [
            "-e",
            'set selectedFolder to choose folder with prompt "Choose a folder containing HTML files"',
            "-e",
            "POSIX path of selectedFolder",
          ],
        }
      : {
          file: "osascript",
          args: [
            "-e",
            'set selectedFile to choose file with prompt "Choose an HTML file" of type {"public.html"}',
            "-e",
            "POSIX path of selectedFile",
          ],
        };
  } else if (platform === "win32") {
    const dialogScript = kind === "directory"
      ? "Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description='Choose a folder containing HTML files'; if($d.ShowDialog() -eq 'OK'){[Console]::Write($d.SelectedPath)}"
      : "Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.OpenFileDialog; $d.Filter='HTML files (*.html)|*.html'; if($d.ShowDialog() -eq 'OK'){[Console]::Write($d.FileName)}";
    command = {
      file: "powershell.exe",
      args: ["-NoProfile", "-Command", dialogScript],
    };
  } else {
    command = {
      file: "zenity",
      args: kind === "directory"
        ? ["--file-selection", "--directory", "--title=Choose a folder containing HTML files"]
        : ["--file-selection", "--title=Choose an HTML file", "--file-filter=HTML files | *.html"],
    };
  }

  try {
    return (await execute(command.file, command.args)).trim() || null;
  } catch (error) {
    if (isCancellation(error)) return null;
    const unavailable = new Error("Native file picker is unavailable");
    unavailable.code = "PICKER_UNAVAILABLE";
    unavailable.cause = error;
    throw unavailable;
  }
}

/** Open the operating system's native single-file dialog from the local CLI. */
export function chooseLocalHtmlFile(options = {}) {
  return chooseLocalPath({ ...options, kind: "file" });
}

/** Open the operating system's native directory dialog from the local CLI. */
export function chooseLocalHtmlDirectory(options = {}) {
  return chooseLocalPath({ ...options, kind: "directory" });
}
