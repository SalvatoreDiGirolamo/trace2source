// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { POINT_CONVERSION_COMPRESSED } from 'constants';


const trace_regex = "[ ]+[0-9]+[ ]+([0-9]+)[ ]+(1c[0-9a-f]+).+";

class SourceCodeLine {
	path:string;
	line:number;
	cycles:number;
	pc:string;

	constructor(txt:string){
		let matches = txt.match(trace_regex);
		if (matches===null || matches.length<1) {return; }

		let cycles=matches[1];
		let pc=matches[2];
	}
}


// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// create a decorator type that we use to decorate large numbers
	const source_code_line = vscode.window.createTextEditorDecorationType({
		cursor: 'crosshair',
		backgroundColor: '#FF000055',
	});

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "trace2source" is now active!');

	if ( vscode.window.activeTextEditor === undefined){
		vscode.window.showErrorMessage("Need to focus on the trace window before executing this command!");
		return;
	}

	if (vscode.workspace.workspaceFolders === undefined){
		vscode.window.showErrorMessage("Need to have a workspace open!");
		return;
	}

	let trace_editor = (<vscode.TextEditor>vscode.window.activeTextEditor);
	let trace_document = (<vscode.TextEditor>vscode.window.activeTextEditor).document;
	let binfile_uri = "";
	let source_editor:vscode.TextEditor;

	let wsname = (<vscode.WorkspaceFolder[]>vscode.workspace.workspaceFolders)[0].name;	
	let wspath = (<vscode.WorkspaceFolder[]>vscode.workspace.workspaceFolders)[0].uri.fsPath;	

	/*vscode.workspace.openTextDocument().then(doc => {
		vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside).then(editor => {
			source_editor = editor;
		});
	});*/

	const open_options: vscode.OpenDialogOptions = {
		canSelectMany: false,
		canSelectFolders: false,
		filters: { 'All files': ['*']}
	};
	
	vscode.window.showOpenDialog(open_options).then(fileUri => {
		if (fileUri && fileUri[0]) {
			binfile_uri = fileUri[0].fsPath;
		}
	});

	vscode.window.onDidChangeTextEditorVisibleRanges(changeEvent => {

		if (changeEvent.textEditor.document !== trace_document) {return;}

		changeEvent.visibleRanges.forEach( range => {
			console.log(range);
		});

	});

	vscode.window.onDidChangeTextEditorSelection(changeEvent => {

		if (vscode.window.activeTextEditor === undefined || (<vscode.TextEditor>vscode.window.activeTextEditor).document !== trace_document) { return; }

		let sel = changeEvent.textEditor.selection;
		if (!sel.isSingleLine) {return;}
		let line_num = sel.start.line;
		let line_txt = changeEvent.textEditor.document.lineAt(sel.start.line).text;

		let matches = line_txt.match("[ ]+[0-9]+[ ]+([0-9]+)[ ]+(1c[0-9a-f]+).+");
		if (matches===null || matches.length<1) {return; }

		let cycles=matches[1];
		let pc=matches[2];

		console.log(cycles);
		console.log(pc);


		const cp = require("child_process");

		
		cp.exec("addr2line -e " + binfile_uri + " " + pc.toString(), (error: string, stdout: string, stderr: any) => {
			if (error) {
				console.error("exec error: " + error);
			}
			let coords = stdout.split(":");

			if (coords[0].indexOf(wsname) >= 0) {
				let filename = coords[0];
				let line = parseInt(coords[1]);
	
				let source_file = coords[0].substring(filename.indexOf(wsname) + wsname.length + 1);
				let source_uri = vscode.Uri.parse("file://" + wspath + "/" + source_file);
				console.log("opening: " + source_uri.fsPath);
				console.log("wspath: " + wspath);
				console.log("line: " + line);
				vscode.workspace.openTextDocument(source_uri).then(doc => { 
					vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside, true).then( source_editor => {
						source_editor.selection = new vscode.Selection(line, 0, line, 0);
						let decs:vscode.DecorationOptions[] = [];
						source_editor.revealRange(source_editor.selection, vscode.TextEditorRevealType.InCenter);
						let dec = {range: source_editor.document.lineAt(line).range};
						decs.push(dec);
						source_editor.setDecorations(source_code_line, decs);

						trace_editor.visibleRanges.forEach( range => {
							let trace_line_start = range.start.line;
							let trace_line_stop = range.end.line;

							for (let i=trace_line_start; i<=trace_line_stop; i++){
								
							}

						});

					}); 
				});
			}
		});



	});
	

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	let disposable = vscode.commands.registerCommand('extension.helloWorld', () => {
		// The code you place here will be executed every time your command is executed

		// Display a message box to the user
		vscode.window.showInformationMessage('Hello World!');
	});

	context.subscriptions.push(disposable);
}

// this method is called when your extension is deactivated
export function deactivate() {}
