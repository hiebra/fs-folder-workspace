import { glob } from "glob";
import path, { join, sep } from "path";
import { commands, ExtensionContext, ExtensionMode, ThemeColor, Uri, window, workspace, WorkspaceFolder } from "vscode";
import { lstatSync, mkdirSync } from "fs";
import { getRelativeUrl } from "../../svn";
import { tmpdir } from "os";

export default {
    activate: activate
}

let refreshing = false;
let managed: Set<string>;
let list = workspace.getConfiguration("projects.list");
let included: string[] = workspace.getConfiguration("projects.list").get("white") || [];
let excluded: string[] = workspace.getConfiguration("projects.list").get("black") || [];
const file = workspace.workspaceFile?.fsPath as string;
const base = getContainer(file);
const closed = `${tmpdir()}${sep}closed-projects${sep}`;

export function activate(context: ExtensionContext) {
    commands.registerCommand("projects.open.one", open.one);
    commands.registerCommand("projects.open.many", open.many);
    commands.registerCommand("projects.close.one", close.one);
    commands.registerCommand("projects.close.many", close.many);
    window.registerFileDecorationProvider({
        provideFileDecoration: (uri: Uri) => !uri.fsPath.includes("closed-projects") ? undefined : {
            badge: '🔒',
            tooltip: 'This project has been explicitly closed',
            color: new ThemeColor('disabledForeground')
        }
    });
    workspace.onDidChangeWorkspaceFolders(event => {
        if (refreshing) {
            refreshing = false;
        } else {
            const configuration = workspace.getConfiguration("projects.unmanaged");
            let unmanaged = configuration.get<string[]>("list") || [];
            let removed = event.removed.map(folder => unified(folder.uri.fsPath));
            removed = removed.filter(path => !managed.has(path));
            removed = removed.map(folder => path.relative(base, folder).replaceAll("\\", "/"));
            let added = event.added.map(folder => unified(folder.uri.fsPath));
            added = added.filter(path => !path.includes("closed-projects") && !managed.has(path));
            added = added.map(folder => path.relative(base, folder).replaceAll("\\", "/"));
            added.forEach(folder => unmanaged.push(folder));
            unmanaged = unmanaged.filter(folder => !removed.includes(folder));
            configuration.update("list", unmanaged, false);
        }
    });
    workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration("projects.list")) {
            list = workspace.getConfiguration("projects.list");
            included = list.get("white") || [];
            excluded = list.get("black") || [];
            refresh();
            const configuration = workspace.getConfiguration("projects.unmanaged");
            let unmanaged = configuration.get<string[]>("list") || [];
            unmanaged = unmanaged.filter(folder => !managed.has(folder));
            configuration.update("list", unmanaged, false);
        }
    });
    window.onDidChangeWindowState(event => {
        if (event.focused && context.extensionMode !== ExtensionMode.Development) {
            refresh();
        }
    });
    refresh(true);
    window.setStatusBarMessage("Workspace has been managed", 5000);
}

const open = {
    projects: (projects: Uri[], canPickMany?: boolean) => {
        if (projects) {
            let updated = false;
            for (const selected of projects) {
                let candidate = selected.fsPath;
                if (candidate.includes("closed-projects")) {
                    let absolute = candidate.substring(closed.length);
                    if (absolute.substring(1).startsWith("-drive")) {    
                        absolute = absolute.replace("-drive", ":");
                    }
                    const nodes = absolute.replaceAll("\\", "/").split("/");
                    excluded = excluded.filter(item => {
                        let relative = path.relative(base, nodes.join("/"));
                        if (item === relative.replaceAll("\\", "/")) {
                            updated = true;
                            return false;
                        } else {
                            return true;
                        }
                    });
                }
            }
            if (updated) {
                list.update("black", excluded, false);
            }
        } else {
            select(false, canPickMany as boolean);
        }
    },
    one: (target: Uri, selection: Uri[]) => {
        open.projects(selection, false);
    },
    many: (target: Uri, selection: Uri[]) => {
        open.projects(selection, true);
    },
}

const close = {
    projects: async (selection: Uri[], canPickMany?: boolean) => {
        if (selection) {
            for (const selected of selection) {
                const absolute = selected.fsPath;
                if (absolute.includes("closed-projects")) {
                    continue;
                }
                const relative = path.relative(path.dirname(file), absolute);
                const nodes = relative.replaceAll("\\", "/").split("/");
                excluded.push(nodes.join("/"));
            }
            list.update("black", excluded, false);
        } else {
            select(true, canPickMany as boolean);
        }
    },
    one: (target: Uri, selection: Uri[]) => {
        close.projects(selection, false);
    },
    many: (target: Uri, selection: Uri[]) => {
        close.projects(selection, true);
    },
}

function select(closing: boolean, canPickMany: boolean) {
    let folders = workspace.workspaceFolders as WorkspaceFolder[];
    folders = folders.filter(folder => folder.uri.fsPath.includes("closed-projects") ? !closing : closing);
    if (folders.length === 0) {
        window.showInformationMessage(`There are no ${closing ? "open" : "closed"} projects to ${closing ? "close" : "open"}`);
    } else {
        const uris = new Map<string, Uri>();
        folders.forEach(folder => uris.set(folder.name, folder.uri));
        function picked(selection: Uri[]) {
            if (closing) {
                close.projects(selection);
            } else {
                open.projects(selection);
            }
        }
        const pickable = folders.map(folder => folder.name);
        if (canPickMany) {
            window.showQuickPick(pickable, { canPickMany: true }).then(selection => {
                if (selection) {
                    picked(selection.map(item => uris.get(item)) as Uri[]);
                }
            });
        } else {
            window.showQuickPick(folders.map(item => item.name), { canPickMany: false }).then(selection => {
                if (selection) {
                    picked([uris.get(selection) as Uri]);
                }
            });
        }
    }
}

function refresh(loading = false) {
    window.withProgress({ location: { viewId: "workbench.view.explorer" } }, () => new Promise<void>(refreshed => {
        const model = getModel();
        const view = workspace.workspaceFolders as WorkspaceFolder[];
        /**
         * @param filtered folders
         * @param filter folders
         * @param not in filter
         * @returns the filtered folders that are also in the filter (if not is false) or not in the filter (if not is true)
         */
        function filter(filtered: readonly Folder[], filter: readonly Folder[], not: boolean) {
            return filtered.filter(candidate => {
                const included = filter.some(item => candidate.uri.fsPath === item.uri.fsPath && candidate.name === item.name);
                return not ? !included : included;
            });
        }
        const adding = filter(model, view, true);
        const keeping = filter(view, model, false);
        const deleting = keeping.length < view.length;
        if (adding.length > 0 || deleting) {
            const all = [...keeping, ...adding].sort((a, b) => (a.name as string).localeCompare(b.name as string));
            refreshing = true;
            if (!workspace.updateWorkspaceFolders(0, view.length, ...all)) {
                if (loading) {
                    console.error(`Unable to update the workspace folders. Details...`);
                    console.error(`Unable to update the workspace folders. view.length: ${view.length}`);
                    console.error(`Unable to update the workspace folders. all: ->`);
                    console.error(all);
                    console.error(`Unable to update the workspace folders. End of details`);
                    window.showErrorMessage("This extension could not update the workspace folders for an undetermined reason. Check the console for details");
                } else {
                    commands.executeCommand("workbench.action.reloadWindow");
                }
            }
        }
        refreshed();
    }));
}

type Folder = {
    uri: Uri,
    name: string
}

function getNodes(path: string) {
    return path.replaceAll("\\", "/").split('/');
}

function getContainer(path: string) {
    var nodes = getNodes(path);
    nodes.pop();
    return nodes.join("/");
}

function unified(path: string) {
    path = path.replaceAll("\\", "/");
    if (path.match(/^[A-Z]:/i)) {
        path = path.charAt(0).toLowerCase() + path.slice(1);
    }
    return path;
}

function getModel(): Folder[] {
    const allowed = new Set<string>();
    managed = new Set<string>();
    included.forEach(pattern => {
        var paths = glob.sync(pattern, { 
            cwd: base
        });
        paths.forEach(included => {
            let path = join(base, included);
            if (lstatSync(path).isDirectory()) {
                path = unified(path);
                allowed.add(path);
                managed.add(path);
            }
        });
    });
    const unmanaged = workspace.getConfiguration("projects.unmanaged").get<string[]>("list") || [];
    unmanaged.forEach(folder => {
        folder = join(base, folder);
        if (lstatSync(folder).isDirectory()) {
            allowed.add(unified(folder));
        }
    });
    const denied = new Set<string>();
    excluded.forEach(pattern => {
        var paths = glob.sync(pattern, { cwd: base })
        paths.forEach(excluded => {
            const path = join(base, excluded);
            if (lstatSync(path).isDirectory()) {
                denied.add(unified(path));
            }
        });
    });
    denied.forEach(path => {
        allowed.delete(path);
        if (path.match(/^[A-Z]:/i)) {
            path = path.replace(/^([A-Z]):/i, "$1-drive".toLowerCase());
        }
        const placeholder = `${closed}${path}`;
        mkdirSync(placeholder, { recursive: true });
        allowed.add(placeholder);
    });
    const result: Folder[] = [];
    let branches = getRelativeUrl(allowed);
    allowed.forEach(path => {
        result.push({
            uri: Uri.file(path),
            name: getName(path, branches.get(path))
        })
    });
    return result;
}

const renaming = new Map<RegExp, string>();
const qualifiers = ["desa", "prep", "prod"];

function getName(path: string, branch?: string): string {
    const nodes = getNodes(path);
    let name = nodes.pop() as string;
    for (const [expression, replacement] of renaming.entries()) {
        const match = expression.exec(name);
        if (match) {
            name = replacement.replace(/\$(\d+)/g, (_, index) => match[parseInt(index)]);
            break;
        }
    }
    let qualifier;
    if (qualifiers.length > 0) {
        for (const item of qualifiers) {
            if (nodes.includes(item)) {
                qualifier = item;
                break;
            }
        }
    }
    if (branch && branch.endsWith(name)) {
        branch = branch.substring(0, branch.length - name.length - 1);
    }
    if (qualifier && branch) {
        return `${name} <${qualifier}:${branch}>`;
    } else if (qualifier) {
        return `${name} <${qualifier}>`;
    } else if (branch) {
        return `${name} <${branch}>`;
    } else {
        return name;
    }
}