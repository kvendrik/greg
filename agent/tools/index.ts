import { tools as browserTools } from './browser';
import { runTerminalCommandTool } from './terminal';
import { tools as memoryTools } from './memory';

export const tools = [runTerminalCommandTool, ...browserTools, ...memoryTools];
export { getSystemInstructions } from './memory';
