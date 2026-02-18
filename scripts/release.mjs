import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const validReleaseTypes = new Set(["patch", "minor", "major"]);
const args = process.argv.slice(2);
const releaseType = args.find((arg) => !arg.startsWith("--")) ?? "patch";
const dryRun = args.includes("--dry-run");

if (!validReleaseTypes.has(releaseType)) {
    console.error(
        `Invalid release type: ${releaseType}. Use one of: patch, minor, major.`
    );
    process.exit(1);
}

const packageJsonPath = resolve(process.cwd(), "package.json");

function readVersion() {
    return JSON.parse(readFileSync(packageJsonPath, "utf8")).version;
}

function run(command, options = {}) {
    if (dryRun) {
        console.log(`[dry-run] ${command}`);
        return "";
    }

    if (options.capture) {
        return execSync(command, {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
        })
            .toString()
            .trim();
    }

    execSync(command, { stdio: "inherit" });
    return "";
}

try {
    const gitStatus = execSync("git status --porcelain", {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
    })
        .toString()
        .trim();

    if (gitStatus) {
        console.error("Release aborted: working tree is not clean.");
        console.error("Commit or stash your changes first.");
        process.exit(1);
    }

    const currentVersion = readVersion();
    console.log(`Current version: ${currentVersion}`);

    if (dryRun) {
        console.log("Dry run mode enabled. No files will be changed.");
    } else {
        const npmUser = run("npm whoami", { capture: true });
        console.log(`Authenticated npm user: ${npmUser}`);
    }

    run(`npm version ${releaseType}`);

    if (!dryRun) {
        const nextVersion = readVersion();
        console.log(`Version bumped to: ${nextVersion}`);
    }

    run("npm publish --access public");

    if (dryRun) {
        console.log("Dry run completed.");
    } else {
        console.log("Release completed successfully.");
    }
} catch (error) {
    const message =
        error instanceof Error && error.message ? error.message : String(error);
    console.error("Release failed.");
    console.error(message);
    process.exit(1);
}
