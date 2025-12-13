// Modifications Copyright (c) 2025 Łukasz Olszewski
// Licensed under the GNU Affero General Public License v3.0
// See LICENSE for details.

import { eq, and, sql, inArray } from "drizzle-orm";
import { db } from "../index";
import { toolEmbeddingsTable } from "../schema";

interface EmbeddingInput {
  toolUuid: string;
  namespaceUuid: string;
  modelName: string;
  embeddingDimensions: number;
  embedding: number[];
  embeddingText: string;
}

interface SimilarTool {
  tool_uuid: string;
  embedding_text: string;
  similarity: number;
}

export class ToolEmbeddingsRepository {
  /**
   * Save or update embeddings for tools (upsert)
   */
  async upsertEmbeddings(embeddings: EmbeddingInput[]): Promise<void> {
    if (embeddings.length === 0) return;

    const values = embeddings.map(e => ({
      tool_uuid: e.toolUuid,
      namespace_uuid: e.namespaceUuid,
      model_name: e.modelName,
      embedding_dimensions: e.embeddingDimensions,
      embedding: e.embedding,
      embedding_text: e.embeddingText,
      updated_at: new Date(),
    }));

    await db
      .insert(toolEmbeddingsTable)
      .values(values)
      .onConflictDoUpdate({
        target: [
          toolEmbeddingsTable.tool_uuid,
          toolEmbeddingsTable.namespace_uuid,
          toolEmbeddingsTable.model_name,
        ],
        set: {
          embedding: sql`EXCLUDED.embedding`,
          embedding_text: sql`EXCLUDED.embedding_text`,
          embedding_dimensions: sql`EXCLUDED.embedding_dimensions`,
          updated_at: sql`EXCLUDED.updated_at`,
        },
      });

    console.log(`[ToolEmbeddings] Upserted ${embeddings.length} embeddings`);
  }

  /**
   * Find similar tools using pgvector cosine similarity
   * Returns tools ordered by similarity (highest first)
   */
  async findSimilarTools(
    namespaceUuid: string,
    modelName: string,
    queryEmbedding: number[],
    limit: number = 5
  ): Promise<SimilarTool[]> {
    // Convert embedding to string for SQL
    const embeddingStr = JSON.stringify(queryEmbedding);

    // Use pgvector's <=> operator for cosine distance
    // Cosine distance = 1 - cosine_similarity
    // So similarity = 1 - distance
    const results = await db
      .select({
        tool_uuid: toolEmbeddingsTable.tool_uuid,
        embedding_text: toolEmbeddingsTable.embedding_text,
        similarity: sql<number>`1 - (${toolEmbeddingsTable.embedding} <=> ${embeddingStr}::vector)`,
      })
      .from(toolEmbeddingsTable)
      .where(
        and(
          eq(toolEmbeddingsTable.namespace_uuid, namespaceUuid),
          eq(toolEmbeddingsTable.model_name, modelName)
        )
      )
      .orderBy(sql`${toolEmbeddingsTable.embedding} <=> ${embeddingStr}::vector`)
      .limit(limit);

    return results;
  }

  /**
   * Get all embeddings for a namespace (for batch processing)
   */
  async getEmbeddingsByNamespace(
    namespaceUuid: string,
    modelName: string
  ): Promise<Array<{
    tool_uuid: string;
    embedding: number[];
    embedding_text: string;
  }>> {
    return await db
      .select({
        tool_uuid: toolEmbeddingsTable.tool_uuid,
        embedding: toolEmbeddingsTable.embedding,
        embedding_text: toolEmbeddingsTable.embedding_text,
      })
      .from(toolEmbeddingsTable)
      .where(
        and(
          eq(toolEmbeddingsTable.namespace_uuid, namespaceUuid),
          eq(toolEmbeddingsTable.model_name, modelName)
        )
      );
  }

  /**
   * Check if embeddings exist for namespace with specific model
   */
  async embeddingsExist(
    namespaceUuid: string,
    modelName: string
  ): Promise<boolean> {
    const result = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(toolEmbeddingsTable)
      .where(
        and(
          eq(toolEmbeddingsTable.namespace_uuid, namespaceUuid),
          eq(toolEmbeddingsTable.model_name, modelName)
        )
      );

    return (result[0]?.count ?? 0) > 0;
  }

  /**
   * Get tool UUIDs that don't have embeddings yet
   * @deprecated Use getToolsNeedingEmbeddings instead for better invalidation
   */
  async getToolsWithoutEmbeddings(
    toolUuids: string[],
    namespaceUuid: string,
    modelName: string
  ): Promise<string[]> {
    if (toolUuids.length === 0) return [];

    const existing = await db
      .select({ tool_uuid: toolEmbeddingsTable.tool_uuid })
      .from(toolEmbeddingsTable)
      .where(
        and(
          eq(toolEmbeddingsTable.namespace_uuid, namespaceUuid),
          eq(toolEmbeddingsTable.model_name, modelName),
          inArray(toolEmbeddingsTable.tool_uuid, toolUuids)
        )
      );

    const existingUuids = new Set(existing.map(e => e.tool_uuid));
    return toolUuids.filter(uuid => !existingUuids.has(uuid));
  }

  /**
   * Get tools that need embeddings regenerated
   * Returns tools that either:
   * 1. Don't have embeddings yet, OR
   * 2. Have embeddings but the text has changed
   */
  async getToolsNeedingEmbeddings(
    tools: Array<{
      toolUuid: string;
      embeddingText: string;  // Current text (with overrides + truncation)
    }>,
    namespaceUuid: string,
    modelName: string
  ): Promise<string[]> {
    if (tools.length === 0) return [];

    const toolUuids = tools.map(t => t.toolUuid);

    // Fetch existing embeddings WITH their text
    const existing = await db
      .select({
        tool_uuid: toolEmbeddingsTable.tool_uuid,
        embedding_text: toolEmbeddingsTable.embedding_text,
      })
      .from(toolEmbeddingsTable)
      .where(
        and(
          eq(toolEmbeddingsTable.namespace_uuid, namespaceUuid),
          eq(toolEmbeddingsTable.model_name, modelName),
          inArray(toolEmbeddingsTable.tool_uuid, toolUuids)
        )
      );

    // Create map of tool UUID → stored text
    const existingMap = new Map(
      existing.map(e => [e.tool_uuid, e.embedding_text])
    );

    // Find tools that need (re)generation
    const needsRegeneration = tools.filter(tool => {
      const storedText = existingMap.get(tool.toolUuid);

      // No embedding exists
      if (!storedText) {
        return true;
      }

      // Embedding exists but text changed
      if (storedText !== tool.embeddingText) {
        console.log(`[ToolEmbeddings] Text changed for ${tool.toolUuid}`);
        console.log(`  Old: ${storedText.substring(0, 100)}...`);
        console.log(`  New: ${tool.embeddingText.substring(0, 100)}...`);
        return true;
      }

      // Embedding is up to date
      return false;
    });

    return needsRegeneration.map(t => t.toolUuid);
  }

  /**
   * Delete embeddings for specific tools (when tools are deleted/changed)
   */
  async deleteEmbeddingsByToolUuids(
    toolUuids: string[],
    namespaceUuid: string
  ): Promise<void> {
    if (toolUuids.length === 0) return;

    await db
      .delete(toolEmbeddingsTable)
      .where(
        and(
          eq(toolEmbeddingsTable.namespace_uuid, namespaceUuid),
          inArray(toolEmbeddingsTable.tool_uuid, toolUuids)
        )
      );

    console.log(`[ToolEmbeddings] Deleted embeddings for ${toolUuids.length} tools`);
  }

  /**
   * Delete all embeddings for a specific tool in a specific namespace
   * Used when user wants to regenerate embeddings for a single tool
   */
  async deleteByToolAndNamespace(
    toolUuid: string,
    namespaceUuid: string
  ): Promise<void> {
    await db
      .delete(toolEmbeddingsTable)
      .where(
        and(
          eq(toolEmbeddingsTable.tool_uuid, toolUuid),
          eq(toolEmbeddingsTable.namespace_uuid, namespaceUuid)
        )
      );

    console.log(`[ToolEmbeddings] Deleted embeddings for tool ${toolUuid} in namespace ${namespaceUuid}`);
  }

  /**
   * Get all tool UUIDs that have embeddings in a namespace
   * Used for UI to show which tools can have embeddings deleted
   */
  async getToolUuidsWithEmbeddings(
    namespaceUuid: string,
    modelName?: string
  ): Promise<string[]> {
    const conditions = [eq(toolEmbeddingsTable.namespace_uuid, namespaceUuid)];

    if (modelName) {
      conditions.push(eq(toolEmbeddingsTable.model_name, modelName));
    }

    const results = await db
      .selectDistinct({ tool_uuid: toolEmbeddingsTable.tool_uuid })
      .from(toolEmbeddingsTable)
      .where(and(...conditions));

    return results.map(r => r.tool_uuid);
  }

  /**
   * Delete all embeddings for a namespace (when namespace is reconfigured)
   */
  async deleteEmbeddingsByNamespace(
    namespaceUuid: string,
    modelName?: string
  ): Promise<void> {
    const conditions = modelName
      ? and(
          eq(toolEmbeddingsTable.namespace_uuid, namespaceUuid),
          eq(toolEmbeddingsTable.model_name, modelName)
        )
      : eq(toolEmbeddingsTable.namespace_uuid, namespaceUuid);

    await db.delete(toolEmbeddingsTable).where(conditions);

    console.log(`[ToolEmbeddings] Deleted embeddings for namespace ${namespaceUuid}`);
  }

  /**
   * Get embedding count by namespace (for monitoring)
   */
  async getEmbeddingCount(namespaceUuid: string): Promise<number> {
    const result = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(toolEmbeddingsTable)
      .where(eq(toolEmbeddingsTable.namespace_uuid, namespaceUuid));

    return result[0]?.count ?? 0;
  }
}

export const toolEmbeddingsRepository = new ToolEmbeddingsRepository();
