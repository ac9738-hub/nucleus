const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { runStartTaskPlaceholder } = require('./task-scripts');
const { spawn } = require('child_process');
const proc = spawn('python', [path.join(__dirname, 'sidekick.py')]);

proc.stdout.on('data', chunk => {
  BrowserWindow.getAllWindows()[0].webContents.send('prompt:response-chunk', JSON.parse(chunk));
});

function senduserprompt(payload) {
  console.log("main: received prompt to send to agent", payload);
  proc.stdin.write(JSON.stringify(payload) + '\n');
  proc.on('close', _ => print('Agent process closed'));
}


let workspaces = [
  {
    id: "nucleus",
    name: "Nucleus",
    description: "Your main planning workspace."
  },
  {
    id: "biology",
    name: "Biology",
    description: "Labs, readings, and course projects."
  },
  {
    id: "computer-science",
    name: "Computer Science",
    description: "Problem sets, code practice, and notes."
  },
  {
    id: "writing",
    name: "Writing",
    description: "Drafts, revisions, and source work."
  }
];

let workspaceids = new Set(["computer-science", "biology", "writing", "nucleus"]);
let workspacenames = new Set(["Computer Science", "Biology", "Writing", "Nucleus"]);

let projectGroups = [
  {
    id: "classes",
    label: "Classes",
    items: [
      {
        id: "bio101",
        name: "Introductory Biology",
        meta: "BIO 101",
        details: "Labs, readings, and weekly reports.",
        color: "#1d9e75"
      },
      {
        id: "cs110",
        name: "Intro to Computer Science",
        meta: "CS 110",
        details: "Problem sets, programming practice, and exams.",
        color: "#378add"
      },
      {
        id: "math220",
        name: "Linear Algebra",
        meta: "MATH 220",
        details: "Matrix methods, quizzes, and review sessions.",
        color: "#7f77dd"
      },
      {
        id: "eng105",
        name: "Academic Writing",
        meta: "ENG 105",
        details: "Drafting, citation cleanup, and revision work.",
        color: "#d85a30"
      }
    ]
  },
  {
    id: "personal",
    label: "Personal Projects",
    items: [
      {
        id: "portfolio",
        name: "Portfolio refresh",
        meta: "Personal",
        details: "Update project writeups and polish the homepage.",
        color: "#d4537e"
      },
      {
        id: "nucleus-app",
        name: "Nucleus app",
        meta: "Product",
        details: "Shape the workspace, task, and project dashboard flow.",
        color: "#c58d35"
      }
    ]
  }
];

let tasks = [
  {
    id: "bio-lab-report",
    workspaceId: "",
    course: "BIO 101",
    title: "Finish lab report",
    details: "Add observations, polish the discussion, and submit the final PDF.",
    due: "Thu",
    urgency: 100,
    estimate: "45 min",
    color: "#1d9e75"
  },
  {
    id: "cs-problem-set",
    workspaceId: "",
    course: "CS 110",
    title: "Complete problem set 4",
    details: "Work through recursion questions and test the sorting exercise.",
    due: "Fri",
    estimate: "1 hr 20 min",
    color: "#378add"
  },
  {
    id: "math-quiz-review",
    workspaceId: "",
    course: "MATH 220",
    title: "Review quiz topics",
    details: "Practice eigenvalue problems and matrix transformations.",
    due: "Mon",
    estimate: "35 min",
    color: "#7f77dd"
  },
  {
    id: "eng-essay-draft",
    workspaceId: "",
    course: "ENG 105",
    title: "Revise essay draft",
    details: "Tighten the thesis, restructure paragraph two, and check citations.",
    due: "Wed",
    estimate: "50 min",
    color: "#d85a30"
  },
  {
    id: "psy-reading",
    workspaceId: "",
    course: "PSY 101",
    title: "Read chapter 6",
    details: "Take notes on memory, recall, and recognition concepts.",
    due: "Tue",
    estimate: "30 min",
    color: "#d4537e"
  }
];

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

  BrowserWindow.getAllWindows()[0].webContents.send('wrorkspaces:update', workspaces);

}

function newTask(id, workspaceId = "", course, title, details, due, estimate, color) {
  tasks.push({ id, workspaceId, course, title, details, due, estimate, color });

  BrowserWindow.getAllWindows()[0].webContents.send('tasks:update', tasks);
}


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
}

app.whenReady().then(() => {
  ipcMain.handle('tasks:start', (_event, task) => {
    runStartTaskPlaceholder(task);
    return { ok: true };
  });
  ipcMain.handle('data:get', () => {
    console.log("Sending data to renderer...");
    return {tasks, workspaces, projectGroups};
  })
  ipcMain.handle('prompt:send', (_, payload) => {
    console.log("main: handling signal", payload);
    senduserprompt(payload);
  });
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
