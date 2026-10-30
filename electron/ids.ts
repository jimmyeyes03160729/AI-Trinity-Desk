export const paneIds = ['claude', 'antigravity', 'codex'] as const;
type Projects = { projectMode: 'shared' | 'separate'; projectPath: string; projectPaths: Record<typeof paneIds[number], string> };
// The folder a pane's CLI runs in. In separate mode a pane without its own
// folder falls back to the shared one.
export const projectFor = (settings: Projects, id: typeof paneIds[number]) => settings.projectMode === 'separate' && settings.projectPaths[id] || settings.projectPath;
