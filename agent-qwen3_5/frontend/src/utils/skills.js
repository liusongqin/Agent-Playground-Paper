/**
 * Escape a string for safe inclusion in single-quoted shell arguments.
 * Replaces each single quote with the sequence: end quote, escaped quote, start quote.
 */
function shellEscape(str) {
  if (str == null) return '';
  return String(str).replace(/'/g, "'\\''");
}

export const BUILT_IN_SKILLS = [
  {
    id: 'create-file',
    name: '创建文件',
    icon: '📄',
    description: '创建一个包含指定内容的新文件',
    params: [
      { name: 'path', type: 'string', description: '要创建的文件路径' },
      { name: 'content', type: 'string', description: '文件内容' },
    ],
    toCommand: (params) => {
      const escapedContent = shellEscape(params.content);
      const escapedPath = shellEscape(params.path);
      return `printf '%s' '${escapedContent}' > '${escapedPath}'`;
    },
  },
  {
    id: 'create-folder',
    name: '创建文件夹',
    icon: '📁',
    description: '创建一个新目录（包含父目录）',
    params: [
      { name: 'path', type: 'string', description: '要创建的目录路径' },
    ],
    toCommand: (params) => `mkdir -p '${shellEscape(params.path)}'`,
  },
  {
    id: 'read-file',
    name: '读取文件',
    icon: '👁️',
    description: '读取并显示文件的内容',
    params: [
      { name: 'path', type: 'string', description: '要读取的文件路径' },
    ],
    toCommand: (params) => `cat '${shellEscape(params.path)}'`,
  },
  {
    id: 'list-files',
    name: '列出文件',
    icon: '📋',
    description: '列出指定路径下的文件和目录',
    params: [
      { name: 'path', type: 'string', description: '要列出的目录路径（默认：当前目录）' },
    ],
    toCommand: (params) => `ls -la '${shellEscape(params.path || '.')}'`,
  },
  {
    id: 'run-command',
    name: '执行命令',
    icon: '⚡',
    description: '在终端中执行一个Shell命令',
    params: [
      { name: 'command', type: 'string', description: '要执行的Shell命令' },
    ],
    toCommand: (params) => params.command,
  },
];
