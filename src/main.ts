import { ExtensionContext } from "vscode";
import create from "./workspace/managed/create";
import refresh from "./workspace/managed/refresh";

export function activate(context: ExtensionContext) {
	create.activate(context);
	refresh.activate(context);
}