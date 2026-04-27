const ADB_URL_STORAGE_KEY = 'agent-chat-adb-url';
const DEFAULT_ADB_URL = 'http://localhost:8080';

function getServerUrl() {
  try {
    return localStorage.getItem(ADB_URL_STORAGE_KEY) || DEFAULT_ADB_URL;
  } catch {
    return DEFAULT_ADB_URL;
  }
}

/**
 * Fetch the list of available MCP tools from the server.
 * @returns {Promise<Array>} Array of tool definitions
 */
export async function listMcpTools() {
  const serverUrl = getServerUrl();
  const resp = await fetch(`${serverUrl}/api/mcp/tools`);
  const data = await resp.json();
  if (data.error) throw new Error(data.error);
  return data.tools || [];
}

/**
 * Call an MCP tool on the server.
 * @param {string} name - Tool name
 * @param {object} params - Tool parameters
 * @returns {Promise<object>} Tool execution result
 */
export async function callMcpTool(name, params = {}) {
  const serverUrl = getServerUrl();
  const resp = await fetch(`${serverUrl}/api/mcp/call`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, params }),
  });
  const data = await resp.json();
  if (data.error) throw new Error(data.error);
  return data.result;
}
