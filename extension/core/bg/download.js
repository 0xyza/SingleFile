/*
 * Copyright 2010-2019 Gildas Lormeau
 * contact : gildas.lormeau <at> gmail.com
 * 
 * This file is part of SingleFile.
 *
 *   The code in this file is free software: you can redistribute it and/or 
 *   modify it under the terms of the GNU Affero General Public License 
 *   (GNU AGPL) as published by the Free Software Foundation, either version 3
 *   of the License, or (at your option) any later version.
 * 
 *   The code in this file is distributed in the hope that it will be useful, 
 *   but WITHOUT ANY WARRANTY; without even the implied warranty of 
 *   MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU Affero 
 *   General Public License for more details.
 *
 *   As additional permission under GNU AGPL version 3 section 7, you may 
 *   distribute UNMODIFIED VERSIONS OF THIS file without the copy of the GNU 
 *   AGPL normally required by section 4, provided you include this license 
 *   notice and a URL through which recipients can access the Corresponding 
 *   Source.
 */

/* global browser, singlefile, Blob, URL, document */

singlefile.download = (() => {

	const partialContents = new Map();

	return {
		onMessage,
		downloadPage
	};

	async function onMessage(message, sender) {
		if (message.method.endsWith(".download")) {
			if (message.truncated) {
				let contents = partialContents.get(sender.tab.id);
				if (!contents) {
					contents = [];
					partialContents.set(sender.tab.id, contents);
				}
				contents.push(message.content);
				if (message.finished) {
					partialContents.delete(sender.tab.id);
					if (message.saveToClipboard) {
						message.content = contents.join("");
					} else {
						message.url = URL.createObjectURL(new Blob(contents, { type: "text/html" }));
					}
				} else {
					return {};
				}
			} else if (message.content && !message.saveToClipboard) {
				message.url = URL.createObjectURL(new Blob([message.content], { type: "text/html" }));
			}
			if (message.saveToClipboard) {
				saveToClipboard(message);
			} else {
				try {
					const tab = sender.tab;
					return await downloadPage(message, { confirmFilename: message.confirmFilename, incognito: tab.incognito, filenameConflictAction: message.filenameConflictAction });
				} catch (error) {
					console.error(error); // eslint-disable-line no-console
					singlefile.ui.onError(sender.tab.id, {});
					return {};
				}
			}
		}
	}

	async function downloadPage(page, options) {
		const downloadInfo = {
			url: page.url,
			saveAs: options.confirmFilename,
			filename: page.filename,
			conflictAction: options.filenameConflictAction
		};
		if (options.incognito) {
			downloadInfo.incognito = true;
		}
		let downloadId;
		try {
			downloadId = await browser.downloads.download(downloadInfo);
		} catch (error) {
			if (error.message) {
				const errorMessage = error.message.toLowerCase();
				const invalidFilename = errorMessage.includes("illegal characters") || errorMessage.includes("invalid filename");
				if (invalidFilename && page.filename.startsWith(".")) {
					page.filename = "_" + page.filename;
					return downloadPage(page, { confirmFilename: options.confirmFilename, incognito: options.incognito, filenameConflictAction: options.filenameConflictAction });
				} else if (invalidFilename && page.filename.includes(",")) {
					page.filename = page.filename.replace(/,/g, "_");
					return downloadPage(page, { confirmFilename: options.confirmFilename, incognito: options.incognito, filenameConflictAction: options.filenameConflictAction });
				} else if (invalidFilename && !page.filename.match(/^[\x00-\x7F]+$/)) { // eslint-disable-line  no-control-regex
					page.filename = page.filename.replace(/[^\x00-\x7F]+/g, "_"); // eslint-disable-line  no-control-regex
				} else if ((errorMessage.includes("'incognito'") || errorMessage.includes("\"incognito\"")) && options.incognito) {
					return downloadPage(page, { confirmFilename: options.confirmFilename, filenameConflictAction: options.filenameConflictAction });
				} else if (errorMessage == "conflictaction prompt not yet implemented" && options.filenameConflictAction) {
					return downloadPage(page, { confirmFilename: options.confirmFilename });
				} else if (errorMessage.includes("canceled")) {
					URL.revokeObjectURL(page.url);
					return {};
				}
				else {
					throw error;
				}
			} else {
				throw error;
			}
		}
		return new Promise((resolve, reject) => {
			browser.downloads.onChanged.addListener(onChanged);

			function onChanged(event) {
				if (event.id == downloadId && event.state) {
					if (event.state.current == "complete") {
						URL.revokeObjectURL(page.url);
						resolve({});
						browser.downloads.onChanged.removeListener(onChanged);
					}
					if (event.state.current == "interrupted") {
						URL.revokeObjectURL(page.url);
						if (event.error && event.error.current == "USER_CANCELED") {
							resolve({});
						} else {
							reject(new Error(event.state.current));
						}
						browser.downloads.onChanged.removeListener(onChanged);
					}
				}
			}
		});
	}

	function saveToClipboard(page) {
		const command = "copy";
		document.addEventListener(command, listener);
		document.execCommand(command);
		document.removeEventListener(command, listener);

		function listener(event) {
			event.clipboardData.setData("text/html", page.content);
			event.clipboardData.setData("text/plain", page.content);
			event.preventDefault();
		}
	}

})();
