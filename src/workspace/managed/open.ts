import { ExtensionContext, commands } from "vscode";

export function activate(context: ExtensionContext) {
    commands.registerCommand("softalks.managedProjects.open", () => {
        console.log("Opening managed projects...");
    });
}