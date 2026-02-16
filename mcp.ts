import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { convertJsonSchemaToZod } from 'zod-from-json-schema';

const qmdClient = new Client(
  { name: 'qmd', version: '1.0.0' },
  { capabilities: {} }
);

const clientTransport = new StdioClientTransport({
  command: 'qmd',
  args: ['mcp'],
});

await qmdClient.connect(clientTransport);

const server = new McpServer(
  {
    name: 'memory',
    version: '0.0.0',
  },
  {
    instructions: qmdClient.getInstructions(),
    capabilities: qmdClient.getServerCapabilities(),
  }
);

const { tools } = await qmdClient.listTools();

for (const tool of tools) {
  server.registerTool(
    tool.name,
    {
      description: tool.description,
      title: tool.title,
      annotations: tool.annotations,
      inputSchema: convertJsonSchemaToZod(tool.inputSchema),
      outputSchema: tool.outputSchema
        ? convertJsonSchemaToZod(tool.outputSchema)
        : undefined,
    },
    async (args) => {
      const result = await qmdClient.callTool({
        name: tool.name,
        arguments: args,
      });
      return {
        content: result.content as any,
        isError: result.isError as boolean,
      };
    }
  );
}

const { resources } = await qmdClient.listResources();

for (const resource of resources) {
  server.registerResource(
    resource.name,
    resource.uri,
    {
      description: resource.description,
      mimeType: resource.mimeType,
      title: resource.title,
    },
    async (uri) => {
      const result = await qmdClient.readResource({ uri: uri.toString() });
      return { contents: result.contents };
    }
  );
}

const transport = new StdioServerTransport();
await server.connect(transport);
