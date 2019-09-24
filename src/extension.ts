// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { POINT_CONVERSION_COMPRESSED, SSL_OP_SSLEAY_080_CLIENT_DH_BUG } from 'constants';
import { isMainThread } from 'worker_threads';
import { prependOnceListener } from 'cluster';
import { resolveCliPathFromVSCodeExecutablePath } from 'vscode-test';
import { TLSSocket } from 'tls';

type PCIndex = { [label: string]: SourceLine };
type TranlationIndex = { [label: number]: TraceLine };
type SourceLineCache = { [label: string]: SourceLine };
type FileIndex = { [label: string]: number []};



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

class SourceLine {
	path:string;
	line:number;
	uri:string;

	constructor(path:string, line:number, uri:string){
		this.path = path;
		this.line = line;
		this.uri = uri;
	}
}

class TraceLine {
	cycles:number;
	pc:string;
	trace_line_num:number;
	source_lines:SourceLine[];
	
	constructor(pc:string, cycles:number, trace_line_num:number){
		this.pc = pc;
		this.cycles = cycles;
		this.source_lines = [];
		this.trace_line_num = trace_line_num;
	}
}


class Addr2Line {
	workspace:vscode.WorkspaceFolder;
	binfile_path:string;
	regex:string;
	translation_index:TranlationIndex;
	source_line_objs:SourceLineCache;
	pcindex:PCIndex;
	fileindex:FileIndex;

	constructor(workspace:vscode.WorkspaceFolder, binfile_path:string, regex:string){
		this.workspace = workspace;
		this.binfile_path = binfile_path;
		this.regex = regex;
		this.translation_index = {};
		this.source_line_objs = {};
		this.pcindex = {};
		this.fileindex = {};
	}

	async translate_lines(trace_lines:string[]){

		return new Promise( async (resolve, reject) => {

			const slice = 1000;
			
			let promises = [];
			for (let i=0; i<trace_lines.length; i+=slice){
			
				//console.log("i: " + i + " trace_lines.length: " + trace_lines.length);
				let trace_lines_obj = trace_lines.slice(i, i + slice - 1).map( (line, index) => { 
					let matches = line.match(this.regex);
					if (matches===null || matches.length<1) {return new TraceLine("0", 0, 0);}
					const cycles=parseInt(matches[1]);
					const pc=matches[2];
					return new TraceLine(pc, cycles, i + index);
				});


				let program_counters_txt = trace_lines_obj.map(((l) => l.pc)).join(" ");


				const cp = require("child_process");

				

				await new Promise((resolve, reject) => {
					cp.exec("addr2line -e " + this.binfile_path + " -i -a " + program_counters_txt, (error: string, stdout: string, stderr: any) => {
						if (error) {
							console.log("ERROR: " + error);
							reject(stderr);
						}

						const stdout_lines = stdout.split("\n");
						//console.log(stdout_lines.length);
						let trace_obj_index = -1;
						for (let i=0; i<stdout_lines.length; i++){
							let stdout_line = stdout_lines[i];
							//console.log(stdout_line);
							if (stdout_line.startsWith("0x")) {
								trace_obj_index++;
							} 
							else {
								if (trace_obj_index<0) { throw Error("add2line output format is not recognized!"); }

								let tl = trace_lines_obj[trace_obj_index];

								//the line has been translated and is the file is in our workspace (well....)
								if (!stdout_line.startsWith("??") && stdout_line.indexOf(this.workspace.name) >= 0){
									
									if (this.source_line_objs[stdout_line] === undefined){
										let coords = stdout_line.split(":");
										const source_path = coords[0];
										const source_line = parseInt(coords[1]);

										const source_rel_path = source_path.substring(source_path.indexOf(this.workspace.name) + this.workspace.name.length + 1);
										const source_uri = vscode.Uri.parse("file://" + this.workspace.uri.fsPath + "/" + source_rel_path).fsPath;

										this.source_line_objs[stdout_line] = new SourceLine(source_path, source_line, source_uri);
										//console.log("Source line length: " + Object.keys(this.source_line_objs.length));
									}
									tl.source_lines.push(this.source_line_objs[stdout_line]);
									//this.fileindex[this.source_line_objs[stdout_line].path].push(tl.trace_line_num);
									//console.log("obj index: " + trace_obj_index + "; trace line: " + tl.trace_line_num);
									//console.log("pushing " + this.source_line_objs[stdout_line].path + " to: " + tl.trace_line_num + " len: " + tl.source_lines.length);
									/*
									if (tl.source_lines.length === 1){
										console.log("Adding line " + tl.trace_line_num + " to index; current len: " + Object.keys(this.translation_index).length);
										this.translation_index[tl.trace_line_num] = tl;
									}
									*/
								}
							}
						}
						console.log("completed batch " + i + " -> " + (i+slice));
						//progress.report("Line: " )
						resolve();
					});
					//if a trace line as at least one translation, then we add it to the translation index
				});

				//trace_lines_obj.map((obj) => { console.log("trace line: " + obj.trace_line_num + "; sources: " + obj.source_lines.length); });
				trace_lines_obj.map((obj) => { if (obj.source_lines.length>0) { this.translation_index[obj.trace_line_num] = obj;}});
			}
			console.log("completed: " + Object.keys(this.translation_index).length);
			resolve();
		});
	}
}

/*
class SourceCodeLine {
	workspace:vscode.WorkspaceFolder;
	filepath:string;
	linenumber:number;
	binfile_path:string;
	is_in_workpace:boolean;

	constructor(workspace:vscode.WorkspaceFolder, filepath:string, linenumber:number, binfile_path:string){
		this.workspace = workspace;
		this.filepath = filepath;
		this.linenumber = linenumber;
		this.binfile_path = binfile_path;
		this.is_in_workpace = this.filepath.indexOf(this.workspace.name) >= 0;
		
	}

	isInWorkspace(){
		return this.is_in_workpace;
	}

	getURI() {
		if (!this.isInWorkspace()) { return undefined; }
		let source_file = this.filepath.substring(this.filepath.indexOf(this.workspace.name) + this.workspace.name.length + 1);
		return vscode.Uri.parse("file://" + this.workspace.uri.fsPath + "/" + source_file);
	}
}
*/
/*
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

			//if (trace_translation_cache[this.pc] !== undefined) { resolve(trace_translation_cache[this.pc]);}

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
				//trace_translation_cache[this.pc] = new SourceCodeLine(workspace, filepath, line, binfile);
				resolve(trace_translation_cache[this.pc]);
			});
		});
	}
}
*/

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
/*
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
	*/

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
}
*/



// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {


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


	let trace_lines = trace_document.getText().split("\n");


	await vscode.window.showOpenDialog(open_options).then(fileUri => {
		if (fileUri && fileUri[0]) {
			binfile_uri = fileUri[0].fsPath;
		}
	});

	let addr2line = new Addr2Line(ws, binfile_uri, trace_regex);
	

	await vscode.window.withProgress(
		{
		  location: vscode.ProgressLocation.Notification,
		  title: 'Prorcessing trace file',
		  cancellable: true
		},
		async progress => {
							
		
			await addr2line.translate_lines(trace_document.getText().split("\n")).then(() => {
				console.log("all lines have been translated!");
			});
			console.log(Object.keys(addr2line.translation_index).length);
		}
	);

	/*
	vscode.window.onDidChangeTextEditorVisibleRanges(changeEvent => {

		if (changeEvent.textEditor.document !== trace_document || current_source_code_line === undefined) {return;}
		highlightTrace(trace_translation_cache, trace_editor, ws, binfile_uri, current_source_code_line);

	});
	*/

	
	vscode.window.onDidChangeTextEditorSelection(changeEvent => {

		if (vscode.window.activeTextEditor === undefined || changeEvent.textEditor.document !== trace_document) { return; }

		let sel = changeEvent.textEditor.selection;
		if (!sel.isSingleLine) {return;}

		const sel_line = sel.start.line;

		if (addr2line.translation_index[sel_line] !== undefined) {
			const tline = addr2line.translation_index[sel_line];
			const sline = addr2line.translation_index[sel_line].source_lines[0];
			let source_uri = sline.uri;
			vscode.workspace.openTextDocument(source_uri).then(doc => { 
				vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside, true).then( source_editor => {
					highlightLines(source_editor, sline.line, sline.line, sline.line, true, true, []);

					let decs:vscode.DecorationOptions [] = [];
					addr2line.fileindex[sline.path].map((trace_line) => {
						highlightLines(trace_editor, trace_line, trace_line, trace_line, false, false, decs);
					});

					//highlightLine(source_editor, source.linenumber, true, true, []);
					//highlightTrace(trace_translation_cache, trace_editor, ws, binfile_uri, source);
				});
			});

			//highlightLines(source_editor, tline.source_lines[0].line, source.linenumber, source.linenumber, true, true, []);
		}

		/*
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
		*/
	});
	

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	let disposable = vscode.commands.registerCommand('extension.helloWorld', async () => {
		// The code you place here will be executed every time your command is executed
	
		// Display a message box to the user
		vscode.window.showInformationMessage('Hello World!');

	});

	context.subscriptions.push(disposable);
}


// this method is called when your extension is deactivated
export function deactivate() {}
