import { execSync } from "child_process";
import { endsWith, asLines, getParents } from "./platform";

export function getRelativeUrl(folders: Set<string>): Map<string, string> {
	const result = new Map<string, string>();
	const candidates = new Set<string>(folders);
	folders.forEach(folder => {
		if (folder.includes("closed-projects")) {
			candidates.delete(folder);
		}
	});
	const svn = getParents(".svn", candidates);
	if (svn.length > 0) {
		const info = execSync(`svn info --show-item relative-url ${svn.join(' ')}`).toString();
		if (svn.length === 1) {
			result.set(svn[0], info.substring(2, info.indexOf("\r\n")));
		} else {
			asLines(info).forEach((line, index) => result.set(svn[index], line.substring(2, line.indexOf(" "))));
		}
	}
	return result;
}