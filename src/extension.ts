// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { POINT_CONVERSION_COMPRESSED } from 'constants';
import { isMainThread } from 'worker_threads';

type TranlationCache = { [label: string]: SourceCodeLine };

const trace_regex = "[ ]+[0-9]+[ ]+([0-9]+)[ ]+(1c[0-9a-f]+).+";


const open_options: vscode.OpenDialogOptions = {
	canSelectMany: false,
	canSelectFolders: false,
	filters: { 'All files': ['*']}
};

// create a decorator type that we use to decorate large numbers
const source_code_line = vscode.window.createTextEditorDecorationType({
	cursor: 'crosshair',
	backgroundColor: '#FF000055',
});

class SourceCodeLine {
	workspace:vscode.WorkspaceFolder;
	filepath:string;
	linenumber:number;
	binfile_path:string;

	constructor(workspace:vscode.WorkspaceFolder, filepath:string, linenumber:number, binfile_path:string){
		this.workspace = workspace;
		this.filepath = filepath;
		this.linenumber = linenumber;
		this.binfile_path = binfile_path;
	}

	isInWorkspace(){
		return this.filepath.indexOf(this.workspace.name) >= 0;
	}

	getURI() {
		
		if (!this.isInWorkspace()) { return undefined; }
		let source_file = this.filepath.substring(this.filepath.indexOf(this.workspace.name) + this.workspace.name.length + 1);
		return vscode.Uri.parse("file://" + this.workspace.uri.fsPath + "/" + source_file);
	}
}

class TraceLine {
	cycles:number;
	pc:string;

	constructor(txt:string, regex:string){
		this.cycles = 0;
		this.pc = "0x0";
		let matches = txt.match(regex);
		if (matches===null || matches.length<1) {return; }

		this.cycles=parseInt(matches[1]);
		this.pc=matches[2];
	}

	async resolve(trace_translation_cache:TranlationCache, workspace:vscode.WorkspaceFolder, binfile:string) {
		return new Promise<SourceCodeLine>((resolve, reject) => {

			if (trace_translation_cache[this.pc] !== undefined) { resolve(trace_translation_cache[this.pc]);}

			const cp = require("child_process");

			cp.exec("addr2line -e " + binfile + " -i " + this.pc, (error: string, stdout: string, stderr: any) => {
				if (error) {
					reject(stderr);
				}
				
				const stdout_lines = stdout.split("\n");
				//const stdout_line = stdout_lines[stdout_lines.length -2];
				const stdout_line = stdout_lines[0];
				const coords = stdout_line.split(":");
				const filepath = coords[0];
				const line = parseInt(coords[1]);
				trace_translation_cache[this.pc] = new SourceCodeLine(workspace, filepath, line, binfile);
				resolve(trace_translation_cache[this.pc]);
			});
		});
	}

}

function highlightLines(text_editor:vscode.TextEditor, line_start:number, line_stop:number, line_select:number, select:boolean, recenter:boolean, decs:vscode.DecorationOptions []){

	for (let line=line_start; line<=line_stop; line++) {
		let dec = {range: text_editor.document.lineAt(line).range};
		decs.push(dec);
	}
	text_editor.setDecorations(source_code_line, decs);

	if (select) {text_editor.selection = new vscode.Selection(line_select, 0, line_select, 0);}
	const first_visible_line = text_editor.visibleRanges[0].start.line;
	const last_visible_line = text_editor.visibleRanges[0].end.line;
	//console.log("line_select " + line_select + "; range: " + first_visible_line + " -> " + last_visible_line);
	if (recenter && (line_select < first_visible_line || line_select > last_visible_line)) { text_editor.revealRange(text_editor.selection, vscode.TextEditorRevealType.InCenter); }

}

function highlightTrace(trace_translation_cache:TranlationCache, trace_editor:vscode.TextEditor, ws:vscode.WorkspaceFolder, binfile_uri:string, source:SourceCodeLine){

	trace_editor.visibleRanges.forEach( range => {
		let trace_line_start = range.start.line;
		let trace_line_stop = range.end.line;
		
		let decs:vscode.DecorationOptions [] = [];
		for (let i=trace_line_start; i<=trace_line_stop; i++){
			let trace_line = new TraceLine(trace_editor.document.lineAt(i).text, trace_regex);
			trace_line.resolve(trace_translation_cache, ws, binfile_uri).then( (other_source) => {
				if (other_source.filepath === source.filepath) {
					highlightLines(trace_editor, i, i, i, false, false, decs);
				}
			});
		}
	});

/*
	let decs:vscode.DecorationOptions [] = [];
	//highlightLines(trace_editor, 0, trace_editor.document.lineCount-1, 0, false, false, decs);

	trace_editor.document.getText().split("\n").forEach( (line, index) => {
		let trace_line = new TraceLine(trace_editor.document.lineAt(index).text, trace_regex);
		trace_line.resolve(trace_translation_cache, ws, binfile_uri).then( (other_source) => {
			if (other_source.filepath === source.filepath) {
				highlightLines(trace_editor, index, index, index, false, false, decs);
			}
		});
	});
*/
}

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {


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

	let ws = (<vscode.WorkspaceFolder[]>vscode.workspace.workspaceFolders)[0];	

	let current_source_code_line:SourceCodeLine;


	let trace_translation_cache:TranlationCache = {};


	let trace_translation_index:TranlationCache = {};
	let trace_lines = trace_document.getText().split("\n");

	vscode.window.withProgress(
		{
		  location: vscode.ProgressLocation.Notification,
		  title: 'My long running operation'
		},
		async progress => {
			// Progress is shown while this function runs.
			// It can also return a promise which is then awaited
			progress.report({ message: 'Doing this' });
			
		
			progress.report({ message: 'Doing that' });
		

			trace_lines.forEach(  async (line) => { 
				let trace_line = new TraceLine(line, trace_regex);
				let promise = trace_line.resolve(trace_translation_cache, ws, binfile_uri).then( (source) => {
					trace_translation_index[trace_line.pc] = source;
				});
				await promise;
			});

		}
	  );

/*
	vscode.window.withProgress({location: ProgressLocation.Notification,
		title: "I am long running!",
		cancellable: true)}, (progress, token) => {

		});

	trace_lines.forEach(  async (line) => { 
		let trace_line = new TraceLine(line, trace_regex);
		let promise = trace_line.resolve(trace_translation_cache, ws, binfile_uri).then( (source) => {
			trace_translation_index[trace_line.pc] = source;
		});
		await promise;
	});

*/
	vscode.window.showOpenDialog(open_options).then(fileUri => {
		if (fileUri && fileUri[0]) {
			binfile_uri = fileUri[0].fsPath;
		}
	});

	vscode.window.onDidChangeTextEditorVisibleRanges(changeEvent => {

		if (changeEvent.textEditor.document !== trace_document || current_source_code_line === undefined) {return;}
		highlightTrace(trace_translation_cache, trace_editor, ws, binfile_uri, current_source_code_line);

	});

	vscode.window.onDidChangeTextEditorSelection(changeEvent => {

		if (vscode.window.activeTextEditor === undefined || changeEvent.textEditor.document !== trace_document) { return; }

		let sel = changeEvent.textEditor.selection;
		if (!sel.isSingleLine) {return;}
		let line_txt = changeEvent.textEditor.document.lineAt(sel.start.line).text;

		let selected_trace_line = new TraceLine(line_txt, trace_regex);

		selected_trace_line.resolve(trace_translation_cache, ws, binfile_uri).then( (source) => {

			if (source.isInWorkspace()) {
				console.log(source.filepath);
				console.log(source.linenumber);
				let source_uri = <vscode.Uri>source.getURI();
				console.log("opening: " + source_uri.fsPath);
				current_source_code_line = source;
				vscode.workspace.openTextDocument(source_uri).then(doc => { 
					vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside, true).then( source_editor => {
						highlightLines(source_editor, source.linenumber, source.linenumber, source.linenumber, true, true, []);
						//highlightLine(source_editor, source.linenumber, true, true, []);
						highlightTrace(trace_translation_cache, trace_editor, ws, binfile_uri, source);
					});
				});
			} 
			else {
				console.log("The file: " + source.filepath + " (line " + source.linenumber +") is not in the current workspace! (raw: " + line_txt +")");
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
