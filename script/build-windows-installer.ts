#!/usr/bin/env bun
/**
 * Build a Windows installer for the packaged desktop client.
 *
 * Requires Inno Setup (ISCC.exe). Use --dry-run to only generate the .iss file.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = join(import.meta.dir, "..");
const clientDir = join(root, "dist", "qingchen-cut-win32-x64");
const releaseDir = join(root, "dist", "release");
const args = process.argv.slice(2);

function flagValue(name: string): string | undefined {
	const index = args.indexOf(name);
	return index >= 0 ? args[index + 1] : undefined;
}

function escapeInno(value: string): string {
	return value.replaceAll('"', '""');
}

function innoPath(path: string): string {
	return resolve(path).replaceAll("/", "\\");
}

function findIscc(): string | null {
	const fromEnv = process.env["ISCC_PATH"];
	if (fromEnv && existsSync(fromEnv)) return fromEnv;

	const where = spawnSync("where", ["ISCC.exe"], {
		encoding: "utf8",
		windowsHide: true,
	});
	const found = where.stdout
		.split(/\r?\n/)
		.map((line) => line.trim())
		.find((line) => line && existsSync(line));
	if (found) return found;

	const candidates = [
		join(
			process.env["LOCALAPPDATA"] ?? "",
			"Programs",
			"Inno Setup 6",
			"ISCC.exe",
		),
		"C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe",
		"C:\\Program Files\\Inno Setup 6\\ISCC.exe",
	];
	return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

const rawVersion =
	flagValue("--version") ?? process.env["QC_RELEASE_VERSION"] ?? "dev";
const version = rawVersion.replace(/^v/, "") || "dev";
const outputBaseName = `qingchen-cut-${rawVersion}-win32-x64-setup`;
const setupExe = join(releaseDir, `${outputBaseName}.exe`);
const issPath = join(releaseDir, "qingchen-cut-installer.iss");
const dryRun = args.includes("--dry-run");

if (!existsSync(join(clientDir, "QingchenCut.exe"))) {
	throw new Error(
		`Missing packaged client. Run bun run build:desktop-client first: ${clientDir}`,
	);
}

mkdirSync(releaseDir, { recursive: true });

const licenseLine = existsSync(join(root, "LICENSE"))
	? `LicenseFile=${innoPath(join(root, "LICENSE"))}`
	: "";

const iss = `
[Setup]
AppId={{27E02A0D-7D5F-47BD-9E28-0A8E7D49A9B4}
AppName=Qingchen Cut
AppVersion=${escapeInno(version)}
AppPublisher=Qingchen Cloud
AppPublisherURL=https://github.com/qingchencloud/qingchen-cut
AppSupportURL=https://github.com/qingchencloud/qingchen-cut/issues
AppUpdatesURL=https://github.com/qingchencloud/qingchen-cut/releases
DefaultDirName={localappdata}\\Programs\\Qingchen Cut
DefaultGroupName=Qingchen Cut
DisableProgramGroupPage=yes
UninstallDisplayIcon={app}\\QingchenCut.exe
OutputDir=${innoPath(releaseDir)}
OutputBaseFilename=${escapeInno(outputBaseName)}
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
SetupLogging=yes
${licenseLine}

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional shortcuts:"

[Files]
Source: "${innoPath(join(clientDir, "*"))}"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\\Qingchen Cut"; Filename: "{app}\\QingchenCut.exe"
Name: "{autodesktop}\\Qingchen Cut"; Filename: "{app}\\QingchenCut.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\\QingchenCut.exe"; Description: "Launch Qingchen Cut"; Flags: nowait postinstall skipifsilent
`.trimStart();

writeFileSync(issPath, iss, "utf8");

if (!dryRun) {
	const iscc = findIscc();
	if (!iscc) {
		throw new Error("ISCC.exe not found. Install Inno Setup or set ISCC_PATH.");
	}

	const result = spawnSync(iscc, [issPath], {
		cwd: root,
		stdio: "inherit",
		windowsHide: true,
	});
	if (result.status !== 0) {
		throw new Error(`Inno Setup failed (exit ${result.status})`);
	}
	if (!existsSync(setupExe)) {
		throw new Error(`Installer was not created: ${setupExe}`);
	}
}

console.log(
	JSON.stringify(
		{
			ok: true,
			dryRun,
			version,
			iss: issPath,
			setupExe,
		},
		null,
		2,
	),
);
