import { existsSync, readdir, readdirSync, writeFile } from "fs";
import { join, relative } from "path";
import { commands, ExtensionContext, QuickPickItem, ThemeIcon, Uri, window, workspace } from "vscode";
import { stat } from 'fs';

const qualifier = 'softalks.managedWorkspaces';

export default  {
	activate: activate
}

export function activate(context: ExtensionContext) {
	const disposable = commands.registerCommand(`${qualifier}.createFromFolder`, starting);
	context.subscriptions.push(disposable);
}

class Request {
	base?: string;
	manager?: string;
	managed?: string;
	memory?: any
}

let request: Request;

function settingWorkspaceSimpleName() {
	window.showInputBox({ prompt: 'Simple name of the new workspace configuration file', value: `${request.memory}.code-workspace` }).then(name => {
		if (name) {
			const managed = request.managed as string;
			request.memory = join(request.base as string, managed);
			request.managed = join(managed, name)
			loadingWorkspaceContent();
		}
	});
}

function settingWorkspacePath() {
	let base = request.base as string;
	if (request.managed) {
		base = join(base, request.managed);
	}
	readdir(base, { withFileTypes: true }, (error, files) => {
		if (error) {
			window.showErrorMessage(`Error reading directory: ${error.message}`);
			return;
		}
		const subfolders = files.filter(file => file.isDirectory()).map(subfolder => {
			const subfolderPath = join(base, subfolder.name);
			const subfolderFiles = readdirSync(subfolderPath, { withFileTypes: true });
			const navigable = subfolderFiles.some(file => file.isDirectory());
			return {
				label: subfolder.name,
				buttons: navigable ? [{ iconPath: new ThemeIcon('debug-step-into'), tooltip: 'Go into this folder to continue the selection' }] : []
			};
		});
		const pick = window.createQuickPick<QuickPickItem>();
		pick.items = subfolders;
		pick.placeholder = 'Select the path of the new workspace configuration file';
		pick.onDidTriggerItemButton(event => {
			const selected = event.item.label;
			request.managed = request.managed? join(request.managed, selected) : selected;
			settingWorkspacePath();
		});
		pick.onDidChangeSelection(selection => {
			const selected = selection[0].label;
			request.managed = request.managed? join(request.managed, selected) : selected;
			request.memory = selected;
			settingWorkspaceSimpleName();
		});
		pick.show();
	});
}

function writingWorkspaceFile(content: any) {
	const file = join(request.base as string, request.managed as string);
	if (existsSync(file)) {
		window.showErrorMessage(`The file ${file} already exists`);
	} else {
		writeFile(file, JSON.stringify(content, null, 2), (error) => {
			if (error) {
				window.showErrorMessage(`Error creating workspace configuration file: ${error.message}`);
			} else {
				openingWorkspace(file);
			}
		});
	}
}

function openingWorkspace(file: string) {
	commands.executeCommand('vscode.openFolder', Uri.file(file), false);
}

function loadingWorkspaceContent() {
	const base = request.base as string;
	const manager = join(base, request.manager as string);
	readdir(manager, { withFileTypes: true }, (error, files) => {
		if (error) {
			window.showErrorMessage(`Error reading directory: ${error.message}`);
			return;
		}
		const subfolders = files.filter(file => file.isDirectory()).map(dir => dir.name);
		const path = relative(request.memory, manager);
		const content = {
			folders: subfolders.map(subfolder => ({
				path: `${path}/${subfolder}`
			})),
			settings: {
				"softalks.managedProjects": {
					whiteList: [
						`${path}/*`
					],
					blackList: [

					]
				}
			}
		};
		writingWorkspaceFile(content);
	})
}

function settingWorkspaceManager() {
	let base = request.base as string;
	if (request.manager) {
		base = join(base, request.manager);
	}
	readdir(base, { withFileTypes: true }, (error, files) => {
		if (error) {
			window.showErrorMessage(`Error reading directory: ${error.message}`);
			return;
		}
		const subfolders = files.filter(file => file.isDirectory()).map(subfolder => {
			const subfolderPath = join(base, subfolder.name);
			const subfolderFiles = readdirSync(subfolderPath, { withFileTypes: true });
			const navigable = subfolderFiles.some(file => file.isDirectory());
			return {
				label: subfolder.name,
				buttons: navigable ? [{ iconPath: new ThemeIcon('debug-step-into'), tooltip: 'Go into this folder to continue the selection' }] : []
			};
		});
		const pick = window.createQuickPick<QuickPickItem>();
		pick.items = subfolders;
		pick.placeholder = 'Select the folder that will be used to manage the new workspace';
		pick.onDidTriggerItemButton(event => {
			const selected = event.item.label;
			request.manager = request.manager? join(request.manager, selected) : selected;
			settingWorkspaceManager();
		});
		pick.onDidChangeSelection(selection => {
			const selected = selection[0].label;
			request.manager = request.manager? join(request.manager, selected) : selected;
			settingWorkspacePath();
		});
		pick.show();
	});
}

function settingBasePath() {
	window.showInputBox({ prompt: 'Base path for this and future instances of this request' }).then(path => {
		if (path) {
			stat(path, (error, metadata) => {
				if (error) {
					window.showErrorMessage(`Error accessing path: ${error.message}`);
					return;
				}
				if (!metadata.isDirectory()) {
					window.showErrorMessage(`The path ${path} is not a folder`);
					return;
				}
				request.base = path;
				workspace.getConfiguration('softalks.managedWorkspaces').update('baseFolder', path, true);
				settingWorkspaceManager();
			});
		}
	});
}

function starting() {
	request = new Request();
	request.base = workspace.getConfiguration('softalks.managedWorkspaces').get<string | undefined>('baseFolder');
	if (request.base) {
		settingWorkspaceManager();
	} else {
		settingBasePath();
	}
}