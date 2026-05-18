const { spawn } = require('child_process');
const path = require('path');

function runPythonScript(scriptName, payload) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(__dirname, scriptName);
    const python = spawn('python', [scriptPath], {
      cwd: __dirname,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    python.stdout.on('data', chunk => {
      stdout += chunk.toString();
    });

    python.stderr.on('data', chunk => {
      const text = chunk.toString();
      stderr += text;
      console.error(text.trimEnd());
    });

    python.on('error', error => {
      reject(error);
    });

    python.on('close', code => {
      if (code !== 0) {
        reject(new Error(stderr || `Python script exited with code ${code}`));
        return;
      }

      const stdoutLines = stdout
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean);

      let parsed = null;
      let jsonIndex = -1;

      for (let index = stdoutLines.length - 1; index >= 0; index -= 1) {
        try {
          parsed = JSON.parse(stdoutLines[index]);
          jsonIndex = index;
          break;
        } catch (_error) {
          // Keep scanning; normal Python prints are allowed around the JSON line.
        }
      }

      stdoutLines.forEach((line, index) => {
        if (index !== jsonIndex) {
          console.log(line);
        }
      });

      if (parsed) {
        resolve(parsed);
      } else {
        reject(new Error(`Invalid JSON from Python: ${stdout}`));
      }
    });

    python.stdin.end(JSON.stringify(payload || {}));
  });
}

function runCanvas(payload) {
  return runPythonScript('canvas.py', payload);
}

module.exports = {
  runCanvas
};
