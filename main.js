// ─────────────────────────────────────────────────────────────────────────────
// IMPORTS
// ─────────────────────────────────────────────────────────────────────────────

const { app, BrowserWindow, ipcMain, WebContentsView, session, webFrameMain } = require('electron');
const path = require('path');
const fs = require('fs')
const { spawn } = require('child_process');
const { type } = require('os');
const { runStartTaskPlaceholder } = require('./task-scripts');
const {open_canvas_auth_window, get_auth_token, get_auth_csrf, get_base_url} = require('./canvas')


// ─────────────────────────────────────────────────────────────────────────────
// AGENT PROCESS (Python sidekick)
// ─────────────────────────────────────────────────────────────────────────────

// spawn persistent Python agent process
const proc = spawn('python', [path.join(__dirname, 'sidekick.py')]);
let stdoutBuffer = '';
let canvas_auth_cookie = null
let canvas_auth_csrf = null
let canvas_base_url = null
let authview = null
const BROWSER_VIEW_X = 220
const BROWSER_VIEW_Y = 128
const CANVAS_VIEW_Y = 128
const RIGHT_PANEL_WIDTH = 340
const iframeInjectionFilesById = {
  preview_frame: 'preview_frame.css'
}
// forward streaming text chunks to renderer
proc.stdout.on('data', chunk => {
  console.log("main: recieved response: " + chunk.toString())
  stdoutBuffer += chunk.toString();
  const lines = stdoutBuffer.split('\n');
  stdoutBuffer = lines.pop();

  lines.forEach(line => {
    if (!line.trim()) return;

    let data;
    try {
      data = JSON.parse(line);
    } catch (err) {
      console.error('main: invalid JSON from agent', line, err);
      return;
    }

    console.log('main: received data from agent', data);

    if (typeof data === 'string') {
      BrowserWindow.getAllWindows()[0].webContents.send('prompt:response-chunk', data);
      return;
    }

    if (Array.isArray(data)) {
      console.log("first call")
      data.forEach(item => {
        if (typeof item === 'string') {
          BrowserWindow.getAllWindows()[0].webContents.send('prompt:response-chunk', item);
        } else if (typeof item === 'object' && item !== null) {
          console.log('main: running tool function with data', item);
          const tool_response = runfunction(item);
          proc.stdin.write(JSON.stringify(tool_response) + "\n")
        }
      });
      return;
    }
  });
});

// log Python errors to terminal
proc.stderr.on('data', chunk => {
  console.error('sidekick:', chunk.toString());
});

proc.on('close', () => console.log('Agent process closed'));

/**
 * Sends a user prompt payload to the Python agent over stdin.
 *
 * @param {Array|Object} payload - Message payload to forward to the agent
 *                                 (typically ["message", <string>]).
 * @returns {void}
 */
function senduserprompt(payload) {
  console.log("main: sending prompt to agent", payload);
  proc.stdin.write(JSON.stringify(payload) + '\n');
}


// ─────────────────────────────────────────────────────────────────────────────
// DATA
// ─────────────────────────────────────────────────────────────────────────────

let currtabs = []
let tabids = new Set()
let activetab = 'None'
// workspaces item: {id, name, description}
let workspaces = [
  { id: "nucleus",          name: "Nucleus",          description: "Your main planning workspace." },
  { id: "biology",          name: "Biology",           description: "Labs, readings, and course projects." },
  { id: "computer-science", name: "Computer Science",  description: "Problem sets, code practice, and notes." },
  { id: "writing",          name: "Writing",           description: "Drafts, revisions, and source work." }
];

let workspaceids   = new Set(["computer-science", "biology", "writing", "nucleus"]);
let workspacenames = new Set(["Computer Science", "Biology", "Writing", "Nucleus"]);

let projectGroups = [
  {
    id: "classes",
    label: "Classes",
    items: [
      { id: "bio101",   name: "Introductory Biology",      meta: "BIO 101",  details: "Labs, readings, and weekly reports.",               color: "#1d9e75" },
      { id: "cs110",    name: "Intro to Computer Science",  meta: "CS 110",   details: "Problem sets, programming practice, and exams.",    color: "#378add" },
      { id: "math220",  name: "Linear Algebra",             meta: "MATH 220", details: "Matrix methods, quizzes, and review sessions.",     color: "#7f77dd" },
      { id: "eng105",   name: "Academic Writing",           meta: "ENG 105",  details: "Drafting, citation cleanup, and revision work.",    color: "#d85a30" }
    ]
  },
  {
    id: "personal",
    label: "Personal Projects",
    items: [
      { id: "portfolio",    name: "Portfolio refresh", meta: "Personal", details: "Update project writeups and polish the homepage.",              color: "#d4537e" },
      { id: "nucleus-app",  name: "Nucleus app",       meta: "Product",  details: "Shape the workspace, task, and project dashboard flow.",       color: "#c58d35" }
    ]
  }
];

const canvasCourseColors = ["#1d9e75", "#378add", "#7f77dd", "#d85a30", "#d4537e", "#c58d35"];

function readCanvasData() {
  const canvasDataPath = path.join(__dirname, 'canvas_data.json');
  if (!fs.existsSync(canvasDataPath)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(canvasDataPath, 'utf8');
    return raw.trim() ? JSON.parse(raw) : null;
  } catch (error) {
    console.error("Unable to read Canvas data:", error);
    return null;
  }
}

function getCanvasProjectGroups() {
  const canvasData = readCanvasData();
  if (!canvasData || !Array.isArray(canvasData.courses)) {
    return [];
  }

  const assignmentsByCourse = canvasData.assignments || {};
  const filesByCourse = canvasData.file || {};
  const modulesByCourse = canvasData.modules || {};
  const canvasCourses = canvasData.courses
    .filter(course => course && course.id && course.workflow_state !== "deleted")
    .map((course, index) => {
      const courseAssignments = Array.isArray(assignmentsByCourse[course.id])
        ? assignmentsByCourse[course.id]
        : [];
      const courseFiles = Array.isArray(filesByCourse[course.id])
        ? filesByCourse[course.id]
        : [];
      const courseModules = Array.isArray(modulesByCourse[course.id])
        ? modulesByCourse[course.id]
        : [];
      const assignmentLabel = courseAssignments.length === 1 ? "assignment" : "assignments";
      const fileLabel = courseFiles.length === 1 ? "file" : "files";
      const moduleLabel = courseModules.length === 1 ? "module" : "modules";

      return {
        id: `canvas-${course.id}`,
        name: course.name || course.course_code || `Canvas course ${course.id}`,
        meta: course.course_code || "Canvas",
        details: `${courseAssignments.length} ${assignmentLabel}, ${courseFiles.length} ${fileLabel}, ${courseModules.length} ${moduleLabel}. Default view: ${course.default_view || "unknown"}.`,
        color: canvasCourseColors[index % canvasCourseColors.length],
        source: "canvas",
        courseId: course.id
      };
    });

  if (canvasCourses.length === 0) {
    return [];
  }

  return [{
    id: "canvas-courses",
    label: "Canvas Courses",
    items: canvasCourses
  }];
}

function getProjectGroupsSnapshot() {
  return [...projectGroups, ...getCanvasProjectGroups()];
}

let tasks = [
  { id: "bio-lab-report",   workspaceId: "", course: "BIO 101",  title: "Finish lab report",        details: "Add observations, polish the discussion, and submit the final PDF.", due: "Thu", estimate: "45 min",      color: "#1d9e75" },
  { id: "cs-problem-set",   workspaceId: "", course: "CS 110",   title: "Complete problem set 4",   details: "Work through recursion questions and test the sorting exercise.",      due: "Fri", estimate: "1 hr 20 min", color: "#378add" },
  { id: "math-quiz-review", workspaceId: "", course: "MATH 220", title: "Review quiz topics",       details: "Practice eigenvalue problems and matrix transformations.",             due: "Mon", estimate: "35 min",      color: "#7f77dd" },
  { id: "eng-essay-draft",  workspaceId: "", course: "ENG 105",  title: "Revise essay draft",       details: "Tighten the thesis, restructure paragraph two, and check citations.",  due: "Wed", estimate: "50 min",      color: "#d85a30" },
  { id: "psy-reading",      workspaceId: "", course: "PSY 101",  title: "Read chapter 6",           details: "Take notes on memory, recall, and recognition concepts.",              due: "Tue", estimate: "30 min",      color: "#d4537e" }
];

function sameTabId(left, right) {
  return String(left) === String(right);
}

function isWebContentTab(tab) {
  return tab && (tab.type === "browsertab" || tab.type === "canvastab");
}

function readInjectionCssFile(filename) {
  return fs.readFileSync(path.join(__dirname, filename), 'utf-8')
}

function normalizeFrameUrl(value) {
  if (!value) return ""
  try {
    return new URL(value).href
  } catch (_error) {
    return String(value)
  }
}

function normalizeBrowserUrl(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "https://www.google.com";
  }
  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(text)) {
    return text;
  }
  if (text.includes(".") && !text.includes(" ")) {
    return "https://" + text;
  }
  return "https://www.google.com/search?q=" + encodeURIComponent(text);
}

function getBrowserBounds(window, tab = null) {
  const [winwidth, winheight] = window.getSize();
  const y = tab && tab.type === "canvastab" ? CANVAS_VIEW_Y : BROWSER_VIEW_Y;
  return {
    x: BROWSER_VIEW_X,
    y,
    width: winwidth - RIGHT_PANEL_WIDTH - BROWSER_VIEW_X,
    height: Math.max(0, winheight - y)
  };
}


// ─────────────────────────────────────────────────────────────────────────────
// DATA MUTATIONS — Workspaces
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Adds a new workspace and notifies the renderer.
 *
 * @param {string} id           - Unique workspace identifier.
 * @param {string} name         - Display name for the workspace.
 * @param {string} [description=""] - Optional workspace description.
 * @returns {number|undefined}  - 1 if id collision, 2 if name collision,
 *                                otherwise undefined on success.
 */
function newWorkspace(id, name, description = "") {
  if (workspaceids.has(id)) {
    console.error("Workspace with the same id already exists.");
    return 1;
  }
  if (workspacenames.has(name)) {
    console.error("Workspace with the same name already exists.");
    return 2;
  }
  workspaces.push({ id, name, description });
  workspaceids.add(id);
  workspacenames.add(name);
  BrowserWindow.getAllWindows()[0].webContents.send('workspaces:update', workspaces);
  return { ok: true, workspace: { id, name, description } };
}

function deleteWorkspace(id) {
  const index = workspaces.findIndex(workspace => workspace.id === id);
  if (index === -1) {
    return { ok: false, error: "Workspace not found." };
  }
  if (workspaces.length <= 1) {
    return { ok: false, error: "Cannot delete the final workspace." };
  }

  const [removedWorkspace] = workspaces.splice(index, 1);
  workspaceids.delete(removedWorkspace.id);
  workspacenames.delete(removedWorkspace.name);

  tasks.forEach(task => {
    if (task.workspaceId === id) {
      task.workspaceId = "";
    }
  });

  BrowserWindow.getAllWindows()[0].webContents.send('workspaces:update', workspaces);
  BrowserWindow.getAllWindows()[0].webContents.send('tasks:update', tasks);
  return { ok: true, workspaceId: id };
}

function getAllWorkspacesForTool() {
  return workspaces.map(workspace => ({
    id: workspace.id,
    name: workspace.name,
    description: workspace.description || ""
  }));
}

function getWorkspaceIdsByName(workspaceName) {
  const query = String(workspaceName || "").trim().toLowerCase();
  if (!query) {
    return [];
  }

  return workspaces
    .filter(workspace => {
      const name = String(workspace.name || "").toLowerCase();
      const id = String(workspace.id || "").toLowerCase();
      return name.includes(query) || id.includes(query);
    })
    .map(workspace => ({
      id: workspace.id,
      name: workspace.name,
      description: workspace.description || ""
    }));
}


// ─────────────────────────────────────────────────────────────────────────────
// DATA MUTATIONS — Tasks
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates a new task, appends it to the tasks list, and notifies the renderer.
 *
 * @param {string} title                  - Task title (required).
 * @param {number} priority_weight        - Priority weight used by the agent.
 * @param {string} [id="no task id"]      - Ignored; id is auto-generated from title.
 * @param {string} [workspaceId="no workspace id"] - Owning workspace id.
 * @param {string} [course="no course"]   - Course/project label.
 * @param {string} [details="unspecified task"] - Free-form description.
 * @param {string} [due="monday"]         - Due-date label.
 * @param {string} [estimate=""]          - Estimated time string.
 * @param {string} [color="no color"]     - Hex color used for UI accents.
 * @returns {string}                      - Human-readable confirmation message
 *                                          to send back to the agent as a tool
 *                                          response.
 */
function newTask(title, priority_weight, id = "no task id", workspaceId = "", course = "no course", details ="unspecified task", due = "monday", estimate = "", color = "no color") {
  id = title.toLowerCase().replace(/\s+/g, '-') + '-' + Math.floor(Math.random() * 1000);
  const toolmessage = "created new task with " + id + "," + workspaceId + "," + course + "," + title + "," + details + "," + due + "," + estimate + "," + color + "," + priority_weight + "\n";
  tasks.push({ id, workspaceId, course, title, details, due, estimate, color});
  BrowserWindow.getAllWindows()[0].webContents.send('tasks:update', tasks);
  return toolmessage
}

/**
 * Removes a task from the tasks list by id.
 *
 * @param {string} id - The task id to remove.
 * @returns {string}  - Success message, or an error string if not found.
 *                      (Note: error branch currently does not return.)
 */
function deleteTask(id){
  index = tasks.findIndex(task => task["id"] == id )
  if (index == -1){
    "ERROR reomoving task: Task not found"
  }
  tasks.splice(index, 1)
  return "task successfully removed"
}


// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Looks up the color associated with a project id across all project groups.
 *
 * @param {string} projectid - The project id to search for.
 * @returns {string}         - Hex color string, or "#000000" if not found.
 *                             (Note: returns group.color, not item.color.)
 */
function getprojectcolor(projectid) {
  for (const group of projectGroups) {
    if (group.items.some(item => item.id === projectid)) {
      return group.color;
    }
  }
  return '#000000';
}


// ─────────────────────────────────────────────────────────────────────────────
// AGENT TOOL DISPATCH
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Dispatches a tool-call from the agent to the matching local function and
 * builds a tool_response array to send back over stdin.
 *
 * @param {Object} data         - Tool call payload from the agent.
 * @param {string} data.id      - Tool call id used to correlate the response.
 * @param {string} data.name    - Tool name (e.g. "add_task").
 * @param {Object} data.input   - Tool-specific input arguments.
 * @returns {Array}             - ["tool_response", <id>, <result>] tuple.
 */
function runfunction(data) {
  let tool_response = ['tool_response', data.id]
  if (data.name === "add_task") {
    console.log("main: running add_task with data", data);
     tool_response.push( newTask(
      data.input.task_name,
      data.input.priority_weight,
      undefined,
      "",
      data.input.project_name,
      "Added by agent",
      "unspecified",
      "",
      getprojectcolor(data.input.project_name)
    ));
  }
  else if (data.name === "open_browser_window") {
    const workspaceId = data.input.workspaceid
    const url = normalizeBrowserUrl(data.input.url)

    if (!workspaceids.has(workspaceId)) {
      tool_response.push("ERROR opening browser tab: workspace not found: " + workspaceId)
      return tool_response
    }

    BrowserWindow.getAllWindows()[0].webContents.send('tabs:open_browser_window', {
      url,
      workspaceId
    })
    tool_response.push("Opened browser tab in workspace " + workspaceId + " at " + url)
  }
  else if (data.name === "get_all_workspaces") {
    tool_response.push(JSON.stringify(getAllWorkspacesForTool()))
  }
  else if (data.name === "get_workspace_ids_by_name") {
    tool_response.push(JSON.stringify(getWorkspaceIdsByName(data.input.workspace_name)))
  }
  else{
    tool_response.push("Main.js could not find function, nothing changed")
  }
  return tool_response
}


// ─────────────────────────────────────────────────────────────────────────────
// WINDOW & TAB MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates the main BrowserWindow with the app's preload script and styling.
 *
 * @returns {BrowserWindow} - The newly created main window instance.
 */
function createWindow() {
  const window = new BrowserWindow({
    width: 1000,
    height: 700,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#171a21',
      symbolColor: '#e7e9ee',
      height: 56
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  window.loadFile(path.join(__dirname, 'index.html'));
  return window;
}

/**
 * Creates a new WebContentsView inside the given window, loads a URL, and
 * positions it in the tab content area.
 *
 * @param {BrowserWindow} window           - Parent window to attach the view to.
 * @param {boolean} show                   - Whether the view should be visible immediately.
 * @param {string} [url="https://www.google.com"] - Initial URL to load.
 * @returns {WebContentsView}              - The created view, ready to be tracked.
 */
function createBrowserTab(window, show, url="https://www.google.com") {
  view1 = new WebContentsView()
  view1.setBounds(getBrowserBounds(window))
  view1.setVisible(show)
  view1.webContents.loadURL(url)
  window.contentView.addChildView(view1)
  return view1
}

/**
 * Renders (shows + repositions) the given tab view, or hides the active tab
 * if 'None' is passed.
 *
 * @param {WebContentsView|'None'} view - The view to show, or 'None' to hide.
 * @returns {void}
 */
function renderTab(view, window, tab = null) {
  if (view === 'None') {
    if (activetab !== 'None'){
      activetab.view.setVisible(false)
    }
    return
  }
  if (activetab !== 'None' && view !== activetab.view) {
    activetab.view.setVisible(false)
  }
  view.setBounds(getBrowserBounds(window, tab))
  if (!view._nucleusHiddenForCanvasWipe) {
    view.setVisible(true)
  }
}

function getauth() {
  canvas_auth_cookie = get_auth_token()
  canvas_auth_csrf = get_auth_csrf()
  canvas_base_url = get_base_url()
  console.log('main got authtokens: ' + canvas_auth_cookie, + "\ncsrf: " + canvas_auth_csrf)
}

async function setup() {
  if (!fs.existsSync(path.join(__dirname, 'canvas_data.json'))) {
    fs.writeFileSync(path.join(__dirname, 'canvas_data.json'), '')
  }
  const profileresponse = fetch(canvas_base_url + '/api/v1/users/self', {
    method: 'GET',
    headers: {
      'Cookie': canvas_auth_cookie,
      'X-CSRF-Token': canvas_auth_csrf
    }
  })
  const coursesresponse = fetch(canvas_base_url + '/api/v1/courses', {    
    method: 'GET',
    headers: {
      'Cookie': canvas_auth_cookie,
      'X-CSRF-Token': canvas_auth_csrf
    }
  })
  const responses = await Promise.all([
    profileresponse,
    coursesresponse
  ])
  prof = await responses[0].json()
  course = await responses[1].json()
  alldata = JSON.stringify({profile: prof, courses: course}, null, 2)
  fs.writeFileSync(path.join(__dirname, 'canvas_data.json'), alldata)
  let assignmentresponses = []
  let courseid = []
  for (const tcourse of course) {
    console.log('url:   ' + canvas_base_url + '/api/v1/courses/' + tcourse.id + "/assignments")
    assignmentresponse = fetch(canvas_base_url + '/api/v1/courses/' + tcourse.id + "/assignments", {
      method: 'GET',
      headers: {
        'Cookie': canvas_auth_cookie,
        'X-CSRF-Token': canvas_auth_csrf
      }
    })
    assignmentresponses.push(assignmentresponse)
    courseid.push(tcourse.id)
  }
  const allass = await Promise.all(assignmentresponses)
  let storedassignment = {}
  for (let i = 0; i < allass.length; i++) {
    tempass = await allass[i].json()
    storedassignment[courseid[i]] = tempass
  }
  const data1 = JSON.parse(fs.readFileSync(path.join(__dirname, 'canvas_data.json'), 'utf8'));
  data1.assignments = storedassignment
  let fileresponses = []
  for (const tcourse of course) {
    console.log('url:   ' + canvas_base_url + '/api/v1/courses/' + tcourse.id + "/files")
    fileresponse = fetch(canvas_base_url + '/api/v1/courses/' + tcourse.id + "/files", {
      method: 'GET',
      headers: {
        'Cookie': canvas_auth_cookie,
        'X-CSRF-Token': canvas_auth_csrf
      }
    })
    fileresponses.push(fileresponse)
  }
  const allfile = await Promise.all(fileresponses)
  let storedfile = {}
  for (let i = 0; i < allfile.length; i++) {
    tempfile = await allfile[i].json()
    storedfile[courseid[i]] = tempfile
  }
  data1.file = storedfile
  let moduleresponses = []
  for (const tcourse of course) {
    console.log('url:   ' + canvas_base_url + '/api/v1/courses/' + tcourse.id + "/modules")
    moduleresponse = fetch(canvas_base_url + '/api/v1/courses/' + tcourse.id + "/modules", {
      method: 'GET',
      headers: {
        'Cookie': canvas_auth_cookie,
        'X-CSRF-Token': canvas_auth_csrf
      }
    })
    moduleresponses.push(moduleresponse)
  }
  const allmodule = await Promise.all(moduleresponses)
  let storedmodule = {}
  for (let i = 0; i < allmodule.length; i++) {
    tempmodule = await allmodule[i].json()
    storedmodule[courseid[i]] = tempmodule
  }
  data1.modules = storedmodule
  fs.writeFileSync(path.join(__dirname, 'canvas_data.json'), JSON.stringify(data1, null, 2))
}

function getauthview(view) {
  authview = view
}

function canvaspageload(view, sendsignal) {
  return new Promise(resolve => {
    function cleanup() {
      view.webContents.removeListener('did-finish-load', handler)
      view.webContents.removeListener('did-fail-load', handlefail)
    }
    function handler() {
      cleanup()
      sendsignal('success')
       resolve({
        ok: true,
        status:'loaded'
      })
    }

    function handlefail() {
      cleanup()
      sendsignal('fail')
      resolve({
        ok: false,
        status:'failed'
      })
    }
    view.webContents.once("did-finish-load", handler)
    view.webContents.once("did-fail-load", handlefail)
  })
}

async function loadCanvasTabURL(view, url, sendsignal) {
  const loadPromise = canvaspageload(view, sendsignal)
  await view.webContents.loadURL(url)
  return loadPromise
}

function startCanvasNavigation(window, view) {
  if (view) {
    view._nucleusHiddenForCanvasWipe = true
    view.setVisible(false)
  }
  window.webContents.send('canvas:navigation')
}

// ─────────────────────────────────────────────────────────────────────────────
// APP LIFECYCLE
// ─────────────────────────────────────────────────────────────────────────────

app.whenReady().then(() => {


  const mainwindow = createWindow();
  const[winwidth, winheight] = mainwindow.getSize();
  
  mainwindow.on('resize', () => {
    const[winwidth, winheight] = mainwindow.getSize();
    console.log("resizing")
    if (activetab != "None"){
      console.log("resizing browser")
      activetab.view.setBounds(getBrowserBounds(mainwindow, activetab))
    }
    if (authview) {
      authview.setBounds({x: 220, y:120, width: winwidth - 340 - 220, height: winheight})
    }
  })

  // ─── IPC Handlers ──────────────────────────────────────────────────────────

  // tasks:start — Runs the placeholder start-task script for a given task.
  // in:  task (Object) — task record from the renderer
  // out: { ok: true }
  ipcMain.handle('tasks:start', (_, task) => {
    runStartTaskPlaceholder(task);
    return { ok: true };
  });

  // data:get — Returns the current app data snapshot.
  // in:  none
  // out: { tasks, workspaces, projectGroups }
  ipcMain.handle('data:get', () => {
    return { tasks, workspaces, projectGroups: getProjectGroupsSnapshot(), canvasData: readCanvasData() };
  });

  // prompt:send — Forwards a user message to the Python agent.
  // in:  payload ({ message: string })
  // out: undefined
  ipcMain.handle('prompt:send', (_, payload) => {
    senduserprompt(["message",payload["message"]]);
  });

  // tabs:new_active — Switches the active rendered tab view.
  // in:  tab ({ view: WebContentsView, ... } | 'None')
  // out: undefined
  ipcMain.handle('tabs:new_active', (_, tab) => {
    console.log("recieved signal tabs:new_active")
    if (tab === 'None') {
      console.log("set active tab to None")
      renderTab(tab, mainwindow)
      activetab = "None"
      return
    }
    console.log("trying to find: " + tab.id)
    let foundtab = currtabs.find(localtab => sameTabId(localtab.id, tab.id))
    if (!foundtab) {
      console.log("main: active tab not found: " + tab.id)
      renderTab('None', mainwindow)
      activetab = "None"
      return
    }
    console.log("foundtab: " + foundtab.id +" " + foundtab.type)
    if (isWebContentTab(foundtab)) {
      console.log("set activetab to foundtab to: " + foundtab.id)
      renderTab(foundtab.view, mainwindow, foundtab)
      activetab = foundtab
    } else {
      renderTab('None', mainwindow)
      activetab = "None"
    }
  })

  ipcMain.handle('workspaces:new', (_, payload) => {
    if (typeof payload === "string") {
      return newWorkspace(payload, "new workspace", "workspace for anything")
    }
    return newWorkspace(payload.id, payload.name, payload.description || "")
  })

  ipcMain.handle('workspaces:delete', (_, workspaceid) => {
    return deleteWorkspace(workspaceid)
  })

  ipcMain.on('canvas:wipe-hidden', () => {
    if (activetab === "None" || activetab.type !== "canvastab" || !activetab.view) return
    activetab.view._nucleusHiddenForCanvasWipe = false
    activetab.view.setBounds(getBrowserBounds(mainwindow, activetab))
    activetab.view.setVisible(true)
  })

  ipcMain.handle('tabs:navigate', async (_, tabid, value) => {
    const foundtab = currtabs.find(localtab => sameTabId(localtab.id, tabid))
    if (!foundtab || !isWebContentTab(foundtab) || !foundtab.view) {
      return { ok: false, error: "Browser tab not found." }
    }
    const url = normalizeBrowserUrl(value)
    foundtab.url = url
    if (foundtab.type === "canvastab") {
      startCanvasNavigation(mainwindow, foundtab.view)
      await loadCanvasTabURL(foundtab.view, url, status => {
        mainwindow.webContents.send('canvas:navigation-finished', status)
      })
    } else {
      await foundtab.view.webContents.loadURL(url)
    }
    return { ok: true, url }
  })

  ipcMain.handle('tabs:back', async (_, tabid) => {
    const foundtab = currtabs.find(localtab => sameTabId(localtab.id, tabid))
    if (!foundtab || !isWebContentTab(foundtab) || !foundtab.view) {
      return { ok: false, error: "Browser tab not found." }
    }
    if (foundtab.view.webContents.canGoBack()) {
      let loadPromise = null
      if (foundtab.type === "canvastab") {
        startCanvasNavigation(mainwindow, foundtab.view)
        loadPromise = canvaspageload(foundtab.view, status => {
          mainwindow.webContents.send('canvas:navigation-finished', status)
        })
      }
      foundtab.view.webContents.goBack()
      if (loadPromise) {
        await loadPromise
      }
    }
    return { ok: true }
  })

  // tabs:push — Replaces the tracked list of active tabs.
  // in:  tabs (Array of tab objects)
  // out: undefined
  ipcMain.handle("tabs:push", async(_, tabs) => {
    console.log('recieved tabs:push, tabs updated')
    let[winwidth, winheight] = mainwindow.getSize()
    const incomingIds = new Set(tabs.map(tab => String(tab.id)))

    for (const localtab of currtabs) {
      if (!incomingIds.has(String(localtab.id)) && localtab.view) {
        if (activetab !== "None" && sameTabId(activetab.id, localtab.id)) {
          activetab = "None"
        }
        mainwindow.contentView.removeChildView(localtab.view)
      }
    }

    currtabs = currtabs.filter(tab => incomingIds.has(String(tab.id)))
    tabids = new Set(currtabs.map(tab => tab.id))

    for (const tab of tabs) {
      const existingtab = currtabs.find(localtab => sameTabId(localtab.id, tab.id))

      if (existingtab) {
        existingtab.workspaceId = tab.workspaceId
        existingtab.label = tab.label
        existingtab.url = tab.url
        existingtab.type = tab.type
      } else {
        tabids.add(tab.id)
        if (isWebContentTab(tab)){
          console.log('found web content tab: ' + JSON.stringify(tab))
          const view = new WebContentsView()
          const iframeInjectionTargets = new Map()
          const iframeInjectionCssById = tab.injection
            ? new Map(
                Object.entries(iframeInjectionFilesById).map(([id, filename]) => [
                  id,
                  readInjectionCssFile(filename)
                ])
              )
            : new Map()
          const injectBrowserTabCSS = async () => {
            if (!tab.injection) return
            try {
              await view.webContents.insertCSS(tab.injection)
            } catch (error) {
              console.error("Unable to inject browser tab CSS:", error)
            }
          }
          const injectFrameCSS = async frame => {
            if (!tab.injection || !frame || frame === view.webContents.mainFrame) return
            const target = iframeInjectionTargets.get(normalizeFrameUrl(frame.url))
            if (!target) return

            try {
              await frame.executeJavaScript(`
                (() => {
                  const styleId = "nucleus-${target.id}-css";
                  let style = document.getElementById(styleId);
                  if (!style) {
                    style = document.createElement("style");
                    style.id = styleId;
                    document.head.appendChild(style);
                  }
                  style.textContent = ${JSON.stringify(target.css)};
                })();
              `, true)
            } catch (error) {
              console.error("Unable to inject iframe CSS:", target.id, frame.url, error)
            }
          }
          const collectIframeInjectionTargets = async () => {
            if (!tab.injection) return

            try {
              const iframes = await view.webContents.executeJavaScript(`
                Array.from(document.querySelectorAll("iframe[id]")).map(frame => ({
                  id: frame.id,
                  src: frame.src
                }))
              `, true)

              iframeInjectionTargets.clear()
              iframes.forEach(frame => {
                const css = iframeInjectionCssById.get(frame.id)
                if (!css || !frame.src) return
                iframeInjectionTargets.set(normalizeFrameUrl(frame.src), {
                  id: frame.id,
                  css
                })
              })

              view.webContents.mainFrame.framesInSubtree.forEach(frame => {
                injectFrameCSS(frame)
              })
            } catch (error) {
              console.error("Unable to collect iframe injection targets:", error)
            }
          }
          view.webContents.on('did-finish-load', injectBrowserTabCSS)
          view.webContents.on('did-finish-load', collectIframeInjectionTargets)
          view.webContents.on('did-frame-finish-load', async (_event, isMainFrame, frameProcessId, frameRoutingId) => {
            if (isMainFrame) return
            const frame = webFrameMain.fromId(frameProcessId, frameRoutingId)
            await injectFrameCSS(frame)
          })
          view.webContents.setWindowOpenHandler(({ url }) => {
            if (tab.type === "canvastab") {
              startCanvasNavigation(mainwindow, view)
              loadCanvasTabURL(view, url, status => {
                mainwindow.webContents.send('canvas:navigation-finished', status)
              }).catch(error => {
                console.error("Unable to load canvas tab popup URL:", error)
                mainwindow.webContents.send('canvas:navigation-finished', 'fail')
              })
            } else {
              view.webContents.loadURL(url);
            }
            return { action: 'deny' };
          });
          let canvasNavigationLoadPromise = null
          view.webContents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
            if (tab.type !== "canvastab" || !isMainFrame || isInPlace) return
            if (view._nucleusHiddenForCanvasWipe) return
            if (canvasNavigationLoadPromise) return

            startCanvasNavigation(mainwindow, view)
            canvasNavigationLoadPromise = canvaspageload(view, status => {
              mainwindow.webContents.send('canvas:navigation-finished', status)
              canvasNavigationLoadPromise = null
            })
          })
          view.webContents.on('did-navigate', (_event, url) => {
            tab.url = url
            mainwindow.webContents.send('tabs:url_update', { id: tab.id, url })
          });
          view.webContents.on('did-navigate-in-page', (_event, url) => {
            tab.url = url
            mainwindow.webContents.send('tabs:url_update', { id: tab.id, url })
          });
          view.setVisible(false)
          view.setBounds(getBrowserBounds(mainwindow, tab))
          mainwindow.contentView.addChildView(view)
          tab.view = view
          const initialUrl = tab.url || "https://www.google.com"
          if (tab.type === "canvastab") {
            startCanvasNavigation(mainwindow, view)
            await loadCanvasTabURL(view, initialUrl, status => {
              mainwindow.webContents.send('canvas:navigation-finished', status)
            })
          } else {
            await view.webContents.loadURL(initialUrl)
          }
        }
        currtabs.push(tab)
      }
    }
  })

  ipcMain.handle('injection:get', () => {
    return fs.readFileSync(path.join(__dirname, 'injection.css'), 'utf-8')
  })

  ipcMain.handle('tabs:write_active_html', async () => {
    if (activetab === "None" || !activetab.view) {
      return { ok: false, error: "No active browser tab." }
    }

    const html = await activetab.view.webContents.executeJavaScript(
      "document.documentElement.outerHTML",
      true
    )
    fs.writeFileSync(path.join(__dirname, 'assignmenthtml.json'), JSON.stringify(html, null, 2))
    console.log(`Wrote active tab HTML to assignmenthtml.json (${html.length} characters).`)
    return { ok: true, characters: html.length }
  })


  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  open_canvas_auth_window(mainwindow, getauth,getauthview, setup)
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
