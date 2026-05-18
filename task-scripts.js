function runStartTaskPlaceholder(task) {
  const taskName = task?.title || 'Untitled task';
  console.log(`[nucleus] Placeholder start-task script ran for: ${taskName}`);
}

module.exports = {
  runStartTaskPlaceholder
};
