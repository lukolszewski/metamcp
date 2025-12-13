// Modifications Copyright (c) 2025 Łukasz Olszewski
// Licensed under the GNU Affero General Public License v3.0
// See LICENSE for details.

import { Tool } from "@modelcontextprotocol/sdk/types.js";
import MiniSearch from "minisearch";
import { z } from "zod";
import { ConnectedClient } from "./client";
import { EmbeddingClient } from "./embedding-client";
import { toolEmbeddingsRepository } from "../../db/repositories/tool-embeddings.repo";

const DISCOVER_DESCRIPTION = "Discover enables you the possibility to find other tools. " +
    "You will required to send a context that can be composed on multiple sentences as short as possible with the synthesis of the requirements you need to look for a tool. " +
    "If tools are found they will be returned as json array indicating their name, description and parameters. " +
    "To use the returned tools you will need to call the execute method indicating the toolID, method and the parameters to be used.";

const DEFAULT_DISCOVER_LIMIT = 5;

interface DynamicLimitConfig {
  maxResults: number;        // Hard cap
  dropThreshold: number;     // Relative drop % to stop (0.0 - 1.0)
  minScore: number;          // Absolute minimum score
}

const DEFAULT_DYNAMIC_CONFIG: DynamicLimitConfig = {
  maxResults: 10,
  dropThreshold: 0.30,  // 30% drop
  minScore: 0.3,        // Don't return anything below 0.3 similarity
};

interface EmbeddingTruncationConfig {
  delimiter: string;      // Substring/character to search for
  occurrence: number;     // Which occurrence to truncate at (1-based)
  minLength: number;      // Minimum length of truncated result (skip if shorter)
  enabled: boolean;       // Enable/disable truncation
}

const DEFAULT_TRUNCATION_CONFIG: EmbeddingTruncationConfig = {
  delimiter: "\n",        // Newline
  occurrence: 1,          // First occurrence
  minLength: 5,           // Skip results shorter than 5 characters
  enabled: true,
};

export enum SearchMode {
  KEYWORD = 'keyword',
  EMBEDDINGS = 'embeddings',
}

export class SmartMCPProxy {
  private toolsIndex: MiniSearch;
  private tools: Map<string, { tool: Tool, client: ConnectedClient, toolUuid: string }>;

  // Embedding-related fields
  private searchMode: SearchMode;
  private embeddingClient?: EmbeddingClient;
  private namespaceUuid?: string;
  private modelName: string;

  // Original fields
  private fuzzy: number;
  private descriptionBoost: number;
  private discoverDescription: string;
  private discoverLimit: number;
  private dynamicLimitConfig: DynamicLimitConfig;
  private truncationConfig: EmbeddingTruncationConfig;

  constructor({
    fuzzy = 0.2,
    descriptionBoost = 2,
    discoverDescription = null,
    discoverLimit = null,
    searchMode = SearchMode.KEYWORD,
    apiKey = null,
    apiUrl = null,
    embeddingModel = 'BAAI/bge-m3',
    namespaceUuid = null,
    dynamicLimitConfig = null,
    truncationConfig = null,
  }: {
    fuzzy?: number;
    descriptionBoost?: number;
    discoverDescription?: string | null;
    discoverLimit?: number | null;
    searchMode?: SearchMode;
    apiKey?: string | null;
    apiUrl?: string | null;
    embeddingModel?: string;
    namespaceUuid?: string | null;
    dynamicLimitConfig?: DynamicLimitConfig | null;
    truncationConfig?: EmbeddingTruncationConfig | null;
  } = {}) {
    this.fuzzy = fuzzy;
    this.descriptionBoost = descriptionBoost;
    this.discoverDescription = discoverDescription || DISCOVER_DESCRIPTION;
    this.discoverLimit = discoverLimit || DEFAULT_DISCOVER_LIMIT;
    this.dynamicLimitConfig = dynamicLimitConfig || DEFAULT_DYNAMIC_CONFIG;
    this.truncationConfig = truncationConfig || DEFAULT_TRUNCATION_CONFIG;

    // Setup search mode
    this.searchMode = searchMode;
    this.namespaceUuid = namespaceUuid || undefined;
    this.modelName = embeddingModel;

    console.log(`[SmartProxy] Constructor called with searchMode='${searchMode}', hasApiKey=${!!apiKey}, namespaceUuid='${namespaceUuid}'`);

    this.tools = new Map();

    // Setup MiniSearch (used for keyword mode and fallback)
    this.toolsIndex = new MiniSearch({
      fields: ['method', 'description', 'parameterDescriptions'],
      storeFields: ['toolId', 'method', 'description', 'parameterDescriptions'],
      searchOptions: {
        boost: { description: this.descriptionBoost },
        fuzzy: this.fuzzy
      }
    });

    // Setup embedding client if in embeddings mode
    console.log(`[SmartProxy] Checking embeddings mode: searchMode='${this.searchMode}', SearchMode.EMBEDDINGS='${SearchMode.EMBEDDINGS}', equal=${this.searchMode === SearchMode.EMBEDDINGS}`);
    if (this.searchMode === SearchMode.EMBEDDINGS && apiKey && namespaceUuid) {
      this.embeddingClient = new EmbeddingClient(
        apiKey,
        embeddingModel,
        apiUrl || 'http://localhost:11434/v1'
      );
      console.log('[SmartProxy] Embeddings mode enabled with model:', embeddingModel);
    } else if (this.searchMode === SearchMode.EMBEDDINGS) {
      console.warn('[SmartProxy] Embeddings mode requested but missing API key or namespace UUID. Falling back to keyword search.');
      this.searchMode = SearchMode.KEYWORD;
    } else {
      console.log(`[SmartProxy] Using keyword mode (searchMode='${this.searchMode}')`);
    }

    this.discover = this.discover.bind(this);
    this.execute = this.execute.bind(this);
  }

  async indexTools(tools: {
    tool: Tool,
    client: ConnectedClient,
    serverName: string,
    originalName: string,
    toolUuid: string
  }[]) {
    const indexableTools: any[] = [];

    // Clear existing in-memory state
    this.tools.clear();
    this.toolsIndex.removeAll();

    tools.forEach(({ tool, client, serverName, originalName, toolUuid }) => {
      const uniqueId = `${serverName}::${originalName}`;

      // Store tool reference with UUID
      this.tools.set(uniqueId, { tool, client, toolUuid });

      const parameterDescriptions = this.extractParameterDescriptions(tool.inputSchema);

      indexableTools.push({
        id: uniqueId,
        toolId: serverName,
        method: originalName,
        description: tool.description,
        parameterDescriptions,
        toolUuid, // Store for embedding lookup
      });
    });

    // Always index in MiniSearch (used for keyword mode)
    this.toolsIndex.addAll(indexableTools);
    console.log(`[SmartProxy] Indexed ${indexableTools.length} tools in MiniSearch`);

    // Generate embeddings if in embeddings mode
    if (this.searchMode === SearchMode.EMBEDDINGS && this.embeddingClient && this.namespaceUuid) {
      await this.generateAndStoreEmbeddings(indexableTools);
    }
  }

  private extractParameterDescriptions(parameters: any): string {
    if (!parameters) return '';
    let descriptions: string[] = [];
    if (parameters.properties) {
      Object.entries(parameters.properties).forEach(([paramName, paramInfo]: [string, any]) => {
        if (paramInfo.description) {
          descriptions.push(paramInfo.description);
        }
      });
    }
    return descriptions.join('\n');
  }

  private async generateAndStoreEmbeddings(tools: any[]): Promise<void> {
    console.log('[SmartProxy] Checking embeddings in database...');

    try {
      // Prepare texts FIRST (with truncation and overrides already applied)
      const toolsWithTexts = tools.map(tool => {
        const truncatedDesc = this.truncateForEmbedding(tool.description);
        const embeddingText = `${tool.method}: ${truncatedDesc || 'No description'}\n` +
          `Parameters: ${tool.parameterDescriptions || 'none'}`;

        return {
          toolUuid: tool.toolUuid,
          embeddingText,
          tool,
        };
      });

      // Check which tools need embeddings (new OR text changed)
      const toolsNeedingEmbeddings = await toolEmbeddingsRepository.getToolsNeedingEmbeddings(
        toolsWithTexts.map(t => ({ toolUuid: t.toolUuid, embeddingText: t.embeddingText })),
        this.namespaceUuid!,
        this.modelName
      );

      if (toolsNeedingEmbeddings.length === 0) {
        console.log('[SmartProxy] All tools have up-to-date embeddings');
        return;
      }

      console.log(`[SmartProxy] Generating embeddings for ${toolsNeedingEmbeddings.length} new/updated tools...`);
      const startTime = Date.now();

      // Filter to tools that need embeddings
      const toolsToEmbed = toolsWithTexts.filter(t =>
        toolsNeedingEmbeddings.includes(t.toolUuid)
      );

      // Extract just the texts for API call
      const texts = toolsToEmbed.map(t => t.embeddingText);

      console.log(`[SmartProxy] Generating embeddings for ${texts.length} tools (descriptions truncated, overrides applied)`);

      // Generate embeddings in batches (API supports up to 100 per request)
      const BATCH_SIZE = 50; // Conservative batch size
      const allEmbeddings: number[][] = [];

      for (let i = 0; i < texts.length; i += BATCH_SIZE) {
        const batch = texts.slice(i, i + BATCH_SIZE);
        const batchNum = Math.floor(i / BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(texts.length / BATCH_SIZE);

        console.log(`[SmartProxy] Processing batch ${batchNum}/${totalBatches} (${batch.length} tools)...`);

        const batchEmbeddings = await this.embeddingClient!.generateEmbeddings(batch);
        allEmbeddings.push(...batchEmbeddings);

        // Small delay between batches to avoid rate limiting
        if (i + BATCH_SIZE < texts.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      // Save to database (upsert will update if text changed)
      const embeddingsToSave = toolsToEmbed.map((toolWithText, index) => ({
        toolUuid: toolWithText.toolUuid,
        namespaceUuid: this.namespaceUuid!,
        modelName: this.modelName,
        embeddingDimensions: allEmbeddings[index].length,
        embedding: allEmbeddings[index],
        embeddingText: toolWithText.embeddingText,  // Store the current text
      }));

      await toolEmbeddingsRepository.upsertEmbeddings(embeddingsToSave);

      const duration = Date.now() - startTime;
      console.log(`[SmartProxy] ✅ Generated and stored ${allEmbeddings.length} embeddings in ${duration}ms`);

    } catch (error) {
      console.error('[SmartProxy] Failed to generate embeddings:', error);
      console.log('[SmartProxy] Falling back to keyword search for this session');
      this.searchMode = SearchMode.KEYWORD; // Fallback
    }
  }

  /**
   * Apply dynamic limiting based on score drops
   * Returns only highly relevant results, stopping at significant score drops
   */
  private applyDynamicLimit<T extends { score: number }>(
    results: T[],
    config: DynamicLimitConfig = this.dynamicLimitConfig
  ): T[] {
    if (results.length === 0) return [];

    const filtered: T[] = [];

    for (let i = 0; i < results.length; i++) {
      const current = results[i];

      // Stop at hard maximum
      if (filtered.length >= config.maxResults) {
        console.log(`[SmartProxy] Stopped at maxResults (${config.maxResults})`);
        break;
      }

      // Skip results below minimum score
      if (current.score < config.minScore) {
        console.log(`[SmartProxy] Stopped at result ${i + 1}: score ${current.score.toFixed(3)} below minScore ${config.minScore}`);
        break;
      }

      // Always include first result (if it meets minScore)
      if (i === 0) {
        filtered.push(current);
        continue;
      }

      // Calculate relative drop from previous result
      const previous = results[i - 1];
      const drop = (previous.score - current.score) / previous.score;

      // Stop if significant drop detected
      if (drop > config.dropThreshold) {
        console.log(`[SmartProxy] Stopped at result ${i + 1}: score drop ${(drop * 100).toFixed(1)}% (${previous.score.toFixed(3)} → ${current.score.toFixed(3)}) exceeds threshold ${(config.dropThreshold * 100).toFixed(0)}%`);
        break;
      }

      filtered.push(current);
    }

    console.log(`[SmartProxy] Dynamic limiting: ${results.length} candidates → ${filtered.length} results`);

    return filtered;
  }

  /**
   * Truncate description for embedding generation
   * Finds the first occurrence of delimiter that results in minLength chars
   * Starts from the configured occurrence number
   * Returns original description if no suitable truncation point found
   */
  private truncateForEmbedding(description: string | undefined): string {
    if (!description) return '';

    // If truncation disabled, return original
    if (!this.truncationConfig.enabled) {
      return description;
    }

    const { delimiter, occurrence: startOccurrence, minLength } = this.truncationConfig;

    // Validate start occurrence (must be positive)
    if (startOccurrence <= 0) {
      return description;
    }

    // Find occurrences of delimiter, starting from configured occurrence
    let currentOccurrence = 0;
    let searchIndex = 0;

    while (true) {
      const foundIndex = description.indexOf(delimiter, searchIndex);

      if (foundIndex === -1) {
        // No more delimiters found, return full description
        return description;
      }

      currentOccurrence++;

      // Only consider occurrences from startOccurrence onwards
      if (currentOccurrence >= startOccurrence) {
        const truncated = description.substring(0, foundIndex).trim();

        // Check if truncated result meets minimum length
        if (truncated.length >= minLength) {
          console.log(`[SmartProxy] Truncated description from ${description.length} to ${truncated.length} chars (at occurrence ${currentOccurrence} of "${delimiter}")`);
          return truncated;
        } else {
          console.log(`[SmartProxy] Skipping occurrence ${currentOccurrence}: truncated length ${truncated.length} < minLength ${minLength}, continuing search...`);
        }
      }

      searchIndex = foundIndex + delimiter.length;
    }
  }

  async discover({ queries }: { queries: string[] }) {
    if (!this.toolsIndex || this.toolsIndex.documentCount == 0) {
      console.warn("[SmartProxy] No tools indexed yet.");
      return { content: [{ type: "text", text: "[]" }] };
    }

    const combinedQuery = queries.join(" ");

    // DEBUG: Log the search mode check at discover time
    console.log(`[SmartProxy] discover() called - searchMode='${this.searchMode}', hasEmbeddingClient=${!!this.embeddingClient}, namespaceUuid='${this.namespaceUuid}'`);
    console.log(`[SmartProxy] SearchMode.EMBEDDINGS='${SearchMode.EMBEDDINGS}', comparison=${this.searchMode === SearchMode.EMBEDDINGS}`);

    // Use appropriate search mode
    if (this.searchMode === SearchMode.EMBEDDINGS && this.embeddingClient && this.namespaceUuid) {
      try {
        return await this.discoverWithEmbeddings(combinedQuery);
      } catch (error) {
        console.error('[SmartProxy] Embedding search failed:', error);
        console.log('[SmartProxy] Falling back to keyword search');
        // Fall through to keyword search
      }
    }

    // Keyword search (default or fallback)
    return await this.discoverWithKeywords(combinedQuery);
  }

  private async discoverWithEmbeddings(query: string) {
    console.log('[SmartProxy] Using embedding search for:', query);
    const startTime = Date.now();

    try {
      // Step 1: Generate query embedding
      const queryEmbedding = await this.embeddingClient!.generateSingleEmbedding(query);

      // Step 2: Search database using pgvector
      // Fetch more candidates than we need for dynamic filtering
      const candidateLimit = this.dynamicLimitConfig.maxResults * 2;
      const similarTools = await toolEmbeddingsRepository.findSimilarTools(
        this.namespaceUuid!,
        this.modelName,
        queryEmbedding,
        candidateLimit
      );

      // Step 3: Map to result format
      const mappedResults = similarTools.map(({ tool_uuid, similarity }) => {
        // Find the tool in our in-memory map
        const toolEntry = Array.from(this.tools.entries()).find(
          ([_, data]) => data.toolUuid === tool_uuid
        );

        if (!toolEntry) {
          console.warn(`[SmartProxy] Tool ${tool_uuid} found in embeddings but not in current tool set`);
          return null;
        }

        const [uniqueId, toolData] = toolEntry;
        const [toolId, method] = uniqueId.split('::');

        return {
          toolId,
          method,
          description: toolData.tool.description,
          inputSchema: toolData.tool.inputSchema,
          score: similarity, // Similarity score for dynamic limiting
        };
      }).filter(Boolean);

      // Step 4: Apply dynamic limiting based on score drops
      const result = this.applyDynamicLimit(mappedResults);

      const duration = Date.now() - startTime;
      console.log(`[SmartProxy] Embedding search returned ${result.length} results in ${duration}ms`);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result)
          }
        ]
      };

    } catch (error) {
      console.error('[SmartProxy] Embedding search error:', error);
      throw error; // Will be caught by discover() and fall back to keywords
    }
  }

  private async discoverWithKeywords(combinedQuery: string) {
    console.log('[SmartProxy] Using keyword search for:', combinedQuery);

    const searchResults = this.toolsIndex.search(combinedQuery, {
      fuzzy: this.fuzzy,
      prefix: true,
      boost: { description: this.descriptionBoost },
      combineWith: 'OR',
    });

    // Normalize MiniSearch scores to 0-1 range and add to results
    const maxScore = searchResults.length > 0 ? searchResults[0].score : 1;
    const resultsWithNormalizedScores = searchResults.map(result => {
      const uniqueId = result.id;
      const toolData = this.tools.get(uniqueId);

      if (!toolData) return null;

      return {
        toolId: result.toolId,
        method: result.method,
        description: result.description,
        inputSchema: toolData.tool.inputSchema,
        score: result.score / maxScore, // Normalize to 0-1 range
      };
    }).filter(Boolean);

    // Apply dynamic limiting based on score drops
    const filteredResults = this.applyDynamicLimit(resultsWithNormalizedScores);

    // Remove score field from final results (for backward compatibility)
    const result = filteredResults.map(({ score, ...rest }) => rest);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result)
        }
      ]
    };
  }

  async execute({ toolId, method, args }: { toolId: string, method: string, args: any }) {
    const uniqueId = `${toolId}::${method}`;
    const toolData = this.tools.get(uniqueId);

    if (!toolData) {
      throw new Error(`Tool ${method} on server ${toolId} not found. Use 'discover' to find available tools.`);
    }

    console.log(`[SmartProxy] Executing ${method} on ${toolId}`);
    
    // Call the tool using the connected client
    // We need to use the original tool name
    return await toolData.client.client.callTool({
      name: method,
      arguments: args
    });
  }

  getTools(): Tool[] {
    return [
      {
        name: "discover",
        description: this.discoverDescription,
        inputSchema: {
          type: "object",
          properties: {
            queries: {
              type: "array",
              items: {
                type: "string",
                description: "Sentence used to query for tools, they should be as short and concise as possible"
              },
              description: "List of sentence of intentions to discover if there tools available that can be used"
            }
          },
          required: ["queries"]
        }
      },
      {
        name: "execute",
        description: "execute a tools, this method will act as proxy to call the required tool method with the right parameters",
        inputSchema: {
          type: "object",
          properties: {
            toolId: {
              type: "string",
              description: "Tool id to execute (server name)"
            },
            method: {
              type: "string",
              description: "The tool method to be executed (original tool name)"
            },
            args: {
              type: "object",
              description: "Arguments to be passed to the tool"
            }
          },
          required: ["toolId", "method", "args"]
        }
      }
    ];
  }
}
