import { execSync } from "child_process";

export function getParents(child: string, candidates: Set<string>): string[] {
	const result: string[] = [];
	if (process.platform === "win32") {
		const drives = new Map<string, string[]>();
		candidates.forEach(candidate => {
			const match = candidate.match(/^([a-zA-Z]):\\(.*)/);
			if (match) {
				const key = match[1];
				const value = match[2];
				let array = drives.get(key);
				if (!array) {
					array = [];
					drives.set(key, array);
				}
				array.push(value);
			}
		});
		for (const[drive, paths] of drives.entries()) {
			result.push(...getWin32Parents(child, drive, paths));
		}
	} else {
		throw new Error("This function can only be run on Windows.");
	}
	return result;
}

function getWin32Parents(child: string, drive: string, candidates: string[]): string[] {
	const options = { cwd: `${drive}:\\` };
	const out = execSync(`cmd /c "for %D in (${candidates.join(' ')}) do @if exist %D\\.svn (echo %D)"`, options).toString();
	const list = out.split("\r\n").map(path => `${drive}:\\${path}`);
	list.pop();
	return list;
}

export function asLines(string: string, finalEmptyLine = false): string[] {
	const lines = string.split(getLineSeparator());
	if (!finalEmptyLine && lines[lines.length - 1] === "") {
		lines.pop();
	}
	return lines;
}

export function getLineSeparator() {
	return process.platform === "win32" ? "\r\n" : "\n";
}

export function endsWith(path: string, ...nodes: string[]) {
	return path.endsWith(nodes.join(process.platform === "win32" ? "\\" : "/"));
}