import _get from 'lodash.get';
import { findIndex } from 'lodash';
import { getStore } from "./LauncherStore";
import AppDirectory from "../modules/AppDirectory";
import FDC3 from "../modules/FDC3";
import { findAppIndexInFolder } from '../utils/helpers';
const async = require("async");
let FDC3Client;
let appd;
let appDEndpoint;
let ToolbarStore;

export default {
	initialize,
	addApp,
	addNewFolder,
	addAppToFolder,
	removeAppFromFolder,
	renameFolder,
	deleteFolder,
	deleteApp,
	deleteTag,
	reorderFolders,
	getDeleted,
	getFolders,
	getFoldersList,
	getActiveFolderName,
	getActiveFolder,
	getSingleFolder,
	getAllAppsTags,
	getAllApps,
	getFormStatus,
	getSearchText,
	getSortBy,
	addTag,
	getTags,
	addPin,
	removePin,
	getApp,
	getDragDisabled,
	getConstants
};

const data = {};
const ADVANCED_APP_LAUNCHER = "Advanced App Launcher";


//returns names of default folders.
function getConstants() {
	const DASHBOARDS = 'Dashboards'
	const FAVORITES = 'Favorites'
	return { ADVANCED_APP_LAUNCHER, DASHBOARDS, FAVORITES }
}

//Add to here if you want to disable dragging on a folder.
function getDragDisabled() {
	const { ADVANCED_APP_LAUNCHER, DASHBOARDS, FAVORITES } = getConstants();
	return [ADVANCED_APP_LAUNCHER, DASHBOARDS, FAVORITES]

}

function initialize(callback = Function.prototype) {
	FSBL.Clients.ConfigClient.getValue({ field: "finsemble.appDirectoryEndpoint" }, function (err, appDirectoryEndpoint) {
		// cache value globally to be used in the event that we need to fetch data for a given component.
		appDEndpoint = appDirectoryEndpoint;
		const store = getStore();

		// 'deleted' is a list of folder names/app ids which have been deleted by a user. Finsemble's state
		// keeps track of these so if the  foundation attempts to re-seed them, they will be excluded
		// from what is shown to the user

		// 'deleted' can also be empty, which means the user is not preserving previous state and instead 
		// re-seeds the store everytime the distributed store service starts up
		data.deleted = store.values.deleted || [];
		let folderList, appList = {};

		if (data.deleted.length > 0) {
			//The folder list will be the folder seeded into the store filtered by any folders
			//deleted in previous runs
			folderList = Object.keys(store.values.appFolders.folders).filter(folderName => {
				return !data.deleted.includes(folderName);
			});

			//The app list will be the folder seeded into the store filtered by any folders
			//deleted in previous runs
			Object.keys(store.values.appDefinitions).map(appID => {
				const app = store.values.appDefinitions[appID];
				if (!data.deleted.includes(app.appID)) {
					appList[appID] = store.values.appDefinitions[appID];
				}
			});

			_setValue("appFolders.list", folderList);
			_setValue("appDefinitions", appList);
		}

		data.folders = store.values.appFolders.folders;
		validateFolderDataStructure();
		data.foldersList = folderList || Object.keys(store.values.appFolders.folders);
		data.apps = Object.keys(appList).length > 0 ? appList : store.values.appDefinitions;
		data.tags = store.values.activeLauncherTags;
		data.activeFolder = store.values.activeFolder;
		data.filterText = store.values.filterText;
		data.sortBy = store.values.sortBy;
		data.isFormVisible = store.values.isFormVisible;
		data.configComponents = {};

		// Add listeners to keep our copy up to date
		store.addListener({ field: "appFolders.folders" }, (err, dt) => data.folders = dt.value);
		store.addListener({ field: "appFolders.list" }, (err, dt) => data.foldersList = dt.value);
		store.addListener({ field: "appDefinitions" }, (err, dt) => data.apps = dt.value);
		store.addListener({ field: "activeFolder" }, (err, dt) => data.activeFolder = dt.value);
		store.addListener({ field: "isFormVisible" }, (err, dt) => data.isFormVisible = dt.value);
		store.addListener({ field: "sortBy" }, (err, dt) => data.sortBy = dt.value);
		store.addListener({ field: "activeLauncherTags" }, (err, dt) => data.tags = dt.value);
		store.addListener({ field: "deleted" }, (err, dt) => data.deleted = dt.value);

		getToolbarStore((err, response) => {
			FSBL.Clients.RouterClient.subscribe("Finsemble.Service.State.launcherService", (err, response) => {
				loadInstalledComponentsFromStore(() => {
					//We load our stored components(config driven) here
					loadInstalledConfigComponents(() => {
						updateAppsInFolders(callback);
					});
				});

			});
		});
	});
}

// Deleted contains a list of strings (folder names or appIDs)
// of folders/apps that have been deleted and should not be returned
// even if re-seeded by the foundation
function getDeleted() {
	return data.deleted;
}

//This gets a specific app in FDC3 and returns the results
function getApp(appID, cb = Function.prototype) {
	appd.get(appID).then(app => cb(null, app)).catch(err => cb(err));
}
// Check to see if an app is already in our list of apps
function appInAppList(appName) {
	let app = findAppByField('name', appName);
	return Boolean(app);
}

/**
 * Ensures all 'apps' properties on folders conform
 * to the new structure (Array vs object)
 */
function validateFolderDataStructure() {
	Object.keys(data.folders).map(folderName => {
		const folder = data.folders[folderName];
		if (!Array.isArray(folder.apps)) {
			const warning = "Application Launcher Persistent Store has data stored in deprecated format. Please check distributedStore configs";
			// If the structure is wrong, notify the user in hopes that the foundation will be fixed
			FSBL.Clients.Logger.warn(warning);
			FSBL.UserNotification.alert("system", "ONCE-SINCE-STARTUP", "Distributed Store Type Mismatch", warning);
			
			const newApps = [];
			Object.values(folder.apps).map(app => {
				newApps.push(app);
			});
			folder.apps = newApps;
		}
	});
	_setFolders();
}

//Update apps in folders with updated config information
function updateAppsInFolders(cb = Function.prototype) {
	//Loop through folders and update apps with new info
	const { ADVANCED_APP_LAUNCHER: advancedAppLauncherFolderName } = getConstants(); 
	Object.keys(data.folders).map(folderName => {
		if (folderName === advancedAppLauncherFolderName) return;
		else {
			const folder = data.folders[folderName];
			Object.values(data.configComponents).map(configComp => {
				let index = -1;
				folder.apps.map((folderApp, i) => {
					if (folderApp.appID.trim() === configComp.appID.trim()) {
						index = i;
					}
				});

				if (index > -1) {
					data.folders[folderName].apps.splice(index, 1, configComp);
				}
			});
		}
	});
	_setFolders(cb);
}

/**
 * Given a component config, will return tags, or an empty array.
 *
 * @param {*} componentConfig
 * @returns
 */
function extractTagsFromFinsembleComponentConfig(componentConfig) {
	if (!componentConfig.foreign) return [];
	if (!componentConfig.foreign.components) return [];
	if (!componentConfig.foreign.components["App Launcher"]) return [];

	const { tags } = componentConfig.foreign.components["App Launcher"];

	if (tags) {
		if (typeof tags === "string") {
			return [tags];
		}
		return tags;
	}

	return [];
}
/**
 * Instantiates classes needed to interact with the appD server.
 * Only done when needed. If there are no components with source 'FDC3', this code will not execute.
 */
function lazyLoadAppD() {
	if (!FDC3Client) FDC3Client = new FDC3({ url: appDEndpoint });
	if (!appd) appd = new AppDirectory(FDC3Client);
}

/**
 * Here we load apps from FDC3
 * @param {*} cb
 */
function loadInstalledComponentsFromStore(cb = Function.prototype) {
	async.map(Object.values(data.apps), (component, componentDone) => {
		// Load FDC3 components here
		if (component.source && component.source === "FDC3") {
			lazyLoadAppD();
			// get the app info so we can load it into the launcher
			return getApp(component.appID, (err, app) => {
				if (err) {// don't want to kill this;
					console.error("there was an error loading from FDC3", component, err);
					return componentDone();
				}
				componentDone();
			});
		}
		// We'll load our user defined components here
		FSBL.Clients.LauncherClient.addUserDefinedComponent(component, (compAddErr) => {
			if (compAddErr) {
				console.warn("Failed to add new app:", compAddErr);
				return componentDone(compAddErr);
			}
			componentDone();
		});
	}, (err) => {
		cb(err);
	});
}
// We load our apps that were loaded from the config.
function loadInstalledConfigComponents(cb = Function.prototype) {
	// Get the list of components from the launcher service
	FSBL.Clients.LauncherClient.getComponentList((err, componentList) => {
		let componentNameList = Object.keys(componentList);
		
		/*
		 * Update the folders under the "App" menu and delete any apps in the folder 
		 * that are no longer in the config and are not user defined components.
		 */
		const { folders } = data;
		// Get the user defined apps
		const apps = Object.keys(data.apps);
		Object.keys(folders).forEach(folderName => {
			folders[folderName].apps.map((configDefinedApp, i) => {
				const name = configDefinedApp.name;
				const appID = configDefinedApp.appID;
				// If the component is not in the config component list and is not a user defined component
				if (!componentNameList.includes(name) && !apps.includes(appID)) {
					// Delete app from the folder
					folders[folderName].apps.splice(i, 1);
				}
			});
		});
		
		componentNameList.map(componentName => {
			// If the app is already in our list move on
			if (appInAppList(componentName)) return;
			const component = componentList[componentName];
			const launchableByUser = _get(component, 'foreign.components.App Launcher.launchableByUser');
			// Make sure the app is launchable by user
			if (launchableByUser) {
				data.configComponents[componentName] = {
					appID: componentName,
					icon: component.foreign.Toolbar && component.foreign.Toolbar.iconClass ? component.foreign.Toolbar.iconClass : null,
					name: componentName,
					displayName: component.component.displayName || componentName,
					source: "config",
					tags: extractTagsFromFinsembleComponentConfig(component)
				};
			}
		});
		cb();
	});
}

function getToolbarStore(done) {
	FSBL.Clients.DistributedStoreClient.getStore({ global: true, store: "Finsemble-Toolbar-Store" }, function (err, store) {
		ToolbarStore = store;
		store.getValue({ field: "pins" }, function (err, pins) {
			data.pins = pins;
		});

		store.addListener({ field: "pins" }, function (err, pins) {
			data.pins = pins;
		});
		done();
	});
}

function _setValue(field, value, cb = Function.prototype) {
	getStore().setValue({
		field: field,
		value: value
	}, (error, data) => {
		if (error) {
			console.log("Failed to save. ", field);
			FSBL.Clients.Logger.error(`Advanced App Launcher: Failed to save: ${field}:${value}`);
			// TODO
			// Should probably return with an error so the calling function knows to move on
			// Don't want to deal with unforseen circumstances by doing that now
		} else {
			cb && cb();
		}
	});
}

function _setFolders(cb = Function.prototype) {
	_setValue("appFolders.folders", data.folders, (err, data) => {
		if (err) {
			console.log("Failed to save modified folder list.");
			return;
		}

		cb();
	});
}

function addPin(pin) {
	//TODO: This logic may not work for dashboards. Might need to revisit.
	FSBL.Clients.LauncherClient.getComponentList((err, components) => {
		let componentToToggle;
		for (let i = 0; i < Object.keys(components).length; i++) {
			let componentName = Object.keys(components)[i];
			//pin name "Welcome" will not be found in component list with "Welcome Component".
			//Will check both for actual name, and for pin.name + Component against the list
			if (componentName === pin.name || componentName === pin.name + " Component") {
				componentToToggle = components[componentName];
			}
		}

		if (componentToToggle) {
			let componentType = componentToToggle.group || componentToToggle.component.type || pin.name;
			let fontIcon;
			try {
				if (componentToToggle.group) {
					fontIcon = "ff-ungrid";
				} else {
					fontIcon = componentToToggle.foreign.components.Toolbar.iconClass;
				}
			} catch (e) {
				fontIcon = "";
			}

			let imageIcon;
			try {
				imageIcon = componentToToggle.foreign.components.Toolbar.iconURL;
			} catch (e) {
				imageIcon = "";
			}


			let params = { addToWorkspace: true, monitor: "mine" };
			if (componentToToggle.component && componentToToggle.component.windowGroup) { params.groupName = componentToToggle.component.windowGroup; }
			var thePin = {
				type: "componentLauncher",
				label: pin.displayName || pin.name,
				component: componentToToggle.group ? componentToToggle.list : componentType,
				fontIcon: fontIcon,
				icon: imageIcon,
				toolbarSection: "center",
				uuid: uuidv4(),
				params: params
			};
			ToolbarStore.setValue({ field: "pins." + pin.name.replace(/[.]/g, "^DOT^"), value: thePin });
		}
	});

}

function removePin(pin) {
	ToolbarStore.removeValue({ field: "pins." + pin.name.replace(/[.]/g, "^DOT^") });
}

function getFolders() {
	return data.folders;
}

function getFoldersList() {
	return data.foldersList;
}

function getAllApps() {
	let mergedApps = Object.assign({}, data.apps, data.configComponents);;
	return mergedApps;
}

function getFormStatus() {
	return data.isFormVisible;
}

function getSingleFolder(folderName) {
	return data.folders[folderName];
}

function reorderFolders(destIndex, srcIndex) {
	//There are two types of folders: Those that can be arranged, and those that cannot. We don't want to reorder the folders relative to the unorderable folders. Split them out, and then combine them after doing the filtering/swapping.
	const dragDisabled = getDragDisabled();
	const unorderableFolders = data.foldersList.filter(folderName => dragDisabled.includes(folderName));
	const orderableFolders = data.foldersList.filter(folderName => !dragDisabled.includes(folderName));
	const movedFolder = orderableFolders[destIndex];
	const remainingItems = orderableFolders.filter((item, index) => index !== destIndex);
	data.foldersList = [
		...unorderableFolders,
		...remainingItems.slice(0, srcIndex),
		movedFolder,
		...remainingItems.slice(srcIndex)
	];
	_setValue("appFolders.list", data.foldersList);
	return data.foldersList;
}

function addApp(app = {}, cb) {
	const appID = (new Date()).getTime();
	const folder = data.activeFolder;
	const newAppData = {
		appID,
		tags: app.tags !== "" ? app.tags.split(",") : [],
		name: app.name,
		url: app.url,
		type: "component",
		canDelete: true // Users can delete quick components
	};
	const { FAVORITES } = getConstants();

	FSBL.Clients.LauncherClient.addUserDefinedComponent(newAppData, (compAddErr) => {
		if (compAddErr) {
			//TODO: We need to handle the error here. If the component failed to add, we should probably fall back and not add to launcher
			cb({ code: "failed_to_add_app", message: compAddErr });
			console.warn("Failed to add new app:", compAddErr);
			return;
		}
		// If we're creating the app while in the favorites folder,
		// we need to make sure it gets pinned to the toolbar
		if (folder === FAVORITES) addPin({ name: app.name });
		data.apps[appID] = newAppData;
		data.folders[ADVANCED_APP_LAUNCHER]["apps"].push(newAppData);
		data.folders[folder]["apps"].push(newAppData);
		// Save appDefinitions and then folders
		_setValue("appDefinitions", data.apps, () => {
			_setFolders();
			cb && cb();
		});
	});
}

function deleteApp(appID) {

	ToolbarStore.removeValue({ field: "pins." + data.apps[appID].name.replace(/[.]/g, "^DOT^") }, (err, res) => {
		if (err) {
			//TODO: Need to gracefully handle this error. If the pin can't be removed, the app shouldn't either
			console.warn("Error removing pin for deleted app");
			return;
		}
		// Delete app from any folder that has it
		for (const key in data.folders) {
			const appIndex = findAppIndexInFolder(appID, key);
			data.folders[key].apps.splice(appIndex,  1);
		}

		const deleted = getDeleted();
		deleted.push(appID);

		// Delete app from the apps list
		FSBL.Clients.LauncherClient.removeUserDefinedComponent(data.apps[appID], () => {
			delete data.apps[appID];
			// Save appDefinitions and then folders
			_setValue("appDefinitions", data.apps, () => {
				_setFolders();
				_setValue("deleted", deleted);
			});
		});

	});
}

function addNewFolder(name) {
	// Each new folder is given a number, lets store them here
	// to get the highest one and then increment
	const newFoldersNums = [0];
	// Find folders that have a name of "New folder" or "New folder #"
	data.foldersList.forEach((folder) => {
		const numbers = folder.match(/\d+/g) || [];
		newFoldersNums.push(Math.max.apply(this, numbers));
	});
	const highestFolderNumber = Math.max.apply(this, newFoldersNums);
	const folderName = name || `New folder ${highestFolderNumber + 1}`;
	const newFolder = {
		disableUserRemove: true,
		icon: "ff-adp-hamburger",
		canEdit: true,
		canDelete: true,
		apps: []
	};
	data.folders[folderName] = newFolder;
	_setFolders(() => {
		// Update folders order if adding was successful
		data.foldersList.push(folderName);
		_setValue("appFolders.list", data.foldersList);
	});

}

function deleteFolder(folderName) {
	// Check if user is trying to delete the active folder
	if (folderName === data.activeFolder) {
		data.activeFolder = ADVANCED_APP_LAUNCHER;
		_setValue("activeFolder", data.activeFolder);
	}

	const deletedFolders = data.deleted;
	deletedFolders.push(folderName);

	delete data.folders[folderName] && _setFolders(() => {
		// Update the order of folders
		const index = data.foldersList.indexOf(folderName);
		data.foldersList.splice(index, 1);
		_setValue("appFolders.list", data.foldersList);
		_setValue("deleted", deletedFolders);
	});
}

function renameFolder(oldName, newName) {
	let oldFolder = data.folders[oldName];
	data.folders[newName] = oldFolder;
	delete data.folders[oldName];

	_setFolders(() => {
		let indexOfOld = data.foldersList.findIndex((folderName) => {
			return folderName === oldName;
		});
		data.foldersList[indexOfOld] = newName;

		// If the name the user is attempting to rename to is the name of an old deleted folder
		// remove the key from deleted and allow rename
		if (data.deleted.includes(newName)) {
			const index = data.deleted.indexOf(newName);
			const deletedFolders = data.deleted;
			deletedFolders.splice(index, 1);
			_setValue("deleted", deletedFolders);
		}

		// If the active folder is the folder being renamed, change that value
		if (data.activeFolder === oldName) {
			data.activeFolder = newName;
			_setValue("activeFolder", data.activeFolder);
		}

		_setValue("appFolders.list", data.foldersList);
		delete data.folders[oldName];
	});
}

function addAppToFolder(folderName, app) {
	const appIndex = findAppIndexInFolder(app.appID, folderName);

	if (appIndex < 0) {
		data.folders[folderName].apps.push({
			name: app.name, 
			displayName: app.displayName,
			appID: app.appID
		});
		_setFolders();
	}
}

function removeAppFromFolder(folderName, app) {
	const appIndex = findAppIndexInFolder(app.appID, folderName);
	data.folders[folderName].apps.splice(appIndex, 1);
	_setFolders();
}
/**
 * Given a field, search through FDC3 apps and apps pulled in via config and return that app.
 * */
function findAppByField(field, value) {
	return Object.values(data.apps).find(app => app ? app[field] === value : false) ||
		Object.values(data.configComponents).find(app => app ? app[field] === value : false)
}

function getActiveFolder() {
	const folder = data.folders[data.activeFolder];
	folder.apps.map((app) => {
		const appData = findAppByField('appID', app.appID)
		if (!appData) {
			app.tags = [];
		} else {
			app.tags = appData.tags;
		}
	});
	//Need a name for the AppDefinition/AppActionsMenu rendering
	folder.name = data.activeFolder;
	return folder;
}

function getActiveFolderName() {
	return data.activeFolder;
}

function getSearchText() {
	return data.filterText;
}

function getSortBy() {
	return data.sortBy;
}

function getTags() {
	return data.tags;
}

function getAllAppsTags() {
	let tags = [];
	// Pull tags from applications installed via FDC3 and the component config.
	const apps = Object.values(data.apps).concat(Object.values(data.configComponents));

	apps.forEach((app) => {
		tags = tags.concat(app.tags);
	});
	// return unique ones only
	return tags.filter((tag, index) => {
		return tags.indexOf(tag) === index;
	});
}

function addTag(tag) {
	// Push new tag to list
	console.log("addTag", tag);
	data.tags.indexOf(tag) < 0 && data.tags.push(tag);
	// Update tags in store
	_setValue("activeLauncherTags", data.tags);
}

function deleteTag(tag) {
	// Push new tag to list
	data.tags.splice(data.tags.indexOf(tag), 1);
	// Update tags in store
	console.log("deleteTag", data.tags);
	_setValue("activeLauncherTags", data.tags);
}

function uuidv4() {
	return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
		var r = Math.random() * 16 | 0,
			v = c === "x" ? r : r & 0x3 | 0x8;
		return v.toString(16);
	});
}
